import * as THREE from 'three';
import { MaterialFX } from '../graphics/MaterialFX';
import { AssetManager } from '../assets/AssetManager';
import { AnimatorHelper } from '../engine/AnimatorHelper';
import { VFXManager } from '../engine/VFXManager';
import { SoundEngine } from '../audio/SoundEngine';
import { HERO_CLASSES } from './classes';
import { DungeonFloorBuilder } from './DungeonGenerator';
import { Enemy, EnemyManager } from './EnemyManager';
import { RagnarokStatsSystem, ElementType } from './RagnarokStatsSystem';
import { SkillSystem, ROSkillId, RO_SKILLS, CLASS_SKILL_TREES } from './SkillSystem';
import { HeroClassDef, HeroClassId, KafraItem, RelicId, SkillNodeId } from '../types';

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
  kind: 'arrow' | 'magic' | 'dagger';
  trailTimer: number;
}

export class PlayerController {
  public def: HeroClassDef;
  public mesh: THREE.Group;
  public anim: AnimatorHelper;
  public pos: THREE.Vector3;

  public hp = 150;
  public maxHp = 150;
  public sp = 100;
  public maxSp = 100;
  public roStats!: RagnarokStatsSystem;
  public roSkills!: SkillSystem;
  public redPotions = 5;
  public bluePotions = 3;
  public kafraStorage: KafraItem[] = [
    { id: 'slime_sigil', name: 'Ooze Core Sigil', desc: '+5 LUK (Crit & Lucky Dodge)', icon: '🧪', bonusStat: 'luk', bonusAmt: 5 },
    { id: 'colossus_sigil', name: 'Bone Colossus Sigil', desc: '+10 VIT (Tank Soft DEF & HP)', icon: '🛡️', bonusStat: 'vit', bonusAmt: 10 },
    { id: 'orc_sigil', name: 'Orc Warband Sigil', desc: '+8 STR (Physical ATK)', icon: '⚔️', bonusStat: 'str', bonusAmt: 8 },
    { id: 'lich_sigil', name: 'Ossuary Lich Sigil', desc: '+8 INT (MATK & Max SP)', icon: '🔮', bonusStat: 'int', bonusAmt: 8 },
  ];
  public equippedCard: KafraItem | null = null;
  /** Card socketed into Garrett's Atonement Blade [1] (second card slot). */
  public socketCard: KafraItem | null = null;
  public hasAtonementBlade = false;
  /** Pip's soul-gold ledger bonus to monster Zeny drops. */
  public goldMult = 1;
  /** Job Advancement title reclaimed from the Spire Warden's sealed power. */
  public jobTitle: string | null = null;
  /** Mira's Elemental Converter weapon endow. */
  public endowElement: ElementType | null = null;
  public endowTimer = 0;
  private auraSparkTimer = 0;
  private auraLight: THREE.PointLight | null = null;
  public relics: RelicId[] = [];
  public kills = 0;
  public gold = 0;
  public level = 1;
  public xp = 0;
  public xpToNext = 90;
  public skillPoints = 1;
  public unlockedSkills = new Set<SkillNodeId>();
  public onLevelUp?: (level: number) => void;

  public attackCd = 0;
  public skillCd = 0;
  public skill2Cd = 0;
  public ultCd = 0;
  public skill4Cd = 0;
  public dodgeCd = 0;
  public dodgeMaxCd = 1.45;
  public iFrames = 0;
  public castingSkill: { id: ROSkillId; name: string; timer: number; total: number; aimWorld: THREE.Vector3 } | null = null;
  private regenTickTimer = 0;
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
    this.roStats = new RagnarokStatsSystem(classId);
    this.roSkills = new SkillSystem(classId);
    const derived = this.getDerived();
    this.maxHp = derived.maxHp;
    this.hp = this.maxHp;
    this.maxSp = derived.maxSp;
    this.sp = this.maxSp;

    this.mesh = this.assets.cloneCharacter(this.def.modelFile);
    if (this.def.rightWeapon) {
      this.assets.attachToHand(this.mesh, this.def.rightWeapon, 'right');
    }
    if (this.def.leftWeapon) {
      this.assets.attachToHand(this.mesh, this.def.leftWeapon, 'left');
    }
    this.mesh.position.set(0, 0, 0);
    this.scene.add(this.mesh);
    this.pos = this.mesh.position;

    this.anim = new AnimatorHelper(this.mesh, this.assets);
    this.anim.playLoop('Idle_A', 0.1);

