import * as THREE from 'three';

export type ParticleStyle = 'motes' | 'embers' | 'spores' | 'mist' | 'ash' | 'gold';

interface StyleDef {
  color: number;
  color2: number;
  size: number;
  rise: number; // upward drift (m/s)
  sway: number;
  count: number;
  opacity: number;
}

const STYLES: Record<ParticleStyle, StyleDef> = {
  motes: { color: 0xffe2a8, color2: 0xfff4d6, size: 0.09, rise: 0.12, sway: 0.35, count: 260, opacity: 0.75 },
  embers: { color: 0xff7a2a, color2: 0xffc04d, size: 0.11, rise: 0.75, sway: 0.5, count: 240, opacity: 0.95 },
  spores: { color: 0x5dffa0, color2: 0xc4ff6b, size: 0.12, rise: 0.22, sway: 0.7, count: 280, opacity: 0.85 },
  mist: { color: 0x6ee7f9, color2: 0xb197fc, size: 0.1, rise: 0.08, sway: 0.45, count: 260, opacity: 0.7 },
  ash: { color: 0xff3b2a, color2: 0x9b1c1c, size: 0.1, rise: 0.55, sway: 0.4, count: 280, opacity: 0.9 },
  gold: { color: 0xffd76a, color2: 0xfff1b8, size: 0.13, rise: 0.4, sway: 0.5, count: 320, opacity: 0.95 },
};

/**
 * GPU-driven drifting particle field that follows the camera focus point.
 * Positions wrap inside a box so the field is infinite without CPU respawns.
 */
export class AmbientParticles {
  public readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private maxCount = 360;
  private boxSize = new THREE.Vector3(34, 9, 30);

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.maxCount * 3);
    const seed = new Float32Array(this.maxCount);
    for (let i = 0; i < this.maxCount; i++) {
      pos[i * 3] = Math.random();
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = Math.random();
      seed[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: this.boxSize.clone() },
        uColor: { value: new THREE.Color(STYLES.motes.color) },
        uColor2: { value: new THREE.Color(STYLES.motes.color2) },
        uSize: { value: STYLES.motes.size },
        uRise: { value: STYLES.motes.rise },
        uSway: { value: STYLES.motes.sway },
        uOpacity: { value: STYLES.motes.opacity },
        uCount: { value: STYLES.motes.count },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        uniform float uSize;
        uniform float uRise;
        uniform float uSway;
        uniform float uCount;
        uniform float uPixelRatio;
        attribute float aSeed;
        varying float vAlpha;
        varying float vMix;
        void main() {
          float idx = float(gl_VertexID);
          vec3 p = position * uBox;
          p.y += uTime * uRise * (0.6 + aSeed * 0.8);
          p.x += sin(uTime * 0.6 + aSeed * 40.0) * uSway;
          p.z += cos(uTime * 0.45 + aSeed * 23.0) * uSway;
          // wrap around the camera focus so the field is endless
          vec3 origin = uCenter - uBox * 0.5;
          vec3 local = mod(p - origin, uBox);
          vec3 world = origin + local;
          world.y = local.y;
          vec4 mv = modelViewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mv;
          float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 60.0);
          float edge = smoothstep(0.0, 0.12, local.y / uBox.y) * smoothstep(1.0, 0.75, local.y / uBox.y);
          vAlpha = twinkle * edge * step(idx, uCount);
          vMix = aSeed;
          gl_PointSize = uSize * (0.6 + aSeed * 0.9) * uPixelRatio * (320.0 / -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uColor2;
        uniform float uOpacity;
        varying float vAlpha;
        varying float vMix;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          if (a < 0.01) discard;
          vec3 col = mix(uColor, uColor2, vMix) * 2.2;
          gl_FragColor = vec4(col, a * vAlpha * uOpacity);
        }
      `,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  public setStyle(style: ParticleStyle): void {
    const s = STYLES[style];
    const u = this.material.uniforms;
    (u.uColor.value as THREE.Color).setHex(s.color);
    (u.uColor2.value as THREE.Color).setHex(s.color2);
    u.uSize.value = s.size;
    u.uRise.value = s.rise;
    u.uSway.value = s.sway;
    u.uOpacity.value = s.opacity;
    u.uCount.value = Math.min(this.maxCount, s.count);
  }

  public update(dt: number, focus: THREE.Vector3): void {
    const u = this.material.uniforms;
    u.uTime.value += dt;
    (u.uCenter.value as THREE.Vector3).set(focus.x, 0, focus.z);
  }
}
