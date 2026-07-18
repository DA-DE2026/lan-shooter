// Server-side bot AI. Bots are ordinary Player records driven each tick:
// they pick the nearest visible enemy, maneuver (approach / strafe / back
// off), fire through the same validated Match methods as humans (fire rate,
// ammo and reloads all enforced by the server), and wander between fights
// using BFS paths over the shared tile grid.

import {
  WEAPONS, PLAYER_SPEED, PLAYER_RADIUS, TILE,
  moveCircle, tileCenter, canSee,
} from '@lan-shooter/shared';
const CLOSE_RANGE = 190;     // switch to the scattergun inside this
const APPROACH_RANGE = 330;  // close distance until inside this, then strafe
const TURN_RATE = 5;         // rad/s aim tracking
const FIRE_CONE = 0.18;      // fire when aimed within this angle error
const SPEED_FACTOR = 0.92;   // bots run slightly slower than humans

export const BOT_NAMES = [
  'Raptor', 'Cobra', 'Jaguar', 'Mantis', 'Viper',
  'Ocelot', 'Basilisk', 'Piranha', 'Anaconda', 'Tarantula',
];

function freshBrain(bot) {
  return {
    path: [],          // BFS waypoints while wandering
    repathAt: 0,
    strafeDir: 1,
    strafeFlipAt: 0,
    aimNoise: 0,
    noiseAt: 0,
    lastX: bot.x,
    lastY: bot.y,
    stuckAt: 0,
  };
}

/** 4-directional BFS over the tile grid. Returns waypoint tiles (start excluded). */
function bfsPath(map, from, to) {
  if (from.c === to.c && from.r === to.r) return [];
  const key = (c, r) => r * map.cols + c;
  const prev = new Map([[key(from.c, from.r), null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.c === to.c && cur.r === to.r) {
      const path = [];
      for (let k = cur; k; k = prev.get(key(k.c, k.r))) path.push(k);
      path.reverse();
      path.shift();
      return path;
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (nc < 0 || nr < 0 || nc >= map.cols || nr >= map.rows) continue;
      if (map.solid[nr][nc]) continue;
      const k = key(nc, nr);
      if (prev.has(k)) continue;
      prev.set(k, cur);
      queue.push({ c: nc, r: nr });
    }
  }
  return [];
}

function randomFloorTile(map) {
  for (let i = 0; i < 50; i++) {
    const c = Math.floor(Math.random() * map.cols);
    const r = Math.floor(Math.random() * map.rows);
    if (!map.solid[r][c]) return { c, r };
  }
  return null;
}

function turnToward(bot, wantAim, maxTurn) {
  let diff = wantAim - bot.aim;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  bot.aim += Math.abs(diff) < maxTurn ? diff : Math.sign(diff) * maxTurn;
  return diff;
}

/** Advance all bots by one tick. Called from Match.tick while playing. */
export function updateBots(match, dtMs, now) {
  const dt = dtMs / 1000;
  const map = match.map;
  const players = [...match.players.values()];

  for (const bot of players) {
    if (!bot.isBot || !bot.alive) continue;
    if (!bot.brain) bot.brain = freshBrain(bot);
    const b = bot.brain;

    // --- perception: nearest visible enemy (same rules as human vision,
    // including hiding bushes) ---
    let target = null;
    let targetDist = Infinity;
    for (const p of players) {
      if (p.team === bot.team || !p.alive || !p.connected) continue;
      const d = Math.hypot(p.x - bot.x, p.y - bot.y);
      if (d < targetDist && canSee(map, bot, p, now)) {
        target = p;
        targetDist = d;
      }
    }

    let moveX = 0;
    let moveY = 0;

    if (target) {
      b.path = [];

      // Track the target with imperfect aim (refreshed noise = human wobble).
      if (now >= b.noiseAt) {
        b.aimNoise = (Math.random() - 0.5) * 0.12;
        b.noiseAt = now + 400;
      }
      const wantAim = Math.atan2(target.y - bot.y, target.x - bot.x) + b.aimNoise;
      const diff = turnToward(bot, wantAim, TURN_RATE * dt);

      // Looted weapon first while it lasts; else scattergun up close,
      // rifle at range.
      const wantWeapon = bot.special >= 0
        ? bot.special
        : (targetDist < CLOSE_RANGE ? 1 : 0);
      if (bot.weaponIndex !== wantWeapon && WEAPONS[wantWeapon]) {
        match.switchWeapon(bot, wantWeapon);
      }

      // Fire through the same validated path as human clients.
      if (Math.abs(diff) < FIRE_CONE) {
        if (bot.ammo[bot.weaponIndex] <= 0) match.reload(bot);
        else match.fire(bot, { a: bot.aim });
      }

      // Maneuver: close in, back off, or strafe around the target.
      if (now >= b.strafeFlipAt) {
        b.strafeDir = Math.random() < 0.5 ? -1 : 1;
        b.strafeFlipAt = now + 900 + Math.random() * 900;
      }
      const dirX = (target.x - bot.x) / targetDist;
      const dirY = (target.y - bot.y) / targetDist;
      if (targetDist > APPROACH_RANGE) {
        moveX = dirX;
        moveY = dirY;
      } else if (targetDist < CLOSE_RANGE * 0.7) {
        moveX = -dirX;
        moveY = -dirY;
      } else {
        moveX = -dirY * b.strafeDir;
        moveY = dirX * b.strafeDir;
      }
    } else {
      // --- no target: hunt toward an enemy's area, or wander ---
      if (!b.path.length || now >= b.repathAt) {
        b.repathAt = now + 6000 + Math.random() * 4000;
        const from = { c: Math.floor(bot.x / TILE), r: Math.floor(bot.y / TILE) };
        let dest = null;
        const enemies = players.filter((p) => p.team !== bot.team && p.alive && p.connected);
        if (enemies.length && Math.random() < 0.6) {
          const e = enemies[Math.floor(Math.random() * enemies.length)];
          const tile = { c: Math.floor(e.x / TILE), r: Math.floor(e.y / TILE) };
          if (!map.solid[tile.r]?.[tile.c]) dest = tile;
        }
        if (!dest) dest = randomFloorTile(map);
        b.path = dest ? bfsPath(map, from, dest) : [];
      }
      if (b.path.length) {
        const node = tileCenter(b.path[0].c, b.path[0].r);
        const d = Math.hypot(node.x - bot.x, node.y - bot.y);
        if (d < 10) {
          b.path.shift();
        } else {
          moveX = (node.x - bot.x) / d;
          moveY = (node.y - bot.y) / d;
          turnToward(bot, Math.atan2(moveY, moveX), 6 * dt);
        }
      }
    }

    if (moveX || moveY) {
      const len = Math.hypot(moveX, moveY);
      const step = PLAYER_SPEED * SPEED_FACTOR * dt;
      const moved = moveCircle(
        map, bot.x, bot.y,
        (moveX / len) * step, (moveY / len) * step, PLAYER_RADIUS,
      );
      bot.x = moved.x;
      bot.y = moved.y;
    }

    // Stuck detection: wanting to move but not getting anywhere -> repath.
    if (Math.hypot(bot.x - b.lastX, bot.y - b.lastY) > 3) {
      b.lastX = bot.x;
      b.lastY = bot.y;
      b.stuckAt = now;
    } else if ((moveX || moveY) && now - b.stuckAt > 800) {
      b.path = [];
      b.repathAt = 0;
      b.stuckAt = now;
    }
  }
}
