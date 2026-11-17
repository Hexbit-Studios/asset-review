// Minimal-but-complete .aseprite / .ase reader (spec: aseprite/docs/ase-file-specs.md).
// Parses layers, cels (raw / linked / compressed), tags, palettes and frame durations.
// Pixel data is normalised to RGBA8. Tilemap cels are skipped.

export interface AseLayer {
  index: number;
  name: string;
  flags: number;
  type: 'normal' | 'group' | 'tilemap';
  childLevel: number;
  blendMode: number;
  opacity: number; // 0..255
  parent: number | null;
  /** Visible itself AND every ancestor group is visible. */
  effectivelyVisible: boolean;
  isReference: boolean;
}

export interface AseCel {
  layer: number;
  frame: number;
  x: number;
  y: number;
  opacity: number; // 0..255
  zIndex: number;
  width: number;
  height: number;
  /** RGBA8, width*height*4. */
  pixels: Uint8ClampedArray;
}

export interface AseTag {
  name: string;
  from: number;
  to: number;
  direction: 'forward' | 'reverse' | 'pingpong' | 'pingpong_reverse';
  repeat: number; // 0 = infinite
  color: string;
}

export interface AseFile {
  width: number;
  height: number;
  colorDepth: 32 | 16 | 8;
  frameDurations: number[]; // ms
  layers: AseLayer[];
  cels: AseCel[]; // linked cels are resolved into copies
  tags: AseTag[];
  palette: [number, number, number, number][];
  transparentIndex: number;
  pixelRatio: [number, number];
}

const DIRECTIONS: AseTag['direction'][] = ['forward', 'reverse', 'pingpong', 'pingpong_reverse'];

