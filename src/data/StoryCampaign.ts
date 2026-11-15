/**
 * THE ASHEN LEDGER — data-driven story campaign.
 *
 * Every cutscene is a list of Beats executed by CutsceneDirector.runScript().
 * Positions are [x, y, z] RELATIVE to the scene origin passed at runtime
 * (town square = 0,0,0; boss scenes use the boss-room centre; echo memories use the shard).
 *
 * Town layout reference (origin 0,0,0):
 *   Obelisk (Royal Seal) ...... [0, 0, -5.2]      Spire barrier/portal .. [0, 0, -10.5]
 *   Harvest Bonfire ........... [0, 0, 3.6]       Warden Aldric ......... [0, 0, -8.5]
 *   Garrett's forge ........... [-7.5, 0, -5.5]   Pip's vault ........... [7.5, 0, -5.5]
 *   Vaelen's loom ............. [-7.5, 0, 5.5]    Mira's apothecary ..... [7.5, 0, 5.5]
 */

import type { MusicMode } from '../audio/SoundEngine';
import type { TownNpcId } from '../types';

export type V3 = [number, number, number];

/** Semantic animation cues — resolved per-rig by the director (KayKit / monster packs). */
export type AnimCue = 'Idle' | 'Walk' | 'Run' | 'Cast' | 'Summon' | 'Roar' | 'Hit' | 'Death' | 'Kneel' | 'Attack' | 'Block' | 'Cheer';

export type SpeakerId =
  | 'vance'
  | 'aldric'
  | 'garrett'
  | 'mira'
  | 'pip'
  | 'vaelen'
  | 'malakor'
  | 'lyra'
  | 'warden'
  | 'auditor'
  | 'commander'
  | 'mirror'
  | 'echo'
  | 'elsie';

export interface Speaker {
  name: string;
  title: string;
  color: string;
}

export const SPEAKERS: Record<SpeakerId, Speaker> = {
  vance: { name: 'Mayor Vance', title: 'Mayor of Oakhaven', color: '#facc15' },
  aldric: { name: 'Warden Aldric', title: 'Captain of the Oakhaven Watch', color: '#fde68a' },
  garrett: { name: 'Garrett', title: 'Master Blacksmith', color: '#f97316' },
  mira: { name: 'Mira', title: 'Alchemist', color: '#34d399' },
  pip: { name: 'Pip', title: 'Vault Keeper', color: '#38bdf8' },
  vaelen: { name: 'Vaelen', title: 'Soul Weaver', color: '#c084fc' },
  malakor: { name: 'Archivist Malakor', title: 'Keeper of the First Seal', color: '#67e8f9' },
  lyra: { name: 'Thorn-Weaver Lyra', title: 'Corrupted Grove Guardian', color: '#86efac' },
  warden: { name: 'The Abyssal Warden', title: 'Holder of the Ledger', color: '#a855f7' },
  auditor: { name: 'You', title: 'Royal Relic Auditor', color: '#e2e8f0' },
  commander: { name: 'You — Ten Years Ago', title: 'First Spire Commander', color: '#fbbf24' },
  mirror: { name: 'The Obsidian Mirror', title: 'What the Spire Remembers', color: '#818cf8' },
  echo: { name: 'Echo', title: 'Crystallized Memory', color: '#a5b4fc' },
  elsie: { name: 'Elsie', title: "Garrett's Daughter", color: '#fda4af' },
};

export type Beat =
  | { op: 'fade'; to: 'black' | 'clear'; dur: number }
  | { op: 'chapter'; act: string; title: string; sub: string; dur?: number }
  | { op: 'cam'; pos: V3; look: V3; dur: number }
  /** Catmull-Rom camera spline through `points`; `look` may be a single target or its own spline. */
  | { op: 'spline'; points: V3[]; look: V3 | V3[]; dur: number }
  | { op: 'orbit'; center: V3; angle: number; radius: number; height: number; dur: number }
  | { op: 'fov'; fov: number; dur: number }
  | { op: 'spawn'; id: string; model: string; at: V3; scale?: number; tint?: number; rWep?: string; lWep?: string; anim?: AnimCue; face?: V3; rim?: number }
  | { op: 'remove'; id: string }
  | { op: 'place'; id: string; at: V3; face?: V3 }
  | { op: 'move'; id: string; to: V3; anim?: AnimCue; dur: number }
  | { op: 'anim'; id: string; cue: AnimCue; loop?: boolean }
  | { op: 'face'; id: string; to: V3 }
  | { op: 'light'; id: string; at: V3; color: number; intensity: number; dist?: number }
  | { op: 'lightShift'; id: string; color: number; intensity?: number; dur: number }
  | { op: 'shake'; amt: number; dur: number }
  | { op: 'burst'; at: V3; color: number; count?: number }
  | { op: 'ritual'; at: V3; color: number }
  | { op: 'lightning'; from: V3; to: V3; color: number }
  | { op: 'chains'; id: string; from: V3; to: V3[]; color?: number }
  | { op: 'breakChains'; id: string }
  | { op: 'flash'; color: number; amt: number }
  | { op: 'music'; mode: MusicMode }
  | { op: 'stinger'; kind: 'reveal' | 'betrayal' | 'triumph' | 'memory' }
  | { op: 'sfx'; name: 'chains' | 'explosion' | 'whoosh' | 'ice' | 'lightning' | 'heal' | 'fire' | 'bash' | 'levelup' | 'jobchange' | 'coins' | 'refine' }
  | { op: 'say'; who: SpeakerId; text: string; title?: string }
  | { op: 'wait'; dur: number }
  | { op: 'par'; beats: Beat[] }
  | { op: 'brand'; level: number }
  | { op: 'biome'; id: 'town' | 'town_dawn' | 'crypt' | 'ruins' | 'spire' | 'abyss' };

export interface CutsceneScript {
  id: string;
  title: string;
  /** Short line shown in the Journal replay list. */
  logline: string;
  beats: Beat[];
}

// ───────────────────────────── Shared positions ─────────────────────────────
const OBELISK: V3 = [0, 0, -5.2];
const OBELISK_TOP: V3 = [0, 3.4, -5.2];
const PORTAL: V3 = [0, 0, -10.5];
const FORGE: V3 = [-7.5, 0, -5.5];
const VAULT: V3 = [7.5, 0, -5.5];
const LOOM: V3 = [-7.5, 0, 5.5];
const LAB: V3 = [7.5, 0, 5.5];

// ═════════════════════════════ PROLOGUE ═════════════════════════════

