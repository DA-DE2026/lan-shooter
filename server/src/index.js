// Server entrypoint: HTTP (serves the built client, if present) + Socket.IO.
// Exported as a factory so tests can spin up a real server on an ephemeral port.

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import qrcodeTerminal from 'qrcode-terminal';
import { DEFAULT_PORT } from '@lan-shooter/shared';
import { Match } from './Match.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createGameServer() {
  const app = express();

  // Serve the production client build when it exists (npm run build at repo
  // root). During development the client runs on Vite instead.
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send(
        'LAN Shooter server is running.\n' +
        'No client build found — run "npm run build" for a hosted client,\n' +
        'or use the Vite dev server (npm run dev:client).',
      );
    });
  }

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }, // LAN-only usage; allows the Vite dev origin and Capacitor apps
  });

  const match = new Match(io);
  io.on('connection', (socket) => match.attachSocket(socket));

  return {
    httpServer,
    io,
    match,
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
    async close() {
      match.stop();
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

/** All non-internal IPv4 addresses, so the host knows what IP to share. */
function lanAddresses() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

// Run directly (not imported by a test): start listening.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const server = createGameServer();
  server.listen(port).then(() => {
    console.log(`\nLAN Shooter server listening on port ${port}`);
    const ips = lanAddresses();
    if (ips.length) {
      console.log('Players on your LAN can connect to:');
      for (const ip of ips) console.log(`  ${ip}:${port}`);
      // A scannable QR is the easiest way for a phone to join: point its
      // camera at this terminal (browser play) or use the app's "Scan QR"
      // button (works in the installed APK). Encodes the first LAN address.
      console.log('\nOr scan this QR code with a phone camera:\n');
      qrcodeTerminal.generate(`http://${ips[0]}:${port}`, { small: true });
    } else {
      console.log('No LAN IPv4 address detected — check your network connection.');
    }
    console.log();
  });
}
