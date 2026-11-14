export type HeroClassId = 'knight' | 'barbarian' | 'rogue' | 'mage' | 'ranger';

export interface HeroClassDef {
  id: HeroClassId;
  name: string;
  role: string;
  modelFile: string;
  textureFile: string;
  rightWeapon: string;
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

export type GamePhase = 'loading' | 'title' | 'playing' | 'relic_draft' | 'dead';

export interface HUDState {
  phase: GamePhase;
  floor: number;
  kills: number;
  gold: number;
  selectedClass: HeroClassId;
  hp: number;
  maxHp: number;
  skillCd: number;
  skillMaxCd: number;
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
