import { CONSPIRACIES, ConspiracyDef, ECHO_SHARDS, EchoShardDef, STORY_ORDER, STORY_SCRIPTS } from '../data/StoryCampaign';
import type { TownNpcId } from '../types';

export type StoryFlag =
  | 'prologue_done'
  | 'act1_entered'
  | 'act1_malakor_met'
  | 'act1_malakor_defeated'
  | 'act1_garrett_confessed'
  | 'garrett_gift_claimed'
  | 'act2_entered'
  | 'act2_mirror_seen'
  | 'act2_lyra_met'
  | 'act2_lyra_defeated'
  | 'act2_mira_exposed'
  | 'act2_vaelen_confessed'
  | 'act2_pip_confessed'
  | 'act3_entered'
  | 'act3_vance_met'
  | 'act3_vance_defeated'
  | 'act3_warden_defeated'
  | 'act3_resolved'
  | 'job_advanced';

export type ConspiracyStatus = 'hidden' | 'suspected' | 'exposed' | 'atoned';

export interface ConspiracyView {
  def: ConspiracyDef;
  status: ConspiracyStatus;
  text: string;
  clues: EchoShardDef[];
}

export interface JournalView {
  objective: string;
  objectiveDetail: string;
  act: string;
  conspiracies: ConspiracyView[];
  echoes: Array<{ def: EchoShardDef; found: boolean }>;
  scenes: Array<{ id: string; title: string; logline: string; seen: boolean }>;
  echoCount: number;
  echoTotal: number;
  deepestFloor: number;
  endless: boolean;
}

/** A town confrontation that should play the next time the player is in Oakhaven. */
export interface PendingTownScene {
  sceneId: string;
  npc: TownNpcId;
  setsFlag: StoryFlag;
}

interface SaveShape {
  flags: string[];
  echoes: string[];
  deepest: number;
}

const SAVE_KEY = 'cryptfall_ashen_ledger_v1';

/**
 * Tracks the Ashen Ledger's story state: flags, collected Echo Shards, conspiracy
 * progression, the next objective, town scene queue and shop unlocks.
 */
export class QuestAndNarrativeSystem {
  private flags = new Set<StoryFlag>();
  private echoes = new Set<string>();
  public deepestFloor = 1;
  /** Called whenever story state changes (HUD / town refresh). */
  public onChange?: () => void;

  constructor() {
    this.load();
  }

