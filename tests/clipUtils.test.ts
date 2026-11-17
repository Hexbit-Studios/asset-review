import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { detectFps, findRootMotionTrack, inPlaceClip, rootTravel } from '../src/viewer/clipUtils.ts';

const sampled = (fps: number, frames: number) => Array.from({ length: frames }, (_, i) => i / fps);

function clipAt(times: number[]) {
  return new THREE.AnimationClip('c', -1, [new THREE.NumberKeyframeTrack('n.opacity', times, times.map(() => 1))]);
}

describe('detectFps', () => {
  it('recovers common sampled rates', () => {
    expect(detectFps(clipAt(sampled(24, 25)))).toBe(24);
    expect(detectFps(clipAt(sampled(30, 31)))).toBe(30);
    expect(detectFps(clipAt(sampled(60, 61)))).toBe(60);
    expect(detectFps(clipAt(sampled(25, 26)))).toBe(25);
  });
  it('handles Blender-style offset start times', () => {
    expect(detectFps(clipAt(sampled(24, 30).map((t) => t + 1 / 24)))).toBe(24);
  });
  it('prefers 30 for sparse keys and falls back sanely', () => {
    expect(detectFps(clipAt([0, 1, 2]))).toBe(30);
    expect(detectFps(clipAt([0]))).toBe(30);
  });
});

describe('root motion', () => {
  function walker() {
    const root = new THREE.Group();
    const armature = new THREE.Group();
    armature.rotation.x = -Math.PI / 2; // like a Z-up armature converted to Y-up
    armature.scale.setScalar(0.01); // and in centimetres
    const hips = new THREE.Bone();
    hips.name = 'hips';
    const spine = new THREE.Bone();
    spine.name = 'spine';
    hips.add(spine);
    armature.add(hips);
    root.add(armature);
    // Armature-local: forward is -Y (becomes +Z world after the rotation), up is +Z.
    const times = [0, 0.5, 1];
    const values = [0, 0, 100, 0, -70, 103, 0, -140, 100];
    const clip = new THREE.AnimationClip('walk', 1, [
      new THREE.VectorKeyframeTrack('hips.position', times, values),
      new THREE.VectorKeyframeTrack('spine.position', times, [0, 0, 10, 0, 0, 10, 0, 0, 10]),
      new THREE.QuaternionKeyframeTrack('hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    return { root, clip };
  }

  it('finds the top-most animated bone', () => {
    const { root, clip } = walker();
    expect(findRootMotionTrack(root, clip)?.node.name).toBe('hips');
  });

  it('measures travel in world metres through rotated / scaled parents', () => {
    const { root, clip } = walker();
    expect(rootTravel(root, clip)).toBeCloseTo(1.4, 5);
  });

  it('strips horizontal travel but keeps the vertical bob', () => {
    const { root, clip } = walker();
    const { clip: still, node } = inPlaceClip(root, clip);
    expect(node).toBe('hips');
    expect(rootTravel(root, still)).toBeCloseTo(0, 6);
    const v = still.tracks[0].values;
    expect(Array.from(v.slice(3, 6)).map((n) => +n.toFixed(4))).toEqual([0, 0, 103]); // bob kept
    expect(clip.tracks[0].values[4]).toBe(-70); // original untouched
  });
});

describe('android.glb fixture (Blender export)', () => {
  const file = new URL('../examples/models/android.glb', import.meta.url);
  it.skipIf(!fs.existsSync(file))('is skinned, 24 fps, and its walk travels 1.4 m', async () => {
    const buf = fs.readFileSync(file);
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    let skinned = 0;
    gltf.scene.traverse((o) => ((o as THREE.SkinnedMesh).isSkinnedMesh ? skinned++ : 0));
    expect(skinned).toBeGreaterThan(0);
    const byName = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(['idle', 'walk', 'wave']);
    for (const c of gltf.animations) expect(detectFps(c)).toBe(24);
    expect(rootTravel(gltf.scene, byName.walk)).toBeCloseTo(1.4, 2);
    expect(rootTravel(gltf.scene, byName.idle)).toBeLessThan(0.01);
    expect(rootTravel(gltf.scene, inPlaceClip(gltf.scene, byName.walk).clip)).toBeLessThan(1e-4);
  });
});
