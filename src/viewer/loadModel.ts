import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { VOXLoader } from 'three/examples/jsm/loaders/VOXLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { fileUrl } from '../api.ts';

export interface LoadedModel {
  object: THREE.Object3D;
  clips: THREE.AnimationClip[];
  notes: string[];
}

let draco: DRACOLoader | null = null;
function gltfLoader() {
  const loader = new GLTFLoader();
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/');
  }
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/** Voxel size in metres for .vox files (MagicaVoxel has no unit). */
export const VOX_SCALE = 1 / 16;

export async function loadModel(path: string, ext: string, version: number): Promise<LoadedModel> {
  const url = fileUrl(path, version);
  const notes: string[] = [];
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const gltf = await gltfLoader().loadAsync(url);
      return { object: gltf.scene, clips: gltf.animations, notes };
    }
    case 'blend': {
      const gltf = await gltfLoader().loadAsync(`/api/blend?path=${encodeURIComponent(path)}&v=${version}`);
      notes.push('Converted from .blend by Blender (modifiers applied)');
      return { object: gltf.scene, clips: gltf.animations, notes };
    }
    case 'fbx': {
      const obj = await new FBXLoader().loadAsync(url);
      // FBX is usually authored in centimetres.
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3()).length();
      if (size > 50) {
        obj.scale.multiplyScalar(0.01);
        notes.push('FBX looked like centimetres; scaled ×0.01');
      }
      return { object: obj, clips: obj.animations, notes };
    }
    case 'obj': {
      const loader = new OBJLoader();
      try {
        const mtl = await new MTLLoader().loadAsync(fileUrl(path.replace(/\.obj$/i, '.mtl'), version));
        mtl.preload();
        loader.setMaterials(mtl);
      } catch {
        notes.push('No .mtl found next to the .obj');
      }
      return { object: await loader.loadAsync(url), clips: [], notes };
    }
    case 'vox': {
      const result: any = await new VOXLoader().loadAsync(url);
      const object: THREE.Object3D = result.scene ?? new THREE.Group();
      object.scale.multiplyScalar(VOX_SCALE);
      notes.push(`Voxel size shown as ${VOX_SCALE} m`);
      return { object, clips: [], notes };
    }
    default:
      throw new Error(`Unsupported model type .${ext}`);
  }
}
