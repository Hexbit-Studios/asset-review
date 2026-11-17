#!/usr/bin/env node
// asset-review CLI.
//
//   asset-review [dir] [--port 5199] [--no-open] [--host] [--dev]   start the viewer for a folder
//   asset-review init [dir]                                          set a project up for reviews
//   asset-review notes [dir] [--all] [--status s] [--asset p] [--json]
//   asset-review reply <id> "text" [--status addressed] [--dir d] [--author name]
//   asset-review status <id> <open|addressed|resolved|wontfix> [--dir d]

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ReviewStore } from '../server/store.ts';
import type { Note, NoteStatus } from '../shared/types.ts';

const STATUSES: NoteStatus[] = ['open', 'addressed', 'resolved', 'wontfix'];

/** The package root (works from source, from the compiled dist/, and when installed from npm). */
function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).name === '@hexbit/asset-review') return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error('Could not find the asset-review package root');
    dir = up;
  }
}

function version(): string {
  return JSON.parse(fs.readFileSync(path.join(packageRoot(), 'package.json'), 'utf8')).version;
}

interface Parsed {
  positional: string[];
  flags: Record<string, string | boolean>;
}

const BOOLEAN_FLAGS = ['all', 'json', 'no-open', 'host', 'help', 'dev', 'version'];

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--') && !BOOLEAN_FLAGS.includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function usage(): never {
  console.log(`asset-review ${version()}: review meshes, sprites, sprite stacks and Aseprite files, with screenshot notes

  asset-review [dir]          open the viewer for a folder (default: current folder)
      --port 5199             first port to try
      --host                  listen on all interfaces (review from another machine)
      --no-open               don't open a browser
  asset-review init [dir]     set a project up for reviews (.gitignore, review.config.json)
  asset-review notes [dir]    list notes as markdown  [--all] [--status open,addressed] [--asset path] [--json]
  asset-review reply <id> "text" [--status addressed] [--author name] [--dir dir]
  asset-review status <id> <open|addressed|resolved|wontfix> [--dir dir]

Notes, screenshots and per-asset settings are stored in <dir>/.review/. Commit them to share reviews.`);
  process.exit(0);
}

async function serve(dir: string, flags: Parsed['flags']) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`No such directory: ${root}`);
    process.exit(1);
  }
  const pkgRoot = packageRoot();
  const clientDir = path.join(pkgRoot, 'dist/client');
  const port = flags.port ? Number(flags.port) : 5199;

  // --dev (or a source checkout without a build): Vite dev server with hot reload of the UI.
  if (flags.dev || !fs.existsSync(path.join(clientDir, 'index.html'))) {
    if (!flags.dev) console.log('No UI build found; starting the Vite dev server (run `pnpm build` for the production server).');
    process.env.ASSET_REVIEW_ROOT = root;
    const { createServer } = await import('vite');
    const server = await createServer({
      root: pkgRoot,
      configFile: path.join(pkgRoot, 'vite.config.ts'),
      server: { port, strictPort: false, open: !flags['no-open'], host: flags.host ? true : undefined },
    });
    await server.listen();
    console.log(`\n  asset-review (dev)  →  ${root}\n`);
    server.printUrls();
    return;
  }

  const { startServer } = await import('../server/serve.ts');
  const server = await startServer({
    root,
    clientDir,
    port,
    host: flags.host ? '0.0.0.0' : 'localhost',
    open: !flags['no-open'],
  });
  console.log(`\n  asset-review ${version()}  →  ${root}\n\n  ➜  ${server.url}\n`);
  const stop = () => void server.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

