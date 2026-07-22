// The Match owns all authoritative game state for this server: the lobby
// roster, match settings, combat simulation, scores and the state machine
// lobby -> playing -> ended -> lobby.
//
// One server process hosts one match (a LAN party). All Socket.IO wiring
// lives in attachSocket(); the handler methods below are plain functions so
// they can be unit-tested without real sockets.

import { randomUUID } from 'node:crypto';
import {
  MSG, MAPS, mapList, mapsForTeamCount, WEAPONS, TEAM_PRESETS, TEAM_COLOR_CHOICES,
  SKIN_COLORS, MAX_TEAM_SIZE, MIN_TEAMS, MAX_TEAMS, TICK_RATE, SNAPSHOT_RATE,
  RESPAWN_WAVE_MS, RECONNECT_GRACE_MS, CHAT_MAX_LEN, BUSH_REVEAL_MS,
  PICKUP_INTERVAL_MS, MAX_PICKUPS, PICKUP_RADIUS, LOOT_WEAPONS,
  randomSpawn, canSee, tileCenter,
} from '@lan-shooter/shared';
import { Player } from './Player.js';
import { Projectiles } from './Projectiles.js';
import { updateBots, BOT_NAMES } from './BotAI.js';

export class Match {
  constructor(io, { now = () => Date.now() } = {}) {
    this.io = io;
    this.now = now;

    this.state = 'lobby'; // 'lobby' | 'playing' | 'ended'
    this.players = new Map();  // token -> Player
    this.bySocket = new Map(); // socket.id -> Player
    this.hostToken = null;
    this.kickedTokens = new Set(); // blocked until host returns to lobby
    this.botSeq = 0;

    this.settings = {
      teamCount: 2,
      teamNames: TEAM_PRESETS.map((t) => t.name),
      teamColors: TEAM_PRESETS.map((t) => t.color),
      scoreLimit: 25,     // 0 = no score limit
      timeLimitMin: 10,   // 0 = no time limit
      mapId: 'ruins',
    };

    this.map = MAPS[this.settings.mapId];
    this.scores = [0, 0, 0];
    this.endsAt = 0;
    this.nextRespawnAt = 0;
    this.projectiles = new Projectiles();
    this.lastSummary = null;
    this.pickups = [];      // live weapon crates: { id, x, y, w }
    this.pickupSeq = 1;
    this.nextPickupAt = 0;

    this._tickTimer = null;
    this._snapTimer = null;
    this._lastTickAt = 0;
  }

  /** Start the simulation + snapshot loops (not used by unit tests). */
  start() {
    this._lastTickAt = this.now();
    this._tickTimer = setInterval(() => {
      const t = this.now();
      this.tick(t - this._lastTickAt);
      this._lastTickAt = t;
    }, 1000 / TICK_RATE);
    this._snapTimer = setInterval(() => this.broadcastSnapshot(), 1000 / SNAPSHOT_RATE);
  }

  stop() {
    clearInterval(this._tickTimer);
    clearInterval(this._snapTimer);
  }

  // ---------------------------------------------------------------- wiring

  attachSocket(socket) {
    socket.on(MSG.JOIN, (data) => this.join(socket, data || {}));
    socket.on('disconnect', () => this.onDisconnect(socket));

    const withPlayer = (fn) => (data) => {
      const player = this.bySocket.get(socket.id);
      if (player) fn(player, data);
    };

    socket.on(MSG.SET_TEAM, withPlayer((p, d) => this.setTeam(p, d)));
    socket.on(MSG.SET_SKIN, withPlayer((p, d) => this.setSkin(p, d)));
    socket.on(MSG.SET_SETTINGS, withPlayer((p, d) => this.setSettings(p, d || {})));
    socket.on(MSG.ADD_BOT, withPlayer((p) => this.addBot(p)));
    socket.on(MSG.START_MATCH, withPlayer((p) => this.startMatch(p)));
    socket.on(MSG.RESTART_MATCH, withPlayer((p) => this.restartMatch(p)));
    socket.on(MSG.END_MATCH, withPlayer((p) => this.endMatchEarly(p)));
    socket.on(MSG.TO_LOBBY, withPlayer((p) => this.toLobby(p)));
    socket.on(MSG.KICK, withPlayer((p, d) => this.kick(p, d)));
    socket.on(MSG.MOVE, withPlayer((p, d) => this.move(p, d || {})));
    socket.on(MSG.FIRE, withPlayer((p, d) => this.fire(p, d || {})));
    socket.on(MSG.RELOAD, withPlayer((p) => this.reload(p)));
    socket.on(MSG.SWITCH_WEAPON, withPlayer((p, d) => this.switchWeapon(p, d)));
    socket.on(MSG.CHAT, withPlayer((p, d) => this.chat(p, d)));
    socket.on(MSG.PING_MAP, withPlayer((p, d) => this.pingMap(p, d || {})));
  }