    // Hero shading: cool fresnel rim so the silhouette pops against every biome
    MaterialFX.apply(this.mesh, 0xa5b4fc, 0.42, 2.8);
    this.updateWeaponRefineVisuals();
  }

  /** Weapon roots attached to the hand slots (for shimmer auras & spark emitters). */
  private getWeaponRoots(): THREE.Object3D[] {
    const roots: THREE.Object3D[] = [];
    for (const name of ['handslotr', 'handslot.r', 'handr', 'handslotl', 'handslot.l', 'handl']) {
      const bone = this.mesh.getObjectByName(name);
      if (bone) {
        for (const c of bone.children) {
          if (!roots.includes(c) && !(c instanceof THREE.Light) && !(c instanceof THREE.Bone)) roots.push(c);
        }
      }
    }
    return roots;
  }

  public grantAtonementBlade(): void {
    if (this.hasAtonementBlade) return;
    this.hasAtonementBlade = true;
    this.roStats.baseWeaponAtk += 12;
    this.roStats.baseWeaponMatk += 10;
    this.getDerived();
  }

  public equipSocketCard(card: KafraItem | null): void {
    if (!this.hasAtonementBlade) return;
    if (this.socketCard?.bonusStat && this.socketCard.bonusAmt) {
      this.roStats.bonus[this.socketCard.bonusStat] = Math.max(
        0,
        this.roStats.bonus[this.socketCard.bonusStat] - this.socketCard.bonusAmt
      );
    }
    this.socketCard = card;
    if (card?.bonusStat && card.bonusAmt) {
      this.roStats.bonus[card.bonusStat] += card.bonusAmt;
    }
    this.getDerived();
  }

  public setEndow(element: ElementType, seconds: number): void {
    this.endowElement = element;
    this.endowTimer = seconds;
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

  public getDerived() {
    const d = this.roStats.getDerived(this.def.isRanged);
    this.maxHp = d.maxHp;
    this.maxSp = d.maxSp;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    if (this.sp > this.maxSp) this.sp = this.maxSp;
    return d;
  }

  public equipKafraCard(card: KafraItem | null): void {
    if (card && this.socketCard?.id === card.id) this.equipSocketCard(null);
    if (this.equippedCard?.bonusStat && this.equippedCard.bonusAmt) {
      this.roStats.bonus[this.equippedCard.bonusStat] = Math.max(
        0,
        this.roStats.bonus[this.equippedCard.bonusStat] - this.equippedCard.bonusAmt
      );
    }
    this.equippedCard = card;
    if (card?.bonusStat && card.bonusAmt) {
      this.roStats.bonus[card.bonusStat] += card.bonusAmt;
    }
    this.getDerived();
  }

  public useRedPotion(): boolean {
    if (this.redPotions <= 0 || this.hp >= this.maxHp) return false;
    this.redPotions--;
    const d = this.getDerived();
    const amt = Math.round(90 * d.potionMult);
    this.heal(amt);
    this.sound.playPotionGulp();
    this.sound.playHeal();
    this.vfx.spawnBurst(this.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), 0xf87171, 10, 3.2);
    return true;
  }

  public useBluePotion(): boolean {
    if (this.bluePotions <= 0 || this.sp >= this.maxSp) return false;
    this.bluePotions--;
    const gain = Math.min(this.maxSp - this.sp, 55);
    this.sp += gain;
    if (gain > 0) {
      this.vfx.spawnROText(this.pos.clone().add(new THREE.Vector3(0, 1.8, 0)), `+${gain}`, 'sp');
    }
    this.sound.playPotionGulp();
    this.vfx.spawnBurst(this.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), 0x60a5fa, 10, 3.2);
    return true;
  }

  public updateWeaponRefineVisuals(): void {
    const ref = this.roStats.weaponRefine;
    // +4..+6 ember glow, +7..+9 cyan/gold shimmer, +10 intense radiant flame aura
    let color = 0x000000;
    let strength = 0;
    if (ref >= 10) {
      color = 0xff8a2a;
      strength = 1.6;
    } else if (ref >= 7) {
      color = ref >= 9 ? 0x7dfcf0 : 0xffd166;
      strength = 0.7 + (ref - 7) * 0.2;
    } else if (ref >= 4) {
      color = 0xf97316;
      strength = 0.15 + (ref - 4) * 0.06;
    }
    for (const w of this.getWeaponRoots()) {
      MaterialFX.applyWeaponShimmer(w, color, strength);
    }
    if (ref >= 7) {
      if (!this.auraLight) {
        this.auraLight = new THREE.PointLight(color, 0, 4.5, 2);
        this.auraLight.position.set(0, 1.2, 0.4);
        this.mesh.add(this.auraLight);
      }
      this.auraLight.color.setHex(ref >= 10 ? 0xff7a1a : color);
      this.auraLight.intensity = ref >= 10 ? 5 : 2.2;
    } else if (this.auraLight) {
      this.auraLight.intensity = 0;
    }
  }

  private updateRefineAura(dt: number): void {
    const ref = this.roStats.weaponRefine;
    if (ref < 7) return;
    this.auraSparkTimer -= dt;
    if (this.auraLight) {
      const base = ref >= 10 ? 5 : 2.2;
      this.auraLight.intensity = base * (0.85 + Math.sin(performance.now() * 0.013) * 0.1 + Math.random() * 0.08);
    }
    if (this.auraSparkTimer <= 0) {
      this.auraSparkTimer = ref >= 10 ? 0.06 : 0.18;
      const roots = this.getWeaponRoots();
      const w = roots[0];
      if (w) {
        const wp = new THREE.Vector3();
        w.getWorldPosition(wp);
        wp.add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.6, (Math.random() - 0.5) * 0.4));
        const col = ref >= 10 ? (Math.random() < 0.5 ? 0xff6a00 : 0xffc04d) : Math.random() < 0.5 ? 0x7dfcf0 : 0xffd166;
        this.vfx.spawnTrailSpark(wp, col, ref >= 10 ? 0.75 : 0.45);
      }
    }
  }

  private getDamageStat(): { dmg: number; isCrit: boolean } {
    const d = this.getDerived();
    const isMage = this.def.id === 'mage';
    let base = isMage
      ? d.matkMin + Math.random() * Math.max(1, d.matkMax - d.matkMin)
      : d.atkMin + Math.random() * Math.max(1, d.atkMax - d.atkMin);
    if (this.hasSkill('weapon_mastery')) base *= 1.18;
    if (this.hasRelic('titanic_cleave')) base *= 1.25;
    if (this.roStats.magnumEndowTimer > 0 && !isMage) base *= 1.2;

    let crit = d.critChance;
    if (this.hasSkill('weapon_mastery')) crit += 0.05;
    if (this.hasRelic('berserker_blood')) crit += 0.1;
    if (this.hasRelic('swiftfoot')) crit += 0.08;
    const isCrit = !isMage && Math.random() < crit;
    return { dmg: Math.round(base * (isCrit ? 1.65 : 1.0)), isCrit };
  }

  private getCdMult(): number {
    let mult = this.hasRelic('arcane_echo') ? 0.7 : 1.0;
    if (this.hasSkill('relentless_tempo')) mult *= 0.85;
    return mult;
  }

  public hasSkill(id: SkillNodeId): boolean {
    return this.unlockedSkills.has(id);
  }

  public unlockSkill(id: SkillNodeId): boolean {
    if (this.skillPoints <= 0 || this.unlockedSkills.has(id)) return false;
    this.skillPoints--;
    this.unlockedSkills.add(id);
    if (id === 'iron_vitality') {
      this.maxHp += 35;
      this.heal(35);
    }
    if (id === 'weapon_mastery') {
      if (this.def.id === 'knight') {
        this.assets.attachToHand(this.mesh, 'weapons/pack_claymore.glb', 'right');
      } else if (this.def.id === 'barbarian') {
        this.assets.attachToHand(this.mesh, 'weapons/pack_hammer_double.glb', 'right');
      }
      this.vfx.spawnBrackeysBurst(this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 'flare', 0xfde047, 2.5, 0.45);
      this.updateWeaponRefineVisuals();
    }
    this.sound.playUIPopup();
    return true;
  }

  public grantXp(amount: number): void {
    this.xp += amount;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = Math.round(this.xpToNext * 1.35);
      this.skillPoints++;
      this.roStats.onLevelUp(this.level);
      this.roSkills.onLevelUp();
      const d = this.getDerived();
      this.hp = d.maxHp;
      this.sp = d.maxSp;
      this.vfx.spawnROText(this.pos.clone().add(new THREE.Vector3(0, 2.2, 0)), 'LEVEL UP!', 'heal');
      this.vfx.spawnBrackeysGroundEffect(this.pos, 'magic_rune', 0xfacc15, 4.2, 0.65, 2);
      this.vfx.spawnBurst(this.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), 0xfde047, 20, 6);
      this.vfx.spawnConsecratedPillar(this.pos, 0xfacc15, 1.6, 5.5);
      this.sound.playLevelUp();
      this.onLevelUp?.(this.level);
    }
  }

  public update(
    dt: number,
    moveInput: THREE.Vector2,
    aimWorld: THREE.Vector3,
    attackHeld: boolean,
    skillPressed: boolean,
    skill2Pressed: boolean,
    ultPressed: boolean,
    dodgePressed: boolean,
    dungeon: DungeonFloorBuilder,
    enemies: EnemyManager,
    skill4Pressed = false
  ): void {
    this.anim.update(dt);
    this.roStats.tickTimers(dt);
    const derived = this.getDerived();

    if (this.attackCd > 0) this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.skillCd > 0) this.skillCd = Math.max(0, this.skillCd - dt);
    if (this.skill2Cd > 0) this.skill2Cd = Math.max(0, this.skill2Cd - dt);
    if (this.ultCd > 0) this.ultCd = Math.max(0, this.ultCd - dt);
    if (this.skill4Cd > 0) this.skill4Cd = Math.max(0, this.skill4Cd - dt);
    if (this.dodgeCd > 0) this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    if (this.iFrames > 0) this.iFrames = Math.max(0, this.iFrames - dt);
    if (this.endowTimer > 0) {
      this.endowTimer = Math.max(0, this.endowTimer - dt);
      if (this.endowTimer <= 0) this.endowElement = null;
    }
    this.updateRefineAura(dt);

    // Natural RO HP/SP Regen ticks every 3s
    this.regenTickTimer += dt;
    if (this.regenTickTimer >= 3.0) {
      this.regenTickTimer = 0;
      if (this.hp > 0 && this.hp < this.maxHp) {
        this.hp = Math.min(this.maxHp, this.hp + derived.hpRegenPerTick);
      }
      if (this.hp > 0 && this.sp < this.maxSp) {
        this.sp = Math.min(this.maxSp, this.sp + derived.spRegenPerTick);
      }
    }

    // Active Cast-Time Chanting (Classic RO 150 DEX instant-cast scaling)
    if (this.castingSkill) {
      if (dodgePressed) {
        this.castingSkill = null;
        this.vfx.hideCastCircle();
        this.sound.stopCastHum(false);
      } else {
        this.castingSkill.timer -= dt;
        const progress = Math.min(1, 1 - this.castingSkill.timer / Math.max(0.01, this.castingSkill.total));
        const castColor = parseInt(this.def.accentHex.slice(1), 16);
        this.vfx.updateCastCircle(this.pos, progress, castColor);
        this.sound.updateCastHum(progress);
        this.mesh.rotation.y = this.aimYaw;
        this.anim.playLoop('Ranged_Magic_Spellcasting', 0.08, 1.15);
        if (this.castingSkill.timer <= 0) {
          const s = this.castingSkill;
          this.castingSkill = null;
          this.vfx.hideCastCircle();
          this.sound.stopCastHum(true);
          this.executeROSkill(s.id, s.aimWorld, dungeon, enemies);
        }
        this.updateProjectiles(dt, dungeon, enemies);
        return;
      }
    }

    // Barbarian Bloodlust Tempest whirlwind loop
    if (this.whirlwindTimer > 0) {
      this.whirlwindTimer -= dt;
      this.whirlwindTick -= dt;
      this.mesh.rotation.y += dt * 16;
      this.anim.clearOneShot();
      this.anim.playLoop('Melee_2H_Attack_Spin', 0.05, 1.65);
      if (this.whirlwindTick <= 0) {
        this.whirlwindTick = 0.22;
        this.sound.playAxeThud(0.85);
        this.vfx.spawnSlashArc(this.pos, this.mesh.rotation.y, 3.6, 0xf97316, true, 0.1);
        this.vfx.spawnBrackeysGroundEffect(this.pos, 'twirl', 0xf97316, 4.2, 0.26, 12);
        this.vfx.spawnBrackeysBurst(this.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), 'flame', 0xff7722, 1.8, 0.24);
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
      this.vfx.kickFov(3.5);
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
        const spd =
          this.def.speed *
          (this.hasRelic('swiftfoot') ? 1.2 : 1.0) *
          (this.hasSkill('iron_vitality') ? 1.12 : 1.0);
        const vx = (moveInput.x / moveLen) * spd;
        const vz = (moveInput.y / moveLen) * spd;
        this.tryMove(vx * dt, vz * dt, dungeon);
        if (this.whirlwindTimer <= 0) {
          this.mesh.rotation.y = attackHeld ? this.aimYaw : Math.atan2(vx, vz);
          this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0.14, Math.min(1, dt * 10));
          this.anim.playLoop(this.def.runClip, 0.12, 1.1);
        }

        this.footstepTimer -= dt;
        if (this.footstepTimer <= 0) {
          this.footstepTimer = 0.28;
          this.sound.playFootstep();
        }
      } else if (this.whirlwindTimer <= 0) {
        this.mesh.rotation.y = this.aimYaw;
        this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0, Math.min(1, dt * 10));
        this.anim.playLoop('Idle_A', 0.14);
      }

      // Signature RO Active Skills (Slots 1-4)
      const tree = CLASS_SKILL_TREES[this.def.id];
      if (skill4Pressed && this.skill4Cd <= 0 && tree[3]) {
        this.triggerROSkill(tree[3], 4, aimWorld, dungeon, enemies);
      } else if (ultPressed && this.ultCd <= 0 && tree[2]) {
        this.triggerROSkill(tree[2], 3, aimWorld, dungeon, enemies);
      } else if (skill2Pressed && this.skill2Cd <= 0 && tree[1]) {
        this.triggerROSkill(tree[1], 2, aimWorld, dungeon, enemies);
      } else if (skillPressed && this.skillCd <= 0 && tree[0]) {
        this.triggerROSkill(tree[0], 1, aimWorld, dungeon, enemies);
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
    const derived = this.getDerived();
    const roAspdMult = derived.aspd / 156;
    const atkSpdMult =
      roAspdMult *
      (this.hasRelic('berserker_blood') ? 1.2 : 1.0) *
      (this.hasSkill('relentless_tempo') ? 1.15 : 1.0);
    this.attackCd = Math.max(0.14, this.def.attackCooldown / atkSpdMult);
    this.mesh.rotation.y = this.aimYaw;

    const combo = this.attackComboIdx++;
    if (!this.def.isRanged) this.sound.playSwing(derived.aspd, this.def.id === 'barbarian');
    const clip = this.def.attackClips[combo % this.def.attackClips.length];
    const swingSpeed = (this.def.id === 'rogue' ? 1.85 : this.def.id === 'barbarian' ? 1.35 : 1.55) * atkSpdMult;
    this.anim.playOneShot(clip, 0.03, swingSpeed);

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
      if (this.def.id === 'ranger') {
        this.vfx.spawnBrackeysBurst(spawnPos, 'spark', 0xfde047, 1.0, 0.16);
      }
      this.spawnProjectile(
        spawnPos,
        forward.clone().multiplyScalar(this.def.id === 'ranger' ? 22 : 17),
        dmg,
        isCrit,
        0,
        this.hasRelic('ricochet') ? 1 : 0,
        0,
        this.def.projectileColor ?? 0xfde047,
        this.def.id === 'ranger' ? 'arrow' : 'magic'
      );
    } else {
      const reach = this.def.range + (this.hasRelic('ricochet') ? 0.7 : 0);
      const isFullCircle = this.def.id === 'barbarian';
      const isRogue = this.def.id === 'rogue';
      const tilt = isRogue ? (combo % 2 === 0 ? 0.68 : -0.68) : (combo % 2 === 0 ? 0.28 : -0.28);
      const arcOverride = isRogue ? Math.PI * 0.34 : undefined;
      const arcDur = isRogue ? 0.09 : isFullCircle ? 0.18 : 0.14;
      const spriteKind = isRogue ? 'slash_rogue' : isFullCircle ? 'slash_barbarian' : 'slash';

      this.vfx.spawnSlashArc(this.pos, yaw, reach, parseInt(this.def.accentHex.slice(1), 16), isFullCircle, tilt, arcOverride, arcDur);
      const accentColor = parseInt(this.def.accentHex.slice(1), 16);
      if (isFullCircle) {
        this.vfx.spawnBrackeysGroundEffect(this.pos, 'twirl', accentColor, 3.2, 0.24, 10);
      } else {
        this.vfx.spawnBrackeysSlash(this.pos, yaw, accentColor, isRogue ? 2.3 : 2.8, isRogue);
      }

      let hitAny = false;
      for (const e of [...enemies.enemies]) {
        if (e.dead) continue;
        const toE = new THREE.Vector3().subVectors(e.pos, this.pos).setY(0);
        const dist = toE.length();
        if (dist <= reach + e.radius) {
          const dir = dist > 0.01 ? toE.clone().divideScalar(dist) : forward;
          if (isFullCircle || forward.dot(dir) > 0.15 || dist < 1.2) {
            this.applyHitToEnemy(e, dmg, dir, isCrit, enemies, 0);
            this.vfx.spawnSpriteFX(e.pos, spriteKind, isCrit ? 2.6 : 1.9, parseInt(this.def.accentHex.slice(1), 16));
            hitAny = true;
          }
        }
      }
      if (hitAny) {
        if (this.def.id === 'barbarian') this.sound.at(this.pos).playAxeThud();
        else this.sound.at(this.pos).playSwordClang();
        if (isCrit) this.sound.playCrit();
        this.vfx.triggerHitStop(isCrit ? 0.045 : this.def.id === 'barbarian' ? 0.04 : 0.024);
        this.vfx.addCameraShake(forward, isCrit ? 0.26 : this.def.id === 'barbarian' ? 0.18 : 0.10);
        if (isCrit) this.vfx.kickFov(1.5);
      }
    }
  }

  private getSkillDamageMult(): number {
    return this.hasSkill('skill_overcharge') ? 1.35 : 1.0;
  }

  private triggerROSkill(
    id: ROSkillId,
    slot: 1 | 2 | 3 | 4,
    aimWorld: THREE.Vector3,
    dungeon: DungeonFloorBuilder,
    enemies: EnemyManager
  ): void {
    const lv = this.roSkills.getLevel(id);
    if (lv <= 0) {
      this.vfx.spawnROText(this.pos.clone().add(new THREE.Vector3(0, 1.9, 0)), 'Skill Lv 0!', 'miss');
      return;
    }
    const def = RO_SKILLS[id];
    const spCost = def.spCost(lv);
    if (this.sp < spCost) {
      this.vfx.spawnROText(this.pos.clone().add(new THREE.Vector3(0, 1.9, 0)), 'Not enough SP!', 'miss');
      return;
    }

    const derived = this.getDerived();
    const castTime = this.roSkills.getEffectiveCastTime(id, derived);
    const cd = Math.max(0.4, def.cooldown(lv) * this.getCdMult() * (id === 'sonic_blow' || id === 'double_strafe' ? Math.max(0.45, 1 - (derived.aspd - 150) * 0.01) : 1));
    if (slot === 1) this.skillCd = cd;
    else if (slot === 2) this.skill2Cd = cd;
    else if (slot === 3) this.ultCd = cd;
    else this.skill4Cd = cd;

    this.sp -= spCost;
    if (castTime <= 0.02) {
      this.executeROSkill(id, aimWorld, dungeon, enemies);
    } else {
      const humElem = id === 'fire_bolt' || id === 'meteor_storm' ? 'fire' : id === 'lightning_bolt' ? 'wind' : id === 'frost_diver' ? 'water' : 'arcane';
      this.sound.startCastHum(derived.total.dex, humElem);
      this.castingSkill = {
        id,
        name: `${def.name} Lv.${lv}`,
        timer: castTime,
        total: castTime,
        aimWorld: aimWorld.clone(),
      };
    }
  }

  private executeROSkill(
    id: ROSkillId,
    aimWorld: THREE.Vector3,
    dungeon: DungeonFloorBuilder,
    enemies: EnemyManager
  ): void {
    const lv = Math.max(1, this.roSkills.getLevel(id));
    const derived = this.getDerived();
    const { dmg } = this.getDamageStat();
    const skillMult = this.getSkillDamageMult();
    const forward = new THREE.Vector3(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw));
    this.mesh.rotation.y = this.aimYaw;

    if (id === 'bash') {
      // Knight Bash Lv 1-10: 100%-400% ATK, DEX-scaled hit, Stun Lv 6+
      const mult = (1.0 + (lv - 1) * 0.333) * skillMult;
      const stun = lv >= 6 ? 1.2 + (lv - 6) * 0.25 : 0;
      this.anim.playOneShot('UAL2_Shield_Dash', 0.04, 1.35, 0.32);
      this.sound.playBash();
      this.vfx.triggerHitStop(0.055);
      this.vfx.addCameraShake(forward, 0.3);
      this.vfx.spawnSlashArc(this.pos, this.aimYaw, 3.4, 0xfacc15, false, 0.25);
      this.vfx.spawnBrackeysBurst(this.pos.clone().add(new THREE.Vector3(forward.x * 1.4, 1.0, forward.z * 1.4)), 'spark', 0xfacc15, 2.2, 0.28);
      for (const e of [...enemies.enemies]) {
        if (!e.dead && e.pos.distanceTo(this.pos) <= 3.6) {
          const dir = new THREE.Vector3().subVectors(e.pos, this.pos).setY(0).normalize();
          if (forward.dot(dir) > 0.1 || e.pos.distanceTo(this.pos) < 1.5) {
            this.applyHitToEnemy(e, Math.round(dmg * mult), dir, true, enemies, stun, true);
          }
        }
      }
    } else if (id === 'magnum_break') {
      // Fire AoE knockback + 10s +20% Fire Endow
      const mult = (1.6 + lv * 0.25) * skillMult;
      this.roStats.magnumEndowTimer = 10.0;
      this.anim.playOneShot('Melee_2H_Attack_Chop', 0.04, 1.3, 0.4);
      this.sound.playExplosion();
      this.vfx.spawnBrackeysGroundEffect(this.pos, 'scorch', 0xf97316, 4.8, 0.5, 0);
      this.vfx.spawnRing(this.pos, 4.5, 0xf97316, 0.42);
      this.vfx.addCameraShake(forward, 0.45);
      this.vfx.kickFov(5);
      this.vfx.triggerHitStop(0.04);
      this.vfx.spawnROText(this.pos.clone().add(new THREE.Vector3(0, 2.1, 0)), 'FIRE ENDOW!', 'guard');
      for (const e of [...enemies.enemies]) {
        if (!e.dead && e.pos.distanceTo(this.pos) <= 4.5) {
          const dir = new THREE.Vector3().subVectors(e.pos, this.pos).setY(0).normalize();
          const elemMult = RagnarokStatsSystem.getElementMultiplier('fire1', e.element);
          this.applyHitToEnemy(e, Math.round(dmg * mult * elemMult), dir, true, enemies, 0.4, true);
        }
      }
    } else if (id === 'provoke_endure') {
      // Tank Core: Pull aggro + flinch immunity
      this.anim.playOneShot('UAL2_Shield_OneShot', 0.04, 1.2, 0.38);
      this.sound.playBattleCry();
      this.roStats.endureTimer = 6.0 + lv * 0.6;
      const pulled = enemies.provokeAllNear(this.pos, 12.0);
      this.vfx.spawnRing(this.pos, 10.0, 0x60a5fa, 0.5);
      this.vfx.spawnROText(this.pos.clone().add(new THREE.Vector3(0, 2.1, 0)), `ENDURE (${pulled} Provoked)`, 'guard');
    } else if (id === 'two_hand_quicken') {
      // Massive ASPD Blender buff (or Barbarian Whirlwind + Quicken!)
      this.anim.clearOneShot();
      this.roStats.quickenTimer = 10.0 + lv * 1.0;
      if (this.def.id === 'barbarian') {
        this.whirlwindTimer = 2.5;
        this.whirlwindTick = 0.05;
        this.anim.playLoop('Melee_2H_Attack_Spin', 0.05, 1.65);
      } else {
        this.anim.playOneShot('UAL2_Melee_Hook', 0.04, 1.4, 0.35);
      }
      this.sound.playBattleCry();
      this.vfx.kickFov(4.5);
      this.vfx.spawnRing(this.pos, 3.6, 0xfacc15, 0.4);
      this.vfx.spawnROText(this.pos.clone().add(new THREE.Vector3(0, 2.1, 0)), 'QUICKEN +ASPD!', 'guard');
    } else if (id === 'fire_bolt' || id === 'lightning_bolt') {
      // Classic RO Lv 1-10 Multi-Hit Bolt Cascade!
      const isFire = id === 'fire_bolt';
      const elem: ElementType = isFire ? 'fire1' : 'wind1';
      const color = isFire ? 0xff5500 : 0xfacc15;
      this.anim.playOneShot('Ranged_Magic_Summon', 0.04, 1.5, 0.35);
      if (isFire) this.sound.playFireBolt(lv);
      else this.sound.playLightning(lv);

      // Target nearest enemy near cursor or aim direction
      let target: Enemy | null = null;
      let bestDist = 8.0;
      for (const e of enemies.enemies) {
        if (e.dead) continue;
        const d = e.pos.distanceTo(aimWorld);
        if (d < bestDist) {
          bestDist = d;
          target = e;
        }
      }
      if (!target) {
        for (const e of enemies.enemies) {
          if (!e.dead && e.pos.distanceTo(this.pos) < 13) {
            target = e;
            break;
          }
        }
      }

      if (target) {
        const hitCount = lv;
        const basePerHit = Math.round(((derived.matkMin + derived.matkMax) * 0.5) * 0.78 * skillMult);
        const elemMult = RagnarokStatsSystem.getElementMultiplier(elem, target.element);
        const hits: number[] = [];
        for (let i = 0; i < hitCount; i++) {
          const perHit = Math.max(1, Math.round(basePerHit * elemMult * (0.92 + Math.random() * 0.16)));
          hits.push(perHit);
          if (!isFire) {
            this.vfx.spawnLightningArc(
              target.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 6, (Math.random() - 0.5) * 1.2)),
              target.pos,
              0xfacc15
            );
          } else {
            this.vfx.spawnFallingStrike(target.pos, 0xff5500, false, i * 0.05);
          }
        }
        const total = hits.reduce((a, b) => a + b, 0);
        this.vfx.spawnMultiHitStack(target.pos, hits, elemMult > 1.2 ? 'magic' : 'normal');
        const dir = new THREE.Vector3().subVectors(target.pos, this.pos).setY(0).normalize();
        enemies.damageEnemy(target, total, dir, elemMult > 1.2, 0, true);
        if (target.dead) {
          this.kills++;
          this.gold += Math.round((target.isBoss ? 120 : 12) * this.goldMult);
          this.grantXp(target.isBoss ? 120 : 25);
        }
      } else {
        const spawnPos = this.pos.clone().add(new THREE.Vector3(forward.x * 0.8, 1.2, forward.z * 0.8));
        this.spawnProjectile(spawnPos, forward.clone().multiplyScalar(18), Math.round(dmg * lv * 0.6), false, 0, 0, 0, color, 'magic');
      }
    } else if (id === 'frost_diver') {
      // Water projectile that freezes targets solid cyan & sets Water Lv.1
      this.anim.playOneShot('Ranged_Magic_Spellcasting', 0.04, 1.45, 0.35);
      this.sound.playIceShatter(1.3);
      this.vfx.spawnRing(this.pos, 4.8, 0x38bdf8, 0.45);
      for (const e of [...enemies.enemies]) {
        if (!e.dead && e.pos.distanceTo(this.pos) <= 5.5) {
          enemies.freezeEnemy(e, 3.0 + lv * 0.35);
          const dir = new THREE.Vector3().subVectors(e.pos, this.pos).setY(0).normalize();
          this.applyHitToEnemy(e, Math.round(dmg * (1.1 + lv * 0.12) * skillMult), dir, false, enemies, 0, true);
        }
      }
    } else if (id === 'meteor_storm') {
      this.anim.playOneShot('Ranged_Magic_Summon', 0.05, 1.4, 0.45);
      const targetCenter = aimWorld.clone().setY(0.1);
      const waves = Math.min(7, 3 + Math.floor(lv / 2));
      this.vfx.spawnRing(targetCenter, 4.6, 0xff5500, 0.65);
      this.vfx.spawnBrackeysGroundEffect(targetCenter, 'magic_rune', 0xff5500, 5.0, 0.65, 2);
      for (let i = 0; i < waves; i++) {
        const a = (i / waves) * Math.PI * 2;
        const r = i === 0 ? 0 : 2.5;
        const hitPos = targetCenter.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
        this.vfx.spawnFallingStrike(hitPos, i % 2 === 0 ? 0xff5500 : 0xfacc15, true, i * 0.1, () => {
          this.vfx.spawnBrackeysGroundEffect(hitPos, 'scorch', 0xff5500, 3.4, 0.45, 0);
          this.vfx.kickFov(1.2);
          this.triggerAoEExplosion(hitPos, 3.2, Math.round(dmg * (1.3 + lv * 0.15) * skillMult), enemies, -1);
        });
      }
    } else if (id === 'energy_coat') {
      this.roStats.energyCoatActive = !this.roStats.energyCoatActive;
      this.sound.playUIPopup();
      this.vfx.spawnRing(this.pos, 3.0, 0xa855f7, 0.4);
      this.vfx.spawnROText(
        this.pos.clone().add(new THREE.Vector3(0, 2.0, 0)),
        this.roStats.energyCoatActive ? 'ENERGY COAT ON' : 'ENERGY COAT OFF',
        'sp'
      );
    } else if (id === 'double_strafe') {
      // Rapid 2-hit Arrow/Dagger combo
      this.anim.playOneShot(this.def.id === 'ranger' ? 'Ranged_Bow_Release' : 'UAL2_Melee_Hook', 0.04, 1.6, 0.28);
      if (this.def.id === 'ranger') this.sound.playBowTwang(1.25);
      else this.sound.playSwordClang(1.3);
      const spawnPos = this.pos.clone().add(new THREE.Vector3(forward.x * 0.7, 1.15, forward.z * 0.7));
      const mult = (1.0 + lv * 0.15) * skillMult;
      for (let i = 0; i < 2; i++) {
        const a = this.aimYaw + (i === 0 ? -0.05 : 0.05);
        const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        this.spawnProjectile(
          spawnPos.clone(),
          dir.multiplyScalar(23),
          Math.round(dmg * mult),
          i === 1,
          1,
          this.hasRelic('ricochet') ? 1 : 0,
          0,
          this.def.projectileColor ?? 0xfde047,
          this.def.id === 'ranger' ? 'arrow' : 'dagger'
        );
      }
    } else if (id === 'sonic_blow') {
      // Rapid 4-to-8 hit AGI/STR combo burst
      const hitCount = Math.min(8, 4 + Math.floor(lv / 2));
      this.anim.playOneShot('Melee_Dualwield_Attack_Slice', 0.04, 1.8, 0.35);
      this.sound.playSwordClang(1.4);
      this.sound.playCrit();
      this.vfx.triggerHitStop(0.05);
      this.vfx.addCameraShake(forward, 0.24);
      this.vfx.kickFov(3);
      this.vfx.spawnSlashArc(this.pos, this.aimYaw, 3.5, 0x34d399, true);
      for (const e of [...enemies.enemies]) {
        if (!e.dead && e.pos.distanceTo(this.pos) <= 3.8) {
          const hits = Array.from({ length: hitCount }, () =>
            Math.max(1, Math.round(dmg * (0.42 + lv * 0.04) * skillMult))
          );
          const total = hits.reduce((a, b) => a + b, 0);
          this.vfx.spawnMultiHitStack(e.pos, hits, 'magic');
          const dir = new THREE.Vector3().subVectors(e.pos, this.pos).setY(0).normalize();
          enemies.damageEnemy(e, total, dir, true, lv >= 5 ? 0.8 : 0, true);
          if (e.dead) {
            this.kills++;
            this.gold += Math.round((e.isBoss ? 120 : 12) * this.goldMult);
            this.grantXp(e.isBoss ? 120 : 25);
          }
        }
      }
    } else if (id === 'cloaking_backslide') {
      const startPos = this.pos.clone();
      this.anim.playOneShot('Dodge_Forward', 0.04, 1.6, 0.28);
      this.sound.playDodge();
      this.iFrames = Math.max(this.iFrames, 1.1 + lv * 0.08);
      const stepDir = this.def.id === 'ranger' ? -1 : 1;
      for (let s = 0; s < 8; s++) this.tryMove(forward.x * 0.6 * stepDir, forward.z * 0.6 * stepDir, dungeon);
      this.vfx.spawnDashTrail(startPos, this.pos, 0x34d399, 7);
      this.vfx.spawnROText(this.pos.clone().add(new THREE.Vector3(0, 2.0, 0)), 'CLOAK!', 'lucky');
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
    color: number,
    kind: 'arrow' | 'magic' | 'dagger' = 'magic'
  ): void {
    let mesh: THREE.Object3D;
    if (kind === 'arrow') {
      const grp = new THREE.Group();
      const arrowModel = this.assets.cloneProp('weapons/arrow_bow.gltf');
      arrowModel.scale.setScalar(1.45);
      grp.add(arrowModel);
      grp.rotation.y = Math.atan2(vel.x, vel.z);
      mesh = grp;
    } else if (kind === 'magic') {
      mesh = this.vfx.createMagicOrb(color, explosiveRadius > 0);
    } else {
      const mat = new THREE.MeshBasicMaterial({ color });
      mesh = new THREE.Mesh(this.projGeo, mat);
    }
    mesh.position.copy(pos);
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
      kind,
      trailTimer: 0,
    });
  }

  private updateProjectiles(dt: number, dungeon: DungeonFloorBuilder, enemies: EnemyManager): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.trailTimer -= dt;
      if (p.trailTimer <= 0) {
        p.trailTimer = p.kind === 'arrow' ? 0.035 : 0.028;
        if (p.kind === 'magic') {
          this.vfx.spawnBrackeysBurst(
            p.mesh.position,
            p.explosiveRadius > 0 ? 'flame' : 'magic_rune',
            p.color,
            p.explosiveRadius > 0 ? 1.35 : 0.85,
            0.24
          );
        } else if (p.kind === 'arrow') {
          this.vfx.spawnBrackeysBurst(p.mesh.position, 'spark', 0xfde047, 0.65, 0.16);
        } else {
          this.vfx.spawnTrailSpark(p.mesh.position, p.color, 0.65);
        }
      }

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

            if (p.kind === 'arrow') {
              this.vfx.spawnSpriteFX(e.pos, 'arrow_hit', 2.0, 0xfde047);
            } else if (p.kind === 'dagger') {
              this.vfx.spawnSpriteFX(e.pos, 'slash_rogue', 2.0, 0x34d399);
            } else if (p.explosiveRadius === 0) {
              this.vfx.spawnSpriteFX(e.pos, 'magic_hit', 2.3, 0xa855f7);
            }

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
                if (p.kind === 'arrow') p.mesh.rotation.y = Math.atan2(p.vel.x, p.vel.z);
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
    this.sound.at(center).playExplosion();
    this.vfx.spawnSpriteFX(center, 'fire_hit', radius * 1.15, 0xff8833);
    this.vfx.spawnRing(center, radius, 0xff6600, 0.35);
    this.vfx.spawnBurst(center, 0xff8822, 16, 6);
    this.vfx.addCameraShake(new THREE.Vector3(center.x - this.pos.x, 0, center.z - this.pos.z), 0.3);
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
    stunSec: number,
    alwaysHit = false
  ): void {
    const derived = this.getDerived();
    if (!alwaysHit && !isCrit && this.def.id !== 'mage') {
      const hitChance = THREE.MathUtils.clamp(0.8 + (derived.hit - enemy.flee) * 0.01, 0.25, 1.0);
      if (Math.random() > hitChance) {
        this.vfx.spawnROText(enemy.pos.clone().add(new THREE.Vector3(0, 1.8, 0)), 'Miss', 'miss');
        return;
      }
    }

    if (this.endowElement && this.endowTimer > 0) {
      damage = Math.max(1, Math.round(damage * RagnarokStatsSystem.getElementMultiplier(this.endowElement, enemy.element)));
    }
    const killed = enemies.damageEnemy(enemy, damage, dir, isCrit, stunSec);
    if (killed) {
      this.kills++;
      this.gold += Math.round((enemy.isBoss ? 120 : 12) * this.goldMult);
      this.grantXp(enemy.isBoss ? 120 : 25);
      if (this.hasRelic('berserker_blood')) this.heal(4);
      if (this.hasSkill('executioner_surge')) {
        this.heal(6);
        this.ultCd = Math.max(0, this.ultCd - 1.5);
      }
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

  public takeDamage(amount: number, dir: THREE.Vector3, enemies?: EnemyManager): void {
    if (this.iFrames > 0 || this.hp <= 0) return;
    const derived = this.getDerived();

    // LUK Perfect Dodge ("Lucky!")
    if (Math.random() < derived.perfectDodge) {
      this.iFrames = 0.22;
      this.vfx.spawnROText(this.pos.clone().add(new THREE.Vector3(0, 1.9, 0)), 'Lucky!', 'lucky');
      return;
    }

    // Knight Auto Guard + Shield Reflect
    const guardLv = this.roSkills.getLevel('auto_guard');
    if (guardLv > 0 && Math.random() < 0.05 + guardLv * 0.025) {
      this.iFrames = 0.25;
      this.sound.playBlock();
      MaterialFX.flash(this.mesh, 0xfde68a, 1.2, 0.12);
      this.vfx.spawnBrackeysBurst(this.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), 'spark', 0xfacc15, 1.6, 0.22);
      this.vfx.spawnROText(this.pos.clone().add(new THREE.Vector3(0, 2.0, 0)), 'Guard!', 'guard');
      if (enemies) {
        const reflectPct = Math.min(0.5, 0.2 + guardLv * 0.03);
        const reflectDmg = Math.max(1, Math.round(amount * reflectPct));
        for (const e of enemies.enemies) {
          if (!e.dead && e.pos.distanceTo(this.pos) <= 3.5) {
            enemies.damageEnemy(e, reflectDmg, dir.clone().negate(), false, 0);
            break;
          }
        }
      }
      return;
    }

    // Classic RO Hard DEF (%) + Soft DEF (VIT flat) + Energy Coat SP drain
    const { finalDamage, spDrained } = this.roStats.computeIncomingPhysicalDamage(amount, derived, this.sp);
    if (spDrained > 0) {
      this.sp = Math.max(0, this.sp - spDrained);
    }

    this.hp = Math.max(0, this.hp - finalDamage);
    this.iFrames = this.roStats.endureTimer > 0 ? 0.28 : 0.45;
    if (this.roStats.endureTimer <= 0) {
      this.impulseVel.addScaledVector(dir, 6.5);
      this.anim.playOneShot('Hit_A', 0.05, 1.4, 0.22);
    }
    if (finalDamage <= 1) {
      this.sound.playTankClang();
      MaterialFX.flash(this.mesh, 0xbfdbfe, 0.9, 0.12);
    } else {
      this.sound.playPlayerHit();
      MaterialFX.flash(this.mesh, 0xff2a2a, 1.4, 0.12);
    }
    this.vfx.addCameraShake(dir, finalDamage <= 1 ? 0.08 : 0.34);
    this.vfx.spawnROText(
      this.pos.clone().add(new THREE.Vector3(0, 1.7, 0)),
      `${finalDamage}`,
      finalDamage <= 1 ? 'tank1' : 'player-hit'
    );
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
    this.sound.stopCastHum(false);
    MaterialFX.release(this.mesh);
    this.scene.remove(this.mesh);
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const o of this.orbitingOrbs) this.scene.remove(o);
    this.projectiles = [];
    this.orbitingOrbs = [];
  }
}
