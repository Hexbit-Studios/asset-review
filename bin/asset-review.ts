#!/usr/bin/env node
// asset-review CLI.
//
//   asset-review [dir] [--port 5199] [--no-open] [--host]   start the viewer for a folder
//   asset-review notes [dir] [--all] [--status s] [--asset p] [--json]
//   asset-review reply <id> "text" [--status addressed] [--dir d] [--author name]
//   asset-review status <id> <open|addressed|resolved|wontfix> [--dir d]
//
// Runs on Node >= 22.18 (native TypeScript type stripping).

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ReviewStore } from '../server/store.ts';
import type { Note, NoteStatus } from '../shared/types.ts';

const toolDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATUSES: NoteStatus[] = ['open', 'addressed', 'resolved', 'wontfix'];

interface Parsed {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--') && !['all', 'json', 'no-open', 'host', 'help'].includes(k))
        flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function usage(): never {
  console.log(`asset-review — review meshes, sprites, sprite stacks and Aseprite files, with screenshot notes

  asset-review [dir] [--port 5199] [--no-open] [--host]
  asset-review notes [dir] [--all] [--status open] [--asset path] [--json]
  asset-review reply <id> "text" [--status addressed] [--dir dir] [--author name]
  asset-review status <id> <open|addressed|resolved|wontfix> [--dir dir]

Notes, screenshots and per-asset settings are stored in <dir>/.review/.`);
  process.exit(0);
}

async function serve(dir: string, flags: Parsed['flags']) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) {
    console.error(`No such directory: ${root}`);
    process.exit(1);
  }
  process.env.ASSET_REVIEW_ROOT = root;
  const { createServer } = await import('vite');
  const server = await createServer({
    root: toolDir,
    configFile: path.join(toolDir, 'vite.config.ts'),
    server: {
      port: flags.port ? Number(flags.port) : 5199,
      strictPort: false,
      open: !flags['no-open'],
      host: flags.host ? true : undefined,
    },
  });
  await server.listen();
  console.log(`\n  asset-review  →  ${root}\n`);
  server.printUrls();
}

function formatNote(n: Note, store: ReviewStore): string {
  const changed = store.mtimeOf(n.asset) > n.assetMtime + 1;
  const lines = [
    `## ${n.id}  [${n.status}]${changed ? '  (asset changed since note)' : ''}`,
    `- asset: ${n.asset}`,
    `- by ${n.author} at ${n.createdAt}`,
  ];
  if (n.info) lines.push(`- about: ${n.info.key} = ${n.info.value}`);
  if (n.screenshot) lines.push(`- screenshot: ${store.resolve(n.screenshot)}`);
  if (n.cleanScreenshot) lines.push(`- clean: ${store.resolve(n.cleanScreenshot)}`);
  if (n.markers.length)
    lines.push(`- markers: ${n.markers.map((m) => `(${m.x.toFixed(3)}, ${m.y.toFixed(3)})`).join(' ')}`);
  if (n.view) lines.push(`- view: ${JSON.stringify(n.view)}`);
  lines.push('', n.text.trim() || '(no text)');
  for (const r of n.replies) lines.push('', `> **${r.author}** (${r.at}): ${r.text.replace(/\n/g, '\n> ')}`);
  return lines.join('\n');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') usage();

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
    const author = typeof flags.author === 'string' ? flags.author : cmd === 'reply' ? 'claude' : undefined;
    const note = store.updateNote(id, {
      status: status || undefined,
      reply: cmd === 'reply' && arg ? { author, text: arg } : undefined,
    });
    console.log(formatNote(note, store));
    return;
  }

  const { positional, flags } = parseArgs(cmd ? [cmd, ...rest] : rest);
  if (flags.help) usage();
  await serve(positional[0] ?? '.', flags);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
