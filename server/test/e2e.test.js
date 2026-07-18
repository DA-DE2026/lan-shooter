// End-to-end smoke test: boots the real HTTP + Socket.IO server and drives
// two real socket.io clients through join -> lobby -> match -> kill -> chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { MSG, WEAPONS, TILE } from '@lan-shooter/shared';
import { createGameServer } from '../src/index.js';

function waitFor(socket, event, predicate = () => true, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function handler(data) {
      if (predicate(data)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(data);
      }
    }
    socket.on(event, handler);
  });
}

test('full flow: two clients join, fight, chat, and finish a kill', async () => {
  const server = createGameServer();
  const port = await server.listen(0);
  const url = `http://127.0.0.1:${port}`;

  const alice = ioc(url, { transports: ['websocket'] });
  const bob = ioc(url, { transports: ['websocket'] });

  try {
    // --- join ---
    alice.emit(MSG.JOIN, { token: 'e2e-token-alice-1', name: 'Alice' });
    const aJoin = await waitFor(alice, MSG.JOINED);
    bob.emit(MSG.JOIN, { token: 'e2e-token-bob-22', name: 'Bob' });
    const bJoin = await waitFor(bob, MSG.JOINED);
    assert.ok(aJoin.selfId && bJoin.selfId);

    const lobby = await waitFor(alice, MSG.LOBBY, (l) => l.players.length === 2);
    assert.equal(lobby.hostId, aJoin.selfId, 'first joiner is host');
    const teams = lobby.players.map((p) => p.team).sort();
    assert.deepEqual(teams, [0, 1], 'auto-balanced onto opposite teams');

    // --- start match ---
    alice.emit(MSG.START_MATCH);
    const ms = await waitFor(bob, MSG.MATCH_STATE);
    // Fog of war: enemies spawn on opposite sides of the map, far out of
    // vision — Bob's bootstrap contains his own team only.
    assert.ok(ms.players.some((p) => p.id === bJoin.selfId), 'bob sees himself');
    assert.equal(ms.players.some((p) => p.id === aJoin.selfId), false,
      'enemy is fogged at spawn');
    assert.ok(ms.players.every((p) => p.alive));

    // --- position both players in the open top corridor of Temple Ruins ---
    alice.emit(MSG.MOVE, { x: TILE * 1.5, y: TILE * 1.5, a: 0 });
    bob.emit(MSG.MOVE, { x: TILE * 5.5, y: TILE * 1.5, a: Math.PI });
    await waitFor(alice, MSG.SNAPSHOT, (s) =>
      s.players.some((p) => p.id === bJoin.selfId && p.x === Math.round(TILE * 5.5)));

    // --- Alice fires east until Bob dies ---
    const killPromise = waitFor(alice, MSG.KILL, (k) => k.victimId === bJoin.selfId, 15000);
    const firing = setInterval(() => alice.emit(MSG.FIRE, { a: 0 }), WEAPONS[0].fireDelayMs + 20);
    const kill = await killPromise.finally(() => clearInterval(firing));
    assert.equal(kill.killerId, aJoin.selfId);

    const snap = await waitFor(alice, MSG.SNAPSHOT, (s) => s.scores.some((v) => v >= 1));
    const bobSnap = snap.players.find((p) => p.id === bJoin.selfId);
    assert.equal(bobSnap.alive, false, 'victim shown dead in snapshot');
    const aliceSnap = snap.players.find((p) => p.id === aJoin.selfId);
    assert.ok(aliceSnap.ammo < WEAPONS[0].magSize, 'server tracked ammo spend');

    // --- chat round-trip ---
    bob.emit(MSG.CHAT, 'gg, nice shot');
    const chat = await waitFor(alice, MSG.CHAT_MSG);
    assert.equal(chat.text, 'gg, nice shot');
    assert.equal(chat.fromId, bJoin.selfId);

    // --- team ping: Bob pings, Alice (enemy) must NOT get it ---
    let aliceGotPing = false;
    alice.on(MSG.PING_MARK, () => { aliceGotPing = true; });
    const bobPing = waitFor(bob, MSG.PING_MARK);
    bob.emit(MSG.PING_MAP, { x: 300, y: 300 });
    const mark = await bobPing;
    assert.equal(mark.fromId, bJoin.selfId);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(aliceGotPing, false, 'enemy team does not receive pings');

    // --- host ends early, summary arrives ---
    const endPromise = waitFor(bob, MSG.MATCH_ENDED);
    alice.emit(MSG.END_MATCH);
    const summary = await endPromise;
    assert.equal(summary.reason, 'host');
    assert.equal(summary.mvpId, aJoin.selfId);

    // --- back to lobby ---
    const lobbyAgain = waitFor(bob, MSG.LOBBY, (l) => l.state === 'lobby');
    alice.emit(MSG.TO_LOBBY);
    await lobbyAgain;
  } finally {
    alice.close();
    bob.close();
    await server.close();
  }
});
