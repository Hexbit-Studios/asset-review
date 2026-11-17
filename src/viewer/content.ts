// Scene content wrappers: a loaded model, a flat sprite, or a sprite stack.

import * as THREE from 'three';
import type { SpriteAsset } from '../formats/sprite.ts';
import { ClipPlayback, FramePlayback, NullPlayback, SpinPlayback, type Playback } from './playback.ts';
import { objectTexelDensity } from './texelDensity.ts';

export type DisplayMode = 'shaded' | 'albedo' | 'wireframe' | 'checker' | 'normals';

export interface Stat {
  label: string;
  value: string;
  warn?: boolean;
  /** Stable identity for notes about this row when the label alone is ambiguous. Defaults to the label. */
  key?: string;
}

export function statKey(s: Stat): string {
  return s.key ?? s.label.trim();
}

export interface Content {
  kind: 'model' | 'sprite' | 'stack';
  root: THREE.Object3D;
  playback: Playback;
  /** Bounding box in world space for framing. */
  bounds(): THREE.Box3;
  stats(targetDensity?: number): Stat[];
  update(dt: number): void;
  dispose(): void;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

function nearestTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let checkerTex: THREE.Texture | null = null;
function checkerTexture() {
  if (checkerTex) return checkerTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  const n = 16;
  const s = c.width / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const hue = ((x + y * n) / (n * n)) * 360;
      ctx.fillStyle = (x + y) % 2 ? `hsl(${hue},55%,62%)` : `hsl(${hue},20%,22%)`;
      ctx.fillRect(x * s, y * s, s, s);
    }
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px monospace';
  ctx.fillText('UV', 8, 26);
  checkerTex = new THREE.CanvasTexture(c);
  checkerTex.colorSpace = THREE.SRGBColorSpace;
  checkerTex.wrapS = checkerTex.wrapT = THREE.RepeatWrapping;
  checkerTex.anisotropy = 8;
  return checkerTex;
}

// ---------------------------------------------------------------- models

export class ModelContent implements Content {
  kind = 'model' as const;
  root: THREE.Object3D;
  playback: Playback;
  private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private skeleton: THREE.SkeletonHelper | null = null;
  private mode: DisplayMode = 'shaded';

