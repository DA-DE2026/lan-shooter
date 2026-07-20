// startServerForBridge takes the bridge channel as a parameter (instead
// of importing the 'bridge' module directly, which only exists inside
// the real mobile Node runtime) so this can run under plain `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServerForBridge } from '../src/mobileBootstrap.js';
import { createGameServer } from '../src/index.js';

function fakeChannel() {
  const calls = [];
  return { calls, send: (event, payload) => calls.push({ event, payload }) };
}

test('startServerForBridge reports server-ready with the bound port', async () => {
  const channel = fakeChannel();
  const server = await startServerForBridge(channel, 0); // port 0 = OS picks a free port
  try {
    assert.equal(channel.calls.length, 1);
    assert.equal(channel.calls[0].event, 'server-ready');
    assert.ok(channel.calls[0].payload.port > 0);
  } finally {
    await server.close();
  }
});

test('startServerForBridge reports server-error on a bind failure', async () => {
  const blocker = createGameServer();
  const port = await blocker.listen(0);
  try {
    const channel = fakeChannel();
    await startServerForBridge(channel, port);
    assert.equal(channel.calls.length, 1);
    assert.equal(channel.calls[0].event, 'server-error');
    assert.match(channel.calls[0].payload.message, /EADDRINUSE/);
  } finally {
    await blocker.close();
  }
});
