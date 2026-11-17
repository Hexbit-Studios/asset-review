// Generates example assets covering every loader path. Run: pnpm fixtures [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Pixels, hex } from './lib/png.ts';
import { writeAseprite } from './lib/aseWriter.ts';
import { findBlender } from '../server/blender.ts';

const out = path.resolve(process.argv[2] ?? 'examples');
const here = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(path.join(out, 'sprites'), { recursive: true });
fs.mkdirSync(path.join(out, 'stacks'), { recursive: true });
fs.mkdirSync(path.join(out, 'models'), { recursive: true });

// ---------------------------------------------------------------- aseprite: blinking drone

{
  const W = 16,
    H = 16;
  const frame = (fn: (p: Pixels) => void) => {
    const p = new Pixels(W, H);
    fn(p);
    return p.data;
  };
  const bg = frame((p) => p.rect(0, 13, 16, 3, hex('#2b2b3a')));
  const body = (eye: string, lid: number) =>
    frame((p) => {
      p.rect(3, 4, 10, 8, hex('#3a3f5c'));
      p.rect(4, 5, 8, 6, hex('#566089'));
      p.rect(5, 6, 6, 3 - lid, hex(eye));
      p.rect(2, 2, 1, 3, hex('#9aa3c7'));
      p.rect(13, 2, 1, 3, hex('#9aa3c7'));
    });
  const glow = frame((p) => p.rect(4, 5, 8, 4, [255, 43, 214, 90]));
  const ase = writeAseprite({
    width: W,
    height: H,
    frames: [200, 200, 80, 80],
    layers: [
      { name: 'ground' },
      { name: 'fx', group: true },
      { name: 'glow', childLevel: 1, visible: false },
      { name: 'body' },
    ],
    cels: [
      { layer: 0, frame: 0, x: 0, y: 0, w: W, h: H, rgba: bg },
      { layer: 0, frame: 1, x: 0, y: 0, w: W, h: H, linkFrame: 0 },
      { layer: 0, frame: 2, x: 0, y: 0, w: W, h: H, linkFrame: 0 },
      { layer: 0, frame: 3, x: 0, y: 0, w: W, h: H, linkFrame: 0 },
      ...[0, 1, 2, 3].map((f) => ({ layer: 2, frame: f, x: 0, y: 0, w: W, h: H, rgba: glow })),
      { layer: 3, frame: 0, x: 0, y: 0, w: W, h: H, rgba: body('#22e5ff', 0) },
      { layer: 3, frame: 1, x: 0, y: -1, w: W, h: H, rgba: body('#22e5ff', 0) },
      { layer: 3, frame: 2, x: 0, y: 0, w: W, h: H, rgba: body('#22e5ff', 2), compressed: false },
      { layer: 3, frame: 3, x: 0, y: 0, w: W, h: H, rgba: body('#ff2bd6', 3) },
    ],
    tags: [
      { name: 'hover', from: 0, to: 1 },
      { name: 'blink', from: 1, to: 3, direction: 2 },
    ],
  });
  fs.writeFileSync(path.join(out, 'sprites/drone.aseprite'), ase);
}

// ---------------------------------------------------------------- sheet + Aseprite JSON: runner

