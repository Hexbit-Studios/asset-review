import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so tests don't start the review server's file watcher.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