const PROLOGUE: CutsceneScript = {
  id: 'prologue_debt',
  title: 'Prologue — The Debt of Oakhaven',
  logline: 'Mayor Vance breaks the Royal Seal and inks your name onto the final page.',
  beats: [
    { op: 'fade', to: 'black', dur: 0.01 },
    { op: 'music', mode: 'cutscene' },
    { op: 'biome', id: 'town' },
    { op: 'fov', fov: 40, dur: 0.01 },
    { op: 'place', id: 'player', at: [0, 0, 1.0], face: OBELISK },
    { op: 'spawn', id: 'vance', model: 'characters/Mage.glb', at: [0, 0, -3.6], tint: 0xb45309, rim: 0xfacc15, rWep: 'weapons/pack_scythe.glb', anim: 'Idle', face: [0, 0, 1] },
    { op: 'light', id: 'hearth', at: [0, 1.6, 3.6], color: 0xff9a3c, intensity: 26, dist: 18 },
    { op: 'light', id: 'seal', at: [0, 3.8, -5.2], color: 0xfde68a, intensity: 10, dist: 12 },
    { op: 'cam', pos: [1.6, 1.9, -0.6], look: [0, 1.7, -3.6], dur: 0.01 },
    // 30-second hook: voice in the dark, then the seal breaks.
    { op: 'say', who: 'vance', text: 'Seven years of triple tithe, and not one cart of ore has left our gates. You came to audit our books, Auditor? Then read the last page.' },
    {
      op: 'par',
      beats: [
        { op: 'fade', to: 'clear', dur: 1.2 },
        { op: 'spline', points: [[1.6, 1.9, -0.6], [2.6, 2.3, 0.6], [3.4, 2.8, 2.0]], look: [[0, 1.7, -3.6], [0, 1.9, -4.4], [0, 2.4, -5.2]], dur: 3.0 },
      ],
    },
    { op: 'say', who: 'vance', title: 'Mayor of Oakhaven', text: 'Welcome to our Harvest Bonfire. Mind the ward line — you are standing inside it.' },
    { op: 'move', id: 'vance', to: [0, 0, -4.4], anim: 'Walk', dur: 0.9 },
    { op: 'face', id: 'vance', to: OBELISK },
    { op: 'anim', id: 'vance', cue: 'Summon' },
    { op: 'fov', fov: 52, dur: 0.35 },
    { op: 'flash', color: 0xffffff, amt: 1.4 },
    { op: 'stinger', kind: 'betrayal' },
    { op: 'lightning', from: [0, 14, -5.2], to: OBELISK_TOP, color: 0xc084fc },
    { op: 'shake', amt: 0.6, dur: 0.9 },
    { op: 'ritual', at: OBELISK, color: 0xa855f7 },
    { op: 'lightShift', id: 'seal', color: 0xa855f7, intensity: 30, dur: 0.4 },
    { op: 'lightShift', id: 'hearth', color: 0x9333ea, intensity: 14, dur: 1.4 },
    { op: 'sfx', name: 'chains' },
    {
      op: 'chains',
      id: 'soul_debt',
      from: OBELISK_TOP,
      to: [[-7.5, 1.2, -5.5], [7.5, 1.2, -5.5], [-7.5, 1.2, 5.5], [7.5, 1.2, 5.5], [0, 1.2, -8.5], [0, 1.0, 1.0]],
      color: 0xa855f7,
    },
    { op: 'brand', level: 1 },
    { op: 'anim', id: 'player', cue: 'Hit' },
    { op: 'orbit', center: [0, 0, -2.4], angle: Math.PI * 0.55, radius: 9, height: 4.2, dur: 2.6 },
    { op: 'face', id: 'vance', to: [0, 0, 1.0] },
    { op: 'fov', fov: 36, dur: 0.6 },
    { op: 'cam', pos: [-2.9, 2.1, -0.4], look: [0, 1.7, -4.4], dur: 0.8 },
    { op: 'say', who: 'vance', title: 'Signatory of the Abyssal Ledger', text: "Oakhaven's gold was never mined. It was borrowed — against every soul inside this ward." },
    { op: 'say', who: 'vance', title: 'Signatory of the Abyssal Ledger', text: 'When the Ledger closes at the bottom of the Spire, every name on its pages is collected. Yours, Auditor, is on the final line.' },
    { op: 'cam', pos: [0.5, 1.4, 2.6], look: [0, 1.0, 1.0], dur: 0.7 },
    { op: 'burst', at: [0, 1.0, 1.0], color: 0xa855f7, count: 26 },
    { op: 'say', who: 'auditor', text: 'A brand — burning purple, right through the skin of my wrist. It is counting down.' },
    { op: 'fov', fov: 46, dur: 0.6 },
    { op: 'cam', pos: [4.5, 3.2, -2.0], look: [0, 1.2, -8.0], dur: 1.0 },
    {
      op: 'par',
      beats: [
        { op: 'move', id: 'vance', to: [0, 0, -10.2], anim: 'Run', dur: 1.3 },
        { op: 'cam', pos: [3.0, 2.6, -5.4], look: [0, 1.0, -10.0], dur: 1.3 },
      ],
    },
    { op: 'lightning', from: [0, 12, -10.5], to: PORTAL, color: 0x7c3aed },
    { op: 'ritual', at: PORTAL, color: 0x7c3aed },
    { op: 'shake', amt: 0.35, dur: 0.5 },
    { op: 'remove', id: 'vance' },
    { op: 'say', who: 'vance', title: 'A voice from below', text: 'Come down and collect me, if you can. The Ledger is very patient, and I am very, very rich.' },
    { op: 'cam', pos: [-1.2, 2.4, -4.8], look: [0, 1.6, -8.5], dur: 1.0 },
    { op: 'anim', id: 'aldric', cue: 'Block' },
    { op: 'say', who: 'aldric', text: 'The barrier sealed behind him — only the branded can pass it now. That curse on your wrist is a key, Auditor.' },
    { op: 'cam', pos: [-4.6, 2.4, -2.6], look: [-7.5, 1.5, -5.5], dur: 1.0 },
    { op: 'anim', id: 'garrett', cue: 'Hit' },
    { op: 'say', who: 'garrett', text: "The chains are in our chests — I can feel them pulling! Please, descend before that book closes on all of us." },
    { op: 'spline', points: [[0, 6, 6], [0, 9, 10], [0, 12, 14]], look: [[0, 1.5, -4], [0, 1.0, -5], [0, 0.5, -6]], dur: 2.4 },
    { op: 'chapter', act: 'ACT I', title: 'THE FORGED KEY', sub: 'Speak to Warden Aldric and descend into the Sunken Archives', dur: 2.6 },
    { op: 'music', mode: 'town' },
  ],
};

// ═════════════════════════════ ACT I ═════════════════════════════

const ACT1_ARCHIVES: CutsceneScript = {
  id: 'act1_archives',
  title: 'Floor 1 — The Sunken Archives',
  logline: 'The brand burns hotter beneath Oakhaven.',
  beats: [
    { op: 'biome', id: 'crypt' },
    { op: 'cam', pos: [0, 10, 9], look: [0, 0.6, 0], dur: 0.01 },
    { op: 'spline', points: [[0, 10, 9], [3.5, 6, 6], [2.2, 2.6, 3.4]], look: [0, 1.0, 0], dur: 2.4 },
    { op: 'brand', level: 1 },
    { op: 'burst', at: [0, 1.0, 0], color: 0xa855f7, count: 16 },
    { op: 'say', who: 'auditor', text: 'The brand burns hotter down here. Somewhere in these archives is proof of who forged Vance’s key.' },
    { op: 'say', who: 'auditor', title: 'Hint', text: 'Glowing Echo Shards hold crystallized memories. Collect them — then check your Journal [Q].' },
    { op: 'chapter', act: 'FLOOR 1', title: 'THE SUNKEN ARCHIVES', sub: 'Act I — The Forged Key', dur: 2.0 },
  ],
};

