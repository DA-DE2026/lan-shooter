// The in-match 3D game: renders the jungle with Three.js, runs predicted
// local movement (identical shared 2D collision as before), interpolates
// remote players, and mirrors the server's authoritative combat state.
// All game logic stays 2D — (x, y) maps to 3D (x, height, z = y) — so the
// server and netcode are untouched by the 3D rendering.

import * as THREE from 'three';
import {
  MSG, MAPS, WEAPONS, SKIN_COLORS, TILE,
  PLAYER_SPEED, PLAYER_RADIUS, PING_LIFETIME_MS, moveCircle, bushClusterAt,
} from '@lan-shooter/shared';
import { emit, getSocket } from '../net.js';
import { state, serverNow, rosterPlayer, teamInfo } from '../state.js';
import { toast } from '../utils.js';
import { buildWorld } from './world3d.js';
import { Player3D } from './Player3D.js';
import { Minimap2D } from './Minimap2D.js';
import { FogOfWar } from './fog3d.js';
import { hudTick, isChatOpen, addKillFeed, damageFlash } from '../ui/hud.js';
import { touch, STICK_DEAD_ZONE, FIRE_THRESHOLD } from '../ui/touch.js';

const MOVE_SEND_MS = 50;
const CAM_HEIGHT = 620;   // camera rig: high angled follow view
const CAM_BACK = 430;
const PROJ_HEIGHT = 32;   // gun height — projectiles fly at this y
const LOOT_COLORS = { longshot: 0x9ad0ff, stinger: 0xffd27a };

export class Game3D {
  constructor(matchData) {
    this.matchData = matchData;
  }

