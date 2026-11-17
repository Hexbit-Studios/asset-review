import * as THREE from 'three';
import { playbackOrder } from '../formats/sheetJson.ts';
import type { SpriteAnimation, SpriteFrame } from '../formats/sprite.ts';
import { detectFps, inPlaceClip, rootTravel } from './clipUtils.ts';

export interface PlaybackState {
  clips: { name: string; duration: number }[];
  clip: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  /** Seconds into the current clip. */
  time: number;
  duration: number;
  /** Sprite players only. */
  frame?: number;
  frameInClip?: number;
  frameCount?: number;
  /** Model clips: detected frame rate. */
  fps?: number;
  /** Model clips: root-motion lock and how far the root travels in this clip (m). */
  inPlace?: boolean;
  rootTravel?: number;
  unit: 'seconds' | 'frames' | 'degrees';
}

export interface Playback {
  state(): PlaybackState;
  setClip(i: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  setSpeed(s: number): void;
  setLoop(l: boolean): void;
  seek(time: number): void;
  step(dir: number): void;
  /** Pause on the first / last frame of the current clip. */
  goToStart(): void;
  goToEnd(): void;
  /** Frame-based players: jump to a position within the current clip. */
  seekFrame?(posInClip: number): void;
  /** Model clips: keep the root on the spot (strip horizontal root motion). */
  setInPlace?(on: boolean): void;
  update(dt: number): void;
}

/** Nothing to play (still image / static mesh). */
export class NullPlayback implements Playback {
  state(): PlaybackState {
    return { clips: [], clip: -1, playing: false, speed: 1, loop: true, time: 0, duration: 0, unit: 'seconds' };
  }
  setClip() {}
  play() {}
  pause() {}
  toggle() {}
  setSpeed() {}
  setLoop() {}
  seek() {}
  step() {}
  goToStart() {}
  goToEnd() {}
  update() {}
}

/** Skeletal / morph / transform animation through an AnimationMixer. */
export class ClipPlayback implements Playback {
  private root: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private source: THREE.AnimationClip[];
  private clips: THREE.AnimationClip[];
  private fps: number[];
  private travel: number[];
  private inPlace = false;
  private action: THREE.AnimationAction | null = null;
  private clipIndex = -1;
  private playing = false;
  private speed = 1;
  private loop = true;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.source = clips;
    this.clips = clips;
    this.fps = clips.map(detectFps);
    this.travel = clips.map((c) => rootTravel(root, c));
    if (clips.length) this.setClip(0);
  }

  state(): PlaybackState {
    const clip = this.clips[this.clipIndex];
    return {
      clips: this.clips.map((c) => ({ name: c.name || 'clip', duration: c.duration })),
      clip: this.clipIndex,
      playing: this.playing,
      speed: this.speed,
      loop: this.loop,
      time: this.action?.time ?? 0,
      duration: clip?.duration ?? 0,
      fps: this.fps[this.clipIndex],
      inPlace: this.inPlace,
      rootTravel: this.travel[this.clipIndex],
      unit: 'seconds',
    };
  }

  setClip(i: number) {
    if (!this.clips[i]) return;
    this.mixer.stopAllAction();
    this.clipIndex = i;
    this.action = this.mixer.clipAction(this.clips[i]);
    this.applyLoop();
    this.action.reset().play();
    this.action.paused = !this.playing;
  }

  setInPlace(on: boolean) {
    if (on === this.inPlace) return;
    const time = this.action?.time ?? 0;
    this.mixer.stopAllAction();
    for (const c of this.clips) this.mixer.uncacheClip(c);
    // Restore the bind pose first so the stripped clip doesn't inherit a travelled position.
    this.root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.pose());
    this.inPlace = on;
    this.clips = on ? this.source.map((c) => inPlaceClip(this.root, c).clip) : this.source;
    if (this.clipIndex >= 0) {
      this.setClip(this.clipIndex);
      this.seek(time);
    }
  }

  private applyLoop() {
    if (!this.action) return;
    this.action.setLoop(this.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    this.action.clampWhenFinished = true;
  }

  play() {
    this.playing = true;
    if (this.action) {
      const clip = this.clips[this.clipIndex];
      if (!this.loop && this.action.time >= clip.duration - 1e-3) this.action.reset();
      this.action.paused = false;
      this.action.play();
    }
  }
  pause() {
    this.playing = false;
    if (this.action) this.action.paused = true;
  }
  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }
  setSpeed(s: number) {
    this.speed = s;
    this.mixer.timeScale = s;
  }
  setLoop(l: boolean) {
    this.loop = l;
    this.applyLoop();
  }
  seek(time: number) {
    if (!this.action) return;
    this.action.paused = false;
    this.action.time = Math.max(0, Math.min(time, this.clips[this.clipIndex].duration));
    this.action.enabled = true;
    this.mixer.update(0);
    this.action.paused = !this.playing;
  }
  step(dir: number) {
    this.pause();
    const fps = this.fps[this.clipIndex] ?? 30;
    // Snap to the frame grid so repeated steps never drift between frames.
    const last = Math.round((this.clips[this.clipIndex]?.duration ?? 0) * fps);
    const frame = Math.max(0, Math.min(last, Math.round((this.action?.time ?? 0) * fps) + dir));
    this.seek(frame / fps);
  }
  goToStart() {
    this.pause();
    this.seek(0);
  }
  goToEnd() {
    this.pause();
    this.seek(this.clips[this.clipIndex]?.duration ?? 0);
  }
  update(dt: number) {
    this.mixer.update(dt);
  }
}

