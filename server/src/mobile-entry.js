// Entry point for the bundle that runs inside the mobile app's embedded
// Node runtime (see client/scripts/build-server-bundle.mjs). 'bridge' is
// injected by that runtime at execution time — it is not a real npm
// package, so it's marked external in the esbuild config rather than
// installed.
import { channel } from 'bridge';
import { startServerForBridge } from './mobileBootstrap.js';
import { DEFAULT_PORT } from '@lan-shooter/shared';

// See cli.js for why this can't be `Number(process.env.PORT) || DEFAULT_PORT`
// — that would silently discard an explicit PORT=0 (ephemeral port) request.
const port = process.env.PORT !== undefined ? Number(process.env.PORT) : DEFAULT_PORT;
startServerForBridge(channel, port);
