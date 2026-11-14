import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager';
import { AnimatorHelper } from '../engine/AnimatorHelper';
import { VFXManager } from '../engine/VFXManager';
import { SoundEngine } from '../audio/SoundEngine';
import { DungeonFloorBuilder } from './DungeonGenerator';
import { RoomData } from '../types';

export type EnemyKind = 'warrior' | 'minion' | 'rogue' | 'mage' | 'boss';

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
  anim: AnimatorHelper;
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
  telegraphMesh: THREE.Mesh | null;
  phase2Triggered: boolean;
  dead: boolean;
  deathTimer: number;
  attackTarget: THREE.Vector3;
  baseScale: number;
  recoilTilt: number;
  squash: number;
}

export class EnemyManager {
  public enemies: Enemy[] = [];
  public projectiles: EnemyProjectile[] = [];
  private nextId = 1;
  private projGeo = new THREE.SphereGeometry(0.22, 8, 8);

  constructor(
    private scene: THREE.Scene,
    private assets: AssetManager,
    private vfx: VFXManager,
    private sound: SoundEngine
  ) {}

  public spawnWaveForRoom(room: RoomData, floorNum: number): void {
    const scale = 1 + (floorNum - 1) * 0.25;
    if (room.type === 'boss') {
      this.spawnEnemy('boss', room.worldX, room.worldZ - 3.5, scale);
      this.spawnEnemy('rogue', room.worldX - 6, room.worldZ - 5, scale);
      this.spawnEnemy('mage', room.worldX + 6, room.worldZ - 5, scale);
      return;
    }

    const count = room.type === 'trap' ? 3 : 4 + Math.min(4, floorNum);
    const pool: EnemyKind[] = ['warrior', 'minion', 'rogue', 'mage'];
    for (let i = 0; i < count; i++) {
      const kind = pool[Math.floor(Math.random() * pool.length)];
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 3.5 + Math.random() * 4.0;
      this.spawnEnemy(kind, room.worldX + Math.cos(angle) * dist, room.worldZ + Math.sin(angle) * dist, scale);
    }
  }

  public spawnEnemy(kind: EnemyKind, x: number, z: number, scale = 1): Enemy {
    const cfg = {
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
      },
    }[kind];

    const mesh = this.assets.cloneCharacter(cfg.model);
    mesh.scale.setScalar(cfg.s);
    mesh.position.set(x, 0, z);
    this.assets.attachToHand(mesh, cfg.rWep, 'right');
    if (cfg.lWep) this.assets.attachToHand(mesh, cfg.lWep, 'left');

    if (kind === 'boss') {
      const aura = new THREE.PointLight(0xff3344, 18, 12);
      aura.position.set(0, 2.2, 0);
      mesh.add(aura);
    }

    this.scene.add(mesh);

    const anim = new AnimatorHelper(mesh, this.assets);
    anim.playOneShot('Skeletons_Spawn_Ground', 0.05, 1.4, 0.55);

