import * as THREE from 'three';

export interface CutsceneConfig {
  duration: number;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startLook: THREE.Vector3;
  endLook: THREE.Vector3;
  title: string;
  subtitle: string;
  onComplete?: () => void;
}

export class CutsceneManager {
  public active = false;
  private elapsed = 0;
  private cfg: CutsceneConfig | null = null;
  private overlayEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;

  constructor() {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'cutscene-overlay';
    this.overlayEl.style.display = 'none';
    this.overlayEl.innerHTML = `
      <div class="letterbox-top"></div>
      <div class="cutscene-caption">
        <div class="cutscene-title"></div>
        <div class="cutscene-sub"></div>
      </div>
      <div class="cutscene-skip">Press [SPACE] or [ESC] to Skip</div>
      <div class="letterbox-bottom"></div>
    `;
    document.body.appendChild(this.overlayEl);
    this.titleEl = this.overlayEl.querySelector('.cutscene-title')!;
    this.subEl = this.overlayEl.querySelector('.cutscene-sub')!;
  }

  public play(cfg: CutsceneConfig): void {
    this.cfg = cfg;
    this.elapsed = 0;
    this.active = true;
    this.titleEl.textContent = cfg.title;
    this.subEl.textContent = cfg.subtitle;
    this.overlayEl.style.display = 'block';
    requestAnimationFrame(() => this.overlayEl.classList.add('open'));
  }

  public skip(): void {
    if (!this.active) return;
    const cb = this.cfg?.onComplete;
    this.stop();
    cb?.();
  }

  private stop(): void {
    this.active = false;
    this.cfg = null;
    this.overlayEl.classList.remove('open');
    this.overlayEl.style.display = 'none';
  }

  public update(dt: number, camera: THREE.Camera): boolean {
    if (!this.active || !this.cfg) return false;
    this.elapsed += dt;
    const rawT = Math.min(1, this.elapsed / this.cfg.duration);
    // Smooth cubic ease in-out
    const t = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

    camera.position.lerpVectors(this.cfg.startPos, this.cfg.endPos, t);
    const look = new THREE.Vector3().lerpVectors(this.cfg.startLook, this.cfg.endLook, t);
    camera.lookAt(look);

    if (rawT >= 1) {
      const cb = this.cfg.onComplete;
      this.stop();
      cb?.();
    }
    return true;
  }
}
