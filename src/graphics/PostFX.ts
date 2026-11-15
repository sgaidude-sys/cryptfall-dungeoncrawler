import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Cinematic grading + vignette + chromatic fringe + film grain.
 * Runs in linear HDR space BEFORE OutputPass (which applies ACES tone mapping + sRGB),
 * so bloom highlights roll off naturally instead of clipping.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uShadowTint: { value: new THREE.Color(0, 0, 0) },
    uSaturation: { value: 1.0 },
    uContrast: { value: 1.0 },
    uVignette: { value: 0.35 },
    uVignetteColor: { value: new THREE.Color(0, 0, 0) },
    uAberration: { value: 0.0 },
    uGrain: { value: 0.03 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uTint;
    uniform vec3 uShadowTint;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform vec3 uVignetteColor;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uTime;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float dist = length(centered);

      // Subtle chromatic fringe toward screen edges (impacts push it higher)
      vec2 off = centered * dist * uAberration;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;

      // Split-tone: lift shadows toward biome color, tint mids/highs
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += uShadowTint * (1.0 - smoothstep(0.0, 0.35, luma)) * 0.06;
      col *= uTint;

      // Saturation + contrast around mid-grey (linear space friendly)
      luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.18) * uContrast + 0.18;
      col = max(col, 0.0);

      // Vignette toward a biome-colored edge
      float vig = smoothstep(0.85, 0.22, dist * (1.0 + uVignette * 0.9));
      col = mix(col * uVignetteColor, col, mix(1.0, vig, clamp(uVignette, 0.0, 1.0)));

      // Impact / cutscene flash
      col += uFlashColor * uFlash;

      // Film grain (very light, animated)
      float g = hash(vUv * uResolution + fract(uTime * 7.13) * 100.0) - 0.5;
      col += g * uGrain * (0.4 + luma);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface GradeSettings {
  tint: THREE.Color;
  shadowTint: THREE.Color;
  saturation: number;
  contrast: number;
  vignette: number;
  vignetteColor: THREE.Color;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  exposure: number;
}

export class PostFX {
  public readonly composer: EffectComposer;
  public readonly bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private target: GradeSettings | null = null;
  private flashValue = 0;
  private aberrationKick = 0;
  private baseAberration = 0.006;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // Threshold is tuned high so only true emissives (runes, +7..+10 auras, chains, torches,
    // elemental spells) bloom — UI is DOM so it never gets washed out.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.42, 0.82);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.setSize(w, h);
  }

  public setSize(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    // Bloom runs at half-res internally; keep its resolution in sync to avoid smear on resize
    this.bloom.resolution.set(w, h);
    (this.grade.uniforms.uResolution.value as THREE.Vector2).set(w * pr, h * pr);
  }

  /** Smoothly blend to a biome grade. */
  public setGrade(settings: GradeSettings, instant = false): void {
    this.target = settings;
    if (instant) this.applyLerp(1);
  }

  /** Full-screen flash (impacts, lightning, cutscene reveals). */
  public flash(color: number, amount: number): void {
    (this.grade.uniforms.uFlashColor.value as THREE.Color).setHex(color);
    this.flashValue = Math.max(this.flashValue, amount);
  }

  /** Brief chromatic split on heavy impacts. */
  public kickAberration(amount: number): void {
    this.aberrationKick = Math.min(0.06, this.aberrationKick + amount);
  }

  private cine = 0;
  private cineTarget = 0;

  /** Cinematic grade for cutscenes: deeper vignette, punchier contrast, richer bloom, film grain. */
  public setCinematic(on: boolean): void {
    this.cineTarget = on ? 1 : 0;
  }

  private applyLerp(k: number): void {
    if (!this.target) return;
    const u = this.grade.uniforms;
    const c = this.cine;
    (u.uTint.value as THREE.Color).lerp(this.target.tint, k);
    (u.uShadowTint.value as THREE.Color).lerp(this.target.shadowTint, k);
    (u.uVignetteColor.value as THREE.Color).lerp(this.target.vignetteColor, k);
    u.uSaturation.value += (this.target.saturation * (1 - c * 0.05) - u.uSaturation.value) * k;
    u.uContrast.value += (this.target.contrast * (1 + c * 0.1) - u.uContrast.value) * k;
    u.uVignette.value += (this.target.vignette + c * 0.3 - u.uVignette.value) * k;
    u.uGrain.value += (0.03 + c * 0.03 - u.uGrain.value) * k;
    this.bloom.strength += (this.target.bloomStrength + c * 0.2 - this.bloom.strength) * k;
    this.bloom.radius += (this.target.bloomRadius - this.bloom.radius) * k;
    this.bloom.threshold += (this.target.bloomThreshold - this.bloom.threshold) * k;
    this.renderer.toneMappingExposure += (this.target.exposure - this.renderer.toneMappingExposure) * k;
  }

  public update(dt: number): void {
    this.cine += (this.cineTarget - this.cine) * Math.min(1, dt * 2.5);
    this.applyLerp(Math.min(1, dt * 2.2));
    const u = this.grade.uniforms;
    u.uTime.value += dt;
    this.flashValue *= Math.pow(0.0005, dt);
    if (this.flashValue < 0.002) this.flashValue = 0;
    u.uFlash.value = this.flashValue;
    this.aberrationKick *= Math.pow(0.004, dt);
    u.uAberration.value = this.baseAberration + this.cine * 0.005 + this.aberrationKick;
  }

  public render(): void {
    this.composer.render();
  }
}
