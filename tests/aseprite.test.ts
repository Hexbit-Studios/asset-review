import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseAseprite } from '../src/formats/aseprite.ts';
import { writeAseprite } from '../scripts/lib/aseWriter.ts';

const toAB = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('parseAseprite', () => {
  it('reads layers, groups, tags, durations, compressed / raw / linked cels', async () => {
    const red = new Uint8Array(4 * 4 * 4).fill(0);
    for (let i = 0; i < 16; i++) red.set([255, 0, 0, 255], i * 4);
    const buf = writeAseprite({
      width: 8,
      height: 8,
      frames: [100, 250],
      layers: [{ name: 'bg' }, { name: 'grp', group: true, visible: false }, { name: 'child', childLevel: 1 }],
      cels: [
        { layer: 0, frame: 0, x: 2, y: 3, w: 4, h: 4, rgba: red },
        { layer: 0, frame: 1, x: 1, y: 1, w: 4, h: 4, linkFrame: 0 },
        { layer: 2, frame: 0, x: 0, y: 0, w: 4, h: 4, rgba: red, compressed: false },
      ],
      tags: [{ name: 'walk', from: 0, to: 1, direction: 2 }],
    });
    const f = await parseAseprite(toAB(buf));
    expect(f.width).toBe(8);
    expect(f.frameDurations).toEqual([100, 250]);
    expect(f.layers.map((l) => [l.name, l.type, l.parent, l.effectivelyVisible])).toEqual([
      ['bg', 'normal', null, true],
      ['grp', 'group', null, false],
      ['child', 'normal', 1, false],
    ]);
    expect(f.tags).toEqual([{ name: 'walk', from: 0, to: 1, direction: 'pingpong', repeat: 0, color: 'rgb(255,0,255)' }]);
    expect(f.cels).toHaveLength(3);
    const linked = f.cels.find((c) => c.frame === 1)!;
    expect([linked.x, linked.y, linked.width]).toEqual([1, 1, 4]);
    expect(Array.from(linked.pixels.slice(0, 4))).toEqual([255, 0, 0, 255]);
    const raw = f.cels.find((c) => c.layer === 2)!;
    expect(Array.from(raw.pixels.slice(60, 64))).toEqual([255, 0, 0, 255]);
  });

  it('rejects non-aseprite data', async () => {
    await expect(parseAseprite(new ArrayBuffer(256))).rejects.toThrow(/bad magic/);
  });

  it('parses the generated drone fixture', async () => {
    const p = new URL('../examples/sprites/drone.aseprite', import.meta.url);
    if (!fs.existsSync(p)) return;
    const f = await parseAseprite(toAB(fs.readFileSync(p)));
    expect(f.tags.map((t) => t.name)).toEqual(['hover', 'blink']);
    expect(f.cels.filter((c) => c.frame === 3)).toHaveLength(3);
  });
});
