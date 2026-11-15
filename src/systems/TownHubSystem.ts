import type { TownNpcId } from '../types';
import { QuestAndNarrativeSystem } from './QuestAndNarrativeSystem';

/** Overhead marker shown above each Oakhaven NPC. */
export type NpcMarker = '!' | '?' | '★' | '⛓' | '';

export interface TownNpcView {
  npcId: TownNpcId;
  name: string;
  title: string;
  tag: string;
  color: string;
  marker: NpcMarker;
  prompt: string;
  chained: boolean;
}

export interface TownView {
  npcs: TownNpcView[];
  chains: boolean;
  dawn: boolean;
}

export type DialogueAction =
  | 'close'
  | 'confront'
  | 'claim_blade'
  | 'job_advance'
  | 'descend';

export interface DialogueOption {
  id: string;
  label: string;
  next?: string;
  action?: DialogueAction;
  floor?: number;
  disabled?: boolean;
}

export interface DialogueNode {
  speaker: string;
  color: string;
  text: string;
  options: DialogueOption[];
}

export interface NpcModalView {
  npc: TownNpcId;
  node: DialogueNode;
  nodeId: string;
  shopTier: number;
}

const BASE: Record<TownNpcId, { name: string; title: string; color: string; icon: string }> = {
  blacksmith: { name: 'Garrett', title: 'Master Blacksmith', color: '#f97316', icon: '⚒' },
  kafra: { name: 'Pip', title: 'Vault Keeper', color: '#38bdf8', icon: '📦' },
  hypnotist: { name: 'Vaelen', title: 'Soul Weaver', color: '#c084fc', icon: '✦' },
  alchemist: { name: 'Mira', title: 'Alchemist', color: '#34d399', icon: '⚗' },
  guildmaster: { name: 'Warden Aldric', title: 'Captain of the Watch', color: '#facc15', icon: '⛨' },
};

/**
 * Derives Oakhaven's living state from the story: NPC overhead markers, prompts,
 * dialogue trees and shop tiers all update as Echo Shards are found and Acts are cleared.
 */
export class TownHubSystem {
  constructor(private story: QuestAndNarrativeSystem) {}

  public buildView(): TownView {
    const s = this.story;
    const npcs = (Object.keys(BASE) as TownNpcId[]).map((id) => {
      const b = BASE[id];
      const pending = s.pendingSceneFor(id);
      let marker: NpcMarker = '';
      if (pending) marker = '!';
      else if (this.hasNewShopTier(id)) marker = '★';
      else if (id === 'guildmaster' && !s.has('act1_entered')) marker = '!';
      else if (!s.resolved && this.isUnconfessedSuspect(id)) marker = '⛓';
      else if (this.hasFreshGossip(id)) marker = '?';
      return {
        npcId: id,
        name: b.name,
        title: b.title,
        tag: `[${b.icon}] ${b.name}`,
        color: b.color,
        marker,
        prompt: pending ? `[E] Confront ${b.name}` : `[E] Talk to ${b.name} — ${b.title}`,
        chained: !s.resolved && s.has('prologue_done'),
      };
    });
    return { npcs, chains: !s.resolved && s.has('prologue_done'), dawn: s.resolved };
  }

  private isUnconfessedSuspect(id: TownNpcId): boolean {
    const s = this.story;
    if (id === 'blacksmith') return !s.has('act1_garrett_confessed');
    if (id === 'alchemist') return !s.has('act2_mira_exposed');
    if (id === 'kafra') return !s.has('act2_pip_confessed');
    if (id === 'hypnotist') return !s.has('act2_vaelen_confessed');
    return false;
  }

  private hasNewShopTier(id: TownNpcId): boolean {
    const s = this.story;
    if (id === 'blacksmith') return s.has('act1_garrett_confessed') && !s.has('garrett_gift_claimed');
    if (id === 'hypnotist') return s.has('act2_vaelen_confessed') && !s.has('job_advanced');
    return false;
  }

  private hasFreshGossip(id: TownNpcId): boolean {
    return id === 'guildmaster' && this.story.availableFloors().length > 1;
  }