const ACT1_MALAKOR: CutsceneScript = {
  id: 'act1_malakor',
  title: 'Archivist Malakor',
  logline: 'The Keeper of the First Seal reads a familiar name from the Ledger.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'spawn', id: 'malakor', model: 'characters/Skeleton_Mage.glb', at: [0, 0, -3.5], scale: 2.0, tint: 0x0e7490, rim: 0x67e8f9, rWep: 'weapons/Skeleton_Staff.gltf', anim: 'Idle', face: [0, 0, 4] },
    { op: 'spawn', id: 'tome', model: 'dungeon/artifact.gltf.glb', at: [0, 2.4, -2.4], scale: 1.1, tint: 0x22d3ee },
    { op: 'light', id: 'archive', at: [0, 6.0, 0.5], color: 0x22d3ee, intensity: 9, dist: 16 },
    { op: 'ritual', at: [0, 0.05, -3.5], color: 0x22d3ee },
    { op: 'fov', fov: 42, dur: 1.2 },
    { op: 'spline', points: [[7, 1.6, 7], [5.2, 2.4, 5.4], [3.4, 3.0, 4.6]], look: [[0, 2.0, -3.5], [0, 2.4, -3.5], [0, 2.6, -3.5]], dur: 2.0 },
    { op: 'anim', id: 'malakor', cue: 'Roar' },
    { op: 'lightning', from: [0, 12, -3.5], to: [0, 0.2, -3.5], color: 0x22d3ee },
    { op: 'shake', amt: 0.35, dur: 0.5 },
    { op: 'stinger', kind: 'reveal' },
    { op: 'say', who: 'malakor', text: 'Another branded debtor, stumbling through my stacks. Shall I read you the entry that opened this seal?' },
    { op: 'anim', id: 'malakor', cue: 'Cast' },
    { op: 'orbit', center: [0, 0, -3.5], angle: -Math.PI * 0.3, radius: 9.0, height: 3.2, dur: 2.0 },
    { op: 'say', who: 'malakor', text: '"Page one thousand, one hundred forty-seven. Garrett, Master Blacksmith. Price: one master key. Purchase: one daughter’s breath."' },
    { op: 'lightShift', id: 'archive', color: 0x7c3aed, intensity: 12, dur: 0.6 },
    { op: 'say', who: 'malakor', text: 'Your blacksmith forged the key that broke the Royal Seal. Now add your name beneath his!' },
    { op: 'remove', id: 'tome' },
    { op: 'remove', id: 'malakor' },
    { op: 'chapter', act: 'BOSS', title: 'ARCHIVIST MALAKOR', sub: 'Keeper of the First Seal', dur: 1.8 },
    { op: 'music', mode: 'boss' },
  ],
};

const ACT1_MALAKOR_FALLS: CutsceneScript = {
  id: 'act1_malakor_falls',
  title: 'The First Seal Breaks',
  logline: "Malakor's memory crystallizes into a Monster Card.",
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'fov', fov: 40, dur: 0.6 },
    { op: 'cam', pos: [4.4, 3.2, 4.4], look: [0, 1.2, -3.5], dur: 1.0 },
    { op: 'burst', at: [0, 1.4, -3.5], color: 0x67e8f9, count: 40 },
    { op: 'flash', color: 0x67e8f9, amt: 0.8 },
    { op: 'stinger', kind: 'memory' },
    { op: 'say', who: 'malakor', text: 'The smith’s debt is... paid in full. But yours, Auditor... yours has only begun.' },
    { op: 'ritual', at: [0, 0.05, -3.5], color: 0x67e8f9 },
    { op: 'say', who: 'echo', title: 'Monster Card', text: "Malakor's last memory crystallizes into a card — guardians remember, even after they fall." },
    { op: 'say', who: 'auditor', text: 'Garrett. The man who welcomed me with a mug of cider. Time I had a word with him.' },
    { op: 'chapter', act: 'FIRST SEAL BROKEN', title: 'RETURN TO OAKHAVEN', sub: 'Confront the blacksmith at his forge', dur: 2.0 },
  ],
};

const ACT1_GARRETT: CutsceneScript = {
  id: 'act1_garrett_confession',
  title: "Garrett's Confession",
  logline: 'The Master Blacksmith admits he forged the key — and swears to atone.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'place', id: 'player', at: [-4.6, 0, -3.4], face: FORGE },
    { op: 'face', id: 'garrett', to: [-4.6, 0, -3.4] },
    { op: 'light', id: 'forge', at: [-6.2, 1.4, -4.6], color: 0xff6a1a, intensity: 22, dist: 10 },
    { op: 'fov', fov: 38, dur: 0.6 },
    { op: 'spline', points: [[-2.2, 3.4, -0.4], [-3.4, 2.4, -2.0], [-4.0, 1.9, -2.8]], look: [[-7.5, 1.6, -5.5], [-7.5, 1.6, -5.5], [-7.5, 1.7, -5.5]], dur: 1.8 },
    { op: 'sfx', name: 'refine' },
    { op: 'say', who: 'garrett', text: 'You found the page. Yes — I forged Vance’s key from a wax impression of the Royal Seal.' },
    { op: 'anim', id: 'garrett', cue: 'Kneel' },
    { op: 'say', who: 'garrett', text: "Elsie was coughing blood every night. Mira's elixir saved her, and Vance paid for every drop in soul-gold." },
    { op: 'say', who: 'auditor', text: 'Every coin in Oakhaven was bought with somebody’s soul. Including the ones you were paid with.' },
    { op: 'lightShift', id: 'forge', color: 0xffc04d, intensity: 32, dur: 1.0 },
    { op: 'burst', at: [-6.2, 1.2, -4.6], color: 0xffa94d, count: 30 },
    { op: 'say', who: 'garrett', text: 'Then let this anvil pay some of it back. My forge burns at Masterwork heat again — +7 to +10, auras and all.' },
    { op: 'say', who: 'garrett', text: 'And take this blade. I hammered it the night I sold my soul — it carries one socket, for a memory worth keeping.' },
    { op: 'sfx', name: 'coins' },
    { op: 'say', who: 'garrett', text: 'One more thing. The elixir Mira brewed for Elsie was green as spring moss. Ask her where she learned that recipe.' },
    { op: 'chapter', act: 'UNLOCKED', title: 'MASTERWORK REFINEMENT', sub: '+7 to +10 Refining  ·  Atonement Blade [1 Socket]', dur: 2.4 },
    { op: 'music', mode: 'town' },
  ],
};

// ═════════════════════════════ ACT II ═════════════════════════════

const ACT2_RUINS: CutsceneScript = {
  id: 'act2_ruins',
  title: 'Floor 2 — The Overgrown Ruins',
  logline: 'Roots and spores swallow the second floor of the Spire.',
  beats: [
    { op: 'biome', id: 'ruins' },
    { op: 'cam', pos: [-6, 9, 8], look: [0, 0.6, 0], dur: 0.01 },
    { op: 'spline', points: [[-6, 9, 8], [-3, 5, 6], [-1.6, 2.4, 3.6]], look: [0, 1.1, 0], dur: 2.4 },
    { op: 'brand', level: 2 },
    { op: 'say', who: 'auditor', text: 'The brand has crept up past my wrist. Something in these ruins keeps whispering my old rank.' },
    { op: 'chapter', act: 'ACT II', title: 'THE PRICE OF IMMORTALITY', sub: 'Floor 2 — The Overgrown Subterranean Ruins', dur: 2.2 },
  ],
};

