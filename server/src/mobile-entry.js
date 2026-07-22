// Entry point for the bundle that runs inside the mobile app's embedded
// Node runtime (see client/scripts/build-server-bundle.mjs). 'bridge' is
// injected by that runtime at execution time — it is not a real npm
// package, so it's marked external in the esbuild config rather than
// installed.
import { channel, onPause, onResume } from 'bridge';
import { DEFAULT_PORT } from '@lan-shooter/shared';

// nodejs-mobile runs in the SAME OS process as the host Android app (it is
// not a separate process) — so Node's default behavior for an uncaught
// exception or unhandled rejection (print it and call process.exit(1))
// takes the WHOLE APP down, not just this embedded server. This is very
// likely what was actually crashing the app on Host/Solo: Android's own
// ApplicationExitInfo recorded the exit as REASON_EXIT_SELF with status 1
// — exactly Node's own exit code for an uncaught exception, not a native
// SIGSEGV or anything else external.
//
// These handlers must be registered before anything that could throw at
// module-load time (createGameServer's dependency chain — express,
// socket.io, etc.) gets a chance to run. A *dynamic* import() below,
// rather than a static one, guarantees that: esbuild hoists static
// imports to run before this file's own top-level code (same as native
// ESM), so a static import of mobileBootstrap.js could still execute
// before these process.on() calls did. A dynamic import() only runs when
// this line is actually reached.
process.on('uncaughtException', (err) => {
  const message = err && err.stack ? err.stack : String(err);
  channel.send('server-error', { message: `Uncaught exception: ${message}` });
});
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  channel.send('server-error', { message: `Unhandled rejection: ${message}` });
});

// See cli.js for why this can't be `Number(process.env.PORT) || DEFAULT_PORT`
// — that would silently discard an explicit PORT=0 (ephemeral port) request.
const port = process.env.PORT !== undefined ? Number(process.env.PORT) : DEFAULT_PORT;

import('./mobileBootstrap.js')
  .then(({ startServerForBridge }) => startServerForBridge(channel, port))
  .catch((err) => {
    const message = err && err.stack ? err.stack : String(err);
    channel.send('server-error', { message: `Failed to load the server: ${message}` });
  });

// onPause/onResume fire over the native APP_CHANNEL, which the webview's
// NodeJS.addListener() cannot see (it only observes EVENT_CHANNEL, the
// channel `channel.send()` above writes to). Re-send them over that
// channel so embeddedServer.js's onBackgroundStateChange actually fires.
onPause(() => channel.send('pause'));
onResume(() => channel.send('resume'));
