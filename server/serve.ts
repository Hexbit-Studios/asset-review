// Production host: a plain node:http server that serves the prebuilt UI (dist/client) and the
// review backend. No Vite or build tooling needed at runtime.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createReviewApp, safeJoin, sendFile } from './app.ts';

export interface ServeOptions {
  root: string;
  clientDir: string;
  port?: number;
  host?: string;
  open?: boolean;
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

export async function startServer(opts: ServeOptions): Promise<RunningServer> {
  const index = path.join(opts.clientDir, 'index.html');
  if (!fs.existsSync(index)) throw new Error(`UI build not found at ${opts.clientDir}. Run \`pnpm build\` first.`);
  const app = createReviewApp(opts.root);

  const server = http.createServer((req, res) => {
    app
      .handle(req, res)
      .then((handled) => {
        if (handled) return;
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
        if (pathname === '/' || pathname === '/index.html') return sendFile(res, index);
        // Hashed build assets can be cached forever; everything else falls back to the app shell.
        const file = safeJoin(opts.clientDir, pathname);
        if (fs.existsSync(file) && fs.statSync(file).isFile())
          return sendFile(res, file, pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
        sendFile(res, index);
      })
      .catch((err) => {
        res.statusCode = 500;
        res.end(String(err));
      });
  });

  const host = opts.host ?? 'localhost';
  const port = await listen(server, opts.port ?? 5199, host);
  const url = `http://${host === '0.0.0.0' || host === '::' ? 'localhost' : host}:${port}/`;
  if (opts.open) openBrowser(url);
  return {
    url,
    async close() {
      await app.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Listen on the requested port, or the next free one (like Vite does). */
function listen(server: http.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (p: number, attemptsLeft: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) tryPort(p + 1, attemptsLeft - 1);
        else reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : p);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, host);
    };
    tryPort(port, 20);
  });
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* no browser available; the URL is printed */
  }
}
