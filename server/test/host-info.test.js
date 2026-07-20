import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../src/index.js';

test('GET /api/host-info returns the LAN IPs and the port the request arrived on', async () => {
  const server = createGameServer();
  const port = await server.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/host-info`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.ips));
    assert.equal(body.port, port);
  } finally {
    await server.close();
  }
});
