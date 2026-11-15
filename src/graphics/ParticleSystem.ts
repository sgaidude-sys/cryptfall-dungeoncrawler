import * as THREE from 'three';

/**
 * Pooled, single-draw-call particle systems.
 *  - SparkField: additive soft points (bursts, embers, trail sparks) — 1 draw call for all sparks.
 *  - ChunkField: instanced lit debris (bone shatter) — 1 draw call for all chunks.
 * Replaces "one Mesh + one Material per particle", which cost hundreds of draw calls
 * and constant material churn during combat.
 */
export class SparkField {
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private grav: Float32Array;
  private alive = 0;
  private cursor = 0;
  private geo: THREE.BufferGeometry;
  public readonly points: THREE.Points;
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene, max = 2400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute float aSize;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vLife;
        void main() {
          vColor = color;
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aLife <= 0.0 ? 0.0 : aSize * uPixelRatio * (300.0 / -mv.z) * (0.4 + 0.6 * aLife);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vLife;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          float core = smoothstep(0.22, 0.0, d);
          if (a < 0.01) discard;
          // white-hot core fading to the particle colour
          vec3 c = mix(vColor, vec3(1.0), core * 0.6) * (1.2 + vLife * 1.6);
          gl_FragColor = vec4(c, a * vLife);
        }
      `,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  public emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: number,
    life: number,
    size: number,
    gravity: number
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    if (this.life[i] <= 0) this.alive++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.tmpColor.setHex(colorHex);
    this.col[i * 3] = this.tmpColor.r;
    this.col[i * 3 + 1] = this.tmpColor.g;
    this.col[i * 3 + 2] = this.tmpColor.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grav[i] = gravity;
  }

  public burst(pos: THREE.Vector3, colorHex: number, count: number, speed: number): void {
    for (let n = 0; n < count; n++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.7;
      const spd = speed * (0.4 + Math.random() * 0.8);
      this.emit(
        pos.x,
        pos.y,
        pos.z,
        Math.cos(theta) * Math.sin(phi) * spd,
        Math.cos(phi) * spd + 1.5,
        Math.sin(theta) * Math.sin(phi) * spd,
        colorHex,
        0.35 + Math.random() * 0.3,
        0.16 + Math.random() * 0.14,
        9
      );
    }
  }

  public update(dt: number): void {
    if (this.alive <= 0) return;
    const lifeAttr = this.geo.getAttribute('aLife') as THREE.BufferAttribute;
    const lifeArr = lifeAttr.array as Float32Array;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        lifeArr[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        lifeArr[i] = 0;
        continue;
      }
      alive++;
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      const drag = Math.pow(0.35, dt);
      this.vel[k] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.06) {
        this.pos[k + 1] = 0.06;
        this.vel[k + 1] *= -0.3;
      }
      lifeArr[i] = this.life[i] / this.maxLife[i];
    }
    this.alive = alive;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    lifeAttr.needsUpdate = true;
  }

  public clear(): void {
    this.life.fill(0);
    this.alive = 0;
    const lifeAttr = this.geo.getAttribute('aLife') as THREE.BufferAttribute;
    (lifeAttr.array as Float32Array).fill(0);
    lifeAttr.needsUpdate = true;
  }
}

/** Instanced, physically-bouncing debris chunks (bone shatter, rubble). */
export class ChunkField {
  public readonly mesh: THREE.InstancedMesh;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private scale: Float32Array;
  private cursor = 0;
  private alive = 0;
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, max = 320) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.spin = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.scale = new Float32Array(max);
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.18, 0.12, 0.28),
      new THREE.MeshStandardMaterial({ color: 0xe2dccb, roughness: 0.65 }),
      max
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    scene.add(this.mesh);
  }

  public shatter(pos: THREE.Vector3, count: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      if (this.life[i] <= 0) this.alive++;
      const a = Math.random() * Math.PI * 2;
      const spd = 2.5 + Math.random() * 4.5;
      this.pos[i * 3] = pos.x + (Math.random() - 0.5) * 0.5;
      this.pos[i * 3 + 1] = pos.y + 0.6 + Math.random() * 0.8;
      this.pos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.5;
      this.vel[i * 3] = Math.cos(a) * spd;
      this.vel[i * 3 + 1] = 3.2 + Math.random() * 4.5;
      this.vel[i * 3 + 2] = Math.sin(a) * spd;
      for (let k = 0; k < 3; k++) {
        this.rot[i * 3 + k] = Math.random() * 6;
        this.spin[i * 3 + k] = (Math.random() - 0.5) * 24;
      }
      this.life[i] = 1.4 + Math.random() * 0.6;
      this.scale[i] = 0.7 + Math.random() * 0.7;
    }
  }

  public update(dt: number): void {
    if (this.alive <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.dummy.scale.setScalar(0);
      } else {
        alive++;
        this.vel[k + 1] -= 16 * dt;
        this.pos[k] += this.vel[k] * dt;
        this.pos[k + 1] += this.vel[k + 1] * dt;
        this.pos[k + 2] += this.vel[k + 2] * dt;
        if (this.pos[k + 1] < 0.06) {
          this.pos[k + 1] = 0.06;
          this.vel[k + 1] *= -0.35;
          this.vel[k] *= 0.6;
          this.vel[k + 2] *= 0.6;
          this.spin[k] *= 0.6;
          this.spin[k + 1] *= 0.6;
          this.spin[k + 2] *= 0.6;
        }
        this.rot[k] += this.spin[k] * dt;
        this.rot[k + 1] += this.spin[k + 1] * dt;
        this.rot[k + 2] += this.spin[k + 2] * dt;
        // shrink away over the final 0.4s instead of popping
        const s = this.scale[i] * Math.min(1, this.life[i] / 0.4);
        this.dummy.position.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
        this.dummy.rotation.set(this.rot[k], this.rot[k + 1], this.rot[k + 2]);
        this.dummy.scale.setScalar(s);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