class Reader {
  view: DataView;
  pos: number;
  constructor(view: DataView, pos = 0) {
    this.view = view;
    this.pos = pos;
  }
  byte() {
    return this.view.getUint8(this.pos++);
  }
  word() {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  short() {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  dword() {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  skip(n: number) {
    this.pos += n;
  }
  bytes(n: number) {
    const b = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n;
    return b;
  }
  string() {
    const len = this.word();
    return new TextDecoder().decode(this.bytes(len));
  }
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // Aseprite uses zlib-wrapped deflate, which is what 'deflate' means for DecompressionStream.
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface RawCel {
  layer: number;
  frame: number;
  x: number;
  y: number;
  opacity: number;
  zIndex: number;
  kind: 'image' | 'linked';
  linkFrame?: number;
  width?: number;
  height?: number;
  raw?: Uint8Array;
  compressed?: boolean;
}

export async function parseAseprite(buffer: ArrayBuffer): Promise<AseFile> {
  const view = new DataView(buffer);
  const r = new Reader(view);
  r.dword(); // file size
  const magic = r.word();
  if (magic !== 0xa5e0) throw new Error('Not an Aseprite file (bad magic)');
  const frameCount = r.word();
  const width = r.word();
  const height = r.word();
  const colorDepth = r.word() as 32 | 16 | 8;
  const headerFlags = r.dword();
  r.word(); // speed (deprecated)
  r.dword();
  r.dword();
  const transparentIndex = r.byte();
  r.skip(3);
  r.word(); // number of colors
  const pxW = r.byte() || 1;
  const pxH = r.byte() || 1;
  r.pos = 128;

  const layerOpacityValid = (headerFlags & 1) !== 0;

  const layers: AseLayer[] = [];
  const rawCels: RawCel[] = [];
  const tags: AseTag[] = [];
  const frameDurations: number[] = [];
  let palette: [number, number, number, number][] = [];

  for (let f = 0; f < frameCount; f++) {
    const frameStart = r.pos;
    const frameBytes = r.dword();
    const fmagic = r.word();
    if (fmagic !== 0xf1fa) throw new Error(`Bad frame magic in frame ${f}`);
    const oldChunks = r.word();
    frameDurations.push(r.word() || 100);
    r.skip(2);
    const newChunks = r.dword();
    const chunkCount = newChunks === 0 ? oldChunks : newChunks;

    for (let c = 0; c < chunkCount; c++) {
      const chunkStart = r.pos;
      const chunkSize = r.dword();
      const type = r.word();
      switch (type) {
        case 0x2004: {
          const flags = r.word();
          const ltype = r.word();
          const childLevel = r.word();
          r.word();
          r.word(); // default w/h (ignored)
          const blendMode = r.word();
          const opacity = r.byte();
          r.skip(3);
          const name = r.string();
          layers.push({
            index: layers.length,
            name,
            flags,
            type: ltype === 1 ? 'group' : ltype === 2 ? 'tilemap' : 'normal',
            childLevel,
            blendMode,
            opacity: layerOpacityValid ? opacity : 255,
            parent: null,
            effectivelyVisible: true,
            isReference: (flags & 64) !== 0,
          });
          break;
        }
        case 0x2005: {
          const layer = r.word();
          const x = r.short();
          const y = r.short();
          const opacity = r.byte();
          const celType = r.word();
          const zIndex = r.short();
          r.skip(5);
          const cel: RawCel = { layer, frame: f, x, y, opacity, zIndex, kind: 'image' };
          if (celType === 0 || celType === 2) {
            cel.width = r.word();
            cel.height = r.word();
            const remaining = chunkStart + chunkSize - r.pos;
            cel.raw = r.bytes(remaining).slice();
            cel.compressed = celType === 2;
            rawCels.push(cel);
          } else if (celType === 1) {
            cel.kind = 'linked';
            cel.linkFrame = r.word();
            rawCels.push(cel);
          }
          // celType 3 (tilemap) intentionally ignored
          break;
        }
        case 0x2018: {
          const count = r.word();
          r.skip(8);
          for (let i = 0; i < count; i++) {
            const from = r.word();
            const to = r.word();
            const dir = r.byte();
            const repeat = r.word();
            r.skip(6);
            const rr = r.byte(),
              gg = r.byte(),
              bb = r.byte();
            r.byte();
            const name = r.string();
            tags.push({
              name,
              from,
              to,
              direction: DIRECTIONS[dir] ?? 'forward',
              repeat,
              color: `rgb(${rr},${gg},${bb})`,
            });
          }
          break;
        }
        case 0x2019: {
          const size = r.dword();
          const first = r.dword();
          const last = r.dword();
          r.skip(8);
          if (palette.length < size) palette = palette.concat(Array.from({ length: size - palette.length }, () => [0, 0, 0, 0] as [number, number, number, number]));
          for (let i = first; i <= last; i++) {
            const flags = r.word();
            palette[i] = [r.byte(), r.byte(), r.byte(), r.byte()];
            if (flags & 1) r.string();
          }
          break;
        }
        case 0x0004:
        case 0x0011: {
          // Old palette chunks; only used when no new palette chunk exists.
          if (palette.length) break;
          const packets = r.word();
          let idx = 0;
          for (let p = 0; p < packets; p++) {
            idx += r.byte();
            let n = r.byte();
            if (n === 0) n = 256;
            for (let i = 0; i < n; i++, idx++) {
              let rgb = [r.byte(), r.byte(), r.byte()];
              if (type === 0x0011) rgb = rgb.map((v) => Math.round((v * 255) / 63));
              palette[idx] = [rgb[0], rgb[1], rgb[2], 255];
            }
          }
          break;
        }
        default:
          break;
      }
      r.pos = chunkStart + chunkSize;
    }
    r.pos = frameStart + frameBytes;
  }

  // Resolve group hierarchy + effective visibility.
  const stack: number[] = [];
  for (const l of layers) {
    stack.length = l.childLevel;
    l.parent = l.childLevel > 0 ? (stack[l.childLevel - 1] ?? null) : null;
    stack[l.childLevel] = l.index;
    const selfVisible = (l.flags & 1) !== 0;
    const parentVisible = l.parent === null ? true : layers[l.parent].effectivelyVisible;
    l.effectivelyVisible = selfVisible && parentVisible;
  }

  // Decode image cels to RGBA.
  const decoded = new Map<string, AseCel>();
  const key = (layer: number, frame: number) => `${layer}:${frame}`;
  for (const rc of rawCels) {
    if (rc.kind !== 'image') continue;
    const bytes = rc.compressed ? await inflate(rc.raw!) : rc.raw!;
    const pixels = toRgba(bytes, rc.width!, rc.height!, colorDepth, palette, transparentIndex);
    decoded.set(key(rc.layer, rc.frame), {
      layer: rc.layer,
      frame: rc.frame,
      x: rc.x,
      y: rc.y,
      opacity: rc.opacity,
      zIndex: rc.zIndex,
      width: rc.width!,
      height: rc.height!,
      pixels,
    });
  }
  const cels: AseCel[] = [];
  for (const rc of rawCels) {
    if (rc.kind === 'image') {
      cels.push(decoded.get(key(rc.layer, rc.frame))!);
    } else {
      const src = decoded.get(key(rc.layer, rc.linkFrame!));
      if (src) cels.push({ ...src, frame: rc.frame, x: rc.x, y: rc.y, opacity: rc.opacity, zIndex: rc.zIndex });
    }
  }

  return {
    width,
    height,
    colorDepth,
    frameDurations,
    layers,
    cels,
    tags,
    palette,
    transparentIndex,
    pixelRatio: [pxW, pxH],
  };
}

function toRgba(
  src: Uint8Array,
  w: number,
  h: number,
  depth: number,
  palette: [number, number, number, number][],
  transparentIndex: number,
): Uint8ClampedArray {
  const n = w * h;
  if (depth === 32) return new Uint8ClampedArray(src.buffer, src.byteOffset, n * 4).slice();
  const out = new Uint8ClampedArray(n * 4);
  if (depth === 16) {
    for (let i = 0; i < n; i++) {
      const v = src[i * 2];
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
      out[i * 4 + 3] = src[i * 2 + 1];
    }
  } else {
    for (let i = 0; i < n; i++) {
      const idx = src[i];
      if (idx === transparentIndex) continue;
      const c = palette[idx] ?? [0, 0, 0, 0];
      out.set(c, i * 4);
    }
  }
  return out;
}

/** Aseprite blend mode id -> canvas composite operation. */
export const BLEND_TO_CANVAS: GlobalCompositeOperation[] = [
  'source-over', // 0 normal
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'lighter', // 16 addition
  'source-over', // 17 subtract (no canvas equivalent)
  'source-over', // 18 divide (no canvas equivalent)
];

/** Composite one frame to a canvas. `visibleOverride` lets the UI toggle layers. */
export function renderAseFrame(
  file: AseFile,
  frame: number,
  visibleOverride?: Map<number, boolean>,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = file.width;
  canvas.height = file.height;
  const ctx = canvas.getContext('2d')!;
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d')!;
  const isVisible = (layer: AseLayer): boolean => {
    for (let l: AseLayer | null = layer; l; l = l.parent === null ? null : file.layers[l.parent]) {
      const v = visibleOverride?.get(l.index);
      if (v === false) return false;
      if (v === undefined && (l.flags & 1) === 0) return false;
    }
    return true;
  };
  const cels = file.cels
    .filter((c) => c.frame === frame)
    .filter((c) => {
      const l = file.layers[c.layer];
      return l && l.type === 'normal' && !l.isReference && isVisible(l);
    })
    .sort((a, b) => a.layer + a.zIndex - (b.layer + b.zIndex) || a.zIndex - b.zIndex);
  for (const cel of cels) {
    const layer = file.layers[cel.layer];
    scratch.width = cel.width;
    scratch.height = cel.height;
    sctx.putImageData(new ImageData(new Uint8ClampedArray(cel.pixels), cel.width, cel.height), 0, 0);
    ctx.globalAlpha = (cel.opacity / 255) * (layer.opacity / 255);
    ctx.globalCompositeOperation = BLEND_TO_CANVAS[layer.blendMode] ?? 'source-over';
    ctx.drawImage(scratch, cel.x, cel.y);
  }
  return canvas;
}
