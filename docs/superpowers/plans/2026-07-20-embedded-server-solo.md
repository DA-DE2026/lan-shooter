# Embedded Server + Host/Solo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the installed Android app host a match (or play solo against
bots) with no PC and no separate server process, by embedding a real
Node.js runtime inside the app that runs the exact same server code that
already runs on a PC via `npm start`.

**Architecture:** The `capacitor-nodejs` plugin runs `server/`'s existing
Express + Socket.IO server as a background Node process inside the
Android app, bound to `0.0.0.0:3000` — reachable by other devices on the
same hotspot exactly like a PC-hosted server. The app's own WebView
connects to `http://localhost:3000` like any other client. Two new
buttons on the connect screen — Host and Solo — start that embedded
server and reuse the entire existing connect → lobby → match flow
unmodified from there.

**Tech Stack:** Node.js (server, unchanged), esbuild (bundles the server
for the mobile runtime), `capacitor-nodejs` (embedded Node runtime plugin
for Capacitor Android), existing Express/Socket.IO server, existing
vanilla-JS/DOM client.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-embedded-server-solo-design.md`
  (read the "Correction (post-approval)" section first — it overrides two
  claims in the earlier part of that document).
- Plugin: `capacitor-nodejs` (github.com/hampoelz/Capacitor-NodeJS),
  installed from the pinned release URL
  `https://github.com/hampoelz/capacitor-nodejs/releases/download/v1.0.0-beta.10/capacitor-nodejs.tgz`.
  Requires Capacitor v8+ — this project is on `@capacitor/core ^8.4.2`, OK.
  Its own README says it is "no longer recommended for new projects"
  (EOL Node 18.20 runtime) — the user explicitly accepted this risk for
  this project's scope. Do not swap it for something else without asking.
- No PC/browser behavior changes anywhere in this plan — a PC or browser
  player must still be able to type a phone's IP and join exactly as
  before. `server/`'s game logic (`Match.js`, `BotAI.js`,
  `Projectiles.js`) must not change at all.
- Android only — no iOS Capacitor project exists in this repo.
- Every server-side JS change needs a `node --test` test in `server/test/`.
  Native Android/plugin-wiring changes are not unit-testable in this
  environment; their check is "the Android CI build succeeds" (final task).
- Follow the project's existing conventions: ESM everywhere in
  `server/`/`shared/`/`client/`, `$('id')` DOM helper from
  `client/src/utils.js`, the `pathToFileURL(process.argv[1])` "run
  directly" check pattern already used in `server/src/index.js`.

---

### Task 1: Harden `listen()` to reject on bind failures