const ACT2_MIRROR: CutsceneScript = {
  id: 'act2_obsidian_mirror',
  title: 'The Obsidian Mirror',
  logline: 'A flashback reveals you sealed the Abyssal Warden ten years ago.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'light', id: 'mirror', at: [0, 3.2, -1.0], color: 0x818cf8, intensity: 20, dist: 14 },
    { op: 'fov', fov: 34, dur: 1.4 },
    { op: 'cam', pos: [2.4, 1.8, 3.4], look: [0, 2.0, -1.6], dur: 1.4 },
    { op: 'stinger', kind: 'memory' },
    { op: 'say', who: 'mirror', text: 'Look closer, Auditor. Look at who you were.' },
    { op: 'flash', color: 0xc7d2fe, amt: 1.6 },
    { op: 'fade', to: 'black', dur: 0.4 },
    // ── Flashback: ten years ago ──
    { op: 'spawn', id: 'commander', model: 'characters/Knight.glb', at: [-1.6, 0, 1.0], tint: 0x92400e, rim: 0xfbbf24, rWep: 'weapons/pack_sword_golden.glb', lWep: 'weapons/pack_shield_celtic.glb', anim: 'Idle', face: [0, 0, -3] },
    { op: 'spawn', id: 'warden_past', model: 'monsters/Demon.gltf', at: [0, 0, -4.2], scale: 2.4, tint: 0x581c87, rim: 0xc084fc, anim: 'Idle', face: [-1.6, 0, 1.0] },
    { op: 'spawn', id: 'vaelen_past', model: 'characters/Mage.glb', at: [-3.4, 0, 2.2], tint: 0x6b21a8, rim: 0xc084fc, rWep: 'weapons/staff.gltf', anim: 'Idle', face: [-1.6, 0, 1.0] },
    { op: 'lightShift', id: 'mirror', color: 0xfbbf24, intensity: 24, dur: 0.1 },
    { op: 'cam', pos: [3.4, 2.2, 3.6], look: [-0.6, 1.6, -1.4], dur: 0.01 },
    { op: 'fade', to: 'clear', dur: 0.8 },
    { op: 'chapter', act: 'TEN YEARS AGO', title: 'THE FIRST SEAL', sub: 'The Spire Core', dur: 1.6 },
    { op: 'anim', id: 'warden_past', cue: 'Roar' },
    { op: 'shake', amt: 0.45, dur: 0.7 },
    { op: 'move', id: 'commander', to: [-0.8, 0, -1.2], anim: 'Run', dur: 0.8 },
    { op: 'anim', id: 'commander', cue: 'Attack' },
    { op: 'lightning', from: [0, 12, -4.2], to: [0, 0.4, -4.2], color: 0xfbbf24 },
    { op: 'ritual', at: [0, 0.05, -4.2], color: 0xfbbf24 },
    { op: 'flash', color: 0xfbbf24, amt: 0.9 },
    { op: 'orbit', center: [-0.4, 0, -2.6], angle: Math.PI * 0.4, radius: 6.5, height: 2.8, dur: 2.2 },
    { op: 'say', who: 'commander', text: 'Seal it from the inside. If I have to stay down here with it — then I stay.' },
    { op: 'move', id: 'vaelen_past', to: [-2.2, 0, 0.4], anim: 'Walk', dur: 0.8 },
    { op: 'anim', id: 'vaelen_past', cue: 'Cast' },
    { op: 'say', who: 'vaelen', title: 'Soul Weaver — Ten Years Ago', text: 'Hold still, Commander. The Capital wants the seal — not your memory of how it was made.' },
    { op: 'say', who: 'commander', text: 'Then take it. But when the seal cracks, send me back here.' },
    { op: 'flash', color: 0xffffff, amt: 1.5 },
    { op: 'fade', to: 'black', dur: 0.5 },
    { op: 'remove', id: 'commander' },
    { op: 'remove', id: 'warden_past' },
    { op: 'remove', id: 'vaelen_past' },
    // ── Back to the present ──
    { op: 'lightShift', id: 'mirror', color: 0x818cf8, intensity: 26, dur: 0.1 },
    { op: 'cam', pos: [1.8, 1.7, 2.6], look: [0, 1.9, -1.6], dur: 0.01 },
    { op: 'fade', to: 'clear', dur: 0.8 },
    { op: 'shake', amt: 0.3, dur: 0.6 },
    { op: 'burst', at: [0, 2.0, -1.6], color: 0x818cf8, count: 36 },
    { op: 'stinger', kind: 'reveal' },
    { op: 'say', who: 'mirror', text: 'You were the First Spire Commander. The Capital did not send an auditor to Oakhaven — it sent the jailer home.' },
    { op: 'brand', level: 3 },
    { op: 'say', who: 'auditor', text: 'Vaelen. The quiet weaver by the loom. He took my memories — and he has been watching me ever since.' },
    { op: 'chapter', act: 'TWIST', title: 'THE FIRST SPIRE COMMANDER', sub: 'Confront Vaelen in Oakhaven', dur: 2.2 },
    { op: 'music', mode: 'explore' },
  ],
};

const ACT2_LYRA: CutsceneScript = {
  id: 'act2_lyra',
  title: 'Thorn-Weaver Lyra',
  logline: 'A grove guardian, poisoned by an alchemist’s tonic.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'spawn', id: 'lyra', model: 'monsters/MushroomKing.gltf', at: [0, 0, -3.5], scale: 2.1, tint: 0x15803d, rim: 0xa3e635, anim: 'Idle', face: [0, 0, 4] },
    { op: 'light', id: 'grove', at: [0, 6.0, 0.5], color: 0x4ade80, intensity: 9, dist: 16 },
    { op: 'ritual', at: [0, 0.05, -3.5], color: 0x22c55e },
    { op: 'fov', fov: 38, dur: 1.0 },
    { op: 'spline', points: [[-7, 1.6, 7], [-5, 2.4, 5.4], [-3.4, 3.0, 4.6]], look: [0, 2.2, -3.5], dur: 2.0 },
    { op: 'anim', id: 'lyra', cue: 'Roar' },
    { op: 'shake', amt: 0.35, dur: 0.6 },
    { op: 'say', who: 'lyra', text: 'The green woman promised my grove would live forever. Three drops in my spring, and now the roots only remember hunger.' },
    { op: 'lightShift', id: 'grove', color: 0x84cc16, intensity: 12, dur: 0.6 },
    { op: 'orbit', center: [0, 0, -3.5], angle: Math.PI * 0.35, radius: 9.0, height: 3.2, dur: 2.0 },
    { op: 'say', who: 'lyra', text: 'Kneel, branded one. Become soil for my thorns!' },
    { op: 'remove', id: 'lyra' },
    { op: 'chapter', act: 'BOSS', title: 'THORN-WEAVER LYRA', sub: 'Corrupted Grove Guardian', dur: 1.8 },
    { op: 'music', mode: 'boss' },
  ],
};

const ACT2_LYRA_FALLS: CutsceneScript = {
  id: 'act2_lyra_falls',
  title: 'The Grove Remembers',
  logline: 'Lyra names the alchemist with green-stained hands.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'cam', pos: [4.4, 3.2, 4.4], look: [0, 1.2, -3.5], dur: 1.0 },
    { op: 'burst', at: [0, 1.4, -3.5], color: 0x86efac, count: 40 },
    { op: 'stinger', kind: 'memory' },
    { op: 'say', who: 'lyra', text: 'The tonic... came from your town. A woman with green-stained hands, and a lab beneath her shop.' },
    { op: 'say', who: 'echo', title: 'Monster Card', text: "Lyra's memory blooms into a card — the grove's last breath, crystallized." },
    { op: 'say', who: 'auditor', text: 'Mira. The same hands that saved Garrett’s daughter.' },
    { op: 'chapter', act: 'SECOND SEAL BROKEN', title: 'RETURN TO OAKHAVEN', sub: "Expose Mira's secret lab", dur: 2.0 },
  ],
};

