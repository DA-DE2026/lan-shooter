// Unit tests for the Match state machine, using fake sockets and a
// controllable clock — no real networking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, WEAPONS, PLAYER_MAX_HP, RESPAWN_WAVE_MS } from '@lan-shooter/shared';
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
    count(event) { return this.emitted.filter((e) => e.event === event).length; },
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

/** Match with a manual clock. clock.t is the current ms timestamp. */
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
  const player = match.bySocket.get(socket.id);
  return { socket, token, player };
}

test('players auto-balance across teams; first player is host', () => {
  const { match } = makeMatch();
  const a = join(match, 'Alice');
  const b = join(match, 'Bob');
  const c = join(match, 'Cara');
  assert.equal(match.isHost(a.player), true);
  assert.equal(a.player.team !== b.player.team, true, 'first two players split teams');
  assert.deepEqual([a, b, c].map((p) => p.player.team).sort(), [0, 0, 1].sort());
});

test('only the host can change settings or start the match', () => {
  const { match } = makeMatch();
  join(match, 'Host');
  const b = join(match, 'NotHost');
  match.setSettings(b.player, { scoreLimit: 99 });
  assert.equal(match.settings.scoreLimit, 25, 'non-host settings change ignored');
  match.startMatch(b.player);
  assert.equal(match.state, 'lobby', 'non-host cannot start');
});

test('switching to 3 teams moves to a 3-team map and back-fills teams', () => {
  const { match } = makeMatch();
  const host = join(match, 'Host');
  match.setSettings(host.player, { teamCount: 3 });
  assert.equal(match.settings.teamCount, 3);
  assert.ok(match.map.teams.includes(3), 'map supports 3 teams');
});

test('start match spawns everyone alive with full ammo', () => {
  const { match } = makeMatch();
  const host = join(match, 'Host');
  const b = join(match, 'Bob');
  match.startMatch(host.player);
  assert.equal(match.state, 'playing');
  for (const p of [host.player, b.player]) {
    assert.equal(p.alive, true);
    assert.equal(p.hp, PLAYER_MAX_HP);
    assert.equal(p.ammo[0], WEAPONS[0].magSize);
    assert.ok(p.x > 0 && p.y > 0, 'spawned at a position');
  }
});

test('firing consumes ammo, respects fire rate, and reload refills', () => {
  const { match, clock, io } = makeMatch();
  const host = join(match, 'Host');
  join(match, 'Bob');
  match.startMatch(host.player);
  const p = host.player;
  const w = WEAPONS[0];

  match.fire(p, { a: 0 });
  assert.equal(p.ammo[0], w.magSize - 1);
  assert.ok(io.last(MSG.PROJ_SPAWN), 'projectile spawn broadcast');

  match.fire(p, { a: 0 }); // immediate second shot blocked by fire delay
  assert.equal(p.ammo[0], w.magSize - 1);

  clock.t += w.fireDelayMs + 10;
  match.fire(p, { a: 0 });
  assert.equal(p.ammo[0], w.magSize - 2);

  match.reload(p);
  assert.ok(p.reloadUntil > clock.t);
  clock.t += w.reloadMs + 10;
  match.tick(16);
  assert.equal(p.ammo[0], w.magSize, 'clip refilled after reload');
});

test('projectile hits damage, kill, score, and respawn wave revives', () => {
  const { match, clock, io } = makeMatch();
  const host = join(match, 'Host');
  const b = join(match, 'Bob');
  match.startMatch(host.player);

  const shooter = host.player;
  const victim = b.player;
  assert.notEqual(shooter.team, victim.team);

  // Place them on open floor in a straight horizontal corridor.
  const TILE = 64;
  shooter.x = TILE * 1.5; shooter.y = TILE * 1.5;
  victim.x = TILE * 4.5; victim.y = TILE * 1.5;

  const shooterTeam = shooter.team;
  let guard = 0;
  while (victim.alive && guard++ < 200) {
    clock.t += WEAPONS[0].fireDelayMs + 5;
    match.fire(shooter, { a: 0 });
    match.tick(WEAPONS[0].fireDelayMs + 5);
  }

  assert.equal(victim.alive, false, 'victim died');
  assert.ok(shooter.kills >= 1);
  assert.equal(victim.deaths, 1);
  assert.ok(match.scores[shooterTeam] >= 1, 'team scored');
  assert.ok(io.last(MSG.KILL), 'kill broadcast');

  // Respawn wave revives the victim with full hp.
  clock.t = match.nextRespawnAt + 1;
  match.tick(16);
  assert.equal(victim.alive, true);
  assert.equal(victim.hp, PLAYER_MAX_HP);
});

test('score limit ends the match with a summary and MVP', () => {
  const { match, clock, io } = makeMatch();
  const host = join(match, 'Host');
  const b = join(match, 'Bob');
  match.setSettings(host.player, { scoreLimit: 1, timeLimitMin: 0 });
  match.startMatch(host.player);

  const shooter = host.player;
  const victim = b.player;
  const TILE = 64;
  shooter.x = TILE * 1.5; shooter.y = TILE * 1.5;
  victim.x = TILE * 4.5; victim.y = TILE * 1.5;

  let guard = 0;
  while (match.state === 'playing' && guard++ < 200) {
    clock.t += WEAPONS[0].fireDelayMs + 5;
    match.fire(shooter, { a: 0 });
    match.tick(WEAPONS[0].fireDelayMs + 5);
  }

  assert.equal(match.state, 'ended');
  const summary = io.last(MSG.MATCH_ENDED);
  assert.ok(summary);
  assert.equal(summary.reason, 'score');
  assert.deepEqual(summary.winners, [shooter.team]);
  assert.equal(summary.mvpId, shooter.id);

  // Host returns everyone to the lobby.
  match.toLobby(host.player);
  assert.equal(match.state, 'lobby');
});

