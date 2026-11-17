// Types shared by the server, the CLI and the browser client.

export type AssetKind =
  | 'model' // glb, gltf, fbx, obj, vox, blend
  | 'image' // png, webp, gif, jpg (may be a sheet / stack / animated)
  | 'aseprite'; // .aseprite / .ase

export interface AssetEntry {
  /** Path relative to the review root, always forward slashes. */
  path: string;
  kind: AssetKind;
  ext: string;
  size: number;
  mtime: number;
  /** Relative path of a sidecar JSON (sheet metadata / view settings) if one exists. */
  sidecar?: string;
}

export type NoteStatus = 'open' | 'addressed' | 'resolved' | 'wontfix';

export interface NoteReply {
  author: string;
  at: string;
  text: string;
}

export interface NoteInfo {
  /** Stable identity of the info row, e.g. "Triangles" or "Texel density: barrel_0". */
  key: string;
  label: string;
  /** The value shown when the note was written. */
  value: string;
}

export interface NoteMarker {
  /** 0..1 within the captured viewport image. */
  x: number;
  y: number;
}

export interface Note {
  id: string;
  asset: string;
  /** mtime of the asset file when the note was written (fallback for notes without a hash). */
  assetMtime: number;
  /** sha1 of the asset file's contents when the note was written; drives "updated since". */
  assetHash?: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  text: string;
  status: NoteStatus;
  markers: NoteMarker[];
  /** Root-relative paths. */
  screenshot?: string;
  cleanScreenshot?: string;
  /** Free-form snapshot of the viewer state (camera, animation, frame, view mode...). */
  view?: Record<string, unknown>;
  /** When the note is about a specific inspector info item (e.g. triangle count, texel density). */
  info?: NoteInfo;
  replies: NoteReply[];
}

/**
 * How the asset compares to when a note was written. Computed by the server, not stored:
 * `changed` = contents differ, `missing` = the file was moved or deleted.
 */
export type NoteAssetState = 'same' | 'changed' | 'missing';

/** A note as returned by the API: the stored note plus its computed asset state. */
export type NoteWithState = Note & { assetState: NoteAssetState };

export type AssetStatus = 'unreviewed' | 'needs-work' | 'approved';

/** How an image should be interpreted. Persisted per asset in .review/assets.json. */
export interface ImageLayout {
  mode: 'single' | 'grid' | 'stack' | 'directions';
  /** grid / directions: frame size or counts. */
  cols?: number;
  rows?: number;
  frameCount?: number;
  fps?: number;
  /** stack: number of slices in one row, ground slice on the left. */
  slices?: number;
}

export interface AssetSettings {
  status?: AssetStatus;
  /** null in a patch clears the stored layout (back to auto-detect). */
  layout?: ImageLayout | null;
  /** Any viewer prefs the client wants to remember per asset. */
  view?: Record<string, unknown>;
}

export interface ReviewConfig {
  name?: string;
  author?: string;
  /** Extra glob-ish path prefixes / dir names to ignore. */
  ignore?: string[];
  /** Target texel density in pixels per metre, used to colour the readout. */
  texelDensity?: number;
  /** World units per sprite pixel when sprites are shown alongside meshes. */
  pixelsPerUnit?: number;
  defaultBackground?: string;
  /** Project lighting presets (studio / day / night / flat), overriding the built-in rigs. */
  lighting?: Partial<Record<string, LightRig>>;
}

/**
 * A lighting preset as plain data. Directions are in degrees around the asset: azimuth 0 is
 * the front (+Z, facing the default camera), 90 is the right (+X); elevation 0 is the horizon,
 * 90 straight above. Accent-light intensity is relative to the asset size, so one rig works
 * for a crate and a building alike.
 */
export interface LightRig {
  /** Tone-mapping exposure (1 = neutral). */
  exposure: number;
  /** Image-based reflections from a neutral studio environment (0 = none). */
  environment: number;
  /** false = no tone mapping (flat / albedo-like). */
  toneMapping: boolean;
  ambient: { color: string; intensity: number };
  hemisphere: { sky: string; ground: string; intensity: number };
  key: { color: string; intensity: number; azimuth: number; elevation: number; shadows: boolean };
  accents: { color: string; intensity: number; azimuth: number; elevation: number; distance: number }[];
}

export interface ServerInfo {
  root: string;
  rootName: string;
  config: ReviewConfig;
  blender: boolean;
  author: string;
}
