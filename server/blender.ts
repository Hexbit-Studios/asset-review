// .blend -> .glb conversion using a local Blender install, cached by file mtime/size.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const CANDIDATES = [
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'C:\\Program Files\\Blender Foundation\\Blender\\blender.exe',
  '/usr/bin/blender',
  '/snap/bin/blender',
];

let cachedBlender: string | null | undefined;

export function findBlender(): string | null {
  if (cachedBlender !== undefined) return cachedBlender;
  const fromEnv = process.env.BLENDER_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return (cachedBlender = fromEnv);
  for (const c of CANDIDATES) if (fs.existsSync(c)) return (cachedBlender = c);
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8' });
  const found = which.status === 0 ? which.stdout.split('\n')[0].trim() : '';
  return (cachedBlender = found || null);
}

const EXPORT_SCRIPT = `
import bpy, sys
out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_apply=True,
    export_animations=True,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
)
`;

const inflight = new Map<string, Promise<string>>();

/** Returns the absolute path of a cached .glb for the given .blend, converting if needed. */
export function blendToGlb(blendAbs: string, cacheDir: string): Promise<string> {
  const blender = findBlender();
  if (!blender) return Promise.reject(new Error('Blender not found. Set BLENDER_PATH.'));
  const st = fs.statSync(blendAbs);
  const key = crypto.createHash('sha1').update(`${blendAbs}|${st.mtimeMs}|${st.size}`).digest('hex').slice(0, 16);
  const out = path.join(cacheDir, `${path.basename(blendAbs, '.blend')}-${key}.glb`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  const existing = inflight.get(out);
  if (existing) return existing;

  const job = new Promise<string>((resolve, reject) => {
    const proc = spawn(blender, ['--background', blendAbs, '--python-expr', EXPORT_SCRIPT, '--', out], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    proc.stdout.on('data', (d) => (log += d));
    proc.stderr.on('data', (d) => (log += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      inflight.delete(out);
      if (code === 0 && fs.existsSync(out)) resolve(out);
      else reject(new Error(`Blender export failed (exit ${code}):\n${log.slice(-2000)}`));
    });
  });
  inflight.set(out, job);
  return job;
}
