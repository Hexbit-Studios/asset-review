// The three.js viewport: renderer, cameras, controls, lighting rigs, helpers, capture.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ModelContent, SpriteContent, StackContent, type Content, type DisplayMode } from './content.ts';
import { GroundGrid } from './grid.ts';
import { BUILTIN_PRESETS, BUILTIN_RIGS, buildRig, isBuiltin, type Lighting } from './lighting.ts';
import type { LightRig } from '../../shared/types.ts';

export type { Lighting };

export type Background = 'checker' | 'dark' | 'mid' | 'light' | 'green' | 'magenta';
export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'top' | 'iso' | 'game';

export interface ViewerSettings {
  lighting: Lighting;
  /** Review backdrop, remembered separately for 3D models and 2D art (sprites, sheets, stacks). */
  bgModel: Background;
  bgSprite: Background;
  display: DisplayMode;
  grid: boolean;
  human: boolean;
  skeleton: boolean;
  ortho: boolean;
  /** Models: render at 1/N resolution and upscale with nearest filtering (0 = off). */
  pixelate: number;
  /** Sprites & stacks: integer screen pixels per sprite pixel. */
  spriteScale: number;
  /** Sprites & stacks: render at native sprite resolution then upscale (true pixel look). */
  spriteNative: boolean;
  onion: boolean;
  showSheet: boolean;
  litSprites: boolean;
  stackSpacing: number;
  stackFill: number;
  /** Stack camera pitch in degrees above the horizon (90 = straight down). */
  stackPitch: number;
  /** HDR bloom: only pixels brighter than the threshold glow (emissive / neon materials). */
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;
  /** Per-browser edits to lighting presets (anything missing falls back to project, then built-in). */
  lightRigs: Partial<Record<Lighting, LightRig>>;
  /** Models: camera circles the asset (pauses while you drag). */
  orbit: boolean;
  /** Seconds per full turn. */
  orbitSeconds: number;
  orbitReverse: boolean;
}

export const DEFAULT_SETTINGS: ViewerSettings = {
  lighting: 'studio',
  bgModel: 'mid',
  bgSprite: 'checker',
  display: 'shaded',
  grid: true,
  human: false,
  skeleton: false,
  ortho: false,
  pixelate: 0,
  spriteScale: 6,
  spriteNative: true,
  onion: false,
  showSheet: false,
  litSprites: false,
  stackSpacing: 1,
  stackFill: 1,
  stackPitch: 50,
  bloom: true,
  bloomStrength: 0.35,
  bloomThreshold: 1,
  bloomRadius: 0.2,
  lightRigs: {},
  orbit: false,
  orbitSeconds: 20,
  orbitReverse: false,
};

const BG_COLORS: Record<Exclude<Background, 'checker'>, string> = {
  dark: '#15151c',
  mid: '#56565f',
  light: '#e9e9ef',
  green: '#00b140',
  magenta: '#ff00ff',
};

export function backgroundCss(bg: Background): string {
  if (bg !== 'checker') return BG_COLORS[bg];
  return 'repeating-conic-gradient(#2a2a33 0% 25%, #22222a 0% 50%) 50% / 24px 24px';
}

