// Dev-mode host: mounts the review backend as Vite middleware so the UI gets hot reload while
// working on the tool itself. The published package uses server/serve.ts instead.

import type { Plugin, ViteDevServer } from 'vite';
import { createReviewApp } from './app.ts';

export function reviewPlugin(rootDir: string): Plugin {
  return {
    name: 'asset-review',
    configureServer(server: ViteDevServer) {
      const app = createReviewApp(rootDir);
      server.middlewares.use((req, res, next) => {
        app.handle(req, res).then((handled) => (handled ? undefined : next()), next);
      });
      server.httpServer?.on('close', () => void app.close());
    },
  };
}
