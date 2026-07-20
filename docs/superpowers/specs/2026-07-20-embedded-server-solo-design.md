# Embedded Server + Host/Solo Mode — Design

Date: 2026-07-20. Goal: a single APK install that can host a match (or play
solo against bots) with no PC and no separate server process — while never
breaking the existing PC-hosted flow.

## Correction (post-approval)

The plugin identified during design-time research (`nodejs-mobile-capacitor`)
turned out to be superseded by a different, actively-maintained one:
**`capacitor-nodejs`** (hampoelz/Capacitor-NodeJS), which supports
Capacitor v8 (matching this project) and is what the rest of this doc now
assumes throughout. Its own README states it is *"no longer recommended
for new projects"* (EOL Node 18.20 runtime, unmaintained dependencies,
suggests migrating to Tauri) — a real risk, accepted deliberately for this
project's scope (a personal/small-group LAN tool, not an app-store product
with a long support tail). It also does **not** ship a foreground service
for background survival, contrary to this doc's original assumption — see
the corrected "Foreground service" note below.

## Why embed Node instead of anything else

A WebView (what the current app's UI runs in) can only be a network
*client* — it cannot listen for incoming connections. Something has to run
a real server process on the phone. The options:

- **Embed a real Node.js runtime in the app** (`nodejs-mobile-capacitor`) —
  reuses the entire existing `server/` codebase (`Match.js`, `BotAI.js`,
  `Projectiles.js`, all 29 tests) completely unchanged. Chosen.
- Rewrite the server in native Kotlin — throws away ~1500 lines of working,
  tested game logic to re-implement and re-verify natively. Rejected: far
  higher risk/effort for no behavioral gain.
- Auto-provision Termux + Node from within the app — still a separate
  process outside our control, doesn't satisfy "single install." Rejected.

## Architecture

```
┌─────────────────────────── Android app ───────────────────────────┐
│                                                                     │
│  WebView (existing client code, unchanged)                        │
│    ── connects to ──▶ http://localhost:3000  (Socket.IO, as today)│
│                                                                     │
│  nodejs-mobile plugin: runs bundled server as a background process│
│    server.bundle.js  (esbuild output of server/ + shared/)        │
│    binds 0.0.0.0:3000 — reachable from other devices on the       │
│    same hotspot/Wi-Fi exactly like a PC-hosted server today       │
│                                                                     │
│  Foreground service notification while hosting/solo is active     │
│    (prevents Android from suspending the embedded server)         │
└─────────────────────────────────────────────────────────────────┘
```

The embedded server is byte-for-byte the same server code that runs on a
PC via `npm start` — `Match.js`, `BotAI.js`, `Projectiles.js`, `shared/`
are untouched. `server/src/index.js` gains one small addition (see
`GET /api/host-info` below); everything else about how the process gets
*launched* is the only real difference. A PC/browser player can still type
the phone's LAN IP and join, unaffected.

## Components

**`client/scripts/build-server-bundle.mjs`** (new) — esbuild step that
bundles `server/src/index.js` + `@lan-shooter/shared` into one
self-contained CommonJS file (nodejs-mobile can't `npm install` on-device,
so dependencies — express, socket.io, qrcode-terminal — are inlined at
build time). Output goes to
`client/android/app/src/main/assets/nodejs-project/main.js`, the location
`nodejs-mobile-capacitor` expects.

**`client/src/native/embeddedServer.js`** (new) — thin wrapper around the
plugin's JS API: `start()` launches the bundle and resolves once the
process reports it's listening (via `nodejs-mobile`'s message channel back
to JS — the bundle emits a `{type:'ready', port}` message after
`server.listen()` resolves); `stop()` tears it down. No-ops with a clear
"only available in the installed app" rejection when the plugin isn't
present (browser/dev mode).

**Entry screen rework** — today's single Connect form becomes a
**Host / Join / Solo** choice (`client/src/ui/modeselect.js`, new).
- **Solo**: `embeddedServer.start()` → `connect('localhost:3000', name)` →
  existing lobby screen, unchanged. Player adds bots, adjusts settings,
  presses Start — the entire lobby/match/HUD/summary flow is reused as-is.
- **Host**: same `embeddedServer.start()` → connect to `localhost:3000`,
  but the lobby's existing "Share to join" address display shows the
  device's real LAN IP (not localhost) so other devices can join. This
  needs one new addition to `server/src/index.js`: a `GET /api/host-info`
  route exposing the existing `lanAddresses()` helper (already used for
  the terminal QR/IP printout) as JSON, so the client can read it too.
- **Join**: unchanged from today (manual address entry + QR scan). The
  discovery sub-project adds a live list on top of this screen later;
  nothing here blocks on that.

**Backgrounding (corrected)** — `capacitor-nodejs` does not provide a
foreground service, and building a correct custom one (notification
channels, `startForeground()` version differences, permissions) is real
native Android work with real risk of subtle bugs I can't verify without
a device. Rather than attempt that blind, the plugin's `onPause`/`onResume`
bridge events drive a visible in-app banner while hosting: "Keep this app
open — backgrounding it may end the match for everyone." This is an
honest, low-risk mitigation, not a fix; documented as a known limitation.

## Data flow

1. User taps **Host** or **Solo**.
2. `embeddedServer.start()` invokes the plugin, which launches
   `main.js` inside the bundled Node runtime.
3. `main.js` calls the same `createGameServer().listen(3000)` used by the
   PC entrypoint, then posts a `ready` message back to JS.
4. The WebView's own `net.js` connects to `http://localhost:3000` exactly
   like it would connect to any remote host — no special-casing in the
   Socket.IO client code at all.
5. From here, every existing flow (lobby, bots, matches, reconnect,
   summary) runs completely unmodified.

## Error handling

- Plugin fails to start the runtime (rare, e.g. corrupted bundle): the
  mode-select screen shows a clear error with a "Try again" action rather
  than hanging on a blank screen.
- Port 3000 somehow already bound on-device: `embeddedServer.start()`
  surfaces the failure; UI reports "Couldn't start the local server" rather
  than silently failing to connect.
- App backgrounded without the foreground notification active (shouldn't
  happen given the design above, but Android can still reclaim aggressively
  on some OEMs) — out of scope to fully solve; documented as a known
  limitation in the README ("keep the app open/foregrounded while hosting").

## Testing

- All 29 existing server tests keep running unmodified — they test the
  exact code that now also runs embedded, so they remain the primary proof
  the game logic is correct.
- CI gains a step building the esbuild server bundle, so a broken bundle
  fails the build immediately rather than only at runtime.
- On-device verification (embedded server actually starts, Solo plays,
  Host is reachable from a second device, background survival) is manual —
  the user runs a checklist against real hardware, since none of this is
  observable from an automated test in this environment.

## Explicitly out of scope here

- Discovery / no-IP joining — separate spec
  (`2026-07-20-lan-discovery-design.md`).
- iOS — no iOS Capacitor project exists in this repo; this design targets
  Android only.
