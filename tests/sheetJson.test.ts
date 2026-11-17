import { describe, expect, it } from 'vitest';
import { gridRects, guessGrid, parseSheetJson, playbackOrder } from '../src/formats/sheetJson.ts';
import { layoutFromName } from '../src/formats/sprite.ts';

describe('sheet json', () => {
  it('parses Aseprite hash format with tags and trimming', () => {
    const s = parseSheetJson({
      frames: {
        'a 0': { frame: { x: 0, y: 0, w: 8, h: 8 }, spriteSourceSize: { x: 2, y: 1, w: 8, h: 8 }, sourceSize: { w: 12, h: 10 }, duration: 50 },
        'a 1': { frame: { x: 8, y: 0, w: 8, h: 8 }, duration: 70 },
      },
      meta: { frameTags: [{ name: 'idle', from: 0, to: 1, direction: 'pingpong' }] },
    });
    expect(s.frames[0]).toMatchObject({ offset: { x: 2, y: 1 }, sourceSize: { w: 12, h: 10 }, duration: 50 });
    expect(s.frames[1].sourceSize).toEqual({ w: 8, h: 8 });
    expect(s.animations).toEqual([{ name: 'idle', frames: [0, 1], direction: 'pingpong' }]);
  });

  it('parses array format and PixiJS animations', () => {
    const s = parseSheetJson({
      frames: [
        { filename: 'run_0', frame: { x: 0, y: 0, w: 4, h: 4 } },
        { filename: 'run_1', frame: { x: 4, y: 0, w: 4, h: 4 } },
      ],
      animations: { run: ['run_1', 'run_0'] },
    });
    expect(s.animations).toEqual([{ name: 'run', frames: [1, 0], direction: 'forward' }]);
  });

  it('expands playback directions', () => {
    expect(playbackOrder([0, 1, 2, 3], 'pingpong')).toEqual([0, 1, 2, 3, 2, 1]);
    expect(playbackOrder([0, 1, 2], 'reverse')).toEqual([2, 1, 0]);
    expect(playbackOrder([0, 1, 2], 'pingpong_reverse')).toEqual([2, 1, 0, 1]);
  });

  it('grids and guesses', () => {
    expect(gridRects(32, 16, 2, 1)).toEqual([
      { x: 0, y: 0, w: 16, h: 16 },
      { x: 16, y: 0, w: 16, h: 16 },
    ]);
    expect(gridRects(30, 20, 3, 2, 4)).toHaveLength(4);
    expect(guessGrid(128, 16)).toEqual({ cols: 8, rows: 1 });
    expect(guessGrid(16, 64)).toEqual({ cols: 1, rows: 4 });
    expect(guessGrid(20, 30)).toEqual({ cols: 1, rows: 1 });
  });

  it('reads layout hints from file names', () => {
    expect(layoutFromName('cars/van.stack15.png')).toEqual({ mode: 'stack', slices: 15 });
    expect(layoutFromName('tree_stack.png')).toEqual({ mode: 'stack', slices: undefined });
    expect(layoutFromName('car.dir16.png')).toEqual({ mode: 'directions', frameCount: 16 });
    expect(layoutFromName('stacked_boxes.png')).toBeNull();
  });
});
