import type { AssetEntry, AssetSettings } from '../shared/types.ts';
import { fileUrl } from './api.ts';
import { loadAsepriteSprite, loadImageSprite, type SpriteAsset } from './formats/sprite.ts';
import { loadModel } from './viewer/loadModel.ts';
import { ModelContent, SpriteContent, StackContent, type Content } from './viewer/content.ts';
import type { ViewerSettings } from './viewer/Viewer.ts';

export interface LoadResult {
  content: Content;
  sprite?: SpriteAsset;
  notes: string[];
}

export async function loadContent(
  entry: AssetEntry,
  settings: AssetSettings | undefined,
  viewer: ViewerSettings,
  ppu: number,
  version: number,
  layerVisibility?: Map<number, boolean>,
): Promise<LoadResult> {
  if (entry.kind === 'model') {
    const m = await loadModel(entry.path, entry.ext, version);
    return { content: new ModelContent(m.object, m.clips), notes: m.notes };
  }

  let sprite: SpriteAsset;
  if (entry.kind === 'aseprite') {
    sprite = await loadAsepriteSprite(fileUrl(entry.path, version), layerVisibility);
    if (settings?.layout?.mode === 'stack') {
      // Aseprite stacks: each frame is one slice, ground first.
      sprite = { ...sprite, source: 'stack', layout: { mode: 'stack', slices: sprite.frames.length } };
    }
  } else {
    sprite = await loadImageSprite({
      url: fileUrl(entry.path, version),
      ext: entry.ext,
      path: entry.path,
      sidecarUrl: entry.sidecar ? fileUrl(entry.sidecar, version) : undefined,
      layout: settings?.layout ?? undefined,
    });
  }

  const content: Content =
    sprite.source === 'stack'
      ? new StackContent(sprite, { ppu, lit: viewer.litSprites, spacing: viewer.stackSpacing, fill: viewer.stackFill })
      : new SpriteContent(sprite, { ppu, lit: viewer.litSprites, onion: viewer.onion, showSheet: viewer.showSheet });
  return { content, sprite, notes: sprite.notes };
}
