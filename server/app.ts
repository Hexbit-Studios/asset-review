// The review backend, independent of how it's hosted: the dev server mounts it as Vite
// middleware, the published CLI mounts it on a plain node:http server.
//
//   /api/*      notes, screenshots, settings, config, uploads, .blend conversion
//   /api/events server-sent events: file changes under the review root (assets + notes)
//   /files/*    raw files from the review root (relative references like gltf .bin resolve)

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { watch, type FSWatcher } from 'chokidar';
import { ReviewStore, decodeDataUrl, kindForExt } from './store.ts';
import { blendToGlb, findBlender } from './blender.ts';
import type { ServerInfo } from '../shared/types.ts';

export const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  woff: 'font/woff',
  wasm: 'application/wasm',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  ico: 'image/x-icon',
  json: 'application/json',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
};

export interface ReviewApp {
  store: ReviewStore;
  /** Handles the request if it's one of ours. Resolves false when it isn't (caller continues). */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  close(): Promise<void>;
}

export function createReviewApp(rootDir: string): ReviewApp {
  const store = new ReviewStore(rootDir);
  const events = new EventHub();
  const watcher = watchRoot(store, (changes) => events.send('fs', { changes }));

  return {
    store,
    async handle(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const p = url.pathname;
      try {
        if (p === '/api/events') {
          events.add(req, res);
          return true;
        }
        if (p.startsWith('/files/')) {
          sendFile(res, store.resolve(decodeURIComponent(p.slice('/files/'.length))));
          return true;
        }
        if (p.startsWith('/api/')) {
          await handleApi(req, res, url, store);
          return true;
        }
        return false;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Paths that try to leave the review root are refused, not server errors.
        const forbidden = /escapes/.test(message);
        if (!forbidden) console.error('[asset-review]', message);
        if (!res.headersSent) send(res, forbidden ? 403 : 500, { error: forbidden ? 'forbidden' : message });
        else res.end();
        return true;
      }
    },
    async close() {
      events.close();
      await watcher.close();
    },
  };
}

// ------------------------------------------------------------------ live updates

/** Server-sent events: a long-lived GET the browser keeps open with EventSource. */
class EventHub {
  private clients = new Set<ServerResponse>();
  private heartbeat = setInterval(() => this.clients.forEach((c) => c.write(': ping\n\n')), 25_000);

  add(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  send(event: string, data: unknown) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients.forEach((c) => c.write(msg));
  }

  close() {
    clearInterval(this.heartbeat);
    this.clients.forEach((c) => c.end());
    this.clients.clear();
  }
}

export interface FsChange {
  path: string;
  type: string;
}

function watchRoot(store: ReviewStore, onChanges: (changes: FsChange[]) => void): FSWatcher {
  const watcher = watch(store.root, {
    ignoreInitial: true,
    ignored: (p: string) => {
      const rel = path.relative(store.root, p).split(path.sep).join('/');
      if (!rel || rel.startsWith('..')) return false;
      // Notes and config are watched so external edits (CLI replies, hand-edited config) show up live.
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
    onChanges(changes);
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
  return watcher;
}

// ------------------------------------------------------------------ API

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, store: ReviewStore) {
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
    return sendFile(res, store.resolve(url.searchParams.get('path') ?? ''));
  }

  if (route === '/blend' && method === 'GET') {
    const glb = await blendToGlb(store.resolve(url.searchParams.get('path') ?? ''), store.cacheDir());
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

// ------------------------------------------------------------------ helpers

export function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function sendFile(res: ServerResponse, abs: string, cache = 'no-store') {
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(res, 404, { error: 'not found' });
  const ext = path.extname(abs).slice(1).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', cache);
  fs.createReadStream(abs).pipe(res);
}

/** Join a request path onto a directory, refusing anything that escapes it. */
export function safeJoin(dir: string, rel: string): string {
  const base = path.resolve(dir);
  const abs = path.resolve(base, rel.replace(/^\/+/, ''));
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error(`path escapes ${dir}: ${rel}`);
  return abs;
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
