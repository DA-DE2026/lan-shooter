// Proves the plain PC entry point (server/src/cli.js, run via `npm start` /
// `npm run dev`) actually boots: spawns it as a real child process with
// PORT=0 (an ephemeral port, so this test can't collide with anything else
// already listening on the machine — see mobile-bundle.test.js for the same
// concern on the mobile bundle side) and checks it prints the expected
// startup banner. Unlike mobile-bundle.test.js, cli.js never touches the
// 'bridge' module, so no NODE_PATH shim is needed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(SERVER_DIR, 'src/cli.js');

test('cli.js boots the server on an ephemeral port and prints a startup banner', async () => {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH], {
      cwd: SERVER_DIR,
      env: { ...process.env, PORT: '0' },
    });
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for startup banner. Output so far:\n${buffer}`));
    }, 8000);

    // Wait for the *end* of the startup banner (the LAN-IPs-or-no-LAN-address
    // line), not just the first "listening on port" line — killing the
    // child as soon as the first line matches races its remaining
    // synchronous console.log calls and can truncate the captured output.
    const BANNER_DONE = /Players on your LAN can connect to:|No LAN IPv4 address detected/;
    const checkDone = () => {
      if (BANNER_DONE.test(buffer)) {
        clearTimeout(timer);
        child.kill();
        resolve(buffer);
      }
    };
    child.stdout.on('data', (chunk) => { buffer += chunk.toString(); checkDone(); });
    child.stderr.on('data', (chunk) => { buffer += chunk.toString(); });
    child.on('exit', (code) => {
      if (!BANNER_DONE.test(buffer) && code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`cli.js exited with code ${code}. Output:\n${buffer}`));
      }
    });
  });

  assert.match(output, /LAN Shooter server listening on port \d+/);
  // Confirms PORT=0 really produced an OS-assigned ephemeral port (i.e. the
  // Number(process.env.PORT) || DEFAULT_PORT bug regressed) rather than
  // silently falling back to DEFAULT_PORT (3000).
  const [, portText] = output.match(/LAN Shooter server listening on port (\d+)/);
  assert.notEqual(Number(portText), 0);
  // Either LAN IPs were printed, or the "no LAN address" message was —
  // either way, cli.js should always report one or the other.
  assert.match(
    output,
    /Players on your LAN can connect to:|No LAN IPv4 address detected/,
  );
});
