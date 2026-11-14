import { HERO_CLASSES, HERO_CLASS_ORDER } from '../game/classes';
import { RELICS } from '../game/relics';
import { HeroClassId, HUDState, RelicDef, RoomData } from '../types';

export class HUDManager {
  private root: HTMLElement;
  private lastPhase = '';
  private lastClass: HeroClassId | '' = '';
  private minimapCanvas: HTMLCanvasElement | null = null;
  private showingCodex = false;
  private isMuted = false;

  constructor(
    private onSelectClass: (id: HeroClassId) => void,
    private onStartGame: () => void,
    private onPickRelic: (relic: RelicDef) => void,
    private onRestart: () => void,
    private onUIHover?: () => void,
    private onUISelect?: () => void,
    private onUIPopup?: () => void,
    private onTogglePause?: () => void,
    private onRestartRun?: () => void,
    private onGoToSelect?: () => void,
    private onBackToMenu?: () => void,
    private onToggleMute?: () => boolean
  ) {
    this.root = document.getElementById('ui-root')!;
  }

  public showLoading(pct: number, label: string): void {
    this.lastPhase = 'loading';
    this.root.innerHTML = `
      <div class="loading-screen interactive">
        <div class="loading-title">CRYPTFALL</div>
        <div class="loading-bar-wrap">
          <div class="loading-bar-fill" style="width:${pct.toFixed(0)}%"></div>
        </div>
        <div style="font-size:13px;color:var(--muted)">${label}</div>
      </div>
    `;
  }

