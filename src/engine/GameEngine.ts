import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { AssetManager } from '../assets/AssetManager';
import { SoundEngine } from '../audio/SoundEngine';
import { DungeonFloorBuilder, Interactable } from '../game/DungeonGenerator';
import { EnemyManager } from '../game/EnemyManager';
import { PlayerController } from '../game/PlayerController';
import { HERO_CLASSES } from '../game/classes';
import { pickRandomRelics } from '../game/relics';
import { HUDManager } from '../ui/HUD';
import { GamePhase, HeroClassId, HUDState, KafraItem, RelicDef, RoomData, SkillNodeId, TownNpcId } from '../types';
import type { StatKey } from '../game/RagnarokStatsSystem';
import type { ROSkillId } from '../game/SkillSystem';
import { VFXManager } from './VFXManager';
import { AnimatorHelper } from './AnimatorHelper';
import { CutsceneManager } from './CutsceneManager';

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;

  private assets = new AssetManager();
  private sound = new SoundEngine();
  private vfx: VFXManager;
  private dungeon: DungeonFloorBuilder;
  private enemies: EnemyManager;
  private hud: HUDManager;
  private cutscenes = new CutsceneManager();

  private player: PlayerController | null = null;
  private previewModel: THREE.Group | null = null;
  private previewAnim: AnimatorHelper | null = null;

  private phase: GamePhase = 'loading';
  private selectedClass: HeroClassId = 'knight';
  private floor = 0;
  private activeNpc: TownNpcId | null = null;
  private activeRoom: RoomData | null = null;
  private bannerText: string | null = null;
  private bannerTimer = 0;

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

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x09080d);
    this.scene.fog = new THREE.FogExp2(0x09080d, 0.022);

    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.2, 120);
    this.camera.position.set(0, 14, 12);

    // Lighting: Moody indigo fill + warm hero key light
    const hemi = new THREE.HemisphereLight(0x4f5d9a, 0x16121d, 0.85);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xdbeafe, 1.15);
    dir.position.set(12, 24, 14);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 2;
    dir.shadow.camera.far = 70;
    const d = 24;
    dir.shadow.camera.left = -d;
    dir.shadow.camera.right = d;
    dir.shadow.camera.top = d;
    dir.shadow.camera.bottom = -d;
    dir.shadow.bias = -0.0005;
    this.scene.add(dir);

    // Post-processing bloom
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.35, 0.78);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    this.vfx = new VFXManager(this.scene);
    this.dungeon = new DungeonFloorBuilder(this.assets);
    this.scene.add(this.dungeon.group);
    this.enemies = new EnemyManager(this.scene, this.assets, this.vfx, this.sound);

    this.hud = new HUDManager(
      (id) => this.selectPreviewClass(id),
      () => this.startRun(),
      (relic) => this.applyRelicChoice(relic),
      () => this.returnToTitle(),
      () => this.sound.playUIHover(),
      () => { this.sound.unlock(); this.sound.playUISelect(); },
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
          this.sound.playUIPopup();
        }
      },
      onUpgradeROSkill: (id: ROSkillId) => {
        if (this.player?.roSkills.upgradeSkill(id)) {
          this.sound.playUIPopup();
        }
      },
      onRefineWeapon: () => {
        if (!this.player) return;
        const next = this.player.roStats.weaponRefine + 1;
        const cost = next * 60;
        if (next <= 10 && this.player.gold >= cost) {
          this.player.gold -= cost;
          this.player.roStats.weaponRefine = next;
          this.player.updateWeaponRefineVisuals();
          this.sound.playSwordClang(1.3);
          this.showBanner(`Weapon Refined to +${next}!`);
        }
      },
      onRefineArmor: () => {
        if (!this.player) return;
        const next = this.player.roStats.armorRefine + 1;
        const cost = next * 50;
        if (next <= 10 && this.player.gold >= cost) {
          this.player.gold -= cost;
          this.player.roStats.armorRefine = next;
          this.sound.playSwordClang(1.1);
          this.showBanner(`Armor Refined to +${next}!`);
        }
      },
      onResetStats: () => {
        if (!this.player) return;
        this.player.roStats.resetStats();
        this.player.getDerived();
        this.sound.playUIPopup();
        this.showBanner('Stats Reset by Hypnotist!');
      },
      onResetSkills: () => {
        if (!this.player) return;
        this.player.roSkills.resetSkills();
        this.sound.playUIPopup();
        this.showBanner('Skills Reset by Hypnotist!');
      },
      onBuyPotion: (kind: 'red' | 'blue') => {
        if (!this.player) return;
        const cost = kind === 'red' ? 25 : 40;
        if (this.player.gold >= cost) {
          this.player.gold -= cost;
          if (kind === 'red') this.player.redPotions++;
          else this.player.bluePotions++;
          this.sound.playUIPopup();
        }
      },
      onEquipCard: (card: KafraItem | null) => {
        this.player?.equipKafraCard(card);
        this.sound.playUIPopup();
      },
      onCloseModal: () => {
        this.activeNpc = null;
        if (this.phase === 'npc_modal' || this.phase === 'stats_window' || this.phase === 'skill_tree') {
          this.phase = 'playing';
        }
      },
      onUseRedPotion: () => this.player?.useRedPotion(),
      onUseBluePotion: () => this.player?.useBluePotion(),
      onEnterDungeon: () => {
        this.activeNpc = null;
        this.phase = 'playing';
        this.buildFloor(1);
        this.showBanner('Floor 1 — Sunken Crypt');
      },
      onReturnToTown: () => {
        this.activeNpc = null;
        this.phase = 'playing';
        this.buildFloor(0);
        this.showBanner('Oakhaven Town Hub');
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
    this.loop(performance.now());
  }

  private setupTitleShowcase(): void {
    this.dungeon.clear();
    this.enemies.clear();
    this.vfx.clearAll();
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    this.dungeon.generate(1);
    this.selectPreviewClass(this.selectedClass);
  }

  private selectPreviewClass(id: HeroClassId): void {
    this.selectedClass = id;
    if (this.previewModel) {
      this.scene.remove(this.previewModel);
      this.previewModel = null;
    }
    const cls = HERO_CLASSES[id];
    const model = this.assets.cloneCharacter(cls.modelFile);
    if (cls.rightWeapon) this.assets.attachToHand(model, cls.rightWeapon, 'right');
    if (cls.leftWeapon) this.assets.attachToHand(model, cls.leftWeapon, 'left');
    model.position.set(1.8, 0, 0);
    model.scale.setScalar(1.3);
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
      this.previewModel = null;
      this.previewAnim = null;
    }
    this.floor = 0;
    this.player = new PlayerController(this.selectedClass, this.scene, this.assets, this.vfx, this.sound);
    this.player.gold = 250;
    this.player.onLevelUp = (lvl) => {
      this.showBanner(`LEVEL ${lvl}! [U] Stats & [K] Skills`);
    };
    this.buildFloor(0);
    this.phase = 'playing';
    this.player.anim.playOneShot('Spawn_Ground', 0.05, 1.0, 1.1);
    this.sound.setMusicMode('explore');
    this.sound.playCinematicWhoosh();
    this.cutscenes.play({
      duration: 2.4,
      startPos: new THREE.Vector3(0, 18, 20),
      endPos: new THREE.Vector3(0, 14.5, 11.5),
      startLook: new THREE.Vector3(0, 1.8, -3),
      endLook: new THREE.Vector3(0, 0.8, 0),
      title: 'Oakhaven Town Hub',
      subtitle: 'Visit Blacksmith, Kafra, Alchemist — or speak to the Guild Master to enter the Crypt.',
      onComplete: () => this.showBanner('Oakhaven Town — Press [U] Stats | [K] Skills'),
    });
  }

  private returnToTitle(): void {
    this.phase = 'menu';
    this.setupTitleShowcase();
    if (this.previewModel) {
      this.scene.remove(this.previewModel);
      this.previewModel = null;
    }
  }

  private buildFloor(floorNum: number): void {
    this.floor = floorNum;
    this.enemies.clear();
    this.dungeon.generate(floorNum);
    this.activeRoom = null;
    if (floorNum === 0) {
      this.scene.background = new THREE.Color(0x141726);
      this.scene.fog = new THREE.FogExp2(0x141726, 0.014);
    } else if (floorNum === 1) {
      this.scene.background = new THREE.Color(0x09080d);
      this.scene.fog = new THREE.FogExp2(0x09080d, 0.022);
    } else if (floorNum === 2) {
      this.scene.background = new THREE.Color(0x091612);
      this.scene.fog = new THREE.FogExp2(0x091612, 0.022);
    } else {
      this.scene.background = new THREE.Color(0x150818);
      this.scene.fog = new THREE.FogExp2(0x150818, 0.023);
    }
    if (this.player) {
      this.player.pos.set(0, 0, 0);
    }
    this.sound.setCombatIntensity(0.1);
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
    this.bannerTimer = 2.6;
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

  private bindInputs(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (this.cutscenes.active && (k === ' ' || k === 'escape')) {
        this.cutscenes.skip();
        return;
      }
      if (k === 'escape' && (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'skill_tree' || this.phase === 'stats_window' || this.phase === 'npc_modal')) {
        if (this.phase === 'stats_window' || this.phase === 'npc_modal') {
          this.activeNpc = null;
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
      if (k === 'q' || k === '1') this.skillQueued = true;
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
      if (this.phase !== 'playing') return;
      this.sound.unlock();
      if (e.button === 0) this.attackHeld = true;
      if (e.button === 2) this.skillQueued = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.attackHeld = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());
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
      this.composer.render();
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
      this.composer.render();
      this.hud.render(this.buildHudState(null), this.dungeon.rooms, { x: 0, z: 0 });
      return;
    }

    if (this.phase === 'playing' && this.player) {
      if (this.cutscenes.active) {
        this.player.anim.update(rawDt);
        this.enemies.enemies.forEach((e) => e.anim?.update(rawDt));
        this.dungeon.update(rawDt, elapsed);
        this.sound.update(rawDt);
        this.vfx.update(rawDt, this.camera);
        this.cutscenes.update(rawDt, this.camera);
        this.composer.render();
        return;
      }

      const dt = this.vfx.isHitStopped(rawDt) ? rawDt * 0.05 : rawDt;

      // Update aim world point
      this.raycaster.setFromCamera(this.mouseNdc, this.camera);
      this.raycaster.ray.intersectPlane(this.groundPlane, this.aimWorld);

      // Movement vector
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
      if (room) {
        room.discovered = true;
      }
      const interiorRoom = this.dungeon.getRoomAt(this.player.pos.x, this.player.pos.z, 1.8);
      if (interiorRoom && !interiorRoom.cleared && this.activeRoom !== interiorRoom && (interiorRoom.type === 'combat' || interiorRoom.type === 'boss' || interiorRoom.type === 'trap')) {
        this.activeRoom = interiorRoom;
        this.dungeon.gatesLocked = true;
        this.dungeon.lockedRoom = interiorRoom;
        this.enemies.spawnWaveForRoom(interiorRoom, this.floor);
        this.sound.setCombatIntensity(interiorRoom.type === 'boss' ? 1.0 : 0.75);
        if (interiorRoom.type === 'boss') {
          this.sound.setMusicMode('boss');
          this.sound.playCinematicWhoosh();
          const boss = this.enemies.getActiveBoss();
          if (boss) {
            boss.anim?.clearOneShot();
            boss.anim?.playOneShot('Skeletons_Taunt_Longer', 0.08, 1.05, 2.5);
            this.vfx.spawnRing(boss.pos, 6.0, 0xff2244, 0.7);
            this.cutscenes.play({
              duration: 3.1,
              startPos: new THREE.Vector3(this.player.pos.x, 12, this.player.pos.z + 10),
              endPos: new THREE.Vector3(boss.pos.x, 5.2, boss.pos.z + 7.5),
              startLook: this.player.pos.clone(),
              endLook: boss.pos.clone().add(new THREE.Vector3(0, 1.8, 0)),
              title: 'Dread Bone Colossus',
              subtitle: `Warden of Floor ${this.floor}`,
              onComplete: () => this.showBanner('Boss Chamber — Dread Bone Colossus'),
            });
          }
        }
      }

      // Check room clear
      if (this.activeRoom && !this.activeRoom.cleared && this.enemies.enemies.every((e) => e.dead)) {
        this.activeRoom.cleared = true;
        this.dungeon.gatesLocked = false;
        this.dungeon.lockedRoom = null;
        this.sound.setCombatIntensity(0.15);
        this.sound.setMusicMode('explore');
        this.sound.playChestChime();

        if (this.activeRoom.type === 'boss') {
          this.dungeon.spawnChest(this.activeRoom.worldX - 3, this.activeRoom.worldZ - 2, 'rare');
          this.dungeon.spawnShrine(this.activeRoom.worldX + 3, this.activeRoom.worldZ - 2);
          this.dungeon.spawnTrapdoor(this.activeRoom.worldX, this.activeRoom.worldZ + 2);
          this.showBanner('Boss Vanquished! Descend Deeper');
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

      // Interactables
      const nearest = this.findNearestInteractable();
      if (this.interactQueued && nearest) {
        this.handleInteract(nearest);
      }
      this.interactQueued = false;

      if (this.player.hp <= 0) {
        this.phase = 'dead';
        this.sound.setCombatIntensity(0);
      }

      // Camera follow + directional shake
      const shake = this.vfx.getCameraShakeOffset();
      const targetCam = new THREE.Vector3(this.player.pos.x, 14.5, this.player.pos.z + 11.5);
      this.camera.position.lerp(targetCam, Math.min(1, rawDt * 8));
      this.camera.position.add(shake);
      this.camera.lookAt(this.player.pos.x + shake.x * 0.4, 0.8, this.player.pos.z + shake.z * 0.4);

      this.vfx.update(rawDt, this.camera);
      this.composer.render();
      this.hud.render(this.buildHudState(nearest), this.dungeon.rooms, this.player.pos);
      return;
    }

    // Relic draft or dead
    this.vfx.update(rawDt, this.camera);
    this.composer.render();
    if (this.player) {
      this.hud.render(this.buildHudState(null), this.dungeon.rooms, this.player.pos);
    }
  };

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
    if (!this.player) return;

    if (item.kind === 'npc' && item.npcId) {
      this.activeNpc = item.npcId;
      this.phase = 'npc_modal';
      this.attackHeld = false;
      this.sound.playUIPopup();
      return;
    }

    item.used = true;
    if (item.light) item.light.intensity = 1.5;

    if (item.kind === 'chest') {
      this.sound.playChestChime();
      this.vfx.spawnBurst(new THREE.Vector3(item.x, 0.8, item.z), 0xffd54f, 22, 6);
      this.player.heal(35);
      this.player.gold += 50;
      this.showBanner('Chest Opened! +35 HP & +50 Gold');
    } else if (item.kind === 'shrine') {
      this.sound.playChestChime();
      this.phase = 'relic_draft';
      this.attackHeld = false;
      this.hud.showRelicDraft(pickRandomRelics(this.player.relics, 3));
    } else if (item.kind === 'trapdoor') {
      this.sound.playChestChime();
      this.buildFloor(this.floor + 1);
      const biomeName =
        this.floor === 1
          ? 'Floor 1 — Sunken Crypt'
          : this.floor === 2
            ? 'Floor 2 — Overgrown Subterranean Ruins'
            : `Floor ${this.floor} — Obsidian Spire Core`;
      this.showBanner(biomeName);
    }
  }

  private buildHudState(nearest: Interactable | null): HUDState {
    const boss = this.enemies.getActiveBoss();
    const room = this.player ? this.dungeon.getRoomAt(this.player.pos.x, this.player.pos.z) : null;
    const derived = this.player?.getDerived();
    const roSkillsRecord = this.player
      ? (Object.fromEntries(this.player.roSkills.levels.entries()) as HUDState['roSkills'])
      : ({} as HUDState['roSkills']);

    return {
      phase: this.phase,
      floor: this.floor,
      kills: this.player?.kills ?? 0,
      gold: this.player?.gold ?? 0,
      level: this.player?.level ?? 1,
      xp: this.player?.xp ?? 0,
      xpToNext: this.player?.xpToNext ?? 90,
      skillPoints: this.player?.skillPoints ?? 0,
      unlockedSkills: this.player ? Array.from(this.player.unlockedSkills) : [],
      selectedClass: this.selectedClass,
      hp: this.player?.hp ?? 0,
      maxHp: this.player?.maxHp ?? 100,
      sp: this.player?.sp ?? 0,
      maxSp: this.player?.maxSp ?? 100,
      statPoints: this.player?.roStats.statPoints ?? 0,
      roSkillPoints: this.player?.roSkills.skillPoints ?? 0,
      roBase: this.player?.roStats.base ?? { str: 5, agi: 5, vit: 5, int: 5, dex: 5, luk: 5 },
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
      castingSkillName: this.player?.castingSkill?.name ?? null,
      castProgress: this.player?.castingSkill
        ? 1 - this.player.castingSkill.timer / Math.max(0.01, this.player.castingSkill.total)
        : 0,
      weaponRefine: this.player?.roStats.weaponRefine ?? 0,
      armorRefine: this.player?.roStats.armorRefine ?? 0,
      redPotions: this.player?.redPotions ?? 0,
      bluePotions: this.player?.bluePotions ?? 0,
      kafraStorage: this.player?.kafraStorage ?? [],
      equippedCard: this.player?.equippedCard ?? null,
      activeNpc: this.activeNpc,
      skillCd: this.player?.skillCd ?? 0,
      skillMaxCd: this.player?.def.skillCooldown ?? 1,
      skill2Cd: this.player?.skill2Cd ?? 0,
      skill2MaxCd: this.player?.def.skill2Cooldown ?? 1,
      ultCd: this.player?.ultCd ?? 0,
      ultMaxCd: this.player?.def.ultCooldown ?? 1,
      skill4Cd: this.player?.skill4Cd ?? 0,
      skill4MaxCd: 10,
      dodgeCd: this.player?.dodgeCd ?? 0,
      dodgeMaxCd: this.player?.dodgeMaxCd ?? 1,
      relics: this.player?.relics ?? [],
      bossActive: !!boss,
      bossName: boss?.name ?? '',
      bossHp: boss?.hp ?? 0,
      bossMaxHp: boss?.maxHp ?? 1,
      interactPrompt: nearest ? nearest.label : null,
      bannerText: this.bannerText,
      currentRoomType: room?.type ?? 'start',
      energyCoatActive: this.player?.roStats.energyCoatActive ?? false,
      endureTimer: this.player?.roStats.endureTimer ?? 0,
      magnumEndowTimer: this.player?.roStats.magnumEndowTimer ?? 0,
      quickenTimer: this.player?.roStats.quickenTimer ?? 0,
    };
  }
}
