// Collision + spawn helpers used by both the client (predicted movement)
// and the server (projectile simulation). Keeping this shared guarantees
// both sides agree on where walls are.

import { TILE, VISION_RANGE, BUSH_PEEK_RANGE } from './constants.js';

/** Is the tile at column c, row r solid? Out-of-bounds counts as solid. */
export function isSolidTile(map, c, r) {
  if (r < 0 || r >= map.rows || c < 0 || c >= map.cols) return true;
  return map.solid[r][c];
}

/** Does a circle at world (x, y) with radius overlap any solid tile? */
export function circleHitsWall(map, x, y, radius) {
  const minC = Math.floor((x - radius) / TILE);
  const maxC = Math.floor((x + radius) / TILE);
  const minR = Math.floor((y - radius) / TILE);
  const maxR = Math.floor((y + radius) / TILE);
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (isSolidTile(map, c, r)) return true;
    }
  }
  return false;
}

/** Is the world point inside a solid tile? (used for projectiles) */
export function pointHitsWall(map, x, y) {
  return isSolidTile(map, Math.floor(x / TILE), Math.floor(y / TILE));
}

/**
 * Straight-line visibility between two points, sampled against the wall
 * grid. Used by server fog-of-war, bot perception and the client fog
 * renderer so all three always agree.
 */
export function lineOfSight(map, x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(dist / 16);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointHitsWall(map, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
  }
  return true;
}

/**
 * Move a circle by (dx, dy) with axis-separated wall sliding.
 * Returns the resolved { x, y }.
 */
export function moveCircle(map, x, y, dx, dy, radius) {
  let nx = x + dx;
  if (circleHitsWall(map, nx, y, radius)) nx = x;
  let ny = y + dy;
  if (circleHitsWall(map, nx, ny, radius)) ny = y;
  return { x: nx, y: ny };
}

/** Bush cluster id at a world point, or -1 when not in a bush. */
export function bushClusterAt(map, x, y) {
  const c = Math.floor(x / TILE);
  const r = Math.floor(y / TILE);
  if (r < 0 || r >= map.rows || c < 0 || c >= map.cols) return -1;
  return map.bushClusterId[r][c];
}

/**
 * The full "can this viewer see this target" rule: vision range, walls, and
 * hiding bushes (broken by shared cluster, point-blank range, or a recent
 * reveal such as firing). Used by server fog-of-war and bot perception.
 */
export function canSee(map, viewer, target, now, range = VISION_RANGE) {
  const dx = target.x - viewer.x;
  const dy = target.y - viewer.y;
  const d2 = dx * dx + dy * dy;
  if (d2 > range * range) return false;
  if (!lineOfSight(map, viewer.x, viewer.y, target.x, target.y)) return false;
  const targetBush = bushClusterAt(map, target.x, target.y);
  if (targetBush === -1) return true;
  if ((target.revealUntil ?? 0) > now) return true;
  if (bushClusterAt(map, viewer.x, viewer.y) === targetBush) return true;
  return d2 <= BUSH_PEEK_RANGE * BUSH_PEEK_RANGE;
}

/** World-pixel center of a tile. */
export function tileCenter(c, r) {
  return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
}

/** Pick a spawn point (tile center) for a team. rng defaults to Math.random. */
export function randomSpawn(map, teamIndex, rng = Math.random) {
  const options = map.spawns[teamIndex];
  const pick = options[Math.floor(rng() * options.length)];
  return tileCenter(pick.c, pick.r);
}
