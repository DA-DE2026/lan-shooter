// Sanity checks for the shared map data + collision helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAPS, TILE, mapsForTeamCount, moveCircle, circleHitsWall, pointHitsWall,
  randomSpawn, PLAYER_RADIUS,
} from '@lan-shooter/shared';

test('all maps parse with consistent rows and spawns', () => {
  assert.ok(Object.keys(MAPS).length >= 2, 'expected at least two maps');
  for (const map of Object.values(MAPS)) {
    assert.ok(map.cols > 10 && map.rows > 10);
    for (const teamCount of map.teams) {
      for (let t = 0; t < teamCount; t++) {
        assert.ok(map.spawns[t].length > 0, `${map.id}: team ${t} has spawns`);
      }
    }
  }
});

test('there are maps for both 2-team and 3-team play', () => {
  assert.ok(mapsForTeamCount(2).length >= 1);
  assert.ok(mapsForTeamCount(3).length >= 1);
});

test('spawn tiles are walkable', () => {
  for (const map of Object.values(MAPS)) {
    for (let t = 0; t < 3; t++) {
      for (let i = 0; i < 20; i++) {
        if (!map.spawns[t].length) continue;
        const pos = randomSpawn(map, t);
        assert.equal(circleHitsWall(map, pos.x, pos.y, PLAYER_RADIUS), false);
      }
    }
  }
});

test('walls block movement, open floor does not', () => {
  const map = MAPS.ruins;
  // Center of tile (1,1) — a spawn tile next to the border wall.
  const start = { x: TILE * 1.5, y: TILE * 1.5 };
  // Pushing left into the border wall: x should not change.
  const blocked = moveCircle(map, start.x, start.y, -TILE, 0, PLAYER_RADIUS);
  assert.ok(blocked.x >= TILE + PLAYER_RADIUS - 1, 'wall stops leftward movement');
  // Moving right along open floor: x advances.
  const open = moveCircle(map, start.x, start.y, 20, 0, PLAYER_RADIUS);
  assert.equal(open.x, start.x + 20);
});

test('pointHitsWall detects walls and out-of-bounds', () => {
  const map = MAPS.ruins;
  assert.equal(pointHitsWall(map, 5, 5), true);          // border wall
  assert.equal(pointHitsWall(map, TILE * 1.5, TILE * 1.5), false); // floor
  assert.equal(pointHitsWall(map, -50, -50), true);      // out of bounds
});
