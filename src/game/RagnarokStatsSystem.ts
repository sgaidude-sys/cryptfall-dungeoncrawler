import { HeroClassId } from '../types';

export type StatKey = 'str' | 'agi' | 'vit' | 'int' | 'dex' | 'luk';
export type ElementType = 'neutral' | 'fire1' | 'water1' | 'wind1' | 'earth1' | 'poison1' | 'undead1';

export interface BaseStats {
  str: number;
  agi: number;
  vit: number;
  int: number;
  dex: number;
  luk: number;
}

export interface DerivedROStats {
  total: BaseStats;
  bonus: BaseStats;
  atkMin: number;
  atkMax: number;
  matkMin: number;
  matkMax: number;
  hardDef: number;
  softDef: number;
  mdef: number;
  hit: number;
  flee: number;
  perfectDodge: number;
  critChance: number; // 0..1
  aspd: number; // 100..190
  attackInterval: number; // seconds
  castTimeMult: number; // 0..1 (0 = Instant Cast at 150 DEX!)
  maxHp: number;
  maxSp: number;
  potionMult: number;
  hpRegenPerTick: number;
  spRegenPerTick: number;
}

const JOB_BONUS: Record<HeroClassId, BaseStats> = {
  knight: { str: 8, agi: 2, vit: 10, int: 0, dex: 4, luk: 2 },
  barbarian: { str: 10, agi: 5, vit: 6, int: 0, dex: 3, luk: 4 },
  rogue: { str: 5, agi: 10, vit: 2, int: 2, dex: 6, luk: 6 },
  mage: { str: 0, agi: 2, vit: 2, int: 12, dex: 8, luk: 2 },
  ranger: { str: 2, agi: 8, vit: 2, int: 2, dex: 12, luk: 4 },
};

const STARTER_BASE: Record<HeroClassId, BaseStats> = {
  knight: { str: 9, agi: 5, vit: 9, int: 1, dex: 6, luk: 2 },
  barbarian: { str: 10, agi: 7, vit: 7, int: 1, dex: 5, luk: 2 },
  rogue: { str: 6, agi: 10, vit: 3, int: 1, dex: 7, luk: 5 },
  mage: { str: 1, agi: 4, vit: 3, int: 10, dex: 9, luk: 5 },
  ranger: { str: 3, agi: 9, vit: 3, int: 2, dex: 10, luk: 5 },
};

export class RagnarokStatsSystem {
  public base: BaseStats;
  public bonus: BaseStats = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  public statPoints = 6;
  public level = 1;
  public jobLevel = 1;
  public weaponRefine = 0; // +0..+10
  public armorRefine = 0;  // +0..+10
  public baseArmorDef = 4;
  public baseWeaponAtk = 14;
  public baseWeaponMatk = 13;

  // Active RO buffs
  public endureTimer = 0;
  public magnumEndowTimer = 0;
  public quickenTimer = 0;
  public energyCoatActive = false;

  constructor(private classId: HeroClassId) {
    this.base = { ...STARTER_BASE[classId] };
  }

  public getStatCost(stat: StatKey): number {
    return Math.floor((this.base[stat] - 1) / 10) + 2;
  }

  public allocateStat(stat: StatKey): boolean {
    if (this.base[stat] >= 99) return false;
    const cost = this.getStatCost(stat);
    if (this.statPoints < cost) return false;
    this.statPoints -= cost;
    this.base[stat]++;
    return true;
  }

  public resetStats(): void {
    const starter = STARTER_BASE[this.classId];
    let refunded = 0;
    for (const k of Object.keys(this.base) as StatKey[]) {
      while (this.base[k] > 1) {
        this.base[k]--;
        refunded += this.getStatCost(k);
      }
      this.base[k] = starter[k];
      // Deduct starter points from refunded only above 1
      for (let v = 1; v < starter[k]; v++) {
        refunded -= Math.floor((v - 1) / 10) + 2;
      }
    }
    this.statPoints = Math.max(0, this.statPoints + refunded);
  }

  public onLevelUp(newLevel: number): void {
    this.level = newLevel;
    this.jobLevel = Math.min(50, this.jobLevel + 1);
    this.statPoints += Math.floor(newLevel / 5) + 4;
  }

  public tickTimers(dt: number): void {
    if (this.endureTimer > 0) this.endureTimer = Math.max(0, this.endureTimer - dt);
    if (this.magnumEndowTimer > 0) this.magnumEndowTimer = Math.max(0, this.magnumEndowTimer - dt);
    if (this.quickenTimer > 0) this.quickenTimer = Math.max(0, this.quickenTimer - dt);
  }

