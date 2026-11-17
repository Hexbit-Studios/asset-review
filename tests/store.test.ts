import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReviewStore } from '../server/store.ts';

const dirs: string[] = [];
function tmpRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-review-'));
  dirs.push(d);
  return d;
}
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe('ReviewStore', () => {
  it('lists assets, skipping ignored dirs and blend backups, and finds sidecars', () => {
    const root = tmpRoot();
    for (const f of ['a/hero.png', 'a/hero.json', 'm/car.glb', 'm/car.blend', 'm/car.blend1', 'node_modules/x.png', '.review/shots/s.png', 'readme.md'])
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }), fs.writeFileSync(path.join(root, f), 'x');
    const store = new ReviewStore(root);
    const list = store.listAssets();
    expect(list.map((a) => a.path)).toEqual(['a/hero.png', 'm/car.blend', 'm/car.glb']);
    expect(list[0].sidecar).toBe('a/hero.json');
  });

  it('refuses paths outside the root', () => {
    const store = new ReviewStore(tmpRoot());
    expect(() => store.resolve('../etc/passwd')).toThrow(/escapes/);
    expect(() => store.resolve('a/../../x')).toThrow(/escapes/);
  });

  it('creates, replies to, resolves and deletes notes', () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, 'car.png'), 'x');
    const store = new ReviewStore(root);
    const png = Buffer.from('fakepng');
    const note = store.createNote({ asset: 'car.png', text: 'wheels too big', author: 'reviewer', markers: [{ x: 0.5, y: 0.5 }], screenshotPng: png });
    expect(note.status).toBe('open');
    expect(fs.existsSync(store.resolve(note.screenshot!))).toBe(true);
    expect(note.assetMtime).toBeGreaterThan(0);

    const updated = store.updateNote(note.id.slice(0, 16), { status: 'addressed', reply: { author: 'claude', text: 'shrunk 20%' } });
    expect(updated.status).toBe('addressed');
    expect(updated.replies[0]).toMatchObject({ author: 'claude', text: 'shrunk 20%' });
    expect(store.listNotes()).toHaveLength(1);

    store.deleteNote(note.id);
    expect(store.listNotes()).toHaveLength(0);
    expect(fs.existsSync(store.resolve(note.screenshot!))).toBe(false);
  });

  it('keeps the info item a note is about', () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, 'car.glb'), 'x');
    const store = new ReviewStore(root);
    const note = store.createNote({ asset: 'car.glb', text: 'too dense', info: { key: 'Texel density: body', label: 'body', value: '320.8 px/m' } });
    expect(store.getNote(note.id)?.info).toEqual({ key: 'Texel density: body', label: 'body', value: '320.8 px/m' });
    expect(store.createNote({ asset: 'car.glb', text: 'plain' })).not.toHaveProperty('info');
  });

  it('merges and clears per-asset settings', () => {
    const store = new ReviewStore(tmpRoot());
    store.writeSettings('a.png', { status: 'approved', layout: { mode: 'stack', slices: 8 } });
    store.writeSettings('a.png', { layout: null });
    expect(store.readAllSettings()).toEqual({ 'a.png': { status: 'approved' } });
  });

  it('keeps uploads inside _inbox', () => {
    const store = new ReviewStore(tmpRoot());
    expect(store.saveUpload('../../evil/x.png', Buffer.from('x'))).toBe('_inbox/evil/x.png');
  });

  it('merges lighting presets into review.config.json without touching other keys', () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, 'review.config.json'), JSON.stringify({ name: 'Game', texelDensity: 64 }));
    const store = new ReviewStore(root);
    const rig = { exposure: 1.2 } as any;
    store.updateConfig({ lighting: { night: rig } });
    store.updateConfig({ lighting: { day: { exposure: 0.9 } as any } });
    let cfg = JSON.parse(fs.readFileSync(path.join(root, 'review.config.json'), 'utf8'));
    expect(cfg).toMatchObject({ name: 'Game', texelDensity: 64, lighting: { night: { exposure: 1.2 }, day: { exposure: 0.9 } } });
    store.updateConfig({ lighting: { night: null, day: null } as any });
    cfg = JSON.parse(fs.readFileSync(path.join(root, 'review.config.json'), 'utf8'));
    expect(cfg).toEqual({ name: 'Game', texelDensity: 64 });
    expect(store.config).toEqual(cfg);
  });

  it('creates review.config.json when there is none', () => {
    const root = tmpRoot();
    new ReviewStore(root).updateConfig({ lighting: { night: { exposure: 2 } as any } });
    expect(JSON.parse(fs.readFileSync(path.join(root, 'review.config.json'), 'utf8'))).toEqual({ lighting: { night: { exposure: 2 } } });
  });
});
