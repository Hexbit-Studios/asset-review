import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { reviewPlugin } from './server/plugin.ts';

// The review root is passed in by bin/asset-review.ts; falls back to ./examples for tool development.
const root = process.env.ASSET_REVIEW_ROOT || new URL('./examples', import.meta.url).pathname;

export default defineConfig({
  plugins: [react(), tailwindcss(), reviewPlugin(root)],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Assets are served through the plugin, not Vite's fs, so keep Vite's own fs strict.
    watch: { ignored: ['**/examples/**'] },
  },
});