**Files:**
- Modify: `server/src/index.js:42-53` (the `listen()` method inside
  `createGameServer()`'s returned object)
- Test: `server/test/index-listen.test.js` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `createGameServer().listen(port)` now returns a Promise that
  **rejects** (instead of hanging forever, which currently causes an
  unhandled `'error'` event that crashes the process) when the port can't
  be bound. Later tasks (`mobileBootstrap.js`) depend on this rejecting
  cleanly instead of crashing the whole embedded Node process.

- [ ] **Step 1: Write the failing test**

Create `server/test/index-listen.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npm test -w server`
Expected: the "rejects" test times out or the process crashes with an
unhandled `EADDRINUSE` error (not a clean assertion failure) — this is
the bug the task fixes. The second test passes already.

- [ ] **Step 3: Fix `listen()`**

In `server/src/index.js`, find:

```js
    listen(port = DEFAULT_PORT) {
      return new Promise((resolve) => {
        httpServer.listen(port, '0.0.0.0', () => {
          match.start();
          resolve(httpServer.address().port);
        });
      });
    },
```

Replace with:

```js
    listen(port = DEFAULT_PORT) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, '0.0.0.0', () => {
          httpServer.removeListener('error', reject);
          match.start();
          resolve(httpServer.address().port);
        });
      });
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w server`
Expected: both new tests PASS, and all pre-existing tests still PASS
(this touches shared infrastructure every other test uses).

- [ ] **Step 5: Commit**

```bash
git add server/src/index.js server/test/index-listen.test.js
git commit -m "Reject instead of crashing when listen() can't bind the port"
```

---

### Task 2: Add `GET /api/host-info`

**Files:**
- Modify: `server/src/index.js` (inside `createGameServer()`, before the
  static/fallback route registration)
- Test: `server/test/host-info.test.js` (new)

**Interfaces:**
- Consumes: the existing `lanAddresses()` function already defined later
  in the same file (hoisted, safe to call from earlier in the file).
- Produces: `GET /api/host-info` → `{ ips: string[], port: number }`.
  Task 9's Host button uses this to show the real LAN IP instead of
  "localhost" in the shareable address.

- [ ] **Step 1: Write the failing test**

Create `server/test/host-info.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server/test/host-info.test.js`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 3: Add the route**

In `server/src/index.js`, inside `createGameServer()`, find:

```js
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
```

Insert immediately before it:

```js
  // Lets the client discover this device's own LAN IPs — used by the
  // Host button so the "share to join" address is a real reachable IP
  // instead of "localhost" (which only works for this same device).
  app.get('/api/host-info', (req, res) => {
    res.json({ ips: lanAddresses(), port: req.socket.localPort });
  });

  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w server`
Expected: all tests PASS, including the new one.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.js server/test/host-info.test.js
git commit -m "Add GET /api/host-info so clients can discover this device's LAN IPs"
```

---

### Task 3: `mobileBootstrap.js` — testable start-and-report logic

**Files:**
- Create: `server/src/mobileBootstrap.js`
- Test: `server/test/mobileBootstrap.test.js`

**Interfaces:**
- Consumes: `createGameServer` from `./index.js` (Task 1's hardened
  `listen()`); `DEFAULT_PORT` from `@lan-shooter/shared`.
- Produces: `startServerForBridge(channel, port = DEFAULT_PORT)` — an
  async function taking any object with a `send(event, payload)` method
  (dependency-injected so this is testable without the real, non-npm
  `'bridge'` module the mobile runtime provides). Task 4's real entry
  point is the only thing that imports the actual `'bridge'` module and
  hands it to this function.

- [ ] **Step 1: Write the failing test**

Create `server/test/mobileBootstrap.test.js`:

```js
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
  await startServerForBridge(channel, 0); // port 0 = OS picks a free port
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].event, 'server-ready');
  assert.ok(channel.calls[0].payload.port > 0);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server/test/mobileBootstrap.test.js`
Expected: FAIL — `Cannot find module '../src/mobileBootstrap.js'`.

- [ ] **Step 3: Write `mobileBootstrap.js`**

Create `server/src/mobileBootstrap.js`:

```js
// Bridges the game server to the mobile app's Node bridge: starts
// listening, then reports success/failure back over the given channel.
// Takes the channel as a parameter (rather than importing 'bridge'
// directly, which only exists inside the real mobile Node runtime) so
// this is unit-testable without that runtime — see mobile-entry.js for
// the real wiring.

import { createGameServer } from './index.js';
import { DEFAULT_PORT } from '@lan-shooter/shared';

