import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager';
import { AnimatorHelper } from '../engine/AnimatorHelper';
import { VFXManager } from '../engine/VFXManager';
import { SoundEngine } from '../audio/SoundEngine';
import { DungeonFloorBuilder } from './DungeonGenerator';
import { ElementType } from './RagnarokStatsSystem';
import { RoomData } from '../types';
import { MaterialFX } from '../graphics/MaterialFX';
import { createTelegraphMaterial } from '../graphics/FXMaterials';

const TELE_CIRCLE = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
const TELE_LINE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export type EnemyKind =
  | 'warrior'
  | 'minion'
  | 'rogue'
  | 'mage'
  | 'imp'
  | 'puglin'
  | 'orc'
  | 'demon'
  | 'mushroom'
  | 'ghost'
  | 'slime'
  | 'pyre_skeleton'
  | 'frost_wraith'
  | 'toxic_ghoul'
  | 'dragon'
  | 'boss';

export interface EnemyAnimSet {
  idle: string;
  move: string;
  attack: string;
  hit: string;
  death: string;
}

export interface EnemyProjectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  damage: number;
  life: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  name: string;
  mesh: THREE.Group;
  anim: AnimatorHelper | null;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  range: number;
  radius: number;
  state: 'chase' | 'windup' | 'cooldown' | 'stunned';
  stateTimer: number;
  stunTimer: number;
  chillTimer: number;
  freezeTimer: number;
  baseElement: ElementType;
  element: ElementType;
  flee: number;
  telegraphMesh: THREE.Mesh | null;
  phase2Triggered: boolean;
  dead: boolean;
  deathTimer: number;
  attackTarget: THREE.Vector3;
  baseScale: number;
  recoilTilt: number;
  squash: number;
  anims: EnemyAnimSet;
  isBoss: boolean;
  /** Story identity for named bosses (malakor, lyra, vance, warden, mvp). */
  bossId?: string;
  windupTotal: number;
  /** Footprint radius derived from the actual model bounds (used for wall collision). */
  bodyRadius: number;
  /** Seconds left of the rise-from-the-ground spawn animation. */
  spawnT: number;
  spawnBaseY: number;
}

const SPAWN_TIME = 0.65;
const DEATH_TIME = 1.55;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export interface BossIdentity {
  bossId: string;
  name: string;
  kind: EnemyKind;
  model?: string;
  rWep?: string;
  lWep?: string;
  tint?: number;
  rim?: number;
  scale?: number;
  hpMult?: number;
  dmgMult?: number;
  anims?: EnemyAnimSet;
}

const MVP_NAMES = [
  'Ledger-Wraith Osric',
  'Gilded Maw',
  'Debt-Collector Vharn',
  'Sigil-Eater Morrow',
  'The Ink-Drowned King',
  'Hollow Tithe-Knight',
  'Abyssal Notary',
];

/** Named boss for each story floor (Endless Abyss floors rotate MVP names). */
export function bossIdentityForFloor(floorNum: number): BossIdentity {
  if (floorNum === 1) {
    return {
      bossId: 'malakor',
      name: 'Archivist Malakor',
      kind: 'boss',
      model: 'characters/Skeleton_Mage.glb',
      rWep: 'weapons/Skeleton_Staff.gltf',
      lWep: undefined,
      tint: 0x2dd4ff,
      rim: 0x67e8f9,
      scale: 2.0,
    };
  }
  if (floorNum === 2) {
    return {
      bossId: 'lyra',
      name: 'Thorn-Weaver Lyra',
      kind: 'boss',
      model: 'monsters/MushroomKing.gltf',
      rWep: undefined,
      lWep: undefined,
      tint: 0x22c55e,
      rim: 0xa3e635,
      scale: 2.1,
      hpMult: 1.05,
      anims: { idle: 'Idle', move: 'Walk', attack: 'Punch', hit: 'HitReact', death: 'Death' },
    };
  }
  if (floorNum === 3) {
    return {
      bossId: 'vance',
      name: 'Mayor Vance, Sovereign of Greed',
      kind: 'boss',
      model: 'characters/Mage.glb',
      rWep: 'weapons/pack_scythe.glb',
      lWep: undefined,
      tint: 0xfacc15,
      rim: 0xfde047,
      scale: 1.55,
      hpMult: 0.9,
    };
  }
  const idx = (floorNum - 4) % MVP_NAMES.length;
  return {
    bossId: 'mvp',
    name: `MVP - ${MVP_NAMES[idx]}`,
    kind: floorNum % 2 === 0 ? 'dragon' : 'boss',
    tint: floorNum % 2 === 0 ? 0xd946ef : 0x7c3aed,
    rim: 0xd946ef,
  };
}

