import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merges static, non-skinned meshes under `root` into one mesh per (material, cell).
 * Cells keep merged chunks small enough to frustum-cull per room. Objects in `exclude`
 * (animated gates, traps, NPCs, interactables, bobbing crystals...) are left untouched.
 * Typical result: ~700 draw calls → well under 100.
 */
export function batchStaticMeshes(root: THREE.Object3D, exclude: Set<THREE.Object3D>, cellSize = 28): number {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  interface Bucket {
    material: THREE.Material;
    geos: THREE.BufferGeometry[];
    owners: Set<THREE.Object3D>;
    cast: boolean;
    receive: boolean;
  }
  const buckets = new Map<string, Bucket>();
  const candidates: THREE.Object3D[] = [];

  for (const child of root.children) {
    if (exclude.has(child)) continue;
    if (child instanceof THREE.Light || child instanceof THREE.Sprite || child instanceof THREE.Points) continue;
    let ok = true;
    const meshes: THREE.Mesh[] = [];
    child.traverse((o) => {
      if (!ok) return;
      if (exclude.has(o) || (o as THREE.SkinnedMesh).isSkinnedMesh || o instanceof THREE.Sprite || o instanceof THREE.Light) {
        ok = false;
        return;
      }
      if (o instanceof THREE.Mesh) {
        if (Array.isArray(o.material) || (o as THREE.InstancedMesh).isInstancedMesh || !o.visible) {
          ok = false;
          return;
        }
        meshes.push(o);
      }
    });
    if (!ok || meshes.length === 0) continue;
    candidates.push(child);
    for (const m of meshes) {
      const g = m.geometry as THREE.BufferGeometry;
      const attrs = Object.keys(g.attributes)
        .sort()
        .map((k) => `${k}${g.attributes[k].itemSize}`)
        .join(',');
      const wp = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
      const cell = `${Math.round(wp.x / cellSize)}_${Math.round(wp.z / cellSize)}`;
      const mat = m.material as THREE.Material;
      const key = `${mat.uuid}|${attrs}|${g.index ? 'i' : 'n'}|${cell}`;
      let b = buckets.get(key);
      if (!b) {
        b = { material: mat, geos: [], owners: new Set(), cast: false, receive: false };
        buckets.set(key, b);
      }
      const clone = g.clone();
      clone.morphAttributes = {};
      clone.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld));
      b.geos.push(clone);
      b.owners.add(child);
      b.cast ||= m.castShadow;
      b.receive ||= m.receiveShadow;
    }
  }

  // Merge; any owner whose bucket fails to merge is kept as-is
  const failed = new Set<THREE.Object3D>();
  const merged: THREE.Mesh[] = [];
  for (const b of buckets.values()) {
    if (b.geos.length < 2) {
      b.owners.forEach((o) => failed.add(o));
      b.geos.forEach((g) => g.dispose());
      continue;
    }
    const geo = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!geo) {
      b.owners.forEach((o) => failed.add(o));
      continue;
    }
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.matrixAutoUpdate = false;
    mesh.userData.batched = true;
    merged.push(mesh);
  }
  if (failed.size > 0) {
    // An owner must be merged entirely or not at all (otherwise it would draw twice):
    // redo the pass with failed owners (single-mesh buckets / incompatible attributes) excluded.
    merged.forEach((m) => m.geometry.dispose());
    const keep = new Set(exclude);
    failed.forEach((o) => keep.add(o));
    if (keep.size === exclude.size) return 0;
    return batchStaticMeshes(root, keep, cellSize);
  }
  for (const c of candidates) root.remove(c);
  for (const m of merged) root.add(m);
  return candidates.length;
}
