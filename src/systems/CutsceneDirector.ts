import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager';
import { AnimatorHelper } from '../engine/AnimatorHelper';
import { VFXManager } from '../engine/VFXManager';
import { SoundEngine } from '../audio/SoundEngine';
import { CutsceneOverlay } from '../ui/CutsceneOverlay';

interface CutsceneActor {
  id: string;
  mesh: THREE.Object3D;
  anim?: AnimatorHelper;
  isTemp: boolean;
}

interface CameraTween {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startLook: THREE.Vector3;
  endLook: THREE.Vector3;
  elapsed: number;
  duration: number;
  resolve: () => void;
}

interface OrbitTween {
  center: THREE.Vector3;
  startAngle: number;
  angleDelta: number;
  radius: number;
  height: number;
  elapsed: number;
  duration: number;
  resolve: () => void;
}

interface ActorMoveTween {
  actor: CutsceneActor;
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  elapsed: number;
  duration: number;
  resolve: () => void;
}

const STORAGE_KEY = 'cryptfall_cutscenes_v1';

export class CutsceneDirector {
  public active = false;
  private aborted = false;
  private actors = new Map<string, CutsceneActor>();
  private playedFlags = new Set<string>();

  private currentLook = new THREE.Vector3();
  private camTween: CameraTween | null = null;
  private orbitTween: OrbitTween | null = null;
  private fovTween: { startFov: number; endFov: number; elapsed: number; duration: number } | null = null;
  private tempLights: THREE.PointLight[] = [];
  private moveTweens: ActorMoveTween[] = [];
  private waitTimers: Array<{ remaining: number; resolve: () => void }> = [];
  private shakeTimer = 0;
  private shakeIntensity = 0;
  private onFinish?: () => void;

