import { HERO_CLASSES, HERO_CLASS_ORDER } from '../game/classes';
import { RELICS } from '../game/relics';
import type { StatKey } from '../game/RagnarokStatsSystem';
import { CLASS_SKILL_TREES, RO_SKILLS, ROSkillId } from '../game/SkillSystem';
import { HeroClassId, HUDState, KafraItem, RelicDef, RoomData, SkillNodeId } from '../types';

export interface ROCallbacks {
  onToggleStats: () => void;
  onAllocateStat: (stat: StatKey) => void;
  onUpgradeROSkill: (id: ROSkillId) => void;
  onRefineWeapon: () => void;
  onRefineArmor: () => void;
  onResetStats: () => void;
  onResetSkills: () => void;
  onBuyPotion: (kind: 'red' | 'blue') => void;
  onEquipCard: (card: KafraItem | null) => void;
  onCloseModal: () => void;
  onUseRedPotion: () => void;
  onUseBluePotion: () => void;
  onEnterDungeon: () => void;
  onReturnToTown: () => void;
}

export class HUDManager {
  private root: HTMLElement;
  private lastPhase = '';
  private lastModalKey = '';
  private lastClass: HeroClassId | '' = '';
  private minimapCanvas: HTMLCanvasElement | null = null;
  private showingCodex = false;
  private isMuted = false;
  private ro?: ROCallbacks;

  public setROCallbacks(ro: ROCallbacks): void {
    this.ro = ro;
  }

