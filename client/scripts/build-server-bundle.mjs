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