test('time limit ends the match', () => {
  const { match, clock } = makeMatch();
  const host = join(match, 'Host');
  match.setSettings(host.player, { timeLimitMin: 1, scoreLimit: 0 });
  match.startMatch(host.player);
  clock.t += 61 * 1000;
  match.tick(16);
  assert.equal(match.state, 'ended');
});

test('disconnect during match keeps the player for reconnect', () => {
  const { match, clock } = makeMatch();
  const host = join(match, 'Host');
  const b = join(match, 'Bob');
  match.startMatch(host.player);

  match.onDisconnect(b.socket);
  assert.equal(match.players.has(b.token), true, 'player retained during grace');
  assert.equal(b.player.connected, false);

  // Rejoin with the same token reattaches to the same player record.
  const newSocket = makeFakeSocket();
  match.join(newSocket, { token: b.token, name: 'Bob' });
  const rejoined = match.bySocket.get(newSocket.id);
  assert.equal(rejoined, b.player, 'same player object');
  assert.equal(rejoined.connected, true);
  assert.ok(newSocket.emitted.some((e) => e.event === MSG.MATCH_STATE), 'rejoiner gets match state');

  // But a lobby disconnect removes the player immediately.
  match.state = 'lobby';
  match.onDisconnect(newSocket);
  assert.equal(match.players.has(b.token), false);
  clock.t += 1; // silence unused warning
});

test('grace expiry purges the disconnected player', () => {
  const { match, clock } = makeMatch();
  const host = join(match, 'Host');
  const b = join(match, 'Bob');
  match.startMatch(host.player);
  match.onDisconnect(b.socket);
  clock.t += 61 * 1000 + 60000; // beyond grace (and time limit disabled below)
  match.settings.timeLimitMin = 0;
  match.endsAt = 0;
  match.tick(16);
  assert.equal(match.players.has(b.token), false, 'purged after grace');
});

test('kicked players are removed and cannot rejoin until lobby reset', () => {
  const { match } = makeMatch();
  const host = join(match, 'Host');
  const b = join(match, 'Bob');
  match.kick(host.player, b.player.id);
  assert.equal(match.players.has(b.token), false);

  const s2 = makeFakeSocket();
  match.join(s2, { token: b.token, name: 'Bob' });
  assert.equal(match.players.has(b.token), false, 'kicked token blocked');
  assert.ok(s2.emitted.some((e) => e.event === MSG.KICKED));
});

test('fog of war: enemies hidden behind walls, visible in the open', () => {
  const { match } = makeMatch();
  const host = join(match, 'Host');
  const b = join(match, 'Bob');
  match.startMatch(host.player);

  const a = host.player;
  const enemy = b.player;
  const TILE = 64;

  // Same open corridor, close by: visible.
  a.x = TILE * 1.5; a.y = TILE * 1.5;
  enemy.x = TILE * 4.5; enemy.y = TILE * 1.5;
  assert.ok(match.visibleIdsForTeam(a.team).has(enemy.id), 'open corridor -> visible');

  // Move the enemy behind the border-adjacent wall block on the far side.
  enemy.x = TILE * 1.5; enemy.y = TILE * 17.5;
  assert.equal(match.visibleIdsForTeam(a.team).has(enemy.id), false,
    'across the map behind walls -> fogged');

  // Teammates are always included.
  assert.ok(match.visibleIdsForTeam(a.team).has(a.id));

  // Dead viewers grant no vision: kill the only viewer conceptually.
  a.alive = false;
  enemy.x = TILE * 4.5; enemy.y = TILE * 1.5;
  assert.equal(match.visibleIdsForTeam(a.team).has(enemy.id), false,
    'dead players see nothing');
});

test('snapshots are per-team filtered', () => {
  const { match } = makeMatch();
  const host = join(match, 'Host');
  const b = join(match, 'Bob');
  match.startMatch(host.player);

  const TILE = 64;
  // Put the two enemies out of sight of each other.
  host.player.x = TILE * 1.5; host.player.y = TILE * 1.5;
  b.player.x = TILE * 1.5; b.player.y = TILE * 17.5;

  match.broadcastSnapshot();
  const lastSnap = (socket) => {
    const snaps = socket.emitted.filter((e) => e.event === MSG.SNAPSHOT);
    return snaps[snaps.length - 1].data;
  };
  const hostSnap = lastSnap(host.socket);
  const bobSnap = lastSnap(b.socket);
  assert.equal(hostSnap.players.length, 1, 'host sees only own team');
  assert.equal(hostSnap.players[0].id, match.bySocket.get(host.socket.id).id);
  assert.equal(bobSnap.players.length, 1, 'bob sees only own team');
});

test('host leaving passes host to the next connected player', () => {
  const { match } = makeMatch();
  const host = join(match, 'Host');
  const b = join(match, 'Bob');
  match.onDisconnect(host.socket);
  assert.equal(match.isHost(b.player), true);
});
