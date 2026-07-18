// Server-side player record. One instance per joined player, keyed by their
// persistent token so a dropped connection can reattach to the same record.

import { PLAYER_MAX_HP, WEAPONS } from '@lan-shooter/shared';

export class Player {
  constructor({ token, id, name, team, skin }) {
    this.token = token;   // secret, never sent to other clients
    this.id = id;         // public id derived from token
    this.name = name;
    this.team = team;     // team index (0-based)
    this.skin = skin;     // index into SKIN_COLORS

    this.socket = null;
    this.connected = false;
    this.disconnectedAt = 0;
    this.isBot = false;   // server-driven AI player (no socket)
    this.brain = null;    // AI state, managed by BotAI.js

    // Dynamic match state
    this.x = 0;
    this.y = 0;
    this.aim = 0;
    this.hp = PLAYER_MAX_HP;
    this.alive = false;
    this.weaponIndex = 0;
    this.ammo = WEAPONS.map((w) => w.magSize); // one clip counter per weapon
    this.reloadUntil = 0; // timestamp when current reload finishes (0 = not reloading)
    this.lastFireAt = 0;
    this.special = -1;     // looted weapon type index (-1 = none)
    this.revealUntil = 0;  // firing reveals a bush-hidden player until this time

    this.kills = 0;
    this.deaths = 0;
  }

  /** Reset combat state at match start / restart. */
  resetForMatch() {
    this.hp = PLAYER_MAX_HP;
    this.alive = true;
    this.weaponIndex = 0;
    this.ammo = WEAPONS.map((w) => w.magSize);
    this.reloadUntil = 0;
    this.lastFireAt = 0;
    this.special = -1;
    this.revealUntil = 0;
    this.kills = 0;
    this.deaths = 0;
  }

  /** Refill health/ammo on a respawn wave. Looted weapons are lost on death. */
  respawn(pos) {
    this.x = pos.x;
    this.y = pos.y;
    this.hp = PLAYER_MAX_HP;
    this.alive = true;
    this.weaponIndex = 0;
    this.ammo = WEAPONS.map((w) => w.magSize);
    this.reloadUntil = 0;
    this.special = -1;
    this.revealUntil = 0;
  }

  /** Roster entry: static-ish info shown in lobby lists. */
  toRoster() {
    return {
      id: this.id,
      name: this.name,
      team: this.team,
      skin: this.skin,
      connected: this.connected,
      isBot: this.isBot,
      kills: this.kills,
      deaths: this.deaths,
    };
  }

  /** Snapshot entry: dynamic per-tick state broadcast during a match. */
  toSnapshot() {
    return {
      id: this.id,
      x: Math.round(this.x),
      y: Math.round(this.y),
      a: Number(this.aim.toFixed(3)),
      hp: this.hp,
      alive: this.alive,
      conn: this.connected,
      team: this.team,
      w: this.weaponIndex,
      ammo: this.ammo[this.weaponIndex],
      rel: this.reloadUntil,
      sw: this.special,
      k: this.kills,
      d: this.deaths,
    };
  }
}
