// Verifies listen() reports bind failures as a rejected promise instead
// of an unhandled 'error' event (which would crash the whole process —
// especially bad inside the embedded mobile runtime, which has no
// terminal to show a crash in).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../src/index.js';

test('listen() rejects (does not hang or crash) when the port is already bound', async () => {
  const blocker = createGameServer();
  const port = await blocker.listen(0); // bind an ephemeral port first
  try {
    const contender = createGameServer();
    await assert.rejects(() => contender.listen(port), /EADDRINUSE/);
  } finally {
    await blocker.close();
  }
});

test('listen() still resolves with the bound port on success', async () => {
  const server = createGameServer();
  const port = await server.listen(0);
  try {
    assert.ok(Number.isInteger(port) && port > 0);
  } finally {
    await server.close();
  }
});