  public overlay = new CutsceneOverlay();

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private assets: AssetManager,
    private vfx: VFXManager,
    private sound: SoundEngine
  ) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        arr.forEach((f) => this.playedFlags.add(f));
      }
    } catch {
      // ignore storage errors
    }

    this.overlay.onSkip = () => this.skip();
  }

  public hasPlayed(id: string): boolean {
    return this.playedFlags.has(id);
  }

  public markPlayed(id: string): void {
    this.playedFlags.add(id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.playedFlags)));
    } catch {
      // ignore
    }
  }

  public resetFlags(): void {
    this.playedFlags.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  public registerActor(id: string, mesh: THREE.Object3D, anim?: AnimatorHelper): void {
    this.actors.set(id, { id, mesh, anim, isTemp: false });
  }

  public spawnActor(
    id: string,
    modelPath: string,
    pos: THREE.Vector3,
    opts?: { scale?: number; tintHex?: number; rightWeapon?: string; leftWeapon?: string; idleClip?: string }
  ): THREE.Object3D {
    const isProp = modelPath.startsWith('dungeon/') || modelPath.startsWith('props_fantasy/');
    const mesh = isProp ? this.assets.cloneProp(modelPath) : this.assets.cloneCharacter(modelPath);
    mesh.position.copy(pos);
    if (opts?.scale) mesh.scale.setScalar(opts.scale);
    if (!isProp && opts?.rightWeapon) this.assets.attachToHand(mesh, opts.rightWeapon, 'right');
    if (!isProp && opts?.leftWeapon) this.assets.attachToHand(mesh, opts.leftWeapon, 'left');
    if (opts?.tintHex !== undefined) {
      mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          const mat = obj.material.clone();
          mat.emissive = new THREE.Color(opts.tintHex!);
          mat.emissiveIntensity = 0.55;
          obj.material = mat;
        }
      });
    }
    this.scene.add(mesh);

    let anim: AnimatorHelper | undefined;
    if (!isProp) {
      anim = new AnimatorHelper(mesh, this.assets, this.assets.getModelClips(modelPath));
      if (opts?.idleClip) anim.playLoop(opts.idleClip, 0.1);
    }
    this.actors.set(id, { id, mesh, anim, isTemp: true });
    return mesh;
  }

  public removeActor(id: string): void {
    const a = this.actors.get(id);
    if (a) {
      if (a.isTemp) this.scene.remove(a.mesh);
      this.actors.delete(id);
    }
  }

  public async play(
    cutsceneId: string,
    scriptFn: (d: CutsceneDirector) => Promise<void>,
    onComplete?: () => void,
    force = false
  ): Promise<void> {
    if (this.active) return;
    if (!force && this.hasPlayed(cutsceneId)) {
      onComplete?.();
      return;
    }

    this.active = true;
    this.aborted = false;
    this.onFinish = onComplete;
    this.currentLook.copy(this.camera.position).add(new THREE.Vector3(0, -4, -6));
    this.overlay.showLetterbox(true);
    this.sound.playCinematicWhoosh();

    try {
      await scriptFn(this);
    } catch {
      // ignore abort
    } finally {
      this.markPlayed(cutsceneId);
      this.cleanup();
      this.active = false;
      this.onFinish?.();
      this.onFinish = undefined;
    }
  }

  public skip(): void {
    if (!this.active) return;
    this.aborted = true;
    this.overlay.forceResolve();
    if (this.camTween) {
      const r = this.camTween.resolve;
      this.camTween = null;
      r();
    }
    if (this.orbitTween) {
      const r = this.orbitTween.resolve;
      this.orbitTween = null;
      r();
    }
    while (this.moveTweens.length > 0) {
      const m = this.moveTweens.pop()!;
      m.actor.mesh.position.copy(m.targetPos);
      m.resolve();
    }
    while (this.waitTimers.length > 0) {
      const w = this.waitTimers.pop()!;
      w.resolve();
    }
  }

  private cleanup(): void {
    this.overlay.showLetterbox(false);
    for (const [id, a] of Array.from(this.actors.entries())) {
      if (a.isTemp) {
        this.scene.remove(a.mesh);
        this.actors.delete(id);
      }
    }
    this.camTween = null;
    this.orbitTween = null;
    this.fovTween = null;
    this.camera.fov = 48;
    this.camera.updateProjectionMatrix();
    for (const l of this.tempLights) this.scene.remove(l);
    this.tempLights = [];
    this.moveTweens = [];
    this.waitTimers = [];
    this.shakeTimer = 0;
  }

  public moveCameraTo(pos: THREE.Vector3, lookAt: THREE.Vector3, duration: number): Promise<void> {
    if (this.aborted || duration <= 0.01) {
      this.camera.position.copy(pos);
      this.currentLook.copy(lookAt);
      this.camera.lookAt(lookAt);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.camTween = {
        startPos: this.camera.position.clone(),
        endPos: pos.clone(),
        startLook: this.currentLook.clone(),
        endLook: lookAt.clone(),
        elapsed: 0,
        duration,
        resolve,
      };
    });
  }

  public orbitTarget(targetPos: THREE.Vector3, angleDelta: number, radius: number, duration: number, height = 4.5): Promise<void> {
    if (this.aborted) return Promise.resolve();
    const dx = this.camera.position.x - targetPos.x;
    const dz = this.camera.position.z - targetPos.z;
    const startAngle = Math.atan2(dz, dx);
    return new Promise((resolve) => {
      this.orbitTween = {
        center: targetPos.clone(),
        startAngle,
        angleDelta,
        radius,
        height,
        elapsed: 0,
        duration,
        resolve,
      };
    });
  }

  public shakeCamera(intensity: number, duration: number): void {
    if (this.aborted) return;
    this.shakeIntensity = intensity;
    this.shakeTimer = duration;
  }

  public moveActor(entityId: string, targetPos: THREE.Vector3, walkAnimClip = 'Running_A', duration = 1.2): Promise<void> {
    const actor = this.actors.get(entityId);
    if (!actor || this.aborted) return Promise.resolve();
    this.rotateActorToward(entityId, targetPos);
    actor.anim?.playLoop(walkAnimClip, 0.08, 1.0);
    return new Promise((resolve) => {
      this.moveTweens.push({
        actor,
        startPos: actor.mesh.position.clone(),
        targetPos: targetPos.clone(),
        elapsed: 0,
        duration: Math.max(0.05, duration),
        resolve: () => {
          actor.anim?.playLoop('Idle_A', 0.12);
          resolve();
        },
      });
    });
  }

  public playAnimation(entityId: string, clipName: string, loop = false): void {
    const actor = this.actors.get(entityId);
    if (!actor || this.aborted) return;
    if (loop) actor.anim?.playLoop(clipName, 0.1);
    else actor.anim?.playOneShot(clipName, 0.06, 1.15, 0.85);
  }

  public rotateActorToward(entityId: string, targetPos: THREE.Vector3): void {
    const actor = this.actors.get(entityId);
    if (!actor) return;
    const dx = targetPos.x - actor.mesh.position.x;
    const dz = targetPos.z - actor.mesh.position.z;
    if (dx * dx + dz * dz > 0.001) {
      actor.mesh.rotation.y = Math.atan2(dx, dz);
    }
  }

  public setFov(fov: number, duration = 0.8): void {
    if (this.aborted || duration <= 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      return;
    }
    this.fovTween = { startFov: this.camera.fov, endFov: fov, elapsed: 0, duration };
  }

  public spawnDramaticLight(pos: THREE.Vector3, colorHex: number, intensity = 14, distance = 14): void {
    if (this.aborted) return;
    const light = new THREE.PointLight(colorHex, intensity, distance);
    light.position.copy(pos);
    this.scene.add(light);
    this.tempLights.push(light);
  }

  public spawnEpicRitual(pos: THREE.Vector3, colorHex: number): void {
    if (this.aborted) return;
    this.vfx.spawnBrackeysGroundEffect(pos, 'magic_rune', colorHex, 5.5, 1.4, 3);
    this.vfx.spawnConsecratedPillar(pos, colorHex, 2.2, 7.0);
    this.vfx.spawnRing(pos, 5.0, colorHex, 0.7);
    this.vfx.spawnBurst(pos.clone().add(new THREE.Vector3(0, 1.2, 0)), colorHex, 32, 7.5);
  }

  public spawnLightningStrike(from: THREE.Vector3, to: THREE.Vector3, colorHex: number): void {
    if (this.aborted) return;
    this.vfx.spawnLightningArc(from, to, colorHex);
  }

  public spawnVFXBurst(pos: THREE.Vector3, colorHex: number, particleCount = 24): void {
    if (this.aborted) return;
    this.vfx.spawnBurst(pos, colorHex, particleCount, 6.5);
    this.vfx.spawnRing(pos, 4.2, colorHex, 0.5);
  }

  public say(
    speakerName: string,
    speakerTitle: string,
    portraitTintHex: string,
    text: string,
    typewriterSpeed = 18
  ): Promise<void> {
    if (this.aborted) return Promise.resolve();
    this.sound.playUIPopup();
    return this.overlay.say(speakerName, speakerTitle, portraitTintHex, text, typewriterSpeed);
  }

  public showChapterCard(actNumber: string, title: string, subtitle: string, duration = 2.6): Promise<void> {
    if (this.aborted) return Promise.resolve();
    this.sound.playCinematicWhoosh();
    return this.overlay.showChapterCard(actNumber, title, subtitle, duration);
  }

  public fadeScreen(toBlack: boolean, duration: number): Promise<void> {
    if (this.aborted) return Promise.resolve();
    return this.overlay.setFade(toBlack, duration);
  }

  public wait(seconds: number): Promise<void> {
    if (this.aborted || seconds <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.waitTimers.push({ remaining: seconds, resolve });
    });
  }

  public update(dt: number): void {
    if (!this.active) return;

    for (const a of this.actors.values()) {
      if (a.isTemp) a.anim?.update(dt);
    }

    if (this.camTween) {
      const t = this.camTween;
      t.elapsed += dt;
      const p = Math.min(1, t.elapsed / t.duration);
      const ease = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      this.camera.position.lerpVectors(t.startPos, t.endPos, ease);
      this.currentLook.lerpVectors(t.startLook, t.endLook, ease);
      this.camera.lookAt(this.currentLook);
      if (p >= 1) {
        const res = t.resolve;
        this.camTween = null;
        res();
      }
    }

    if (this.orbitTween) {
      const o = this.orbitTween;
      o.elapsed += dt;
      const p = Math.min(1, o.elapsed / o.duration);
      const ang = o.startAngle + o.angleDelta * p;
      this.camera.position.set(
        o.center.x + Math.cos(ang) * o.radius,
        o.center.y + o.height,
        o.center.z + Math.sin(ang) * o.radius
      );
      this.currentLook.copy(o.center).add(new THREE.Vector3(0, 1.3, 0));
      this.camera.lookAt(this.currentLook);
      if (p >= 1) {
        const res = o.resolve;
        this.orbitTween = null;
        res();
      }
    }

    if (this.fovTween) {
      const f = this.fovTween;
      f.elapsed += dt;
      const p = Math.min(1, f.elapsed / f.duration);
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      this.camera.fov = f.startFov + (f.endFov - f.startFov) * ease;
      this.camera.updateProjectionMatrix();
      if (p >= 1) this.fovTween = null;
    }

    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
    }

    for (let i = this.moveTweens.length - 1; i >= 0; i--) {
      const m = this.moveTweens[i];
      m.elapsed += dt;
      const p = Math.min(1, m.elapsed / m.duration);
      m.actor.mesh.position.lerpVectors(m.startPos, m.targetPos, p);
      if (p >= 1) {
        this.moveTweens.splice(i, 1);
        m.resolve();
      }
    }

    for (let i = this.waitTimers.length - 1; i >= 0; i--) {
      this.waitTimers[i].remaining -= dt;
      if (this.waitTimers[i].remaining <= 0) {
        const w = this.waitTimers[i];
        this.waitTimers.splice(i, 1);
        w.resolve();
      }
    }
  }
}
