import * as THREE from 'three';

const PREFERRED_FPS = [30, 24, 60, 25, 50, 15, 12, 48, 120];

/**
 * glTF has no frame rate, so infer one from key times: the first common rate (in preference
 * order) that every key lands on, and that is at least as fine as the closest pair of keys.
 * Sampled exports (Blender's default) put a key on every frame, so this recovers the scene fps.
 */
export function detectFps(clip: THREE.AnimationClip): number {
  const times = new Set<number>();
  for (const t of clip.tracks) for (const v of t.times) times.add(v);
  const sorted = [...times].sort((a, b) => a - b);
  let minDelta = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1];
    if (d > 1e-6) minDelta = Math.min(minDelta, d);
  }
  if (!Number.isFinite(minDelta)) return 30;
  const needed = 1 / minDelta - 0.5;
  for (const fps of PREFERRED_FPS) {
    if (fps < needed) continue;
    if (sorted.every((t) => Math.abs(t * fps - Math.round(t * fps)) < 0.02)) return fps;
  }
  return Math.round(1 / minDelta) || 30;
}

function depthOf(o: THREE.Object3D) {
  let d = 0;
  for (let p = o.parent; p; p = p.parent) d++;
  return d;
}

/**
 * The track that carries root motion: the position track of the top-most animated bone
 * (usually hips / root), or of the top-most animated node when there is no skeleton.
 */
export function findRootMotionTrack(root: THREE.Object3D, clip: THREE.AnimationClip) {
  let best: { track: THREE.KeyframeTrack; node: THREE.Object3D; bone: boolean; depth: number } | null = null;
  for (const track of clip.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    if (parsed.propertyName !== 'position') continue;
    const node = THREE.PropertyBinding.findNode(root, parsed.nodeName) as THREE.Object3D | undefined;
    if (!node) continue;
    const bone = !!(node as THREE.Bone).isBone;
    const depth = depthOf(node);
    if (!best || (bone && !best.bone) || (bone === best.bone && depth < best.depth)) best = { track, node, bone, depth };
  }
  return best;
}

/**
 * Copy of the clip with horizontal root travel removed: the root keeps its first-frame X/Z in
 * world space (vertical bob and rotation are untouched), so walk cycles play on the spot.
 */
export function inPlaceClip(root: THREE.Object3D, clip: THREE.AnimationClip): { clip: THREE.AnimationClip; node: string | null } {
  const found = findRootMotionTrack(root, clip);
  if (!found) return { clip, node: null };
  const copy = clip.clone();
  const track = copy.tracks[clip.tracks.indexOf(found.track)];
  root.updateWorldMatrix(true, true);
  // Keys are in the parent's space; do the flattening in world space so rotated / scaled
  // armatures (Mixamo FBX, Blender exports) behave.
  const parent = found.node.parent;
  const toWorld = parent ? parent.matrixWorld.clone() : new THREE.Matrix4();
  const toLocal = toWorld.clone().invert();
  const v = track.values;
  const p = new THREE.Vector3();
  const first = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(toWorld);
  for (let i = 0; i < v.length; i += 3) {
    p.set(v[i], v[i + 1], v[i + 2]).applyMatrix4(toWorld);
    p.x = first.x;
    p.z = first.z;
    p.applyMatrix4(toLocal);
    v[i] = p.x;
    v[i + 1] = p.y;
    v[i + 2] = p.z;
  }
  return { clip: copy, node: found.node.name || null };
}

/** Horizontal distance the root travels over the clip (metres), for the inspector. */
export function rootTravel(root: THREE.Object3D, clip: THREE.AnimationClip): number {
  const found = findRootMotionTrack(root, clip);
  if (!found) return 0;
  root.updateWorldMatrix(true, true);
  const m = found.node.parent?.matrixWorld ?? new THREE.Matrix4();
  const v = found.track.values;
  const a = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(m);
  const n = v.length - 3;
  const b = new THREE.Vector3(v[n], v[n + 1], v[n + 2]).applyMatrix4(m);
  return Math.hypot(b.x - a.x, b.z - a.z);
}
