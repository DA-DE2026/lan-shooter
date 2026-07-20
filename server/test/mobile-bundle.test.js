// Proves the actual esbuild output (not just the source files) boots
// correctly: bundles server/src/mobile-entry.js, runs it as a real child
// process with a fake 'bridge' module on NODE_PATH, and checks it
// reports readiness. This is the strongest check available without a
// real Android device running the real embedded Node runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildServerBundle } from '../../client/scripts/build-server-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// NODE_PATH entries are searched directly for the module name (i.e. as
// if they were themselves a node_modules directory) rather than having
// their own node_modules subfolder searched — so this must point at
// .../mobile-bridge-shim/node_modules, not .../mobile-bridge-shim.
const BRIDGE_SHIM_DIR = path.resolve(__dirname, 'fixtures/mobile-bridge-shim/node_modules');

test('the mobile bundle boots the server and signals readiness via the bridge', async () => {
  const bundlePath = path.join(os.tmpdir(), `lan-shooter-mobile-bundle-${Date.now()}.cjs`);
  await buildServerBundle(bundlePath);

  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundlePath], {
      env: { ...process.env, PORT: '0', NODE_PATH: BRIDGE_SHIM_DIR },
    });
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for server-ready. Output so far:\n${buffer}`));
    }, 8000);

    const checkDone = () => {
      if (buffer.includes('BRIDGE_EVENT:server-ready')) {
        clearTimeout(timer);
        child.kill();
        resolve(buffer);
      }
    };
    child.stdout.on('data', (chunk) => { buffer += chunk.toString(); checkDone(); });
    child.stderr.on('data', (chunk) => { buffer += chunk.toString(); });
    child.on('exit', (code) => {
      if (!buffer.includes('BRIDGE_EVENT:server-ready') && code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Bundle exited with code ${code}. Output:\n${buffer}`));
      }
    });
  });

  assert.match(output, /BRIDGE_EVENT:server-ready \{"port":\d+\}/);
});
