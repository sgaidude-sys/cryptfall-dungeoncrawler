import * as THREE from 'three';
import { PostFX, GradeSettings } from './PostFX';
import { AmbientParticles, ParticleStyle } from './AmbientParticles';

export type BiomeId = 'town' | 'town_dawn' | 'crypt' | 'ruins' | 'spire' | 'abyss' | 'menu';

interface BiomePreset {
  background: number;
  fog: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyColor: number;
  keyIntensity: number;
  rimColor: number; // back/rim light
  rimIntensity: number;
  particles: ParticleStyle;
  grade: GradeSettings;
}

const c = (hex: number) => new THREE.Color(hex);

const PRESETS: Record<BiomeId, BiomePreset> = {
  // Oakhaven: warm amber hearth glow, cosy but slightly smoky
  town: {
    background: 0x1a1220,
    fog: 0x2a1a1c,
    fogDensity: 0.016,
    hemiSky: 0xffc98a,
    hemiGround: 0x2a1a24,
    hemiIntensity: 0.7,
    keyColor: 0xffd6a0,
    keyIntensity: 1.25,
    rimColor: 0x8a5cff,
    rimIntensity: 0.55,
    particles: 'motes',
    grade: {
      tint: c(0xfff0dc),
      shadowTint: c(0x6a2fa0),
      saturation: 1.08,
      contrast: 1.06,
      vignette: 0.42,
      vignetteColor: c(0x1a0c06),
      bloomStrength: 0.6,
      bloomRadius: 0.45,
      bloomThreshold: 0.8,
      exposure: 1.18,
    },
  },
  // Post-finale golden sunrise over Oakhaven
  town_dawn: {
    background: 0x3b2a3a,
    fog: 0x6b4a46,
    fogDensity: 0.011,
    hemiSky: 0xffe2a8,
    hemiGround: 0x4a3040,
    hemiIntensity: 1.0,
    keyColor: 0xffe0a0,
    keyIntensity: 1.8,
    rimColor: 0xffb070,
    rimIntensity: 0.8,
    particles: 'gold',
    grade: {
      tint: c(0xfff2d8),
      shadowTint: c(0xff8a4a),
      saturation: 1.12,
      contrast: 1.04,
      vignette: 0.3,
      vignetteColor: c(0x2a1206),
      bloomStrength: 0.75,
      bloomRadius: 0.55,
      bloomThreshold: 0.74,
      exposure: 1.32,
    },
  },
  // Sunken Crypt: eerie teal / violet mist
  crypt: {
    background: 0x050a10,
    fog: 0x0b1a22,
    fogDensity: 0.026,
    hemiSky: 0x4fb6c9,
    hemiGround: 0x1a0f2a,
    hemiIntensity: 0.62,
    keyColor: 0x9fd8ff,
    keyIntensity: 0.9,
    rimColor: 0x9a6bff,
    rimIntensity: 0.7,
    particles: 'mist',
    grade: {
      tint: c(0xd8f2ff),
      shadowTint: c(0x4a2a9a),
      saturation: 0.92,
      contrast: 1.12,
      vignette: 0.6,
      vignetteColor: c(0x04060c),
      bloomStrength: 0.62,
      bloomRadius: 0.48,
      bloomThreshold: 0.8,
      exposure: 1.15,
    },
  },
  // Overgrown Ruins: emerald spore light
  ruins: {
    background: 0x06120c,
    fog: 0x0c2416,
    fogDensity: 0.024,
    hemiSky: 0x7dffa8,
    hemiGround: 0x14200c,
    hemiIntensity: 0.6,
    keyColor: 0xd4ffb0,
    keyIntensity: 0.95,
    rimColor: 0x2dd4bf,
    rimIntensity: 0.6,
    particles: 'spores',
    grade: {
      tint: c(0xe6ffe0),
      shadowTint: c(0x0f5a3a),
      saturation: 1.04,
      contrast: 1.1,
      vignette: 0.55,
      vignetteColor: c(0x020a04),
      bloomStrength: 0.66,
      bloomRadius: 0.5,
      bloomThreshold: 0.78,
      exposure: 1.18,
    },
  },
  // Obsidian Spire: crimson magma rim-light
  spire: {
    background: 0x0e0406,
    fog: 0x22080a,
    fogDensity: 0.025,
    hemiSky: 0xff6a4a,
    hemiGround: 0x12040a,
    hemiIntensity: 0.55,
    keyColor: 0xffb8a0,
    keyIntensity: 0.85,
    rimColor: 0xff2a1a,
    rimIntensity: 1.1,
    particles: 'ash',
    grade: {
      tint: c(0xffe4dc),
      shadowTint: c(0x8a0a1a),
      saturation: 1.1,
      contrast: 1.16,
      vignette: 0.62,
      vignetteColor: c(0x120202),
      bloomStrength: 0.72,
      bloomRadius: 0.5,
      bloomThreshold: 0.76,
      exposure: 1.14,
    },
  },
  // Endless Abyss: desaturated violet void with crimson embers
  abyss: {
    background: 0x07040e,
    fog: 0x140a22,
    fogDensity: 0.028,
    hemiSky: 0x8a6bff,
    hemiGround: 0x0a0410,
    hemiIntensity: 0.55,
    keyColor: 0xc8b8ff,
    keyIntensity: 0.8,
    rimColor: 0xd946ef,
    rimIntensity: 0.9,
    particles: 'embers',
    grade: {
      tint: c(0xece0ff),
      shadowTint: c(0x5a1a8a),
      saturation: 0.9,
      contrast: 1.18,
      vignette: 0.68,
      vignetteColor: c(0x060210),
      bloomStrength: 0.7,
      bloomRadius: 0.52,
      bloomThreshold: 0.77,
      exposure: 1.12,
    },
  },
  menu: {
    background: 0x09080d,
    fog: 0x0d0b14,
    fogDensity: 0.022,
    hemiSky: 0x6f7dc0,
    hemiGround: 0x16121d,
    hemiIntensity: 0.8,
    keyColor: 0xdbeafe,
    keyIntensity: 1.1,
    rimColor: 0xa855f7,
    rimIntensity: 0.7,
    particles: 'embers',
    grade: {
      tint: c(0xf2ecff),
      shadowTint: c(0x4a2a9a),
      saturation: 1.0,
      contrast: 1.1,
      vignette: 0.55,
      vignetteColor: c(0x05040a),
      bloomStrength: 0.62,
      bloomRadius: 0.45,
      bloomThreshold: 0.8,
      exposure: 1.15,
    },
  },
};

