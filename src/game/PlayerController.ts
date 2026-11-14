import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager';
import { AnimatorHelper } from '../engine/AnimatorHelper';
import { VFXManager } from '../engine/VFXManager';
import { SoundEngine } from '../audio/SoundEngine';
import { HERO_CLASSES } from './classes';
import { DungeonFloorBuilder } from './DungeonGenerator';
import { Enemy, EnemyManager } from './EnemyManager';
import { HeroClassDef, HeroClassId, RelicId } from '../types';

interface PlayerProjectile {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  damage: number;
  isCrit: boolean;
  pierce: number;
  bounces: number;
  explosiveRadius: number;
  hitIds: Set<number>;
  life: number;
  color: number;
}

export class PlayerController {
  public def: HeroClassDef;
  public mesh: THREE.Group;
  public anim: AnimatorHelper;
  public pos: THREE.Vector3;

  public hp = 150;
  public maxHp = 150;
  public relics: RelicId[] = [];
  public kills = 0;
  public gold = 0;

  public attackCd = 0;
  public skillCd = 0;
  public ultCd = 0;
  public dodgeCd = 0;
  public dodgeMaxCd = 1.45;
  public iFrames = 0;
  private whirlwindTimer = 0;
  private whirlwindTick = 0;

  private dodgeTimer = 0;
  private dodgeDir = new THREE.Vector3();
  private dodgeHitIds = new Set<number>();
  private impulseVel = new THREE.Vector3();
  private pendingStrike: { timer: number; yaw: number; combo: number } | null = null;

  private attackComboIdx = 0;
  private hitCounter = 0;
  private footstepTimer = 0;

  private projectiles: PlayerProjectile[] = [];
  private orbitingOrbs: THREE.Mesh[] = [];
  private orbCooldowns = new Map<number, number>();
  private orbAngle = 0;
  private aimYaw = 0;

  private projGeo = new THREE.SphereGeometry(0.24, 10, 10);
  private orbGeo = new THREE.SphereGeometry(0.22, 10, 10);

  constructor(
    classId: HeroClassId,
    private scene: THREE.Scene,
    private assets: AssetManager,
    private vfx: VFXManager,
    private sound: SoundEngine
  ) {
    this.def = HERO_CLASSES[classId];
    this.maxHp = this.def.maxHp;
    this.hp = this.maxHp;

    this.mesh = this.assets.cloneCharacter(this.def.modelFile);
    this.assets.attachToHand(this.mesh, this.def.rightWeapon, 'right');
    if (this.def.leftWeapon) {
      this.assets.attachToHand(this.mesh, this.def.leftWeapon, 'left');
    }
    this.mesh.position.set(0, 0, 0);
    this.scene.add(this.mesh);
    this.pos = this.mesh.position;

    this.anim = new AnimatorHelper(this.mesh, this.assets);
    this.anim.playLoop('Idle_A', 0.1);
  }

