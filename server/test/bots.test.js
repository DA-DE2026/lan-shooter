// Bot player tests: lobby management + the AI actually fighting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE, PLAYER_MAX_HP } from '@lan-shooter/shared';
import { Match } from '../src/Match.js';

function makeFakeIO() {
  return { emitted: [], emit(event, data) { this.emitted.push({ event, data }); } };
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

test('host can add bots; they balance teams and appear in the roster', () => {
  const { match } = makeMatch();
  const host = join(match, 'Host');
  match.addBot(host.player);
  match.addBot(host.player);

  const bots = [...match.players.values()].filter((p) => p.isBot);
  assert.equal(bots.length, 2);
  assert.ok(bots.every((b) => b.connected), 'bots count as connected');
  const roster = match.lobbyPayload().players;
  assert.equal(roster.filter((p) => p.isBot).length, 2, 'roster flags bots');
  // 1 human + 2 bots across 2 teams -> no team has all three.
  const teams = [...match.players.values()].map((p) => p.team);
  assert.ok(teams.includes(0) && teams.includes(1), 'bots auto-balanced');
});

test('non-host cannot add bots; kick removes a bot', () => {
  const { match } = makeMatch();
  const host = join(match, 'Host');
  const other = join(match, 'Other');
  match.addBot(other.player);
  assert.equal([...match.players.values()].filter((p) => p.isBot).length, 0);

  match.addBot(host.player);
  const bot = [...match.players.values()].find((p) => p.isBot);
  match.kick(host.player, bot.id);
  assert.equal(match.players.has(bot.token), false, 'bot kicked');
});

test('bots never become host; bots are dropped when all humans leave', () => {
  const { match } = makeMatch();
  const host = join(match, 'Host');
  match.addBot(host.player);
  match.onDisconnect(host.socket);
  assert.equal(match.hostToken, null, 'bot did not inherit host');
  assert.equal(match.players.size, 0, 'bots cleared with no humans left');
});

test('a bot hunts, shoots and kills a stationary enemy', () => {
  const { match, clock } = makeMatch();
  const host = join(match, 'Host');
  match.setSettings(host.player, { scoreLimit: 0, timeLimitMin: 0 });
  match.addBot(host.player);
  match.startMatch(host.player);

  const human = host.player;
  const bot = [...match.players.values()].find((p) => p.isBot);
  assert.notEqual(bot.team, human.team);
  assert.equal(bot.alive, true, 'bot spawned at match start');

  // Face-off in the open top corridor: bot has line of sight immediately.
  human.x = TILE * 1.5;
  human.y = TILE * 1.5;
  bot.x = TILE * 5.5;
  bot.y = TILE * 1.5;

  let guard = 0;
  while (human.deaths < 1 && guard++ < 3000) {
    clock.t += 33;
    match.tick(33);
  }

  assert.ok(human.hp < PLAYER_MAX_HP || human.deaths >= 1, 'bot landed hits');
  assert.equal(human.deaths >= 1, true, 'bot finished the kill');
  assert.ok(bot.kills >= 1, 'kill credited to the bot');
  assert.ok(match.scores[bot.team] >= 1, 'bot scored for its team');
});

test('bot with no visible enemy pathfinds instead of standing still', () => {
  const { match, clock } = makeMatch();
  const host = join(match, 'Host');
  match.addBot(host.player);
  match.startMatch(host.player);

  const human = host.player;
  const bot = [...match.players.values()].find((p) => p.isBot);
  // Park the human far away behind walls; watch the bot roam.
  human.x = TILE * 1.5;
  human.y = TILE * 17.5;
  bot.x = TILE * 1.5;
  bot.y = TILE * 1.5;
  bot.brain = null; // reset any state from spawn position

  const startX = bot.x;
  const startY = bot.y;
  for (let i = 0; i < 150; i++) {
    clock.t += 33;
    match.tick(33);
  }
  const moved = Math.hypot(bot.x - startX, bot.y - startY);
  assert.ok(moved > TILE, `bot wandered (moved ${Math.round(moved)}px)`);
});