    const enemy: Enemy = {
      id: this.nextId++,
      kind,
      name: cfg.name,
      mesh,
      anim,
      pos: mesh.position,
      vel: new THREE.Vector3(),
      hp: Math.round(cfg.hp * scale),
      maxHp: Math.round(cfg.hp * scale),
      speed: cfg.speed,
      damage: Math.round(cfg.dmg * scale),
      range: cfg.range,
      radius: cfg.rad,
      state: 'chase',
      stateTimer: 0,
      stunTimer: 0,
      chillTimer: 0,
      telegraphMesh: null,
      phase2Triggered: false,
      dead: false,
      deathTimer: 0,
      attackTarget: new THREE.Vector3(),
      baseScale: cfg.s,
      recoilTilt: 0,
      squash: 0,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  public damageEnemy(enemy: Enemy, amount: number, knockDir: THREE.Vector3, isCrit = false, stunSec = 0): boolean {
    if (enemy.dead) return false;
    enemy.hp -= amount;
    this.vfx.spawnDamageNumber(enemy.pos, amount, isCrit ? 'crit' : 'normal');
    this.vfx.spawnBurst(enemy.pos.clone().add(new THREE.Vector3(0, 1, 0)), isCrit ? 0xffd54f : 0xff6b6b, isCrit ? 12 : 6, 4.5);

    const kb = enemy.kind === 'boss' ? 3.2 : isCrit ? 9.5 : 6.8;
    enemy.vel.addScaledVector(knockDir, kb);
    enemy.recoilTilt = isCrit ? -0.45 : -0.28;
    enemy.squash = isCrit ? 0.28 : 0.16;

    if (stunSec > 0) {
      enemy.stunTimer = Math.max(enemy.stunTimer, stunSec);
      enemy.state = 'stunned';
      this.clearTelegraph(enemy);
    }

    if (enemy.kind === 'boss' && !enemy.phase2Triggered && enemy.hp <= enemy.maxHp * 0.5 && enemy.hp > 0) {
      enemy.phase2Triggered = true;
      enemy.speed *= 1.3;
      this.vfx.spawnRing(enemy.pos, 7, 0xff2244, 0.5);
      this.sound.playExplosion();
      this.spawnEnemy('minion', enemy.pos.x - 3, enemy.pos.z + 2, 1);
      this.spawnEnemy('minion', enemy.pos.x + 3, enemy.pos.z + 2, 1);
    }

    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.dead = true;
      enemy.deathTimer = 0.85;
      this.clearTelegraph(enemy);
      enemy.anim.clearOneShot();
      enemy.anim.playOneShot('Skeletons_Death', 0.08, 1.3, 1.2);
      this.vfx.spawnBoneShatter(enemy.pos, enemy.kind === 'boss' ? 34 : 14);
      this.sound.playBoneShatter();
      return true;
    } else if (enemy.state !== 'windup') {
      enemy.anim.playOneShot('Hit_A', 0.05, 1.4, 0.22);
    }
    return false;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    dungeon: DungeonFloorBuilder,
    onPlayerHit: (dmg: number, dir: THREE.Vector3) => void
  ): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.anim.update(dt);

      if (e.dead) {
        e.deathTimer -= dt;
        if (e.deathTimer <= 0) {
          this.scene.remove(e.mesh);
          this.enemies.splice(i, 1);
        }
        continue;
      }

      // Apply knockback velocity & impact spring physics
      if (e.vel.lengthSq() > 0.01) {
        const nx = e.pos.x + e.vel.x * dt;
        const nz = e.pos.z + e.vel.z * dt;
        if (dungeon.isWalkable(nx, e.pos.z, e.radius)) e.pos.x = nx;
        if (dungeon.isWalkable(e.pos.x, nz, e.radius)) e.pos.z = nz;
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

      if (e.stunTimer > 0) {
        e.stunTimer -= dt;
        e.anim.playLoop('Skeletons_Idle', 0.12);
        if (e.stunTimer <= 0) e.state = 'chase';
        continue;
      }

      const toPlayer = new THREE.Vector3().subVectors(playerPos, e.pos);
      toPlayer.y = 0;
      const dist = toPlayer.length();
      const dir = dist > 0.001 ? toPlayer.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);