  public shopTier(npc: TownNpcId): number {
    const s = this.story;
    if (npc === 'blacksmith') return s.has('act1_garrett_confessed') ? 2 : 1;
    if (npc === 'alchemist') return s.has('act2_mira_exposed') ? 2 : 1;
    if (npc === 'kafra') return s.has('act2_pip_confessed') ? 2 : 1;
    if (npc === 'hypnotist') return s.has('act2_vaelen_confessed') ? 2 : 1;
    return 1;
  }

  /** Dialogue tree for an NPC; `nodeId` defaults to the root ('start'). */
  public dialogue(npc: TownNpcId, nodeId = 'start', playerLevel = 1): NpcModalView {
    const b = BASE[npc];
    const node = this.buildNode(npc, nodeId, playerLevel);
    return { npc, node: { speaker: `${b.name} — ${b.title}`, color: b.color, ...node }, nodeId, shopTier: this.shopTier(npc) };
  }

  private buildNode(npc: TownNpcId, nodeId: string, playerLevel: number): Omit<DialogueNode, 'speaker' | 'color'> {
    const s = this.story;
    const pending = s.pendingSceneFor(npc);
    const back: DialogueOption = { id: 'back', label: '« Back', next: 'start' };
    const confront: DialogueOption[] = pending ? [{ id: 'confront', label: '⚠ Confront them with what you know', action: 'confront' }] : [];

    if (npc === 'blacksmith') {
      if (nodeId === 'key') {
        return {
          text: s.has('act1_garrett_confessed')
            ? "I hammer every blade like it might buy back a minute of Elsie's life. Masterwork heat, +7 to +10 — bring me gold and I'll make it sing."
            : "A key? Every lock in Oakhaven passes through my forge eventually. Why do you ask, Auditor?",
          options: [back],
        };
      }
      if (nodeId === 'elsie') {
        return {
          text: s.resolved
            ? 'She ran to the bonfire this morning and laughed the whole way. No coughing. No debt.'
            : s.has('act1_garrett_confessed')
              ? "She still needs Mira's tonic every week. I'd sell my soul twice to keep her breathing... I suppose I already did."
              : 'My girl, Elsie. Weak lungs. Mira keeps her alive with a green tonic — costs a fortune, but what is gold for?',
          options: [back],
        };
      }
      const opts: DialogueOption[] = [...confront];
      if (s.has('act1_garrett_confessed') && !s.has('garrett_gift_claimed')) {
        opts.push({ id: 'blade', label: '★ Accept the Atonement Blade [1 Socket]', action: 'claim_blade' });
      }
      opts.push({ id: 'key', label: 'Ask about the Spire key', next: 'key' }, { id: 'elsie', label: 'Ask about his daughter', next: 'elsie' });
      return {
        text: pending
          ? "You're back from the archives... and you're looking at me like you've read something about me."
          : s.has('act1_garrett_confessed')
            ? 'The forge is at Masterwork heat. Refinement past +6 is open to you now — the auras will show the world what you carry.'
            : s.has('prologue_done')
              ? "The chains... they're tight around my chest. Refine your gear while you can — my forge tops out at +6 for now."
              : 'Welcome to Oakhaven, Auditor! Best steel this side of the Spire.',
        options: opts,
      };
    }

    if (npc === 'alchemist') {
      if (nodeId === 'tonic') {
        return {
          text: s.has('act2_mira_exposed')
            ? 'The tonic recipe came from the Ledger itself. Eternal life, it promised. It just never said whose.'
            : 'My green tonic? Moss, honey, and a secret. Keeps the Blacksmith’s girl breathing. Why so curious?',
          options: [back],
        };
      }
      const opts: DialogueOption[] = [...confront, { id: 'tonic', label: 'Ask about her green tonic', next: 'tonic' }];
      return {
        text: pending
          ? 'You smell of moss and spore-rot. You went to the grove, didn’t you?'
          : s.has('act2_mira_exposed')
            ? 'My lab is yours. Converters, Awakening draughts, card extraction — use it better than I did.'
            : 'Crimson for wounds, Azure for the mind. Mind the bottles in the back — those aren’t for sale.',
        options: opts,
      };
    }

    if (npc === 'kafra') {
      if (nodeId === 'zeny') {
        return {
          text: s.has('act2_pip_confessed')
            ? 'Soul-gold, every coin. Now at least it pays the people who bleed for it — you.'
            : 'Zeny is Zeny! Shiny, round, extremely legal. Please stop looking at the stamp.',
          options: [back],
        };
      }
      const opts: DialogueOption[] = [...confront, { id: 'zeny', label: 'Ask where Oakhaven’s Zeny comes from', next: 'zeny' }];
      return {
        text: pending
          ? 'Those are... receipts from my vault. Where did you find those?'
          : s.has('act2_pip_confessed')
            ? 'Socket and swap your memory cards free of charge, Commander. And +25% Zeny from every kill — courtesy of my ledgers.'
            : 'Welcome to the Vault! Equip your Monster Cards here. They’re crystallized memories, you know — guardians remember.',
        options: opts,
      };
    }

    if (npc === 'hypnotist') {
      if (nodeId === 'job') {
        const ready = playerLevel >= 8;
        return {
          text: s.has('job_advanced')
            ? 'The threads are rewoven. You wear the First Commander’s power again.'
            : ready
              ? 'Close your eyes, Commander. This will burn — the Warden’s sealed power is still inside you.'
              : 'Your body is not ready to carry the Commander’s full power. Come back at Base Level 8.',
          options: [
            ...(s.has('job_advanced') ? [] : [{ id: 'job_go', label: '★ Reclaim your sealed power (Job Advancement)', action: 'job_advance' as const, disabled: !ready }]),
            back,
          ],
        };
      }
      const opts: DialogueOption[] = [...confront];
      if (s.has('act2_vaelen_confessed')) opts.push({ id: 'job', label: 'Ask about the Commander’s power', next: 'job' });
      return {
        text: pending
          ? 'You have the look of someone who has seen their own reflection lie to them.'
          : s.has('act2_vaelen_confessed')
            ? 'I can unbind your stats and skills — or weave back what the Capital made me take.'
            : 'I unbind souls. Stats, skills... memories, sometimes. Shall we begin?',
        options: opts,
      };
    }

    // Warden Aldric — gate keeper / descent selection
    if (nodeId === 'gate') {
      const floors = s.availableFloors();
      const label = (f: number) =>
        f === 1 ? 'Floor 1 — Sunken Archives' : f === 2 ? 'Floor 2 — Overgrown Ruins' : f === 3 ? 'Floor 3 — Obsidian Spire Core' : `Floor ${f} — Endless Abyss`;
      return {
        text: s.resolved
          ? 'The Endless Abyss runs ninety-nine floors deep. Choose your descent, Commander.'
          : 'The barrier answers only to your brand. Where do you want to go?',
        options: [
          ...floors.map((f) => ({
            id: `floor_${f}`,
            label: `${f === s.nextStoryFloor() ? '▶ ' : ''}${label(f)}`,
            action: 'descend' as const,
            floor: f,
          })),
          back,
        ],
      };
    }
    if (nodeId === 'vance') {
      return {
        text: s.has('act3_vance_defeated')
          ? 'Vance was a fool, but he was our fool. Starving people sign anything.'
          : 'Vance kept this town fed through three famine winters. Now I know what he traded. I would have signed too.',
        options: [back],
      };
    }
    return {
      text: s.resolved
        ? 'Oakhaven owes nobody anything now. But those scattered Ledger pages still carry names.'
        : s.has('prologue_done')
          ? 'Your brand opens the barrier. I’ll hold the town together up here — you find the bottom of that Ledger.'
          : 'Evening, Auditor. Enjoy the bonfire.',
      options: [
        { id: 'gate', label: '▶ Descend into the Spire', next: 'gate' },
        { id: 'vance', label: 'Ask about Mayor Vance', next: 'vance' },
      ],
    };
  }
}
