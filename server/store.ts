// Filesystem-backed review store. Used by the dev server and the CLI.
// Everything lives in <root>/.review so a project can commit (or ignore) it.
//
//   .review/notes/<id>.json      one file per note (easy to diff, no write races)
//   .review/shots/<id>.png       marked screenshot for a note
//   .review/shots/<id>.clean.png same frame without the marker / caption
//   .review/shots/shot-*.png     free screenshots (P)
//   .review/assets.json          per-asset settings (status, layout, view prefs)
//   .review/cache/               converted .blend -> .glb etc.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  AssetEntry,
  AssetKind,
  AssetSettings,
  Note,
  NoteReply,
  NoteStatus,
  ReviewConfig,
} from '../shared/types.ts';

export const MODEL_EXTS = ['glb', 'gltf', 'fbx', 'obj', 'vox', 'blend'];
export const IMAGE_EXTS = ['png', 'webp', 'gif', 'jpg', 'jpeg'];
export const ASEPRITE_EXTS = ['aseprite', 'ase'];

const DEFAULT_IGNORES = ['node_modules', '.git', '.review', 'dist', '.vite', '.DS_Store', 'Library', 'Temp'];

export function kindForExt(ext: string): AssetKind | null {
  if (MODEL_EXTS.includes(ext)) return 'model';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (ASEPRITE_EXTS.includes(ext)) return 'aseprite';
  return null;
}