/** Phase-2 colossus that absorbs Vance's soul. */
export const ABYSSAL_WARDEN: BossIdentity = {
  bossId: 'warden',
  name: 'The Abyssal Warden',
  kind: 'boss',
  model: 'monsters/Demon.gltf',
  rWep: undefined,
  lWep: undefined,
  tint: 0x7e22ce,
  rim: 0xc084fc,
  scale: 2.6,
  hpMult: 1.6,
  dmgMult: 1.15,
  anims: { idle: 'Idle', move: 'Walk', attack: 'Punch', hit: 'HitReact', death: 'Death' },
};

export class EnemyManager {
  public enemies: Enemy[] = [];
  public projectiles: EnemyProjectile[] = [];
  private nextId = 1;
  private projGeo = new THREE.SphereGeometry(0.22, 8, 8);
  /** Fired when a named boss dies (story hooks: Vance -> Warden betrayal, etc.). */
  public onBossDefeated?: (e: Enemy) => void;
  /** Set by the engine so spawns can be validated against walls. */
  public dungeon: DungeonFloorBuilder | null = null;

  constructor(
    private scene: THREE.Scene,
    private assets: AssetManager,
    private vfx: VFXManager,
    private sound: SoundEngine
  ) {}

  public spawnWaveForRoom(room: RoomData, floorNum: number): void {
    const before = this.enemies.length;
    this.spawnWaveInner(room, floorNum);
    for (let i = before; i < this.enemies.length; i++) this.settleInto(this.enemies[i], room.worldX, room.worldZ);
  }

  /** Pull an enemy toward (cx, cz) until its whole body is clear of walls and props. */
  public settleInto(e: Enemy, cx: number, cz: number): void {
    const d = this.dungeon;
    if (!d) return;
    if (d.isWalkable(e.pos.x, e.pos.z, e.bodyRadius)) return;
    const sx = e.pos.x;
    const sz = e.pos.z;
    for (let i = 1; i <= 20; i++) {
      const t = i / 20;
      const x = sx + (cx - sx) * t;
      const z = sz + (cz - sz) * t;
      if (d.isWalkable(x, z, e.bodyRadius)) {
        e.pos.x = x;
        e.pos.z = z;
        return;
      }
    }
    // Last resort: shrink the footprint so it can still move instead of freezing in a wall
    e.pos.x = cx;
    e.pos.z = cz;
    e.bodyRadius = Math.min(e.bodyRadius, e.radius);
  }

  private spawnWaveInner(room: RoomData, floorNum: number): void {
    const scale = 1 + (floorNum - 1) * 0.6;
    if (room.type === 'boss') {
      const identity = bossIdentityForFloor(floorNum);
      this.spawnEnemy(identity.kind, room.worldX, room.worldZ - 3.5, scale, identity);
      this.spawnEnemy(floorNum >= 2 ? 'ghost' : 'rogue', room.worldX - 6, room.worldZ - 5, scale);
      this.spawnEnemy(floorNum >= 2 ? 'demon' : 'mage', room.worldX + 6, room.worldZ - 5, scale);
      this.spawnEnemy('warrior', room.worldX - 4, room.worldZ + 4, scale);
      this.spawnEnemy('warrior', room.worldX + 4, room.worldZ + 4, scale);
      return;
    }

    const count = room.type === 'trap' ? 5 : 6 + Math.min(6, floorNum);
    const pool: EnemyKind[] =
      floorNum >= 3
        ? ['warrior', 'pyre_skeleton', 'demon', 'orc', 'frost_wraith', 'ghost', 'mage', 'imp']
        : floorNum === 2
        ? ['toxic_ghoul', 'mushroom', 'slime', 'frost_wraith', 'ghost', 'orc', 'rogue', 'puglin']
        : ['warrior', 'minion', 'rogue', 'mage', 'imp', 'puglin', 'orc', 'slime', 'mushroom'];
    for (let i = 0; i < count; i++) {
      const kind = pool[Math.floor(Math.random() * pool.length)];
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 3.5 + Math.random() * 4.0;
      this.spawnEnemy(kind, room.worldX + Math.cos(angle) * dist, room.worldZ + Math.sin(angle) * dist, scale);
    }
  }

