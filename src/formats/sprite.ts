// Turns image-ish files into a uniform SpriteAsset: a list of equally sized frame canvases
// plus named animations. Handles plain images, animated GIF/WebP, sheets with JSON,
// metadata-less grid sheets, sprite stacks, direction sheets and .aseprite files.

import type { ImageLayout } from '../../shared/types.ts';
import { parseAseprite, renderAseFrame, type AseFile } from './aseprite.ts';
import { gridRects, guessGrid, isSheetJson, parseSheetJson, type SheetAnimation } from './sheetJson.ts';

export interface SpriteFrame {
  canvas: HTMLCanvasElement;
  duration: number; // ms
}

export interface SpriteAnimation {
  name: string;
  frames: number[];
  direction: SheetAnimation['direction'];
}

export interface SpriteLayerInfo {
  index: number;
  name: string;
  depth: number;
  group: boolean;
  visible: boolean;
}

export interface SpriteAsset {
  source: 'image' | 'animated-image' | 'sheet-json' | 'grid' | 'stack' | 'directions' | 'aseprite';
  width: number;
  height: number;
  /** The untouched source image (for "show full sheet"). */
  sheet?: HTMLCanvasElement;
  frames: SpriteFrame[];
  animations: SpriteAnimation[];
  layout: ImageLayout;
  /** Aseprite only. */
  layers?: SpriteLayerInfo[];
  ase?: AseFile;
  notes: string[];
}

export async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.arrayBuffer();
}

