import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  spin: THREE.Vector3;
}

interface SlashArc {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  startYaw: number;
}

interface RingEffect {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
}

interface BeamEffect {
  line: THREE.Line;
  life: number;
  maxLife: number;
}

interface SpriteAnim {
  mesh: THREE.Mesh;
  tex: THREE.Texture;
  cols: number;
  rows: number;
  frames: number;
  life: number;
  maxLife: number;
}

interface FallingStrike {
  mesh: THREE.Mesh;
  target: THREE.Vector3;
  velY: number;
  color: number;
  isMeteor: boolean;
  onImpact?: () => void;
}

interface FloatingText {
  el: HTMLDivElement;
  worldPos: THREE.Vector3;
  life: number;
  maxLife: number;
  vy: number;
}

export class VFXManager {
  private particles: Particle[] = [];
  private slashes: SlashArc[] = [];
  private rings: RingEffect[] = [];
  private beams: BeamEffect[] = [];
  private sprites: SpriteAnim[] = [];
  private falling: FallingStrike[] = [];
  private texts: FloatingText[] = [];
  private sheetCache = new Map<string, THREE.Texture>();
  private texLoader = new THREE.TextureLoader();

  private hitStopTimer = 0;
  private shakeOffset = new THREE.Vector3();
  private shakeVel = new THREE.Vector3();
  private shakeIntensity = 0;

  private boxGeo = new THREE.BoxGeometry(0.18, 0.12, 0.28);
  private sparkGeo = new THREE.OctahedronGeometry(0.12, 0);
  private ringGeo = new THREE.RingGeometry(0.65, 1.0, 28);
  private damageLayer: HTMLElement;

  constructor(private scene: THREE.Scene) {
    this.damageLayer = document.getElementById('damage-layer')!;
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  public triggerHitStop(seconds = 0.04): void {
    this.hitStopTimer = Math.max(this.hitStopTimer, seconds);
  }

  public isHitStopped(rawDt: number): boolean {
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= rawDt;
      return true;
    }
    return false;
  }

  public addCameraShake(dir: THREE.Vector3, intensity: number): void {
    this.shakeIntensity = Math.min(0.85, this.shakeIntensity + intensity);
    this.shakeVel.copy(dir).normalize().multiplyScalar(intensity * 1.4);
  }

  public getCameraShakeOffset(): THREE.Vector3 {
    return this.shakeOffset;
  }

  public spawnSlashArc(pos: THREE.Vector3, yaw: number, radius: number, colorHex: number, fullCircle = false, tilt = 0.28): void {
    const arcAngle = fullCircle ? Math.PI * 1.9 : Math.PI * 0.95;
    const geo = new THREE.RingGeometry(radius * 0.48, radius, 24, 1, -arcAngle / 2, arcAngle);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y + 1.1, pos.z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = yaw - Math.PI / 2 - 0.35;
    mesh.rotation.x = fullCircle ? 0.05 : tilt;
    this.scene.add(mesh);
    this.slashes.push({ mesh, life: 0.14, maxLife: 0.14, startYaw: mesh.rotation.y });
  }