/** Frame-by-frame sprite animation with per-frame durations and Aseprite directions. */
export class FramePlayback implements Playback {
  private frames: SpriteFrame[];
  private anims: SpriteAnimation[];
  private animIndex = -1;
  private order: number[] = [];
  private pos = 0;
  private acc = 0;
  private playing = false;
  private speed = 1;
  private loop = true;
  private onFrame: (frame: number) => void;

  constructor(frames: SpriteFrame[], anims: SpriteAnimation[], onFrame: (frame: number) => void) {
    this.frames = frames;
    this.anims = anims;
    this.onFrame = onFrame;
    if (anims.length) this.setClip(0);
    else onFrame(0);
  }

  private orderDuration(order: number[]) {
    return order.reduce((s, f) => s + (this.frames[f]?.duration ?? 100), 0) / 1000;
  }

  state(): PlaybackState {
    const timeMs = this.order.slice(0, this.pos).reduce((s, f) => s + this.frames[f].duration, 0) + this.acc;
    return {
      clips: this.anims.map((a) => ({ name: a.name, duration: this.orderDuration(playbackOrder(a.frames, a.direction)) })),
      clip: this.animIndex,
      playing: this.playing,
      speed: this.speed,
      loop: this.loop,
      time: timeMs / 1000,
      duration: this.orderDuration(this.order),
      frame: this.order[this.pos] ?? 0,
      frameInClip: this.pos,
      frameCount: this.order.length,
      unit: 'frames',
    };
  }

  setClip(i: number) {
    const a = this.anims[i];
    if (!a) return;
    this.animIndex = i;
    this.order = playbackOrder(a.frames, a.direction).filter((f) => f < this.frames.length);
    this.pos = 0;
    this.acc = 0;
    this.emit();
  }
  play() {
    if (!this.loop && this.pos >= this.order.length - 1) this.pos = 0;
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }
  setSpeed(s: number) {
    this.speed = s;
  }
  setLoop(l: boolean) {
    this.loop = l;
  }
  seek(time: number) {
    let t = time * 1000;
    for (let i = 0; i < this.order.length; i++) {
      const d = this.frames[this.order[i]].duration;
      if (t < d || i === this.order.length - 1) {
        this.pos = i;
        this.acc = Math.min(Math.max(t, 0), d - 1);
        break;
      }
      t -= d;
    }
    this.emit();
  }
  /** Jump straight to a position in the clip. */
  seekFrame(posInClip: number) {
    if (!this.order.length) return;
    this.pos = ((posInClip % this.order.length) + this.order.length) % this.order.length;
    this.acc = 0;
    this.emit();
  }
  step(dir: number) {
    this.pause();
    this.seekFrame(this.pos + dir);
  }
  goToStart() {
    this.pause();
    this.seekFrame(0);
  }
  goToEnd() {
    this.pause();
    this.seekFrame(this.order.length - 1);
  }
  update(dt: number) {
    if (!this.playing || this.order.length < 2) return;
    this.acc += dt * 1000 * this.speed;
    let changed = false;
    for (let guard = 0; guard < 1000; guard++) {
      const d = this.frames[this.order[this.pos]].duration;
      if (this.acc < d) break;
      this.acc -= d;
      if (this.pos + 1 >= this.order.length) {
        if (!this.loop) {
          this.playing = false;
          this.acc = 0;
          break;
        }
        this.pos = 0;
      } else this.pos++;
      changed = true;
    }
    if (changed) this.emit();
  }
  private emit() {
    this.onFrame(this.order[this.pos] ?? 0);
  }
}

/** Turntable for sprite stacks: "time" is the yaw angle in degrees. */
export class SpinPlayback implements Playback {
  private angle = 0;
  private playing = false;
  private speed = 1;
  private onAngle: (radians: number) => void;
  /** Degrees per second at speed 1. */
  private rate = 60;

  constructor(onAngle: (radians: number) => void) {
    this.onAngle = onAngle;
  }
  state(): PlaybackState {
    return {
      clips: [{ name: 'turntable', duration: 360 }],
      clip: 0,
      playing: this.playing,
      speed: this.speed,
      loop: true,
      time: this.angle,
      duration: 360,
      unit: 'degrees',
    };
  }
  setClip() {}
  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  toggle() {
    this.playing = !this.playing;
  }
  setSpeed(s: number) {
    this.speed = s;
  }
  setLoop() {}
  seek(deg: number) {
    this.angle = ((deg % 360) + 360) % 360;
    this.onAngle(THREE.MathUtils.degToRad(this.angle));
  }
  step(dir: number) {
    this.pause();
    // Snap to 22.5° steps (16 directions) — the usual stacked-sprite review angles.
    const stepDeg = 22.5;
    this.seek(Math.round(this.angle / stepDeg) * stepDeg + dir * stepDeg);
  }
  goToStart() {
    this.pause();
    this.seek(0);
  }
  goToEnd() {
    this.goToStart();
  }
  update(dt: number) {
    if (this.playing) this.seek(this.angle + dt * this.rate * this.speed);
  }
}
