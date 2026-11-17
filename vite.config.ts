import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { reviewPlugin } from './server/plugin.ts';

// The review root is passed in by the CLI (--dev); falls back to ./examples for tool development.
const root = process.env.ASSET_REVIEW_ROOT || fileURLToPath(new URL('./examples', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), reviewPlugin(root)],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // three.js + the UI is one ~1.4 MB chunk (~400 kB gzipped); fine for a local tool.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // Assets are served through the review backend, not Vite's fs, so keep Vite's own watching tight.
    watch: { ignored: ['**/examples/**'] },
  },
});