  // ------------------------------------------------------------- join/leave

  join(socket, { token, name }) {
    if (typeof token !== 'string' || token.length < 8) {
      socket.emit(MSG.ERROR_MSG, 'Invalid session token.');
      return;
    }
    if (this.kickedTokens.has(token)) {
      socket.emit(MSG.KICKED, 'You were kicked from this match.');
      setTimeout(() => socket.disconnect(true), 100); // let the packet flush
      return;
    }

    const cleanName = String(name ?? '').trim().slice(0, 16) || 'Player';
    let player = this.players.get(token);

    if (player) {
      // Reconnect (or a fresh page load from the same browser).
      if (player.socket && player.socket.id !== socket.id) {
        player.socket.disconnect(true); // drop stale connection
        this.bySocket.delete(player.socket.id);
      }
      player.socket = socket;
      player.connected = true;
      player.disconnectedAt = 0;
      if (this.state === 'lobby') player.name = cleanName;
    } else {
      player = new Player({
        token,
        id: this.uniquePlayerId(),
        name: cleanName,
        team: this.smallestTeam(),
        skin: this.players.size % SKIN_COLORS.length,
      });
      player.socket = socket;
      player.connected = true;
      this.players.set(token, player);

      if (this.state === 'playing') {
        // Mid-match joiner: enters dead and spawns with the next wave.
        const pos = randomSpawn(this.map, player.team);
        player.x = pos.x;
        player.y = pos.y;
        player.alive = false;
      }
    }

    this.bySocket.set(socket.id, player);
    if (!this.hostToken || !this.players.has(this.hostToken)) {
      this.hostToken = player.token;
    }

    socket.emit(MSG.JOINED, { selfId: player.id });
    if (this.state === 'playing' || this.state === 'ended') {
      socket.emit(MSG.MATCH_STATE, this.matchStatePayload(player.team));
      if (this.state === 'ended' && this.lastSummary) {
        socket.emit(MSG.MATCH_ENDED, this.lastSummary);
      }
    }
    this.broadcastLobby();
  }

  onDisconnect(socket) {
    const player = this.bySocket.get(socket.id);
    if (!player) return;
    this.bySocket.delete(socket.id);
    if (player.socket === socket) {
      player.socket = null;
      player.connected = false;
      player.disconnectedAt = this.now();
    }
    if (this.state === 'lobby') {
      // No grace period needed in lobby — just drop them.
      this.players.delete(player.token);
    }
    this.reassignHostIfNeeded();
    this.dropBotsIfNoHumans();
    this.broadcastLobby();
  }

  /** Random open floor position (crate drops). */
  randomFloorPos() {
    for (let i = 0; i < 50; i++) {
      const c = Math.floor(Math.random() * this.map.cols);
      const r = Math.floor(Math.random() * this.map.rows);
      if (this.map.solid[r][c]) continue;
      const center = tileCenter(c, r);
      return {
        x: center.x + Math.floor(Math.random() * 25) - 12,
        y: center.y + Math.floor(Math.random() * 25) - 12,
      };
    }
    return null;
  }

  /** Short public id, guaranteed unique within this match (tokens stay secret). */
  uniquePlayerId() {
    let id;
    do {
      id = randomUUID().slice(0, 8);
    } while ([...this.players.values()].some((p) => p.id === id));
    return id;
  }

  reassignHostIfNeeded() {
    const host = this.players.get(this.hostToken);
    if (host && host.connected && !host.isBot) return;
    const next = [...this.players.values()].find((p) => p.connected && !p.isBot);
    this.hostToken = next ? next.token : null;
  }

  /** With no humans left there is nobody to host or watch — clear the bots. */
  dropBotsIfNoHumans() {
    if ([...this.players.values()].some((p) => !p.isBot)) return;
    for (const p of [...this.players.values()]) {
      if (p.isBot) this.players.delete(p.token);
    }
    if (this.state !== 'lobby') this.state = 'lobby';
  }

