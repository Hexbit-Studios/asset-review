// Vite plugin that turns the dev server into the review backend:
// asset listing, raw file serving, notes / screenshots / settings, .blend conversion,
// drag-and-drop uploads, and live "file changed" pushes over Vite's websocket.

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { watch } from 'chokidar';
import { ReviewStore, decodeDataUrl, kindForExt } from './store.ts';
import { blendToGlb, findBlender } from './blender.ts';
import type { ServerInfo } from '../shared/types.ts';

const MIME: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  json: 'application/json',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
};

export function reviewPlugin(rootDir: string): Plugin {
  const store = new ReviewStore(rootDir);

  return {
    name: 'asset-review',
    configureServer(server: ViteDevServer) {
      setupWatcher(server, store);
      server.middlewares.use(async (req, res, next) => {
        const isFiles = req.url?.startsWith('/files/');
        if (!isFiles && !req.url?.startsWith('/api/')) return next();
        try {
          if (isFiles) {
            // Root files served by path so relative references (gltf .bin, textures) resolve.
            const rel = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname.slice('/files/'.length));
            return sendFile(res, store.resolve(rel));
          }
          await handle(req, res, store);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[asset-review]', message);
          send(res, 500, { error: message });
        }
      });
    },
  };
}

function setupWatcher(server: ViteDevServer, store: ReviewStore) {
  const watcher = watch(store.root, {
    ignoreInitial: true,
    ignored: (p: string) => {
      const rel = path.relative(store.root, p).split(path.sep).join('/');
      if (!rel || rel.startsWith('..')) return false;
      // Notes are watched separately so external edits (CLI replies) show up live.
      if (rel === '.review' || rel.startsWith('.review/notes') || rel === '.review/config.json') return false;
      return store.isIgnored(rel);
    },
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  let pending = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    const changes = [...pending].map(([p, type]) => ({ path: p, type }));
    pending = new Map();
    server.ws.send({ type: 'custom', event: 'review:fs', data: { changes } });
  };
  const onEvent = (type: string) => (abs: string) => {
    const rel = store.relative(abs);
    if (rel === 'review.config.json' || rel === '.review/config.json') store.config = store.loadConfig();
    const ext = path.extname(rel).slice(1).toLowerCase();
    const relevant = kindForExt(ext) || ext === 'json' || rel.startsWith('.review/notes/');
    if (!relevant) return;
    pending.set(rel, type);
    if (!timer) timer = setTimeout(flush, 120);
  };
  watcher.on('add', onEvent('add'));
  watcher.on('change', onEvent('change'));
  watcher.on('unlink', onEvent('unlink'));
  server.httpServer?.on('close', () => void watcher.close());
}

async function handle(req: IncomingMessage, res: ServerResponse, store: ReviewStore) {
  const url = new URL(req.url!, 'http://localhost');
  const route = url.pathname.replace(/^\/api/, '');
  const method = req.method ?? 'GET';

  if (route === '/info' && method === 'GET') {
    const info: ServerInfo = {
      root: store.root,
      rootName: store.config.name || path.basename(store.root),
      config: store.config,
      blender: !!findBlender(),
      author: store.defaultAuthor(),
    };
    return send(res, 200, info);
  }

  if (route === '/config' && method === 'PATCH') {
    const body = await readJson(req);
    // Only keys the viewer owns; everything else in the file is left alone.
    const patch: Record<string, unknown> = {};
    if (body.lighting && typeof body.lighting === 'object') patch.lighting = body.lighting;
    return send(res, 200, store.updateConfig(patch));
  }

  if (route === '/assets' && method === 'GET') {
    return send(res, 200, { assets: store.listAssets(), settings: store.readAllSettings() });
  }

  if (route === '/file' && method === 'GET') {
    const rel = url.searchParams.get('path') ?? '';
    return sendFile(res, store.resolve(rel));
  }

  if (route === '/blend' && method === 'GET') {
    const rel = url.searchParams.get('path') ?? '';
    const glb = await blendToGlb(store.resolve(rel), store.cacheDir());
    return sendFile(res, glb);
  }

  if (route === '/settings' && method === 'PUT') {
    const body = await readJson(req);
    return send(res, 200, store.writeSettings(String(body.asset), body.settings ?? {}));
  }

  if (route === '/notes' && method === 'GET') {
    return send(res, 200, { notes: store.listNotes() });
  }

  if (route === '/notes' && method === 'POST') {
    const body = await readJson(req, 64 * 1024 * 1024);
    const note = store.createNote({
      asset: String(body.asset),
      text: String(body.text ?? ''),
      author: body.author,
      markers: Array.isArray(body.markers) ? body.markers : [],
      view: body.view,
      info:
        body.info && typeof body.info.key === 'string'
          ? { key: String(body.info.key), label: String(body.info.label ?? body.info.key), value: String(body.info.value ?? '') }
          : undefined,
      screenshotPng: body.screenshot ? decodeDataUrl(body.screenshot) : undefined,
      cleanScreenshotPng: body.cleanScreenshot ? decodeDataUrl(body.cleanScreenshot) : undefined,
    });
    return send(res, 201, note);
  }

  const noteMatch = /^\/notes\/([\w-]+)$/.exec(route);
  if (noteMatch && method === 'PATCH') {
    const body = await readJson(req);
    return send(res, 200, store.updateNote(noteMatch[1], body));
  }
  if (noteMatch && method === 'DELETE') {
    store.deleteNote(noteMatch[1]);
    return send(res, 200, { ok: true });
  }

  if (route === '/screenshots' && method === 'POST') {
    const body = await readJson(req, 64 * 1024 * 1024);
    const rel = store.saveScreenshot(decodeDataUrl(body.image), body.asset);
    return send(res, 201, { path: rel, abs: store.resolve(rel) });
  }

  if (route === '/upload' && method === 'POST') {
    const rel = url.searchParams.get('path') ?? 'upload.bin';
    const data = await readBody(req, 512 * 1024 * 1024);
    return send(res, 201, { path: store.saveUpload(rel, data) });
  }

  send(res, 404, { error: `no route ${method} ${route}` });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendFile(res: ServerResponse, abs: string) {
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(res, 404, { error: 'not found' });
  const ext = path.extname(abs).slice(1).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(abs).pipe(res);
}

function readBody(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage, limit?: number): Promise<any> {
  const buf = await readBody(req, limit);
  return buf.length ? JSON.parse(buf.toString('utf8')) : {};
}