export function paintBackground(ctx: CanvasRenderingContext2D, bg: Background, w: number, h: number, scale = 1) {
  if (bg !== 'checker') {
    ctx.fillStyle = BG_COLORS[bg];
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const s = 12 * scale;
  for (let y = 0; y < h; y += s)
    for (let x = 0; x < w; x += s) {
      ctx.fillStyle = (Math.floor(x / s) + Math.floor(y / s)) % 2 ? '#22222a' : '#2a2a33';
      ctx.fillRect(x, y, s, s);
    }
}

const PRESETS: Record<ViewPreset, { yaw: number; pitch: number }> = {
  front: { yaw: 0, pitch: 0 },
  back: { yaw: 180, pitch: 0 },
  left: { yaw: -90, pitch: 0 },
  right: { yaw: 90, pitch: 0 },
  top: { yaw: 0, pitch: 89.9 },
  iso: { yaw: 45, pitch: 35.264 },
  game: { yaw: 0, pitch: 50 },
};

export class Viewer {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly persp = new THREE.PerspectiveCamera(35, 1, 0.01, 2000);
  readonly orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  readonly controls: OrbitControls;
  content: Content | null = null;
  /** Path of the asset currently shown (set by the app after a successful load). */
  assetPath: string | null = null;
  settings: ViewerSettings = { ...DEFAULT_SETTINGS };
  ppu = 32;
  /** Lighting presets from the project's review.config.json. */
  projectRigs: Partial<Record<string, LightRig>> = {};

  private timer = new THREE.Timer();
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private lights = new THREE.Group();
  private helpers = new THREE.Group();
  private grid = new GroundGrid();
  private shadowCatcher: THREE.Mesh;
  private human: THREE.Group;
  private envTex: THREE.Texture;
  private sun: THREE.DirectionalLight | null = null;
  private fitRadius = 1;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private listeners = new Set<() => void>();
  private cssW = 1;
  private cssH = 1;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'viewport-canvas';
    container.appendChild(this.renderer.domElement);

    // Post chain for bloom. HDR + MSAA target so emissive values above 1 survive to the bloom
    // pass and edges stay antialiased. The bloom composite writes glow into alpha, so the
    // CSS review background behind the transparent canvas still works.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.persp);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.2, 1);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.controls = new OrbitControls(this.persp, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false, capture: true });

    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.3 }),
    );
    this.shadowCatcher.receiveShadow = true;
    // Neither ground layer writes depth, so they can't z-fight each other (they share y = 0).
    (this.shadowCatcher.material as THREE.Material).depthWrite = false;
    this.shadowCatcher.renderOrder = -2;
    this.helpers.add(this.grid);
    this.human = makeHumanReference();
    this.scene.add(this.lights, this.helpers, this.shadowCatcher, this.human);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.applySettings();
    this.loop();
  }

  // ------------------------------------------------------------ events

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.usesOrtho ? this.orthoCam : this.persp;
  }

  /** Sprites and stacks are always orthographic and measured in sprite pixels. */
  get pixelSpace() {
    return this.content?.kind === 'sprite' || this.content?.kind === 'stack';
  }

  /** The backdrop for the current content type. */
  get background(): Background {
    return this.content?.kind === 'model' || !this.content ? this.settings.bgModel : this.settings.bgSprite;
  }

  /** Settings patch that changes the backdrop for the current content type only. */
  backgroundPatch(bg: Background): Partial<ViewerSettings> {
    return this.content?.kind === 'model' || !this.content ? { bgModel: bg } : { bgSprite: bg };
  }

  get usesOrtho() {
    return this.pixelSpace || this.settings.ortho;
  }

  // ------------------------------------------------------------ content

  setContent(content: Content | null, opts: { keepView?: boolean } = {}) {
    if (this.content) {
      this.content.root.removeFromParent();
      this.content.dispose();
    }
    this.content = content;
    if (content) this.scene.add(content.root);
    this.applySettings();
    if (!opts.keepView) this.frame(content?.kind === 'stack' ? 'game' : content?.kind === 'sprite' ? 'front' : 'iso');
    this.emit();
  }

  set(patch: Partial<ViewerSettings>) {
    const prev = this.settings;
    this.settings = { ...prev, ...patch };
    this.applySettings(prev);
    this.emit();
  }

  private applySettings(prev?: ViewerSettings) {
    const s = this.settings;
    const c = this.content;
    this.container.style.background = backgroundCss(this.background);

    if (c instanceof ModelContent) {
      if (c.display !== s.display) c.setDisplay(s.display);
      c.setSkeleton(s.skeleton, this.scene);
    }
    if (c instanceof SpriteContent) c.setOptions({ onion: s.onion, showSheet: s.showSheet, lit: s.litSprites, ppu: this.ppu });
    if (c instanceof StackContent) {
      const o = c.options;
      if (o.spacing !== s.stackSpacing || o.fill !== s.stackFill || o.lit !== s.litSprites || o.ppu !== this.ppu)
        c.setOptions({ spacing: s.stackSpacing, fill: s.stackFill, lit: s.litSprites, ppu: this.ppu });
      if (prev && prev.stackPitch !== s.stackPitch) this.setAngles(this.currentYaw(), s.stackPitch);
    }

    this.bloomPass.strength = s.bloomStrength;
    this.bloomPass.threshold = s.bloomThreshold;
    this.bloomPass.radius = s.bloomRadius;

    this.buildLights();
    this.updateHelpers();

    // Camera switch (keeps the orbit pose).
    const cam = this.camera;
    if (this.controls.object !== cam) {
      cam.position.copy(this.controls.object.position);
      cam.quaternion.copy(this.controls.object.quaternion);
      this.controls.object = cam;
    }
    this.controls.enableRotate = c?.kind !== 'sprite';
    this.controls.enableZoom = !this.pixelSpace;
    // OrbitControls auto-rotate: one turn takes 60 / autoRotateSpeed seconds when given a delta.
    this.controls.autoRotate = s.orbit && c?.kind === 'model';
    this.controls.autoRotateSpeed = (60 / Math.max(1, s.orbitSeconds)) * (s.orbitReverse ? -1 : 1);
    this.resize();
  }

  // ------------------------------------------------------------ lighting & helpers

  /** Built-in presets first, then custom ones (from the project and this browser) by name. */
  presetNames(): Lighting[] {
    const custom = new Set<string>();
    for (const k of [...Object.keys(this.projectRigs), ...Object.keys(this.settings.lightRigs)])
      if (!isBuiltin(k) && (this.projectRigs[k] || this.settings.lightRigs[k])) custom.add(k);
    return [...BUILTIN_PRESETS, ...[...custom].sort((a, b) => a.localeCompare(b))];
  }

  /** Where the active values of a preset come from. */
  rigSource(preset: Lighting): 'browser' | 'project' | 'built-in' {
    if (this.settings.lightRigs[preset]) return 'browser';
    if (this.projectRigs[preset]) return 'project';
    return 'built-in';
  }

  /** The rig a preset resolves to: browser edits, else project config, else built-in (studio if unknown). */
  rigFor(preset: Lighting): LightRig {
    return (
      this.settings.lightRigs[preset] ??
      (this.projectRigs[preset] as LightRig | undefined) ??
      (isBuiltin(preset) ? BUILTIN_RIGS[preset] : BUILTIN_RIGS.studio)
    );
  }

  /** Re-apply lighting (e.g. after project rigs change). */
  refreshLighting() {
    this.buildLights();
    this.updateHelpers();
    this.emit();
  }

  private buildLights() {
    for (const l of [...this.lights.children]) {
      l.removeFromParent();
      (l as THREE.Light).dispose?.();
    }
    const r = this.fitRadius;
    const rig = this.rigFor(this.settings.lighting);
    this.scene.environment = rig.environment > 0 ? this.envTex : null;
    this.scene.environmentIntensity = rig.environment;
    this.sun = buildRig(rig, r, this.lights);
    if (this.sun) {
      const sun = this.sun;
      sun.castShadow = rig.key.shadows && this.content?.kind === 'model';
      sun.shadow.mapSize.set(2048, 2048);
      const cam = sun.shadow.camera;
      cam.left = cam.bottom = -r * 1.5;
      cam.right = cam.top = r * 1.5;
      cam.near = 0.01;
      cam.far = r * 20;
      cam.updateProjectionMatrix();
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.02;
      sun.target.position.set(0, 0, 0);
      this.lights.add(sun.target);
    }
    this.renderer.toneMapping = rig.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = rig.exposure;
  }

  private updateHelpers() {
    const s = this.settings;
    const kind = this.content?.kind;
    const showGrid = s.grid && kind !== 'sprite';
    this.grid.visible = showGrid;
    if (showGrid) this.grid.fit(this.fitRadius, kind === 'stack');
    this.shadowCatcher.visible = showGrid && kind === 'model' && !!this.sun?.castShadow;
    this.shadowCatcher.scale.setScalar(this.fitRadius * 8);
    this.human.visible = s.human && kind !== 'sprite';
    if (this.content && this.human.visible) {
      const b = this.content.bounds();
      this.human.position.set(b.min.x - 0.45, 0, 0);
    }
  }

  // ------------------------------------------------------------ camera

  private currentYaw() {
    const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    return THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z));
  }

  setAngles(yawDeg: number, pitchDeg: number) {
    const dist = this.camera.position.distanceTo(this.controls.target) || this.fitRadius * 4;
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.emit();
  }

  preset(p: ViewPreset) {
    const { yaw, pitch } = PRESETS[p];
    this.setAngles(yaw, p === 'game' && this.content?.kind === 'stack' ? this.settings.stackPitch : pitch);
  }

  /** Fit the camera to the content and apply a preset direction. */
  frame(preset: ViewPreset = 'iso') {
    const box = this.content?.bounds() ?? new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    if (this.content && this.content.kind !== 'sprite' && this.settings.human) {
      this.updateHelpers();
      box.union(new THREE.Box3().setFromObject(this.human));
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.fitRadius = Math.max(sphere.radius, 0.01);
    const center = this.content?.kind === 'sprite' ? box.getCenter(new THREE.Vector3()) : sphere.center;
    this.controls.target.copy(center);
    const fov = THREE.MathUtils.degToRad(this.persp.fov);
    const dist = (this.fitRadius / Math.sin(fov / 2)) * 1.15;
    this.persp.near = dist / 200;
    this.persp.far = dist * 50;
    this.persp.updateProjectionMatrix();
    this.camera.position.copy(center).add(new THREE.Vector3(0, 0, dist));
    this.orthoCam.zoom = 1;
    this.applySettings();
    this.preset(preset);
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.pixelSpace) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.deltaY > 0 ? -1 : 1;
    const s = this.settings.spriteScale;
    const next = Math.max(1, Math.min(64, s + dir * Math.max(1, Math.round(s / 6))));
    if (next !== s) this.set({ spriteScale: next });
  };

  // ------------------------------------------------------------ sizing

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.cssW = w;
    this.cssH = h;
    const s = this.settings;
    let ratio = Math.min(window.devicePixelRatio, 2);
    // Whole-sheet view draws 1px frame lines that would cover sprite pixels at native res.
    const sheetView = this.content?.kind === 'sprite' && s.showSheet;
    if (this.pixelSpace && s.spriteNative && !sheetView) ratio = 1 / s.spriteScale;
    else if (!this.pixelSpace && s.pixelate > 1) ratio = 1 / s.pixelate;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, true);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    this.renderer.domElement.classList.toggle('pixelated', ratio < 1);

    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();

    const cam = this.orthoCam;
    let halfH: number;
    if (this.pixelSpace) {
      // One world unit = ppu sprite pixels; zoom = integer screen px per sprite px.
      halfH = h / 2 / this.ppu;
      cam.zoom = s.spriteScale;
    } else {
      halfH = this.fitRadius * 1.2;
    }
    const halfW = halfH * (w / h);
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.near = -this.fitRadius * 100;
    cam.far = this.fitRadius * 100;
    cam.updateProjectionMatrix();
  }

  /** Keep flat sprites on whole pixels so nearest sampling never splits a pixel. */
  private snapSprite() {
    if (this.content?.kind !== 'sprite') return;
    const s = this.settings;
    const u = 1 / (this.ppu * s.spriteScale); // world units per screen px
    const native = s.spriteNative && !s.showSheet;
    const step = native ? 1 / this.ppu : u;
    const bw = native ? Math.floor(this.cssW / s.spriteScale) : this.cssW;
    const bh = native ? Math.floor(this.cssH / s.spriteScale) : this.cssH;
    const box = this.content.bounds();
    const t = this.controls.target;
    const fix = (edge: number, center: number, buf: number, sign: number) => {
      const px = (sign * (edge - center)) / step + buf / 2;
      return edge - (sign * (Math.round(px) - buf / 2)) * step;
    };
    const nx = fix(box.min.x, t.x, bw, 1);
    const ny = fix(box.min.y, t.y, bh, 1);
    const dx = nx - t.x,
      dy = ny - t.y;
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
      t.x += dx;
      t.y += dy;
      this.camera.position.x += dx;
      this.camera.position.y += dy;
    }
  }

  // ------------------------------------------------------------ loop & capture

  private loop = (now?: number) => {
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update(now);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.content?.update(dt);
    this.controls.update(dt); // dt keeps orbit speed independent of frame rate
    this.renderFrame();
  };

  private renderFrame() {
    this.snapSprite();
    if (this.settings.bloom) {
      this.renderPass.camera = this.camera;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Render now and return the viewport (with background) at screen resolution. */
  capture(): HTMLCanvasElement {
    this.renderFrame();
    const src = this.renderer.domElement;
    const scale = Math.min(window.devicePixelRatio, 2);
    const out = document.createElement('canvas');
    out.width = Math.round(this.cssW * scale);
    out.height = Math.round(this.cssH * scale);
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    paintBackground(ctx, this.background, out.width, out.height, scale);
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return out;
  }

  /** Everything needed to restore this exact view later (stored with notes). */
  viewState(): Record<string, unknown> {
    const p = this.camera.position;
    const t = this.controls.target;
    const r = (n: number) => Math.round(n * 1e4) / 1e4;
    const pb = this.content?.playback.state();
    return {
      camera: { position: [r(p.x), r(p.y), r(p.z)], target: [r(t.x), r(t.y), r(t.z)], zoom: r(this.camera.zoom), ortho: this.usesOrtho },
      settings: { ...this.settings },
      // The resolved values of the active preset, so the note still describes the exact
      // lighting even if the project preset changes later.
      lightRig: this.rigFor(this.settings.lighting),
      playback: pb
        ? {
            clip: pb.clips[pb.clip]?.name ?? null,
            time: r(pb.time),
            frame: pb.unit === 'seconds' ? Math.round(pb.time * (pb.fps ?? 30)) : pb.frame,
            frameInClip: pb.frameInClip,
            fps: pb.fps,
            inPlace: pb.inPlace,
            unit: pb.unit,
          }
        : null,
      viewport: [this.cssW, this.cssH],
    };
  }

  applyViewState(v: Record<string, any>) {
    if (v.settings) {
      // Notes written before backdrops were split stored a single `background`.
      const { background, ...rest } = v.settings;
      // Never resume orbiting when restoring a note: it would drift away from the noted view.
      this.set({ ...rest, ...(background && !rest.bgModel ? this.backgroundPatch(background) : {}), orbit: false });
    }
    const cam = v.camera;
    if (cam?.position && cam?.target) {
      this.controls.target.fromArray(cam.target);
      this.camera.position.fromArray(cam.position);
      this.camera.lookAt(this.controls.target);
      this.controls.update();
    }
    const pb = v.playback;
    if (pb && this.content) {
      if (pb.inPlace !== undefined) this.content.playback.setInPlace?.(!!pb.inPlace);
      const st = this.content.playback.state();
      const idx = st.clips.findIndex((c) => c.name === pb.clip);
      if (idx >= 0) this.content.playback.setClip(idx);
      this.content.playback.pause();
      this.content.playback.seek(pb.time ?? 0);
    }
    this.emit();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.timer.dispose();
    this.resizeObserver.disconnect();
    this.setContent(null);
    this.controls.dispose();
    this.grid.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function makeHumanReference(): THREE.Group {
  // 1.75 m capsule silhouette for scale checks.
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8aa0, transparent: true, opacity: 0.55, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.0, 6, 12), mat);
  body.position.y = 0.2 + 0.5 + 0.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), mat);
  head.position.y = 1.62;
  body.scale.set(1, 1, 0.65);
  g.add(body, head);
  g.visible = false;
  return g;
}