  public addRelic(id: RelicId): void {
    this.relics.push(id);
    if (id === 'titanic_cleave') {
      this.maxHp += 35;
      this.hp = Math.min(this.maxHp, this.hp + 35);
      this.vfx.spawnDamageNumber(this.pos, 35, 'heal');
    }
    if (id === 'orbiting_orbs' && this.orbitingOrbs.length === 0) {
      for (let i = 0; i < 3; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xff7722 });
        const orb = new THREE.Mesh(this.orbGeo, mat);
        this.scene.add(orb);
        this.orbitingOrbs.push(orb);
      }
    }
  }

  public hasRelic(id: RelicId): boolean {
    return this.relics.includes(id);
  }

  private getDamageStat(): { dmg: number; isCrit: boolean } {
    let base = this.def.damage;
    if (this.hasRelic('titanic_cleave')) base *= 1.28;
    let crit = this.def.critChance;
    if (this.hasRelic('berserker_blood')) crit += 0.15;
    if (this.hasRelic('swiftfoot')) crit += 0.1;
    const isCrit = Math.random() < crit;
    return { dmg: Math.round(base * (isCrit ? 1.8 : 1.0)), isCrit };
  }

  private getCdMult(): number {
    return this.hasRelic('arcane_echo') ? 0.7 : 1.0;
  }

  public update(
    dt: number,
    moveInput: THREE.Vector2,
    aimWorld: THREE.Vector3,
    attackHeld: boolean,
    skillPressed: boolean,
    ultPressed: boolean,
    dodgePressed: boolean,
    dungeon: DungeonFloorBuilder,
    enemies: EnemyManager
  ): void {
    this.anim.update(dt);
    if (this.attackCd > 0) this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.skillCd > 0) this.skillCd = Math.max(0, this.skillCd - dt);
    if (this.ultCd > 0) this.ultCd = Math.max(0, this.ultCd - dt);
    if (this.dodgeCd > 0) this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    if (this.iFrames > 0) this.iFrames = Math.max(0, this.iFrames - dt);

    // Barbarian Bloodlust Tempest whirlwind loop
    if (this.whirlwindTimer > 0) {
      this.whirlwindTimer -= dt;
      this.whirlwindTick -= dt;
      this.mesh.rotation.y += dt * 16;
      if (this.whirlwindTick <= 0) {
        this.whirlwindTick = 0.22;
        this.sound.playAxeThud(0.85);
        this.vfx.spawnSlashArc(this.pos, this.mesh.rotation.y, 3.6, 0xf97316, true, 0.1);
        for (const e of [...enemies.enemies]) {
          if (!e.dead && e.pos.distanceTo(this.pos) <= 3.7) {
            const dir = new THREE.Vector3().subVectors(e.pos, this.pos).setY(0).normalize();
            this.applyHitToEnemy(e, Math.round(this.def.damage * 0.85), dir, Math.random() < 0.35, enemies, 0);
          }
        }
      }
    }

    // Apply physical lunge / knockback impulse
    if (this.impulseVel.lengthSq() > 0.01) {
      this.tryMove(this.impulseVel.x * dt, this.impulseVel.z * dt, dungeon);
      this.impulseVel.multiplyScalar(Math.pow(0.008, dt));
    }

    // Resolve synced weapon swing impact
    if (this.pendingStrike) {
      this.pendingStrike.timer -= dt;
      if (this.pendingStrike.timer <= 0) {
        const s = this.pendingStrike;
        this.pendingStrike = null;
        this.resolvePrimaryImpact(s.yaw, s.combo, enemies);
      }
    }

    // Aim direction
    const dxAim = aimWorld.x - this.pos.x;
    const dzAim = aimWorld.z - this.pos.z;
    if (dxAim * dxAim + dzAim * dzAim > 0.01) {
      this.aimYaw = Math.atan2(dxAim, dzAim);
    }

    // Dodge roll
    if (dodgePressed && this.dodgeCd <= 0 && this.dodgeTimer <= 0) {
      this.dodgeTimer = 0.28;
      this.iFrames = 0.36;
      this.dodgeCd = this.dodgeMaxCd * this.getCdMult();
      this.dodgeHitIds.clear();
      if (moveInput.lengthSq() > 0.01) {
        this.dodgeDir.set(moveInput.x, 0, moveInput.y).normalize();
      } else {
        this.dodgeDir.set(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw));
      }
      this.mesh.rotation.y = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
      this.anim.clearOneShot();
      this.anim.playOneShot('Dodge_Forward', 0.05, 1.55, 0.28);
      this.sound.playDodge();
      this.vfx.spawnBurst(this.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), 0x94a3b8, 8, 3.5);

      if (this.hasRelic('frost_dodge')) {
        this.sound.playIceNova();
        this.vfx.spawnRing(this.pos, 4.0, 0x38bdf8, 0.38);
        for (const e of enemies.enemies) {
          if (!e.dead && e.pos.distanceTo(this.pos) <= 4.0) {
            e.chillTimer = 2.5;
            this.applyHitToEnemy(e, 14, this.dodgeDir, false, enemies, 0);
          }
        }
      }
    }

    // Movement
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= dt;
      const spd = (this.hasRelic('swiftfoot') ? 19.5 : 16.0);
      this.tryMove(this.dodgeDir.x * spd * dt, this.dodgeDir.z * spd * dt, dungeon);

      if (this.hasRelic('vampiric_dash')) {
        for (const e of enemies.enemies) {
          if (!e.dead && !this.dodgeHitIds.has(e.id) && e.pos.distanceTo(this.pos) <= 1.65) {
            this.dodgeHitIds.add(e.id);
            this.applyHitToEnemy(e, 18, this.dodgeDir, false, enemies, 0);
            this.heal(6);
          }
        }
      }
    } else {
      const moveLen = moveInput.length();
      if (moveLen > 0.05) {
        const spd = this.def.speed * (this.hasRelic('swiftfoot') ? 1.2 : 1.0);
        const vx = (moveInput.x / moveLen) * spd;
        const vz = (moveInput.y / moveLen) * spd;
        this.tryMove(vx * dt, vz * dt, dungeon);
        this.mesh.rotation.y = attackHeld ? this.aimYaw : Math.atan2(vx, vz);
        this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0.14, Math.min(1, dt * 10));
        this.anim.playLoop(this.def.runClip, 0.12, 1.1);

        this.footstepTimer -= dt;
        if (this.footstepTimer <= 0) {
          this.footstepTimer = 0.28;
          this.sound.playFootstep();
        }
      } else {
        this.mesh.rotation.y = this.aimYaw;
        this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0, Math.min(1, dt * 10));
        this.anim.playLoop('Idle_A', 0.14);
      }

      // Signature Active Skills & Ultimate
      if (ultPressed && this.ultCd <= 0) {
        this.useUltimate(aimWorld, enemies);
      } else if (skillPressed && this.skillCd <= 0) {
        this.useActiveSkill(dungeon, enemies);
      } else if (attackHeld && this.attackCd <= 0 && this.whirlwindTimer <= 0) {
        this.usePrimaryAttack(enemies);
      }
    }

    // Spike trap collision
    if (this.iFrames <= 0) {
      for (const trap of dungeon.traps) {
        if (trap.active && Math.abs(this.pos.x - trap.x) < 1.35 && Math.abs(this.pos.z - trap.z) < 1.35) {
          this.takeDamage(12, new THREE.Vector3(0, 0, 1));
          break;
        }
      }
    }

    // Orbiting Flame Orbs relic
    if (this.orbitingOrbs.length > 0) {
      this.orbAngle += dt * 3.4;
      for (let i = 0; i < this.orbitingOrbs.length; i++) {
        const a = this.orbAngle + (i * Math.PI * 2) / this.orbitingOrbs.length;
        const ox = this.pos.x + Math.cos(a) * 2.1;
        const oz = this.pos.z + Math.sin(a) * 2.1;
        this.orbitingOrbs[i].position.set(ox, 1.05, oz);
        for (const e of enemies.enemies) {
          if (e.dead) continue;
          const lastHit = this.orbCooldowns.get(e.id) ?? 0;
          if (performance.now() - lastHit > 450 && Math.hypot(e.pos.x - ox, e.pos.z - oz) < e.radius + 0.55) {
            this.orbCooldowns.set(e.id, performance.now());
            const dir = new THREE.Vector3(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z).normalize();
            this.applyHitToEnemy(e, 14, dir, false, enemies, 0);
          }
        }
      }
    }

    // Update Player Projectiles
    this.updateProjectiles(dt, dungeon, enemies);
  }

  private tryMove(dx: number, dz: number, dungeon: DungeonFloorBuilder): void {
    if (dungeon.isWalkable(this.pos.x + dx, this.pos.z, 0.48)) this.pos.x += dx;
    if (dungeon.isWalkable(this.pos.x, this.pos.z + dz, 0.48)) this.pos.z += dz;
  }

  private usePrimaryAttack(_enemies: EnemyManager): void {
    const atkSpdMult = this.hasRelic('berserker_blood') ? 1.25 : 1.0;
    this.attackCd = this.def.attackCooldown / atkSpdMult;
    this.mesh.rotation.y = this.aimYaw;

    const combo = this.attackComboIdx++;
    const clip = this.def.attackClips[combo % this.def.attackClips.length];
    this.anim.playOneShot(clip, 0.05, 1.35 * atkSpdMult, Math.min(0.28, this.attackCd * 0.85));

    const forward = new THREE.Vector3(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw));
    if (!this.def.isRanged) {
      // Physical forward step/lunge into the swing
      this.impulseVel.addScaledVector(forward, this.def.id === 'barbarian' ? 6.2 : 4.8);
    }

    const windup = this.def.isRanged ? 0.07 : this.def.id === 'barbarian' ? 0.14 : this.def.id === 'rogue' ? 0.06 : 0.10;
    this.pendingStrike = { timer: windup / atkSpdMult, yaw: this.aimYaw, combo };
  }

  private resolvePrimaryImpact(yaw: number, combo: number, enemies: EnemyManager): void {
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const { dmg, isCrit } = this.getDamageStat();

    if (this.def.isRanged) {
      if (this.def.id === 'ranger') this.sound.playBowTwang();
      else this.sound.playArcaneBlast();
      this.impulseVel.addScaledVector(forward, -1.6);

      const spawnPos = this.pos.clone().add(new THREE.Vector3(forward.x * 0.7, 1.15, forward.z * 0.7));
      this.spawnProjectile(
        spawnPos,
        forward.clone().multiplyScalar(this.def.id === 'ranger' ? 22 : 17),
        dmg,
        isCrit,
        0,
        this.hasRelic('ricochet') ? 1 : 0,
        0,
        this.def.projectileColor ?? 0xfde047
      );
    } else {
      if (this.def.id === 'barbarian') this.sound.playAxeThud();
      else this.sound.playSwordClang();

      const reach = this.def.range + (this.hasRelic('ricochet') ? 0.7 : 0);
      const isFullCircle = this.def.id === 'barbarian';
      const tilt = combo % 2 === 0 ? 0.32 : -0.32;
      this.vfx.spawnSlashArc(this.pos, yaw, reach, parseInt(this.def.accentHex.slice(1), 16), isFullCircle, tilt);

      let hitAny = false;
      for (const e of [...enemies.enemies]) {
        if (e.dead) continue;
        const toE = new THREE.Vector3().subVectors(e.pos, this.pos).setY(0);
        const dist = toE.length();
        if (dist <= reach + e.radius) {
          const dir = dist > 0.01 ? toE.clone().divideScalar(dist) : forward;
          if (isFullCircle || forward.dot(dir) > 0.15 || dist < 1.2) {
            this.applyHitToEnemy(e, dmg, dir, isCrit, enemies, 0);
            this.vfx.spawnSpriteFX(e.pos, 'slash', isCrit ? 2.6 : 1.9, parseInt(this.def.accentHex.slice(1), 16));
            hitAny = true;
          }
        }
      }
      if (hitAny) {
        this.vfx.triggerHitStop(isCrit || this.def.id === 'barbarian' ? 0.048 : 0.024);
        this.vfx.addCameraShake(forward, isCrit ? 0.26 : this.def.id === 'barbarian' ? 0.18 : 0.10);
      }
    }
  }

  private useUltimate(aimWorld: THREE.Vector3, enemies: EnemyManager): void {
    this.ultCd = this.def.ultCooldown * this.getCdMult();
    this.sound.playBattleCry();
    const { dmg } = this.getDamageStat();
    const forward = new THREE.Vector3(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw));

    if (this.def.id === 'knight') {
      // Aegis Judgment: Heal +25, 2s i-frames, 5m consecrated lightning smite
      this.anim.playOneShot('Melee_1H_Attack_Jump_Chop', 0.05, 1.15, 0.45);
      this.heal(25);
      this.iFrames = Math.max(this.iFrames, 2.0);
      this.sound.playExplosion();
      this.vfx.spawnRing(this.pos, 5.2, 0xfacc15, 0.55);
      this.vfx.addCameraShake(forward, 0.35);
      this.vfx.triggerHitStop(0.05);
      for (const e of [...enemies.enemies]) {
        if (!e.dead && e.pos.distanceTo(this.pos) <= 5.2) {
          const dir = new THREE.Vector3().subVectors(e.pos, this.pos).setY(0).normalize();
          this.vfx.spawnLightningArc(this.pos, e.pos, 0xfde047);
          this.applyHitToEnemy(e, Math.round(dmg * 2.2), dir, true, enemies, 1.2);
        }
      }
    } else if (this.def.id === 'barbarian') {
      // Bloodlust Tempest: 2.5s spinning whirlwind
      this.anim.playOneShot('Melee_2H_Attack_Spinning', 0.05, 1.4, 2.5);
      this.whirlwindTimer = 2.5;
      this.whirlwindTick = 0.05;
      this.vfx.spawnRing(this.pos, 3.8, 0xf97316, 0.4);
    } else if (this.def.id === 'rogue') {
      // Fan of Knives: 10 piercing daggers 360 deg
      this.anim.playOneShot('Melee_Dualwield_Attack_Slice', 0.05, 1.5, 0.3);
      this.sound.playSwordClang(1.2);
      const spawnPos = this.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        this.spawnProjectile(spawnPos.clone(), dir.multiplyScalar(20), Math.round(dmg * 1.5), true, 2, 0, 0, 0x34d399);
      }
    } else if (this.def.id === 'mage') {
      // Arcane Meteor Storm: 5 explosive blasts around cursor
      this.anim.playOneShot('Ranged_Magic_Summon', 0.05, 1.4, 0.45);
      this.sound.playExplosion();
      const targetCenter = aimWorld.clone().setY(0.1);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const r = i === 0 ? 0 : 2.3;
        const hitPos = targetCenter.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
        this.triggerAoEExplosion(hitPos, 3.0, Math.round(dmg * 1.6), enemies, -1);
      }
    } else if (this.def.id === 'ranger') {
      // Arrow Rain: 12 arrows raining onto cursor area
      this.anim.playOneShot('Ranged_Bow_Release_Up', 0.05, 1.3, 0.4);
      this.sound.playBowTwang(1.3);
      const targetCenter = aimWorld.clone().setY(0.1);
      this.vfx.spawnRing(targetCenter, 4.5, 0xfde047, 0.55);
      this.vfx.spawnBurst(targetCenter.clone().add(new THREE.Vector3(0, 1.5, 0)), 0xfde047, 24, 7);
      for (const e of [...enemies.enemies]) {
        if (!e.dead && e.pos.distanceTo(targetCenter) <= 4.6) {
          const dir = new THREE.Vector3().subVectors(e.pos, targetCenter).setY(0).normalize();
          this.applyHitToEnemy(e, Math.round(dmg * 2.4), dir, true, enemies, 0.6);
        }
      }
    }
  }

  private useActiveSkill(dungeon: DungeonFloorBuilder, enemies: EnemyManager): void {
    this.skillCd = this.def.skillCooldown * this.getCdMult();
    this.sound.playBattleCry();
    this.mesh.rotation.y = this.aimYaw;
    const forward = new THREE.Vector3(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw));
    const { dmg } = this.getDamageStat();

    if (this.def.id === 'knight') {
      // Shield Bash: forward dash + 3.2m AoE stun 1.8s
      this.anim.playOneShot('Melee_Block_Attack', 0.05, 1.3, 0.35);
      this.sound.playAxeThud(1.2);
      this.iFrames = Math.max(this.iFrames, 0.3);
      for (let s = 0; s < 6; s++) this.tryMove(forward.x * 0.55, forward.z * 0.55, dungeon);
      this.vfx.spawnRing(this.pos, 3.3, 0x60a5fa, 0.32);
      this.vfx.addCameraShake(forward, 0.28);
      this.vfx.triggerHitStop(0.04);
      for (const e of [...enemies.enemies]) {
        if (!e.dead && e.pos.distanceTo(this.pos) <= 3.3) {
          const dir = new THREE.Vector3().subVectors(e.pos, this.pos).setY(0).normalize();
          this.applyHitToEnemy(e, Math.round(dmg * 1.65), dir, true, enemies, 1.8);
        }
      }
    } else if (this.def.id === 'barbarian') {
      // Seismic Leap
      this.anim.playOneShot('Melee_2H_Attack_Chop', 0.05, 1.2, 0.42);
      this.sound.playExplosion();
      for (let s = 0; s < 8; s++) this.tryMove(forward.x * 0.65, forward.z * 0.65, dungeon);
      this.vfx.spawnRing(this.pos, 4.4, 0xf97316, 0.42);
      this.vfx.spawnBurst(this.pos, 0xf97316, 18, 6);
      this.vfx.addCameraShake(forward, 0.4);
      this.vfx.triggerHitStop(0.04);
      for (const e of [...enemies.enemies]) {
        if (!e.dead && e.pos.distanceTo(this.pos) <= 4.4) {
          const dir = new THREE.Vector3().subVectors(e.pos, this.pos).setY(0).normalize();
          this.applyHitToEnemy(e, Math.round(dmg * 2.1), dir, true, enemies, 1.4);
        }
      }
    } else if (this.def.id === 'rogue') {
      // Shadow Dash backstab
      this.anim.playOneShot('Melee_Dualwield_Attack_Stab', 0.05, 1.6, 0.3);
      this.sound.playDodge();
      this.iFrames = Math.max(this.iFrames, 0.35);
      this.vfx.spawnBurst(this.pos, 0x34d399, 12, 4);
      for (let s = 0; s < 10; s++) this.tryMove(forward.x * 0.6, forward.z * 0.6, dungeon);
      this.vfx.spawnBurst(this.pos, 0x34d399, 14, 5);
      this.vfx.spawnSlashArc(this.pos, this.aimYaw, 3.0, 0x34d399, true);
      this.vfx.triggerHitStop(0.04);
      for (const e of [...enemies.enemies]) {
        if (!e.dead && e.pos.distanceTo(this.pos) <= 3.0) {
          this.applyHitToEnemy(e, Math.round(dmg * 2.4), forward, true, enemies, 0);
        }
      }
    } else if (this.def.id === 'mage') {
      // Piercing Fireball AoE
      this.anim.playOneShot('Ranged_Magic_Spellcasting', 0.05, 1.4, 0.35);
      this.sound.playArcaneBlast(1.2);
      const spawnPos = this.pos.clone().add(new THREE.Vector3(forward.x * 0.8, 1.2, forward.z * 0.8));
      this.spawnProjectile(spawnPos, forward.clone().multiplyScalar(15), Math.round(dmg * 2.1), true, 3, 0, 3.6, 0xff5500);
    } else if (this.def.id === 'ranger') {
      // Multi-Arrow Volley (5 arrows)
      this.anim.playOneShot('Ranged_Bow_Release', 0.05, 1.4, 0.3);
      this.sound.playBowTwang(1.2);
      const spawnPos = this.pos.clone().add(new THREE.Vector3(forward.x * 0.7, 1.15, forward.z * 0.7));
      for (let i = -2; i <= 2; i++) {
        const a = this.aimYaw + i * 0.16;
        const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        this.spawnProjectile(spawnPos.clone(), dir.multiplyScalar(22), Math.round(dmg * 1.1), i === 0, 1, this.hasRelic('ricochet') ? 1 : 0, 0, 0xfde047);
      }
    }
  }

  private spawnProjectile(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    damage: number,
    isCrit: boolean,
    pierce: number,
    bounces: number,
    explosiveRadius: number,
    color: number
  ): void {
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(this.projGeo, mat);
    mesh.position.copy(pos);
    if (explosiveRadius > 0) mesh.scale.setScalar(1.65);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      vel,
      damage,
      isCrit,
      pierce,
      bounces,
      explosiveRadius,
      hitIds: new Set(),
      life: 1.6,
      color,
    });
  }

  private updateProjectiles(dt: number, dungeon: DungeonFloorBuilder, enemies: EnemyManager): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);

      const wallHit = !dungeon.isWalkable(p.mesh.position.x, p.mesh.position.z, 0.15);
      let consumed = p.life <= 0 || wallHit;

      if (!consumed) {
        for (const e of [...enemies.enemies]) {
          if (e.dead || p.hitIds.has(e.id)) continue;
          const dx = e.pos.x - p.mesh.position.x;
          const dz = e.pos.z - p.mesh.position.z;
          if (dx * dx + dz * dz <= (e.radius + 0.35) * (e.radius + 0.35)) {
            p.hitIds.add(e.id);
            const dir = p.vel.clone().setY(0).normalize();
            this.applyHitToEnemy(e, p.damage, dir, p.isCrit, enemies, 0);

            if (p.explosiveRadius > 0) {
              this.triggerAoEExplosion(p.mesh.position, p.explosiveRadius, p.damage, enemies, e.id);
            }

            if (p.pierce > 0) {
              p.pierce--;
            } else if (p.bounces > 0) {
              p.bounces--;
              const next = enemies.enemies.find((other) => !other.dead && !p.hitIds.has(other.id) && other.pos.distanceTo(e.pos) < 8);
              if (next) {
                const spd = p.vel.length();
                p.vel.subVectors(next.pos, p.mesh.position).setY(0).normalize().multiplyScalar(spd);
              } else {
                consumed = true;
              }
            } else {
              consumed = true;
            }
            break;
          }
        }
      } else if (wallHit && p.explosiveRadius > 0) {
        this.triggerAoEExplosion(p.mesh.position, p.explosiveRadius, p.damage, enemies, -1);
      }

      if (consumed) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private triggerAoEExplosion(center: THREE.Vector3, radius: number, dmg: number, enemies: EnemyManager, skipId: number): void {
    this.sound.playExplosion();
    this.vfx.spawnRing(center, radius, 0xff6600, 0.35);
    this.vfx.spawnBurst(center, 0xff8822, 16, 6);
    this.vfx.addCameraShake(new THREE.Vector3(0, 1, 0), 0.25);
    for (const e of [...enemies.enemies]) {
      if (!e.dead && e.id !== skipId && e.pos.distanceTo(center) <= radius) {
        const dir = new THREE.Vector3().subVectors(e.pos, center).setY(0).normalize();
        this.applyHitToEnemy(e, Math.round(dmg * 0.75), dir, false, enemies, 0);
      }
    }
  }

  private applyHitToEnemy(
    enemy: Enemy,
    damage: number,
    dir: THREE.Vector3,
    isCrit: boolean,
    enemies: EnemyManager,
    stunSec: number
  ): void {
    const killed = enemies.damageEnemy(enemy, damage, dir, isCrit, stunSec);
    if (killed) {
      this.kills++;
      this.gold += enemy.kind === 'boss' ? 120 : 12;
      if (this.hasRelic('berserker_blood')) this.heal(4);
    }

    this.hitCounter++;
    if (this.hasRelic('chain_lightning') && this.hitCounter % 3 === 0) {
      let prevPos = enemy.pos;
      let count = 0;
      for (const other of [...enemies.enemies]) {
        if (!other.dead && other.id !== enemy.id && other.pos.distanceTo(prevPos) < 7.5) {
          this.vfx.spawnLightningArc(prevPos, other.pos);
          const k = enemies.damageEnemy(other, Math.round(this.def.damage * 0.65), dir, false, 0);
          if (k) this.kills++;
          prevPos = other.pos;
          count++;
          if (count >= 3) break;
        }
      }
    }

    if (isCrit && this.hasRelic('explosive_crits')) {
      this.vfx.spawnRing(enemy.pos, 2.8, 0xff7722, 0.28);
      for (const other of [...enemies.enemies]) {
        if (!other.dead && other.id !== enemy.id && other.pos.distanceTo(enemy.pos) <= 2.8) {
          enemies.damageEnemy(other, Math.round(damage * 0.65), dir, false, 0);
        }
      }
    }
  }

  public takeDamage(amount: number, dir: THREE.Vector3): void {
    if (this.iFrames > 0 || this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.iFrames = 0.45;
    this.impulseVel.addScaledVector(dir, 6.5);
    this.sound.playPlayerHit();
    this.vfx.addCameraShake(dir, 0.34);
    this.vfx.spawnDamageNumber(this.pos, amount, 'player-hit');
    this.anim.playOneShot('Hit_A', 0.05, 1.4, 0.22);
    if (this.hp <= 0) {
      this.anim.clearOneShot();
      this.anim.playOneShot('Death_A', 0.08, 1.0, 2.0);
    }
  }

  public heal(amount: number): void {
    const actual = Math.min(this.maxHp - this.hp, amount);
    if (actual > 0) {
      this.hp += actual;
      this.vfx.spawnDamageNumber(this.pos, actual, 'heal');
    }
  }

  public destroy(): void {
    this.scene.remove(this.mesh);
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const o of this.orbitingOrbs) this.scene.remove(o);
    this.projectiles = [];
    this.orbitingOrbs = [];
  }
}
