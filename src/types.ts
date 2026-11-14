export type HeroClassId = 'knight' | 'barbarian' | 'rogue' | 'mage' | 'ranger';

export interface HeroClassDef {
  id: HeroClassId;
  name: string;
  role: string;
  modelFile: string;
  textureFile: string;
  rightWeapon?: string;
  leftWeapon?: string;
  maxHp: number;
  speed: number;
  damage: number;
  attackCooldown: number;
  critChance: number;
  range: number;
  isRanged: boolean;
  projectileColor?: number;
  primaryName: string;
  primaryDesc: string;
  skillName: string;
  skillDesc: string;
  skillCooldown: number;
  skill2Name: string;
  skill2Desc: string;
  skill2Cooldown: number;
  ultName: string;
  ultDesc: string;
  ultCooldown: number;
  attackClips: string[];
  runClip: string;
  accentHex: string;
}

export type RelicId =
  | 'chain_lightning'
  | 'ricochet'
  | 'vampiric_dash'
  | 'explosive_crits'
  | 'orbiting_orbs'
  | 'frost_dodge'
  | 'berserker_blood'
  | 'titanic_cleave'
  | 'arcane_echo'
  | 'swiftfoot';

export interface RelicDef {
  id: RelicId;
  name: string;
  tag: string;
  description: string;
}

export type RoomType = 'start' | 'combat' | 'trap' | 'treasure' | 'boss';

export interface RoomData {
  gx: number;
  gy: number;
  type: RoomType;
  widthTiles: number;
  depthTiles: number;
  worldX: number;
  worldZ: number;
  cleared: boolean;
  discovered: boolean;
  doors: { n?: boolean; s?: boolean; e?: boolean; w?: boolean };
}

export type SkillNodeId =
  | 'weapon_mastery'
  | 'relentless_tempo'
  | 'unlock_skill2'
  | 'skill_overcharge'
  | 'iron_vitality'
  | 'executioner_surge';

export interface SkillNodeDef {
  id: SkillNodeId;
  branch: 'Combat' | 'Arcane' | 'Vanguard';
  tier: 1 | 2;
  name: string;
  desc: string;
  requires?: SkillNodeId;
}

export type GamePhase = 'loading' | 'menu' | 'title' | 'playing' | 'paused' | 'relic_draft' | 'skill_tree' | 'dead';

export interface HUDState {
  phase: GamePhase;
  floor: number;
  kills: number;
  gold: number;
  level: number;
  xp: number;
  xpToNext: number;
  skillPoints: number;
  unlockedSkills: SkillNodeId[];
  selectedClass: HeroClassId;
  hp: number;
  maxHp: number;
  skillCd: number;
  skillMaxCd: number;
  skill2Cd: number;
  skill2MaxCd: number;
  ultCd: number;
  ultMaxCd: number;
  dodgeCd: number;
  dodgeMaxCd: number;
  relics: RelicId[];
  bossActive: boolean;
  bossName: string;
  bossHp: number;
  bossMaxHp: number;
  interactPrompt: string | null;
  bannerText: string | null;
  currentRoomType: RoomType;
}
