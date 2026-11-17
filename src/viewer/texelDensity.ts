import * as THREE from 'three';

export interface DensityResult {
  /** Surface area in world units² (metres² if the asset is in metres). */
  worldArea: number;
  /** Area covered in UV space (1 = the whole texture once). */
  uvArea: number;
  /** Texels per world unit (px/m), area weighted. NaN without UVs. */
  density: number;
  textureSize: [number, number] | null;
}

/** Area-weighted texel density of one mesh: sqrt(uvArea·texW·texH / worldArea). */
export function meshTexelDensity(mesh: THREE.Mesh, textureSize: [number, number] | null): DensityResult {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const index = geo.getIndex();
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3();
  let worldArea = 0;
  let uvArea = 0;
  const triCount = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(m);
    b.fromBufferAttribute(pos, i1).applyMatrix4(m);
    c.fromBufferAttribute(pos, i2).applyMatrix4(m);
    worldArea += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    if (uv) {
      const u0 = uv.getX(i0),
        v0 = uv.getY(i0);
      const u1 = uv.getX(i1),
        v1 = uv.getY(i1);
      const u2 = uv.getX(i2),
        v2 = uv.getY(i2);
      uvArea += Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2;
    }
  }
  const density =
    uv && textureSize && worldArea > 0 ? Math.sqrt((uvArea * textureSize[0] * textureSize[1]) / worldArea) : NaN;
  return { worldArea, uvArea, density, textureSize };
}

export function textureSizeOf(material: THREE.Material | THREE.Material[]): [number, number] | null {
  const mats = Array.isArray(material) ? material : [material];
  for (const mat of mats) {
    const map = (mat as THREE.MeshStandardMaterial).map;
    const img = map?.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) return [img.width, img.height];
  }
  return null;
}

/** Combined density for a whole object (area weighted across meshes that have textures). */
export function objectTexelDensity(root: THREE.Object3D) {
  const perMesh: { name: string; result: DensityResult }[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    perMesh.push({ name: mesh.name || mesh.parent?.name || 'mesh', result: meshTexelDensity(mesh, textureSizeOf(mesh.material)) });
  });
  let texels = 0;
  let area = 0;
  for (const { result } of perMesh) {
    if (!Number.isFinite(result.density)) continue;
    texels += result.density ** 2 * result.worldArea;
    area += result.worldArea;
  }
  return { perMesh, density: area > 0 ? Math.sqrt(texels / area) : NaN };
}