function canvasFrom(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

function crop(src: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

async function decodeAnimated(buf: ArrayBuffer, type: string): Promise<SpriteFrame[] | null> {
  const ID = (globalThis as any).ImageDecoder;
  if (!ID) return null;
  try {
    if (!(await ID.isTypeSupported(type))) return null;
    const dec = new ID({ data: buf, type });
    await dec.tracks.ready;
    const count: number = dec.tracks.selectedTrack?.frameCount ?? 1;
    if (count <= 1) {
      dec.close();
      return null;
    }
    const frames: SpriteFrame[] = [];
    for (let i = 0; i < count; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      frames.push({
        canvas: canvasFrom(image, image.displayWidth, image.displayHeight),
        duration: image.duration ? image.duration / 1000 : 100,
      });
      image.close();
    }
    dec.close();
    return frames;
  } catch (err) {
    console.warn('ImageDecoder failed, falling back to a still image', err);
    return null;
  }
}

async function loadImage(buf: ArrayBuffer, type: string): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(new Blob([buf], { type }));
  const c = canvasFrom(bmp, bmp.width, bmp.height);
  bmp.close();
  return c;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** Infer a layout from file name conventions: foo.stack15.png, foo_stack.png, foo.dir8.png */
export function layoutFromName(path: string): ImageLayout | null {
  const name = path.split('/').pop()!.toLowerCase();
  const stack = /[._-]stack(\d+)?[._-]/.exec(name + '.');
  if (stack) return { mode: 'stack', slices: stack[1] ? Number(stack[1]) : undefined };
  const dirs = /[._-]dirs?(8|16|32)[._-]/.exec(name + '.');
  if (dirs) return { mode: 'directions', frameCount: Number(dirs[1]) };
  return null;
}

function sliceStack(sheet: HTMLCanvasElement, slices: number): SpriteFrame[] {
  const w = Math.floor(sheet.width / slices);
  return Array.from({ length: slices }, (_, i) => ({ canvas: crop(sheet, i * w, 0, w, sheet.height), duration: 100 }));
}

export async function loadImageSprite(opts: {
  url: string;
  ext: string;
  path: string;
  sidecarUrl?: string;
  layout?: ImageLayout;
}): Promise<SpriteAsset> {
  const type = MIME[opts.ext] ?? 'image/png';
  const buf = await fetchBuffer(opts.url);
  const notes: string[] = [];

  let sidecar: any = null;
  if (opts.sidecarUrl) {
    try {
      sidecar = await (await fetch(opts.sidecarUrl)).json();
    } catch {
      notes.push('Sidecar JSON could not be parsed');
    }
  }

  // Explicit layout (UI choice) > sidecar hints > filename convention > content sniffing.
  const sidecarLayout: ImageLayout | null =
    sidecar && !isSheetJson(sidecar)
      ? sidecar.stack
        ? { mode: 'stack', slices: sidecar.stack.slices ?? sidecar.slices }
        : sidecar.layout ?? null
      : null;
  let layout: ImageLayout | null = opts.layout ?? sidecarLayout ?? layoutFromName(opts.path);

  // Animated GIF / WebP
  if ((opts.ext === 'gif' || opts.ext === 'webp') && (!layout || layout.mode === 'single')) {
    const frames = await decodeAnimated(buf, type);
    if (frames) {
      return {
        source: 'animated-image',
        width: frames[0].canvas.width,
        height: frames[0].canvas.height,
        frames,
        animations: [{ name: 'animation', frames: frames.map((_, i) => i), direction: 'forward' }],
        layout: { mode: 'single' },
        notes,
      };
    }
  }

  const sheet = await loadImage(buf, type);

  if (sidecar && isSheetJson(sidecar) && !opts.layout) {
    const parsed = parseSheetJson(sidecar);
    const fw = Math.max(...parsed.frames.map((f) => f.sourceSize.w));
    const fh = Math.max(...parsed.frames.map((f) => f.sourceSize.h));
    const frames: SpriteFrame[] = parsed.frames.map((f) => {
      const c = document.createElement('canvas');
      c.width = fw;
      c.height = fh;
      const ctx = c.getContext('2d')!;
      if (f.rotated) {
        // TexturePacker rotates 90° clockwise in the atlas.
        ctx.save();
        ctx.translate(f.offset.x, f.offset.y + f.frame.w);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(sheet, f.frame.x, f.frame.y, f.frame.w, f.frame.h, 0, 0, f.frame.w, f.frame.h);
        ctx.restore();
      } else {
        ctx.drawImage(sheet, f.frame.x, f.frame.y, f.frame.w, f.frame.h, f.offset.x, f.offset.y, f.frame.w, f.frame.h);
      }
      return { canvas: c, duration: f.duration };
    });
    const animations = parsed.animations.length
      ? parsed.animations
      : [{ name: 'all frames', frames: frames.map((_, i) => i), direction: 'forward' as const }];
    return { source: 'sheet-json', width: fw, height: fh, sheet, frames, animations, layout: { mode: 'grid' }, notes };
  }

  if (layout?.mode === 'stack') {
    const slices = layout.slices ?? guessStackSlices(sheet);
    if (!layout.slices) notes.push(`Slice count guessed as ${slices}. Set it in the inspector if wrong.`);
    const frames = sliceStack(sheet, slices);
    return {
      source: 'stack',
      width: frames[0].canvas.width,
      height: sheet.height,
      sheet,
      frames,
      animations: [],
      layout: { mode: 'stack', slices },
      notes,
    };
  }

  if (layout?.mode === 'directions') {
    const count = layout.frameCount ?? 8;
    const cols = layout.cols ?? Math.min(count, 8);
    const rows = layout.rows ?? Math.ceil(count / cols);
    const frames = gridRects(sheet.width, sheet.height, cols, rows, count).map((r) => ({
      canvas: crop(sheet, r.x, r.y, r.w, r.h),
      duration: 100,
    }));
    return {
      source: 'directions',
      width: frames[0].canvas.width,
      height: frames[0].canvas.height,
      sheet,
      frames,
      animations: [{ name: 'spin', frames: frames.map((_, i) => i), direction: 'forward' }],
      layout: { mode: 'directions', frameCount: count, cols, rows },
      notes,
    };
  }

  if (layout?.mode === 'grid') {
    const g = layout.cols && layout.rows ? { cols: layout.cols, rows: layout.rows } : guessGrid(sheet.width, sheet.height);
    const rects = gridRects(sheet.width, sheet.height, g.cols, g.rows, layout.frameCount);
    const dur = 1000 / (layout.fps ?? 10);
    const frames = rects.map((r) => ({ canvas: crop(sheet, r.x, r.y, r.w, r.h), duration: dur }));
    return {
      source: 'grid',
      width: rects[0].w,
      height: rects[0].h,
      sheet,
      frames,
      animations: [{ name: 'all frames', frames: frames.map((_, i) => i), direction: 'forward' }],
      layout: { mode: 'grid', cols: g.cols, rows: g.rows, frameCount: frames.length, fps: layout.fps ?? 10 },
      notes,
    };
  }

  // Single still image. Hint when it looks like an unlabelled strip.
  const g = guessGrid(sheet.width, sheet.height);
  if (g.cols * g.rows > 1) notes.push(`Looks like a ${g.cols}×${g.rows} strip. Switch layout to "grid" to animate it.`);
  return {
    source: 'image',
    width: sheet.width,
    height: sheet.height,
    sheet,
    frames: [{ canvas: sheet, duration: 100 }],
    animations: [],
    layout: { mode: 'single' },
    notes,
  };
}

/** Stack slices are usually narrower than tall (cars) or square; prefer an integer split. */
function guessStackSlices(sheet: HTMLCanvasElement): number {
  if (sheet.width % sheet.height === 0) return sheet.width / sheet.height;
  for (let n = Math.round(sheet.width / sheet.height); n < 128; n++) if (sheet.width % n === 0) return n;
  return 1;
}

export async function loadAsepriteSprite(url: string, layerVisibility?: Map<number, boolean>): Promise<SpriteAsset> {
  const file = await parseAseprite(await fetchBuffer(url));
  return spriteFromAse(file, layerVisibility);
}

export function spriteFromAse(file: AseFile, layerVisibility?: Map<number, boolean>): SpriteAsset {
  const frames: SpriteFrame[] = file.frameDurations.map((duration, i) => ({
    canvas: renderAseFrame(file, i, layerVisibility),
    duration,
  }));
  const animations: SpriteAnimation[] = file.tags.map((t) => ({
    name: t.name,
    frames: range(t.from, t.to),
    direction: t.direction,
  }));
  if (!animations.length || frames.length > 1)
    animations.unshift({ name: 'all frames', frames: frames.map((_, i) => i), direction: 'forward' });
  const notes: string[] = [];
  if (file.pixelRatio[0] !== file.pixelRatio[1]) notes.push(`Non-square pixel ratio ${file.pixelRatio.join(':')}`);
  if (file.layers.some((l) => l.type === 'tilemap')) notes.push('Tilemap layers are not rendered');
  return {
    source: 'aseprite',
    width: file.width,
    height: file.height,
    frames,
    animations,
    layout: { mode: 'single' },
    layers: file.layers.map((l) => ({
      index: l.index,
      name: l.name,
      depth: l.childLevel,
      group: l.type === 'group',
      visible: layerVisibility?.get(l.index) ?? (l.flags & 1) !== 0,
    })),
    ase: file,
    notes,
  };
}

function range(a: number, b: number) {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