export async function startServerForBridge(channel, port = DEFAULT_PORT) {
  try {
    const boundPort = await createGameServer().listen(port);
    channel.send('server-ready', { port: boundPort });
  } catch (err) {
    channel.send('server-error', { message: err.message });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w server`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/mobileBootstrap.js server/test/mobileBootstrap.test.js
git commit -m "Add testable start-and-report logic for the embedded mobile server"
```

---

### Task 4: `mobile-entry.js` — the real bundle entry point

**Files:**
- Create: `server/src/mobile-entry.js`

**Interfaces:**
- Consumes: `startServerForBridge` from `./mobileBootstrap.js` (Task 3);
  `channel` from the `'bridge'` module (provided at runtime by the
  `capacitor-nodejs` plugin — does not exist as an npm package, must be
  marked `external` in the esbuild config in Task 5).
- Produces: the file Task 5's bundler uses as its entry point. Verified
  indirectly by Task 6's integration test (this file is 2 lines of
  wiring; not independently unit-tested).

- [ ] **Step 1: Write the file**

Create `server/src/mobile-entry.js`:

```js
// Entry point for the bundle that runs inside the mobile app's embedded
// Node runtime (see client/scripts/build-server-bundle.mjs). 'bridge' is
// injected by that runtime at execution time — it is not a real npm
// package, so it's marked external in the esbuild config rather than
// installed.
import { channel } from 'bridge';
import { startServerForBridge } from './mobileBootstrap.js';

startServerForBridge(channel);
```

- [ ] **Step 2: Commit**

```bash
git add server/src/mobile-entry.js
git commit -m "Add the mobile bundle's entry point"
```

(No isolated test here — `node --test` can't resolve the `'bridge'`
specifier since it's not a real package. Task 6 verifies this file works
by actually running the bundled output against a fake `bridge` module.)

---

### Task 5: Bundle the server for the mobile runtime

**Files:**
- Modify: `client/package.json` (add `esbuild` devDependency, add/modify
  scripts)
- Create: `client/scripts/build-server-bundle.mjs`
- Create: `client/public/nodejs/package.json`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Consumes: `server/src/mobile-entry.js` (Task 4) as the esbuild entry
  point.
- Produces: `buildServerBundle(outfile?, entryPoint?)` — exported async
  function, so Task 6's test can reuse the exact same bundling logic
  instead of duplicating an esbuild config. Default output:
  `client/public/nodejs/main.js` (a generated file — gitignored — which
  Vite's `publicDir` copies verbatim into `client/dist/nodejs/main.js` on
  `vite build`, landing exactly where `capacitor.config.json`'s
  `nodeDir: "nodejs"` (Task 7) expects it, since Capacitor's `webDir` is
  `dist`).

- [ ] **Step 1: Add esbuild**

```bash
npm install -D esbuild -w client
```

- [ ] **Step 2: Write the build script**

Create `client/scripts/build-server-bundle.mjs`:

```js
// Bundles the server (server/src/mobile-entry.js + its dependency graph,
// including the @lan-shooter/shared workspace package and npm deps like
// express/socket.io) into one self-contained CommonJS file. The mobile
// Node runtime can't run `npm install` on-device, so everything needed
// has to be inlined here at build time. 'bridge' stays external — it's
// injected by that runtime, not a real npm package.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENTRY = path.resolve(__dirname, '../../server/src/mobile-entry.js');
const DEFAULT_OUTFILE = path.resolve(__dirname, '../public/nodejs/main.js');

export async function buildServerBundle(outfile = DEFAULT_OUTFILE, entryPoint = DEFAULT_ENTRY) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['bridge'],
    logLevel: 'silent',
  });
  return outfile;
}

// Run directly (not imported by a test): build to the default location.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildServerBundle().then((outfile) => {
    console.log(`Server bundle written to ${outfile}`);
  });
}
```

- [ ] **Step 3: Write the mobile Node project's `package.json`**

Create `client/public/nodejs/package.json` (this small file IS committed —
only the bundled `main.js` next to it is generated/gitignored):

```json
{
  "name": "lan-shooter-embedded-server",
  "private": true,
  "main": "main.js"
}
```

- [ ] **Step 4: Wire up `client/package.json` scripts**

In `client/package.json`, change:

```json
  "scripts": {
    "dev": "vite --host",
    "build": "vite build",
    "preview": "vite preview --host"
  },
```

to:

```json
  "scripts": {
    "dev": "vite --host",
    "build:server-bundle": "node scripts/build-server-bundle.mjs",
    "build": "npm run build:server-bundle && vite build",
    "preview": "vite preview --host"
  },
```

- [ ] **Step 5: Ignore the generated bundle**

In the repo root `.gitignore`, find the `client/dist/` line and add
immediately after it:

```
client/public/nodejs/main.js
```

- [ ] **Step 6: Run the build script and confirm it produces output**

Run: `npm run build:server-bundle -w client`
Expected: prints `Server bundle written to .../client/public/nodejs/main.js`
and that file exists and is non-empty (esbuild bundling express +
socket.io + our server code typically produces several hundred KB).

- [ ] **Step 7: Commit**

```bash
git add client/package.json package-lock.json client/scripts/build-server-bundle.mjs client/public/nodejs/package.json .gitignore
git commit -m "Bundle the server into a self-contained file for the embedded mobile runtime"
```

(`package-lock.json` is the repo-root lockfile, shared across all npm
workspaces — Step 1's `npm install -D esbuild -w client` updates it, and
CI's `npm ci` needs that updated version committed or it will fail with a
lockfile-out-of-sync error.)

---

### Task 6: Integration test — the bundle actually boots

**Files:**
- Create: `server/test/fixtures/mobile-bridge-shim/node_modules/bridge/package.json`
- Create: `server/test/fixtures/mobile-bridge-shim/node_modules/bridge/index.js`
- Create: `server/test/mobile-bundle.test.js`

**Interfaces:**
- Consumes: `buildServerBundle` from `client/scripts/build-server-bundle.mjs`
  (Task 5).
- Produces: real, executable proof that Tasks 3–5 work together
  end-to-end (the bundle really does boot a working server and really
  does call `channel.send('server-ready', ...)`) — the strongest
  automated confidence available without a physical device.

- [ ] **Step 1: Write the fake `bridge` module**

Create `server/test/fixtures/mobile-bridge-shim/node_modules/bridge/package.json`:

```json
{
  "name": "bridge",
  "version": "0.0.0-shim",
  "main": "index.js"
}
```

Create `server/test/fixtures/mobile-bridge-shim/node_modules/bridge/index.js`:

```js
// Stand-in for the real 'bridge' module the mobile Node runtime injects.
// Prints a parseable line to stdout so the test can detect the events
// the real embedded server bundle sends.
module.exports.channel = {
  send(event, payload) {
    console.log(`BRIDGE_EVENT:${event} ${JSON.stringify(payload ?? null)}`);
  },
  on() {},
  once() {},
  addListener() {},
  removeListener() {},
};
module.exports.getDataPath = () => process.cwd();
module.exports.onPause = () => {};
module.exports.onResume = () => {};
```

- [ ] **Step 2: Write the integration test**

Create `server/test/mobile-bundle.test.js`:

```js
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
const BRIDGE_SHIM_DIR = path.resolve(__dirname, 'fixtures/mobile-bridge-shim');

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
```

- [ ] **Step 3: Run the test**

Run: `node --test server/test/mobile-bundle.test.js`
Expected: PASS. If it fails, the failure message includes the child
process's captured output — read it, it will point at whichever of
Tasks 3–5 has the bug (e.g. a bundling error, a missing export, or the
server failing to bind).

- [ ] **Step 4: Run the full suite to confirm nothing else broke**

Run: `npm test -w server`
Expected: all tests PASS (this is now the largest test file in the repo
by runtime — a few seconds for the esbuild pass plus child process
startup — that's expected, not a bug).

- [ ] **Step 5: Commit**

```bash
git add server/test/mobile-bundle.test.js server/test/fixtures/mobile-bridge-shim
git commit -m "Add an integration test that boots the actual mobile server bundle"
```

---

### Task 7: Install and configure the `capacitor-nodejs` plugin

**Files:**
- Modify: `client/package.json` (new dependency)
- Modify: `client/capacitor.config.json`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (this is Android project
  configuration).
- Produces: the `NodeJS` object Task 8 imports from `'capacitor-nodejs'`,
  and the native Android glue `npx cap sync android` generates for it.

- [ ] **Step 1: Install the plugin**

```bash
npm install https://github.com/hampoelz/capacitor-nodejs/releases/download/v1.0.0-beta.10/capacitor-nodejs.tgz -w client
```

If this specific release URL 404s (releases can be superseded), check
`https://github.com/hampoelz/Capacitor-NodeJS/releases` for the current
`capacitor-nodejs.tgz` asset URL and use that instead — the rest of this
plan is unaffected by which exact beta is installed.

- [ ] **Step 2: Configure it**

In `client/capacitor.config.json`, currently:

```json
{
  "appId": "com.brigada.lanshooter",
  "appName": "LAN Shooter",
  "webDir": "dist",
  "server": {
    "androidScheme": "http",
    "cleartext": true
  }
}
```

Add a `plugins` block (leave `server` as-is):

```json
{
  "appId": "com.brigada.lanshooter",
  "appName": "LAN Shooter",
  "webDir": "dist",
  "server": {
    "androidScheme": "http",
    "cleartext": true
  },
  "plugins": {
    "CapacitorNodeJS": {
      "nodeDir": "nodejs",
      "startMode": "manual"
    }
  }
}
```

`startMode: "manual"` matters: with `"auto"` the embedded Node process
would start on every app launch, including when someone only wants to
Join an existing game — wasted battery/resources for no benefit. Manual
mode means it only starts when Task 9's Host/Solo buttons call
`NodeJS.start()`.

- [ ] **Step 3: Build the client and sync Android**

```bash
npm run build
cd client && npx cap sync android && cd ..
```

Expected: `cap sync` completes without error and its output mentions
`capacitor-nodejs`. This step needs `npm run build` to have already
produced `client/public/nodejs/main.js` (Task 5) and copied it into
`client/dist/nodejs/main.js` — if `cap sync` errors about a missing
`nodejs` directory, confirm `npm run build:server-bundle -w client` ran
successfully first.

- [ ] **Step 4: Commit**

```bash
git add client/package.json package-lock.json client/capacitor.config.json client/android
git commit -m "Install and configure the capacitor-nodejs embedded runtime plugin"
```

(Same lockfile note as Task 5 — Step 1's install updates the root
`package-lock.json`; it must be committed for CI's `npm ci` to work.)

(`client/android` will have plugin-related files added/changed by
`cap sync` — check `git status` and include whatever it touched; don't
hand-edit anything under `client/android` in this task beyond what `cap
sync` itself generates.)

---

### Task 8: `embeddedServer.js` — the webview-side wrapper

**Files:**
- Create: `client/src/native/embeddedServer.js`

**Interfaces:**
- Consumes: `Capacitor` from `@capacitor/core`; `NodeJS` from
  `capacitor-nodejs` (dynamically imported — see the code comment for
  why); the `server-ready` / `server-error` events Task 4's bundle sends.
- Produces:
  - `embeddedServerAvailable(): boolean` — true only on the installed
    Android app, never in a browser/dev server.
  - `startEmbeddedServer(): Promise<number>` — resolves with the port
    number once the embedded server reports ready; rejects with a
    human-readable `Error` on failure or a 15s timeout. Safe to call more
    than once — later calls return the same in-flight/completed promise.
  - `onBackgroundStateChange(cb: (backgrounded: boolean) => void): void`
    — registers a listener for the plugin's pause/resume bridge events
    (only meaningful after `startEmbeddedServer()` has resolved). Task 10
    uses this for the "keep this app open" warning banner.
  Task 9 consumes `embeddedServerAvailable` and `startEmbeddedServer`.

- [ ] **Step 1: Write the file**

Create `client/src/native/embeddedServer.js`:

```js
// Wraps the capacitor-nodejs plugin so the rest of the client never has
// to know whether it's running as the installed Android app (real
// embedded server available) or in a browser/dev server (Host/Solo
// simply unavailable there — Join still works everywhere).

import { Capacitor } from '@capacitor/core';

let startPromise = null;
let backgroundListeners = [];

/** True only when running as the installed Android app. */
export function embeddedServerAvailable() {
  return Capacitor.isNativePlatform();
}

/**
 * Start the embedded Node server (once — safe to call repeatedly).
 * Resolves with the port it's listening on; rejects with a
 * human-readable message on failure or timeout.
 */
export async function startEmbeddedServer() {
  if (!embeddedServerAvailable()) {
    throw new Error('Hosting from this device needs the installed app.');
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    // Dynamic import: keeps this plugin out of the browser/dev bundle's
    // eager dependency graph entirely — it's only ever needed on the
    // installed app, gated by the check above.
    const { NodeJS } = await import('capacitor-nodejs');

    await NodeJS.start();

    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for the local server to start.'));
      }, 15000);

      NodeJS.addListener('server-ready', (event) => {
        clearTimeout(timeout);
        resolve(event.args[0].port);
      });
      NodeJS.addListener('server-error', (event) => {
        clearTimeout(timeout);
        reject(new Error(event.args[0]?.message ?? 'The local server failed to start.'));
      });
    });

    NodeJS.addListener('pause', () => backgroundListeners.forEach((cb) => cb(true)));
    NodeJS.addListener('resume', () => backgroundListeners.forEach((cb) => cb(false)));

    return port;
  })();

  return startPromise;
}

/** Called with `true` when the app backgrounds, `false` when it resumes. */
export function onBackgroundStateChange(cb) {
  backgroundListeners.push(cb);
}
```

(No automated test for this file — it's entirely dependent on the real
Capacitor/plugin runtime, which doesn't exist under `node --test` or in
this environment. Verified manually per the checklist in Task 11.)

- [ ] **Step 2: Confirm the client still builds**

Run: `npm run build`
Expected: Vite build succeeds (this file is plain ESM using a dynamic
`import()`, which Vite handles as a separate chunk automatically — no
special config needed).

- [ ] **Step 3: Commit**

```bash
git add client/src/native/embeddedServer.js
git commit -m "Add the webview-side wrapper for the embedded Node server"
```

---

### Task 9: Host and Solo buttons

**Files:**
- Modify: `client/index.html` (connect screen markup)
- Modify: `client/src/ui/connect.js`
- Modify: `client/src/styles.css`

**Interfaces:**
- Consumes: `embeddedServerAvailable`, `startEmbeddedServer` from
  `client/src/native/embeddedServer.js` (Task 8); the existing
  `onSubmit({name, address})` contract `initConnect()` already takes
  (unchanged — `client/src/main.js` needs no changes at all).
- Produces: nothing new for later tasks in this plan; Task 10 adds UI
  inside this same screen.

- [ ] **Step 1: Add the buttons to the connect screen**

In `client/index.html`, find the connect screen's button:

```html
        <button id="connect-btn" class="primary">Connect</button>
        <p id="connect-status" class="status"></p>
```

Replace with:

```html
        <button id="connect-btn" class="primary">Join</button>
        <div class="host-solo-row">
          <button id="host-btn">Host a Game</button>
          <button id="solo-btn">Play Solo</button>
        </div>
        <p id="connect-status" class="status"></p>
```

- [ ] **Step 2: Style the new row**

In `client/src/styles.css`, find the `.status` rule:

```css
.status { margin-top: 12px; font-size: 13px; color: #e0a34d; min-height: 18px; }
```

Add immediately after it:

```css
.host-solo-row { display: flex; gap: 8px; margin-top: 10px; }
.host-solo-row button { flex: 1; padding: 9px; }
```

- [ ] **Step 3: Wire up the buttons**

In `client/src/ui/connect.js`, update the imports at the top:

```js
import { $, normalizeAddress, cameraAvailable } from '../utils.js';
import { scanForAddress } from './qrscan.js';
import { embeddedServerAvailable, startEmbeddedServer } from '../native/embeddedServer.js';
```

Inside `initConnect({ onSubmit })`, after the existing `scanBtn` wiring
block (which ends with the `cameraAvailable()` `if` block) and before the
`const submit = () => { ... };` block, insert:

```js
  const hostBtn = $('host-btn');
  const soloBtn = $('solo-btn');
  if (!embeddedServerAvailable()) {
    hostBtn.disabled = true;
    soloBtn.disabled = true;
    hostBtn.title = soloBtn.title = 'Only available in the installed app';
  } else {
    hostBtn.addEventListener('click', () => startHosted(true));
    soloBtn.addEventListener('click', () => startHosted(false));
  }

  async function startHosted(shareable) {
    const name = nameEl.value.trim();
    if (!name) return setStatus('Enter a name first.');
    setStatus('Starting local server…');
    hostBtn.disabled = true;
    soloBtn.disabled = true;
    try {
      const port = await startEmbeddedServer();
      let address = `localhost:${port}`;
      if (shareable) {
        try {
          const res = await fetch(`http://localhost:${port}/api/host-info`);
          const info = await res.json();
          if (info.ips?.[0]) address = `${info.ips[0]}:${port}`;
        } catch {
          // Fall back to localhost — still works for this device; the
          // lobby's "Share to join" banner just won't show a real LAN IP.
        }
      }
      localStorage.setItem('lanshooter.name', name);
      onSubmit({ name, address });
    } catch (err) {
      setStatus(err.message || 'Could not start the local server.');
      hostBtn.disabled = false;
      soloBtn.disabled = false;
    }
  }
