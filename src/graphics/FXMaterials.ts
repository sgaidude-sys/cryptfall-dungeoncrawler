import * as THREE from 'three';

/**
 * Weapon slash: a bright leading edge that trails off along the arc, with a hot outer rim
 * and soft inner falloff — instead of a flat, solid wedge.
 * Works on RingGeometry rotated flat (local XZ after rotateX(-PI/2)).
 */
export function createSlashMaterial(color: number, inner: number, outer: number, thetaStart: number, thetaLength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uInner: { value: inner },
      uOuter: { value: outer },
      uStart: { value: thetaStart },
      uLength: { value: thetaLength },
      uOpacity: { value: 1 },
      uSweep: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vLocal;
      void main() {
        vLocal = vec2(position.x, -position.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uInner;
      uniform float uOuter;
      uniform float uStart;
      uniform float uLength;
      uniform float uOpacity;
      uniform float uSweep;
      varying vec2 vLocal;
      void main() {
        float r = (length(vLocal) - uInner) / max(0.001, uOuter - uInner);
        float ang = atan(vLocal.y, vLocal.x);
        float a = mod(ang - uStart + 6.2831853, 6.2831853) / max(0.001, uLength);
        if (a > 1.0) discard;
        // leading edge (a -> 1) is brightest; tail fades; reveal sweeps in over the first frames
        float trail = pow(clamp(a, 0.0, 1.0), 1.6);
        float reveal = smoothstep(uSweep + 0.05, uSweep - 0.15, 1.0 - a);
        float rim = smoothstep(0.0, 0.85, r) * smoothstep(1.0, 0.86, r);
        float edge = smoothstep(0.78, 0.95, r) * smoothstep(1.0, 0.95, r);
        float alpha = (rim * 0.75 + edge * 0.9) * trail * reveal * uOpacity;
        if (alpha < 0.01) discard;
        vec3 c = mix(uColor * 1.6, vec3(1.0), edge * trail * 0.7);
        gl_FragColor = vec4(c, alpha);
      }
    `,
  });
}

/**
 * Enemy attack telegraph: dark-tinted danger zone that fills from the centre outward as
 * the wind-up progresses, with a crisp pulsing crimson outline.
 * Use with CircleGeometry (radius 1, scaled) rotated flat.
 */
export function createTelegraphMaterial(isLine: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uProgress: { value: 0 },
      uHeat: { value: 1 },
      uTime: { value: 0 },
      uLine: { value: isLine ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform float uHeat;
      uniform float uTime;
      uniform float uLine;
      varying vec2 vUv;
      void main() {
        float d;
        float edgeD;
        if (uLine > 0.5) {
          // line telegraph: distance along the lane fills up toward the far end
          d = vUv.y;
          edgeD = min(min(vUv.x, 1.0 - vUv.x) * 6.0, 1.0 - vUv.y);
        } else {
          d = length(vUv - 0.5) * 2.0;
          edgeD = 1.0 - d;
        }
        if (d > 1.0) discard;
        float outline = smoothstep(0.08, 0.0, edgeD);
        float fill = smoothstep(uProgress + 0.02, uProgress - 0.02, d);
        float pulse = 0.65 + 0.35 * sin(uTime * (10.0 + uProgress * 18.0));
        vec3 red = vec3(1.0, 0.08, 0.12) * uHeat;
        float a = 0.16 + fill * 0.32 + outline * (0.55 + 0.45 * pulse);
        vec3 c = mix(red * 0.6, red * 1.6, outline + fill * 0.4);
        gl_FragColor = vec4(c, a);
      }
    `,
  });
}
