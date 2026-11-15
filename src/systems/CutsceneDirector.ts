import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager';
import { AnimatorHelper } from '../engine/AnimatorHelper';
import { VFXManager } from '../engine/VFXManager';
import { SoundEngine } from '../audio/SoundEngine';
import { CutsceneOverlay } from '../ui/CutsceneOverlay';
import { MaterialFX } from '../graphics/MaterialFX';
import { AnimCue, Beat, CutsceneScript, SPEAKERS, V3 } from '../data/StoryCampaign';

/** Engine-side hooks the director can trigger without importing the renderer. */
export interface DirectorHooks {
  flash?: (color: number, amount: number) => void;
  setBiome?: (id: 'town' | 'town_dawn' | 'crypt' | 'ruins' | 'spire' | 'abyss') => void;
  setBrand?: (level: number) => void;
}

/** Semantic cue -> candidate clip names (first one the rig owns wins). */
const ANIM_CUES: Record<AnimCue, string[]> = {
  Idle: ['Idle_A', 'Skeletons_Idle', 'Idle', 'Flying_Idle'],
  Walk: ['Walking_A', 'Skeletons_Walking', 'Walk', 'Running_A'],
  Run: ['Running_A', 'Run', 'Fast_Flying', 'Walk'],
  Cast: ['Ranged_Magic_Spellcasting', 'Ranged_Magic_Shoot', 'Punch'],
  Summon: ['Ranged_Magic_Summon', 'Ranged_Magic_Spellcasting', 'Punch'],
  Roar: ['Skeletons_Taunt_Longer', 'Skeletons_Taunt', 'Cheer', 'Yes', 'Punch', 'Ranged_Magic_Summon'],
  Hit: ['Hit_A', 'Hit_B', 'HitReact', 'Skeletons_Hit'],
  Death: ['Death_A', 'Skeletons_Death', 'Death'],
  Kneel: ['Death_A_Pose', 'Lie_Idle', 'Sit_Floor_Idle', 'Hit_B', 'Hit_A', 'HitReact'],
  Attack: ['Melee_1H_Attack_Slice_Diagonal', 'Melee_2H_Attack_Chop', 'Melee_1H_Attack_Chop', 'Punch'],
  Block: ['Melee_Block', 'Block', 'UAL2_Shield_OneShot', 'Idle_A'],
  Cheer: ['Cheer', 'Cheering', 'Interact', 'Ranged_Magic_Summon', 'Yes', 'Idle_A'],
};

const LOOPING_CUES = new Set<AnimCue>(['Idle', 'Walk', 'Run', 'Cast']);

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

interface SplineTween {
  path: THREE.CatmullRomCurve3;
  look: THREE.CatmullRomCurve3 | THREE.Vector3;
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

interface LightTween {
  light: THREE.PointLight;
  fromColor: THREE.Color;
  toColor: THREE.Color;
  fromIntensity: number;
  toIntensity: number;
  elapsed: number;
  duration: number;
}

interface ChainSet {
  group: THREE.Group;
  tubes: THREE.Mesh[];
  materials: THREE.MeshBasicMaterial[];
  grow: number;
}

const STORAGE_KEY = 'cryptfall_cutscenes_v2';

export class CutsceneDirector {
  public active = false;
  private aborted = false;
  private actors = new Map<string, CutsceneActor>();
  private playedFlags = new Set<string>();

  private currentLook = new THREE.Vector3();
  private camTween: CameraTween | null = null;
  private splineTween: SplineTween | null = null;
  private orbitTween: OrbitTween | null = null;
  private fovTween: { startFov: number; endFov: number; elapsed: number; duration: number } | null = null;
  private tempLights: THREE.PointLight[] = [];
  private namedLights = new Map<string, THREE.PointLight>();
  private lightTweens: LightTween[] = [];
  private chains = new Map<string, ChainSet>();
  private moveTweens: ActorMoveTween[] = [];
  private waitTimers: Array<{ remaining: number; resolve: () => void }> = [];
  private actorRestore = new Map<string, { pos: THREE.Vector3; rotY: number; visible: boolean }>();
  private shakeTimer = 0;
  private shakeIntensity = 0;
  private onFinish?: () => void;
  private origin = new THREE.Vector3();

  public overlay = new CutsceneOverlay();
  public hooks: DirectorHooks = {};
  /** Fired when any cutscene starts/ends (HUD hiding, audio widget, etc.). */
  public onActiveChange?: (active: boolean) => void;

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

