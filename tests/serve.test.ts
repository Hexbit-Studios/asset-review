import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer, type RunningServer } from '../server/serve.ts';

// Production host: prebuilt UI + review backend on node:http.
let root: string;
let clientDir: string;
let server: RunningServer;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-review-serve-'));
  fs.mkdirSync(path.join(root, 'sprites'));
  fs.writeFileSync(path.join(root, 'sprites/hero.png'), 'png-bytes');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'nope');
  // Minimal stand-in for the Vite build so the test doesn't depend on `pnpm build`.
  clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-review-client-'));
  fs.mkdirSync(path.join(clientDir, 'assets'));
  fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>asset-review</title>');
  fs.writeFileSync(path.join(clientDir, 'assets/app-abc123.js'), 'console.log(1)');
  server = await startServer({ root, clientDir, port: 0, open: false });
});

afterAll(async () => {
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(clientDir, { recursive: true, force: true });
});

const get = async (p: string) => {
  const res = await fetch(new URL(p, server.url));
  return { status: res.status, type: res.headers.get('content-type') ?? '', cache: res.headers.get('cache-control') ?? '', body: await res.text() };
};

describe('production server', () => {
  it('serves the UI shell and long-caches hashed assets', async () => {
    expect((await get('/')).body).toContain('<title>asset-review</title>');
    const asset = await get('/assets/app-abc123.js');
    expect(asset.type).toContain('javascript');
    expect(asset.cache).toContain('immutable');
    expect((await get('/some/client/route')).body).toContain('<title>'); // app shell fallback
  });

  it('serves the review API and root files', async () => {
    const info = JSON.parse((await get('/api/info')).body);
    expect(info.rootName).toBe(path.basename(root));
    const { assets } = JSON.parse((await get('/api/assets')).body);
    expect(assets.map((a: { path: string }) => a.path)).toEqual(['sprites/hero.png']);
    expect((await get('/files/sprites/hero.png')).body).toBe('png-bytes');
  });

  it('refuses paths outside the review root', async () => {
    const res = await new Promise<number>((resolve) =>
      http.get(new URL('/files/..%2F..%2Fetc%2Fpasswd', server.url), (r) => resolve(r.statusCode ?? 0)),
    );
    expect(res).toBe(403);
  });

  it('streams file changes over server-sent events', async () => {
    const controller = new AbortController();
    const res = await fetch(new URL('/api/events', server.url), { signal: controller.signal });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // Let the watcher settle, then add an asset.
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(path.join(root, 'sprites/new.png'), 'x');
    const deadline = Date.now() + 5000;
    while (!buffer.includes('event: fs') && Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value?: Uint8Array; done: boolean }>((r) => setTimeout(() => r({ done: false }), 500)),
      ]);
      if (done) break;
      if (value) buffer += decoder.decode(value);
    }
    controller.abort();
    expect(buffer).toContain('event: fs');
    expect(buffer).toContain('sprites/new.png');
  });
});
