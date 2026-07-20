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