  mount(rootEl) {
    const md = this.matchData;
    this.map = MAPS[md.settings.mapId];

    // --- renderer / scene / camera ---
    // Touch devices (phones/tablets) render at a lower internal resolution
    // and skip MSAA — a modest "zoom" that trades a little sharpness for
    // meaningfully fewer shaded pixels per frame, since this scene (shadow
    // mapping + tone mapping) is GPU-heavy for typical mobile chips. The
    // canvas itself still fills the full screen either way; only the
    // resolution it's rendered at (then upscaled) changes. Desktop keeps
    // full DPI + antialiasing.
    this.renderer = new THREE.WebGLRenderer({ antialias: !touch.enabled });
    this.renderer.setPixelRatio(touch.enabled ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    rootEl.appendChild(this.renderer.domElement);

    this.sceneGl = new THREE.Scene();
    this.sceneGl.background = new THREE.Color(0x0c120a);
    this.sceneGl.fog = new THREE.Fog(0x0c120a, 1100, 2600);
    this.camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 10, 4000,
    );

    this.worldFx = buildWorld(this.sceneGl, this.map); // { tick } for ambient life

    // --- players ---
    this.players = new Map(); // id -> Player3D
    for (const p of md.players) this.addPlayer(p);

    const me = md.players.find((p) => p.id === state.selfId);
    this.myTeam = me?.team ?? 0;
    this.self = {
      x: me?.x ?? TILE * 2, y: me?.y ?? TILE * 2, aim: 0,
      alive: me?.alive ?? true, hp: me?.hp ?? 100,
      weaponIndex: me?.w ?? 0, ammo: me?.ammo ?? WEAPONS[0].magSize,
      reloadUntil: me?.rel ?? 0, special: me?.sw ?? -1,
    };
    this.lastSwitchAt = 0;
    this.scores = md.scores;
    this.endsAt = md.endsAt;
    this.nextRespawnAt = md.nextRespawnAt;

    // --- runtime state ---
    this.projs = new Map(); // projId -> { mesh, vx, vz, dieAt }
    this.effects = [];      // transient visuals: { obj, bornAt, ttl, tick }
    this.pings = [];        // minimap pings: { x, y, bornAt, color }
    this.firing = false;
    this.lastFireEmit = 0;
    this.reloadAsked = false;
    this.moveAccum = 0;
    this.spectateIdx = 0;
    this.followId = state.selfId;

    // Aim raycasting against the ground plane.
    this.ndc = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.aimPoint = new THREE.Vector3();

    this.minimap = new Minimap2D(this.map, {
      onPing: ({ x, y }) => emit(MSG.PING_MAP, { x, y }),
    });
    this.fog = new FogOfWar(this.sceneGl, this.map);

    this.pickupMeshes = new Map(); // pickupId -> { group, box }
    for (const pickup of md.pickups ?? []) this.addPickup(pickup);

    this.setupInput();
    this.setupNet();

    // Twin-stick touch controls on phones/tablets.
    touch.setHandlers({
      onReload: () => { if (this.self.alive) emit(MSG.RELOAD); },
      onWeapon: () => this.cycleWeapon(),
    });
    touch.show();

    // Snap the camera into place, then start the loop.
    this.updateCamera();
    this.running = true;
    this._lastT = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const deltaMs = Math.min(50, t - this._lastT);
      this._lastT = t;
      this.update(deltaMs);
      this.renderer.render(this.sceneGl, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }

  // -------------------------------------------------------------- players

  addPlayer(data) {
    const roster = rosterPlayer(data.id);
    const team = data.team ?? roster?.team ?? 0;
    const player = new Player3D(this.sceneGl, {
      id: data.id,
      name: data.name ?? roster?.name ?? 'Player',
      teamColor: teamInfo(team).color,
      skinColor: SKIN_COLORS[data.skin ?? roster?.skin ?? 0],
      x: data.x ?? 0,
      y: data.y ?? 0,
    });
    player.teamIndex = team;
    player.setStatus({ alive: !!data.alive, connected: data.conn !== false });
    this.players.set(data.id, player);
    return player;
  }

  /** Called when the roster changes mid-match (rename/team color/joiners). */
  refreshRoster() {
    if (!this.players) return; // still booting
    for (const player of this.players.values()) {
      const r = rosterPlayer(player.playerId);
      if (!r) continue;
      player.teamIndex = r.team;
      player.setTintColors({
        teamColor: teamInfo(r.team).color,
        skinColor: SKIN_COLORS[r.skin],
        name: r.name,
      });
    }
  }

  // ---------------------------------------------------------------- input

  setupInput() {
    this.pressed = new Set();
    const canvas = this.renderer.domElement;

    this._onKeyDown = (e) => {
      if (isChatOpen()) return;
      this.pressed.add(e.code);
      if (e.code === 'KeyR' && this.self.alive) emit(MSG.RELOAD);
      else if (e.code === 'KeyQ') this.cycleWeapon();
      else if (e.code === 'Digit1') this.setWeapon(0);
      else if (e.code === 'Digit2') this.setWeapon(1);
      else if (e.code === 'Digit3' && this.self.special >= 0) this.setWeapon(this.self.special);
      else if (e.code === 'ArrowLeft') this.cycleSpectate(-1);
      else if (e.code === 'ArrowRight') this.cycleSpectate(1);
    };
    this._onKeyUp = (e) => this.pressed.delete(e.code);
    this._onBlur = () => {
      this.pressed.clear();
      this.firing = false;
    };
    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };
    this._onMouseMove = (e) => {
      this.ndc.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
    };
    this._onMouseDown = (e) => {
      if (touch.enabled) return; // touch devices shoot with the right stick
      if (isChatOpen()) return;
      this._onMouseMove(e);
      if (e.button === 1 || e.altKey) {
        // Ping the aimed-at ground location for the team.
        this.computeAimPoint();
        emit(MSG.PING_MAP, { x: this.aimPoint.x, y: this.aimPoint.z });
        e.preventDefault();
        return;
      }
      if (e.button !== 0 || !this.self.alive) return;
      if (WEAPONS[this.self.weaponIndex].auto) this.firing = true;
      else this.tryFire();
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.firing = false;
    };
    this._onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('resize', this._onResize);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('contextmenu', this._onContextMenu);
  }

  removeInput() {
    const canvas = this.renderer.domElement;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('resize', this._onResize);
    canvas.removeEventListener('mousemove', this._onMouseMove);
    canvas.removeEventListener('mousedown', this._onMouseDown);
    canvas.removeEventListener('mouseup', this._onMouseUp);
    canvas.removeEventListener('contextmenu', this._onContextMenu);
  }

