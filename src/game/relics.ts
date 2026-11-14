import { RelicDef, RelicId } from '../types';

export const RELICS: Record<RelicId, RelicDef> = {
  chain_lightning: {
    id: 'chain_lightning',
    name: 'Chain Lightning Strikes',
    tag: 'Storm Relic',
    description: 'Every 3rd hit arcs lightning to up to 3 nearby enemies for 65% weapon damage.',
  },
  ricochet: {
    id: 'ricochet',
    name: 'Ricocheting Projectiles',
    tag: 'Ballistic Relic',
    description: 'Ranged attacks & skills bounce to 1 additional nearby enemy (melee gains shockwave reach).',
  },
  vampiric_dash: {
    id: 'vampiric_dash',
    name: 'Vampiric Dash',
    tag: 'Blood Relic',
    description: 'Dodging through enemies deals 18 damage and heals you for 6 HP per enemy hit.',
  },
  explosive_crits: {
    id: 'explosive_crits',
    name: 'Explosive Crits',
    tag: 'Inferno Relic',
    description: 'Critical hits trigger a fiery detonation dealing 75% damage in a 2.8m radius.',
  },
  orbiting_orbs: {
    id: 'orbiting_orbs',
    name: 'Orbiting Flame Orbs',
    tag: 'Pyre Relic',
    description: 'Summons 3 blazing orbs that orbit you, scorching nearby skeletons for 14 dmg/hit.',
  },
  frost_dodge: {
    id: 'frost_dodge',
    name: 'Frost Nova Step',
    tag: 'Glacier Relic',
    description: 'Dodge-rolling erupts a frost ring that slows & chills nearby foes for 2.5s.',
  },
  berserker_blood: {
    id: 'berserker_blood',
    name: 'Berserker Bloodlust',
    tag: 'Fury Relic',
    description: '+25% Attack Speed and +15% Critical Chance; kills restore 4 HP.',
  },
  titanic_cleave: {
    id: 'titanic_cleave',
    name: 'Titanic Might',
    tag: 'Titan Relic',
    description: '+28% Base Damage and +35 Max HP (heals +35 HP immediately).',
  },
  arcane_echo: {
    id: 'arcane_echo',
    name: 'Chrono Echo',
    tag: 'Arcane Relic',
    description: 'Signature Active Skill & Dodge cooldowns recharge 30% faster.',
  },
  swiftfoot: {
    id: 'swiftfoot',
    name: 'Phantom Stride',
    tag: 'Wind Relic',
    description: '+20% Movement Speed and dodge distance; +10% Crit Chance.',
  },
};

export function pickRandomRelics(owned: RelicId[], count = 3): RelicDef[] {
  const all = Object.values(RELICS);
  const unowned = all.filter((r) => !owned.includes(r.id));
  const pool = unowned.length >= count ? unowned : all;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
