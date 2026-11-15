import * as THREE from 'three';

/**
 * Fixed pool of real PointLights driven by any number of "virtual" lights.
 *
 * Forward rendering pays for every point light on every lit pixel, and changing the
 * number of lights forces three.js to recompile every material (frame hitches).
 * Level code keeps creating ordinary PointLight objects; the pool detaches them from the
 * scene graph and, each frame, copies the N most relevant ones (nearest the camera focus)
 * into a constant set of real lights. Lights near the cut-off fade instead of popping.
 */
export class LightPool {
  public readonly group = new THREE.Group();
  private real: THREE.PointLight[] = [];
  private virtual: THREE.PointLight[] = [];
  private scored: Array<{ l: THREE.PointLight; d: number }> = [];

  constructor(size = 8) {
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.6);
      l.castShadow = false;
      this.real.push(l);
      this.group.add(l);
    }
  }

  /** Steal every PointLight that is a direct or nested child of `root` (except kept ones). */
  public adoptFrom(root: THREE.Object3D): void {
    const found: THREE.PointLight[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.PointLight && !o.userData.keepReal) found.push(o);
    });
    for (const l of found) {
      l.updateWorldMatrix(true, false);
      const wp = new THREE.Vector3();
      l.getWorldPosition(wp);
      l.removeFromParent();
      l.position.copy(wp);
      l.castShadow = false;
      this.virtual.push(l);
    }
  }

  public clear(): void {
    this.virtual = [];
    for (const l of this.real) l.intensity = 0;
  }

  public get virtualCount(): number {
    return this.virtual.length;
  }

  public update(focus: THREE.Vector3): void {
    const scored = this.scored;
    scored.length = 0;
    for (const l of this.virtual) {
      if (l.intensity <= 0.01) continue;
      const d = l.position.distanceTo(focus) - Math.min(6, l.distance * 0.25);
      scored.push({ l, d });
    }
    scored.sort((a, b) => a.d - b.d);
    const n = this.real.length;
    const cutoff = scored.length > n ? scored[n].d : Infinity;
    for (let i = 0; i < n; i++) {
      const r = this.real[i];
      const s = scored[i];
      if (!s) {
        r.intensity = 0;
        continue;
      }
      // fade lights that are about to be swapped out
      const fade = cutoff === Infinity ? 1 : THREE.MathUtils.clamp((cutoff - s.d) / 4, 0, 1);
      r.position.copy(s.l.position);
      r.color.copy(s.l.color);
      r.distance = s.l.distance;
      r.decay = s.l.decay;
      r.intensity = s.l.intensity * fade;
    }
  }
}
