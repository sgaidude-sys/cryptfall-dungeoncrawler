import * as THREE from 'three';

import { AssetManager } from '../assets/AssetManager';
import { SoundEngine } from '../audio/SoundEngine';
import { DungeonFloorBuilder, Interactable } from '../game/DungeonGenerator';
import { ABYSSAL_WARDEN, Enemy, EnemyManager } from '../game/EnemyManager';
import { PlayerController } from '../game/PlayerController';
import { HERO_CLASSES } from '../game/classes';
import { pickRandomRelics } from '../game/relics';
import { HUDManager, MiraPurchase, floorName } from '../ui/HUD';
import { AudioControls } from '../ui/AudioControls';
import { GamePhase, HeroClassId, HUDState, KafraItem, RelicDef, RoomData, SkillNodeId, TownNpcId } from '../types';
import type { StatKey } from '../game/RagnarokStatsSystem';
import type { ROSkillId } from '../game/SkillSystem';
import { VFXManager } from './VFXManager';
import { AnimatorHelper } from './AnimatorHelper';
import { CutsceneManager } from './CutsceneManager';
import { CutsceneDirector } from '../systems/CutsceneDirector';
import { QuestAndNarrativeSystem, StoryFlag } from '../systems/QuestAndNarrativeSystem';
import { DialogueOption, TownHubSystem } from '../systems/TownHubSystem';
import { ECHO_SHARDS, EXTRACTABLE_CARDS, GUARDIAN_CARDS, STORY_SCRIPTS, echoScript } from '../data/StoryCampaign';
import { PostFX } from '../graphics/PostFX';
import { BiomeAtmosphere, BiomeId, biomeForFloor } from '../graphics/BiomeAtmosphere';
import { MaterialFX } from '../graphics/MaterialFX';
import { CursedBrand } from '../graphics/CursedBrand';

const TOWN_ACTOR_IDS: Record<TownNpcId, string> = {
  blacksmith: 'garrett',
  alchemist: 'mira',
  kafra: 'pip',
  hypnotist: 'vaelen',
  guildmaster: 'aldric',
};

const JOB_TITLES: Record<HeroClassId, string> = {
  knight: 'Spire Paladin',
  barbarian: 'Abyss Breaker',
  rogue: 'Shadow Warden',
  mage: 'Ledger Sage',
  ranger: 'Spire Sentinel',
};