  /** Raycast the pointer onto the ground plane -> this.aimPoint. */
  computeAimPoint() {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.ray.intersectPlane(this.groundPlane, this.aimPoint);
  }

  setWeapon(i) {
    if (i === this.self.weaponIndex || i < 0 || i >= WEAPONS.length) return;
    if (WEAPONS[i].loot && i !== this.self.special) return; // not carrying it
    this.self.weaponIndex = i;
    this.lastSwitchAt = Date.now();
    this.firing = false;
    this.reloadAsked = false;
    emit(MSG.SWITCH_WEAPON, i);
  }

  /** Q cycles through carried weapons: rifle -> scatter -> loot -> rifle. */
  cycleWeapon() {
    const owned = [0, 1];
    if (this.self.special >= 0) owned.push(this.self.special);
    const idx = owned.indexOf(this.self.weaponIndex);
    this.setWeapon(owned[(idx + 1) % owned.length]);
  }

  tryFire() {
    const w = WEAPONS[this.self.weaponIndex];
    const now = Date.now();
    if (now - this.lastFireEmit < w.fireDelayMs) return;
    if (this.self.reloadUntil > serverNow()) return;
    if (this.self.ammo <= 0) {
      if (!this.reloadAsked) {
        emit(MSG.RELOAD);
        this.reloadAsked = true;
      }
      return;
    }
    this.lastFireEmit = now;
    emit(MSG.FIRE, { a: this.self.aim });
  }

  // ------------------------------------------------------------ networking

  setupNet() {
    const socket = getSocket();
    if (!socket) return;
    this.netHandlers = [
      [MSG.SNAPSHOT, (snap) => this.onSnapshot(snap)],
      [MSG.PROJ_SPAWN, (data) => this.onProjSpawn(data)],
      [MSG.PROJ_END, (data) => this.onProjEnd(data)],
      [MSG.HIT, (data) => this.onHit(data)],
      [MSG.KILL, (data) => this.onKill(data)],
      [MSG.PING_MARK, (data) => this.onPingMark(data)],
      [MSG.PICKUP_SPAWN, (data) => this.addPickup(data)],
      [MSG.PICKUP_TAKEN, (data) => this.onPickupTaken(data)],
    ];
    for (const [event, fn] of this.netHandlers) socket.on(event, fn);
  }

  onSnapshot(snap) {
    state.clockOffset = snap.t - Date.now();
    this.scores = snap.scores;
    this.endsAt = snap.endsAt;
    this.nextRespawnAt = snap.nextRespawnAt;

    const seen = new Set();
    for (const p of snap.players) {
      seen.add(p.id);
      let player = this.players.get(p.id);
      if (!player) player = this.addPlayer(p); // mid-match joiner

      // Reappearing from fog: snap to the reported position rather than
      // interpolating across the map from a stale one.
      if (player.fogged) {
        player.setFogged(false);
        player.set2D(p.x, p.y);
        player.target = { x: p.x, y: p.y, a: p.a };
      }

      if (p.id === state.selfId) {
        const wasAlive = this.self.alive;
        this.self.hp = p.hp;
        this.self.ammo = p.ammo;
        this.self.reloadUntil = p.rel;
        this.self.special = p.sw;
        // Adopt server-forced weapon changes (e.g. an emptied loot weapon),
        // but not so eagerly that our own fresh switch flickers back.
        if (p.w !== this.self.weaponIndex && Date.now() - this.lastSwitchAt > 400) {
          this.self.weaponIndex = p.w;
        }
        if (p.ammo > 0) this.reloadAsked = false;

        if (p.alive && !wasAlive) {
          // Respawn wave: teleport to the server-chosen spawn.
          this.self.alive = true;
          this.self.x = p.x;
          this.self.y = p.y;
          player.set2D(p.x, p.y);
          this.followId = state.selfId;
        } else if (!p.alive && wasAlive) {
          this.self.alive = false;
          this.beginSpectate();
        } else if (p.alive && Math.hypot(p.x - this.self.x, p.y - this.self.y) > 200) {
          // Large desync (shouldn't happen on LAN) — accept server position.
          this.self.x = p.x;
          this.self.y = p.y;
          player.set2D(p.x, p.y);
        }
        player.setStatus({ alive: p.alive, connected: true });
        player.setHp(p.hp);
      } else {
        player.teamIndex = p.team;
        player.target = { x: p.x, y: p.y, a: p.a };
        player.setStatus({ alive: p.alive, connected: p.conn });
        player.setHp(p.hp);
      }
    }

    // Players missing from our snapshot are either in the fog (still in the
    // roster — keep the sprite, hidden) or gone from the match (dispose).
    for (const [id, player] of this.players) {
      if (seen.has(id)) continue;
      if (rosterPlayer(id)) {
        player.setFogged(true);
      } else {
        player.dispose();
        this.players.delete(id);
      }
    }
  }