export function biomeForFloor(floor: number, dawn: boolean): BiomeId {
  if (floor <= 0) return dawn ? 'town_dawn' : 'town';
  if (floor === 1) return 'crypt';
  if (floor === 2) return 'ruins';
  if (floor === 3) return 'spire';
  return 'abyss';
}

/**
 * Owns the global light rig (hemi + shadowed key + coloured rim light), fog, background,
 * ambient particles and the post-processing grade — and blends them per biome.
 */
export class BiomeAtmosphere {
  public readonly hemi: THREE.HemisphereLight;
  public readonly key: THREE.DirectionalLight;
  public readonly rim: THREE.DirectionalLight;
  public readonly particles: AmbientParticles;
  private fog: THREE.FogExp2;
  private bg = new THREE.Color();
  private target: BiomePreset = PRESETS.menu;
  public current: BiomeId = 'menu';

  constructor(
    private scene: THREE.Scene,
    private post: PostFX
  ) {
    this.fog = new THREE.FogExp2(0x09080d, 0.022);
    scene.fog = this.fog;
    scene.background = this.bg;

    this.hemi = new THREE.HemisphereLight(0x4f5d9a, 0x16121d, 0.8);
    scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xdbeafe, 1.1);
    this.key.position.set(12, 24, 14);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.near = 2;
    this.key.shadow.camera.far = 80;
    const d = 26;
    this.key.shadow.camera.left = -d;
    this.key.shadow.camera.right = d;
    this.key.shadow.camera.top = d;
    this.key.shadow.camera.bottom = -d;
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    scene.add(this.key);
    scene.add(this.key.target);

    // Coloured back-light for the "rim" silhouette that sells each biome's mood
    this.rim = new THREE.DirectionalLight(0xa855f7, 0.6);
    this.rim.position.set(-10, 8, -16);
    scene.add(this.rim);
    scene.add(this.rim.target);

    this.particles = new AmbientParticles(scene);
    this.set('menu', true);
  }

  public set(id: BiomeId, instant = false): void {
    this.current = id;
    this.target = PRESETS[id];
    this.particles.setStyle(this.target.particles);
    this.post.setGrade(this.target.grade, instant);
    if (instant) this.blend(1);
  }

  private blend(k: number): void {
    const t = this.target;
    this.bg.lerp(c(t.background), k);
    this.fog.color.lerp(c(t.fog), k);
    this.fog.density += (t.fogDensity - this.fog.density) * k;
    this.hemi.color.lerp(c(t.hemiSky), k);
    this.hemi.groundColor.lerp(c(t.hemiGround), k);
    this.hemi.intensity += (t.hemiIntensity - this.hemi.intensity) * k;
    this.key.color.lerp(c(t.keyColor), k);
    this.key.intensity += (t.keyIntensity - this.key.intensity) * k;
    this.rim.color.lerp(c(t.rimColor), k);
    this.rim.intensity += (t.rimIntensity - this.rim.intensity) * k;
  }

  /** Keep the shadow frustum centred on the action so shadows stay crisp everywhere. */
  public update(dt: number, focus: THREE.Vector3): void {
    this.blend(Math.min(1, dt * 1.8));
    this.key.position.set(focus.x + 12, 24, focus.z + 14);
    this.key.target.position.set(focus.x, 0, focus.z);
    this.rim.position.set(focus.x - 10, 8, focus.z - 16);
    this.rim.target.position.set(focus.x, 1, focus.z);
    this.particles.update(dt, focus);
    // Re-assert in case other systems replaced them
    if (this.scene.fog !== this.fog) this.scene.fog = this.fog;
    if (this.scene.background !== this.bg) this.scene.background = this.bg;
  }
}