  // ───────────── persistence ─────────────
  private load(): void {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as SaveShape;
      d.flags?.forEach((f) => this.flags.add(f as StoryFlag));
      d.echoes?.forEach((e) => this.echoes.add(e));
      this.deepestFloor = Math.max(1, d.deepest ?? 1);
    } catch {
      // ignore
    }
  }

  private save(): void {
    try {
      const d: SaveShape = { flags: [...this.flags], echoes: [...this.echoes], deepest: this.deepestFloor };
      localStorage.setItem(SAVE_KEY, JSON.stringify(d));
    } catch {
      // ignore
    }
    this.onChange?.();
  }

  /** New Game: wipe the story so the prologue hook plays immediately. */
  public reset(): void {
    this.flags.clear();
    this.echoes.clear();
    this.deepestFloor = 1;
    this.save();
  }

  // ───────────── flags ─────────────
  public has(f: StoryFlag): boolean {
    return this.flags.has(f);
  }

  public set(f: StoryFlag): void {
    if (this.flags.has(f)) return;
    this.flags.add(f);
    this.save();
  }

  public recordFloor(floor: number): void {
    if (floor > this.deepestFloor) {
      this.deepestFloor = floor;
      this.save();
    }
  }

  // ───────────── echo shards ─────────────
  public hasEcho(id: string): boolean {
    return this.echoes.has(id);
  }

  public collectEcho(id: string): EchoShardDef | null {
    const def = ECHO_SHARDS.find((e) => e.id === id) ?? null;
    if (!def || this.echoes.has(id)) return def;
    this.echoes.add(id);
    this.save();
    return def;
  }

  public uncollectedEchoesForFloor(floor: number): EchoShardDef[] {
    return ECHO_SHARDS.filter((e) => e.floor === floor && !this.echoes.has(e.id));
  }

  // ───────────── progression helpers ─────────────
  public get resolved(): boolean {
    return this.has('act3_resolved');
  }

  public refineCap(): number {
    return this.has('act1_garrett_confessed') ? 10 : 6;
  }

  public get unlocks() {
    return {
      masterwork: this.has('act1_garrett_confessed'),
      atonementBlade: this.has('act1_garrett_confessed'),
      miraLab: this.has('act2_mira_exposed'),
      jobAdvance: this.has('act2_vaelen_confessed'),
      soulGoldLedger: this.has('act2_pip_confessed'),
      endless: this.resolved,
    };
  }

  /** Floors the Spire gate can send you to. */
  public availableFloors(): number[] {
    const out: number[] = [1];
    if (this.has('act1_malakor_defeated')) out.push(2);
    if (this.has('act2_lyra_defeated')) out.push(3);
    if (this.resolved) {
      const deepest = Math.min(99, Math.max(4, this.deepestFloor));
      for (let f = 4; f <= deepest; f += f < 10 ? 1 : 5) out.push(f);
      if (!out.includes(deepest)) out.push(deepest);
    }
    return out;
  }

  public nextStoryFloor(): number {
    if (!this.has('act1_malakor_defeated')) return 1;
    if (!this.has('act2_lyra_defeated')) return 2;
    if (!this.resolved) return 3;
    return Math.max(4, this.deepestFloor);
  }

  /** Town confrontations ready to trigger (in story order). */
  public pendingTownScenes(): PendingTownScene[] {
    const out: PendingTownScene[] = [];
    if (this.has('act1_malakor_defeated') && !this.has('act1_garrett_confessed')) {
      out.push({ sceneId: 'act1_garrett_confession', npc: 'blacksmith', setsFlag: 'act1_garrett_confessed' });
    }
    if (this.has('act2_lyra_defeated') && !this.has('act2_mira_exposed')) {
      out.push({ sceneId: 'act2_mira_exposed', npc: 'alchemist', setsFlag: 'act2_mira_exposed' });
    }
    if (this.has('act2_mirror_seen') && !this.has('act2_vaelen_confessed')) {
      out.push({ sceneId: 'act2_vaelen_confession', npc: 'hypnotist', setsFlag: 'act2_vaelen_confessed' });
    }
    if (this.hasEcho('e2_receipts') && this.has('act1_garrett_confessed') && !this.has('act2_pip_confessed')) {
      out.push({ sceneId: 'act2_pip_confession', npc: 'kafra', setsFlag: 'act2_pip_confessed' });
    }
    return out;
  }

  public pendingSceneFor(npc: TownNpcId): PendingTownScene | null {
    return this.pendingTownScenes().find((p) => p.npc === npc) ?? null;
  }

  // ───────────── conspiracies ─────────────
  public conspiracyStatus(def: ConspiracyDef): ConspiracyStatus {
    const clues = ECHO_SHARDS.filter((e) => e.implicates === def.npc && this.echoes.has(e.id)).length;
    switch (def.id) {
      case 'forged_key':
        if (this.has('act1_garrett_confessed')) return 'atoned';
        if (this.has('act1_malakor_met')) return 'exposed';
        return clues > 0 ? 'suspected' : 'hidden';
      case 'green_tonic':
        if (this.has('act2_mira_exposed')) return 'atoned';
        if (this.has('act2_lyra_defeated')) return 'exposed';
        return clues > 0 || this.has('act1_garrett_confessed') ? 'suspected' : 'hidden';
      case 'soul_gold':
        if (this.has('act2_pip_confessed')) return 'atoned';
        if (this.hasEcho('e2_receipts')) return 'exposed';
        return this.has('act1_garrett_confessed') ? 'suspected' : 'hidden';
      case 'lost_commander':
        if (this.has('act2_vaelen_confessed')) return 'atoned';
        if (this.has('act2_mirror_seen')) return 'exposed';
        return this.hasEcho('e2_oath') ? 'suspected' : 'hidden';
      case 'acceptable_loss':
        if (this.resolved) return 'atoned';
        if (this.hasEcho('e3_orders')) return 'exposed';
        return clues > 0 ? 'suspected' : 'hidden';
    }
    return 'hidden';
  }

  // ───────────── objective ─────────────
  public objective(): { act: string; title: string; detail: string } {
    const pending = this.pendingTownScenes();
    if (!this.has('prologue_done')) {
      return { act: 'Prologue', title: 'Survive the Harvest Bonfire', detail: 'Something is wrong in Oakhaven.' };
    }
    if (!this.has('act1_malakor_defeated')) {
      return {
        act: 'Act I — The Forged Key',
        title: 'Descend into the Sunken Archives (Floor 1)',
        detail: `Find out who forged Vance's key. Echo Shards found: ${this.countFloor(1)}/3. Defeat the Keeper of the First Seal.`,
      };
    }
    if (!this.has('act1_garrett_confessed')) {
      return { act: 'Act I — The Forged Key', title: 'Confront Garrett at his forge', detail: 'Return to Oakhaven. The Ledger named the Master Blacksmith.' };
    }
    if (!this.has('act2_mirror_seen') || !this.has('act2_lyra_defeated')) {
      const parts: string[] = [];
      if (!this.has('act2_mirror_seen')) parts.push('find the Obsidian Mirror at the heart of the ruins');
      if (!this.has('act2_lyra_defeated')) parts.push('defeat the corrupted grove guardian');
      return {
        act: 'Act II — The Price of Immortality',
        title: 'Descend into the Overgrown Ruins (Floor 2)',
        detail: `${parts.join(' and ')}. Echo Shards found: ${this.countFloor(2)}/3.`.replace(/^./, (c) => c.toUpperCase()),
      };
    }
    if (pending.length > 0) {
      const names = pending.map((p) => ({ blacksmith: 'Garrett', alchemist: 'Mira', hypnotist: 'Vaelen', kafra: 'Pip', guildmaster: 'Aldric' })[p.npc]);
      return { act: 'Act II — The Price of Immortality', title: `Confront ${names.join(' & ')} in Oakhaven`, detail: 'The town is full of secrets. Look for the [!] markers.' };
    }
    if (!this.has('act3_vance_defeated')) {
      return {
        act: 'Act III — The Final Signature',
        title: 'Descend to the Obsidian Spire Core (Floor 3)',
        detail: `Stop Mayor Vance before the Ledger closes. Echo Shards found: ${this.countFloor(3)}/3.`,
      };
    }
    if (!this.resolved) {
      return { act: 'Act III — The Final Signature', title: 'Shatter the Abyssal Ledger', detail: 'Defeat the Abyssal Warden.' };
    }
    return {
      act: 'Epilogue — Endless Abyss',
      title: `Hunt Ledger pages in the Endless Abyss (deepest: Floor ${Math.max(4, this.deepestFloor)})`,
      detail: 'MVP bosses, rare cards and level 99. Every floor deeper holds a page with someone’s name on it.',
    };
  }

  private countFloor(floor: number): number {
    return ECHO_SHARDS.filter((e) => e.floor === floor && this.echoes.has(e.id)).length;
  }

  public journal(hasPlayed: (id: string) => boolean): JournalView {
    const obj = this.objective();
    return {
      objective: obj.title,
      objectiveDetail: obj.detail,
      act: obj.act,
      conspiracies: CONSPIRACIES.map((def) => {
        const status = this.conspiracyStatus(def);
        return {
          def,
          status,
          text: def[status],
          clues: ECHO_SHARDS.filter((e) => e.implicates === def.npc && this.echoes.has(e.id)),
        };
      }),
      echoes: ECHO_SHARDS.map((def) => ({ def, found: this.echoes.has(def.id) })),
      scenes: STORY_ORDER.filter((id) => STORY_SCRIPTS[id]).map((id) => ({
        id,
        title: STORY_SCRIPTS[id].title,
        logline: STORY_SCRIPTS[id].logline,
        seen: hasPlayed(id),
      })),
      echoCount: this.echoes.size,
      echoTotal: ECHO_SHARDS.length,
      deepestFloor: this.deepestFloor,
      endless: this.resolved,
    };
  }
}