  constructor(object: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.root = object;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        this.originals.set(m, m.material);
      }
    });
    this.playback = clips.length ? new ClipPlayback(object, clips) : new NullPlayback();
  }

  bounds() {
    return new THREE.Box3().setFromObject(this.root, true);
  }

  setDisplay(mode: DisplayMode) {
    this.mode = mode;
    // Undo any previous overlay / material swap.
    const overlays: THREE.Object3D[] = [];
    this.root.traverse((o) => o.userData.reviewWire && overlays.push(o));
    overlays.forEach((o) => {
      o.removeFromParent();
      disposeObject(o);
    });
    for (const [mesh, orig] of this.originals) {
      const prev = mesh.material;
      if (prev !== orig) (Array.isArray(prev) ? prev : [prev]).forEach((m) => m.dispose());
      (Array.isArray(orig) ? orig : [orig]).forEach((m) => ((m as any).wireframe = false));
      mesh.material = orig;
    }
    if (mode === 'shaded') return;

    const make = (o: THREE.Material): THREE.Material => {
      const src = o as THREE.MeshStandardMaterial;
      switch (mode) {
        case 'albedo':
          return new THREE.MeshBasicMaterial({
            map: src.map ?? null,
            color: src.color ?? new THREE.Color(0xffffff),
            transparent: src.transparent,
            alphaTest: src.alphaTest,
            side: src.side,
            vertexColors: src.vertexColors,
          });
        case 'checker':
          return new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8, side: src.side });
        case 'normals':
          return new THREE.MeshNormalMaterial({ side: src.side });
        default:
          return o;
      }
    };
    for (const [mesh, orig] of this.originals) {
      if (mode === 'wireframe') {
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          // Line overlays would not follow the skin; use the material's own wireframe.
          (Array.isArray(orig) ? orig : [orig]).forEach((m) => ((m as any).wireframe = true));
          continue;
        }
        const lines = new THREE.LineSegments(
          new THREE.WireframeGeometry(mesh.geometry),
          new THREE.LineBasicMaterial({ color: 0x29f0ff, transparent: true, opacity: 0.55 }),
        );
        lines.userData.reviewWire = true;
        mesh.add(lines);
      } else {
        mesh.material = Array.isArray(orig) ? orig.map(make) : make(orig);
      }
    }
  }

  get display() {
    return this.mode;
  }

  setSkeleton(on: boolean, scene: THREE.Scene) {
    if (on && !this.skeleton) {
      let hasBones = false;
      this.root.traverse((o) => ((o as THREE.Bone).isBone ? (hasBones = true) : null));
      if (!hasBones) return;
      this.skeleton = new THREE.SkeletonHelper(this.root);
      scene.add(this.skeleton);
    } else if (!on && this.skeleton) {
      this.skeleton.removeFromParent();
      this.skeleton.dispose();
      this.skeleton = null;
    }
  }

  stats(targetDensity?: number): Stat[] {
    let tris = 0,
      verts = 0,
      meshes = 0,
      bones = 0;
    const materials = new Set<THREE.Material>();
    const textures = new Map<string, string>();
    for (const [mesh, mat] of this.originals) {
      meshes++;
      const g = mesh.geometry as THREE.BufferGeometry;
      verts += g.getAttribute('position').count;
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        materials.add(m);
        for (const [k, v] of Object.entries(m)) {
          if (v instanceof THREE.Texture && v.image) {
            const img = v.image as { width: number; height: number };
            textures.set(v.uuid, `${k} ${img.width}×${img.height}`);
          }
        }
      }
    }
    this.root.traverse((o) => ((o as THREE.Bone).isBone ? bones++ : null));
    const size = this.bounds().getSize(new THREE.Vector3());
    const td = objectTexelDensity(this.root);
    const out: Stat[] = [
      { label: 'Size (m)', value: `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}` },
      { label: 'Triangles', value: Math.round(tris).toLocaleString() },
      { label: 'Vertices', value: verts.toLocaleString() },
      { label: 'Meshes', value: String(meshes) },
      { label: 'Materials', value: String(materials.size) },
    ];
    if (bones) out.push({ label: 'Bones', value: String(bones) });
    if (Number.isFinite(td.density)) {
      const off = targetDensity ? Math.abs(Math.log2(td.density / targetDensity)) > 0.5 : false;
      out.push({
        label: 'Texel density',
        value: `${td.density.toFixed(1)} px/m${targetDensity ? ` (target ${targetDensity})` : ''}`,
        warn: off,
      });
      for (const pm of td.perMesh) {
        if (!Number.isFinite(pm.result.density)) continue;
        const warn = targetDensity ? Math.abs(Math.log2(pm.result.density / targetDensity)) > 0.5 : false;
        out.push({ label: `  ${pm.name}`, key: `Texel density: ${pm.name}`, value: `${pm.result.density.toFixed(1)} px/m`, warn });
      }
    }
    for (const t of textures.values()) out.push({ label: 'Texture', key: `Texture: ${t}`, value: t });
    return out;
  }

  update(dt: number) {
    this.playback.update(dt);
  }

  dispose() {
    this.setDisplay('shaded');
    this.skeleton?.removeFromParent();
    disposeObject(this.root);
  }
}

// ---------------------------------------------------------------- flat sprites

export interface SpriteOptions {
  ppu: number;
  lit: boolean;
  onion: boolean;
  showSheet: boolean;
}

function spriteMaterial(lit: boolean, map: THREE.Texture | null): THREE.Material {
  const params = { map, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide };
  return lit ? new THREE.MeshStandardMaterial({ ...params, roughness: 1, metalness: 0 }) : new THREE.MeshBasicMaterial(params);
}

export class SpriteContent implements Content {
  kind = 'sprite' as const;
  root = new THREE.Group();
  playback: Playback;
  sprite: SpriteAsset;
  frame = 0;
  private textures: (THREE.CanvasTexture | null)[];
  private sheetTexture: THREE.CanvasTexture | null = null;
  private plane: THREE.Mesh;
  private onionPlane: THREE.Mesh;
  private gridLines: THREE.LineSegments | null = null;
  private opts: SpriteOptions;

