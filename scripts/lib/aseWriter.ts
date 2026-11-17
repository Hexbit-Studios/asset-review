// Minimal .aseprite writer used for fixtures and parser tests (RGBA only).
import zlib from 'node:zlib';

export interface WLayer {
  name: string;
  visible?: boolean;
  group?: boolean;
  childLevel?: number;
  opacity?: number;
  blendMode?: number;
}
export interface WCel {
  layer: number;
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rgba?: Uint8Array;
  /** Link to the same layer's cel in this frame instead of storing pixels. */
  linkFrame?: number;
  opacity?: number;
  compressed?: boolean;
}
export interface WTag {
  name: string;
  from: number;
  to: number;
  direction?: 0 | 1 | 2 | 3;
}

class Buf {
  parts: Buffer[] = [];
  byte(v: number) {
    this.parts.push(Buffer.from([v & 255]));
  }
  word(v: number) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    this.parts.push(b);
  }
  short(v: number) {
    const b = Buffer.alloc(2);
    b.writeInt16LE(v);
    this.parts.push(b);
  }
  dword(v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    this.parts.push(b);
  }
  zeros(n: number) {
    this.parts.push(Buffer.alloc(n));
  }
  bytes(b: Uint8Array) {
    this.parts.push(Buffer.from(b));
  }
  str(s: string) {
    const b = Buffer.from(s, 'utf8');
    this.word(b.length);
    this.parts.push(b);
  }
  out() {
    return Buffer.concat(this.parts);
  }
}

function chunk(type: number, body: Buffer) {
  const h = new Buf();
  h.dword(body.length + 6);
  h.word(type);
  return Buffer.concat([h.out(), body]);
}

export function writeAseprite(opts: {
  width: number;
  height: number;
  frames: number[]; // durations
  layers: WLayer[];
  cels: WCel[];
  tags?: WTag[];
}): Buffer {
  const frames: Buffer[] = [];
  opts.frames.forEach((duration, f) => {
    const chunks: Buffer[] = [];
    if (f === 0) {
      for (const l of opts.layers) {
        const b = new Buf();
        b.word((l.visible === false ? 0 : 1) | 2);
        b.word(l.group ? 1 : 0);
        b.word(l.childLevel ?? 0);
        b.word(0);
        b.word(0);
        b.word(l.blendMode ?? 0);
        b.byte(l.opacity ?? 255);
        b.zeros(3);
        b.str(l.name);
        chunks.push(chunk(0x2004, b.out()));
      }
      if (opts.tags?.length) {
        const b = new Buf();
        b.word(opts.tags.length);
        b.zeros(8);
        for (const t of opts.tags) {
          b.word(t.from);
          b.word(t.to);
          b.byte(t.direction ?? 0);
          b.word(0);
          b.zeros(6);
          b.byte(255);
          b.byte(0);
          b.byte(255);
          b.byte(0);
          b.str(t.name);
        }
        chunks.push(chunk(0x2018, b.out()));
      }
    }
    for (const c of opts.cels.filter((c) => c.frame === f)) {
      const b = new Buf();
      b.word(c.layer);
      b.short(c.x);
      b.short(c.y);
      b.byte(c.opacity ?? 255);
      if (c.linkFrame !== undefined) {
        b.word(1);
        b.short(0);
        b.zeros(5);
        b.word(c.linkFrame);
      } else {
        const compressed = c.compressed ?? true;
        b.word(compressed ? 2 : 0);
        b.short(0);
        b.zeros(5);
        b.word(c.w);
        b.word(c.h);
        b.bytes(compressed ? zlib.deflateSync(Buffer.from(c.rgba!)) : c.rgba!);
      }
      chunks.push(chunk(0x2005, b.out()));
    }
    const body = Buffer.concat(chunks);
    const h = new Buf();
    h.dword(16 + body.length);
    h.word(0xf1fa);
    h.word(Math.min(chunks.length, 0xffff));
    h.word(duration);
    h.zeros(2);
    h.dword(chunks.length);
    frames.push(Buffer.concat([h.out(), body]));
  });

  const framesBuf = Buffer.concat(frames);
  const h = new Buf();
  h.dword(128 + framesBuf.length);
  h.word(0xa5e0);
  h.word(opts.frames.length);
  h.word(opts.width);
  h.word(opts.height);
  h.word(32);
  h.dword(1); // layer opacity valid
  h.word(100);
  h.dword(0);
  h.dword(0);
  h.byte(0);
  h.zeros(3);
  h.word(0);
  h.byte(1);
  h.byte(1);
  h.short(0);
  h.short(0);
  h.word(16);
  h.word(16);
  h.zeros(84);
  const header = h.out();
  if (header.length !== 128) throw new Error(`header is ${header.length} bytes`);
  return Buffer.concat([header, framesBuf]);
}