  public unregisterActor(id: string): void {
    const a = this.actors.get(id);
    if (a && !a.isTemp) this.actors.delete(id);
  }

  public spawnActor(
    id: string,
    modelPath: string,
    pos: THREE.Vector3,
    opts?: { scale?: number; tintHex?: number; rightWeapon?: string; leftWeapon?: string; idleClip?: string; rimHex?: number }
  ): THREE.Object3D {
    this.removeActor(id);
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
          // Colour identity only — no glow halo
          mat.color.lerp(new THREE.Color(opts.tintHex!), 0.2);
          mat.emissive = new THREE.Color(opts.tintHex!);
          mat.emissiveIntensity = 0.05;
          obj.material = mat;
        }
      });
    }
    if (opts?.rimHex !== undefined) MaterialFX.apply(mesh, opts.rimHex, 0, 2.6);
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
    if (a && a.isTemp) {
      this.scene.remove(a.mesh);
      MaterialFX.release(a.mesh);
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
    this.actorRestore.clear();
    for (const [id, a] of this.actors) {
      if (!a.isTemp && id !== 'player') {
        this.actorRestore.set(id, { pos: a.mesh.position.clone(), rotY: a.mesh.rotation.y, visible: a.mesh.visible });
      }
    }
    this.overlay.showLetterbox(true);
    this.sound.playCinematicWhoosh();
    this.sound.setCutsceneMusic(true);
    this.onActiveChange?.(true);

    try {
      await scriptFn(this);
    } catch (err) {
      console.warn('Cutscene error', err);
    } finally {
      this.markPlayed(cutsceneId);
      this.cleanup();
      this.sound.setCutsceneMusic(false);
      this.active = false;
      this.onActiveChange?.(false);
      const cb = this.onFinish;
      this.onFinish = undefined;
      cb?.();
    }
  }

  /** Run a data-driven CutsceneScript; all coordinates are relative to `origin`. */
  public playScript(script: CutsceneScript, origin: THREE.Vector3, onComplete?: () => void, force = false): Promise<void> {
    return this.play(
      script.id,
      async (d) => {
        d.origin.copy(origin);
        await d.runBeats(script.beats);
      },
      onComplete,
      force
    );
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
    if (this.splineTween) {
      const r = this.splineTween.resolve;
      this.splineTween = null;
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
        MaterialFX.release(a.mesh);
        this.actors.delete(id);
      } else {
        const r = this.actorRestore.get(id);
        if (r) {
          a.mesh.position.copy(r.pos);
          a.mesh.rotation.y = r.rotY;
          a.mesh.visible = r.visible;
          a.anim?.clearOneShot();
          a.anim?.playLoop('Idle_A', 0.2);
        }
      }
    }
    this.actorRestore.clear();
    this.camTween = null;
    this.splineTween = null;
    this.orbitTween = null;
    this.fovTween = null;
    this.camera.fov = 48;
    this.camera.updateProjectionMatrix();
    for (const l of this.tempLights) this.scene.remove(l);
    this.tempLights = [];
    this.namedLights.clear();
    this.lightTweens = [];
    for (const c of this.chains.values()) this.scene.remove(c.group);
    this.chains.clear();
    this.moveTweens = [];
    this.waitTimers = [];
    this.shakeTimer = 0;
  }

  // ───────────────────────────── Script runner ─────────────────────────────

  private v(p: V3): THREE.Vector3 {
    return new THREE.Vector3(p[0] + this.origin.x, p[1] + this.origin.y, p[2] + this.origin.z);
  }

  private async runBeats(beats: Beat[]): Promise<void> {
    for (const b of beats) {
      if (this.aborted) return;
      await this.runBeat(b);
    }
  }

  private resolveClip(actor: CutsceneActor, cue: AnimCue): string | null {
    const anim = actor.anim;
    if (!anim) return null;
    for (const name of ANIM_CUES[cue]) {
      if (anim.hasClip(name)) return name;
    }
    return null;
  }

  public playCue(id: string, cue: AnimCue, loop?: boolean): void {
    const a = this.actors.get(id);
    if (!a || this.aborted) return;
    const clip = this.resolveClip(a, cue);
    if (!clip) return;
    const shouldLoop = loop ?? LOOPING_CUES.has(cue);
    a.anim?.clearOneShot();
    if (shouldLoop) {
      a.anim?.playLoop(clip, 0.12);
    } else {
      // Hold kneel/death poses for the rest of the beat sequence
      const hold = cue === 'Death' || cue === 'Kneel' ? 30 : 1.1;
      a.anim?.playOneShot(clip, 0.08, cue === 'Kneel' ? 0.7 : 1.0, hold);
    }
  }

  private async runBeat(b: Beat): Promise<void> {
    switch (b.op) {
      case 'fade':
        await this.fadeScreen(b.to === 'black', b.dur);
        return;
      case 'chapter':
        await this.showChapterCard(b.act, b.title, b.sub, b.dur ?? 2.4);
        return;
      case 'cam':
        await this.moveCameraTo(this.v(b.pos), this.v(b.look), b.dur);
        return;
      case 'spline': {
        const look = Array.isArray(b.look[0]) ? (b.look as V3[]).map((p) => this.v(p)) : this.v(b.look as V3);
        await this.cameraSpline(b.points.map((p) => this.v(p)), look, b.dur);
        return;
      }
      case 'orbit':
        await this.orbitTarget(this.v(b.center), b.angle, b.radius, b.dur, b.height);
        return;
      case 'fov':
        this.setFov(b.fov, b.dur);
        return;
      case 'spawn': {
        // If the real entity is already registered (e.g. the boss standing in its arena), direct it
        // instead of spawning a duplicate model on top of it.
        const existing = this.actors.get(b.id);
        if (existing && !existing.isTemp) {
          // Hit the scripted mark so the camera framing matches (position is restored afterwards)
          existing.mesh.position.set(this.v(b.at).x, existing.mesh.position.y, this.v(b.at).z);
          if (b.face) this.rotateActorToward(b.id, this.v(b.face));
          this.playCue(b.id, b.anim ?? 'Idle');
          return;
        }
        this.spawnActor(b.id, b.model, this.v(b.at), {
          scale: b.scale,
          tintHex: b.tint,
          rightWeapon: b.rWep,
          leftWeapon: b.lWep,
          rimHex: b.rim,
        });
        if (b.face) this.rotateActorToward(b.id, this.v(b.face));
        this.playCue(b.id, b.anim ?? 'Idle');
        if (!this.aborted) this.vfx.spawnBurst(this.v(b.at).add(new THREE.Vector3(0, 1, 0)), b.rim ?? 0xa855f7, 14, 4);
        return;
      }
      case 'remove':
        this.removeActor(b.id);
        return;
      case 'place': {
        const a = this.actors.get(b.id);
        if (a) {
          a.mesh.position.copy(this.v(b.at));
          if (b.face) this.rotateActorToward(b.id, this.v(b.face));
        }
        return;
      }
      case 'move': {
        const a = this.actors.get(b.id);
        if (!a) return;
        const clip = this.resolveClip(a, b.anim ?? 'Walk') ?? 'Walking_A';
        await this.moveActor(b.id, this.v(b.to), clip, b.dur);
        return;
      }
      case 'anim':
        this.playCue(b.id, b.cue, b.loop);
        return;
      case 'face':
        this.rotateActorToward(b.id, this.v(b.to));
        return;
      case 'light': {
        if (this.aborted) return;
        const old = this.namedLights.get(b.id);
        if (old) this.scene.remove(old);
        const l = new THREE.PointLight(b.color, b.intensity, b.dist ?? 14, 1.6);
        l.position.copy(this.v(b.at));
        l.userData.baseDist = b.dist ?? 14;
        this.scene.add(l);
        this.tempLights.push(l);
        this.namedLights.set(b.id, l);
        return;
      }
      case 'lightShift': {
        const l = this.namedLights.get(b.id);
        if (!l || this.aborted) return;
        this.lightTweens.push({
          light: l,
          fromColor: l.color.clone(),
          toColor: new THREE.Color(b.color),
          fromIntensity: l.intensity,
          toIntensity: b.intensity ?? l.intensity,
          elapsed: 0,
          duration: Math.max(0.01, b.dur),
        });
        return;
      }
      case 'shake':
        this.shakeCamera(b.amt, b.dur);
        return;
      case 'burst':
        this.spawnVFXBurst(this.v(b.at), b.color, b.count ?? 24);
        return;
      case 'ritual':
        this.spawnEpicRitual(this.v(b.at), b.color);
        return;
      case 'lightning':
        this.spawnLightningStrike(this.v(b.from), this.v(b.to), b.color);
        if (!this.aborted) this.sound.playLightning(1);
        return;
      case 'chains':
        this.spawnChains(b.id, this.v(b.from), b.to.map((t) => this.v(t)), b.color ?? 0xa855f7);
        return;
      case 'breakChains':
        this.breakChains(b.id);
        return;
      case 'flash':
        if (!this.aborted) this.hooks.flash?.(b.color, b.amt);
        return;
      case 'music':
        // 'cutscene' is handled by play(); other modes become the mode we restore to afterwards
        if (b.mode === 'cutscene') this.sound.setCutsceneMusic(true);
        else this.sound.setResumeMode(b.mode);
        return;
      case 'stinger':
        if (!this.aborted) this.sound.playStinger(b.kind);
        return;
      case 'sfx':
        if (!this.aborted) this.playSfx(b.name);
        return;
      case 'say': {
        const sp = SPEAKERS[b.who];
        await this.say(sp.name, b.title ?? sp.title, sp.color, b.text);
        return;
      }
      case 'wait':
        await this.wait(b.dur);
        return;
      case 'par':
        await Promise.all(b.beats.map((x) => this.runBeat(x)));
        return;
      case 'brand':
        this.hooks.setBrand?.(b.level);
        return;
      case 'biome':
        this.hooks.setBiome?.(b.id);
        return;
    }
  }

  private playSfx(name: Extract<Beat, { op: 'sfx' }>['name']): void {
    const s = this.sound;
    switch (name) {
      case 'chains':
        s.playChainRattle();
        break;
      case 'explosion':
        s.playExplosion();
        break;
      case 'whoosh':
        s.playCinematicWhoosh();
        break;
      case 'ice':
        s.playIceShatter(1);
        break;
      case 'lightning':
        s.playLightning(2);
        break;
      case 'heal':
        s.playHeal();
        break;
      case 'fire':
        s.playFireBolt(3);
        break;
      case 'bash':
        s.playBash();
        break;
      case 'levelup':
        s.playLevelUp();
        break;
      case 'jobchange':
        s.playJobChange();
        break;
      case 'coins':
        s.playCoinClink(5);
        break;
      case 'refine':
        s.playRefine(true, 3);
        break;
    }
  }

  // ───────────────────────────── Camera ─────────────────────────────

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

  /** Smooth Catmull-Rom camera spline; `look` may be a fixed target or its own spline. */
  public cameraSpline(points: THREE.Vector3[], look: THREE.Vector3 | THREE.Vector3[], duration: number): Promise<void> {
    const pts = points.length >= 2 ? points : [this.camera.position.clone(), ...points];
    const path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const lookTarget: THREE.CatmullRomCurve3 | THREE.Vector3 = Array.isArray(look)
      ? look.length > 1
        ? new THREE.CatmullRomCurve3(look, false, 'centripetal')
        : look[0].clone()
      : look.clone();
    if (this.aborted || duration <= 0.01) {
      this.camera.position.copy(pts[pts.length - 1]);
      this.currentLook.copy(lookTarget instanceof THREE.Vector3 ? lookTarget : lookTarget.getPointAt(1));
      this.camera.lookAt(this.currentLook);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.splineTween = { path, look: lookTarget, elapsed: 0, duration, resolve };
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

  public setFov(fov: number, duration = 0.8): void {
    if (this.aborted || duration <= 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      return;
    }
    this.fovTween = { startFov: this.camera.fov, endFov: fov, elapsed: 0, duration };
  }

  // ───────────────────────────── Actors ─────────────────────────────

  public moveActor(entityId: string, targetPos: THREE.Vector3, walkAnimClip = 'Running_A', duration = 1.2): Promise<void> {
    const actor = this.actors.get(entityId);
    if (!actor || this.aborted) {
      if (actor) actor.mesh.position.copy(targetPos);
      return Promise.resolve();
    }
    this.rotateActorToward(entityId, targetPos);
    actor.anim?.clearOneShot();
    actor.anim?.playLoop(walkAnimClip, 0.08, 1.0);
    return new Promise((resolve) => {
      this.moveTweens.push({
        actor,
        startPos: actor.mesh.position.clone(),
        targetPos: targetPos.clone(),
        elapsed: 0,
        duration: Math.max(0.05, duration),
        resolve: () => {
          const idle = this.resolveClip(actor, 'Idle');
          if (idle) actor.anim?.playLoop(idle, 0.12);
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

  // ───────────────────────────── FX ─────────────────────────────

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

  /** Glowing Soul-Debt chains that whip out from `from` to each target (HDR → bloom). */
  public spawnChains(id: string, from: THREE.Vector3, targets: THREE.Vector3[], color: number): void {
    if (this.aborted) return;
    this.breakChains(id, true);
    const group = new THREE.Group();
    const tubes: THREE.Mesh[] = [];
    const materials: THREE.MeshBasicMaterial[] = [];
    const linkGeo = new THREE.TorusGeometry(0.11, 0.028, 4, 10);
    for (const to of targets) {
      const mid = from.clone().lerp(to, 0.5);
      mid.y = Math.min(from.y, to.y) - 0.5;
      const curve = new THREE.CatmullRomCurve3([from.clone(), from.clone().lerp(mid, 0.5).setY(from.y - 0.25), mid, to.clone()]);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      mat.userData.base = new THREE.Color(color);
      materials.push(mat);
      const geo = new THREE.TubeGeometry(curve, 48, 0.05, 6, false);
      geo.setDrawRange(0, 0);
      const tube = new THREE.Mesh(geo, mat);
      tubes.push(tube);
      group.add(tube);
      for (let i = 1; i < 12; i++) {
        const t = i / 12;
        const link = new THREE.Mesh(linkGeo, mat);
        link.position.copy(curve.getPointAt(t));
        link.lookAt(curve.getPointAt(Math.min(1, t + 0.02)));
        if (i % 2 === 1) link.rotateZ(Math.PI * 0.5);
        link.userData.t = t;
        link.visible = false;
        group.add(link);
      }
      this.vfx.spawnBurst(to.clone(), color, 10, 3.5);
    }
    this.scene.add(group);
    this.chains.set(id, { group, tubes, materials, grow: 0 });
  }

  public breakChains(id: string, silent = false): void {
    const c = this.chains.get(id);
    if (!c) return;
    if (!silent && !this.aborted) {
      c.group.children.forEach((ch, i) => {
        if (i % 4 === 0) this.vfx.spawnBurst(ch.getWorldPosition(new THREE.Vector3()), 0xfacc15, 6, 4.5);
      });
    }
    this.scene.remove(c.group);
    this.chains.delete(id);
  }

  // ───────────────────────────── Dialogue / overlay ─────────────────────────────

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

  // ───────────────────────────── Tick ─────────────────────────────

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

    if (this.splineTween) {
      const s = this.splineTween;
      s.elapsed += dt;
      const p = Math.min(1, s.elapsed / s.duration);
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      s.path.getPointAt(ease, this.camera.position);
      if (s.look instanceof THREE.Vector3) this.currentLook.copy(s.look);
      else s.look.getPointAt(ease, this.currentLook);
      this.camera.lookAt(this.currentLook);
      if (p >= 1) {
        const res = s.resolve;
        this.splineTween = null;
        res();
      }
    }

    if (this.orbitTween) {
      const o = this.orbitTween;
      o.elapsed += dt;
      const p = Math.min(1, o.elapsed / o.duration);
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const ang = o.startAngle + o.angleDelta * ease;
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
      const k = Math.max(0, this.shakeTimer) * this.shakeIntensity;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
    }

    // Light colour/intensity shifts + subtle radius jitter on every cutscene light
    for (let i = this.lightTweens.length - 1; i >= 0; i--) {
      const lt = this.lightTweens[i];
      lt.elapsed += dt;
      const p = Math.min(1, lt.elapsed / lt.duration);
      lt.light.color.copy(lt.fromColor).lerp(lt.toColor, p);
      lt.light.intensity = lt.fromIntensity + (lt.toIntensity - lt.fromIntensity) * p;
      if (p >= 1) this.lightTweens.splice(i, 1);
    }
    const tNow = performance.now() * 0.001;
    for (const l of this.namedLights.values()) {
      const base = (l.userData.baseDist as number) ?? 14;
      l.distance = base * (1 + Math.sin(tNow * 7.3 + l.id) * 0.04 + Math.sin(tNow * 17.1 + l.id * 2) * 0.02);
    }

    // Chains: whip outward, then pulse
    for (const c of this.chains.values()) {
      c.grow = Math.min(1, c.grow + dt * 2.6);
      for (const tube of c.tubes) {
        const geo = tube.geometry as THREE.BufferGeometry;
        const total = geo.index ? geo.index.count : 0;
        geo.setDrawRange(0, Math.floor((total * c.grow) / 3) * 3);
      }
      for (const ch of c.group.children) {
        if (ch.userData.t !== undefined) ch.visible = (ch.userData.t as number) <= c.grow;
      }
      const pulse = 1.8 + Math.sin(tNow * 6) * 0.7;
      c.materials.forEach((m) => m.color.copy(m.userData.base as THREE.Color).multiplyScalar(pulse));
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