{
  const FW = 16,
    FH = 24,
    N = 6;
  const sheet = new Pixels(FW * N, FH);
  const frames: Record<string, unknown> = {};
  for (let i = 0; i < N; i++) {
    const p = new Pixels(FW, FH);
    const bob = [0, 1, 2, 1, 0, 1][i];
    const legA = [0, 2, 4, 2, 0, -2][i];
    p.rect(5, 2 + bob, 6, 6, hex('#f2c7a5')); // head
    p.rect(4, 8 + bob, 8, 8, hex('#ff2bd6')); // jacket
    p.rect(6, 9 + bob, 4, 2, hex('#22e5ff')); // neon trim
    p.rect(5 + Math.max(0, legA / 2), 16 + bob, 2, 7 - bob, hex('#2b2b3a'));
    p.rect(9 - Math.max(0, -legA / 2), 16 + bob, 2, 7 - bob, hex('#3a3a50'));
    sheet.blit(p, i * FW, 0);
    frames[`runner ${i}.aseprite`] = {
      frame: { x: i * FW, y: 0, w: FW, h: FH },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: FW, h: FH },
      sourceSize: { w: FW, h: FH },
      duration: 90,
    };
  }
  fs.writeFileSync(path.join(out, 'sprites/runner.png'), sheet.png());
  fs.writeFileSync(
    path.join(out, 'sprites/runner.json'),
    JSON.stringify(
      {
        frames,
        meta: {
          app: 'https://www.aseprite.org/',
          image: 'runner.png',
          size: { w: FW * N, h: FH },
          frameTags: [
            { name: 'run', from: 0, to: 5, direction: 'forward' },
            { name: 'bob', from: 0, to: 2, direction: 'pingpong' },
          ],
        },
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------- unlabelled strip: spinning chip

{
  const S = 16,
    N = 8;
  const sheet = new Pixels(S * N, S);
  for (let i = 0; i < N; i++) {
    const w = Math.max(1, Math.round(Math.abs(Math.cos((i / N) * Math.PI)) * 12));
    sheet.rect(i * S + 8 - Math.ceil(w / 2), 2, w, 12, hex('#ffd23f'));
    sheet.rect(i * S + 8 - Math.ceil(w / 2), 2, Math.max(1, Math.floor(w / 3)), 12, hex('#fff3b0'));
  }
  fs.writeFileSync(path.join(out, 'sprites/chip_spin.png'), sheet.png());
}

// ---------------------------------------------------------------- sprite stack: neon hover car

{
  const W = 24,
    L = 43,
    N = 15;
  const sheet = new Pixels(W * N, L);
  const bodyCol = (z: number) => {
    const shade = 0.6 + (z / N) * 0.6;
    return [Math.round(150 * shade), Math.round(40 * shade), Math.round(170 * shade), 255] as [number, number, number, number];
  };
  const roundRect = (p: Pixels, x: number, y: number, w: number, h: number, r: number, c: [number, number, number, number]) => {
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const dx = Math.max(r - xx - 0.5, xx + 0.5 - (w - r), 0);
        const dy = Math.max(r - yy - 0.5, yy + 0.5 - (h - r), 0);
        if (dx * dx + dy * dy <= r * r) p.set(x + xx, y + yy, c);
      }
  };
  for (let z = 0; z < N; z++) {
    const p = new Pixels(W, L);
    if (z <= 1) {
      // wheels + undercarriage
      for (const [x, y] of [
        [1, 6],
        [W - 5, 6],
        [1, L - 13],
        [W - 5, L - 13],
      ])
        p.rect(x, y, 4, 8, hex(z === 0 ? '#111118' : '#24242e'));
      p.rect(5, 4, W - 10, L - 8, hex('#1b1b24'));
    } else if (z <= 7) {
      roundRect(p, 1, 1, W - 2, L - 2, 4, bodyCol(z));
      if (z >= 3) p.rect(1, 17, W - 2, 1, hex('#22e5ff')); // side neon line
      if (z === 6 || z === 7) {
        p.rect(3, L - 3, 5, 2, hex('#fff6c2')); // headlights (front = bottom of slice)
        p.rect(W - 8, L - 3, 5, 2, hex('#fff6c2'));
        p.rect(3, 1, 6, 1, hex('#ff3355')); // tail lights
        p.rect(W - 9, 1, 6, 1, hex('#ff3355'));
      }
    } else if (z <= 11) {
      roundRect(p, 3, 9, W - 6, 22, 3, hex('#2a8fb0'));
      roundRect(p, 5, 11, W - 10, 18, 2, bodyCol(z));
      p.rect(3, 24, W - 6, 6, hex('#7ff3ff')); // windscreen band
    } else if (z <= 13) {
      roundRect(p, 5, 11, W - 10, 18, 2, bodyCol(z));
      if (z === 13) p.rect(7, 14, W - 14, 1, hex('#ff2bd6'));
    } else {
      p.rect(8, 13, W - 16, 2, hex('#ff2bd6'));
      p.rect(W / 2 - 1, 22, 2, 2, hex('#22e5ff'));
    }
    sheet.blit(p, z * W, 0);
  }
  fs.writeFileSync(path.join(out, 'stacks/hovercar.stack15.png'), sheet.png());
}

// ---------------------------------------------------------------- sprite stack: crate with sidecar

{
  const S = 14,
    N = 12;
  const sheet = new Pixels(S * N, S);
  for (let z = 0; z < N; z++) {
    const edge = z === 0 || z === N - 1;
    const p = new Pixels(S, S);
    p.rect(0, 0, S, S, hex(edge ? '#6b4a2b' : '#8a5f37'));
    if (!edge) p.rect(1, 1, S - 2, S - 2, [0, 0, 0, 0]);
    if (edge) {
      p.rect(2, 2, S - 4, S - 4, hex('#a8743f'));
      p.rect(2, S / 2 - 1, S - 4, 2, hex('#6b4a2b'));
    }
    if (!edge && (z === 3 || z === 8)) p.rect(0, 0, S, S, hex('#b0b8c8'));
    if (!edge && !(z === 3 || z === 8)) {
      // hollow walls with a band
      p.rect(1, 1, S - 2, S - 2, [0, 0, 0, 0]);
    }
    sheet.blit(p, z * S, 0);
  }
  fs.writeFileSync(path.join(out, 'stacks/crate.png'), sheet.png());
  fs.writeFileSync(path.join(out, 'stacks/crate.json'), JSON.stringify({ stack: { slices: N } }, null, 2));
}

// ---------------------------------------------------------------- Blender: animated turret + skinned android (.glb + .blend)

const blender = findBlender();
if (blender) {
  for (const name of ['turret', 'android']) {
    const script = path.join(here, `blender/${name}.py`);
    const res = spawnSync(blender, ['--background', '--factory-startup', '--python', script, '--', path.join(out, 'models')], {
      encoding: 'utf8',
    });
    if (res.status !== 0 || /Traceback/.test(res.stdout + res.stderr)) {
      console.error(res.stdout.slice(-3000), res.stderr.slice(-3000));
      process.exit(1);
    }
    console.log(`Blender ${name} written`);
  }
} else {
  console.warn('Blender not found; skipping model fixtures');
}

console.log(`Fixtures written to ${out}`);