const ACT2_MIRA: CutsceneScript = {
  id: 'act2_mira_exposed',
  title: "Mira's Secret Lab",
  logline: 'The alchemist admits her soul-tonics corrupted Lyra.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'place', id: 'player', at: [4.8, 0, 3.4], face: LAB },
    { op: 'face', id: 'mira', to: [4.8, 0, 3.4] },
    { op: 'light', id: 'lab', at: [6.0, 1.4, 4.8], color: 0x34d399, intensity: 22, dist: 10 },
    { op: 'fov', fov: 38, dur: 0.6 },
    { op: 'spline', points: [[2.6, 3.2, 1.0], [3.8, 2.2, 2.4], [4.4, 1.9, 2.9]], look: [7.5, 1.6, 5.5], dur: 1.8 },
    { op: 'say', who: 'mira', text: "Don't look at me like that. Vance paid for immortality tonics, and I needed a guardian to test them on." },
    { op: 'say', who: 'mira', text: 'Lyra was supposed to live forever. She did — just not as herself.' },
    { op: 'say', who: 'auditor', text: 'You brewed Elsie’s cure from the same recipe.' },
    { op: 'anim', id: 'mira', cue: 'Kneel' },
    { op: 'lightShift', id: 'lab', color: 0xa7f3d0, intensity: 30, dur: 0.8 },
    { op: 'say', who: 'mira', text: 'I saved one child with the formula that damned a forest. Take my lab — converters, awakening draughts, card extraction. Use it better than I did.' },
    { op: 'chapter', act: 'UNLOCKED', title: "MIRA'S LAB", sub: 'Elemental Converters  ·  Awakening Potions  ·  Card Extraction', dur: 2.4 },
    { op: 'music', mode: 'town' },
  ],
};

const ACT2_VAELEN: CutsceneScript = {
  id: 'act2_vaelen_confession',
  title: "Vaelen's Confession",
  logline: 'The Soul Weaver admits he unwove your memories for the Capital.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'place', id: 'player', at: [-4.8, 0, 3.4], face: LOOM },
    { op: 'face', id: 'vaelen', to: [-4.8, 0, 3.4] },
    { op: 'light', id: 'loom', at: [-6.0, 2.0, 4.8], color: 0xc084fc, intensity: 22, dist: 10 },
    { op: 'fov', fov: 36, dur: 0.6 },
    { op: 'spline', points: [[-2.4, 3.2, 1.2], [-3.8, 2.2, 2.4], [-4.3, 1.9, 2.9]], look: [-7.5, 1.7, 5.5], dur: 1.8 },
    { op: 'say', who: 'vaelen', text: 'So the mirror finally showed you. Yes, Commander — I am the one who unwove your memories, on the Capital’s orders.' },
    { op: 'anim', id: 'vaelen', cue: 'Cast' },
    { op: 'burst', at: [-6.2, 1.6, 4.6], color: 0xc084fc, count: 30 },
    { op: 'say', who: 'vaelen', text: 'But I never cut the threads. I kept them, waiting for the day the seal cracked.' },
    { op: 'say', who: 'vaelen', text: "Let me weave them back. You'll wear the Spire Warden's sealed power as your own — your true Job." },
    { op: 'chapter', act: 'UNLOCKED', title: 'JOB ADVANCEMENT', sub: "Reclaim the First Commander's power at Vaelen's loom", dur: 2.4 },
    { op: 'music', mode: 'town' },
  ],
};

const ACT2_PIP: CutsceneScript = {
  id: 'act2_pip_confession',
  title: "Pip's Receipts",
  logline: 'The Vault Keeper confesses Zeny is minted from soul-gold.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'place', id: 'player', at: [4.8, 0, -3.4], face: VAULT },
    { op: 'face', id: 'pip', to: [4.8, 0, -3.4] },
    { op: 'light', id: 'vault', at: [6.0, 1.6, -4.6], color: 0xfacc15, intensity: 20, dist: 10 },
    { op: 'fov', fov: 38, dur: 0.6 },
    { op: 'spline', points: [[2.6, 3.0, -1.0], [3.8, 2.2, -2.4], [4.3, 1.9, -2.9]], look: [7.5, 1.6, -5.5], dur: 1.6 },
    { op: 'sfx', name: 'coins' },
    { op: 'say', who: 'pip', text: 'Fine! Every Zeny in Oakhaven is minted from soul-gold pumped out of the Spire. I counted every coin and said nothing.' },
    { op: 'say', who: 'pip', text: 'And the Capital pays me for reports on exactly one person. You.' },
    { op: 'say', who: 'pip', text: 'Take my ledger copies — I know which monsters carry the richest soul-gold. You’ll earn more Zeny from every kill.' },
    { op: 'chapter', act: 'UNLOCKED', title: "PIP'S SOUL-GOLD LEDGER", sub: '+25% Zeny from monsters  ·  Free card re-socketing', dur: 2.2 },
    { op: 'music', mode: 'town' },
  ],
};

// ═════════════════════════════ ACT III ═════════════════════════════

const ACT3_SPIRE: CutsceneScript = {
  id: 'act3_spire',
  title: 'Floor 3 — The Obsidian Spire Core',
  logline: 'Magma light and the hum of a closing book.',
  beats: [
    { op: 'biome', id: 'spire' },
    { op: 'cam', pos: [6, 10, 8], look: [0, 0.6, 0], dur: 0.01 },
    { op: 'spline', points: [[6, 10, 8], [3, 5, 6], [1.6, 2.4, 3.6]], look: [0, 1.1, 0], dur: 2.4 },
    { op: 'brand', level: 4 },
    { op: 'shake', amt: 0.2, dur: 1.0 },
    { op: 'say', who: 'auditor', text: 'The Ledger is close — I can hear the pages turning. My brand is nearly up to the shoulder.' },
    { op: 'chapter', act: 'ACT III', title: 'THE FINAL SIGNATURE', sub: 'Floor 3 — The Obsidian Spire Core', dur: 2.2 },
  ],
};

const ACT3_VANCE: CutsceneScript = {
  id: 'act3_vance',
  title: 'Mayor Vance, Sovereign of Greed',
  logline: 'Vance makes his stand atop a fortune of stolen Zeny.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'spawn', id: 'vance', model: 'characters/Mage.glb', at: [0, 0, -3.5], scale: 1.55, tint: 0xb45309, rim: 0xfde047, rWep: 'weapons/pack_scythe.glb', anim: 'Idle', face: [0, 0, 4] },
    { op: 'spawn', id: 'ledger', model: 'dungeon/artifact.gltf.glb', at: [0, 3.2, -5.2], scale: 1.6, tint: 0x7c3aed },
    { op: 'light', id: 'gold', at: [0, 6.0, 0.5], color: 0xfacc15, intensity: 10, dist: 18 },
    { op: 'ritual', at: [0, 0.05, -3.5], color: 0xfacc15 },
    { op: 'fov', fov: 50, dur: 0.01 },
    { op: 'cam', pos: [0, 3.2, 6.8], look: [0, 2.0, -3.5], dur: 0.01 },
    { op: 'fov', fov: 36, dur: 1.6 },
    { op: 'spline', points: [[0, 3.2, 7.5], [3.0, 2.6, 5.0], [2.8, 2.4, 3.2]], look: [[0, 1.8, -3.5], [0, 1.9, -3.5], [0, 2.0, -3.5]], dur: 1.8 },
    { op: 'sfx', name: 'coins' },
    { op: 'say', who: 'vance', title: 'Sovereign of Greed', text: 'You reached the bottom of the Ledger, Commander. Did they ever tell you the Capital took a cut of every soul?' },
    { op: 'anim', id: 'vance', cue: 'Summon' },
    { op: 'lightning', from: [0, 12, -3.5], to: [0, 0.3, -3.5], color: 0xfacc15 },
    { op: 'burst', at: [-3, 1.0, -3], color: 0xfacc15, count: 24 },
    { op: 'burst', at: [3, 1.0, -3], color: 0xfacc15, count: 24 },
    { op: 'shake', amt: 0.4, dur: 0.6 },
    { op: 'orbit', center: [0, 0, -3.5], angle: Math.PI * 0.3, radius: 7.4, height: 3.0, dur: 2.2 },
    { op: 'say', who: 'vance', title: 'Sovereign of Greed', text: "Oakhaven's gold built their palaces, and my constructs will bury you in it. I'll settle my account with YOUR name!" },
    { op: 'remove', id: 'vance' },
    { op: 'remove', id: 'ledger' },
    { op: 'chapter', act: 'FINAL BOSS — PHASE 1', title: 'MAYOR VANCE', sub: 'Sovereign of Greed', dur: 1.8 },
    { op: 'music', mode: 'boss' },
  ],
};

