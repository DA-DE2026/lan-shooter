// 3D soldier model: cylinder torso in the outfit color, team-colored helmet
// and shoulder pads, arms holding a gun, animated feet, ground ring + blob
// shadow, and a billboard sprite with name + HP bar overhead.
//
// Coordinate convention: game logic is 2D (x, y); in 3D that maps to
// (x, height, z = y). Local +x is "forward", so root.rotation.y = -aim.

import * as THREE from 'three';
import { PLAYER_MAX_HP } from '@lan-shooter/shared';
import { cssColor } from '../utils.js';

const SKIN = 0xd9a066;

/** Darken an 0xrrggbb color (sleeves vs torso shading). */
function darken(c, f = 0.72) {
  const r = Math.round(((c >> 16) & 0xff) * f);
  const g = Math.round(((c >> 8) & 0xff) * f);
  const b = Math.round((c & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/** Shortest-path angle wrap to [-PI, PI]. */
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Player3D {
  constructor(scene, { id, name, teamColor, skinColor, x, y }) {
    this.scene = scene;
    this.playerId = id;
    this.name = name;
    this.outfit = skinColor;
    this.team = teamColor;
    this.hp = PLAYER_MAX_HP;
    this.disposed = false;

    // Per-player materials so tint/ghosting never leaks between players.
    this.mats = {
      outfit: new THREE.MeshLambertMaterial({ color: skinColor }),
      sleeve: new THREE.MeshLambertMaterial({ color: darken(skinColor) }),
      team: new THREE.MeshLambertMaterial({ color: teamColor }),
      skin: new THREE.MeshLambertMaterial({ color: SKIN }),
      gun: new THREE.MeshLambertMaterial({ color: 0x23262e }),
      foot: new THREE.MeshLambertMaterial({ color: 0x1c1f27 }),
      ring: new THREE.MeshBasicMaterial({
        color: teamColor, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      }),
      shadow: new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.18,
      }),
    };

    this.root = new THREE.Group();
    this.root.position.set(x, 0, y);

    // Grounded parts (don't bob with the walk cycle).
    const ring = new THREE.Mesh(new THREE.RingGeometry(15, 19, 24), this.mats.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(16, 20), this.mats.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.25;
    this.footL = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6), this.mats.foot);
    this.footL.position.set(-2, 3, -7);
    this.footR = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6), this.mats.foot);
    this.footR.position.set(-2, 3, 7);

    // Torso group bobs as one unit while walking.
    this.torsoGroup = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(12, 13.5, 27, 10), this.mats.outfit);
    body.position.y = 27;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(10, 12, 9), this.mats.team);
    helmet.position.y = 48;
    const face = new THREE.Mesh(new THREE.SphereGeometry(3.6, 8, 6), this.mats.skin);
    face.position.set(8, 47, 0);
    const padL = new THREE.Mesh(new THREE.SphereGeometry(4.6, 8, 6), this.mats.team);
    padL.position.set(0, 41, -12);
    const padR = new THREE.Mesh(new THREE.SphereGeometry(4.6, 8, 6), this.mats.team);
    padR.position.set(0, 41, 12);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(16, 4.5, 4.5), this.mats.sleeve);
    armL.position.set(9, 33, -9);
    armL.rotation.y = 0.3;
    const armR = new THREE.Mesh(new THREE.BoxGeometry(16, 4.5, 4.5), this.mats.sleeve);
    armR.position.set(9, 33, 9);
    armR.rotation.y = -0.3;
    const handL = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 6), this.mats.skin);
    handL.position.set(16, 32, -4);
    const handR = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 6), this.mats.skin);
    handR.position.set(16, 32, 4);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(22, 4.5, 3.5), this.mats.gun);
    gun.position.set(20, 33.5, 0);
    this.torsoGroup.add(body, helmet, face, padL, padR, armL, armR, handL, handR, gun);

    // Overhead label (billboard, unaffected by root yaw for position).
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 256;
    this.labelCanvas.height = 64;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex }));
    this.labelSprite.scale.set(100, 25, 1);
    this.labelSprite.center.set(0.5, 0);
    this.labelSprite.position.y = 62;
    this.drawLabel();

    // Real sun shadows for the figure; the soft blob stays as a light
    // ambient-occlusion anchor under the feet.
    this.torsoGroup.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.footL.castShadow = true;
    this.footR.castShadow = true;

    this.root.add(ring, shadow, this.footL, this.footR, this.torsoGroup, this.labelSprite);
    scene.add(this.root);

    // Interpolation target (remote players) + walk animation state.
    this.target = { x, y, a: 0 };
    this.walkPhase = 0;
    this.lastPos = { x, z: y };
    this.aliveVis = true;      // last known alive state
    this.connectedVis = true;  // last known connection state
    this.fogged = false;       // hidden by fog of war
    this.bushHidden = false;   // rendered translucent while inside a bush
  }

  /** 2D position accessors (y in game logic = z in the 3D scene). */
  get x2() { return this.root.position.x; }
  get y2() { return this.root.position.z; }

  set2D(x, y) {
    this.root.position.x = x;
    this.root.position.z = y;
  }

  setAim(a) {
    this.root.rotation.y = -a;
  }

  setTintColors({ teamColor, skinColor, name }) {
    this.team = teamColor;
    this.mats.team.color.setHex(teamColor);
    this.mats.ring.color.setHex(teamColor);
    if (skinColor !== undefined) {
      this.outfit = skinColor;
      this.mats.outfit.color.setHex(skinColor);
      this.mats.sleeve.color.setHex(darken(skinColor));
    }
    if (name) this.name = name;
    this.drawLabel();
  }

  setHp(hp) {
    if (hp === this.hp) return;
    this.hp = hp;
    this.drawLabel();
  }

  drawLabel() {
    const ctx = this.labelCanvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 22px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#000';
    ctx.strokeText(this.name, 128, 26);
    ctx.fillStyle = cssColor(this.team);
    ctx.fillText(this.name, 128, 26);
    // HP bar.
    const pct = Math.max(0, this.hp / PLAYER_MAX_HP);
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(68, 36, 120, 10);
    ctx.fillStyle = pct > 0.35 ? '#61d17e' : '#e0524d';
    ctx.fillRect(70, 38, 116 * pct, 6);
    this.labelTex.needsUpdate = true;
  }

  /** Quick white flash on the body when hit. */
  flashHit() {
    for (const m of [this.mats.outfit, this.mats.sleeve, this.mats.team]) {
      m.emissive.setHex(0xffffff);
    }
    setTimeout(() => {
      if (this.disposed) return;
      for (const m of [this.mats.outfit, this.mats.sleeve, this.mats.team]) {
        m.emissive.setHex(0x000000);
      }
    }, 70);
  }

  /** Alive/disconnected visual state. */
  setStatus({ alive, connected }) {
    this.aliveVis = alive;
    this.connectedVis = connected;
    this.root.visible = alive && !this.fogged;
    this.applyOpacity();
  }

  /** Translucent while tucked inside a hiding bush. */
  setBushHidden(hidden) {
    if (this.bushHidden === hidden) return;
    this.bushHidden = hidden;
    this.applyOpacity();
  }

  applyOpacity() {
    const opacity = !this.connectedVis ? 0.35 : this.bushHidden ? 0.55 : 1;
    for (const m of Object.values(this.mats)) {
      if (m === this.mats.ring || m === this.mats.shadow) continue; // already transparent
      m.transparent = opacity < 1;
      m.opacity = opacity;
    }
  }

  /** Fog of war: hide without forgetting the player (they may reappear). */
  setFogged(fogged) {
    if (this.fogged === fogged) return;
    this.fogged = fogged;
    this.root.visible = this.aliveVis && !fogged;
  }

  /**
   * Walk-cycle animation driven by actual distance moved, so it works for
   * both the predicted local player and interpolated remotes. dt in seconds.
   */
  tickWalk(dt) {
    const dx = this.root.position.x - this.lastPos.x;
    const dz = this.root.position.z - this.lastPos.z;
    const dist = Math.hypot(dx, dz);
    this.lastPos.x = this.root.position.x;
    this.lastPos.z = this.root.position.z;

    if (dist > 0.15) {
      this.walkPhase += dist * 0.085;
      const swing = Math.sin(this.walkPhase) * 6;
      this.footL.position.x = -2 + swing;
      this.footR.position.x = -2 - swing;
      this.torsoGroup.position.y = Math.abs(Math.sin(this.walkPhase)) * 1.6;
    } else {
      const k = Math.min(1, 12 * dt);
      this.footL.position.x += (-2 - this.footL.position.x) * k;
      this.footR.position.x += (-2 - this.footR.position.x) * k;
      this.torsoGroup.position.y += (0 - this.torsoGroup.position.y) * k;
    }
  }

  /** Move remote player toward its snapshot target. dt in seconds. */
  interpolate(dt) {
    const k = 1 - Math.exp(-14 * dt);
    this.root.position.x += (this.target.x - this.root.position.x) * k;
    this.root.position.z += (this.target.y - this.root.position.z) * k;
    const delta = wrapAngle(-this.target.a - this.root.rotation.y);
    this.root.rotation.y += delta * Math.min(1, 12 * dt);
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.root);
    this.root.traverse((o) => o.geometry?.dispose());
    for (const m of Object.values(this.mats)) m.dispose();
    this.labelSprite.material.dispose();
    this.labelTex.dispose();
  }
}