```

- [ ] **Step 4: Confirm the client builds**

Run: `npm run build`
Expected: Vite build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/src/ui/connect.js client/src/styles.css
git commit -m "Add Host and Solo buttons that start the embedded server"
```

---

### Task 10: Background-survival warning banner

**Files:**
- Modify: `client/index.html`
- Modify: `client/src/styles.css`
- Modify: `client/src/ui/connect.js`

**Interfaces:**
- Consumes: `onBackgroundStateChange` from
  `client/src/native/embeddedServer.js` (Task 8).
- Produces: nothing consumed elsewhere — this is a self-contained UI
  affordance for the known limitation documented in the spec (no
  foreground service, so Android may suspend the embedded server if the
  app is backgrounded for too long).

- [ ] **Step 1: Add the banner element**

In `client/index.html`, find:

```html
  <div id="app">
```

Add immediately after it:

```html
  <div id="app">
    <div id="background-warning" class="hidden">
      Keep this app open — backgrounding it may end the match for everyone.
    </div>
```

- [ ] **Step 2: Style it**

In `client/src/styles.css`, add at the end of the file:

```css
/* ---------- background-survival warning (Host/Solo only) ---------- */
#background-warning {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  background: #6e3140; color: #fff; text-align: center;
  padding: 8px 12px; font-size: 13px; font-weight: 600;
}
```