const ACT3_BETRAYAL: CutsceneScript = {
  id: 'act3_warden_betrayal',
  title: 'The Warden Collects',
  logline: 'The Abyssal Warden takes Vance’s own soul as payment.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'spawn', id: 'vance', model: 'characters/Mage.glb', at: [0, 0, -3.0], scale: 1.55, tint: 0x92400e, rim: 0xfde047, anim: 'Kneel', face: [0, 0, 4] },
    { op: 'light', id: 'abyss', at: [0, 6.0, 0.0], color: 0xfacc15, intensity: 9, dist: 18 },
    { op: 'fov', fov: 34, dur: 0.6 },
    { op: 'cam', pos: [2.4, 2.0, 0.6], look: [0, 1.2, -3.0], dur: 0.8 },
    { op: 'say', who: 'vance', title: 'On his knees', text: 'Ledger! I paid you every soul in Oakhaven — take the Commander, not me!' },
    { op: 'lightShift', id: 'abyss', color: 0x7e22ce, intensity: 14, dur: 0.8 },
    { op: 'shake', amt: 0.5, dur: 1.2 },
    { op: 'stinger', kind: 'betrayal' },
    { op: 'sfx', name: 'chains' },
    { op: 'chains', id: 'collect', from: [0, 7, -6.5], to: [[0, 1.2, -3.0], [-0.6, 0.6, -3.0], [0.6, 0.6, -3.0]], color: 0x9333ea },
    { op: 'say', who: 'warden', title: 'Holder of the Ledger', text: 'A signature is a signature, Mayor. Your account is closed.' },
    { op: 'anim', id: 'vance', cue: 'Death' },
    { op: 'flash', color: 0xa855f7, amt: 1.4 },
    { op: 'burst', at: [0, 1.2, -3.0], color: 0xa855f7, count: 50 },
    { op: 'remove', id: 'vance' },
    { op: 'breakChains', id: 'collect' },
    { op: 'spawn', id: 'warden', model: 'monsters/Demon.gltf', at: [0, 0, -3.5], scale: 2.6, tint: 0x581c87, rim: 0xc084fc, anim: 'Roar', face: [0, 0, 4] },
    { op: 'ritual', at: [0, 0.05, -3.5], color: 0x7e22ce },
    { op: 'lightning', from: [0, 14, -3.5], to: [0, 0.3, -3.5], color: 0xc084fc },
    { op: 'fov', fov: 54, dur: 0.6 },
    { op: 'spline', points: [[0, 1.0, 4.0], [3.0, 2.6, 5.4], [0, 4.4, 7.4]], look: [[0, 3.0, -3.5], [0, 3.4, -3.5], [0, 3.0, -3.5]], dur: 2.2 },
    { op: 'say', who: 'warden', title: 'Shadow-Armored Colossus', text: 'Hello again, jailer. This time I keep your memories — and the soul they belong to.' },
    { op: 'remove', id: 'warden' },
    { op: 'chapter', act: 'FINAL BOSS — PHASE 2', title: 'THE ABYSSAL WARDEN', sub: 'Shatter the Ledger', dur: 1.8 },
    { op: 'music', mode: 'boss' },
  ],
};

const ACT3_SHATTER: CutsceneScript = {
  id: 'act3_ledger_shattered',
  title: 'The Ledger Shatters',
  logline: 'With no last page left, the Abyssal Ledger breaks.',
  beats: [
    { op: 'music', mode: 'cutscene' },
    { op: 'spawn', id: 'ledger', model: 'dungeon/artifact.gltf.glb', at: [0, 2.6, -3.5], scale: 1.8, tint: 0x7c3aed },
    { op: 'light', id: 'core', at: [0, 3.6, -2.0], color: 0x7c3aed, intensity: 26, dist: 18 },
    { op: 'fov', fov: 38, dur: 0.6 },
    { op: 'cam', pos: [2.6, 2.4, 2.4], look: [0, 2.6, -3.5], dur: 1.0 },
    { op: 'say', who: 'warden', title: 'Fading', text: 'You cannot close... a ledger... that has no last page...' },
    { op: 'say', who: 'auditor', title: 'The First Spire Commander', text: 'Then I will tear out every page.' },
    { op: 'lightShift', id: 'core', color: 0xfacc15, intensity: 40, dur: 0.8 },
    { op: 'flash', color: 0xfff1b8, amt: 2.0 },
    { op: 'stinger', kind: 'triumph' },
    { op: 'shake', amt: 0.7, dur: 1.2 },
    { op: 'burst', at: [0, 2.6, -3.5], color: 0xfacc15, count: 60 },
    { op: 'burst', at: [0, 2.6, -3.5], color: 0xa855f7, count: 40 },
    { op: 'remove', id: 'ledger' },
    { op: 'brand', level: 0 },
    { op: 'fade', to: 'black', dur: 1.2 },
  ],
};

const ACT3_SUNRISE: CutsceneScript = {
  id: 'act3_sunrise',
  title: 'Sunrise over Oakhaven',
  logline: 'The Soul-Debt chains snap — and the Ledger’s pages scatter deeper.',
  beats: [
    { op: 'fade', to: 'black', dur: 0.01 },
    { op: 'music', mode: 'cutscene' },
    { op: 'biome', id: 'town_dawn' },
    { op: 'place', id: 'player', at: [0, 0, 0.6], face: OBELISK },
    { op: 'chains', id: 'town_chains', from: OBELISK_TOP, to: [[-7.5, 1.2, -5.5], [7.5, 1.2, -5.5], [-7.5, 1.2, 5.5], [7.5, 1.2, 5.5], [0, 1.2, -8.5]], color: 0xa855f7 },
    { op: 'light', id: 'sun', at: [10, 9, 12], color: 0xffc078, intensity: 60, dist: 60 },
    { op: 'cam', pos: [0, 12, 15], look: [0, 1.0, -2], dur: 0.01 },
    { op: 'fade', to: 'clear', dur: 1.6 },
    { op: 'spline', points: [[0, 12, 15], [7, 8, 10], [5, 3.4, 4.4]], look: [[0, 1.0, -2], [0, 2.0, -4], [0, 3.0, -5.2]], dur: 3.2 },
    { op: 'flash', color: 0xffe2a8, amt: 1.6 },
    { op: 'sfx', name: 'chains' },
    { op: 'breakChains', id: 'town_chains' },
    { op: 'burst', at: OBELISK_TOP, color: 0xfacc15, count: 60 },
    { op: 'ritual', at: OBELISK, color: 0xfacc15 },
    { op: 'stinger', kind: 'triumph' },
    { op: 'anim', id: 'aldric', cue: 'Cheer' },
    { op: 'anim', id: 'garrett', cue: 'Cheer' },
    { op: 'orbit', center: [0, 0, -1.5], angle: Math.PI * 0.7, radius: 12, height: 6, dur: 4.0 },
    { op: 'say', who: 'aldric', text: 'The chains are gone. For the first time in seven years, Oakhaven owes nobody anything.' },
    { op: 'cam', pos: [-4.4, 2.2, -2.8], look: [-7.5, 1.6, -5.5], dur: 1.2 },
    { op: 'say', who: 'garrett', text: 'Elsie woke up breathing on her own this morning. No elixir. No debt.' },
    { op: 'cam', pos: [-4.4, 2.2, 2.8], look: [-7.5, 1.6, 5.5], dur: 1.2 },
    { op: 'say', who: 'vaelen', text: 'Welcome home, Commander. Every thread is back where it belongs.' },
    { op: 'cam', pos: [4.4, 2.2, -2.8], look: [7.5, 1.4, -5.5], dur: 1.2 },
    { op: 'anim', id: 'pip', cue: 'Hit' },
    { op: 'say', who: 'pip', text: "Uh, Commander? The Ledger didn't vanish. Its pages scattered — deeper. Ninety-nine floors deeper, by my count." },
    { op: 'cam', pos: [1.6, 2.4, -4.0], look: [0, 1.6, -8.5], dur: 1.2 },
    { op: 'ritual', at: PORTAL, color: 0xd946ef },
    { op: 'say', who: 'aldric', text: 'Then the Spire gate stays open. Every MVP down there is carrying a page with somebody’s name on it.' },
    { op: 'spline', points: [[1.6, 2.4, -4.0], [0, 6, 4], [0, 14, 16]], look: [[0, 1.6, -8.5], [0, 1.0, -4], [0, 0, -2]], dur: 3.0 },
    { op: 'chapter', act: 'EPILOGUE', title: 'ENDLESS ABYSS UNLOCKED', sub: 'Floors 4–99  ·  MVP Hunts  ·  Rare Cards  ·  Level 99', dur: 3.0 },
    { op: 'music', mode: 'town' },
  ],
};

