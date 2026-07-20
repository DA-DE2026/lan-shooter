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