const BASE_FOV = 48;

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private post: PostFX;
  private atmosphere: BiomeAtmosphere;

  private assets = new AssetManager();
  private sound = new SoundEngine();
  private audioUi: AudioControls;
  private vfx: VFXManager;
  private dungeon: DungeonFloorBuilder;
  private enemies: EnemyManager;
  private hud: HUDManager;
  private cutscenes = new CutsceneManager();
  private director: CutsceneDirector;
  private story = new QuestAndNarrativeSystem();
  private town: TownHubSystem;
  private brand = new CursedBrand();

  private player: PlayerController | null = null;
  private previewModel: THREE.Group | null = null;
  private previewAnim: AnimatorHelper | null = null;

  private phase: GamePhase = 'loading';
  private selectedClass: HeroClassId = 'knight';
  private floor = 0;
  private activeNpc: TownNpcId | null = null;
  private npcNode = 'start';
  private activeRoom: RoomData | null = null;
  private bossRoomCenter = new THREE.Vector3();
  private bannerText: string | null = null;
  private bannerTimer = 0;
  private storyQueue: Array<{ t: number; fn: () => void }> = [];
  private holdRoomClear = false;
  private refining = false;
  private brandLevel = 0;

  // Input state
  private keys = new Set<string>();
  private mouseNdc = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private aimWorld = new THREE.Vector3();
  private attackHeld = false;
  private skillQueued = false;
  private skill2Queued = false;
  private ultQueued = false;
  private skill4Queued = false;
  private dodgeQueued = false;
  private interactQueued = false;
  private lastTime = performance.now();
  private camRight = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.2, 140);
    this.camera.position.set(0, 14, 12);

    // Post-processing (bloom + grade + ACES output) and the biome-driven light rig / fog / particles
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.atmosphere = new BiomeAtmosphere(this.scene, this.post);

    this.vfx = new VFXManager(this.scene);
    this.vfx.onImpactKick = (amt) => this.post.kickAberration(amt * 0.02);
    this.dungeon = new DungeonFloorBuilder(this.assets);
    this.scene.add(this.dungeon.group);
    this.enemies = new EnemyManager(this.scene, this.assets, this.vfx, this.sound);
    this.enemies.onBossDefeated = (e) => this.onBossDefeated(e);
    this.director = new CutsceneDirector(this.scene, this.camera, this.assets, this.vfx, this.sound);
    this.director.hooks = {
      flash: (color, amt) => this.post.flash(color, amt * 0.35),
      setBiome: (id) => this.atmosphere.set(id as BiomeId),
      setBrand: (level) => this.setBrand(level),
    };
    this.town = new TownHubSystem(this.story);
    this.audioUi = new AudioControls(this.sound);
    // Keep the letterboxed frame clean during cinematics
    this.director.onActiveChange = (active) => this.audioUi.setVisible(!active);

    this.hud = new HUDManager(
      (id) => this.selectPreviewClass(id),
      () => this.startRun(),
      (relic) => this.applyRelicChoice(relic),
      () => this.returnToTitle(),
      () => this.sound.playUIHover(),
      () => {
        this.sound.unlock();
        this.sound.playUISelect();
      },
      () => this.sound.playUIPopup(),
      () => this.togglePause(),
      () => this.startRun(),
      () => {
        this.phase = 'title';
        this.selectPreviewClass(this.selectedClass);
      },
      () => {
        this.phase = 'menu';
        if (this.previewModel) {
          this.scene.remove(this.previewModel);
          this.previewModel = null;
        }
      },
      () => {
        this.sound.unlock();
        return this.sound.toggleMute();
      },
      () => this.toggleSkillTree(),
      (id) => this.unlockSkillNode(id)
    );

    this.hud.setROCallbacks({
      onToggleStats: () => this.toggleStatsWindow(),
      onAllocateStat: (stat: StatKey) => {
        if (this.player?.roStats.allocateStat(stat)) {
          this.player.getDerived();
          this.sound.playUISelect();
        }
      },
      onUpgradeROSkill: (id: ROSkillId) => {
        if (this.player?.roSkills.upgradeSkill(id)) {
          this.sound.playUISelect();
        }
      },
      onRefineWeapon: () => this.refine('weapon'),
      onRefineArmor: () => this.refine('armor'),
      onResetStats: () => {
        if (!this.player) return;
        this.player.roStats.resetStats();
        this.player.getDerived();
        this.sound.playHeal();
        this.showBanner('Stats unbound by Vaelen');
      },
      onResetSkills: () => {
        if (!this.player) return;
        this.player.roSkills.resetSkills();
        this.sound.playHeal();
        this.showBanner('Skills unbound by Vaelen');
      },
      onBuyPotion: (kind: 'red' | 'blue') => {
        if (!this.player) return;
        const cost = kind === 'red' ? 25 : 40;
        if (this.player.gold >= cost) {
          this.player.gold -= cost;
          if (kind === 'red') this.player.redPotions++;
          else this.player.bluePotions++;
          this.sound.playCoinClink(2);
        }
      },
      onEquipCard: (card: KafraItem | null) => {
        this.player?.equipKafraCard(card);
        this.sound.playChestChime();
      },
      onSocketCard: (card: KafraItem | null) => {
        if (!this.player) return;
        if (card && this.player.equippedCard?.id === card.id) this.player.equipKafraCard(null);
        this.player.equipSocketCard(card);
        this.sound.playChestChime();
      },
      onMiraBuy: (kind) => this.miraPurchase(kind),
      onCloseModal: () => this.closeModal(),
      onUseRedPotion: () => this.player?.useRedPotion(),
      onUseBluePotion: () => this.player?.useBluePotion(),
      onEnterDungeon: () => {
        // Top-bar shortcut: open Aldric's gate menu
        if (this.floor === 0) this.openNpc('guildmaster', 'gate');
      },
      onReturnToTown: () => {
        this.activeNpc = null;
        this.phase = 'playing';
        this.buildFloor(0);
        this.showBanner('Oakhaven');
      },
      onDialogueChoice: (opt) => this.handleDialogue(opt),
      onToggleJournal: () => this.toggleJournal(),
      onReplayScene: (id) => this.replayScene(id),
      onNewStory: () => {
        this.story.reset();
        this.director.resetFlags();
        this.startRun();
      },
    });

    this.bindInputs();
  }

  public async init(): Promise<void> {
    this.hud.showLoading(0, 'Preparing dungeon assets...');
    await this.assets.preloadAll((pct, label) => this.hud.showLoading(pct, label));
    this.phase = 'menu';
    this.dungeon.clear();
    this.dungeon.generate(1);
    this.atmosphere.set('menu', true);
    this.sound.setMusicMode('town');
    this.loop(performance.now());
  }

  // ───────────────────────────── Run / floors ─────────────────────────────

  private setupTitleShowcase(): void {
    this.dungeon.clear();
    this.enemies.clear();
    this.vfx.clearAll();
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    this.dungeon.generate(1);
    this.atmosphere.set('menu');
    this.sound.setMusicMode('town');
    this.selectPreviewClass(this.selectedClass);
  }

  private selectPreviewClass(id: HeroClassId): void {
    this.selectedClass = id;
    if (this.previewModel) {
      this.scene.remove(this.previewModel);
      MaterialFX.release(this.previewModel);
      this.previewModel = null;
    }
    const cls = HERO_CLASSES[id];
    const model = this.assets.cloneCharacter(cls.modelFile);
    if (cls.rightWeapon) this.assets.attachToHand(model, cls.rightWeapon, 'right');
    if (cls.leftWeapon) this.assets.attachToHand(model, cls.leftWeapon, 'left');
    model.position.set(1.8, 0, 0);
    model.scale.setScalar(1.3);
    MaterialFX.apply(model, parseInt(cls.accentHex.slice(1), 16), 0.7, 2.4);
    this.scene.add(model);
    this.previewModel = model;
    this.previewAnim = new AnimatorHelper(model, this.assets);
    this.previewAnim.playLoop('Idle_A', 0.1);
  }

  private togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.attackHeld = false;
      this.sound.playUIPopup();
    } else if (this.phase === 'paused' || this.phase === 'skill_tree') {
      this.phase = 'playing';
      this.sound.playUISelect();
    }
  }

  private toggleSkillTree(): void {
    if (this.phase === 'playing') {
      this.phase = 'skill_tree';
      this.attackHeld = false;
      this.sound.playUIPopup();
    } else if (this.phase === 'skill_tree') {
      this.phase = 'playing';
      this.sound.playUISelect();
    }
  }

  private toggleJournal(): void {
    if (this.phase === 'playing' && !this.director.active) {
      this.phase = 'journal';
      this.attackHeld = false;
      this.sound.playUIPopup();
    } else if (this.phase === 'journal') {
      this.phase = 'playing';
      this.sound.playUISelect();
    }
  }

  private unlockSkillNode(id: SkillNodeId): void {
    if (!this.player) return;
    if (this.player.unlockSkill(id)) {
      this.hud.refreshSkillTree(this.buildHudState(null));
    }
  }

  private startRun(): void {
    this.sound.unlock();
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    if (this.previewModel) {
      this.scene.remove(this.previewModel);
      MaterialFX.release(this.previewModel);
      this.previewModel = null;
      this.previewAnim = null;
    }
    // A brand-new story (no prologue seen) resets the Ledger; otherwise the story persists between lives.
    const freshStory = !this.story.has('prologue_done');
    if (freshStory) {
      this.story.reset();
      this.director.resetFlags();
    }
    this.storyQueue = [];
    this.holdRoomClear = false;
    this.floor = 0;
    this.player = new PlayerController(this.selectedClass, this.scene, this.assets, this.vfx, this.sound);
    this.player.gold = 250;
    this.player.onLevelUp = (lvl) => {
      this.showBanner(`LEVEL ${lvl}!  [U] Stats  ·  [K] Skills`);
    };
    this.brand.attach(this.player.mesh);
    this.applyPersistentUnlocks(this.player);
    this.director.registerActor('player', this.player.mesh, this.player.anim);
    this.phase = 'playing';
    this.player.anim.playOneShot('Spawn_Ground', 0.05, 1.0, 1.1);
    this.hud.clearForCutscene();

    if (freshStory) {
      this.buildFloor(0, true);
      this.setBrand(0);
      void this.director.playScript(STORY_SCRIPTS.prologue_debt, new THREE.Vector3(), () => {
        this.story.set('prologue_done');
        this.setBrand(1);
        this.refreshTown();
        this.showBanner('Talk to Warden Aldric [!] to descend  ·  [Q] Journal');
      });
    } else {
      this.buildFloor(0);
      this.showBanner('The Ledger is still open. Return to the Spire.');
    }
  }

  /** Story rewards persist across deaths (a new body, the same Ledger). */
  private applyPersistentUnlocks(p: PlayerController): void {
    const s = this.story;
    this.setBrand(this.storyBrandLevel());
    if (s.has('garrett_gift_claimed')) p.grantAtonementBlade();
    if (s.has('act2_pip_confessed')) p.goldMult = 1.25;
    if (s.has('job_advanced')) this.grantJobAdvancement(p, true);
    if (s.has('act1_malakor_defeated')) this.addCard(p, GUARDIAN_CARDS.malakor);
    if (s.has('act2_lyra_defeated')) this.addCard(p, GUARDIAN_CARDS.lyra);
    if (s.has('act3_vance_defeated')) this.addCard(p, GUARDIAN_CARDS.vance);
    if (s.has('act3_warden_defeated')) this.addCard(p, GUARDIAN_CARDS.warden);
  }

  private storyBrandLevel(): number {
    const s = this.story;
    if (s.resolved) return 0;
    if (s.has('act3_entered')) return 4;
    if (s.has('act2_mirror_seen')) return 3;
    if (s.has('act2_entered')) return 2;
    if (s.has('prologue_done')) return 1;
    return 0;
  }

  private setBrand(level: number): void {
    this.brandLevel = level;
    this.brand.setLevel(level);
  }

  private returnToTitle(): void {
    this.phase = 'menu';
    this.setupTitleShowcase();
    if (this.previewModel) {
      this.scene.remove(this.previewModel);
      this.previewModel = null;
    }
  }

  private registerTownActors(): void {
    for (const [npc, id] of Object.entries(TOWN_ACTOR_IDS) as Array<[TownNpcId, string]>) {
      const a = this.dungeon.npcActors.get(npc);
      if (a) this.director.registerActor(id, a.mesh, a.anim);
      else this.director.unregisterActor(id);
    }
  }

  /** Rebuild Oakhaven in place (markers, chains, dawn) without moving the player. */
  private refreshTown(): void {
    if (this.floor !== 0) return;
    this.dungeon.generate(0, this.town.buildView());
    this.registerTownActors();
    this.atmosphere.set(biomeForFloor(0, this.story.resolved));
  }

  private buildFloor(floorNum: number, suppressScenes = false): void {
    this.floor = floorNum;
    this.enemies.clear();
    this.storyQueue = [];
    this.holdRoomClear = false;
    this.dungeon.generate(floorNum, floorNum === 0 ? this.town.buildView() : undefined);
    this.activeRoom = null;
    this.atmosphere.set(biomeForFloor(floorNum, this.story.resolved));
    if (this.player) this.player.pos.set(0, 0, 0);
    this.sound.setCombatIntensity(0.1);
    this.sound.setMusicMode(floorNum === 0 ? 'town' : 'explore');

    if (floorNum === 0) {
      this.registerTownActors();
      if (!suppressScenes) this.playNextTownScene();
      return;
    }
    for (const id of Object.values(TOWN_ACTOR_IDS)) this.director.unregisterActor(id);

    this.story.recordFloor(floorNum);
    this.placeStoryObjects(floorNum);

    if (floorNum === 1 && !this.story.has('act1_entered')) {
      this.story.set('act1_entered');
      void this.director.playScript(STORY_SCRIPTS.act1_archives, new THREE.Vector3());
    } else if (floorNum === 2 && !this.story.has('act2_entered')) {
      this.story.set('act2_entered');
      void this.director.playScript(STORY_SCRIPTS.act2_ruins, new THREE.Vector3());
    } else if (floorNum === 3 && !this.story.has('act3_entered')) {
      this.story.set('act3_entered');
      void this.director.playScript(STORY_SCRIPTS.act3_spire, new THREE.Vector3());
    }
  }

  /** Echo Shards in side rooms, plus the Obsidian Mirror at the heart of Floor 2. */
  private placeStoryObjects(floorNum: number): void {
    const candidates = this.dungeon.rooms.filter((r) => r.type !== 'start' && r.type !== 'boss');
    if (candidates.length === 0) return;
    let mirrorRoom: RoomData | null = null;
    if (floorNum === 2 && !this.story.has('act2_mirror_seen')) {
      mirrorRoom = candidates[Math.floor(candidates.length / 2)];
      this.dungeon.spawnObsidianMirror(mirrorRoom.worldX, mirrorRoom.worldZ - 2);
    }
    const shardRooms = candidates.filter((r) => r !== mirrorRoom);
    const pool = shardRooms.length > 0 ? shardRooms : candidates;
    // Spread shards across distinct rooms (farthest from the entrance first); share a room only if we must
    const ordered = [...pool].sort((a, b) => Math.hypot(b.worldX, b.worldZ) - Math.hypot(a.worldX, a.worldZ));
    const used: Array<{ x: number; z: number }> = [];
    const lanes = [0, 5, -5];
    this.story.uncollectedEchoesForFloor(floorNum).forEach((def, i) => {
      const room = ordered[i % ordered.length];
      let x = room.worldX;
      const z = room.worldZ + 5;
      for (const lane of lanes) {
        x = room.worldX + lane;
        if (!used.some((u) => Math.hypot(u.x - x, u.z - z) < 2)) break;
      }
      used.push({ x, z });
      this.dungeon.spawnEchoShard(x, z, def.id, def.color, def.title);
    });
  }

  /** Auto-play the first outstanding town confrontation on arrival. */
  private playNextTownScene(): void {
    const next = this.story.pendingTownScenes()[0];
    if (!next || this.director.active) return;
    this.playTownScene(next.sceneId, next.setsFlag);
  }

  private playTownScene(sceneId: string, flag: StoryFlag): void {
    const script = STORY_SCRIPTS[sceneId];
    if (!script) return;
    this.phase = 'playing';
    this.activeNpc = null;
    void this.director.playScript(
      script,
      new THREE.Vector3(),
      () => {
        this.story.set(flag);
        this.onTownSceneResolved(flag);
        this.refreshTown();
        const more = this.story.pendingTownScenes().length;
        if (more > 0) this.queueBanner('Others in Oakhaven are hiding something — look for the [!] markers', 3.0);
      },
      true
    );
  }

  private onTownSceneResolved(flag: StoryFlag): void {
    const p = this.player;
    if (!p) return;
    if (flag === 'act1_garrett_confessed') {
      this.queueBanner('Masterwork Refinement unlocked — claim Garrett’s Atonement Blade [★]', 3.2);
    } else if (flag === 'act2_mira_exposed') {
      this.queueBanner('Mira’s Lab unlocked: Converters · Awakening Potions · Card Extraction', 3.2);
    } else if (flag === 'act2_vaelen_confessed') {
      this.queueBanner('Job Advancement unlocked at Vaelen’s loom [★]', 3.2);
    } else if (flag === 'act2_pip_confessed') {
      p.goldMult = 1.25;
      this.sound.playCoinClink(6);
      this.queueBanner('Pip’s Soul-Gold Ledger: +25% Zeny from monsters', 3.2);
    }
  }

  private queueBanner(text: string, delay: number): void {
    this.storyQueue.push({ t: delay * 0.3, fn: () => this.showBanner(text) });
  }

  // ───────────────────────────── Boss story hooks ─────────────────────────────

  private onBossDefeated(e: Enemy): void {
    const p = this.player;
    if (!p) return;
    const origin = this.bossRoomCenter.clone();
    const queue = (delay: number, fn: () => void) => this.storyQueue.push({ t: delay, fn });

    if (e.bossId === 'malakor') {
      this.story.set('act1_malakor_defeated');
      this.addCard(p, GUARDIAN_CARDS.malakor);
      queue(1.0, () => void this.director.playScript(STORY_SCRIPTS.act1_malakor_falls, origin));
    } else if (e.bossId === 'lyra') {
      this.story.set('act2_lyra_defeated');
      this.addCard(p, GUARDIAN_CARDS.lyra);
      queue(1.0, () => void this.director.playScript(STORY_SCRIPTS.act2_lyra_falls, origin));
    } else if (e.bossId === 'vance') {
      this.story.set('act3_vance_defeated');
      this.addCard(p, GUARDIAN_CARDS.vance);
      // Phase 2: hold the arena shut, then the Warden collects Vance's soul.
      this.holdRoomClear = true;
      const bossPos = e.pos.clone();
      queue(0.9, () => {
        const scale = 1 + (this.floor - 1) * 0.6;
        const warden = this.enemies.spawnEnemy(ABYSSAL_WARDEN.kind, bossPos.x, bossPos.z, scale, ABYSSAL_WARDEN);
        warden.mesh.visible = false;
        this.holdRoomClear = false;
        void this.director.playScript(STORY_SCRIPTS.act3_warden_betrayal, origin, () => {
          warden.mesh.visible = true;
          warden.anim?.playOneShot(warden.anims.attack, 0.06, 1.0, 0.6);
          this.vfx.spawnRing(warden.pos, 7, 0xa855f7, 0.6);
          this.vfx.addCameraShake(new THREE.Vector3(0, 0, 1), 0.5);
          this.sound.setMusicMode('boss');
          this.showBanner('The Abyssal Warden rises!');
        }, true);
      });
    } else if (e.bossId === 'warden') {
      this.story.set('act3_warden_defeated');
      this.addCard(p, GUARDIAN_CARDS.warden);
      queue(1.1, () =>
        void this.director.playScript(STORY_SCRIPTS.act3_ledger_shattered, origin, () => {
          this.story.set('act3_resolved');
          this.setBrand(0);
          this.buildFloor(0, true);
          void this.director.playScript(STORY_SCRIPTS.act3_sunrise, new THREE.Vector3(), () => {
            this.refreshTown();
            this.showBanner('Endless Abyss unlocked — speak to Warden Aldric to descend (Floors 4–99)');
          });
        })
      );
    } else if (e.bossId === 'mvp') {
      p.gold += Math.round(250 * p.goldMult);
      this.sound.playCoinClink(6);
      if (Math.random() < 0.4) {
        const card = EXTRACTABLE_CARDS.find((c) => !p.kafraStorage.some((k) => k.id === c.id));
        if (card) {
          this.addCard(p, card);
          queue(0.6, () => this.showBanner(`MVP Card drop: ${card.name}!`));
        }
      }
    }
  }

  private addCard(p: PlayerController, card: KafraItem): void {
    if (!p.kafraStorage.some((k) => k.id === card.id)) {
      p.kafraStorage.push({ ...card });
      this.sound.playChestChime();
    }
  }

  // ───────────────────────────── Town / NPCs ─────────────────────────────

  private openNpc(npc: TownNpcId, node = 'start'): void {
    this.activeNpc = npc;
    this.npcNode = node;
    this.phase = 'npc_modal';
    this.attackHeld = false;
    this.sound.playUIPopup();
  }

  private closeModal(): void {
    this.activeNpc = null;
    this.npcNode = 'start';
    if (this.phase === 'npc_modal' || this.phase === 'stats_window' || this.phase === 'skill_tree' || this.phase === 'journal') {
      this.phase = 'playing';
    }
  }

  private handleDialogue(opt: DialogueOption): void {
    const npc = this.activeNpc;
    const p = this.player;
    if (!npc || !p) return;
    this.sound.playUISelect();
    if (opt.next) {
      this.npcNode = opt.next;
      return;
    }
    switch (opt.action) {
      case 'close':
        this.closeModal();
        return;
      case 'confront': {
        const pending = this.story.pendingSceneFor(npc);
        this.closeModal();
        if (pending) this.playTownScene(pending.sceneId, pending.setsFlag);
        return;
      }
      case 'claim_blade':
        p.grantAtonementBlade();
        this.story.set('garrett_gift_claimed');
        this.sound.playRefine(true, 7);
        this.vfx.spawnConsecratedPillar(p.pos, 0xf97316, 1.6, 5);
        this.showBanner('Received: Atonement Blade [1 Socket] (+12 ATK / +10 MATK)');
        this.npcNode = 'start';
        this.refreshTown();
        return;
      case 'job_advance':
        if (p.level < 8) return;
        this.grantJobAdvancement(p, false);
        this.story.set('job_advanced');
        this.closeModal();
        this.refreshTown();
        return;
      case 'descend':
        this.closeModal();
        this.phase = 'playing';
        this.buildFloor(opt.floor ?? this.story.nextStoryFloor());
        this.showBanner(floorName(this.floor));
        return;
    }
  }

  private grantJobAdvancement(p: PlayerController, silent: boolean): void {
    if (p.jobTitle) return;
    p.jobTitle = JOB_TITLES[p.def.id];
    p.roStats.statPoints += 12;
    p.roSkills.skillPoints += 4;
    (Object.keys(p.roStats.bonus) as StatKey[]).forEach((k) => (p.roStats.bonus[k] += 3));
    p.getDerived();
    if (!silent) {
      this.sound.playJobChange();
      this.post.flash(0xfff1b8, 0.6);
      this.vfx.spawnConsecratedPillar(p.pos, 0xfacc15, 2.2, 8);
      this.vfx.spawnBrackeysGroundEffect(p.pos, 'magic_rune', 0xfacc15, 5.5, 1.4, 3);
      this.vfx.spawnBurst(p.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xfde047, 40, 7);
      this.showBanner(`JOB ADVANCED: ${p.jobTitle}!  +12 Stat Pts · +4 Skill Pts · +3 All Stats`);
    }
  }

  private refine(kind: 'weapon' | 'armor'): void {
    const p = this.player;
    if (!p || this.refining) return;
    const current = kind === 'weapon' ? p.roStats.weaponRefine : p.roStats.armorRefine;
    const next = current + 1;
    const cost = next * (kind === 'weapon' ? 60 : 50);
    if (next > 10 || next > this.story.refineCap() || p.gold < cost) return;
    p.gold -= cost;
    this.sound.playCoinClink(2);
    const rate = next <= 4 ? 1 : [0.9, 0.8, 0.65, 0.5, 0.4, 0.3][Math.min(5, next - 5)];
    const success = Math.random() < rate;
    this.refining = true;
    const verdictAt = this.sound.playRefine(success, next);
    window.setTimeout(() => {
      this.refining = false;
      if (!this.player) return;
      const pos = this.player.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
      if (success) {
        if (kind === 'weapon') {
          this.player.roStats.weaponRefine = next;
          this.player.updateWeaponRefineVisuals();
        } else {
          this.player.roStats.armorRefine = next;
        }
        const col = next >= 10 ? 0xff8a2a : next >= 7 ? 0x7dfcf0 : 0xfacc15;
        this.vfx.spawnBurst(pos, col, next >= 7 ? 36 : 18, 6);
        if (next >= 7) {
          this.vfx.spawnConsecratedPillar(this.player.pos, col, 1.4, 5);
          this.post.flash(col, 0.25);
        }
        this.showBanner(`${kind === 'weapon' ? 'Weapon' : 'Armor'} refined to +${next}!`);
      } else {
        this.vfx.spawnBurst(pos, 0x6b7280, 14, 3);
        this.showBanner(`Refine failed... the metal resists. (+${current} kept)`);
      }
    }, verdictAt * 1000);
  }

  private miraPurchase(kind: MiraPurchase): void {
    const p = this.player;
    if (!p || !this.story.unlocks.miraLab) return;
    if (kind === 'conv_fire' || kind === 'conv_wind' || kind === 'conv_water') {
      if (p.gold < 60) return;
      p.gold -= 60;
      const el = kind === 'conv_fire' ? 'fire1' : kind === 'conv_wind' ? 'wind1' : 'water1';
      p.setEndow(el, 90);
      this.sound.playCoinClink(2);
      if (kind === 'conv_fire') this.sound.playFireBolt(2);
      else if (kind === 'conv_wind') this.sound.playLightning(2);
      else this.sound.playIceShatter(1);
      this.vfx.spawnBurst(p.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), kind === 'conv_fire' ? 0xff6a00 : kind === 'conv_wind' ? 0xfacc15 : 0x67e8f9, 22, 5);
    } else if (kind === 'awaken') {
      if (p.gold < 70) return;
      p.gold -= 70;
      p.roStats.quickenTimer = Math.max(p.roStats.quickenTimer, 45);
      this.sound.playCoinClink(2);
      this.sound.playPotionGulp();
      this.vfx.kickFov(3);
      this.showBanner('Awakening Potion: ASPD surging for 45s!');
    } else if (kind === 'extract') {
      const card = EXTRACTABLE_CARDS.filter((c) => !p.kafraStorage.some((k) => k.id === c.id));
      if (p.gold < 150 || card.length === 0) {
        if (card.length === 0) this.showBanner('No monster memories left to extract.');
        return;
      }
      p.gold -= 150;
      const pick = card[Math.floor(Math.random() * card.length)];
      this.addCard(p, pick);
      this.sound.playStinger('memory');
      this.showBanner(`Extracted: ${pick.name} — equip it at Pip’s Vault`);
    }
  }

  private toggleStatsWindow(): void {
    if (this.phase === 'playing') {
      this.phase = 'stats_window';
      this.attackHeld = false;
      this.sound.playUIPopup();
    } else if (this.phase === 'stats_window') {
      this.phase = 'playing';
      this.sound.playUISelect();
    }
  }

  private showBanner(text: string): void {
    this.bannerText = text;
    this.bannerTimer = 2.8;
  }

  private applyRelicChoice(relic: RelicDef): void {
    if (this.player) {
      this.player.addRelic(relic.id);
      this.sound.playChestChime();
      this.vfx.spawnBurst(this.player.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0xa855f7, 20, 6);
      this.showBanner(`Relic Acquired: ${relic.name}`);
    }
    this.phase = 'playing';
  }

  /** Replay any witnessed scene from the Journal (no story side-effects). */
  private replayScene(id: string): void {
    const p = this.player;
    let script = STORY_SCRIPTS[id];
    if (!script && id.startsWith('echo_')) {
      const def = ECHO_SHARDS.find((e) => `echo_${e.id}` === id);
      if (def) script = echoScript(def);
    }
    if (!script || !p) return;
    this.phase = 'playing';
    const savedPos = p.pos.clone();
    const savedMode = this.floor === 0 ? 'town' : 'explore';
    const savedBiome = this.atmosphere.current;
    const savedBrand = this.brandLevel;
    const origin = id.startsWith('echo_') ? p.pos.clone() : this.floor === 0 || id.startsWith('prologue') ? new THREE.Vector3() : this.bossRoomCenter.clone();
    void this.director.playScript(
      script,
      origin,
      () => {
        p.pos.copy(savedPos);
        this.atmosphere.set(savedBiome);
        this.setBrand(savedBrand);
        this.sound.setMusicMode(savedMode);
        if (this.floor === 0) this.refreshTown();
      },
      true
    );
  }

  // ───────────────────────────── Input ─────────────────────────────

  private bindInputs(): void {
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.post.setSize(w, h);
    });

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (this.director.active) {
        if (k === 'escape') {
          this.director.skip();
        } else if (k === ' ' || k === 'enter') {
          e.preventDefault();
          this.director.overlay.handleAdvanceInput();
        }
        return;
      }
      if (this.cutscenes.active && (k === ' ' || k === 'escape')) {
        this.cutscenes.skip();
        return;
      }
      if ((k === 'q' || k === 'j') && (this.phase === 'playing' || this.phase === 'journal')) {
        e.preventDefault();
        this.toggleJournal();
        return;
      }
      if (
        k === 'escape' &&
        (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'skill_tree' || this.phase === 'stats_window' || this.phase === 'npc_modal' || this.phase === 'journal')
      ) {
        if (this.phase === 'stats_window' || this.phase === 'npc_modal' || this.phase === 'journal') {
          this.closeModal();
          this.phase = 'playing';
        } else {
          this.togglePause();
        }
        return;
      }
      if ((k === 'k' || (e.altKey && k === 's')) && (this.phase === 'playing' || this.phase === 'skill_tree')) {
        e.preventDefault();
        this.toggleSkillTree();
        return;
      }
      if ((k === 'u' || (e.altKey && k === 'a')) && (this.phase === 'playing' || this.phase === 'stats_window')) {
        e.preventDefault();
        this.toggleStatsWindow();
        return;
      }
      this.keys.add(k);
      if (k === '1') this.skillQueued = true;
      if (k === 'c' || k === '2') this.skill2Queued = true;
      if (k === 'r' || k === '3') this.ultQueued = true;
      if (k === 'v' || k === '4') this.skill4Queued = true;
      if (k === '5') this.player?.useRedPotion();
      if (k === '6') this.player?.useBluePotion();
      if (k === ' ' || k === 'shift') this.dodgeQueued = true;
      if (k === 'e' || k === 'f') this.interactQueued = true;
      if (k === 'm') this.sound.toggleMute();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });

    window.addEventListener('mousemove', (e) => {
      this.mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    window.addEventListener('mousedown', (e) => {
      if (this.director.active && e.button === 0) {
        this.director.overlay.handleAdvanceInput();
        return;
      }
      if (this.phase !== 'playing') return;
      if (e.button === 0) this.attackHeld = true;
      if (e.button === 2) this.skillQueued = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.attackHeld = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ───────────────────────────── Main loop ─────────────────────────────

  private renderFrame(dt: number, focus: THREE.Vector3): void {
    this.atmosphere.update(dt, focus);
    MaterialFX.update(dt);
    this.brand.update(dt);
    this.post.update(dt);
    this.camera.updateMatrixWorld();
    this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.sound.setListener(this.camera.position, this.camRight);
    this.post.render();
  }

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const rawDt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const elapsed = now / 1000;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= rawDt;
      if (this.bannerTimer <= 0) this.bannerText = null;
    }

    if (this.phase === 'menu') {
      this.dungeon.update(rawDt, elapsed);
      const ang = elapsed * 0.18;
      this.camera.position.set(Math.sin(ang) * 9, 6.5, Math.cos(ang) * 9);
      this.camera.lookAt(0, 1.2, 0);
      this.renderFrame(rawDt, new THREE.Vector3());
      this.hud.render(this.buildHudState(null), this.dungeon.rooms, { x: 0, z: 0 });
      return;
    }

    if (this.phase === 'title') {
      this.dungeon.update(rawDt, elapsed);
      if (this.previewModel && this.previewAnim) {
        this.previewModel.rotation.y += rawDt * 0.55;
        this.previewAnim.update(rawDt);
      }
      this.camera.position.set(0, 3.2, 6.2);
      this.camera.lookAt(0.4, 1.15, 0);
      this.renderFrame(rawDt, new THREE.Vector3());
      this.hud.render(this.buildHudState(null), this.dungeon.rooms, { x: 0, z: 0 });
      return;
    }

    if (this.phase === 'playing' && this.player) {
      if (this.director.active) {
        this.hud.clearForCutscene();
        this.player.anim.update(rawDt);
        this.enemies.enemies.forEach((e) => e.anim?.update(rawDt));
        this.dungeon.update(rawDt, elapsed);
        this.sound.update(rawDt);
        this.vfx.update(rawDt, this.camera);
        this.director.update(rawDt);
        this.renderFrame(rawDt, this.player.pos);
        return;
      }

      // Deferred story beats (boss death → cutscene, banners after scenes)
      if (this.storyQueue.length > 0) {
        for (let i = this.storyQueue.length - 1; i >= 0; i--) {
          const q = this.storyQueue[i];
          q.t -= rawDt;
          if (q.t <= 0) {
            this.storyQueue.splice(i, 1);
            q.fn();
            if (this.director.active) break;
          }
        }
        if (this.director.active) {
          this.renderFrame(rawDt, this.player.pos);
          return;
        }
      }

      if (this.cutscenes.active) {
        this.player.anim.update(rawDt);
        this.enemies.enemies.forEach((e) => e.anim?.update(rawDt));
        this.dungeon.update(rawDt, elapsed);
        this.sound.update(rawDt);
        this.vfx.update(rawDt, this.camera);
        this.cutscenes.update(rawDt, this.camera);
        this.renderFrame(rawDt, this.player.pos);
        return;
      }

      const dt = this.vfx.isHitStopped(rawDt) ? rawDt * 0.05 : rawDt;

      // Update aim world point
      this.raycaster.setFromCamera(this.mouseNdc, this.camera);
      this.raycaster.ray.intersectPlane(this.groundPlane, this.aimWorld);

      const move = new THREE.Vector2(
        (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0),
        (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0) - (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0)
      );

      this.player.update(
        dt,
        move,
        this.aimWorld,
        this.attackHeld,
        this.skillQueued,
        this.skill2Queued,
        this.ultQueued,
        this.dodgeQueued,
        this.dungeon,
        this.enemies,
        this.skill4Queued
      );
      this.skillQueued = false;
      this.skill2Queued = false;
      this.ultQueued = false;
      this.skill4Queued = false;
      this.dodgeQueued = false;

      this.enemies.update(dt, this.player.pos, this.dungeon, (dmg, dir) => {
        this.player?.takeDamage(dmg, dir, this.enemies);
      });

      this.dungeon.update(dt, elapsed);
      this.sound.update(rawDt);

      // Room discovery & combat triggers (only lock gates once player is 1.8m inside the room)
      const room = this.dungeon.getRoomAt(this.player.pos.x, this.player.pos.z);
      if (room) room.discovered = true;
      const interiorRoom = this.dungeon.getRoomAt(this.player.pos.x, this.player.pos.z, 1.8);
      if (
        interiorRoom &&
        !interiorRoom.cleared &&
        this.activeRoom !== interiorRoom &&
        (interiorRoom.type === 'combat' || interiorRoom.type === 'boss' || interiorRoom.type === 'trap')
      ) {
        this.activeRoom = interiorRoom;
        this.dungeon.gatesLocked = true;
        this.dungeon.lockedRoom = interiorRoom;
        this.enemies.spawnWaveForRoom(interiorRoom, this.floor);
        this.sound.setCombatIntensity(interiorRoom.type === 'boss' ? 1.0 : 0.75);
        if (interiorRoom.type === 'boss') this.onEnterBossRoom(interiorRoom);
      }

      // Check room clear
      if (this.activeRoom && !this.activeRoom.cleared && !this.holdRoomClear && this.enemies.enemies.every((e) => e.dead)) {
        this.activeRoom.cleared = true;
        this.dungeon.gatesLocked = false;
        this.dungeon.lockedRoom = null;
        this.sound.setCombatIntensity(0.15);
        this.sound.setMusicMode('explore');
        this.sound.playChestChime();

        if (this.activeRoom.type === 'boss') {
          this.dungeon.spawnChest(this.activeRoom.worldX - 3, this.activeRoom.worldZ - 2, 'rare');
          this.dungeon.spawnShrine(this.activeRoom.worldX + 3, this.activeRoom.worldZ - 2);
          if (this.floor < 99) this.dungeon.spawnTrapdoor(this.activeRoom.worldX, this.activeRoom.worldZ + 2);
          this.showBanner(this.floor >= 3 && !this.story.resolved ? 'The Ledger trembles...' : 'Boss Vanquished! Descend deeper, or return to Oakhaven');
        } else {
          if (Math.random() < 0.55) {
            this.dungeon.spawnShrine(this.activeRoom.worldX, this.activeRoom.worldZ);
          } else {
            this.dungeon.spawnChest(this.activeRoom.worldX, this.activeRoom.worldZ, 'common');
          }
          this.showBanner('Room Cleared!');
        }
        this.activeRoom = null;
      }

      // Obsidian Mirror auto-triggers when you step close
      for (const item of this.dungeon.interactables) {
        if (item.kind === 'mirror' && !item.used && Math.hypot(this.player.pos.x - item.x, this.player.pos.z - item.z) < 3.6) {
          this.handleInteract(item);
          break;
        }
      }

      // Interactables
      const nearest = this.findNearestInteractable();
      if (this.interactQueued && nearest) this.handleInteract(nearest);
      this.interactQueued = false;

      if (this.player.hp <= 0) {
        this.phase = 'dead';
        this.sound.setCombatIntensity(0);
        this.sound.stopCastHum(false);
      }

      // Camera follow + trauma shake + FOV kick
      const shake = this.vfx.getCameraShakeOffset();
      const targetCam = new THREE.Vector3(this.player.pos.x, 14.5, this.player.pos.z + 11.5);
      this.camera.position.lerp(targetCam, Math.min(1, rawDt * 8));
      this.camera.position.add(shake);
      this.camera.lookAt(this.player.pos.x + shake.x * 0.4, 0.8, this.player.pos.z + shake.z * 0.4);
      const fov = BASE_FOV + this.vfx.getFovKick() + (this.player.roStats.quickenTimer > 0 ? 1.2 : 0);
      if (Math.abs(this.camera.fov - fov) > 0.01) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }

      this.vfx.update(rawDt, this.camera);
      this.renderFrame(rawDt, this.player.pos);
      this.hud.render(this.buildHudState(nearest), this.dungeon.rooms, this.player.pos);
      return;
    }

    // Modals (relic draft, journal, npc, stats, pause) or dead
    this.vfx.update(rawDt, this.camera);
    this.dungeon.update(rawDt, elapsed);
    this.player?.anim.update(rawDt);
    this.renderFrame(rawDt, this.player?.pos ?? new THREE.Vector3());
    if (this.player) {
      this.hud.render(this.buildHudState(null), this.dungeon.rooms, this.player.pos);
    }
  };

  private onEnterBossRoom(room: RoomData): void {
    const p = this.player;
    if (!p) return;
    this.sound.setMusicMode('boss');
    this.sound.playCinematicWhoosh();
    this.bossRoomCenter.set(room.worldX, 0, room.worldZ);
    const boss = this.enemies.getActiveBoss();
    if (!boss) return;
    boss.anim?.clearOneShot();
    boss.anim?.playOneShot('Skeletons_Taunt_Longer', 0.08, 1.05, 2.5);
    this.vfx.spawnRing(boss.pos, 6.0, 0xff2244, 0.7);
    const origin = this.bossRoomCenter.clone();
    const storyScene =
      boss.bossId === 'malakor' ? 'act1_malakor' : boss.bossId === 'lyra' ? 'act2_lyra' : boss.bossId === 'vance' ? 'act3_vance' : null;
    if (storyScene && !this.director.hasPlayed(storyScene)) {
      if (boss.bossId === 'malakor') this.story.set('act1_malakor_met');
      if (boss.bossId === 'lyra') this.story.set('act2_lyra_met');
      if (boss.bossId === 'vance') this.story.set('act3_vance_met');
      void this.director.playScript(STORY_SCRIPTS[storyScene], origin);
      return;
    }
    this.cutscenes.play({
      duration: 2.6,
      startPos: new THREE.Vector3(p.pos.x, 12, p.pos.z + 10),
      endPos: new THREE.Vector3(boss.pos.x, 5.2, boss.pos.z + 7.5),
      startLook: p.pos.clone(),
      endLook: boss.pos.clone().add(new THREE.Vector3(0, 1.8, 0)),
      title: boss.name,
      subtitle: this.floor >= 4 ? `MVP of Floor ${this.floor} — Endless Abyss` : `Warden of Floor ${this.floor}`,
      onComplete: () => this.showBanner(`Boss Chamber — ${boss.name}`),
    });
  }

  private findNearestInteractable(): Interactable | null {
    if (!this.player) return null;
    let best: Interactable | null = null;
    let bestDist = 2.6;
    for (const item of this.dungeon.interactables) {
      if (item.used) continue;
      const d = Math.hypot(this.player.pos.x - item.x, this.player.pos.z - item.z);
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  private handleInteract(item: Interactable): void {
    const p = this.player;
    if (!p) return;

    if (item.kind === 'npc' && item.npcId) {
      this.openNpc(item.npcId);
      return;
    }

    item.used = true;
    if (item.light) item.light.intensity = 1.5;

    if (item.kind === 'chest') {
      this.sound.playChestChime();
      this.sound.playCoinClink(4);
      this.vfx.spawnBurst(new THREE.Vector3(item.x, 0.8, item.z), 0xffd54f, 22, 6);
      p.heal(35);
      p.gold += 50;
      this.showBanner('Chest Opened! +35 HP & +50 Zeny');
    } else if (item.kind === 'shrine') {
      this.sound.playChestChime();
      this.phase = 'relic_draft';
      this.attackHeld = false;
      this.hud.showRelicDraft(pickRandomRelics(p.relics, 3));
    } else if (item.kind === 'trapdoor') {
      this.sound.playChestChime();
      this.buildFloor(Math.min(99, this.floor + 1));
      this.showBanner(floorName(this.floor));
    } else if (item.kind === 'echo' && item.echoId) {
      const def = this.story.collectEcho(item.echoId);
      item.mesh.visible = false;
      if (item.light) item.light.intensity = 0;
      if (!def) return;
      const found = ECHO_SHARDS.filter((e) => this.story.hasEcho(e.id)).length;
      void this.director.playScript(echoScript(def), new THREE.Vector3(item.x, 0, item.z), () => {
        this.showBanner(`Echo Shard recovered (${found}/${ECHO_SHARDS.length}) — review it in your Journal [Q]`);
      }, true);
    } else if (item.kind === 'mirror') {
      this.story.set('act2_mirror_seen');
      void this.director.playScript(STORY_SCRIPTS.act2_obsidian_mirror, new THREE.Vector3(item.x, 0, item.z), () => {
        this.showBanner('The Obsidian Mirror cracks. Vaelen has answers — confront him in Oakhaven.');
      });
    }
  }

  private buildHudState(nearest: Interactable | null): HUDState {
    const boss = this.enemies.getActiveBoss();
    const room = this.player ? this.dungeon.getRoomAt(this.player.pos.x, this.player.pos.z) : null;
    const derived = this.player?.getDerived();
    const roSkillsRecord = this.player
      ? (Object.fromEntries(this.player.roSkills.levels.entries()) as HUDState['roSkills'])
      : ({} as HUDState['roSkills']);
    const obj = this.story.objective();
    const unlocks = this.story.unlocks;
    const p = this.player;
    const endowLabel =
      p && p.endowElement && p.endowTimer > 0
        ? `${p.endowElement.startsWith('fire') ? '🔥 Flame' : p.endowElement.startsWith('wind') ? '⚡ Wind' : '❄ Frost'} Endow ${Math.ceil(p.endowTimer)}s`
        : null;

    return {
      phase: this.phase,
      floor: this.floor,
      kills: p?.kills ?? 0,
      gold: p?.gold ?? 0,
      level: p?.level ?? 1,
      xp: p?.xp ?? 0,
      xpToNext: p?.xpToNext ?? 90,
      skillPoints: p?.skillPoints ?? 0,
      unlockedSkills: p ? Array.from(p.unlockedSkills) : [],
      selectedClass: this.selectedClass,
      hp: p?.hp ?? 0,
      maxHp: p?.maxHp ?? 100,
      sp: p?.sp ?? 0,
      maxSp: p?.maxSp ?? 100,
      statPoints: p?.roStats.statPoints ?? 0,
      roSkillPoints: p?.roSkills.skillPoints ?? 0,
      roBase: p?.roStats.base ?? { str: 5, agi: 5, vit: 5, int: 5, dex: 5, luk: 5 },
      roDerived: derived ?? {
        total: { str: 5, agi: 5, vit: 5, int: 5, dex: 5, luk: 5 },
        bonus: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
        atkMin: 10,
        atkMax: 14,
        matkMin: 10,
        matkMax: 14,
        hardDef: 0,
        softDef: 4,
        mdef: 5,
        hit: 10,
        flee: 10,
        perfectDodge: 0.01,
        critChance: 0.05,
        aspd: 156,
        attackInterval: 0.5,
        castTimeMult: 1,
        maxHp: 150,
        maxSp: 100,
        potionMult: 1,
        hpRegenPerTick: 4,
        spRegenPerTick: 4,
      },
      roSkills: roSkillsRecord,
      castingSkillName: p?.castingSkill?.name ?? null,
      castProgress: p?.castingSkill ? 1 - p.castingSkill.timer / Math.max(0.01, p.castingSkill.total) : 0,
      weaponRefine: p?.roStats.weaponRefine ?? 0,
      armorRefine: p?.roStats.armorRefine ?? 0,
      redPotions: p?.redPotions ?? 0,
      bluePotions: p?.bluePotions ?? 0,
      kafraStorage: p?.kafraStorage ?? [],
      equippedCard: p?.equippedCard ?? null,
      activeNpc: this.activeNpc,
      skillCd: p?.skillCd ?? 0,
      skillMaxCd: p?.def.skillCooldown ?? 1,
      skill2Cd: p?.skill2Cd ?? 0,
      skill2MaxCd: p?.def.skill2Cooldown ?? 1,
      ultCd: p?.ultCd ?? 0,
      ultMaxCd: p?.def.ultCooldown ?? 1,
      skill4Cd: p?.skill4Cd ?? 0,
      skill4MaxCd: 10,
      dodgeCd: p?.dodgeCd ?? 0,
      dodgeMaxCd: p?.dodgeMaxCd ?? 1,
      relics: p?.relics ?? [],
      bossActive: !!boss && boss.mesh.visible,
      bossName: boss?.name ?? '',
      bossHp: boss?.hp ?? 0,
      bossMaxHp: boss?.maxHp ?? 1,
      interactPrompt: nearest ? nearest.label : null,
      bannerText: this.bannerText,
      currentRoomType: room?.type ?? 'start',
      energyCoatActive: p?.roStats.energyCoatActive ?? false,
      endureTimer: p?.roStats.endureTimer ?? 0,
      magnumEndowTimer: p?.roStats.magnumEndowTimer ?? 0,
      quickenTimer: p?.roStats.quickenTimer ?? 0,
      objective: obj.title,
      objectiveAct: obj.act,
      journal: this.phase === 'journal' ? this.story.journal((id) => this.director.hasPlayed(id)) : null,
      npcView: this.activeNpc && this.phase === 'npc_modal' ? this.town.dialogue(this.activeNpc, this.npcNode, p?.level ?? 1) : null,
      refineCap: this.story.refineCap(),
      socketCard: p?.socketCard ?? null,
      hasAtonementBlade: p?.hasAtonementBlade ?? false,
      jobTitle: p?.jobTitle ?? null,
      unlocks: {
        masterwork: unlocks.masterwork,
        miraLab: unlocks.miraLab,
        jobAdvance: unlocks.jobAdvance,
        soulGoldLedger: unlocks.soulGoldLedger,
        endless: unlocks.endless,
      },
      endowLabel,
      brandLevel: this.brandLevel,
    };
  }
}
