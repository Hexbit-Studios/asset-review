// Lighting presets as data, and the code that turns a rig into three.js lights.

import * as THREE from 'three';
import type { LightRig } from '../../shared/types.ts';

/** A preset name: one of the built-ins or a user-defined one. */
export type Lighting = string;
export type BuiltinLighting = 'studio' | 'day' | 'night' | 'neon' | 'flat';
export const BUILTIN_PRESETS: BuiltinLighting[] = ['studio', 'day', 'night', 'neon', 'flat'];
export const BUILTIN_LABELS: Record<BuiltinLighting, string> = {
  studio: 'Studio',
  day: 'Day',
  night: 'Night',
  neon: 'Neon night',
  flat: 'Flat',
};

export function isBuiltin(name: string): name is BuiltinLighting {
  return (BUILTIN_PRESETS as string[]).includes(name);
}

/** Validate a name for a new preset against the existing ones. Returns an error or null. */
export function presetNameError(name: string, existing: string[]): string | null {
  const n = name.trim();
  if (!n) return 'Give the preset a name';
  if (n.length > 40) return 'Keep it under 40 characters';
  if (existing.some((e) => e.toLowerCase() === n.toLowerCase())) return 'A preset with that name already exists';
  return null;
}

const off = { color: '#ffffff', intensity: 0 };

export const BUILTIN_RIGS: Record<BuiltinLighting, LightRig> = {
  studio: {
    exposure: 1,
    environment: 0.9,
    toneMapping: true,
    ambient: off,
    hemisphere: { sky: '#ffffff', ground: '#444444', intensity: 0 },
    key: { color: '#ffffff', intensity: 1.6, azimuth: 39, elevation: 43, shadows: true },
    accents: [],
  },
  day: {
    exposure: 1,
    environment: 0.45,
    toneMapping: true,
    ambient: off,
    hemisphere: { sky: '#bfdcff', ground: '#6b5a48', intensity: 1.1 },
    key: { color: '#ffe2b8', intensity: 3.2, azimuth: 304, elevation: 59, shadows: true },
    accents: [],
  },
  // Neutral night that suits most games: cool moonlight from the front, a soft blue sky fill so
  // shadows aren't black, and a cool rim from behind so silhouettes separate from a dark scene.
  night: {
    exposure: 1,
    environment: 0.3,
    toneMapping: true,
    ambient: { color: '#28324f', intensity: 0.6 },
    hemisphere: { sky: '#5a72b8', ground: '#151a26', intensity: 1.8 },
    key: { color: '#c4d2ff', intensity: 2.6, azimuth: 350, elevation: 40, shadows: true },
    // Rim from behind the default 3/4 camera (which sits at 45°).
    accents: [{ color: '#a9bdff', intensity: 14, azimuth: 215, elevation: 30, distance: 2.2 }],
  },
  // Cyberpunk street: dim blue moon, magenta and cyan neon from either side.
  neon: {
    exposure: 1,
    environment: 0.06,
    toneMapping: true,
    ambient: { color: '#1a2350', intensity: 0.6 },
    hemisphere: { sky: '#2a3570', ground: '#120c1c', intensity: 0 },
    key: { color: '#7d95ff', intensity: 0.5, azimuth: 135, elevation: 65, shadows: true },
    accents: [
      { color: '#ff2bd6', intensity: 6, azimuth: 307, elevation: 24, distance: 2.2 },
      { color: '#22e5ff', intensity: 6, azimuth: 58, elevation: 20, distance: 2.0 },
    ],
  },
  flat: {
    exposure: 1,
    environment: 0,
    toneMapping: false,
    ambient: { color: '#ffffff', intensity: 2.6 },
    hemisphere: { sky: '#ffffff', ground: '#444444', intensity: 0 },
    key: { color: '#ffffff', intensity: 0, azimuth: 0, elevation: 45, shadows: false },
    accents: [],
  },
};

export function cloneRig(r: LightRig): LightRig {
  return structuredClone(r);
}

/** Unit vector for an azimuth / elevation pair (degrees). */
export function direction(azimuth: number, elevation: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuth);
  const el = THREE.MathUtils.degToRad(elevation);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/**
 * Populate `group` with the rig's lights for an asset of bounding radius `r`.
 * Returns the key light (for shadow setup) or null when it is off.
 */
export function buildRig(rig: LightRig, r: number, group: THREE.Group): THREE.DirectionalLight | null {
  if (rig.ambient.intensity > 0) group.add(new THREE.AmbientLight(rig.ambient.color, rig.ambient.intensity));
  if (rig.hemisphere.intensity > 0)
    group.add(new THREE.HemisphereLight(rig.hemisphere.sky, rig.hemisphere.ground, rig.hemisphere.intensity));
  let key: THREE.DirectionalLight | null = null;
  if (rig.key.intensity > 0) {
    key = new THREE.DirectionalLight(rig.key.color, rig.key.intensity);
    key.position.copy(direction(rig.key.azimuth, rig.key.elevation)).multiplyScalar(r * 4);
    group.add(key);
  }
  for (const a of rig.accents) {
    if (a.intensity <= 0) continue;
    // Intensity scales with r² so the light on the asset is the same whatever its size.
    const light = new THREE.PointLight(a.color, a.intensity * r * r, r * a.distance * 4, 2);
    light.position.copy(direction(a.azimuth, a.elevation)).multiplyScalar(r * a.distance);
    group.add(light);
  }
  return key;
}