export class ReviewStore {
  readonly root: string;
  readonly dir: string;
  config: ReviewConfig;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.dir = path.join(this.root, '.review');
    this.config = this.loadConfig();
  }

  // ---------- paths ----------

  /** Resolve a root-relative path, refusing anything that escapes the root. */
  resolve(rel: string): string {
    const abs = path.resolve(this.root, rel.replace(/^\/+/, ''));
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error(`path escapes review root: ${rel}`);
    }
    return abs;
  }

  relative(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  private ensureDir(sub: string): string {
    const d = path.join(this.dir, sub);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /** The config file in use (or where a new one will be created). */
  configPath(): string {
    for (const name of ['review.config.json', '.review/config.json']) {
      const p = path.join(this.root, name);
      if (fs.existsSync(p)) return p;
    }
    return path.join(this.root, 'review.config.json');
  }

  /**
   * Merge a patch into the config file, keeping everything else in it. `lighting` is merged
   * per preset; a preset set to null is removed.
   */
  updateConfig(patch: Partial<ReviewConfig>): ReviewConfig {
    const file = this.configPath();
    let current: ReviewConfig = {};
    if (fs.existsSync(file)) current = JSON.parse(fs.readFileSync(file, 'utf8'));
    const next: ReviewConfig = { ...current, ...patch };
    if (patch.lighting) {
      const lighting = { ...current.lighting, ...patch.lighting };
      for (const [k, v] of Object.entries(lighting)) if (v === null) delete lighting[k];
      next.lighting = lighting;
      if (!Object.keys(lighting).length) delete next.lighting;
    }
    atomicWrite(file, JSON.stringify(next, null, 2) + '\n');
    this.config = next;
    return next;
  }

  loadConfig(): ReviewConfig {
    for (const name of ['review.config.json', '.review/config.json']) {
      const p = path.join(this.root, name);
      if (fs.existsSync(p)) {
        try {
          return JSON.parse(fs.readFileSync(p, 'utf8')) as ReviewConfig;
        } catch (err) {
          console.warn(`[asset-review] could not parse ${p}:`, err);
        }
      }
    }
    return {};
  }

  isIgnored(rel: string): boolean {
    const parts = rel.split('/');
    const ignores = [...DEFAULT_IGNORES, ...(this.config.ignore ?? [])];
    return parts.some((p) => ignores.includes(p)) || ignores.some((i) => i.includes('/') && rel.startsWith(i));
  }

  // ---------- assets ----------

  listAssets(): AssetEntry[] {
    const out: AssetEntry[] = [];
    const walk = (dirAbs: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(dirAbs, e.name);
        const rel = this.relative(abs);
        if (this.isIgnored(rel)) continue;
        if (e.isDirectory()) {
          walk(abs);
          continue;
        }
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).slice(1).toLowerCase();
        const kind = kindForExt(ext);
        if (!kind) continue;
        // Blender autosave / backup files
        if (/\.blend\d+$/.test(e.name)) continue;
        const st = fs.statSync(abs);
        const entry: AssetEntry = { path: rel, kind, ext, size: st.size, mtime: st.mtimeMs };
        const sidecar = abs.slice(0, -ext.length - 1) + '.json';
        if (kind === 'image' && fs.existsSync(sidecar)) entry.sidecar = this.relative(sidecar);
        out.push(entry);
      }
    };
    walk(this.root);
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }

  mtimeOf(rel: string): number {
    try {
      return fs.statSync(this.resolve(rel)).mtimeMs;
    } catch {
      return 0;
    }
  }

  // ---------- per-asset settings ----------

  private settingsPath(): string {
    return path.join(this.dir, 'assets.json');
  }

  readAllSettings(): Record<string, AssetSettings> {
    try {
      return JSON.parse(fs.readFileSync(this.settingsPath(), 'utf8'));
    } catch {
      return {};
    }
  }

  writeSettings(asset: string, patch: AssetSettings): AssetSettings {
    const all = this.readAllSettings();
    const next: AssetSettings = { ...all[asset], ...patch };
    for (const k of Object.keys(next) as (keyof AssetSettings)[]) {
      if (next[k] === null) delete next[k];
    }
    all[asset] = next;
    fs.mkdirSync(this.dir, { recursive: true });
    const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
    atomicWrite(this.settingsPath(), JSON.stringify(sorted, null, 2) + '\n');
    return next;
  }

  // ---------- notes ----------

  private notePath(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`bad note id: ${id}`);
    return path.join(this.dir, 'notes', `${id}.json`);
  }

  listNotes(): Note[] {
    const d = path.join(this.dir, 'notes');
    if (!fs.existsSync(d)) return [];
    const notes: Note[] = [];
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      try {
        notes.push(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
      } catch (err) {
        console.warn(`[asset-review] skipping unreadable note ${f}:`, err);
      }
    }
    notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return notes;
  }

  getNote(id: string): Note | null {
    try {
      return JSON.parse(fs.readFileSync(this.notePath(id), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Accepts a full id or a unique prefix (handy from the CLI). */
  findNote(idOrPrefix: string): Note | null {
    const exact = this.getNote(idOrPrefix);
    if (exact) return exact;
    const matches = this.listNotes().filter((n) => n.id.startsWith(idOrPrefix));
    return matches.length === 1 ? matches[0] : null;
  }

  createNote(input: {
    asset: string;
    text: string;
    author?: string;
    markers?: Note['markers'];
    view?: Note['view'];
    info?: Note['info'];
    screenshotPng?: Buffer;
    cleanScreenshotPng?: Buffer;
  }): Note {
    const now = new Date();
    const id = makeId(now);
    const note: Note = {
      id,
      asset: input.asset,
      assetMtime: this.mtimeOf(input.asset),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      author: input.author || this.defaultAuthor(),
      text: input.text,
      status: 'open',
      markers: input.markers ?? [],
      view: input.view,
      ...(input.info ? { info: input.info } : {}),
      replies: [],
    };
    if (input.screenshotPng) {
      const shots = this.ensureDir('shots');
      fs.writeFileSync(path.join(shots, `${id}.png`), input.screenshotPng);
      note.screenshot = `.review/shots/${id}.png`;
    }
    if (input.cleanScreenshotPng) {
      const shots = this.ensureDir('shots');
      fs.writeFileSync(path.join(shots, `${id}.clean.png`), input.cleanScreenshotPng);
      note.cleanScreenshot = `.review/shots/${id}.clean.png`;
    }
    this.saveNote(note);
    return note;
  }

  saveNote(note: Note): void {
    this.ensureDir('notes');
    atomicWrite(this.notePath(note.id), JSON.stringify(note, null, 2) + '\n');
  }

  updateNote(
    id: string,
    patch: { text?: string; status?: NoteStatus; reply?: { author?: string; text: string } },
  ): Note {
    const note = this.findNote(id);
    if (!note) throw new Error(`note not found: ${id}`);
    if (patch.text !== undefined) note.text = patch.text;
    if (patch.status) note.status = patch.status;
    if (patch.reply?.text) {
      const reply: NoteReply = {
        author: patch.reply.author || this.defaultAuthor(),
        at: new Date().toISOString(),
        text: patch.reply.text,
      };
      note.replies.push(reply);
    }
    note.updatedAt = new Date().toISOString();
    this.saveNote(note);
    return note;
  }

  deleteNote(id: string): void {
    const note = this.findNote(id);
    if (!note) return;
    fs.rmSync(this.notePath(note.id), { force: true });
    for (const s of [note.screenshot, note.cleanScreenshot]) {
      if (s) fs.rmSync(this.resolve(s), { force: true });
    }
  }

  saveScreenshot(png: Buffer, asset?: string): string {
    const shots = this.ensureDir('shots');
    const base = asset ? path.basename(asset).replace(/[^\w.-]+/g, '_') + '-' : '';
    const name = `shot-${base}${makeId(new Date())}.png`;
    fs.writeFileSync(path.join(shots, name), png);
    return `.review/shots/${name}`;
  }

  saveUpload(relPath: string, data: Buffer): string {
    const safe = relPath
      .split('/')
      .filter((p) => p && p !== '.' && p !== '..')
      .join('/');
    const abs = this.resolve(path.posix.join('_inbox', safe));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
    return this.relative(abs);
  }

  cacheDir(): string {
    return this.ensureDir('cache');
  }

  defaultAuthor(): string {
    return process.env.REVIEW_AUTHOR || this.config.author || process.env.USER || 'reviewer';
  }
}

function makeId(d: Date): string {
  const stamp = d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // yyyymmddhhmmss
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function atomicWrite(file: string, content: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function decodeDataUrl(dataUrl: string): Buffer {
  const m = /^data:[^;]+;base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('expected a base64 data URL');
  return Buffer.from(m[1], 'base64');
}