  /** Team index with the fewest members (respecting current teamCount). */
  smallestTeam() {
    const counts = new Array(this.settings.teamCount).fill(0);
    for (const p of this.players.values()) {
      if (p.team < counts.length) counts[p.team]++;
    }
    let best = 0;
    for (let i = 1; i < counts.length; i++) {
      if (counts[i] < counts[best]) best = i;
    }
    return best;
  }

  // ----------------------------------------------------------- lobby actions

  isHost(player) {
    return player.token === this.hostToken;
  }

  setTeam(player, teamIndex) {
    if (this.state !== 'lobby') return this.err(player, 'Teams can only be changed in the lobby.');
    const t = Number(teamIndex);
    if (!Number.isInteger(t) || t < 0 || t >= this.settings.teamCount) return;
    const count = [...this.players.values()].filter((p) => p.team === t).length;
    if (count >= MAX_TEAM_SIZE) return this.err(player, 'That team is full.');
    player.team = t;
    this.broadcastLobby();
  }

  setSkin(player, skinIndex) {
    const s = Number(skinIndex);
    if (!Number.isInteger(s) || s < 0 || s >= SKIN_COLORS.length) return;
    player.skin = s;
    this.broadcastLobby();
  }

  setSettings(player, patch) {
    if (!this.isHost(player)) return this.err(player, 'Only the host can change settings.');
    if (this.state !== 'lobby') return this.err(player, 'Settings can only be changed in the lobby.');
    const s = this.settings;

    if (patch.teamCount !== undefined) {
      const tc = Number(patch.teamCount);
      if (Number.isInteger(tc) && tc >= MIN_TEAMS && tc <= MAX_TEAMS) {
        s.teamCount = tc;
        // If the current map doesn't support this team count, switch maps.
        if (!MAPS[s.mapId].teams.includes(tc)) {
          s.mapId = mapsForTeamCount(tc)[0].id;
        }
        // Move players stranded on a removed team.
        for (const p of this.players.values()) {
          if (p.team >= tc) p.team = this.smallestTeam();
        }
      }
    }
    if (Array.isArray(patch.teamNames)) {
      patch.teamNames.forEach((n, i) => {
        if (i < MAX_TEAMS && typeof n === 'string' && n.trim()) {
          s.teamNames[i] = n.trim().slice(0, 12);
        }
      });
    }
    if (Array.isArray(patch.teamColors)) {
      patch.teamColors.forEach((c, i) => {
        if (i < MAX_TEAMS && TEAM_COLOR_CHOICES.includes(Number(c))) {
          s.teamColors[i] = Number(c);
        }
      });
    }
    if (patch.scoreLimit !== undefined) {
      const v = Number(patch.scoreLimit);
      if (Number.isInteger(v) && v >= 0 && v <= 500) s.scoreLimit = v;
    }
    if (patch.timeLimitMin !== undefined) {
      const v = Number(patch.timeLimitMin);
      if (Number.isInteger(v) && v >= 0 && v <= 180) s.timeLimitMin = v;
    }
    if (patch.mapId !== undefined && MAPS[patch.mapId]?.teams.includes(s.teamCount)) {
      s.mapId = patch.mapId;
    }

    this.map = MAPS[s.mapId];
    this.broadcastLobby();
  }

  kick(player, targetId) {
    if (!this.isHost(player)) return this.err(player, 'Only the host can kick players.');
    const target = [...this.players.values()].find((p) => p.id === targetId);
    if (!target || target === player) return;
    this.kickedTokens.add(target.token);
    if (target.socket) {
      const sock = target.socket;
      sock.emit(MSG.KICKED, 'You were kicked by the host.');
      setTimeout(() => sock.disconnect(true), 100); // let the packet flush
      this.bySocket.delete(sock.id);
    }
    this.players.delete(target.token);
    this.broadcastLobby();
  }