      if (e.state === 'cooldown') {
        e.stateTimer -= dt;
        e.anim.playLoop('Skeletons_Idle', 0.14);
        if (e.stateTimer <= 0) e.state = 'chase';
      } else if (e.state === 'windup') {
        e.stateTimer -= dt;
        if (e.telegraphMesh) {
          const mat = e.telegraphMesh.material as THREE.MeshBasicMaterial;
          mat.opacity = 0.35 + Math.sin(performance.now() * 0.025) * 0.2;
        }
        if (e.stateTimer <= 0) {
          this.executeAttack(e, playerPos, onPlayerHit);
          this.clearTelegraph(e);
          e.state = 'cooldown';
          e.stateTimer = e.kind === 'boss' ? 0.9 : 0.75;
        }
      } else {
        // Chase / position
        e.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        if (dist <= e.range * 0.9) {
          e.state = 'windup';
          e.stateTimer = e.kind === 'boss' ? 0.75 : e.kind === 'rogue' ? 0.65 : 0.55;
          e.attackTarget.copy(playerPos);
          this.createTelegraph(e, dir);
          e.anim.playLoop('Skeletons_Idle', 0.1);
        } else {
          const moveSpd = e.speed * spdMult;
          const nx = e.pos.x + dir.x * moveSpd * dt;
          const nz = e.pos.z + dir.z * moveSpd * dt;
          if (dungeon.isWalkable(nx, e.pos.z, e.radius)) e.pos.x = nx;
          if (dungeon.isWalkable(e.pos.x, nz, e.radius)) e.pos.z = nz;
          e.anim.playLoop('Skeletons_Walking', 0.12, spdMult * 1.15);
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
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2233,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    if (e.kind === 'rogue') {
      const geo = new THREE.PlaneGeometry(0.45, e.range);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(e.pos.x + dir.x * (e.range / 2), 0.06, e.pos.z + dir.z * (e.range / 2));
      mesh.rotation.y = Math.atan2(dir.x, dir.z);
      this.scene.add(mesh);
      e.telegraphMesh = mesh;
    } else {
      const rad = e.kind === 'boss' ? 4.2 : e.kind === 'mage' ? 2.4 : e.range;
      const geo = new THREE.RingGeometry(0.15, rad, 24);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
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
      e.telegraphMesh.geometry.dispose();
      (e.telegraphMesh.material as THREE.Material).dispose();
      e.telegraphMesh = null;
    }
  }

  private executeAttack(e: Enemy, playerPos: THREE.Vector3, onPlayerHit: (dmg: number, dir: THREE.Vector3) => void): void {
    const dir = new THREE.Vector3().subVectors(e.attackTarget, e.pos).setY(0).normalize();
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);

    if (e.kind === 'rogue') {
      e.anim.playOneShot('Ranged_1H_Shoot', 0.06, 1.3, 0.35);
      this.sound.playBowTwang(0.8);
      this.spawnProjectile(e.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), dir.multiplyScalar(13.5), e.damage, 0xff4455);
    } else if (e.kind === 'mage') {
      e.anim.playOneShot('Ranged_Magic_Shoot', 0.06, 1.3, 0.4);
      this.sound.playArcaneBlast(0.85);
      this.vfx.spawnRing(e.attackTarget, 2.5, 0xff3366, 0.3);
      const d = Math.hypot(playerPos.x - e.attackTarget.x, playerPos.z - e.attackTarget.z);
      if (d < 2.4) onPlayerHit(e.damage, dir);
    } else if (e.kind === 'boss') {
      e.anim.playOneShot('Melee_1H_Attack_Slice_Horizontal', 0.06, 1.1, 0.5);
      this.sound.playExplosion();
      this.vfx.spawnRing(e.pos, 4.3, 0xff3344, 0.4);
      this.vfx.addCameraShake(dir, 0.35);
      if (e.pos.distanceTo(playerPos) <= 4.3) {
        onPlayerHit(e.damage, dir);
      }
      // Radial bone bolts
      const bolts = e.phase2Triggered ? 8 : 5;
      for (let b = 0; b < bolts; b++) {
        const a = (b / bolts) * Math.PI * 2;
        this.spawnProjectile(
          e.pos.clone().add(new THREE.Vector3(0, 1.2, 0)),
          new THREE.Vector3(Math.cos(a) * 9.5, 0, Math.sin(a) * 9.5),
          Math.round(e.damage * 0.65),
          0xff3355
        );
      }
    } else {
      e.anim.playOneShot('Melee_1H_Attack_Chop', 0.06, 1.35, 0.35);
      e.vel.addScaledVector(dir, 5.2);
      this.sound.playSwordClang(0.65);
      this.vfx.spawnSlashArc(e.pos, Math.atan2(dir.x, dir.z), e.range, 0xff4444);
      if (e.pos.distanceTo(playerPos) <= e.range + 0.4) {
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
    return this.enemies.find((e) => e.kind === 'boss' && !e.dead) ?? null;
  }

  public clear(): void {
    for (const e of this.enemies) {
      this.clearTelegraph(e);
      this.scene.remove(e.mesh);
    }
    this.enemies = [];
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.projectiles = [];
  }
}