  public clearForCutscene(): void {
    this.lastPhase = 'cutscene';
    this.root.innerHTML = '';
  }

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
    private onToggleMute?: () => boolean,
    private onToggleSkillTree?: () => void,
    private onUnlockSkill?: (id: SkillNodeId) => void
  ) {
    this.root = document.getElementById('ui-root')!;
    void this.onUnlockSkill;
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

    if (state.phase === 'stats_window') {
      const key = JSON.stringify([state.statPoints, state.roBase, state.weaponRefine, state.armorRefine]);
      if (this.lastPhase !== 'stats_window' || this.lastModalKey !== key) {
        this.lastPhase = 'stats_window';
        this.lastModalKey = key;
        this.renderStatsWindow(state);
      }
      return;
    }

    if (state.phase === 'npc_modal') {
      const key = JSON.stringify([
        state.activeNpc,
        state.gold,
        state.weaponRefine,
        state.armorRefine,
        state.redPotions,
        state.bluePotions,
        state.equippedCard?.id ?? null,
      ]);
      if (this.lastPhase !== 'npc_modal' || this.lastModalKey !== key) {
        this.lastPhase = 'npc_modal';
        this.lastModalKey = key;
        this.renderNpcModal(state);
      }
      return;
    }

    if (state.phase === 'skill_tree') {
      const key = JSON.stringify([state.roSkillPoints, state.roSkills]);
      if (this.lastPhase !== 'skill_tree' || this.lastModalKey !== key) {
        this.lastPhase = 'skill_tree';
        this.lastModalKey = key;
        this.renderSkillTree(state);
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
              ${CLASS_SKILL_TREES[selected]
                .slice(0, 4)
                .map((skillId, idx) => {
                  const s = RO_SKILLS[skillId];
                  const key = idx === 0 ? 'Q / 1' : idx === 1 ? 'C / 2' : idx === 2 ? 'R / 3' : 'V / 4';
                  return `<div class="ability-item"><strong>[${key}] ${s.name}:</strong> ${s.desc(3)}</div>`;
                })
                .join('')}
              <div class="ability-item"><strong>[Space] Dodge Roll:</strong> Evade with invulnerability frames.</div>
            </div>
          </div>

          <button class="start-btn" id="btn-descend">Enter Oakhaven Town</button>
        </div>

        <div class="controls-hint">
          <span><span class="kbd">WASD</span> Move</span>
          <span><span class="kbd">LMB</span> Attack</span>
          <span><span class="kbd">Q/C/R/V</span> Skills</span>
          <span><span class="kbd">5/6</span> Potions</span>
          <span><span class="kbd">U</span> Stats</span>
          <span><span class="kbd">K</span> Skill Tree</span>
          <span><span class="kbd">Space</span> Dodge</span>
          <span><span class="kbd">E</span> Interact</span>
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
    const tree = CLASS_SKILL_TREES[state.selectedClass];
    const floorTitle =
      state.floor === 0
        ? 'Oakhaven Town'
        : state.floor === 1
          ? 'Floor 1: Sunken Crypt'
          : state.floor === 2
            ? 'Floor 2: Overgrown Ruins'
            : `Floor ${state.floor}: Obsidian Spire`;
    this.root.innerHTML = `
      <div class="hud">
        <div class="hud-top">
          <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">
            <div class="hud-floor-card">
              <div class="floor-title" id="hud-floor">${floorTitle}</div>
              <div class="floor-sub" id="hud-stats">Lv.${state.level} &bull; Kills: 0 &bull; Gold: 0</div>
            </div>
            <button id="btn-pause" class="class-tab interactive" style="padding:9px 12px;font-size:12px">ESC Menu</button>
            <button id="btn-ro-stats" class="class-tab interactive" style="padding:9px 12px;font-size:12px;border-color:rgba(56,189,248,0.45);color:#7dd3fc">[U] Stats (<span id="hud-stat-pts">${state.statPoints}</span>)</button>
            <button id="btn-skills" class="class-tab interactive" style="padding:9px 12px;font-size:12px;border-color:rgba(250,204,21,0.45);color:#fde047">[K] Skills (<span id="hud-sp">${state.roSkillPoints}</span>)</button>
            <button id="btn-town" class="class-tab interactive" style="padding:9px 12px;font-size:12px;border-color:rgba(52,211,153,0.45);color:#6ee7b7">${state.floor === 0 ? 'Enter Crypt' : 'Town'}</button>
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

        <div id="ro-cast-wrap" class="ro-cast-wrap" style="display:none">
          <div class="ro-cast-label" id="ro-cast-label">Casting...</div>
          <div class="ro-cast-track"><div class="ro-cast-fill" id="ro-cast-fill" style="width:0%"></div></div>
        </div>

        <div class="hud-bottom">
          <div class="player-bars">
            <div class="hp-row" style="align-items:center">
              <span style="display:flex;align-items:center;gap:8px"><span class="weapon-badge" style="width:28px;transform:scale(1);background-position:0 -${HERO_CLASS_ORDER.indexOf(state.selectedClass) * 24}px"></span>${cls.name} <span id="hud-refine-tag" style="font-size:11px;color:#fde047"></span></span>
              <span id="hud-hp-text">${state.hp} / ${state.maxHp}</span>
            </div>
            <div class="hp-track"><div class="hp-fill" id="hud-hp-fill" style="width:100%"></div></div>
            <div class="sp-row">
              <span style="font-size:11px;color:#7dd3fc">SP</span>
              <div class="sp-track"><div class="sp-fill" id="hud-sp-fill" style="width:100%"></div></div>
              <span id="hud-sp-text" style="font-size:11px;color:#bae6fd">${state.sp} / ${state.maxSp}</span>
            </div>
            <div class="skill-row">
              <div class="skill-slot">
                <div class="s-key">Q / 1</div>
                <div class="s-name" id="name-skill1">${RO_SKILLS[tree[0]]?.name ?? cls.skillName}</div>
                <div class="cd-overlay" id="cd-skill" style="display:none"></div>
              </div>
              <div class="skill-slot" id="slot-skill2">
                <div class="s-key">C / 2</div>
                <div class="s-name" id="name-skill2">${RO_SKILLS[tree[1]]?.name ?? cls.skill2Name}</div>
                <div class="cd-overlay" id="cd-skill2" style="display:none"></div>
              </div>
              <div class="skill-slot">
                <div class="s-key">R / 3</div>
                <div class="s-name" id="name-skill3">${RO_SKILLS[tree[2]]?.name ?? cls.ultName}</div>
                <div class="cd-overlay" id="cd-ult" style="display:none"></div>
              </div>
              <div class="skill-slot">
                <div class="s-key">V / 4</div>
                <div class="s-name" id="name-skill4">${RO_SKILLS[tree[3]]?.name ?? 'Buff'}</div>
                <div class="cd-overlay" id="cd-skill4" style="display:none"></div>
              </div>
              <button class="skill-slot interactive" id="btn-red-pot" style="cursor:pointer;border-color:rgba(248,113,113,0.45)">
                <div class="s-key">5 &bull; Red</div>
                <div class="s-name" id="hud-red-pot">x${state.redPotions}</div>
              </button>
              <button class="skill-slot interactive" id="btn-blue-pot" style="cursor:pointer;border-color:rgba(56,189,248,0.45)">
                <div class="s-key">6 &bull; Blue</div>
                <div class="s-name" id="hud-blue-pot">x${state.bluePotions}</div>
              </button>
            </div>
          </div>

          <div class="relic-strip" id="hud-relics"></div>
        </div>
      </div>
    `;
    document.getElementById('btn-pause')?.addEventListener('click', () => this.onTogglePause?.());
    document.getElementById('btn-ro-stats')?.addEventListener('click', () => this.ro?.onToggleStats());
    document.getElementById('btn-skills')?.addEventListener('click', () => this.onToggleSkillTree?.());
    document.getElementById('btn-town')?.addEventListener('click', () => {
      if (state.floor === 0) this.ro?.onEnterDungeon();
      else this.ro?.onReturnToTown();
    });
    document.getElementById('btn-red-pot')?.addEventListener('click', () => this.ro?.onUseRedPotion());
    document.getElementById('btn-blue-pot')?.addEventListener('click', () => this.ro?.onUseBluePotion());
  }

  private updatePlayingValues(state: HUDState): void {
    const floorEl = document.getElementById('hud-floor');
    if (floorEl) {
      floorEl.textContent =
        state.floor === 0
          ? 'Oakhaven Town Hub'
          : state.floor === 1
            ? 'Floor 1: Sunken Crypt'
            : state.floor === 2
              ? 'Floor 2: Overgrown Ruins'
              : `Floor ${state.floor}: Obsidian Spire`;
    }

    const statsEl = document.getElementById('hud-stats');
    if (statsEl) statsEl.textContent = `Lv.${state.level} (${state.xp}/${state.xpToNext} XP)  •  Kills: ${state.kills}  •  Gold: ${state.gold}g`;

    const statPtsEl = document.getElementById('hud-stat-pts');
    if (statPtsEl) statPtsEl.textContent = String(state.statPoints);

    const spEl = document.getElementById('hud-sp');
    if (spEl) spEl.textContent = String(state.roSkillPoints);

    const refEl = document.getElementById('hud-refine-tag');
    if (refEl) refEl.textContent = state.weaponRefine > 0 ? `+${state.weaponRefine}` : '';

    const tree = CLASS_SKILL_TREES[state.selectedClass];
    const s1 = document.getElementById('name-skill1');
    const s2 = document.getElementById('name-skill2');
    const s3 = document.getElementById('name-skill3');
    const s4 = document.getElementById('name-skill4');
    if (s1 && tree[0]) s1.textContent = `${RO_SKILLS[tree[0]].name} (${state.roSkills[tree[0]] ?? 0})`;
    if (s2 && tree[1]) s2.textContent = `${RO_SKILLS[tree[1]].name} (${state.roSkills[tree[1]] ?? 0})`;
    if (s3 && tree[2]) s3.textContent = `${RO_SKILLS[tree[2]].name} (${state.roSkills[tree[2]] ?? 0})`;
    if (s4 && tree[3]) s4.textContent = `${RO_SKILLS[tree[3]].name} (${state.roSkills[tree[3]] ?? 0})`;

    const cdSkill2 = document.getElementById('cd-skill2');
    if (cdSkill2) {
      if (state.skill2Cd > 0.05) {
        cdSkill2.style.display = 'flex';
        cdSkill2.textContent = `${state.skill2Cd.toFixed(1)}s`;
      } else {
        cdSkill2.style.display = 'none';
      }
    }

    const cdSkill4 = document.getElementById('cd-skill4');
    if (cdSkill4) {
      if (state.skill4Cd > 0.05) {
        cdSkill4.style.display = 'flex';
        cdSkill4.textContent = `${state.skill4Cd.toFixed(1)}s`;
      } else {
        cdSkill4.style.display = 'none';
      }
    }

    const redEl = document.getElementById('hud-red-pot');
    const blueEl = document.getElementById('hud-blue-pot');
    if (redEl) redEl.textContent = `x${state.redPotions}`;
    if (blueEl) blueEl.textContent = `x${state.bluePotions}`;

    const castWrap = document.getElementById('ro-cast-wrap');
    const castLabel = document.getElementById('ro-cast-label');
    const castFill = document.getElementById('ro-cast-fill');
    if (castWrap && castLabel && castFill) {
      if (state.castingSkillName) {
        castWrap.style.display = 'block';
        castLabel.textContent = `Chanting ${state.castingSkillName}...`;
        castFill.style.width = `${Math.round(state.castProgress * 100)}%`;
      } else {
        castWrap.style.display = 'none';
      }
    }

    const hpText = document.getElementById('hud-hp-text');
    const hpFill = document.getElementById('hud-hp-fill');
    if (hpText) hpText.textContent = `${Math.ceil(state.hp)} / ${state.maxHp}`;
    if (hpFill) hpFill.style.width = `${Math.max(0, (state.hp / state.maxHp) * 100)}%`;

    const spText = document.getElementById('hud-sp-text');
    const spFill = document.getElementById('hud-sp-fill');
    if (spText) spText.textContent = `${Math.floor(state.sp)} / ${state.maxSp}`;
    if (spFill) spFill.style.width = `${Math.max(0, (state.sp / Math.max(1, state.maxSp)) * 100)}%`;

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

  public refreshSkillTree(state: HUDState): void {
    this.renderSkillTree(state);
  }

  private renderSkillTree(state: HUDState): void {
    const cls = HERO_CLASSES[state.selectedClass];
    const tree = CLASS_SKILL_TREES[state.selectedClass];
    this.root.innerHTML = `
      <div class="modal-backdrop interactive">
        <div class="modal-title">${cls.name} — Ragnarok Skill Tree (Alt+S / K)</div>
        <div style="font-size:14px;color:var(--muted);margin-bottom:10px">
          Base Lv.<strong style="color:#fff">${state.level}</strong> &bull; Available Skill Points:
          <strong style="color:#fde047">${state.roSkillPoints} SP</strong>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;max-width:860px;width:92%;margin:8px 0 18px">
          ${tree
            .map((id) => {
              const def = RO_SKILLS[id];
              const lv = state.roSkills[id] ?? 0;
              const canUp = state.roSkillPoints > 0 && lv < def.maxLevel;
              const effLv = Math.max(1, lv);
              const baseCast = def.baseCastTime(effLv);
              const castStr =
                baseCast > 0
                  ? `Cast: ${(baseCast * state.roDerived.castTimeMult).toFixed(2)}s`
                  : 'Instant';
              return `
                <div style="background:rgba(16,14,24,0.92);border:1px solid ${lv > 0 ? 'rgba(52,211,153,0.55)' : 'rgba(255,255,255,0.14)'};border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <strong style="color:#fff;font-size:15px">${def.name}</strong>
                    <span style="color:#fde047;font-size:13px;font-weight:700">Lv. ${lv} / ${def.maxLevel}</span>
                  </div>
                  <div style="font-size:12px;color:var(--muted);line-height:1.4">${def.desc(effLv)}</div>
                  <div style="font-size:11px;color:#7dd3fc">${castStr} &bull; SP: ${def.spCost(effLv)} &bull; CD: ${def.cooldown(effLv)}s</div>
                  <button class="start-btn ro-skill-up" data-skill="${id}" ${canUp ? '' : 'disabled'}
                    style="padding:7px 12px;font-size:12px;opacity:${canUp ? '1' : '0.45'};cursor:${canUp ? 'pointer' : 'default'}">
                    ${lv >= def.maxLevel ? 'MAX LEVEL' : '+ Level Up (1 SP)'}
                  </button>
                </div>
              `;
            })
            .join('')}
        </div>
        <button class="start-btn" id="btn-close-skills" style="padding:11px 28px;font-size:14px">Close ([K] / ESC)</button>
      </div>
    `;

    this.root.querySelectorAll('.ro-skill-up').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.skill as ROSkillId;
        this.ro?.onUpgradeROSkill(id);
      });
    });
    document.getElementById('btn-close-skills')?.addEventListener('click', () => this.onToggleSkillTree?.());
  }

  private renderStatsWindow(state: HUDState): void {
    const d = state.roDerived;
    const b = state.roBase;
    const statsList: Array<{ key: StatKey; label: string; val: number; desc: string }> = [
      { key: 'str', label: 'STR', val: b.str, desc: 'Melee ATK & Carry' },
      { key: 'agi', label: 'AGI', val: b.agi, desc: 'ASPD & FLEE' },
      { key: 'vit', label: 'VIT', val: b.vit, desc: 'Soft DEF, MaxHP & Potions' },
      { key: 'int', label: 'INT', val: b.int, desc: 'MATK, MaxSP & SP Regen' },
      { key: 'dex', label: 'DEX', val: b.dex, desc: 'HIT & Cast Time (-100% @ 150)' },
      { key: 'luk', label: 'LUK', val: b.luk, desc: 'CRIT & Perfect Dodge' },
    ];
    const castPct = Math.round(d.castTimeMult * 100);
    this.root.innerHTML = `
      <div class="modal-backdrop interactive">
        <div class="modal-title">Character Status (Alt+A / U)</div>
        <div style="font-size:14px;color:var(--muted);margin-bottom:10px">
          Stat Points Remaining: <strong style="color:#7dd3fc">${state.statPoints}</strong>
          &bull; Weapon Refine: <strong style="color:#fde047">+${state.weaponRefine}</strong>
          &bull; Armor Refine: <strong style="color:#34d399">+${state.armorRefine}</strong>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:760px;width:92%;margin:8px 0 18px">
          <div style="background:rgba(16,14,24,0.92);border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px">
            <div style="font-size:12px;color:#7dd3fc;font-weight:700;text-transform:uppercase">Base Stats</div>
            ${statsList
              .map((s) => {
                const cost = Math.floor((s.val - 1) / 10) + 2;
                const canAdd = state.statPoints >= cost && s.val < 99;
                return `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
                <div>
                  <strong style="color:#fff">${s.label}</strong>
                  <span style="font-size:11px;color:var(--muted);margin-left:6px">${s.desc}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <strong style="color:#fde047">${s.val}</strong>
                  <button class="class-tab ro-stat-btn" data-stat="${s.key}" ${canAdd ? '' : 'disabled'}
                    style="padding:3px 9px;font-size:12px;opacity:${canAdd ? '1' : '0.4'};cursor:${canAdd ? 'pointer' : 'default'}">+ (${cost})</button>
                </div>
              </div>
            `;
              })
              .join('')}
          </div>
          <div style="background:rgba(16,14,24,0.92);border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:7px;font-size:13px">
            <div style="font-size:12px;color:#fde047;font-weight:700;text-transform:uppercase">Derived Combat Stats</div>
            <div style="display:flex;justify-content:space-between"><span>ATK</span><strong>${d.atkMin} ~ ${d.atkMax}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>MATK</span><strong>${d.matkMin} ~ ${d.matkMax}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>DEF (Hard + Soft)</span><strong>${d.hardDef} + ${d.softDef}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>MDEF</span><strong>${d.mdef}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>HIT / FLEE</span><strong>${d.hit} / ${d.flee}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>CRIT / Perfect Dodge</span><strong>${Math.round(d.critChance * 100)}% / ${Math.round(d.perfectDodge * 100)}%</strong></div>
            <div style="display:flex;justify-content:space-between"><span>ASPD</span><strong>${Math.round(d.aspd)}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>Cast Time</span><strong style="color:${castPct === 0 ? '#34d399' : '#fff'}">${castPct}% ${castPct === 0 ? '(INSTANT!)' : ''}</strong></div>
          </div>
        </div>
        <button class="start-btn" id="btn-close-stats" style="padding:11px 28px;font-size:14px">Close ([U] / ESC)</button>
      </div>
    `;
    this.root.querySelectorAll('.ro-stat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.ro?.onAllocateStat((btn as HTMLElement).dataset.stat as StatKey);
      });
    });
    document.getElementById('btn-close-stats')?.addEventListener('click', () => this.ro?.onCloseModal());
  }

  private renderNpcModal(state: HUDState): void {
    const npc = state.activeNpc;
    let title = 'Oakhaven NPC';
    let body = '';
    if (npc === 'blacksmith') {
      title = '⚒ Runesmith Torgar — Relic Refining';
      const wCost = (state.weaponRefine + 1) * 60;
      const aCost = (state.armorRefine + 1) * 50;
      body = `
        <div style="font-size:13px;color:var(--muted)">Your Gold: <strong style="color:#fde047">${state.gold}g</strong></div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center">
          <div style="background:rgba(16,14,24,0.92);border:1px solid rgba(249,115,22,0.45);border-radius:12px;padding:16px;width:240px">
            <strong style="color:#fdba74">Weapon Refine (+${state.weaponRefine}/+10)</strong>
            <p style="font-size:12px;color:var(--muted);margin:8px 0">+5 ATK & +5 MATK per level. Glowing aura at +7 and +10!</p>
            <button class="start-btn" id="btn-ref-w" ${state.weaponRefine >= 10 || state.gold < wCost ? 'disabled' : ''} style="width:100%;padding:9px;font-size:12px">
              ${state.weaponRefine >= 10 ? 'MAX +10' : `Refine (${wCost}g)`}
            </button>
          </div>
          <div style="background:rgba(16,14,24,0.92);border:1px solid rgba(56,189,248,0.45);border-radius:12px;padding:16px;width:240px">
            <strong style="color:#7dd3fc">Armor Refine (+${state.armorRefine}/+10)</strong>
            <p style="font-size:12px;color:var(--muted);margin:8px 0">+4 Hard DEF per level for near-zero VIT tanking!</p>
            <button class="start-btn" id="btn-ref-a" ${state.armorRefine >= 10 || state.gold < aCost ? 'disabled' : ''} style="width:100%;padding:9px;font-size:12px">
              ${state.armorRefine >= 10 ? 'MAX +10' : `Refine (${aCost}g)`}
            </button>
          </div>
        </div>
      `;
    } else if (npc === 'kafra') {
      title = '📦 Vault Keeper Pip — Monster Sigils';
      body = `
        <div style="font-size:13px;color:var(--muted)">Equipped Sigil: <strong style="color:#7dd3fc">${state.equippedCard?.name ?? 'None'}</strong></div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(200px,240px));gap:12px">
          ${state.kafraStorage
            .map((c) => {
              const eq = state.equippedCard?.id === c.id;
              return `
              <button class="relic-card kafra-card-btn" data-id="${c.id}" style="text-align:left;padding:12px;border-color:${eq ? '#34d399' : 'rgba(255,255,255,0.16)'}">
                <span class="r-tag">${eq ? 'EQUIPPED' : c.icon}</span>
                <span class="r-name" style="font-size:14px">${c.name}</span>
                <span class="r-desc" style="font-size:12px">${c.desc}</span>
              </button>
            `;
            })
            .join('')}
        </div>
      `;
    } else if (npc === 'hypnotist') {
      title = '✦ Soul Weaver Vaelen — Build Reset';
      body = `
        <p style="font-size:13px;color:var(--muted);max-width:440px;text-align:center">Unbind your soul in Oakhaven Town to freely test DEX Instant-Cast, VIT Tanking, or AGI/LUK Crit builds!</p>
        <div style="display:flex;gap:12px">
          <button class="start-btn" id="btn-reset-stats" style="padding:10px 18px;font-size:13px">Reset Base Stats</button>
          <button class="start-btn" id="btn-reset-skills" style="padding:10px 18px;font-size:13px">Reset Skills</button>
        </div>
      `;
    } else if (npc === 'alchemist') {
      title = '⚗ Apothecary Sera — Elixir Shop';
      body = `
        <div style="font-size:13px;color:var(--muted)">Your Gold: <strong style="color:#fde047">${state.gold}g</strong></div>
        <div style="display:flex;gap:14px">
          <button class="start-btn" id="btn-buy-red" ${state.gold < 25 ? 'disabled' : ''} style="padding:12px 18px;font-size:13px">Buy Crimson Elixir (25g) [Owned: ${state.redPotions}]</button>
          <button class="start-btn" id="btn-buy-blue" ${state.gold < 40 ? 'disabled' : ''} style="padding:12px 18px;font-size:13px">Buy Azure Elixir (40g) [Owned: ${state.bluePotions}]</button>
        </div>
      `;
    }

    this.root.innerHTML = `
      <div class="modal-backdrop interactive">
        <div class="modal-title">${title}</div>
        ${body}
        <button class="class-tab" id="btn-close-npc" style="padding:10px 24px;margin-top:8px">Close (ESC)</button>
      </div>
    `;
    document.getElementById('btn-ref-w')?.addEventListener('click', () => this.ro?.onRefineWeapon());
    document.getElementById('btn-ref-a')?.addEventListener('click', () => this.ro?.onRefineArmor());
    document.getElementById('btn-reset-stats')?.addEventListener('click', () => this.ro?.onResetStats());
    document.getElementById('btn-reset-skills')?.addEventListener('click', () => this.ro?.onResetSkills());
    document.getElementById('btn-buy-red')?.addEventListener('click', () => this.ro?.onBuyPotion('red'));
    document.getElementById('btn-buy-blue')?.addEventListener('click', () => this.ro?.onBuyPotion('blue'));
    this.root.querySelectorAll('.kafra-card-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        const card = state.kafraStorage.find((c) => c.id === id) ?? null;
        this.ro?.onEquipCard(state.equippedCard?.id === id ? null : card);
      });
    });
    document.getElementById('btn-close-npc')?.addEventListener('click', () => this.ro?.onCloseModal());
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
