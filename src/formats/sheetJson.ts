// Sprite sheet JSON (Aseprite "--data" export in hash or array form, TexturePacker / PixiJS JSON).
// Pure data parsing: returns frame rects + animations; the caller cuts the image.

export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetFrame {
  name: string;
  frame: SheetRect;
  rotated: boolean;
  /** Where the (possibly trimmed) frame goes within the untrimmed source size. */
  offset: { x: number; y: number };
  sourceSize: { w: number; h: number };
  duration: number;
}

export interface SheetAnimation {
  name: string;
  frames: number[];
  direction: 'forward' | 'reverse' | 'pingpong' | 'pingpong_reverse';
}

export interface ParsedSheet {
  frames: SheetFrame[];
  animations: SheetAnimation[];
  image?: string;
}

type Json = Record<string, any>;

export function isSheetJson(json: unknown): json is Json {
  return !!json && typeof json === 'object' && 'frames' in (json as Json);
}

export function parseSheetJson(json: Json): ParsedSheet {
  const rawFrames: [string, Json][] = Array.isArray(json.frames)
    ? json.frames.map((f: Json, i: number) => [String(f.filename ?? f.name ?? i), f])
    : Object.entries(json.frames as Json);

  const frames: SheetFrame[] = rawFrames.map(([name, f]) => {
    const r = f.frame ?? f;
    const rotated = !!f.rotated;
    const sss = f.spriteSourceSize ?? { x: 0, y: 0 };
    const w = rotated ? r.h : r.w;
    const h = rotated ? r.w : r.h;
    const ss = f.sourceSize ?? { w, h };
    return {
      name,
      frame: { x: r.x, y: r.y, w: r.w, h: r.h },
      rotated,
      offset: { x: sss.x ?? 0, y: sss.y ?? 0 },
      sourceSize: { w: ss.w, h: ss.h },
      duration: typeof f.duration === 'number' ? f.duration : 100,
    };
  });

  const animations: SheetAnimation[] = [];
  const meta = (json.meta ?? {}) as Json;
  if (Array.isArray(meta.frameTags)) {
    for (const t of meta.frameTags) {
      const ids: number[] = [];
      for (let i = t.from; i <= t.to; i++) ids.push(i);
      animations.push({ name: t.name, frames: ids, direction: normaliseDirection(t.direction) });
    }
  }
  // PixiJS / TexturePacker style
  if (json.animations && typeof json.animations === 'object') {
    const byName = new Map(frames.map((f, i) => [f.name, i]));
    for (const [name, list] of Object.entries(json.animations as Record<string, string[]>)) {
      const ids = list.map((n) => byName.get(n)).filter((i): i is number => i !== undefined);
      if (ids.length) animations.push({ name, frames: ids, direction: 'forward' });
    }
  }

  return { frames, animations, image: meta.image };
}

function normaliseDirection(d: unknown): SheetAnimation['direction'] {
  const s = String(d ?? 'forward').toLowerCase();
  if (s === 'reverse') return 'reverse';
  if (s === 'pingpong') return 'pingpong';
  if (s === 'pingpong_reverse') return 'pingpong_reverse';
  return 'forward';
}

/** Expand an animation into a sequence of frame indices according to its direction. */
export function playbackOrder(frames: number[], direction: SheetAnimation['direction']): number[] {
  if (frames.length <= 1) return frames.slice();
  switch (direction) {
    case 'reverse':
      return frames.slice().reverse();
    case 'pingpong':
      return [...frames, ...frames.slice(1, -1).reverse()];
    case 'pingpong_reverse': {
      const rev = frames.slice().reverse();
      return [...rev, ...rev.slice(1, -1).reverse()];
    }
    default:
      return frames.slice();
  }
}

/** Grid cells for a sheet with no metadata. Reads row-major, stops after `count`. */
export function gridRects(imgW: number, imgH: number, cols: number, rows: number, count?: number): SheetRect[] {
  const w = Math.floor(imgW / cols);
  const h = Math.floor(imgH / rows);
  const out: SheetRect[] = [];
  const max = count ?? cols * rows;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (out.length >= max) return out;
      out.push({ x: c * w, y: r * h, w, h });
    }
  return out;
}

/**
 * Guess a grid for a sheet: prefer square cells along the long axis (common for SpriteCook
 * and most animation strips), else a single cell.
 */
export function guessGrid(imgW: number, imgH: number): { cols: number; rows: number } {
  if (imgW > imgH && imgW % imgH === 0) return { cols: imgW / imgH, rows: 1 };
  if (imgH > imgW && imgH % imgW === 0) return { cols: 1, rows: imgH / imgW };
  return { cols: 1, rows: 1 };
}
