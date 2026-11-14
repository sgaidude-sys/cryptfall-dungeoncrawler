import * as THREE from 'three';

export type RODamageStyle = 'normal' | 'crit' | 'magic' | 'heal' | 'sp' | 'miss' | 'lucky' | 'guard' | 'total' | 'tank1' | 'player-hit';

interface FloatingEntry {
  el: HTMLDivElement;
  worldPos: THREE.Vector3;
  offsetX: number;
  offsetY: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  maxLife: number;
}

export class RODamageNumbers {
  private layer: HTMLElement;
  private entries: FloatingEntry[] = [];
  private timers: number[] = [];

  constructor() {
    this.layer = document.getElementById('damage-layer')!;
  }

  public spawn(worldPos: THREE.Vector3, text: string | number, style: RODamageStyle = 'normal', yOffset = 1.65): void {
    const el = document.createElement('div');
    el.className = `ro-dmg ro-dmg-${style}`;

    if (style === 'crit') {
      el.innerHTML = `<span class="ro-crit-burst"></span><span class="ro-crit-val">${text}</span>`;
    } else {
      el.textContent = String(text);
    }

    this.layer.appendChild(el);
    const isTotal = style === 'total';
    const isCrit = style === 'crit';
    this.entries.push({
      el,
      worldPos: worldPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.45, yOffset, (Math.random() - 0.5) * 0.45)),
      offsetX: isTotal ? 28 : 0,
      offsetY: 0,
      vx: isTotal ? 10 : (Math.random() - 0.5) * 32,
      vy: isCrit ? -110 : isTotal ? -95 : -82,
      gravity: isCrit || style === 'normal' ? 140 : 40,
      life: isTotal ? 1.15 : isCrit ? 0.95 : 0.78,
      maxLife: isTotal ? 1.15 : isCrit ? 0.95 : 0.78,
    });
  }

  /**
   * Classic Ragnarok Online multi-hit bolt/combo cascade:
   * Stacks individual hits every 80ms vertically AND pops a large yellow cumulative total!
   */
  public spawnMultiHitStack(worldPos: THREE.Vector3, hits: number[], style: 'magic' | 'normal' = 'magic'): void {
    if (hits.length === 0) return;
    let runningTotal = 0;
    const basePos = worldPos.clone();

    hits.forEach((dmg, idx) => {
      const tid = window.setTimeout(() => {
        runningTotal += dmg;
        this.spawn(basePos, dmg, style, 1.55 + idx * 0.24);
        if (idx === hits.length - 1 && hits.length > 1) {
          this.spawn(basePos, runningTotal, 'total', 1.85);
        }
      }, idx * 80);
      this.timers.push(tid);
    });
  }

  public update(dt: number, camera: THREE.Camera): void {
    const v = new THREE.Vector3();
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.life -= dt;
      if (e.life <= 0) {
        e.el.remove();
        this.entries.splice(i, 1);
        continue;
      }

      e.vy += e.gravity * dt;
      e.offsetX += e.vx * dt;
      e.offsetY += e.vy * dt;

      v.copy(e.worldPos).project(camera);
      if (v.z > 1) {
        e.el.style.display = 'none';
        continue;
      }
      e.el.style.display = 'block';
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth + e.offsetX;
      const sy = (-v.y * 0.5 + 0.5) * window.innerHeight + e.offsetY;
      const t = e.life / e.maxLife;
      const pop = t > 0.85 ? 1 + (1 - t) * 1.4 : 1;
      e.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      e.el.style.opacity = String(Math.min(1, t * 2.1));
    }
  }

  public clear(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    for (const e of this.entries) e.el.remove();
    this.entries = [];
  }
}