  constructor(sprite: SpriteAsset, opts: SpriteOptions) {
    this.sprite = sprite;
    this.opts = opts;
    this.textures = sprite.frames.map(() => null);
    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0); // bottom edge on y=0
    this.plane = new THREE.Mesh(geo, spriteMaterial(opts.lit, null));
    this.onionPlane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false }));
    this.onionPlane.position.z = -0.001;
    this.onionPlane.renderOrder = -1;
    this.root.add(this.onionPlane, this.plane);
    this.applySize();
    this.playback = sprite.frames.length > 1 && sprite.animations.length
      ? new FramePlayback(sprite.frames, sprite.animations, (f) => this.showFrame(f))
      : new NullPlayback();
    this.showFrame(0);
  }

  private tex(i: number) {
    return (this.textures[i] ??= nearestTexture(this.sprite.frames[i].canvas));
  }

  private applySize() {
    const { ppu, showSheet } = this.opts;
    const w = showSheet && this.sprite.sheet ? this.sprite.sheet.width : this.sprite.width;
    const h = showSheet && this.sprite.sheet ? this.sprite.sheet.height : this.sprite.height;
    this.plane.scale.set(w / ppu, h / ppu, 1);
    this.onionPlane.scale.copy(this.plane.scale);
    this.plane.position.x = this.onionPlane.position.x = 0;
    if (this.gridLines) {
      this.gridLines.removeFromParent();
      this.gridLines.geometry.dispose();
      this.gridLines = null;
    }
    if (showSheet && this.sprite.sheet && this.sprite.frames.length > 1) {
      // Frame boundaries for checking sheet slicing.
      const pts: number[] = [];
      const fw = this.sprite.width / ppu,
        fh = this.sprite.height / ppu;
      const W = w / ppu,
        H = h / ppu;
      for (let x = fw; x < W - 1e-6; x += fw) pts.push(x - W / 2, 0, 0.001, x - W / 2, H, 0.001);
      for (let y = fh; y < H - 1e-6; y += fh) pts.push(-W / 2, H - y, 0.001, W / 2, H - y, 0.001);
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.gridLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff2bd6 }));
      this.root.add(this.gridLines);
    }
  }

  setOptions(patch: Partial<SpriteOptions>) {
    const litChanged = patch.lit !== undefined && patch.lit !== this.opts.lit;
    this.opts = { ...this.opts, ...patch };
    if (litChanged) {
      (this.plane.material as THREE.Material).dispose();
      this.plane.material = spriteMaterial(this.opts.lit, null);
    }
    this.applySize();
    this.showFrame(this.frame);
  }

  showFrame(i: number) {
    this.frame = i;
    const mat = this.plane.material as THREE.MeshBasicMaterial;
    if (this.opts.showSheet && this.sprite.sheet) {
      this.sheetTexture ??= nearestTexture(this.sprite.sheet);
      mat.map = this.sheetTexture;
      this.onionPlane.visible = false;
    } else {
      mat.map = this.tex(i);
      const n = this.sprite.frames.length;
      this.onionPlane.visible = this.opts.onion && n > 1;
      if (this.onionPlane.visible) {
        (this.onionPlane.material as THREE.MeshBasicMaterial).map = this.tex((i - 1 + n) % n);
        (this.onionPlane.material as THREE.MeshBasicMaterial).needsUpdate = true;
      }
    }
    mat.needsUpdate = true;
  }

  bounds() {
    return new THREE.Box3().setFromObject(this.plane);
  }

  stats(): Stat[] {
    const s = this.sprite;
    const out: Stat[] = [
      { label: 'Source', value: s.source },
      { label: 'Frame size', value: `${s.width} × ${s.height} px` },
      { label: 'Frames', value: String(s.frames.length) },
    ];
    if (s.sheet) out.push({ label: 'Sheet', value: `${s.sheet.width} × ${s.sheet.height} px` });
    out.push({ label: 'Colours (this frame)', value: String(countColors(s.frames[this.frame]?.canvas)) });
    if (s.animations.length) out.push({ label: 'Animations', value: s.animations.map((a) => a.name).join(', ') });
    for (const n of s.notes) out.push({ label: 'Warning', key: `Warning: ${n}`, value: n, warn: true });
    return out;
  }

  update(dt: number) {
    this.playback.update(dt);
  }

  dispose() {
    this.textures.forEach((t) => t?.dispose());
    this.sheetTexture?.dispose();
    disposeObject(this.root);
  }
}

