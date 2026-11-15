import * as THREE from 'three';

/**
 * MaterialFX — injects a shared "hero shading" layer into existing KayKit / glTF
 * MeshStandardMaterials via onBeforeCompile (no new meshes needed):
 *  - Fresnel rim-light highlight (per-object color / strength)
 *  - Crisp hit-flash emissive pulse (white on enemies, red on the player)
 *  - Icy translucent freeze look for Frost Diver (cyan fresnel + frost tint + sparkle)
 *  - Animated elemental shimmer for refined weapons (+7 cyan/gold, +10 radiant flame)
 */

export interface MaterialFXUniforms {
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uRimPower: { value: number };
  uFlashColor: { value: THREE.Color };
  uFlash: { value: number };
  uFreeze: { value: number };
  uShimmerColor: { value: THREE.Color };
  uShimmer: { value: number };
  uTime: { value: number };
}

const sharedTime = { value: 0 };

interface FxHandle {
  uniforms: MaterialFXUniforms;
  flashTimer: number;
  flashDuration: number;
  flashPeak: number;
  freezeTarget: number;
}

const handles = new WeakMap<THREE.Object3D, FxHandle>();
const liveHandles = new Set<FxHandle>();

function patchMaterial(mat: THREE.MeshStandardMaterial, uniforms: MaterialFXUniforms): THREE.MeshStandardMaterial {
  const m = mat.clone();
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRimColor;
        uniform float uRimStrength;
        uniform float uRimPower;
        uniform vec3 uFlashColor;
        uniform float uFlash;
        uniform float uFreeze;
        uniform vec3 uShimmerColor;
        uniform float uShimmer;
        uniform float uTime;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 fxViewDir = normalize(vViewPosition);
          float fxFres = pow(1.0 - clamp(dot(fxViewDir, normal), 0.0, 1.0), uRimPower);
          totalEmissiveRadiance += uRimColor * fxFres * uRimStrength;

          // Frost Diver: icy tint, glassy fresnel, crystalline glints
          if (uFreeze > 0.001) {
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.85, 1.0), 0.65 * uFreeze);
            float glint = pow(max(0.0, sin(vViewPosition.x * 9.0 + vViewPosition.y * 13.0 + uTime * 2.0)), 24.0);
            totalEmissiveRadiance += vec3(0.30, 0.80, 1.0) * (fxFres * 2.2 + 0.10 + glint * 0.9) * uFreeze;
          }

          // Refined weapon shimmer (scrolling energy bands)
          if (uShimmer > 0.001) {
            float band = 0.5 + 0.5 * sin(vViewPosition.y * 6.0 - uTime * 5.0 + vViewPosition.x * 3.0);
            totalEmissiveRadiance += uShimmerColor * uShimmer * (0.45 + band * 0.9 + fxFres * 1.4);
          }

          totalEmissiveRadiance += uFlashColor * uFlash;
        }`
      );
  };
  m.customProgramCacheKey = () => 'cryptfall-matfx-v1';
  return m;
}

function makeUniforms(rimColor: number, rimStrength: number, rimPower: number): MaterialFXUniforms {
  return {
    uRimColor: { value: new THREE.Color(rimColor) },
    uRimStrength: { value: rimStrength },
    uRimPower: { value: rimPower },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uFlash: { value: 0 },
    uFreeze: { value: 0 },
    uShimmerColor: { value: new THREE.Color(0x000000) },
    uShimmer: { value: 0 },
    uTime: sharedTime,
  };
}

export const MaterialFX = {
  /** Apply rim-light + flash/freeze channels to every standard material under `root`. */
  apply(root: THREE.Object3D, rimColor = 0x9fb4ff, rimStrength = 0.55, rimPower = 2.6): MaterialFXUniforms {
    const existing = handles.get(root);
    if (existing) {
      existing.uniforms.uRimColor.value.setHex(rimColor);
      existing.uniforms.uRimStrength.value = rimStrength;
      return existing.uniforms;
    }
    const uniforms = makeUniforms(rimColor, rimStrength, rimPower);
    const walk = (obj: THREE.Object3D) => {
      // Sub-trees that already own an FX handle (e.g. shimmering weapons) keep their own uniforms
      if (obj !== root && handles.has(obj)) return;
      if (obj instanceof THREE.Mesh) {
        if (Array.isArray(obj.material)) {
          obj.material = obj.material.map((mm) =>
            mm instanceof THREE.MeshStandardMaterial ? patchMaterial(mm, uniforms) : mm
          );
        } else if (obj.material instanceof THREE.MeshStandardMaterial) {
          obj.material = patchMaterial(obj.material, uniforms);
        }
      }
      for (const child of obj.children) walk(child);
    };
    walk(root);
    const handle: FxHandle = { uniforms, flashTimer: 0, flashDuration: 0.12, flashPeak: 0, freezeTarget: 0 };
    handles.set(root, handle);
    liveHandles.add(handle);
    return uniforms;
  },

  /** Separate weapon-only shimmer layer (weapons get their own uniforms so the body does not glow). */
  applyWeaponShimmer(weaponRoot: THREE.Object3D, color: number, strength: number): void {
    let h = handles.get(weaponRoot);
    if (!h) {
      MaterialFX.apply(weaponRoot, color, 0.0, 2.0);
      h = handles.get(weaponRoot)!;
    }
    h.uniforms.uShimmerColor.value.setHex(color);
    h.uniforms.uShimmer.value = strength;
    h.uniforms.uRimColor.value.setHex(color);
    h.uniforms.uRimStrength.value = strength * 0.8;
  },

  /** 0.12s crisp emissive impact flash. */
  flash(root: THREE.Object3D, color = 0xffffff, peak = 1.6, duration = 0.12): void {
    const h = handles.get(root);
    if (!h) return;
    h.uniforms.uFlashColor.value.setHex(color);
    h.flashPeak = peak;
    h.flashDuration = duration;
    h.flashTimer = duration;
    h.uniforms.uFlash.value = peak;
  },

  setFrozen(root: THREE.Object3D, frozen: boolean): void {
    const h = handles.get(root);
    if (!h) return;
    h.freezeTarget = frozen ? 1 : 0;
  },

  release(root: THREE.Object3D): void {
    const h = handles.get(root);
    if (h) {
      liveHandles.delete(h);
      handles.delete(root);
    }
  },

  update(dt: number): void {
    sharedTime.value += dt;
    for (const h of liveHandles) {
      if (h.flashTimer > 0) {
        h.flashTimer = Math.max(0, h.flashTimer - dt);
        const p = h.flashTimer / Math.max(0.001, h.flashDuration);
        // Hold-then-snap curve: stays crisp for the first 40% then drops off fast
        h.uniforms.uFlash.value = h.flashPeak * (p > 0.6 ? 1 : p / 0.6) * (p > 0.6 ? 1 : p / 0.6);
      }
      const f = h.uniforms.uFreeze.value;
      if (Math.abs(f - h.freezeTarget) > 0.001) {
        h.uniforms.uFreeze.value = f + (h.freezeTarget - f) * Math.min(1, dt * 7);
      }
    }
  },
};
