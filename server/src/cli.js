// CLI entry point for running the server directly on a PC (npm start / npm
// run dev). Kept separate from index.js so that index.js stays a pure
// library with no import-time side effects — bundling index.js together
// with mobile-entry.js (see client/scripts/build-server-bundle.mjs) must not
// also start a second, competing server.
import { DEFAULT_PORT } from '@lan-shooter/shared';
import qrcodeTerminal from 'qrcode-terminal';
import { createGameServer, lanAddresses } from './index.js';

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