let colorScratch: CanvasRenderingContext2D | null = null;
export function countColors(canvas?: HTMLCanvasElement): number {
  if (!canvas) return 0;
  colorScratch ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  colorScratch.canvas.width = canvas.width;
  colorScratch.canvas.height = canvas.height;
  colorScratch.drawImage(canvas, 0, 0);
  const data = colorScratch.getImageData(0, 0, canvas.width, canvas.height).data;
  const set = new Set<number>();
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) set.add((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]);
  return set.size;
}

// ---------------------------------------------------------------- sprite stacks

export interface StackOptions {
  ppu: number;
  lit: boolean;
  /** Screen pixels between slices (article default 1). */
  spacing: number;
  /** Extra in-between copies per slice to close gaps when not rendering pixelated. */
  fill: number;
}

/**
 * Sprite stack as real horizontal planes: slice 0 (left of the sheet) on the ground, each next
 * slice `spacing` pixels higher. Viewed with a tilted orthographic camera this matches the
 * classic 2D lift + squash technique, but also lets you orbit freely.
 */
export class StackContent implements Content {
  kind = 'stack' as const;
  root = new THREE.Group();
  playback: Playback;
  sprite: SpriteAsset;
  private spinner = new THREE.Group();
  private textures: THREE.CanvasTexture[];
  private opts: StackOptions;

  constructor(sprite: SpriteAsset, opts: StackOptions) {
    this.sprite = sprite;
    this.opts = opts;
    this.textures = sprite.frames.map((f) => nearestTexture(f.canvas));
    this.root.add(this.spinner);
    this.build();
    this.playback = new SpinPlayback((rad) => (this.spinner.rotation.y = rad));
  }

  setOptions(patch: Partial<StackOptions>) {
    this.opts = { ...this.opts, ...patch };
    this.build();
  }

  get options() {
    return this.opts;
  }

  private build() {
    for (const c of [...this.spinner.children]) {
      c.removeFromParent();
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    const { ppu, spacing, fill, lit } = this.opts;
    const w = this.sprite.width / ppu;
    const h = this.sprite.height / ppu;
    const geo = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);
    const copies = Math.max(1, Math.round(fill));
    this.textures.forEach((tex, i) => {
      const mat = spriteMaterial(lit, tex);
      mat.side = THREE.DoubleSide;
      for (let k = 0; k < copies; k++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = ((i + k / copies) * spacing) / ppu;
        mesh.renderOrder = i;
        this.spinner.add(mesh);
      }
    });
  }

  bounds() {
    const w = this.sprite.width / this.opts.ppu;
    const h = this.sprite.height / this.opts.ppu;
    const r = Math.hypot(w, h) / 2;
    const top = (this.sprite.frames.length * this.opts.spacing) / this.opts.ppu;
    return new THREE.Box3(new THREE.Vector3(-r, 0, -r), new THREE.Vector3(r, top, r));
  }

  stats(): Stat[] {
    return [
      { label: 'Source', value: 'sprite stack' },
      { label: 'Slices', value: String(this.sprite.frames.length) },
      { label: 'Slice size', value: `${this.sprite.width} × ${this.sprite.height} px` },
      { label: 'Spacing', value: `${this.opts.spacing} px` },
      ...this.sprite.notes.map((n) => ({ label: 'Warning', key: `Warning: ${n}`, value: n, warn: true })),
    ];
  }

  update(dt: number) {
    this.playback.update(dt);
  }

  dispose() {
    this.textures.forEach((t) => t.dispose());
    disposeObject(this.root);
  }
}