  public spawnEnemy(kind: EnemyKind, x: number, z: number, scale = 1, identity?: BossIdentity): Enemy {
    const baseCfg = {
      warrior: {
        model: 'characters/Skeleton_Warrior.glb',
        rWep: 'weapons/Skeleton_Blade.gltf',
        lWep: 'weapons/Skeleton_Shield_Large_A.gltf',
        hp: 85,
        speed: 3.3,
        dmg: 14,
        range: 2.3,
        rad: 0.65,
        s: 1.0,
        name: 'Bone Guard',
      },
      minion: {
        model: 'characters/Skeleton_Minion.glb',
        rWep: 'weapons/Skeleton_Axe.gltf',
        lWep: undefined,
        hp: 55,
        speed: 4.5,
        dmg: 11,
        range: 2.0,
        rad: 0.55,
        s: 0.95,
        name: 'Risen Chopper',
      },
      rogue: {
        model: 'characters/Skeleton_Rogue.glb',
        rWep: 'weapons/Skeleton_Crossbow.gltf',
        lWep: undefined,
        hp: 50,
        speed: 3.2,
        dmg: 13,
        range: 10.5,
        rad: 0.55,
        s: 0.95,
        name: 'Crypt Marksman',
      },
      mage: {
        model: 'characters/Skeleton_Mage.glb',
        rWep: 'weapons/Skeleton_Staff.gltf',
        lWep: undefined,
        hp: 60,
        speed: 2.8,
        dmg: 16,
        range: 11.5,
        rad: 0.55,
        s: 1.0,
        name: 'Ossuary Lich',
        rigged: true,
      },
      imp: {
        model: 'monsters/Imp.glb',
        rWep: undefined,
        lWep: undefined,
        hp: 48,
        speed: 4.1,
        dmg: 13,
        range: 9.5,
        rad: 0.55,
        s: 0.85,
        name: 'Winged Imp',
        rigged: false,
      },
      puglin: {
        model: 'monsters/Puglin.glb',
        rWep: undefined,
        lWep: undefined,
        hp: 62,
        speed: 5.0,
        dmg: 12,
        range: 2.4,
        rad: 0.58,
        s: 1.05,
        name: 'Feral Puglin',
        rigged: false,
      },
      orc: {
        model: 'monsters/Orc.gltf',
        rWep: undefined,
        lWep: undefined,
        hp: 105,
        speed: 3.4,
        dmg: 16,
        range: 2.4,
        rad: 0.72,
        s: 0.72,
        name: 'Orc Marauder',
        anims: { idle: 'Idle', move: 'Run', attack: 'Weapon', hit: 'HitReact', death: 'Death' },
      },
      demon: {
        model: 'monsters/Demon.gltf',
        rWep: undefined,
        lWep: undefined,
        hp: 135,
        speed: 3.6,
        dmg: 20,
        range: 2.8,
        rad: 0.82,
        s: 0.85,
        name: 'Abyssal Fiend',
        anims: { idle: 'Idle', move: 'Run', attack: 'Punch', hit: 'HitReact', death: 'Death' },
      },
      mushroom: {
        model: 'monsters/MushroomKing.gltf',
        rWep: undefined,
        lWep: undefined,
        hp: 90,
        speed: 2.9,
        dmg: 15,
        range: 2.3,
        rad: 0.68,
        s: 0.72,
        name: 'Spore Warden',
        anims: { idle: 'Idle', move: 'Walk', attack: 'Punch', hit: 'HitReact', death: 'Death' },
      },
      ghost: {
        model: 'monsters/Ghost_Skull.gltf',
        rWep: undefined,
        lWep: undefined,
        hp: 58,
        speed: 4.8,
        dmg: 14,
        range: 2.2,
        rad: 0.58,
        s: 0.78,
        name: 'Wailing Skull',
        anims: { idle: 'Flying_Idle', move: 'Fast_Flying', attack: 'Headbutt', hit: 'HitReact', death: 'Death' },
      },
      slime: {
        model: 'monsters/GreenSpikyBlob.gltf',
        rWep: undefined,
        lWep: undefined,
        hp: 72,
        speed: 3.1,
        dmg: 12,
        range: 2.0,
        rad: 0.62,
        s: 0.72,
        name: 'Venom Slime',
        element: 'poison1' as ElementType,
        anims: { idle: 'Idle', move: 'Walk', attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death' },
      },
      pyre_skeleton: {
        model: 'characters/Skeleton_Warrior.glb',
        rWep: 'weapons/Skeleton_Blade.gltf',
        lWep: undefined,
        hp: 110,
        speed: 3.8,
        dmg: 18,
        range: 2.4,
        rad: 0.68,
        s: 1.08,
        name: 'Pyre Skeleton',
        element: 'fire1' as ElementType,
        tint: 0xff6b22,
      },
      frost_wraith: {
        model: 'monsters/Ghost_Skull.gltf',
        rWep: undefined,
        lWep: undefined,
        hp: 78,
        speed: 4.5,
        dmg: 15,
        range: 2.3,
        rad: 0.6,
        s: 0.85,
        name: 'Frost Wraith',
        element: 'water1' as ElementType,
        tint: 0x38bdf8,
        anims: { idle: 'Flying_Idle', move: 'Fast_Flying', attack: 'Headbutt', hit: 'HitReact', death: 'Death' },
      },
      toxic_ghoul: {
        model: 'characters/Skeleton_Minion.glb',
        rWep: 'weapons/Skeleton_Axe.gltf',
        lWep: undefined,
        hp: 84,
        speed: 4.2,
        dmg: 15,
        range: 2.2,
        rad: 0.6,
        s: 1.0,
        name: 'Toxic Ghoul',
        element: 'poison1' as ElementType,
        tint: 0x4ade80,
      },
      dragon: {
        model: 'monsters/Dragon_Evolved.gltf',
        rWep: undefined,
        lWep: undefined,
        hp: 620,
        speed: 3.7,
        dmg: 26,
        range: 4.2,
        rad: 1.25,
        s: 1.35,
        name: 'Ignis Wyrm',
        isBoss: true,
        anims: { idle: 'Flying_Idle', move: 'Fast_Flying', attack: 'Punch', hit: 'HitReact', death: 'Death' },
      },
      boss: {
        model: 'characters/Skeleton_Warrior.glb',
        rWep: 'weapons/Skeleton_Blade.gltf',
        lWep: 'weapons/Skeleton_Shield_Large_A.gltf',
        hp: 540,
        speed: 3.4,
        dmg: 24,
        range: 3.6,
        rad: 1.15,
        s: 1.85,
        name: 'Dread Bone Colossus',
        isBoss: true,
      },
    }[kind];
    const cfg = identity
      ? {
          ...baseCfg,
          model: identity.model ?? baseCfg.model,
          rWep: identity.model ? identity.rWep : baseCfg.rWep,
          lWep: identity.model ? identity.lWep : baseCfg.lWep,
          name: identity.name,
          s: identity.scale ?? baseCfg.s,
          hp: Math.round(baseCfg.hp * (identity.hpMult ?? 1)),
          dmg: Math.round(baseCfg.dmg * (identity.dmgMult ?? 1)),
          tint: identity.tint,
          isBoss: true,
          ...(identity.anims ? { anims: identity.anims } : {}),
        }
      : baseCfg;

    const mesh = this.assets.cloneCharacter(cfg.model);
    mesh.scale.setScalar(cfg.s);
    mesh.position.set(x, kind === 'imp' ? 0.75 : kind === 'ghost' || kind === 'frost_wraith' || kind === 'dragon' ? 0.45 : 0, z);
    if (cfg.rWep) this.assets.attachToHand(mesh, cfg.rWep, 'right');
    if (cfg.lWep) this.assets.attachToHand(mesh, cfg.lWep, 'left');

    if ('tint' in cfg && cfg.tint) {
      mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          const cloned = obj.material.clone();
          // Subtle colour identity only — no glowing halo
          cloned.color.lerp(new THREE.Color(cfg.tint), 0.25);
          cloned.emissive = new THREE.Color(cfg.tint);
          cloned.emissiveIntensity = 0.06;
          obj.material = cloned;
        }
      });
    }

    // Fresnel rim + hit-flash/freeze channels on every monster (reuses the KayKit meshes)
    const tintHex = 'tint' in cfg && cfg.tint ? (cfg.tint as number) : undefined;
    const rimHex =
      identity?.rim ?? tintHex ?? (kind === 'demon' || kind === 'imp' || kind === 'dragon' ? 0xff7a3a : 0x7dd3fc);
    MaterialFX.apply(mesh, rimHex, 0, 2.4);

    this.scene.add(mesh);

    // Collision footprint from the real model bounds (bind pose), so big/scaled models stop at walls
    // (SkinnedMesh boxes are empty before the first skeleton update, so measure raw geometry instead)
    const bb = new THREE.Box3();
    const tmp = new THREE.Box3();
    mesh.updateMatrixWorld(true);
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        tmp.copy(o.geometry.boundingBox!).applyMatrix4(o.matrixWorld);
        bb.union(tmp);
      }
    });
    const footprint = Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    const bodyRadius = THREE.MathUtils.clamp(Number.isFinite(footprint) ? footprint * 0.4 : cfg.rad, cfg.rad, 2.4);

    const anims: EnemyAnimSet =
      'anims' in cfg && cfg.anims
        ? cfg.anims
        : {
            idle: 'Skeletons_Idle',
            move: 'Skeletons_Walking',
            attack: kind === 'rogue' ? 'Ranged_1H_Shoot' : kind === 'mage' ? 'Ranged_Magic_Shoot' : kind === 'boss' ? 'Melee_1H_Attack_Slice_Horizontal' : 'Melee_1H_Attack_Chop',
            hit: 'Hit_A',
            death: 'Skeletons_Death',
          };

    const customClips = this.assets.getModelClips(cfg.model);
    let anim: AnimatorHelper | null = null;
    if (!('rigged' in cfg) || cfg.rigged) {
      anim = new AnimatorHelper(mesh, this.assets, customClips);
      if (customClips) {
        anim.playLoop(anims.idle, 0.08);
      } else {
        anim.playOneShot('Skeletons_Spawn_Ground', 0.05, 1.4, 0.55);
      }
    }

    const isBoss = 'isBoss' in cfg && Boolean(cfg.isBoss);
    const baseElement: ElementType = 'element' in cfg && cfg.element ? cfg.element : kind === 'dragon' || kind === 'demon' || kind === 'imp' ? 'fire1' : 'undead1';

    const enemy: Enemy = {
      id: this.nextId++,
      kind,
      name: cfg.name,
      mesh,
      anim,
      pos: mesh.position,
      vel: new THREE.Vector3(),
      hp: Math.round(cfg.hp * scale * 3.2),
      maxHp: Math.round(cfg.hp * scale * 3.2),
      speed: cfg.speed * 1.2,
      damage: Math.round(cfg.dmg * scale * 3.8),
      range: cfg.range,
      radius: cfg.rad,
      state: 'chase',
      stateTimer: 0,
      stunTimer: 0,
      chillTimer: 0,
      freezeTimer: 0,
      baseElement,
      element: baseElement,
      flee: isBoss ? 195 : 165 + Math.round(scale * 12),
      telegraphMesh: null,
      phase2Triggered: false,
      dead: false,
      deathTimer: 0,
      attackTarget: new THREE.Vector3(),
      baseScale: cfg.s,
      recoilTilt: 0,
      squash: 0,
      anims,
      isBoss,
      bossId: identity?.bossId,
      windupTotal: 0.55,
      bodyRadius,
      spawnT: SPAWN_TIME,
      spawnBaseY: mesh.position.y,
    };
    // Rise out of the floor with a dust ring instead of popping in
    mesh.position.y = mesh.position.y - 1.9 * cfg.s;
    this.vfx.spawnRing(new THREE.Vector3(x, 0, z), 1.6 * Math.max(1, cfg.s * 0.7), isBoss ? 0xff3355 : 0x8b7d6b, 0.5);
    this.vfx.spawnBurst(new THREE.Vector3(x, 0.3, z), 0x9a8f80, isBoss ? 26 : 10, 3.2);
    this.enemies.push(enemy);
    return enemy;
  }

  public freezeEnemy(enemy: Enemy, seconds: number): void {
    if (enemy.dead || enemy.isBoss) return;
    enemy.freezeTimer = Math.max(enemy.freezeTimer, seconds);
    enemy.element = 'water1';
    this.clearTelegraph(enemy);
    // Icy translucent freeze shader (fresnel frost + crystalline glints)
    MaterialFX.setFrozen(enemy.mesh, true);
    this.sound.at(enemy.pos).playIceShatter(0.6);
  }

  public damageEnemy(
    enemy: Enemy,
    amount: number,
    knockDir: THREE.Vector3,
    isCrit = false,
    stunSec = 0,
    skipPopup = false
  ): boolean {
    if (enemy.dead) return false;
    enemy.hp -= amount;
    // 0.12s crisp hit flash (gold-white on crits)
    MaterialFX.flash(enemy.mesh, isCrit ? 0xfff1c2 : 0xffffff, isCrit ? 2.4 : 1.5, 0.12);
    if (!skipPopup) {
      this.vfx.spawnDamageNumber(enemy.pos, amount, isCrit ? 'crit' : 'normal');
    }
    this.vfx.spawnBurst(enemy.pos.clone().add(new THREE.Vector3(0, 1, 0)), isCrit ? 0xffd54f : 0xff6b6b, isCrit ? 12 : 6, 4.5);

    const kb = enemy.isBoss ? 3.2 : isCrit ? 9.5 : 6.8;
    enemy.vel.addScaledVector(knockDir, kb);
    enemy.recoilTilt = isCrit ? -0.45 : -0.28;
    enemy.squash = isCrit ? 0.28 : 0.16;

    if (stunSec > 0) {
      enemy.stunTimer = Math.max(enemy.stunTimer, stunSec);
      enemy.state = 'stunned';
      this.clearTelegraph(enemy);
    }

    if (enemy.isBoss && !enemy.phase2Triggered && enemy.hp <= enemy.maxHp * 0.5 && enemy.hp > 0) {
      enemy.phase2Triggered = true;
      enemy.speed *= 1.3;
      this.vfx.spawnRing(enemy.pos, 7, 0xff2244, 0.5);
      this.sound.playExplosion();
      if (enemy.bossId === 'vance') {
        // Golden constructs forged from Oakhaven's stolen Zeny
        const construct: BossIdentity = {
          bossId: 'construct',
          name: 'Zeny Construct',
          kind: 'warrior',
          tint: 0xfacc15,
          rim: 0xfde68a,
          scale: 1.25,
          hpMult: 0.5,
          dmgMult: 0.6,
        };
        for (const dx of [-3.5, 3.5]) {
          const c = this.spawnEnemy('warrior', enemy.pos.x + dx, enemy.pos.z + 2, 1, construct);
          c.isBoss = false;
          this.vfx.spawnBurst(c.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0xfacc15, 20, 5);
        }
        this.sound.playCoinClink(6);
      } else {
        const addKind: EnemyKind = enemy.kind === 'dragon' ? 'imp' : 'minion';
        this.spawnEnemy(addKind, enemy.pos.x - 3, enemy.pos.z + 2, 1);
        this.spawnEnemy(addKind, enemy.pos.x + 3, enemy.pos.z + 2, 1);
      }
    }

    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.dead = true;
      enemy.deathTimer = DEATH_TIME;
      this.clearTelegraph(enemy);
      enemy.anim?.clearOneShot();
      enemy.anim?.playOneShot(enemy.anims.death, 0.08, 1.3, 1.2);
      this.vfx.spawnBoneShatter(enemy.pos, enemy.isBoss ? 34 : 14);
      this.sound.at(enemy.pos).playBoneShatter();
      if (enemy.isBoss) {
        // Boss finisher: long freeze-frame, heavy trauma and a wide FOV punch
        this.vfx.triggerHitStop(0.065);
        this.vfx.addCameraShake(knockDir, 0.6);
        this.vfx.kickFov(7);
        this.sound.at(enemy.pos).playBossFinisher();
        this.onBossDefeated?.(enemy);
      }
      return true;
    } else if (enemy.state !== 'windup') {
      enemy.anim?.playOneShot(enemy.anims.hit, 0.05, 1.4, 0.22);
    }
    return false;
  }

  /** Provoke all nearby enemies into chasing the player (Knight Provoke). */
  public provokeAllNear(pos: THREE.Vector3, radius: number): number {
    let count = 0;
    const rSq = radius * radius;
    for (const e of this.enemies) {
      if (e.dead || e.freezeTimer > 0) continue;
      if (e.pos.distanceToSquared(pos) <= rSq) {
        e.state = 'chase';
        e.stateTimer = 0.1;
        this.vfx.spawnROText(e.pos.clone().add(new THREE.Vector3(0, 2.2, 0)), 'PROVOKE!', 'guard');
        count++;
      }
    }
    return count;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    dungeon: DungeonFloorBuilder,
    onPlayerHit: (dmg: number, dir: THREE.Vector3) => void
  ): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.anim?.update(dt);

      if (e.dead) {
        e.deathTimer -= dt;
        if (!e.anim) {
          e.mesh.rotation.y += dt * 10;
          e.mesh.scale.setScalar(Math.max(0.01, e.baseScale * (e.deathTimer / DEATH_TIME)));
        }
        // Let the death animation land, then sink through the floor (no pop-out)
        if (e.deathTimer < 0.6) {
          e.pos.y -= dt * (1.2 + e.baseScale * 1.4);
          if (Math.random() < dt * 14) {
            this.vfx.spawnTrailSpark(new THREE.Vector3(e.pos.x + (Math.random() - 0.5), 0.2, e.pos.z + (Math.random() - 0.5)), 0x9ca3af, 0.6);
          }
        }
        if (e.deathTimer <= 0) {
          this.scene.remove(e.mesh);
          MaterialFX.release(e.mesh);
          this.enemies.splice(i, 1);
        }
        continue;
      }

      if (e.spawnT > 0) {
        e.spawnT = Math.max(0, e.spawnT - dt);
        const k = 1 - e.spawnT / SPAWN_TIME;
        const ease = 1 - Math.pow(1 - k, 3);
        e.pos.y = e.spawnBaseY - (1 - ease) * 1.9 * e.baseScale;
        e.anim?.playLoop(e.anims.idle, 0.1);
        continue;
      }

      // Apply knockback velocity & impact spring physics
      if (e.vel.lengthSq() > 0.01) {
        const nx = e.pos.x + e.vel.x * dt;
        const nz = e.pos.z + e.vel.z * dt;
        if (dungeon.isWalkable(nx, e.pos.z, e.bodyRadius)) e.pos.x = nx;
        if (dungeon.isWalkable(e.pos.x, nz, e.bodyRadius)) e.pos.z = nz;
        e.vel.multiplyScalar(Math.pow(0.015, dt));
      }

      if (Math.abs(e.recoilTilt) > 0.005 || Math.abs(e.squash) > 0.005) {
        e.recoilTilt *= Math.pow(0.001, dt);
        e.squash *= Math.pow(0.001, dt);
        e.mesh.rotation.x = e.recoilTilt;
        e.mesh.scale.set(
          e.baseScale * (1 + e.squash * 0.7),
          e.baseScale * (1 - e.squash),
          e.baseScale * (1 + e.squash * 0.7)
        );
      } else {
        e.mesh.rotation.x = 0;
        e.mesh.scale.setScalar(e.baseScale);
      }

      if (e.chillTimer > 0) e.chillTimer -= dt;
      const spdMult = e.chillTimer > 0 ? 0.55 : 1.0;

      if (e.freezeTimer > 0) {
        e.freezeTimer -= dt;
        if (e.freezeTimer <= 0) {
          e.element = e.baseElement;
          MaterialFX.setFrozen(e.mesh, false);
          this.sound.at(e.pos).playIceShatter(0.9);
          this.vfx.spawnBurst(e.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0x9be7ff, 14, 4.5);
        }
        continue;
      }

      if (e.stunTimer > 0) {
        e.stunTimer -= dt;
        e.anim?.playLoop(e.anims.idle, 0.12);
        if (e.stunTimer <= 0) e.state = 'chase';
        continue;
      }

      // Procedural hover/hop & banking for Bestiary monsters
      const tNow = performance.now() * 0.001 + e.id;
      if (e.kind === 'imp') {
        e.pos.y = 0.78 + Math.sin(tNow * 5.4) * 0.20;
        e.mesh.rotation.z = Math.sin(tNow * 3.8) * 0.16;
      } else if (e.kind === 'puglin') {
        e.pos.y = e.state === 'chase' ? Math.abs(Math.sin(tNow * 11.5)) * 0.38 : 0;
        e.mesh.rotation.z = e.state === 'chase' ? Math.sin(tNow * 11.5) * 0.12 : 0;
      }

      const toPlayer = new THREE.Vector3().subVectors(playerPos, e.pos);
      toPlayer.y = 0;
      const dist = toPlayer.length();
      const dir = dist > 0.001 ? toPlayer.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);

      if (e.state === 'cooldown') {
        e.stateTimer -= dt;
        e.anim?.playLoop(e.anims.idle, 0.14);
        if (e.stateTimer <= 0) e.state = 'chase';
      } else if (e.state === 'windup') {
        e.stateTimer -= dt;
        if (e.telegraphMesh) {
          // Crisp crimson warning ring: pulses faster and fills in as the hit approaches
          const prog = 1 - Math.max(0, e.stateTimer) / Math.max(0.01, e.windupTotal);
          const mat = e.telegraphMesh.material as THREE.ShaderMaterial;
          mat.uniforms.uProgress.value = prog;
          mat.uniforms.uTime.value = performance.now() * 0.001;
          mat.uniforms.uHeat.value = (e.isBoss ? 1.6 : 1.0) * (1 + prog * 0.8);
        }
        if (e.stateTimer <= 0) {
          this.executeAttack(e, playerPos, onPlayerHit);
          this.clearTelegraph(e);
          e.state = 'cooldown';
          e.stateTimer = e.isBoss ? 0.9 : 0.75;
        }
      } else {
        // Chase / position
        // Turn smoothly toward the target instead of snapping
        e.mesh.rotation.y = lerpAngle(e.mesh.rotation.y, Math.atan2(dir.x, dir.z), 1 - Math.exp(-dt * 9));
        if (dist <= e.range * 0.9) {
          e.state = 'windup';
          e.stateTimer = e.isBoss ? 0.75 : e.kind === 'rogue' ? 0.65 : 0.55;
          e.windupTotal = e.stateTimer;
          e.attackTarget.copy(playerPos);
          this.createTelegraph(e, dir);
          e.anim?.playLoop(e.anims.idle, 0.1);
        } else {
          const moveSpd = e.speed * spdMult;
          const nx = e.pos.x + dir.x * moveSpd * dt;
          const nz = e.pos.z + dir.z * moveSpd * dt;
          if (dungeon.isWalkable(nx, e.pos.z, e.bodyRadius)) e.pos.x = nx;
          if (dungeon.isWalkable(e.pos.x, nz, e.bodyRadius)) e.pos.z = nz;
          e.anim?.playLoop(e.anims.move, 0.12, spdMult * 1.15);
        }
      }
    }

    // Soft separation so mobs don't stack inside each other (never pushes anyone into a wall)
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b.dead) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const minD = (a.radius + b.radius) * 0.9;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < minD * minD) {
          const d = Math.sqrt(d2);
          const push = ((minD - d) / d) * 0.5 * Math.min(1, dt * 10);
          const ax = a.pos.x - dx * push;
          const az = a.pos.z - dz * push;
          const bx = b.pos.x + dx * push;
          const bz = b.pos.z + dz * push;
          if (dungeon.isWalkable(ax, az, a.bodyRadius)) a.pos.set(ax, a.pos.y, az);
          if (dungeon.isWalkable(bx, bz, b.bodyRadius)) b.pos.set(bx, b.pos.y, bz);
        }
      }
    }

    // Update enemy projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.life <= 0 || !dungeon.isWalkable(p.mesh.position.x, p.mesh.position.z, 0.15)) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
        continue;
      }
      const dx = p.mesh.position.x - playerPos.x;
      const dz = p.mesh.position.z - playerPos.z;
      if (dx * dx + dz * dz < 0.72 * 0.72) {
        onPlayerHit(p.damage, p.vel.clone().normalize());
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  private createTelegraph(e: Enemy, dir: THREE.Vector3): void {
    this.clearTelegraph(e);
    const isLine = e.kind === 'rogue';
    const mat = createTelegraphMaterial(isLine);
    mat.uniforms.uHeat.value = e.isBoss ? 1.6 : 1.0;
    if (isLine) {
      const mesh = new THREE.Mesh(TELE_LINE, mat);
      mesh.scale.set(0.7, 1, e.range);
      mesh.position.set(e.pos.x + dir.x * (e.range / 2), 0.06, e.pos.z + dir.z * (e.range / 2));
      mesh.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      e.telegraphMesh = mesh;
    } else {
      const rad = e.isBoss ? 4.3 : e.kind === 'mage' ? 2.4 : e.range;
      const mesh = new THREE.Mesh(TELE_CIRCLE, mat);
      mesh.scale.set(rad, 1, rad);
      mesh.renderOrder = 2;
      const tx = e.kind === 'mage' ? e.attackTarget.x : e.pos.x;
      const tz = e.kind === 'mage' ? e.attackTarget.z : e.pos.z;
      mesh.position.set(tx, 0.06, tz);
      this.scene.add(mesh);
      e.telegraphMesh = mesh;
    }
  }

  private clearTelegraph(e: Enemy): void {
    if (e.telegraphMesh) {
      this.scene.remove(e.telegraphMesh);
      // geometry is shared (TELE_CIRCLE / TELE_LINE); only the per-attack material is freed
      (e.telegraphMesh.material as THREE.Material).dispose();
      e.telegraphMesh = null;
    }
  }

  private executeAttack(e: Enemy, playerPos: THREE.Vector3, onPlayerHit: (dmg: number, dir: THREE.Vector3) => void): void {
    const dir = new THREE.Vector3().subVectors(e.attackTarget, e.pos).setY(0).normalize();
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);

    if (e.kind === 'rogue' || e.kind === 'imp') {
      e.anim?.playOneShot('Ranged_1H_Shoot', 0.06, 1.3, 0.35);
      if (e.kind === 'imp') this.sound.at(e.pos).playArcaneBlast(0.95);
      else this.sound.at(e.pos).playBowTwang(0.8);
      this.spawnProjectile(
        e.pos.clone().add(new THREE.Vector3(0, 1.1, 0)),
        dir.multiplyScalar(e.kind === 'imp' ? 11.5 : 13.5),
        e.damage,
        e.kind === 'imp' ? 0xff7722 : 0xff4455
      );
    } else if (e.kind === 'mage') {
      e.anim?.playOneShot('Ranged_Magic_Shoot', 0.06, 1.3, 0.4);
      this.sound.at(e.pos).playArcaneBlast(0.85);
      this.vfx.spawnRing(e.attackTarget, 2.5, 0xff3366, 0.3);
      const d = Math.hypot(playerPos.x - e.attackTarget.x, playerPos.z - e.attackTarget.z);
      if (d < 2.4) onPlayerHit(e.damage, dir);
    } else if (e.isBoss) {
      e.anim?.playOneShot(e.anims.attack, 0.06, 1.1, 0.5);
      this.sound.at(e.pos).playExplosion();
      this.vfx.kickFov(2.5);
      const isDragon = e.kind === 'dragon';
      this.vfx.spawnRing(e.pos, 4.4, isDragon ? 0xff7722 : 0xff3344, 0.4);
      this.vfx.addCameraShake(dir, 0.35);
      if (e.pos.distanceTo(playerPos) <= 4.4) {
        onPlayerHit(e.damage, dir);
      }
      // Radial bolts / fireballs
      const bolts = e.phase2Triggered ? 8 : 5;
      for (let b = 0; b < bolts; b++) {
        const a = (b / bolts) * Math.PI * 2;
        this.spawnProjectile(
          e.pos.clone().add(new THREE.Vector3(0, 1.2, 0)),
          new THREE.Vector3(Math.cos(a) * 9.5, 0, Math.sin(a) * 9.5),
          Math.round(e.damage * 0.65),
          isDragon ? 0xff8822 : 0xff3355
        );
      }
    } else {
      e.anim?.playOneShot(e.anims.attack, 0.06, 1.35, 0.35);
      e.vel.addScaledVector(dir, e.kind === 'puglin' || e.kind === 'ghost' ? 7.8 : 5.2);
      this.sound.at(e.pos).playSwordClang(0.65);
      const slashCol =
        e.kind === 'slime' ? 0x4ade80 : e.kind === 'ghost' ? 0x38bdf8 : e.kind === 'demon' ? 0xff5522 : e.kind === 'puglin' ? 0xfacc15 : 0xff4444;
      this.vfx.spawnSlashArc(e.pos, Math.atan2(dir.x, dir.z), e.range, slashCol);
      if (e.pos.distanceTo(playerPos) <= e.range + 0.45) {
        onPlayerHit(e.damage, dir);
      }
    }
  }

  private spawnProjectile(pos: THREE.Vector3, vel: THREE.Vector3, damage: number, color: number): void {
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(this.projGeo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, vel, damage, life: 2.2 });
  }

  public getActiveBoss(): Enemy | null {
    return this.enemies.find((e) => e.isBoss && !e.dead) ?? null;
  }

  public clear(): void {
    for (const e of this.enemies) {
      this.clearTelegraph(e);
      this.scene.remove(e.mesh);
      MaterialFX.release(e.mesh);
    }
    this.enemies = [];
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.projectiles = [];
  }
}
