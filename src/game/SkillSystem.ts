import { HeroClassId } from '../types';
import { DerivedROStats, ElementType } from './RagnarokStatsSystem';

export type ROSkillId =
  | 'bash'
  | 'magnum_break'
  | 'provoke_endure'
  | 'auto_guard'
  | 'two_hand_quicken'
  | 'fire_bolt'
  | 'lightning_bolt'
  | 'frost_diver'
  | 'meteor_storm'
  | 'energy_coat'
  | 'sonic_blow'
  | 'double_strafe'
  | 'cloaking_backslide';

export interface ROSkillDef {
  id: ROSkillId;
  name: string;
  maxLevel: number;
  isPassive?: boolean;
  keyHint?: string;
  element: ElementType;
  baseCastTime: (lv: number) => number;
  spCost: (lv: number) => number;
  cooldown: (lv: number) => number;
  desc: (lv: number) => string;
}

export const RO_SKILLS: Record<ROSkillId, ROSkillDef> = {
  bash: {
    id: 'bash',
    name: 'Bash',
    maxLevel: 10,
    keyHint: 'Q / RMB',
    element: 'neutral',
    baseCastTime: () => 0,
    spCost: (lv) => (lv <= 5 ? 8 : 15),
    cooldown: () => 1.6,
    desc: (lv) => `${100 + lv * 30}% ATK heavy strike with +${lv * 5} HIT.${lv >= 6 ? ` ${(lv - 5) * 8}% Stun!` : ''}`,
  },
  magnum_break: {
    id: 'magnum_break',
    name: 'Magnum Break',
    maxLevel: 10,
    keyHint: 'C / 2',
    element: 'fire1',
    baseCastTime: () => 0,
    spCost: () => 22,
    cooldown: () => 5.5,
    desc: (lv) => `${120 + lv * 22}% Fire AoE knockback + 10s +20% Fire Endow.`,
  },
  provoke_endure: {
    id: 'provoke_endure',
    name: 'Provoke & Endure',
    maxLevel: 10,
    keyHint: 'R / 3',
    element: 'neutral',
    baseCastTime: () => 0,
    spCost: () => 12,
    cooldown: () => 10,
    desc: (lv) => `Pulls all nearby aggro & grants ${4 + lv}s Endure (flinch immunity + 15 MDEF).`,
  },
  auto_guard: {
    id: 'auto_guard',
    name: 'Auto Guard & Reflect',
    maxLevel: 10,
    isPassive: true,
    element: 'neutral',
    baseCastTime: () => 0,
    spCost: () => 0,
    cooldown: () => 0,
    desc: (lv) => `${8 + lv * 2.5}% chance to block incoming hits & reflect ${15 + lv * 3.5}% damage.`,
  },
  two_hand_quicken: {
    id: 'two_hand_quicken',
    name: 'Two-Hand Quicken',
    maxLevel: 10,
    keyHint: 'V / 4',
    element: 'neutral',
    baseCastTime: () => 0,
    spCost: () => 24,
    cooldown: () => 16,
    desc: (lv) => `Grants +16 ASPD for ${12 + lv * 2}s for AGI/STR Blender builds.`,
  },
  fire_bolt: {
    id: 'fire_bolt',
    name: 'Fire Bolt',
    maxLevel: 10,
    keyHint: 'Q / RMB',
    element: 'fire1',
    baseCastTime: (lv) => 0.4 + lv * 0.38, // 0.78s Lv1 -> 4.2s Lv10
    spCost: (lv) => 10 + lv * 2,
    cooldown: () => 1.5,
    desc: (lv) => `Fires ${lv} rapid Fire Bolts (${(0.4 + lv * 0.38).toFixed(1)}s base cast, scales with MATK).`,
  },
  lightning_bolt: {
    id: 'lightning_bolt',
    name: 'Lightning Bolt',
    maxLevel: 10,
    keyHint: 'C / 2',
    element: 'wind1',
    baseCastTime: (lv) => 0.4 + lv * 0.36,
    spCost: (lv) => 10 + lv * 2,
    cooldown: () => 1.8,
    desc: (lv) => `Strikes ${lv}x with Wind bolts. Deals 175% damage vs Frozen/Water targets!`,
  },
  frost_diver: {
    id: 'frost_diver',
    name: 'Frost Diver',
    maxLevel: 10,
    keyHint: 'V / 4',
    element: 'water1',
    baseCastTime: (lv) => Math.max(0.4, 1.2 - lv * 0.06),
    spCost: (lv) => 26 - lv,
    cooldown: () => 4.2,
    desc: (lv) => `Freezes foes solid (${2.5 + lv * 0.4}s) & converts them to Water Lv.1.`,
  },
  meteor_storm: {
    id: 'meteor_storm',
    name: 'Meteor Storm',
    maxLevel: 10,
    keyHint: 'R / 3',
    element: 'fire1',
    baseCastTime: (lv) => 2.5 + lv * 0.2, // up to 4.5s base cast!
    spCost: (lv) => 30 + lv * 3,
    cooldown: () => 11.0,
    desc: (lv) => `Calls ${2 + Math.ceil(lv / 2)} meteor waves (${(2.5 + lv * 0.2).toFixed(1)}s base cast).`,
  },
  energy_coat: {
    id: 'energy_coat',
    name: 'Energy Coat',
    maxLevel: 5,
    isPassive: true,
    element: 'neutral',
    baseCastTime: () => 0,
    spCost: () => 0,
    cooldown: () => 0,
    desc: () => `Reduces incoming physical damage up to 30% by draining SP per hit.`,
  },
  sonic_blow: {
    id: 'sonic_blow',
    name: 'Sonic Blow',
    maxLevel: 10,
    keyHint: 'Q / RMB',
    element: 'neutral',
    baseCastTime: () => 0,
    spCost: () => 24,
    cooldown: () => 4.0,
    desc: (lv) => `8-hit rapid Katar/Dagger flurry (${280 + lv * 45}% total ATK, AGI speeds recovery).`,
  },
  double_strafe: {
    id: 'double_strafe',
    name: 'Double Strafe',
    maxLevel: 10,
    keyHint: 'Q / RMB',
    element: 'neutral',
    baseCastTime: () => 0,
    spCost: () => 12,
    cooldown: () => 1.8,
    desc: (lv) => `Fires 2 piercing arrows (${100 + lv * 12}% ATK each, scales with DEX & AGI).`,
  },
  cloaking_backslide: {
    id: 'cloaking_backslide',
    name: 'Cloak / Backslide',
    maxLevel: 10,
    keyHint: 'C / 2',
    element: 'neutral',
    baseCastTime: () => 0,
    spCost: () => 15,
    cooldown: () => 4.8,
    desc: (lv) => `Instant shadow reposition with i-frames & guaranteed +${40 + lv * 10}% Ambush Crit.`,
  },
};

