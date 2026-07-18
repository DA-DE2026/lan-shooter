// Hiding bushes + weapon loot tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, MAPS, WEAPONS, tileCenter } from '@lan-shooter/shared';
import { Match } from '../src/Match.js';

function makeFakeIO() {
  return {
    emitted: [],
    emit(event, data) { this.emitted.push({ event, data }); },
    last(event) {
      for (let i = this.emitted.length - 1; i >= 0; i--) {
        if (this.emitted[i].event === event) return this.emitted[i].data;
      }
      return undefined;
    },
  };
}

let socketSeq = 0;
function makeFakeSocket() {
  return {
    id: `sock-${++socketSeq}`,
    emitted: [],
    emit(event, data) { this.emitted.push({ event, data }); },
    disconnect() { this.disconnected = true; },
  };
}

function makeMatch() {
  const io = makeFakeIO();
  const clock = { t: 100000 };
  const match = new Match(io, { now: () => clock.t });
  return { io, clock, match };
}

function join(match, name) {
  const socket = makeFakeSocket();
  const token = `token-${name}-${Math.random().toString(36).slice(2, 10)}`;
  match.join(socket, { token, name });
  return { socket, token, player: match.bySocket.get(socket.id) };
}

test('maps define bush clusters', () => {
  for (const map of Object.values(MAPS)) {
    assert.ok(map.bushTiles.length >= 4, `${map.id} has hiding bushes`);
    // Bushes are walkable.
    for (const b of map.bushTiles) {
      assert.equal(map.solid[b.r][b.c], false);
    }
  }
});

test('bush hides an enemy: same cluster, point-blank, or firing reveals', () => {
  const { match, clock } = makeMatch();
  const host = join(match, 'Host');
  const b = join(match, 'Bob');
  match.startMatch(host.player);

  const map = match.map;
  const bushTile = map.bushTiles[0];
  const bushPos = tileCenter(bushTile.c, bushTile.r);
  const enemy = b.player;
  const viewer = host.player;
  assert.notEqual(enemy.team, viewer.team);

  // Enemy hides in the bush; viewer in the open nearby with clear LOS.
  enemy.x = bushPos.x;
  enemy.y = bushPos.y;
  viewer.x = bushPos.x - 192; // 3 tiles west, same open row
  viewer.y = bushPos.y;
  assert.equal(match.visibleIdsForTeam(viewer.team).has(enemy.id), false,
    'bushed enemy is hidden');

  // Point-blank: stepping right up to the bush reveals.
  viewer.x = bushPos.x - 50;
  assert.ok(match.visibleIdsForTeam(viewer.team).has(enemy.id),
    'point-blank range sees into the bush');

  // Firing reveals the hidden enemy for a moment.
  viewer.x = bushPos.x - 192;
  match.fire(enemy, { a: 0 });
  assert.ok(match.visibleIdsForTeam(viewer.team).has(enemy.id),
    'muzzle flash reveals');
  clock.t += 2000;
  assert.equal(match.visibleIdsForTeam(viewer.team).has(enemy.id), false,
    'reveal expires');

  // Same cluster: viewer inside the bush sees the enemy.
  viewer.x = bushPos.x + 40; // adjacent bush tile of the same 2-tile cluster
  viewer.y = bushPos.y;
  assert.ok(match.visibleIdsForTeam(viewer.team).has(enemy.id),
    'same bush cluster sees each other');
});

test('weapon crates spawn, get looted, and empty clips drop the weapon', () => {
  const { match, clock, io } = makeMatch();
  const host = join(match, 'Host');
  join(match, 'Bob');
  match.startMatch(host.player);

  // Force an immediate crate spawn.
  match.nextPickupAt = clock.t;
  clock.t += 40;
  match.tick(33);
  assert.equal(match.pickups.length, 1, 'crate spawned');
  const crate = io.last(MSG.PICKUP_SPAWN);
  assert.ok(WEAPONS[crate.w].loot, 'crate holds a loot weapon');

  // Walk the host onto it.
  const p = host.player;
  p.x = crate.x;
  p.y = crate.y;
  clock.t += 40;
  match.tick(33);
  assert.equal(match.pickups.length, 0, 'crate consumed');
  assert.equal(p.special, crate.w, 'loot weapon owned');
  assert.equal(p.weaponIndex, crate.w, 'auto-equipped');
  assert.equal(p.ammo[crate.w], WEAPONS[crate.w].magSize, 'full clip');
  assert.equal(io.last(MSG.PICKUP_TAKEN).byId, p.id);

  // Loot weapons cannot reload.
  match.fire(p, { a: 0 });
  match.reload(p);
  assert.equal(p.reloadUntil, 0, 'no reload for loot weapons');

  // Empty the clip: the weapon disappears and the rifle comes back out.
  let guard = 0;
  while (p.special >= 0 && guard++ < 60) {
    clock.t += WEAPONS[crate.w].fireDelayMs + 10;
    match.fire(p, { a: 0 });
  }
  assert.equal(p.special, -1, 'emptied loot weapon dropped');
  assert.equal(p.weaponIndex, 0, 'back to the rifle');
});

test('death loses the looted weapon', () => {
  const { match, clock } = makeMatch();
  const host = join(match, 'Host');
  join(match, 'Bob');
  match.startMatch(host.player);
  const p = host.player;
  p.special = 2;
  p.alive = false;
  clock.t = match.nextRespawnAt + 1;
  match.tick(16);
  assert.equal(p.alive, true);
  assert.equal(p.special, -1, 'loot gone after respawn');
});
