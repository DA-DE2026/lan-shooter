import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The shared package is aliased directly to its source so the client always
// bundles the same rules the server runs (no publish/link step needed).
export default defineConfig({
  resolve: {
    alias: {
      '@lan-shooter/shared': fileURLToPath(new URL('../shared/src/index.js', import.meta.url)),
    },
  },
  server: {
    host: true, // expose the dev server on the LAN too
    port: 5173,
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000, // three.js is a single large chunk
  },
});