  /** Host adds an AI player. Works in the lobby and mid-match. */
  addBot(requester) {
    if (!this.isHost(requester)) return this.err(requester, 'Only the host can add bots.');
    if (this.players.size >= this.settings.teamCount * MAX_TEAM_SIZE) {
      return this.err(requester, 'All teams are full.');
    }
    this.botSeq++;
    const inUse = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !inUse.has(n)) ?? `Bot ${this.botSeq}`;
    const bot = new Player({
      token: `bot-${this.botSeq}-${Math.random().toString(36).slice(2, 8)}`,
      id: this.uniquePlayerId(),
      name,
      team: this.smallestTeam(),
      skin: this.players.size % SKIN_COLORS.length,
    });
    bot.isBot = true;
    bot.connected = true;
    const pos = randomSpawn(this.map, bot.team);
    bot.x = pos.x;
    bot.y = pos.y;
    bot.alive = false; // spawns with the next wave if a match is running
    this.players.set(bot.token, bot);
    this.broadcastLobby();
  }

  // ----------------------------------------------------------- match control

  startMatch(player) {
    if (!this.isHost(player)) return this.err(player, 'Only the host can start the match.');
    if (this.state !== 'lobby') return;
    this.beginMatch();
  }

  restartMatch(player) {
    if (!this.isHost(player)) return this.err(player, 'Only the host can restart the match.');
    if (this.state === 'lobby') return;
    this.beginMatch();
  }

  beginMatch() {
    const t = this.now();
    this.map = MAPS[this.settings.mapId];
    this.scores = [0, 0, 0];
    this.projectiles.clear();
    this.lastSummary = null;

    for (const p of this.players.values()) {
      if (p.team >= this.settings.teamCount) p.team = this.smallestTeam();
      p.resetForMatch();
      const pos = randomSpawn(this.map, p.team);
      p.x = pos.x;
      p.y = pos.y;
    }

    this.endsAt = this.settings.timeLimitMin > 0 ? t + this.settings.timeLimitMin * 60000 : 0;
    this.nextRespawnAt = t + RESPAWN_WAVE_MS;
    this.pickups = [];
    this.nextPickupAt = t + PICKUP_INTERVAL_MS / 2; // first crate lands early
    this.state = 'playing';
    // Fog of war: each player only receives what their team can see.
    const payloads = new Map();
    for (const p of this.players.values()) {
      if (!p.socket) continue;
      if (!payloads.has(p.team)) payloads.set(p.team, this.matchStatePayload(p.team));
      p.socket.emit(MSG.MATCH_STATE, payloads.get(p.team));
    }
    this.broadcastLobby();
  }

  endMatchEarly(player) {
    if (!this.isHost(player)) return this.err(player, 'Only the host can end the match.');
    if (this.state !== 'playing') return;
    this.endMatch('host');
  }

  endMatch(reason) {
    this.state = 'ended';
    this.projectiles.clear();

    const best = Math.max(...this.scores.slice(0, this.settings.teamCount));
    const winners = [];
    for (let i = 0; i < this.settings.teamCount; i++) {
      if (this.scores[i] === best) winners.push(i);
    }

    const roster = [...this.players.values()];
    let mvp = null;
    for (const p of roster) {
      if (!mvp || p.kills > mvp.kills || (p.kills === mvp.kills && p.deaths < mvp.deaths)) {
        mvp = p;
      }
    }

    this.lastSummary = {
      reason, // 'score' | 'time' | 'host'
      scores: this.scores.slice(0, this.settings.teamCount),
      winners,
      mvpId: mvp ? mvp.id : null,
      players: roster.map((p) => ({
        id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths,
      })),
    };
    this.io.emit(MSG.MATCH_ENDED, this.lastSummary);
  }

  toLobby(player) {
    if (!this.isHost(player)) return this.err(player, 'Only the host can return everyone to the lobby.');
    if (this.state !== 'ended') return;
    this.state = 'lobby';
    this.kickedTokens.clear();
    // Drop players who never reconnected during the match.
    for (const p of [...this.players.values()]) {
      if (!p.connected) this.players.delete(p.token);
    }
    this.reassignHostIfNeeded();
    this.broadcastLobby();
  }

  // -------------------------------------------------------------- gameplay

  move(player, { x, y, a }) {
    if (this.state !== 'playing' || !player.alive) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(a)) return;
    player.x = Math.min(Math.max(x, 0), this.map.widthPx);
    player.y = Math.min(Math.max(y, 0), this.map.heightPx);
    player.aim = a;
  }

  fire(player, { a }) {
    if (this.state !== 'playing' || !player.alive) return;
    if (!Number.isFinite(a)) return;
    const t = this.now();
    const w = WEAPONS[player.weaponIndex];
    if (player.reloadUntil > t) return;                       // reloading
    if (t - player.lastFireAt < w.fireDelayMs * 0.85) return; // rate limit (15% jitter tolerance)
    if (player.ammo[player.weaponIndex] <= 0) return;         // empty clip

    player.ammo[player.weaponIndex]--;
    player.lastFireAt = t;
    player.aim = a;
    player.revealUntil = t + BUSH_REVEAL_MS; // muzzle flash breaks bush stealth

    const shots = this.projectiles.spawnShot({
      owner: player, weaponIndex: player.weaponIndex, aim: a, now: t,
    });
    this.io.emit(MSG.PROJ_SPAWN, {
      ownerId: player.id, team: player.team, w: player.weaponIndex, shots,
    });

    // Loot weapons have no reload: an emptied clip discards the weapon.
    if (w.loot && player.ammo[player.weaponIndex] <= 0) {
      player.special = -1;
      player.weaponIndex = 0;
    }
  }

  reload(player) {
    if (this.state !== 'playing' || !player.alive) return;
    const t = this.now();
    const w = WEAPONS[player.weaponIndex];
    if (w.loot) return; // loot weapons never reload — one clip and gone
    if (player.reloadUntil > t) return;
    if (player.ammo[player.weaponIndex] >= w.magSize) return;
    player.reloadUntil = t + w.reloadMs;
  }

  switchWeapon(player, weaponIndex) {
    if (this.state !== 'playing' || !player.alive) return;
    const i = Number(weaponIndex);
    if (!Number.isInteger(i) || i < 0 || i >= WEAPONS.length) return;
    // Only the starting loadout plus a currently-held looted weapon.
    if (WEAPONS[i].loot && i !== player.special) return;
    if (i === player.weaponIndex) return;
    player.weaponIndex = i;
    player.reloadUntil = 0; // switching cancels a reload (clip not refilled)
  }

  chat(player, text) {
    const msg = String(text ?? '').trim().slice(0, CHAT_MAX_LEN);
    if (!msg) return;
    this.io.emit(MSG.CHAT_MSG, {
      fromId: player.id, name: player.name, team: player.team, text: msg, ts: this.now(),
    });
  }

  pingMap(player, { x, y }) {
    if (this.state !== 'playing') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const mark = {
      fromId: player.id,
      name: player.name,
      team: player.team,
      x: Math.min(Math.max(x, 0), this.map.widthPx),
      y: Math.min(Math.max(y, 0), this.map.heightPx),
    };
    // Pings are tactical info: teammates only.
    for (const p of this.players.values()) {
      if (p.team === player.team && p.socket) p.socket.emit(MSG.PING_MARK, mark);
    }
  }

  // ------------------------------------------------------------- simulation

  /** Advance the simulation by dtMs. Called from the interval loop or tests. */
  tick(dtMs) {
    const t = this.now();

    if (this.state === 'playing') {
      updateBots(this, dtMs, t);

      this.projectiles.step(dtMs, t, this.map, [...this.players.values()], {
        onHit: (proj, victim, damage) => this.applyHit(proj, victim, damage),
        onEnd: (proj, reason) => {
          if (reason !== 'ttl') {
            this.io.emit(MSG.PROJ_END, { id: proj.id, x: Math.round(proj.x), y: Math.round(proj.y), reason });
          }
        },
      });

      // Finish reloads.
      for (const p of this.players.values()) {
        if (p.reloadUntil > 0 && t >= p.reloadUntil) {
          p.ammo[p.weaponIndex] = WEAPONS[p.weaponIndex].magSize;
          p.reloadUntil = 0;
        }
      }

      // Weapon crates: spawn on a timer, grab by walking over them.
      if (this.pickups.length < MAX_PICKUPS && t >= this.nextPickupAt) {
        this.nextPickupAt = t + PICKUP_INTERVAL_MS;
        const spot = this.randomFloorPos();
        if (spot) {
          const pickup = {
            id: this.pickupSeq++,
            x: spot.x,
            y: spot.y,
            w: LOOT_WEAPONS[Math.floor(Math.random() * LOOT_WEAPONS.length)],
          };
          this.pickups.push(pickup);
          this.io.emit(MSG.PICKUP_SPAWN, pickup);
        }
      }
      for (const pickup of [...this.pickups]) {
        for (const p of this.players.values()) {
          if (!p.alive || !p.connected) continue;
          const dx = p.x - pickup.x;
          const dy = p.y - pickup.y;
          if (dx * dx + dy * dy > PICKUP_RADIUS * PICKUP_RADIUS) continue;
          p.special = pickup.w;
          p.ammo[pickup.w] = WEAPONS[pickup.w].magSize;
          p.weaponIndex = pickup.w; // draw the new toy immediately
          p.reloadUntil = 0;
          this.pickups = this.pickups.filter((x) => x.id !== pickup.id);
          this.io.emit(MSG.PICKUP_TAKEN, { id: pickup.id, byId: p.id, w: pickup.w });
          break;
        }
      }

      // Respawn wave: everyone dead comes back together.
      if (t >= this.nextRespawnAt) {
        for (const p of this.players.values()) {
          if (!p.alive) p.respawn(randomSpawn(this.map, p.team));
        }
        this.nextRespawnAt = t + RESPAWN_WAVE_MS;
      }

      // Time limit.
      if (this.state === 'playing' && this.endsAt > 0 && t >= this.endsAt) {
        this.endMatch('time');
      }
    }

    // Purge players whose reconnect grace expired (any state but lobby;
    // lobby disconnects are removed immediately).
    let purged = false;
    for (const p of [...this.players.values()]) {
      if (!p.connected && p.disconnectedAt > 0 && t - p.disconnectedAt > RECONNECT_GRACE_MS) {
        this.players.delete(p.token);
        purged = true;
      }
    }
    if (purged) {
      this.reassignHostIfNeeded();
      this.dropBotsIfNoHumans();
      this.broadcastLobby();
    }
  }

  applyHit(proj, victim, damage) {
    victim.hp = Math.max(0, victim.hp - damage);
    this.io.emit(MSG.HIT, { victimId: victim.id, hp: victim.hp, x: Math.round(proj.x), y: Math.round(proj.y) });
    if (victim.hp > 0) return;

    victim.alive = false;
    victim.deaths++;
    const killer = [...this.players.values()].find((p) => p.id === proj.ownerId);
    if (killer) killer.kills++;
    this.scores[proj.team]++;
    this.io.emit(MSG.KILL, { killerId: proj.ownerId, victimId: victim.id });

    if (this.settings.scoreLimit > 0 && this.scores[proj.team] >= this.settings.scoreLimit) {
      this.endMatch('score');
    }
  }

  // ------------------------------------------------------------ broadcasts

  lobbyPayload() {
    return {
      state: this.state,
      hostId: this.players.get(this.hostToken)?.id ?? null,
      settings: this.settings,
      maps: mapList(),
      players: [...this.players.values()].map((p) => p.toRoster()),
    };
  }

  /**
   * Fog of war: the set of player ids a team can see — all teammates, plus
   * enemies within VISION_RANGE and line of sight of a living teammate.
   */
  visibleIdsForTeam(team) {
    const ids = new Set();
    const t = this.now();
    const viewers = [...this.players.values()]
      .filter((p) => p.team === team && p.alive && p.connected);
    for (const p of this.players.values()) {
      if (p.team === team) {
        ids.add(p.id);
        continue;
      }
      // Range + walls + hiding bushes, all in the shared canSee rule.
      if (viewers.some((v) => canSee(this.map, v, p, t))) ids.add(p.id);
    }
    return ids;
  }

  /** Full match bootstrap. viewerTeam filters enemies to that team's vision. */
  matchStatePayload(viewerTeam = null) {
    let players = [...this.players.values()];
    if (viewerTeam !== null) {
      const vis = this.visibleIdsForTeam(viewerTeam);
      players = players.filter((p) => vis.has(p.id));
    }
    return {
      settings: this.settings,
      hostId: this.players.get(this.hostToken)?.id ?? null,
      scores: this.scores.slice(0, this.settings.teamCount),
      endsAt: this.endsAt,
      nextRespawnAt: this.nextRespawnAt,
      serverNow: this.now(),
      pickups: this.pickups,
      players: players.map((p) => ({ ...p.toRoster(), ...p.toSnapshot() })),
    };
  }

  broadcastLobby() {
    this.io.emit(MSG.LOBBY, this.lobbyPayload());
  }

  broadcastSnapshot() {
    if (this.state !== 'playing') return;
    const base = {
      t: this.now(),
      scores: this.scores.slice(0, this.settings.teamCount),
      endsAt: this.endsAt,
      nextRespawnAt: this.nextRespawnAt,
    };
    // One filtered payload per team; each connected player gets their team's.
    const payloads = new Map();
    for (const p of this.players.values()) {
      if (!p.socket) continue;
      if (!payloads.has(p.team)) {
        const vis = this.visibleIdsForTeam(p.team);
        payloads.set(p.team, {
          ...base,
          players: [...this.players.values()]
            .filter((q) => vis.has(q.id))
            .map((q) => q.toSnapshot()),
        });
      }
      p.socket.emit(MSG.SNAPSHOT, payloads.get(p.team));
    }
  }

  err(player, message) {
    player.socket?.emit(MSG.ERROR_MSG, message);
  }
}