  public spawnRing(pos: THREE.Vector3, maxScale: number, colorHex: number, duration = 0.35): void {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(pos.x, 0.08, pos.z);
    mesh.scale.setScalar(0.2);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: duration, maxLife: duration, maxScale });
  }

  public spawnBoneShatter(pos: THREE.Vector3, count = 16): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: i % 3 === 0 ? 0xcfd6c4 : 0xe8e2d0,
        roughness: 0.6,
      });
      const mesh = new THREE.Mesh(this.boxGeo, mat);
      mesh.position.set(
        pos.x + (Math.random() - 0.5) * 0.5,
        pos.y + 0.6 + Math.random() * 0.8,
        pos.z + (Math.random() - 0.5) * 0.5
      );
      mesh.scale.setScalar(0.7 + Math.random() * 0.7);
      this.scene.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const spd = 2.5 + Math.random() * 4.5;
      this.particles.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(angle) * spd, 3.2 + Math.random() * 4.5, Math.sin(angle) * spd),
        life: 0.7 + Math.random() * 0.35,
        maxLife: 1.0,
        gravity: 16,
        spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
      });
    }
  }

  public spawnBurst(pos: THREE.Vector3, colorHex: number, count = 14, speed = 5.5): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.sparkGeo, mat);
      mesh.position.copy(pos);
      this.scene.add(mesh);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.7;
      const spd = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        mesh,
        vel: new THREE.Vector3(
          Math.cos(theta) * Math.sin(phi) * spd,
          Math.cos(phi) * spd + 1.5,
          Math.sin(theta) * Math.sin(phi) * spd
        ),
        life: 0.35 + Math.random() * 0.25,
        maxLife: 0.55,
        gravity: 9,
        spin: new THREE.Vector3(6, 8, 5),
      });
    }
  }

  public spawnDashTrail(from: THREE.Vector3, to: THREE.Vector3, colorHex: number, steps = 6): void {
    for (let i = 0; i <= steps; i++) {
      const p = new THREE.Vector3().lerpVectors(from, to, i / steps);
      p.y += 0.9;
      this.spawnBurst(p, colorHex, 4, 2.6);
    }
  }

  public spawnConsecratedPillar(pos: THREE.Vector3, colorHex = 0xfacc15, radius = 2.6, height = 6.5): void {
    const geo = new THREE.CylinderGeometry(radius * 0.65, radius, height, 20, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, height / 2, pos.z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.45, maxLife: 0.45, maxScale: 1.35 });
  }

  public spawnFallingStrike(target: THREE.Vector3, colorHex: number, isMeteor: boolean, delay = 0, onImpact?: () => void): void {
    const geo = isMeteor
      ? new THREE.DodecahedronGeometry(0.55, 0)
      : new THREE.ConeGeometry(0.14, 1.35, 6);
    if (!isMeteor) geo.rotateX(Math.PI);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(target.x + (Math.random() - 0.5) * 1.2, 13 + delay * 28, target.z + (Math.random() - 0.5) * 1.2);
    this.scene.add(mesh);
    this.falling.push({ mesh, target: target.clone(), velY: isMeteor ? -34 : -42, color: colorHex, isMeteor, onImpact });
  }

  public spawnSpriteFX(pos: THREE.Vector3, sheetName: 'slash' | 'lightning', size = 2.4, colorHex = 0xffffff): void {
    const path = sheetName === 'slash' ? './assets/vfx/slash_sheet.png' : './assets/vfx/lightning_sheet.png';
    let baseTex = this.sheetCache.get(sheetName);
    if (!baseTex) {
      baseTex = this.texLoader.load(path);
      baseTex.magFilter = THREE.NearestFilter;
      baseTex.minFilter = THREE.NearestFilter;
      this.sheetCache.set(sheetName, baseTex);
    }
    const tex = baseTex.clone();
    tex.needsUpdate = true;
    const cols = sheetName === 'slash' ? 5 : 8;
    const rows = sheetName === 'slash' ? 2 : 1;
    const frames = sheetName === 'slash' ? 9 : 8;
    tex.repeat.set(1 / cols, 1 / rows);
    tex.offset.set(0, 1 - 1 / rows);

    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: colorHex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y + 1.15, pos.z);
    this.scene.add(mesh);
    this.sprites.push({ mesh, tex, cols, rows, frames, life: 0.24, maxLife: 0.24 });
  }

  public spawnLightningArc(from: THREE.Vector3, to: THREE.Vector3, colorHex = 0x7dd3fc): void {
    this.spawnSpriteFX(to, 'lightning', 2.2, colorHex);
    const pts: THREE.Vector3[] = [];
    const segs = 6;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = new THREE.Vector3().lerpVectors(from, to, t);
      p.y += 1.0;
      if (i > 0 && i < segs) {
        p.x += (Math.random() - 0.5) * 0.75;
        p.y += (Math.random() - 0.5) * 0.55;
        p.z += (Math.random() - 0.5) * 0.75;
      }
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 1 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.beams.push({ line, life: 0.18, maxLife: 0.18 });
  }

  public spawnDamageNumber(worldPos: THREE.Vector3, value: number | string, kind: 'normal' | 'crit' | 'heal' | 'player-hit' = 'normal'): void {
    const el = document.createElement('div');
    el.className = `dmg-num ${kind === 'normal' ? '' : kind}`;
    el.textContent = typeof value === 'number' ? (kind === 'heal' ? `+${Math.round(value)}` : `${Math.round(value)}${kind === 'crit' ? '!' : ''}`) : value;
    this.damageLayer.appendChild(el);
    this.texts.push({
      el,
      worldPos: worldPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.9, (Math.random() - 0.5) * 0.5)),
      life: 0.72,
      maxLife: 0.72,
      vy: 1.6,
    });
  }

  public update(dt: number, camera: THREE.Camera): void {
    // Update camera shake
    if (this.shakeIntensity > 0.001) {
      this.shakeOffset.set(
        (Math.random() - 0.5) * 2 * this.shakeIntensity + this.shakeVel.x * 0.3,
        (Math.random() - 0.5) * this.shakeIntensity,
        (Math.random() - 0.5) * 2 * this.shakeIntensity + this.shakeVel.z * 0.3
      );
      this.shakeIntensity *= Math.pow(0.015, dt);
      this.shakeVel.multiplyScalar(0.85);
    } else {
      this.shakeOffset.set(0, 0, 0);
      this.shakeIntensity = 0;
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.08) {
        p.mesh.position.y = 0.08;
        p.vel.y *= -0.35;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      if (mat.transparent) mat.opacity = Math.max(0, p.life / p.maxLife);
    }

    // Slash arcs
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.slashes.splice(i, 1);
        continue;
      }
      const t = 1 - s.life / s.maxLife;
      s.mesh.rotation.y = s.startYaw + t * 1.05;
      s.mesh.scale.setScalar(0.92 + t * 0.28);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.95;
    }

    // Rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(0.3 + t * r.maxScale);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
    }

    // Beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        (b.line.material as THREE.Material).dispose();
        this.beams.splice(i, 1);
        continue;
      }
      (b.line.material as THREE.LineBasicMaterial).opacity = b.life / b.maxLife;
    }

    // Animated Sprite-Sheet FX billboards
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const sp = this.sprites[i];
      sp.life -= dt;
      if (sp.life <= 0) {
        this.scene.remove(sp.mesh);
        sp.mesh.geometry.dispose();
        (sp.mesh.material as THREE.Material).dispose();
        sp.tex.dispose();
        this.sprites.splice(i, 1);
        continue;
      }
      const t = 1 - sp.life / sp.maxLife;
      const frame = Math.min(sp.frames - 1, Math.floor(t * sp.frames));
      const col = frame % sp.cols;
      const row = Math.floor(frame / sp.cols);
      sp.tex.offset.set(col / sp.cols, 1 - (row + 1) / sp.rows);
      sp.mesh.quaternion.copy(camera.quaternion);
    }

    // Falling meteors & arrows
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.mesh.position.y += f.velY * dt;
      if (f.isMeteor) {
        f.mesh.rotation.x += dt * 8;
        f.mesh.rotation.z += dt * 6;
      }
      if (f.mesh.position.y <= 0.2) {
        const hitPos = new THREE.Vector3(f.mesh.position.x, 0.1, f.mesh.position.z);
        this.spawnRing(hitPos, f.isMeteor ? 3.2 : 1.3, f.color, f.isMeteor ? 0.38 : 0.22);
        this.spawnBurst(hitPos, f.color, f.isMeteor ? 16 : 6, f.isMeteor ? 6.5 : 4.0);
        f.onImpact?.();
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.falling.splice(i, 1);
      }
    }

    // Floating damage numbers
    const w = window.innerWidth;
    const h = window.innerHeight;
    const proj = new THREE.Vector3();
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const ft = this.texts[i];
      ft.life -= dt;
      if (ft.life <= 0) {
        ft.el.remove();
        this.texts.splice(i, 1);
        continue;
      }
      ft.worldPos.y += ft.vy * dt;
      ft.vy *= 0.94;
      proj.copy(ft.worldPos).project(camera);
      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;
      ft.el.style.left = `${sx}px`;
      ft.el.style.top = `${sy}px`;
      ft.el.style.opacity = `${Math.min(1, (ft.life / ft.maxLife) * 1.6)}`;
    }
  }

  public clearAll(): void {
    for (const ft of this.texts) ft.el.remove();
    this.texts = [];
  }
}
