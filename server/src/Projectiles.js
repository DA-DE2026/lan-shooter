// Server-authoritative projectile simulation. Projectiles are stepped in
// small substeps so fast shots can't tunnel through players or thin walls.

import { PLAYER_RADIUS, WEAPONS, pointHitsWall } from '@lan-shooter/shared';

const HIT_RADIUS = PLAYER_RADIUS + 3; // player circle + projectile size
const SUBSTEP_PX = 12;

export class Projectiles {
  constructor() {
    this.list = [];
    this.nextId = 1;
  }

  clear() {
    this.list = [];
  }

  /**
   * Spawn all pellets for one trigger pull.
   * Returns the spawn descriptors so the match can broadcast them.
   */
  spawnShot({ owner, weaponIndex, aim, now, rng = Math.random }) {
    const w = WEAPONS[weaponIndex];
    const shots = [];
    for (let i = 0; i < w.pellets; i++) {
      const angle = aim + (rng() - 0.5) * 2 * w.spread;
      const proj = {
        id: this.nextId++,
        ownerId: owner.id,
        team: owner.team,
        weaponIndex,
        x: owner.x + Math.cos(aim) * (PLAYER_RADIUS + 6),
        y: owner.y + Math.sin(aim) * (PLAYER_RADIUS + 6),
        vx: Math.cos(angle) * w.projSpeed,
        vy: Math.sin(angle) * w.projSpeed,
        dieAt: now + w.projTtlMs,
      };
      this.list.push(proj);
      shots.push({ id: proj.id, x: Math.round(proj.x), y: Math.round(proj.y), vx: Math.round(proj.vx), vy: Math.round(proj.vy), ttl: w.projTtlMs });
    }
    return shots;
  }

  /**
   * Advance all projectiles by dt (ms). Calls:
   *   onHit(proj, victimPlayer, damage) when an enemy is struck,
   *   onEnd(proj, reason) when a projectile is removed ('wall'|'hit'|'ttl').
   */
  step(dtMs, now, map, players, { onHit, onEnd }) {
    const survivors = [];
    outer: for (const p of this.list) {
      if (now >= p.dieAt) {
        onEnd(p, 'ttl');
        continue;
      }
      const dt = dtMs / 1000;
      const dist = Math.hypot(p.vx, p.vy) * dt;
      const steps = Math.max(1, Math.ceil(dist / SUBSTEP_PX));
      const sx = (p.vx * dt) / steps;
      const sy = (p.vy * dt) / steps;

      for (let s = 0; s < steps; s++) {
        p.x += sx;
        p.y += sy;
        if (pointHitsWall(map, p.x, p.y)) {
          onEnd(p, 'wall');
          continue outer;
        }
        for (const victim of players) {
          if (!victim.alive || !victim.connected) continue;
          if (victim.team === p.team) continue; // no friendly fire (includes owner)
          const dx = victim.x - p.x;
          const dy = victim.y - p.y;
          if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) {
            onHit(p, victim, WEAPONS[p.weaponIndex].damage);
            onEnd(p, 'hit');
            continue outer;
          }
        }
      }
      survivors.push(p);
    }
    this.list = survivors;
  }
}