// ═════════════════════════════ ECHO SHARDS ═════════════════════════════

export interface EchoShardDef {
  id: string;
  floor: number;
  title: string;
  /** Short clue text shown in the Journal. */
  clue: string;
  /** NPC this memory implicates (drives the conspiracy tracker). */
  implicates?: TownNpcId | 'capital' | 'vance' | 'self';
  lines: Array<{ who: SpeakerId; title?: string; text: string }>;
  color: number;
}

export const ECHO_SHARDS: EchoShardDef[] = [
  // Floor 1 — The Forged Key
  {
    id: 'e1_wax',
    floor: 1,
    title: 'The Wax Impression',
    clue: 'Vance bought a wax cast of the Royal Seal with a promise of medicine.',
    implicates: 'blacksmith',
    color: 0x67e8f9,
    lines: [
      { who: 'vance', title: 'Memory — Seven Years Ago', text: 'Bring me a wax impression of the Royal Seal, and the elixir is yours. Your daughter will see spring.' },
      { who: 'echo', text: 'A heavy hand trembles as it presses wax against the Seal. The fingers are scarred by forge-burns.' },
    ],
  },
  {
    id: 'e1_quench',
    floor: 1,
    title: 'Rune-Steel Quench',
    clue: 'Only a Masterwork forge burns hot enough to make rune-steel sing.',
    implicates: 'blacksmith',
    color: 0x67e8f9,
    lines: [
      { who: 'echo', title: 'Memory — The Spire Key', text: 'Rune-steel only sings at Masterwork heat. There is exactly one forge in Oakhaven that hot.' },
      { who: 'echo', text: 'The quenching hiss forms a word in the steam: "Elsie."' },
    ],
  },
  {
    id: 'e1_tithe',
    floor: 1,
    title: 'The Triple Tithe',
    clue: 'The Capital accepted Oakhaven’s impossible gold and asked no questions.',
    implicates: 'capital',
    color: 0x67e8f9,
    lines: [
      { who: 'echo', title: 'Memory — A Royal Clerk', text: 'Triple tithe from Oakhaven again, and still no ore. Orders from above: accept the gold, ask nothing.' },
      { who: 'echo', text: 'The clerk stamps the receipt. The wax is the same purple as your brand.' },
    ],
  },
  // Floor 2 — The Price of Immortality
  {
    id: 'e2_tonic',
    floor: 2,
    title: 'The Green Tonic',
    clue: 'Someone poured soul-tonic into the grove guardian’s spring.',
    implicates: 'alchemist',
    color: 0x86efac,
    lines: [
      { who: 'mira', title: 'Memory — The Grove Spring', text: 'One drop to wake the roots. Three to make them obey. The guardian drinks whatever I pour into her spring.' },
      { who: 'echo', text: 'Green stains spread across the woman’s fingers like moss.' },
    ],
  },
  {
    id: 'e2_receipts',
    floor: 2,
    title: 'Receipts in Gold',
    clue: 'Every Zeny leaving Oakhaven’s vault is stamped with soul-gold.',
    implicates: 'kafra',
    color: 0x86efac,
    lines: [
      { who: 'pip', title: 'Memory — The Vault', text: 'Every Zeny that leaves my vault is stamped with soul-gold. I just keep the books.' },
      { who: 'pip', title: 'Memory — The Vault', text: "Keeping books isn't a crime. ...Is it?" },
    ],
  },
  {
    id: 'e2_oath',
    floor: 2,
    title: "The Commander's Oath",
    clue: 'A commander once chose to seal something from the inside.',
    implicates: 'self',
    color: 0xfbbf24,
    lines: [
      { who: 'echo', title: 'Memory — A Soldier', text: 'Commander, if you seal it from inside, you will not come back as yourself.' },
      { who: 'commander', text: 'Then send someone to remind me who I was.' },
    ],
  },
  // Floor 3 — The Final Signature
  {
    id: 'e3_bread',
    floor: 3,
    title: "The Mayor's First Signature",
    clue: 'Vance first signed the Ledger to feed a starving town.',
    implicates: 'vance',
    color: 0xfca5a5,
    lines: [
      { who: 'vance', title: 'Memory — The Hungry Winter', text: 'Three winters without bread. The Ledger offered grain for one signature, for one year.' },
      { who: 'vance', title: 'Memory — The Hungry Winter', text: 'It never let me stop signing.' },
    ],
  },
  {
    id: 'e3_ink',
    floor: 3,
    title: 'Only the Ink',
    clue: 'The Warden never served Vance — it was using him.',
    implicates: 'vance',
    color: 0xc084fc,
    lines: [
      { who: 'warden', title: 'Memory — The Core', text: 'Every signature is a door. The mayor believes he holds the pen.' },
      { who: 'warden', title: 'Memory — The Core', text: 'He is only the ink.' },
    ],
  },
  {
    id: 'e3_orders',
    floor: 3,
    title: 'Sealed Orders',
    clue: 'The Capital considered Oakhaven an acceptable loss.',
    implicates: 'capital',
    color: 0xfca5a5,
    lines: [
      { who: 'echo', title: 'Memory — A Capital Courier', text: 'If the Commander remembers, the Capital loses its leash. If the Commander fails, Oakhaven is an acceptable loss.' },
      { who: 'echo', text: 'The orders are signed with a royal seal — and a second, purple one.' },
    ],
  },
];