  onProjSpawn({ team, shots }) {
    const color = teamInfo(team).color;
    for (const shot of shots) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(3.5, 6, 5),
        new THREE.MeshBasicMaterial({ color }),
      );
      mesh.position.set(shot.x, PROJ_HEIGHT, shot.y);
      this.sceneGl.add(mesh);
      this.projs.set(shot.id, {
        mesh, vx: shot.vx, vz: shot.vy, dieAt: Date.now() + shot.ttl,
      });
    }
    if (shots.length) {
      this.spawnFlash(shots[0].x, shots[0].y, 0xffe9a0, 8, 90);
    }
  }

  onProjEnd({ id, x, y }) {
    const proj = this.projs.get(id);
    if (proj) {
      this.disposeMesh(proj.mesh);
      this.projs.delete(id);
    }
    this.spawnFlash(x, y, 0xaab3c8, 7, 140);
  }

  onHit({ victimId, hp, x, y }) {
    const player = this.players.get(victimId);
    if (player) {
      player.flashHit();
      player.setHp(hp);
    }
    this.spawnFlash(x, y, 0xff8866, 6, 120);
    if (victimId === state.selfId) damageFlash();
  }

  onKill({ killerId, victimId }) {
    addKillFeed(killerId, victimId);
    const player = this.players.get(victimId);
    if (player) player.setStatus({ alive: false, connected: true });
    if (victimId === state.selfId) {
      this.self.alive = false;
      this.firing = false;
      this.beginSpectate();
    }
  }

  onPingMark({ team, x, y }) {
    const color = teamInfo(team).color;
    this.pings.push({ x, y, bornAt: Date.now(), color });

    // World marker: pulsing ground ring + light beam.
    const group = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(14, 19, 24), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.6;
    const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 90, 8), beamMat);
    beam.position.y = 45;
    group.add(ring, beam);
    group.position.set(x, 0, y);
    this.sceneGl.add(group);

    this.effects.push({
      obj: group, bornAt: Date.now(), ttl: PING_LIFETIME_MS,
      tick: (age) => {
        const pulse = 1 + Math.sin(age * Math.PI * 6) * 0.25;
        ring.scale.set(pulse, pulse, 1);
        const fade = age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1;
        ringMat.opacity = 0.9 * fade;
        beamMat.opacity = 0.5 * fade;
      },
    });
  }

  /** Weapon crate: colored box on a ground ring with a light beam. */
  addPickup({ id, x, y, w }) {
    if (this.pickupMeshes.has(id)) return;
    const color = LOOT_COLORS[WEAPONS[w]?.id] ?? 0xffffff;
    const group = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(13, 13, 13),
      new THREE.MeshLambertMaterial({ color, emissive: 0x222222 }),
    );
    box.position.y = 16;
    box.castShadow = true;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(15, 19, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.5;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 70, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18 }),
    );
    beam.position.y = 35;
    group.add(box, ring, beam);
    group.position.set(x, 0, y);
    this.sceneGl.add(group);
    this.pickupMeshes.set(id, { group, box });
  }

  onPickupTaken({ id, byId, w }) {
    const pickup = this.pickupMeshes.get(id);
    if (pickup) {
      this.spawnFlash(pickup.group.position.x, pickup.group.position.z, 0xfff2c0, 10, 200);
      this.disposeMesh(pickup.group);
      this.pickupMeshes.delete(id);
    }
    if (byId === state.selfId) {
      toast(`Picked up: ${WEAPONS[w]?.name ?? 'weapon'} (press 3)`);
    }
  }

  /** Short-lived unlit flash sphere (muzzle, impacts, hit sparks). */
  spawnFlash(x, y, color, size, ttl) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 5), mat);
    mesh.position.set(x, PROJ_HEIGHT, y);
    this.sceneGl.add(mesh);
    this.effects.push({
      obj: mesh, bornAt: Date.now(), ttl,
      tick: (age) => {
        mesh.scale.setScalar(1 + age * 1.4);
        mat.opacity = 0.9 * (1 - age);
      },
    });
  }

  disposeMesh(mesh) {
    this.sceneGl.remove(mesh);
    mesh.traverse?.((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    mesh.geometry?.dispose();
    mesh.material?.dispose();
  }

  // ------------------------------------------------------------- spectating

  spectateCandidates() {
    return [...this.players.values()].filter((p) =>
      p.playerId !== state.selfId && p.teamIndex === this.myTeam && p.root.visible);
  }

  beginSpectate() {
    this.spectateIdx = 0;
    this.applySpectate();
  }

  cycleSpectate(dir) {
    if (this.self.alive) return; // arrows double as movement keys while alive
    this.spectateIdx += dir;
    this.applySpectate();
  }

  applySpectate() {
    const list = this.spectateCandidates();
    if (!list.length) return; // whole team down — camera holds position
    const idx = ((this.spectateIdx % list.length) + list.length) % list.length;
    this.followId = list[idx].playerId;
  }

  // ------------------------------------------------------------- game loop

  update(deltaMs) {
    const dt = deltaMs / 1000;
    const now = Date.now();

    for (const player of this.players.values()) {
      if (player.playerId !== state.selfId) player.interpolate(dt);
    }

    if (this.self.alive) {
      this.updateLocalPlayer(deltaMs, dt);
    } else {
      // If our spectate target died, hop to the next living teammate.
      const followed = this.players.get(this.followId);
      if (!followed || (!followed.root.visible && this.followId !== state.selfId)) {
        this.applySpectate();
      }
    }

    // Projectiles fly client-side between server spawn/end events.
    for (const [id, p] of this.projs) {
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.z += p.vz * dt;
      if (now > p.dieAt) {
        this.disposeMesh(p.mesh);
        this.projs.delete(id);
      }
    }

    // Transient effects.
    this.effects = this.effects.filter((fx) => {
      const age = (now - fx.bornAt) / fx.ttl;
      if (age >= 1) {
        this.disposeMesh(fx.obj);
        return false;
      }
      fx.tick(age);
      return true;
    });
    this.pings = this.pings.filter((p) => now - p.bornAt < PING_LIFETIME_MS);
    this.worldFx?.tick(now);

    // Crates spin and bob.
    for (const [id, pk] of this.pickupMeshes) {
      pk.box.rotation.y += dt * 2;
      pk.box.position.y = 16 + Math.sin(now / 320 + id) * 3;
    }

    // Walk-cycle animation + bush translucency, after positions are final.
    for (const player of this.players.values()) {
      player.tickWalk(dt);
      if (player.playerId === state.selfId) {
        player.setBushHidden(this.self.alive && bushClusterAt(this.map, this.self.x, this.self.y) >= 0);
      } else if (player.root.visible) {
        player.setBushHidden(bushClusterAt(this.map, player.x2, player.y2) >= 0);
      }
    }

    this.updateCamera();
    this.updateFog(now);
    this.updateMinimap(now);
    hudTick({
      hp: this.self.hp,
      alive: this.self.alive,
      weaponIndex: this.self.weaponIndex,
      ammo: this.self.ammo,
      reloadUntil: this.self.reloadUntil,
      scores: this.scores,
      endsAt: this.endsAt,
      nextRespawnAt: this.nextRespawnAt,
    });
  }

  updateLocalPlayer(deltaMs, dt) {
    const player = this.players.get(state.selfId);
    if (!player) return;

    if (!isChatOpen()) {
      // Movement: left touch stick (analog) or keyboard.
      let dx = 0;
      let dy = 0;
      const moveStick = touch.enabled ? touch.moveStick() : null;
      if (moveStick?.active && Math.hypot(moveStick.x, moveStick.y) > STICK_DEAD_ZONE) {
        dx = moveStick.x;
        dy = moveStick.y; // screen axes align with world axes (fixed camera yaw)
      } else if (!moveStick?.active) {
        const k = this.pressed;
        dx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0)
          - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
        dy = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
          - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
      }
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        const step = PLAYER_SPEED * dt * Math.min(1, len); // analog speed
        const moved = moveCircle(
          this.map, this.self.x, this.self.y,
          (dx / len) * step, (dy / len) * step, PLAYER_RADIUS,
        );
        this.self.x = moved.x;
        this.self.y = moved.y;
      }

      if (touch.enabled) {
        // Aim + fire: right stick direction; push it far to shoot.
        const aimStick = touch.aimStick();
        const deflection = aimStick.active ? Math.hypot(aimStick.x, aimStick.y) : 0;
        if (deflection > STICK_DEAD_ZONE) {
          this.self.aim = Math.atan2(aimStick.y, aimStick.x);
        }
        if (deflection > FIRE_THRESHOLD) this.tryFire();
      } else {
        // Aim at the pointer's ground-plane intersection.
        this.computeAimPoint();
        this.self.aim = Math.atan2(
          this.aimPoint.z - this.self.y,
          this.aimPoint.x - this.self.x,
        );
        if (this.firing && WEAPONS[this.self.weaponIndex].auto) this.tryFire();
      }
    }

    player.set2D(this.self.x, this.self.y);
    player.setAim(this.self.aim);

    // Report position/aim to the server at a fixed rate.
    this.moveAccum += deltaMs;
    if (this.moveAccum >= MOVE_SEND_MS) {
      this.moveAccum = 0;
      emit(MSG.MOVE, {
        x: Math.round(this.self.x * 10) / 10,
        y: Math.round(this.self.y * 10) / 10,
        a: Math.round(this.self.aim * 1000) / 1000,
      });
    }
  }

  updateCamera() {
    // Steady cam: rigidly locked to the followed player — no smoothing lag,
    // no drift, so the view (and your aim point) never floats.
    const target = this.players.get(this.followId) ?? this.players.get(state.selfId);
    if (!target) return;
    const t = target.root.position;
    this.camera.position.set(t.x, CAM_HEIGHT, t.z + CAM_BACK);
    this.camera.lookAt(t.x, 20, t.z - 40);
  }

  /** Living, connected teammates (and self) provide shared vision. */
  updateFog(now) {
    const viewers = [];
    if (this.self.alive) viewers.push({ x: this.self.x, y: this.self.y });
    for (const player of this.players.values()) {
      if (player.playerId === state.selfId || player.teamIndex !== this.myTeam) continue;
      if (!player.aliveVis || !player.connectedVis) continue;
      viewers.push({ x: player.x2, y: player.y2 });
    }
    this.fog.update(viewers, now);
  }

  updateMinimap(now) {
    const teammates = [];
    for (const player of this.players.values()) {
      if (player.playerId === state.selfId || player.teamIndex !== this.myTeam) continue;
      if (!player.root.visible) continue;
      teammates.push({ x: player.x2, y: player.y2, color: teamInfo(player.teamIndex).color });
    }
    const pickups = [...this.pickupMeshes.values()]
      .map((pk) => ({ x: pk.group.position.x, y: pk.group.position.z }));
    this.minimap.update({
      self: this.self.alive ? { x: this.self.x, y: this.self.y } : null,
      selfColor: teamInfo(this.myTeam).color,
      teammates,
      pings: this.pings,
      pickups,
      fog: this.fog.canvas,
      now,
    });
  }

  // --------------------------------------------------------------- cleanup

  destroy() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.removeInput();
    touch.hide();
    touch.setHandlers(null);
    const socket = getSocket();
    if (socket && this.netHandlers) {
      for (const [event, fn] of this.netHandlers) socket.off(event, fn);
    }
    this.minimap?.destroy();
    this.fog?.dispose();
    for (const player of this.players.values()) player.dispose();
    this.sceneGl.traverse((o) => {
      o.geometry?.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => { x.map?.dispose(); x.dispose(); });
      else if (m) { m.map?.dispose(); m.dispose(); }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
