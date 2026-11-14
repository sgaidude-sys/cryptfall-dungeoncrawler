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
import { GamePhase, HeroClassId, HUDState, RelicDef, RoomData } from '../types';
import { VFXManager } from './VFXManager';
import { AnimatorHelper } from './AnimatorHelper';

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

  private player: PlayerController | null = null;
  private previewModel: THREE.Group | null = null;
  private previewAnim: AnimatorHelper | null = null;

  private phase: GamePhase = 'loading';
  private selectedClass: HeroClassId = 'knight';
  private floor = 1;
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
      () => this.returnToTitle()
    );

    this.bindInputs();
  }

  public async init(): Promise<void> {
    this.hud.showLoading(0, 'Preparing dungeon assets...');
    await this.assets.preloadAll((pct, label) => this.hud.showLoading(pct, label));
    this.phase = 'title';
    this.setupTitleShowcase();
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
    this.assets.attachToHand(model, cls.rightWeapon, 'right');
    if (cls.leftWeapon) this.assets.attachToHand(model, cls.leftWeapon, 'left');
    model.position.set(1.8, 0, 0);
    model.scale.setScalar(1.3);
    this.scene.add(model);
    this.previewModel = model;
    this.previewAnim = new AnimatorHelper(model, this.assets);
    this.previewAnim.playLoop('Idle_A', 0.1);
  }

  private startRun(): void {
    this.sound.unlock();
    if (this.previewModel) {
      this.scene.remove(this.previewModel);
      this.previewModel = null;
      this.previewAnim = null;
    }
    this.floor = 1;
    this.player = new PlayerController(this.selectedClass, this.scene, this.assets, this.vfx, this.sound);
    this.buildFloor(1);
    this.phase = 'playing';
    this.showBanner('Floor 1 — The Outer Crypt');
  }

  private returnToTitle(): void {
    this.phase = 'title';
    this.setupTitleShowcase();
  }

  private buildFloor(floorNum: number): void {
    this.floor = floorNum;
    this.enemies.clear();
    this.dungeon.generate(floorNum);
    this.activeRoom = null;
    if (this.player) {
      this.player.pos.set(0, 0, 0);
    }
    this.sound.setCombatIntensity(0.1);
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
      this.keys.add(k);
      if (k === 'q') this.skillQueued = true;
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
        this.dodgeQueued,
        this.dungeon,
        this.enemies
      );
      this.skillQueued = false;
      this.dodgeQueued = false;

      this.enemies.update(dt, this.player.pos, this.dungeon, (dmg, dir) => {
        this.player?.takeDamage(dmg, dir);
      });

      this.dungeon.update(dt, elapsed);
      this.sound.update(rawDt);

      // Room discovery & combat triggers
      const room = this.dungeon.getRoomAt(this.player.pos.x, this.player.pos.z);
      if (room) {
        room.discovered = true;
        if (!room.cleared && this.activeRoom !== room && (room.type === 'combat' || room.type === 'boss' || room.type === 'trap')) {
          this.activeRoom = room;
          this.dungeon.gatesLocked = true;
          this.dungeon.lockedRoom = room;
          this.enemies.spawnWaveForRoom(room, this.floor);
          this.sound.setCombatIntensity(room.type === 'boss' ? 1.0 : 0.75);
          if (room.type === 'boss') this.showBanner('Boss Chamber — Dread Bone Colossus');
        }
      }

      // Check room clear
      if (this.activeRoom && !this.activeRoom.cleared && this.enemies.enemies.every((e) => e.dead)) {
        this.activeRoom.cleared = true;
        this.dungeon.gatesLocked = false;
        this.dungeon.lockedRoom = null;
        this.sound.setCombatIntensity(0.15);
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
      this.showBanner(`Floor ${this.floor} — Deeper into the Abyss`);
    }
  }

  private buildHudState(nearest: Interactable | null): HUDState {
    const boss = this.enemies.getActiveBoss();
    const room = this.player ? this.dungeon.getRoomAt(this.player.pos.x, this.player.pos.z) : null;
    return {
      phase: this.phase,
      floor: this.floor,
      kills: this.player?.kills ?? 0,
      gold: this.player?.gold ?? 0,
      selectedClass: this.selectedClass,
      hp: this.player?.hp ?? 0,
      maxHp: this.player?.maxHp ?? 100,
      skillCd: this.player?.skillCd ?? 0,
      skillMaxCd: this.player?.def.skillCooldown ?? 1,
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
    };
  }
}