export function echoScript(def: EchoShardDef): CutsceneScript {
  const beats: Beat[] = [
    { op: 'stinger', kind: 'memory' },
    { op: 'flash', color: def.color, amt: 1.1 },
    { op: 'light', id: 'echo', at: [0, 2.4, 0], color: def.color, intensity: 16, dist: 10 },
    { op: 'fov', fov: 38, dur: 0.8 },
    { op: 'cam', pos: [2.2, 2.2, 3.0], look: [0, 1.4, 0], dur: 0.9 },
    { op: 'burst', at: [0, 1.4, 0], color: def.color, count: 30 },
  ];
  def.lines.forEach((l) => beats.push({ op: 'say', who: l.who, title: l.title, text: l.text }));
  beats.push({ op: 'chapter', act: 'ECHO SHARD', title: def.title.toUpperCase(), sub: def.clue, dur: 2.0 });
  return { id: `echo_${def.id}`, title: `Echo — ${def.title}`, logline: def.clue, beats };
}

// ═════════════════════════════ CONSPIRACIES ═════════════════════════════

export interface ConspiracyDef {
  id: string;
  npc: TownNpcId | 'capital';
  title: string;
  suspectName: string;
  hidden: string;
  suspected: string;
  exposed: string;
  atoned: string;
}

export const CONSPIRACIES: ConspiracyDef[] = [
  {
    id: 'forged_key',
    npc: 'blacksmith',
    title: 'The Forged Key',
    suspectName: 'Garrett, Master Blacksmith',
    hidden: 'Someone inside Oakhaven made the key that broke the Royal Seal.',
    suspected: 'The key needed Masterwork heat — and a wax cast of the Seal. Only one forge in town runs that hot.',
    exposed: 'Malakor read it from the Ledger: Garrett forged the key to buy his daughter’s cure. Confront him at the forge.',
    atoned: 'Garrett confessed and now refines Masterwork gear (+7 to +10) to make amends.',
  },
  {
    id: 'green_tonic',
    npc: 'alchemist',
    title: 'The Price of Immortality',
    suspectName: 'Mira, Alchemist',
    hidden: 'Something is twisting the guardians of the lower floors.',
    suspected: 'Soul-tonic was poured into the grove guardian’s spring by green-stained hands.',
    exposed: 'Lyra named her poisoner: the alchemist with a lab beneath her shop. Confront Mira.',
    atoned: "Mira surrendered her lab: Elemental Converters, Awakening Potions and Card Extraction.",
  },
  {
    id: 'soul_gold',
    npc: 'kafra',
    title: 'Soul-Gold Zeny',
    suspectName: 'Pip, Vault Keeper',
    hidden: 'Where does Oakhaven’s endless Zeny actually come from?',
    suspected: 'Every coin leaving Pip’s vault is stamped with soul-gold. Ask Pip about the receipts.',
    exposed: 'Pip has been minting soul-gold and reporting on you to the Capital. Confront Pip.',
    atoned: "Pip handed over the soul-gold ledgers: +25% Zeny from monsters and free card re-socketing.",
  },
  {
    id: 'lost_commander',
    npc: 'hypnotist',
    title: 'The Lost Commander',
    suspectName: 'Vaelen, Soul Weaver',
    hidden: 'Why does the Spire seem to recognise you?',
    suspected: 'A commander once sealed the Warden from inside — and asked to be reminded of who they were.',
    exposed: 'The Obsidian Mirror revealed you as the First Spire Commander. Vaelen unwove your memory. Confront him.',
    atoned: 'Vaelen kept your memories intact. He can now weave back your sealed power — Job Advancement.',
  },
  {
    id: 'acceptable_loss',
    npc: 'capital',
    title: 'An Acceptable Loss',
    suspectName: 'The Royal Capital',
    hidden: 'Who benefits from Oakhaven’s triple tithe?',
    suspected: 'The Capital accepted impossible gold for seven years without a single question.',
    exposed: 'Sealed orders call Oakhaven "an acceptable loss" — stamped with the Ledger’s purple seal.',
    atoned: 'With the Ledger shattered, the Capital’s leash is broken. Its scattered pages await in the Abyss.',
  },
];

// ═════════════════════════════ REGISTRY ═════════════════════════════

export const STORY_SCRIPTS: Record<string, CutsceneScript> = Object.fromEntries(
  [
    PROLOGUE,
    ACT1_ARCHIVES,
    ACT1_MALAKOR,
    ACT1_MALAKOR_FALLS,
    ACT1_GARRETT,
    ACT2_RUINS,
    ACT2_MIRROR,
    ACT2_LYRA,
    ACT2_LYRA_FALLS,
    ACT2_MIRA,
    ACT2_VAELEN,
    ACT2_PIP,
    ACT3_SPIRE,
    ACT3_VANCE,
    ACT3_BETRAYAL,
    ACT3_SHATTER,
    ACT3_SUNRISE,
    ...ECHO_SHARDS.map(echoScript),
  ].map((s) => [s.id, s])
);

/** Ordered list of main-story scenes for the Journal replay list. */
export const STORY_ORDER: string[] = [
  'prologue_debt',
  'act1_archives',
  'act1_malakor',
  'act1_malakor_falls',
  'act1_garrett_confession',
  'act2_ruins',
  'act2_obsidian_mirror',
  'act2_lyra',
  'act2_lyra_falls',
  'act2_mira_exposed',
  'act2_vaelen_confession',
  'act2_pip_confession',
  'act3_spire',
  'act3_vance',
  'act3_warden_betrayal',
  'act3_ledger_shattered',
  'act3_sunrise',
];

/** Story memory cards dropped by guardians ("Monster Cards are crystallized memories"). */
export const GUARDIAN_CARDS = {
  malakor: { id: 'card_malakor', name: 'Archivist Malakor Card', desc: '+8 DEX — the Archivist’s swift recall (faster casting)', icon: '📜', bonusStat: 'dex' as const, bonusAmt: 8 },
  lyra: { id: 'card_lyra', name: 'Thorn-Weaver Lyra Card', desc: '+10 AGI — the grove’s restless roots (ASPD & Flee)', icon: '🌿', bonusStat: 'agi' as const, bonusAmt: 10 },
  vance: { id: 'card_vance', name: 'Sovereign Vance Card', desc: '+10 LUK — a gambler’s last coin (Crit & Lucky Dodge)', icon: '🪙', bonusStat: 'luk' as const, bonusAmt: 10 },
  warden: { id: 'card_warden', name: 'Abyssal Warden Card', desc: '+12 STR — the colossus’ shadow-armored might', icon: '👁️', bonusStat: 'str' as const, bonusAmt: 12 },
};

/** Monster cards Mira can extract from crystallized monster memories. */
export const EXTRACTABLE_CARDS = [
  { id: 'card_spore', name: 'Spore Warden Card', desc: '+6 VIT — a fungal carapace', icon: '🍄', bonusStat: 'vit' as const, bonusAmt: 6 },
  { id: 'card_wraith', name: 'Frost Wraith Card', desc: '+7 INT — a mind of winter glass', icon: '❄️', bonusStat: 'int' as const, bonusAmt: 7 },
  { id: 'card_puglin', name: 'Feral Puglin Card', desc: '+6 AGI — scrappy, sprinting feet', icon: '🐾', bonusStat: 'agi' as const, bonusAmt: 6 },
  { id: 'card_pyre', name: 'Pyre Skeleton Card', desc: '+7 STR — bones that burn', icon: '🔥', bonusStat: 'str' as const, bonusAmt: 7 },
  { id: 'card_marksman', name: 'Crypt Marksman Card', desc: '+7 DEX — a dead-steady aim', icon: '🎯', bonusStat: 'dex' as const, bonusAmt: 7 },
  { id: 'card_imp', name: 'Winged Imp Card', desc: '+6 LUK — impish luck', icon: '😈', bonusStat: 'luk' as const, bonusAmt: 6 },
];