/** Prepare a project: ignore the conversion cache, add a starter config. Safe to run twice. */
function init(dir: string) {
  const root = path.resolve(dir);
  const done: string[] = [];

  const gitignore = path.join(root, '.gitignore');
  const lines = ['.review/cache/'];
  const existing = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  const missing = lines.filter((l) => !existing.split(/\r?\n/).includes(l));
  if (missing.length) {
    const block = `${existing && !existing.endsWith('\n') ? '\n' : ''}${existing ? '\n' : ''}# asset-review: converted .blend cache (notes and screenshots are meant to be committed)\n${missing.join('\n')}\n`;
    fs.appendFileSync(gitignore, block);
    done.push(`${existing ? 'updated' : 'created'} .gitignore`);
  }

  const config = path.join(root, 'review.config.json');
  if (!fs.existsSync(config)) {
    fs.writeFileSync(config, JSON.stringify({ name: path.basename(root), ignore: [] }, null, 2) + '\n');
    done.push('created review.config.json');
  }

  console.log(done.length ? `asset-review: ${done.join(', ')} in ${root}` : `asset-review: ${root} is already set up`);
  const open = dir === '.' ? 'asset-review' : `asset-review ${dir}`;
  console.log(`
Next:
  ${open.padEnd(22)}open the viewer and leave notes
  ${'git add .review'.padEnd(22)}share notes and screenshots with your team

Tip: on long projects, store screenshots with Git LFS:
  git lfs track ".review/shots/*.png"`);
}

function formatNote(n: Note, store: ReviewStore): string {
  const state = store.assetState(n);
  const flag = state === 'changed' ? '  (asset changed since note)' : state === 'missing' ? '  (asset missing: moved or deleted)' : '';
  const lines = [
    `## ${n.id}  [${n.status}]${flag}`,
    `- asset: ${n.asset}`,
    `- by ${n.author} at ${n.createdAt}`,
  ];
  if (n.info) lines.push(`- about: ${n.info.key} = ${n.info.value}`);
  if (n.screenshot) lines.push(`- screenshot: ${store.resolve(n.screenshot)}`);
  if (n.cleanScreenshot) lines.push(`- clean: ${store.resolve(n.cleanScreenshot)}`);
  if (n.markers.length) lines.push(`- markers: ${n.markers.map((m) => `(${m.x.toFixed(3)}, ${m.y.toFixed(3)})`).join(' ')}`);
  if (n.view) lines.push(`- view: ${JSON.stringify(n.view)}`);
  lines.push('', n.text.trim() || '(no text)');
  for (const r of n.replies) lines.push('', `> **${r.author}** (${r.at}): ${r.text.replace(/\n/g, '\n> ')}`);
  return lines.join('\n');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') usage();
  if (cmd === '--version' || cmd === '-v') {
    console.log(version());
    return;
  }

  if (cmd === 'init') {
    init(parseArgs(rest).positional[0] ?? '.');
    return;
  }

  if (cmd === 'notes') {
    const { positional, flags } = parseArgs(rest);
    const store = new ReviewStore(positional[0] ?? '.');
    let notes = store.listNotes();
    if (!flags.all) {
      const want = typeof flags.status === 'string' ? flags.status.split(',') : ['open'];
      notes = notes.filter((n) => want.includes(n.status));
    }
    if (typeof flags.asset === 'string') notes = notes.filter((n) => n.asset.includes(flags.asset as string));
    if (flags.json) {
      console.log(JSON.stringify(notes, null, 2));
      return;
    }
    if (!notes.length) {
      console.log('No matching notes.');
      return;
    }
    console.log(`# ${notes.length} note(s) in ${store.root}\n`);
    console.log(notes.map((n) => formatNote(n, store)).join('\n\n---\n\n'));
    return;
  }

  if (cmd === 'reply' || cmd === 'status') {
    const { positional, flags } = parseArgs(rest);
    const store = new ReviewStore(typeof flags.dir === 'string' ? flags.dir : '.');
    const [id, arg] = positional;
    if (!id) usage();
    const status = (cmd === 'status' ? arg : flags.status) as NoteStatus | undefined;
    if (status && !STATUSES.includes(status)) {
      console.error(`status must be one of ${STATUSES.join(', ')}`);
      process.exit(1);
    }
    const author = typeof flags.author === 'string' ? flags.author : undefined;
    const note = store.updateNote(id, {
      status: status || undefined,
      reply: cmd === 'reply' && arg ? { author, text: arg } : undefined,
    });
    console.log(formatNote(note, store));
    return;
  }

  const { positional, flags } = parseArgs(cmd ? [cmd, ...rest] : rest);
  if (flags.help) usage();
  if (flags.version) {
    console.log(version());
    return;
  }
  await serve(positional[0] ?? '.', flags);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