export const CLASS_SKILL_TREES: Record<HeroClassId, ROSkillId[]> = {
  knight: ['bash', 'magnum_break', 'provoke_endure', 'auto_guard', 'two_hand_quicken'],
  barbarian: ['bash', 'magnum_break', 'two_hand_quicken', 'provoke_endure', 'auto_guard'],
  mage: ['fire_bolt', 'frost_diver', 'lightning_bolt', 'meteor_storm', 'energy_coat'],
  rogue: ['sonic_blow', 'cloaking_backslide', 'double_strafe', 'auto_guard'],
  ranger: ['double_strafe', 'cloaking_backslide', 'frost_diver', 'two_hand_quicken'],
};

export class SkillSystem {
  public levels = new Map<ROSkillId, number>();
  public skillPoints = 2;

  constructor(public classId: HeroClassId) {
    const tree = CLASS_SKILL_TREES[classId];
    // Start with Lv.1 in primary signature skill
    this.levels.set(tree[0], 1);
    if (tree[1]) this.levels.set(tree[1], 1);
    if (classId === 'mage') this.levels.set('energy_coat', 1);
  }

  public getLevel(id: ROSkillId): number {
    return this.levels.get(id) ?? 0;
  }

  public onLevelUp(): void {
    this.skillPoints++;
  }

  public upgradeSkill(id: ROSkillId): boolean {
    if (this.skillPoints <= 0) return false;
    const def = RO_SKILLS[id];
    const cur = this.getLevel(id);
    if (cur >= def.maxLevel) return false;
    this.skillPoints--;
    this.levels.set(id, cur + 1);
    return true;
  }

  public resetSkills(): void {
    let spent = 0;
    for (const [id, lv] of this.levels) {
      spent += lv;
      this.levels.set(id, 0);
    }
    const tree = CLASS_SKILL_TREES[this.classId];
    this.levels.set(tree[0], 1);
    this.skillPoints += Math.max(0, spent - 1);
  }

  public getEffectiveCastTime(id: ROSkillId, derived: DerivedROStats): number {
    const lv = this.getLevel(id);
    if (lv <= 0) return 0;
    const base = RO_SKILLS[id].baseCastTime(lv);
    return base * derived.castTimeMult;
  }
}
