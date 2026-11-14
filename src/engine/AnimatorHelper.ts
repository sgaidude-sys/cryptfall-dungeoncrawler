import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager';

export class AnimatorHelper {
  public mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentName = '';
  private oneshotTimer = 0;

  constructor(
    root: THREE.Object3D,
    private assets: AssetManager,
    private customClips?: Map<string, THREE.AnimationClip>
  ) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  private getAction(clipName: string): THREE.AnimationAction | null {
    if (this.actions.has(clipName)) return this.actions.get(clipName)!;
    const clip = this.customClips?.get(clipName) ?? this.assets.getClip(clipName);
    if (!clip) return null;
    const action = this.mixer.clipAction(clip);
    this.actions.set(clipName, action);
    return action;
  }

  public hasClip(clipName: string): boolean {
    return Boolean(this.customClips?.has(clipName) || this.assets.getClip(clipName));
  }

  public playLoop(clipName: string, fade = 0.14, timeScale = 1): void {
    if (this.oneshotTimer > 0) return;
    if (this.currentName === clipName) {
      const act = this.actions.get(clipName);
      if (act) act.timeScale = timeScale;
      return;
    }
    const next = this.getAction(clipName);
    if (!next) return;
    next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1);
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.play();
    if (this.currentName && this.actions.has(this.currentName)) {
      this.actions.get(this.currentName)!.crossFadeTo(next, fade, false);
    }
    this.currentName = clipName;
  }

  public playOneShot(clipName: string, fade = 0.08, timeScale = 1.25, lockDuration?: number): void {
    const next = this.getAction(clipName);
    if (!next) return;
    next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1);
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    next.play();
    if (this.currentName && this.currentName !== clipName && this.actions.has(this.currentName)) {
      this.actions.get(this.currentName)!.crossFadeTo(next, fade, false);
    }
    this.currentName = clipName;
    this.oneshotTimer = lockDuration ?? (next.getClip().duration / timeScale) * 0.85;
  }

  public update(dt: number): void {
    if (this.oneshotTimer > 0) {
      this.oneshotTimer = Math.max(0, this.oneshotTimer - dt);
    }
    this.mixer.update(dt);
  }

  public clearOneShot(): void {
    this.oneshotTimer = 0;
  }
}