  public showRelicDraft(options: RelicDef[]): void {
    this.lastPhase = 'relic_draft';
    this.onUIPopup?.();
    this.root.innerHTML = `
      <div class="modal-backdrop interactive">
        <div class="modal-title">Relic Shrine Blessing</div>
        <div style="color:var(--muted);font-size:14px">Choose 1 run-altering relic</div>
        <div class="relic-cards">
          ${options
            .map(
              (r, i) => `
            <button class="relic-card" data-idx="${i}">
              <span class="r-tag">${r.tag}</span>
              <span class="r-name">${r.name}</span>
              <span class="r-desc">${r.description}</span>
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    `;
    this.root.querySelectorAll('.relic-card').forEach((btn) => {
      btn.addEventListener('mouseenter', () => this.onUIHover?.());
      btn.addEventListener('click', () => {
        this.onUISelect?.();
        const idx = Number((btn as HTMLElement).dataset.idx);
        this.onPickRelic(options[idx]);
      });
    });
  }

  public render(state: HUDState, rooms: RoomData[], playerPos: { x: number; z: number }): void {
    if (state.phase === 'loading' || state.phase === 'relic_draft') return;

    if (state.phase === 'menu') {
      if (this.lastPhase !== 'menu') {
        this.lastPhase = 'menu';
        this.renderMainMenu();
      }
      return;
    }

    if (state.phase === 'title') {
      if (this.lastPhase !== 'title' || this.lastClass !== state.selectedClass) {
        this.lastPhase = 'title';
        this.lastClass = state.selectedClass;
        this.renderTitle(state.selectedClass);
      }
      return;
    }

    if (state.phase === 'dead') {
      if (this.lastPhase !== 'dead') {
        this.lastPhase = 'dead';
        this.renderDeath(state);
      }
      return;
    }

    if (state.phase === 'paused') {
      if (this.lastPhase !== 'paused') {
        this.lastPhase = 'paused';
        this.renderPause(state);
      }
      return;
    }

    // Playing HUD
    if (this.lastPhase !== 'playing') {
      this.lastPhase = 'playing';
      this.renderPlayingShell(state);
      this.minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    }

    this.updatePlayingValues(state);
    this.drawMinimap(rooms, playerPos);
  }

  private renderMainMenu(): void {
    this.root.innerHTML = `
      <div class="title-screen interactive" style="justify-content:center;align-items:center;text-align:center;background:radial-gradient(circle at center, rgba(12,10,18,0.55) 0%, rgba(6,5,10,0.9) 100%)">
        <div style="display:flex;flex-direction:column;align-items:center;gap:22px;max-width:460px;width:100%">
          <div class="title-header">
            <h1 style="font-size:64px">CRYPTFALL</h1>
            <p>3D Dungeon Crawler Roguelite</p>
          </div>

          <div style="display:flex;flex-direction:column;gap:12px;width:280px;margin-top:8px">
            <button class="start-btn" id="btn-menu-play">New Expedition</button>
            <button class="class-tab" id="btn-menu-codex" style="padding:13px;font-size:14px">Controls &amp; Relics</button>
            <button class="class-tab" id="btn-menu-audio" style="padding:13px;font-size:14px">Audio: ${this.isMuted ? 'Off' : 'On'}</button>
          </div>
        </div>

        ${
          this.showingCodex
            ? `
          <div class="modal-backdrop interactive">
            <div class="modal-title" style="font-size:26px">Controls &amp; Relics</div>
            <div class="class-card" style="max-width:520px;text-align:left;line-height:1.6;font-size:13px">
              <div><strong>Movement:</strong> <span class="kbd">WASD</span> / Arrow Keys &bull; <strong>Aim:</strong> Mouse Cursor</div>
              <div><strong>Primary Attack:</strong> <span class="kbd">LMB</span> &bull; <strong>Dodge Roll (i-frames):</strong> <span class="kbd">Space</span> / <span class="kbd">Shift</span></div>
              <div><strong>Active Skill:</strong> <span class="kbd">RMB</span> / <span class="kbd">Q</span> / <span class="kbd">1</span> &bull; <strong>Ultimate:</strong> <span class="kbd">R</span> / <span class="kbd">2</span></div>
              <div><strong>Interact (Chests / Shrines / Trapdoor):</strong> <span class="kbd">E</span> &bull; <strong>Pause:</strong> <span class="kbd">ESC</span></div>
              <hr style="border:none;border-top:1px solid var(--border);margin:10px 0" />
              <div style="color:var(--muted)">Clear rooms to unlock iron gates and spawn Chests &amp; Relic Shrines offering 3 run-altering blessings. Defeat each floor's Dread Bone Colossus to descend deeper.</div>
            </div>
            <button class="start-btn" id="btn-codex-close">Close</button>
          </div>
        `
            : ''
        }
      </div>
    `;

    const bindHover = (id: string) => document.getElementById(id)?.addEventListener('mouseenter', () => this.onUIHover?.());
    bindHover('btn-menu-play');
    bindHover('btn-menu-codex');
    bindHover('btn-menu-audio');

    document.getElementById('btn-menu-play')?.addEventListener('click', () => {
      this.onUISelect?.();
      this.onGoToSelect?.();
    });
    document.getElementById('btn-menu-codex')?.addEventListener('click', () => {
      this.onUISelect?.();
      this.showingCodex = true;
      this.renderMainMenu();
    });
    document.getElementById('btn-codex-close')?.addEventListener('click', () => {
      this.onUISelect?.();
      this.showingCodex = false;
      this.renderMainMenu();
    });
    document.getElementById('btn-menu-audio')?.addEventListener('click', () => {
      this.isMuted = this.onToggleMute?.() ?? !this.isMuted;
      this.onUISelect?.();
      this.renderMainMenu();
    });
  }

  private renderTitle(selected: HeroClassId): void {
    const cls = HERO_CLASSES[selected];
    this.root.innerHTML = `
      <div class="title-screen interactive">
        <div class="title-header" style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <h1>CRYPTFALL</h1>
            <p>Choose Your Hero</p>
          </div>
          <button class="class-tab" id="btn-back-menu" style="padding:10px 16px;font-size:12px">&larr; Main Menu</button>
        </div>

        <div class="class-panel">
          <div class="class-tabs">
            ${HERO_CLASS_ORDER.map((id) => {
              const c = HERO_CLASSES[id];
              return `<button class="class-tab ${id === selected ? 'active' : ''}" data-class="${id}">${c.name}</button>`;
            }).join('')}
          </div>

          <div class="class-card">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <h2>${cls.name}</h2>
                <div class="class-role">${cls.role}</div>
              </div>
              <div class="weapon-badge" style="background-position:0 -${HERO_CLASS_ORDER.indexOf(selected) * 24}px"></div>
            </div>
            <div class="stat-grid">
              <div class="stat-box"><div class="lbl">HP</div><div class="val">${cls.maxHp}</div></div>
              <div class="stat-box"><div class="lbl">Damage</div><div class="val">${cls.damage}</div></div>
              <div class="stat-box"><div class="lbl">Speed</div><div class="val">${cls.speed.toFixed(1)}</div></div>
              <div class="stat-box"><div class="lbl">Crit</div><div class="val">${Math.round(cls.critChance * 100)}%</div></div>
            </div>
            <div class="ability-list">
              <div class="ability-item"><strong>[LMB] ${cls.primaryName}:</strong> ${cls.primaryDesc}</div>
              <div class="ability-item"><strong>[RMB / Q] ${cls.skillName}:</strong> ${cls.skillDesc}</div>
              <div class="ability-item"><strong>[R / 2] ${cls.ultName}:</strong> ${cls.ultDesc}</div>
              <div class="ability-item"><strong>[Space] Dodge Roll:</strong> Evade with invulnerability frames.</div>
            </div>
          </div>

          <button class="start-btn" id="btn-descend">Enter the Crypt</button>
        </div>

        <div class="controls-hint">
          <span><span class="kbd">WASD</span> Move</span>
          <span><span class="kbd">Mouse</span> Aim</span>
          <span><span class="kbd">LMB</span> Attack</span>
          <span><span class="kbd">RMB / Q</span> Skill</span>
          <span><span class="kbd">R</span> Ultimate</span>
          <span><span class="kbd">Space</span> Dodge</span>
          <span><span class="kbd">E</span> Interact</span>
          <span><span class="kbd">ESC</span> Pause</span>
        </div>
      </div>
    `;

    this.root.querySelectorAll('.class-tab').forEach((btn) => {
      btn.addEventListener('mouseenter', () => this.onUIHover?.());
      btn.addEventListener('click', () => {
        this.onUISelect?.();
        this.onSelectClass((btn as HTMLElement).dataset.class as HeroClassId);
      });
    });
    document.getElementById('btn-descend')?.addEventListener('click', () => {
      this.onUISelect?.();
      this.onStartGame();
    });
    document.getElementById('btn-back-menu')?.addEventListener('click', () => {
      this.onUISelect?.();
      this.onBackToMenu?.();
    });
  }

  private renderPlayingShell(state: HUDState): void {
    const cls = HERO_CLASSES[state.selectedClass];
    this.root.innerHTML = `
      <div class="hud">
        <div class="hud-top">
          <div style="display:flex;gap:10px;align-items:flex-start">
            <div class="hud-floor-card">
              <div class="floor-title" id="hud-floor">Floor ${state.floor}</div>
              <div class="floor-sub" id="hud-stats">Kills: 0 &bull; Gold: 0</div>
            </div>
            <button id="btn-pause" class="class-tab interactive" style="padding:10px 14px;font-size:12px">ESC Menu</button>
          </div>

          <div class="boss-bar-wrap" id="boss-wrap" style="display:none">
            <div class="boss-name" id="boss-name">Dread Bone Colossus</div>
            <div class="boss-hp-track"><div class="boss-hp-fill" id="boss-hp" style="width:100%"></div></div>
          </div>

          <div class="minimap-box">
            <canvas id="minimap-canvas" width="156" height="156"></canvas>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase" id="hud-room-type">Start</div>
          </div>
        </div>

        <div id="hud-banner" class="banner-toast" style="display:none"></div>
        <div id="hud-interact" class="interact-prompt" style="display:none"></div>

        <div class="hud-bottom">
          <div class="player-bars">
            <div class="hp-row" style="align-items:center">
              <span style="display:flex;align-items:center;gap:8px"><span class="weapon-badge" style="width:28px;transform:scale(1);background-position:0 -${HERO_CLASS_ORDER.indexOf(state.selectedClass) * 24}px"></span>${cls.name}</span>
              <span id="hud-hp-text">${state.hp} / ${state.maxHp}</span>
            </div>
            <div class="hp-track"><div class="hp-fill" id="hud-hp-fill" style="width:100%"></div></div>
            <div class="skill-row">
              <div class="skill-slot">
                <div class="s-key">RMB / Q</div>
                <div class="s-name">${cls.skillName}</div>
                <div class="cd-overlay" id="cd-skill" style="display:none"></div>
              </div>
              <div class="skill-slot">
                <div class="s-key">R / 2</div>
                <div class="s-name">${cls.ultName}</div>
                <div class="cd-overlay" id="cd-ult" style="display:none"></div>
              </div>
              <div class="skill-slot">
                <div class="s-key">SPACE</div>
                <div class="s-name">Dodge Roll</div>
                <div class="cd-overlay" id="cd-dodge" style="display:none"></div>
              </div>
            </div>
          </div>

          <div class="relic-strip" id="hud-relics"></div>
        </div>
      </div>
    `;
    document.getElementById('btn-pause')?.addEventListener('click', () => this.onTogglePause?.());
  }

  private updatePlayingValues(state: HUDState): void {
    const floorEl = document.getElementById('hud-floor');
    if (floorEl) floorEl.textContent = `Floor ${state.floor} — ${state.currentRoomType.toUpperCase()}`;

    const statsEl = document.getElementById('hud-stats');
    if (statsEl) statsEl.textContent = `Kills: ${state.kills}  •  Gold: ${state.gold}`;

    const hpText = document.getElementById('hud-hp-text');
    const hpFill = document.getElementById('hud-hp-fill');
    if (hpText) hpText.textContent = `${Math.ceil(state.hp)} / ${state.maxHp}`;
    if (hpFill) hpFill.style.width = `${Math.max(0, (state.hp / state.maxHp) * 100)}%`;

    const cdSkill = document.getElementById('cd-skill');
    if (cdSkill) {
      if (state.skillCd > 0.05) {
        cdSkill.style.display = 'flex';
        cdSkill.textContent = `${state.skillCd.toFixed(1)}s`;
      } else {
        cdSkill.style.display = 'none';
      }
    }

    const cdUlt = document.getElementById('cd-ult');
    if (cdUlt) {
      if (state.ultCd > 0.05) {
        cdUlt.style.display = 'flex';
        cdUlt.textContent = `${state.ultCd.toFixed(1)}s`;
      } else {
        cdUlt.style.display = 'none';
      }
    }

    const cdDodge = document.getElementById('cd-dodge');
    if (cdDodge) {
      if (state.dodgeCd > 0.05) {
        cdDodge.style.display = 'flex';
        cdDodge.textContent = `${state.dodgeCd.toFixed(1)}s`;
      } else {
        cdDodge.style.display = 'none';
      }
    }

    const bossWrap = document.getElementById('boss-wrap');
    if (bossWrap) {
      bossWrap.style.display = state.bossActive ? 'block' : 'none';
      if (state.bossActive) {
        const bn = document.getElementById('boss-name');
        const bh = document.getElementById('boss-hp');
        if (bn) bn.textContent = state.bossName;
        if (bh) bh.style.width = `${Math.max(0, (state.bossHp / state.bossMaxHp) * 100)}%`;
      }
    }

    const interactEl = document.getElementById('hud-interact');
    if (interactEl) {
      interactEl.style.display = state.interactPrompt ? 'block' : 'none';
      if (state.interactPrompt) interactEl.textContent = state.interactPrompt;
    }

    const bannerEl = document.getElementById('hud-banner');
    if (bannerEl) {
      bannerEl.style.display = state.bannerText ? 'block' : 'none';
      if (state.bannerText) bannerEl.textContent = state.bannerText;
    }

    const roomTypeEl = document.getElementById('hud-room-type');
    if (roomTypeEl) roomTypeEl.textContent = `${state.currentRoomType} room`;

    const relicStrip = document.getElementById('hud-relics');
    if (relicStrip && relicStrip.childElementCount !== state.relics.length) {
      relicStrip.innerHTML = state.relics.map((id) => `<div class="relic-pill">${RELICS[id].name}</div>`).join('');
    }
  }

  private drawMinimap(rooms: RoomData[], playerPos: { x: number; z: number }): void {
    const canvas = this.minimapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = 2.0; // world meters -> px
    const cx = canvas.width / 2 - (playerPos.x / 28) * 26;
    const cy = canvas.height / 2 - (playerPos.z / 28) * 26;

    // Connections
    ctx.strokeStyle = 'rgba(212, 165, 89, 0.35)';
    ctx.lineWidth = 4;
    for (const r of rooms) {
      if (!r.discovered) continue;
      const rx = cx + r.gx * 26;
      const ry = cy + r.gy * 26;
      if (r.doors.e) {
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + 26, ry);
        ctx.stroke();
      }
      if (r.doors.s) {
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx, ry + 26);
        ctx.stroke();
      }
    }

    // Room squares
    for (const r of rooms) {
      if (!r.discovered) continue;
      const rx = cx + r.gx * 26;
      const ry = cy + r.gy * 26;
      const sz = r.type === 'boss' ? 18 : 14;
      ctx.fillStyle =
        r.type === 'boss'
          ? '#b91c1c'
          : r.type === 'treasure'
            ? '#eab308'
            : r.type === 'trap'
              ? '#f97316'
              : r.cleared
                ? '#334155'
                : '#475569';
      ctx.fillRect(rx - sz / 2, ry - sz / 2, sz, sz);
      ctx.strokeStyle = r.cleared ? '#64748b' : '#eab354';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx - sz / 2, ry - sz / 2, sz, sz);
    }

    // Player dot
    const px = cx + (playerPos.x / 28) * 26;
    const py = cy + (playerPos.z / 28) * 26;
    ctx.fillStyle = '#38d399';
    ctx.beginPath();
    ctx.arc(px, py, 3.6 + scale * 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderPause(state: HUDState): void {
    this.root.innerHTML = `
      <div class="modal-backdrop interactive">
        <div class="modal-title">Paused</div>
        <div style="font-size:15px;color:var(--muted)">
          Floor ${state.floor} &bull; ${HERO_CLASSES[state.selectedClass].name} &bull; ${state.kills} Kills
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;width:260px">
          <button class="start-btn" id="btn-resume">Resume</button>
          <button class="class-tab" id="btn-restart-run" style="padding:12px;font-size:14px">Restart Run</button>
          <button class="class-tab" id="btn-quit-title" style="padding:12px;font-size:14px;border-color:rgba(225,66,66,0.5);color:#ff8a8a">Quit to Title</button>
        </div>
      </div>
    `;
    document.getElementById('btn-resume')?.addEventListener('click', () => this.onTogglePause?.());
    document.getElementById('btn-restart-run')?.addEventListener('click', () => {
      this.onUISelect?.();
      this.onRestartRun?.();
    });
    document.getElementById('btn-quit-title')?.addEventListener('click', () => {
      this.onUISelect?.();
      this.onRestart();
    });
  }

  private renderDeath(state: HUDState): void {
    this.root.innerHTML = `
      <div class="modal-backdrop interactive">
        <div class="modal-title" style="color:#ff5252">You Fell in the Crypt</div>
        <div style="font-size:16px;color:var(--text)">
          Reached <strong>Floor ${state.floor}</strong> &bull; Slain <strong>${state.kills}</strong> Skeletons &bull; Collected <strong>${state.relics.length}</strong> Relics
        </div>
        <button class="start-btn" id="btn-retry">Rise Again</button>
      </div>
    `;
    document.getElementById('btn-retry')?.addEventListener('click', () => this.onRestart());
  }
}