  public getDerived(isRanged: boolean, extraBonus?: Partial<BaseStats>): DerivedROStats {
    const jb = JOB_BONUS[this.classId];
    const bonus: BaseStats = {
      str: jb.str + this.bonus.str + (extraBonus?.str ?? 0),
      agi: jb.agi + this.bonus.agi + (extraBonus?.agi ?? 0),
      vit: jb.vit + this.bonus.vit + (extraBonus?.vit ?? 0),
      int: jb.int + this.bonus.int + (extraBonus?.int ?? 0),
      dex: jb.dex + this.bonus.dex + (extraBonus?.dex ?? 0),
      luk: jb.luk + this.bonus.luk + (extraBonus?.luk ?? 0),
    };
    const total: BaseStats = {
      str: this.base.str + bonus.str,
      agi: this.base.agi + bonus.agi,
      vit: this.base.vit + bonus.vit,
      int: this.base.int + bonus.int,
      dex: this.base.dex + bonus.dex,
      luk: this.base.luk + bonus.luk,
    };

    // Classic Pre-Renewal ATK
    const primaryStat = isRanged ? total.dex : total.str;
    const secondaryStat = isRanged ? total.str : total.dex;
    const statAtk = primaryStat + Math.pow(Math.floor(primaryStat / 10), 2) + Math.floor(secondaryStat / 5) + Math.floor(total.luk / 5);
    const refineAtk = this.weaponRefine * 5 + Math.max(0, this.weaponRefine - 4) * 3;
    const atkMin = Math.max(1, statAtk + Math.floor(this.baseWeaponAtk * 0.85) + refineAtk);
    const atkMax = Math.max(atkMin, statAtk + this.baseWeaponAtk + refineAtk);

    // Classic Pre-Renewal MATK: INT + floor(INT/7)^2 max, INT + floor(INT/5)^2 min
    const matkMin = total.int + Math.pow(Math.floor(total.int / 5), 2) + this.baseWeaponMatk + this.weaponRefine * 4;
    const matkMax = Math.max(matkMin, total.int + Math.pow(Math.floor(total.int / 7), 2) + this.baseWeaponMatk + this.weaponRefine * 5);

    // Classic Hard DEF + Soft DEF
    const hardDef = this.baseArmorDef + this.armorRefine * 3 + (this.classId === 'knight' ? 4 : 0);
    const softDef = Math.floor(total.vit * 0.8 + Math.pow(Math.floor(total.vit / 20), 2));
    const mdef = total.int + Math.floor(total.vit / 2) + (this.endureTimer > 0 ? 15 : 0);

    // HIT / FLEE / CRIT / ASPD / Cast Time
    const hit = 175 + this.level + total.dex;
    const flee = 100 + this.level + total.agi;
    const perfectDodge = Math.min(45, 1 + total.luk * 0.12);
    const critChance = Math.min(0.85, (1 + total.luk * 0.35 + (this.classId === 'rogue' ? 10 : 0)) / 100);

    const quickenBonus = this.quickenTimer > 0 ? 16 : 0;
    const baseAspd = this.classId === 'rogue' ? 160 : this.classId === 'ranger' ? 156 : this.classId === 'barbarian' ? 148 : 152;
    const aspd = Math.min(190, Math.round(baseAspd + total.agi * 0.36 + total.dex * 0.14 + quickenBonus));
    const attackInterval = Math.max(0.16, (200 - aspd) * 0.0115);

    // Classic 150 DEX Instant-Cast formula
    const castTimeMult = Math.max(0, 1 - total.dex / 150);

    // HP & SP
    const classHpBase = this.classId === 'knight' || this.classId === 'barbarian' ? 115 : this.classId === 'ranger' ? 85 : 75;
    const maxHp = Math.round((classHpBase + this.level * 15) * (1 + total.vit * 0.015));
    const maxSp = Math.round((60 + this.level * 6) * (1 + total.int * 0.02));
    const potionMult = 1 + total.vit * 0.02;
    const hpRegenPerTick = Math.max(2, Math.floor(total.vit * 0.6 + maxHp / 140));
    const spRegenPerTick = Math.max(2, Math.floor(total.int * 0.4 + maxSp / 90));

    return {
      total,
      bonus,
      atkMin,
      atkMax,
      matkMin,
      matkMax,
      hardDef,
      softDef,
      mdef,
      hit,
      flee,
      perfectDodge,
      critChance,
      aspd,
      attackInterval,
      castTimeMult,
      maxHp,
      maxSp,
      potionMult,
      hpRegenPerTick,
      spRegenPerTick,
    };
  }

  /**
   * Classic Pre-Renewal Hard DEF (%) followed by Soft DEF (flat VIT subtraction).
   * High-VIT + refined Knights literally tank weak/mid mobs for "1" damage!
   */
  public computeIncomingPhysicalDamage(
    incomingAtk: number,
    derived: DerivedROStats,
    currentSp: number
  ): { finalDamage: number; spDrained: number } {
    const afterHard = incomingAtk * (1 - derived.hardDef / (derived.hardDef + 100));
    let dmg = Math.floor(afterHard - derived.softDef);
    let spDrained = 0;

    if (this.energyCoatActive && currentSp > 4 && dmg > 1) {
      const spRatio = Math.min(1, currentSp / Math.max(1, derived.maxSp));
      const coatMitigation = 0.12 + spRatio * 0.18; // Up to 30% reduction
      dmg = Math.floor(dmg * (1 - coatMitigation));
      spDrained = Math.min(currentSp, Math.max(2, Math.floor(derived.maxSp * 0.025)));
    }

    return { finalDamage: Math.max(1, dmg), spDrained };
  }

  public static getElementMultiplier(attackElem: ElementType, targetElem: ElementType): number {
    if (attackElem === 'wind1' && targetElem === 'water1') return 1.75; // Lightning Bolt on Frozen target!
    if (attackElem === 'fire1' && targetElem === 'undead1') return 1.5;
    if (attackElem === 'fire1' && targetElem === 'earth1') return 1.5;
    if (attackElem === 'water1' && targetElem === 'fire1') return 1.5;
    if (attackElem === 'fire1' && targetElem === 'water1') return 0.7;
    return 1.0;
  }
}