- [ ] **Step 3: Wire it up**

In `client/src/ui/connect.js`, update the import to include
`onBackgroundStateChange`:

```js
import { embeddedServerAvailable, startEmbeddedServer, onBackgroundStateChange } from '../native/embeddedServer.js';
```

Inside `startHosted(shareable)`, right after the line
`const port = await startEmbeddedServer();`, add:

```js
      onBackgroundStateChange((backgrounded) => {
        $('background-warning').classList.toggle('hidden', !backgrounded);
      });
```

- [ ] **Step 4: Confirm the client builds**

Run: `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/src/styles.css client/src/ui/connect.js
git commit -m "Warn the host if the app is backgrounded while hosting"
```

---

### Task 11: CI build check

**Files:** none (verification-only task; no code changes)

**Interfaces:** none.

- [ ] **Step 1: Confirm the full local test suite passes**

Run: `npm test -w server`
Expected: every test PASSES, including all of Tasks 1, 2, 3, and 6's new
tests.

- [ ] **Step 2: Confirm the full build succeeds**

Run: `npm run build`
Expected: succeeds (this runs Task 5's bundle step, then Vite).

- [ ] **Step 3: Tag and push to trigger the Android CI build**

```bash
git tag v0.3.0
git push origin master
git push origin v0.3.0
```

- [ ] **Step 4: Watch the Android build**

```bash
gh run list -R DA-DE2026/lan-shooter --limit 1
```

Wait for the run's status to become `completed`. This is the real
verification that the new `capacitor-nodejs` plugin's Java/Gradle
integration is valid — something impossible to check without either
this CI run or a local Android SDK. If it fails, fetch the log:

```bash
gh run view --log-failed -R DA-DE2026/lan-shooter
```

and fix whatever it reports (most likely culprits: the plugin's Android
minSdkVersion requirement being higher than this project's, or a Gradle
dependency conflict — both visible directly in the failed log).

- [ ] **Step 5: Confirm the release has the APK**

```bash
gh release view v0.3.0 -R DA-DE2026/lan-shooter
```

Expected: `asset: lan-shooter.apk` listed. This is the build the user
installs to manually verify Host/Solo actually work on a real device —
that manual pass (does the embedded server actually start on-device, is
it reachable from a second phone on the hotspot, does Solo work with no
network at all) is the one piece of verification nothing in this plan can
substitute for.

- [ ] **Step 6: No commit needed** (verification-only task).
