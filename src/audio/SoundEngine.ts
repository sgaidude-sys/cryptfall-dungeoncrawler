/**
 * SoundEngine — zero-external-file Web Audio synthesizer + mixer.
 *
 *  master ─┬─ sfxBus  (spatial voices: StereoPanner + distance gain, pitch/filter randomized)
 *          ├─ bgmBus  (adaptive layered score: Town / Dungeon / Boss+Cutscene, crossfaded)
 *          └─ reverb  (generated-IR convolver fed by post-volume sends from both buses)
 *
 * The AudioContext is only created inside a user gesture (first click / key / touch),
 * so there are never autoplay-policy errors.
 */

export type MusicMode = 'silent' | 'town' | 'explore' | 'boss' | 'cutscene';
export type VolumeChannel = 'master' | 'sfx' | 'bgm';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface LayerState {
  gain: GainNode;
  nextStep: number; // AudioContext time of next 16th step
  step: number;
  target: number;
}

const STORAGE_KEY = 'cryptfall_audio_v2';
const NOTE = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const rand = (spread: number) => 1 + (Math.random() * 2 - 1) * spread;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private sfxVerbSend: GainNode | null = null;
  private bgmVerbSend: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private volumes: Record<VolumeChannel, number> = { master: 0.8, sfx: 0.85, bgm: 0.55 };
  private muted = false;
  private changeListeners: Array<() => void> = [];

  // Spatial listener (camera) + pending emitter for the next voice
  private listenerPos = { x: 0, y: 0, z: 0 };
  private listenerRight = { x: 1, y: 0, z: 0 };
  private pendingPos: Vec3Like | null = null;
  private pendingAt = 0;

  // Music
  private mode: MusicMode = 'silent';
  private modeBeforeCutscene: MusicMode = 'explore';
  private layers: Record<'town' | 'explore' | 'boss', LayerState> | null = null;
  private schedulerId: number | null = null;
  private combatIntensity = 0;
  private droneFilter: BiquadFilterNode | null = null;
  private melodyState = { phrase: 0, lastDegree: 0 };

  // Cast hum (persistent while channelling)
  private castHum: {
    oscA: OscillatorNode;
    oscB: OscillatorNode;
    lfo: OscillatorNode;
    gain: GainNode;
    filter: BiquadFilterNode;
    dex: number;
    base: number;
  } | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<VolumeChannel, number>> & { muted?: boolean };
        (['master', 'sfx', 'bgm'] as VolumeChannel[]).forEach((k) => {
          if (typeof parsed[k] === 'number') this.volumes[k] = Math.max(0, Math.min(1, parsed[k]!));
        });
        this.muted = Boolean(parsed.muted);
      }
    } catch {
      // storage unavailable — defaults are fine
    }
    // Auto-unlock on the very first user gesture (autoplay-policy safe)
    const unlockOnce = () => {
      this.unlock();
      window.removeEventListener('pointerdown', unlockOnce, true);
      window.removeEventListener('keydown', unlockOnce, true);
      window.removeEventListener('touchstart', unlockOnce, true);
    };
    window.addEventListener('pointerdown', unlockOnce, true);
    window.addEventListener('keydown', unlockOnce, true);
    window.addEventListener('touchstart', unlockOnce, true);
  }

  // ───────────────────────────── Setup / mixer ─────────────────────────────

  public unlock(): void {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      } catch {
        this.ctx = null;
        return;
      }
      const ctx = this.ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.connect(comp);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.bgmBus = ctx.createGain();
      this.bgmBus.connect(this.master);

      this.noiseBuffer = this.createNoiseBuffer(2.0);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.createImpulse(2.6, 2.4);
      const verbOut = ctx.createGain();
      verbOut.gain.value = 0.9;
      this.reverb.connect(verbOut);
      verbOut.connect(this.master);
      this.sfxVerbSend = ctx.createGain();
      this.sfxVerbSend.gain.value = 0.16;
      this.sfxBus.connect(this.sfxVerbSend);
      this.sfxVerbSend.connect(this.reverb);
      this.bgmVerbSend = ctx.createGain();
      this.bgmVerbSend.gain.value = 0.32;
      this.bgmBus.connect(this.bgmVerbSend);
      this.bgmVerbSend.connect(this.reverb);

      this.applyVolumes(true);
      this.initMusic();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public get unlocked(): boolean {
    return !!this.ctx;
  }

  public onChange(fn: () => void): void {
    this.changeListeners.push(fn);
  }

  public getVolume(ch: VolumeChannel): number {
    return this.volumes[ch];
  }

  public setVolume(ch: VolumeChannel, v: number): void {
    this.volumes[ch] = Math.max(0, Math.min(1, v));
    if (ch === 'master' && v > 0 && this.muted) this.muted = false;
    this.applyVolumes();
    this.persist();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyVolumes();
    this.persist();
    return this.muted;
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.volumes, muted: this.muted }));
    } catch {
      // ignore
    }
    this.changeListeners.forEach((f) => f());
  }

  private applyVolumes(instant = false): void {
    if (!this.ctx || !this.master || !this.sfxBus || !this.bgmBus) return;
    const t = this.ctx.currentTime;
    const tc = instant ? 0.001 : 0.06;
    // Perceptual (squared) taper so sliders feel linear
    this.master.gain.setTargetAtTime(this.muted ? 0 : Math.pow(this.volumes.master, 2) * 0.9, t, tc);
    this.sfxBus.gain.setTargetAtTime(Math.pow(this.volumes.sfx, 2) * 1.1, t, tc);
    this.bgmBus.gain.setTargetAtTime(Math.pow(this.volumes.bgm, 2) * 0.9, t, tc);
  }

  /** Camera position + right vector, used to pan world-positioned sounds. */
  public setListener(pos: Vec3Like, right: Vec3Like): void {
    this.listenerPos.x = pos.x;
    this.listenerPos.y = pos.y;
    this.listenerPos.z = pos.z;
    this.listenerRight.x = right.x;
    this.listenerRight.y = right.y;
    this.listenerRight.z = right.z;
  }

  /** Position the NEXT sound in 3D: `sound.at(enemy.pos).playBoneShatter()`. */
  public at(pos: Vec3Like): this {
    this.pendingPos = { x: pos.x, y: pos.y, z: pos.z };
    this.pendingAt = performance.now();
    return this;
  }

  /** Creates the per-voice output (panner + distance attenuation) feeding the SFX bus. */
  private out(gainMul = 1): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return null;
    const g = ctx.createGain();
    g.gain.value = gainMul;
    let pan = 0;
    if (this.pendingPos && performance.now() - this.pendingAt < 30) {
      const dx = this.pendingPos.x - this.listenerPos.x;
      const dz = this.pendingPos.z - this.listenerPos.z;
      const lateral = dx * this.listenerRight.x + dz * this.listenerRight.z;
      pan = Math.max(-0.85, Math.min(0.85, lateral / 9));
      // Camera sits ~15m above the player — measure distance on the ground plane
      const dist = Math.hypot(dx, dz);
      g.gain.value = gainMul / (1 + Math.max(0, dist - 9) * 0.09);
    }
    this.pendingPos = null;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfxBus);
    } else {
      g.connect(this.sfxBus);
    }
    return g;
  }

  private canPlay(): boolean {
    return !!this.ctx && !this.muted && this.ctx.state !== 'closed';
  }

  private createNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private createImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections + exponential tail, slightly decorrelated per channel
        const early = i < ctx.sampleRate * 0.04 && Math.random() < 0.02 ? 0.8 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + early) * (ch === 0 ? 1 : 0.97);
      }
    }
    return buf;
  }

  // ───────────────────────────── Synth primitives ─────────────────────────────

  private osc(
    dest: AudioNode,
    type: OscillatorType,
    freq: number,
    t: number,
    dur: number,
    peak: number,
    attack = 0.005,
    endFreq?: number
  ): OscillatorNode {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noise(
    dest: AudioNode,
    t: number,
    dur: number,
    peak: number,
    filterType: BiquadFilterType,
    freq: number,
    q = 1,
    endFreq?: number,
    attack = 0.003
  ): void {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = rand(0.1);
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    const offset = Math.random() * 1.2;
    src.start(t, offset);
    src.stop(t + dur + 0.05);
  }

  /** Inharmonic metallic strike (bells, anvils, clangs). */
  private metal(dest: AudioNode, t: number, base: number, peak: number, decay: number, partials = [1, 2.76, 5.4, 8.93]): void {
    partials.forEach((p, i) => {
      this.osc(dest, 'sine', base * p * rand(0.01), t, decay / (1 + i * 0.55), peak / (1 + i * 0.7), 0.002);
    });
  }

  private pluck(dest: AudioNode, freq: number, t: number, peak: number, decay = 1.1, bright = 1): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 2.002;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(Math.min(12000, freq * 9 * bright), t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.3, t + decay * 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(f);
    o2.connect(g2);
    g2.connect(f);
    f.connect(g);
    g.connect(dest);
    o.start(t);
    o2.start(t);
    o.stop(t + decay + 0.05);
    o2.stop(t + decay + 0.05);
  }

  private flute(dest: AudioNode, freq: number, t: number, dur: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 2;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibG = ctx.createGain();
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.linearRampToValueAtTime(freq * 0.007, t + Math.min(0.35, dur * 0.6));
    vib.connect(vibG);
    vibG.connect(o.frequency);
    vibG.connect(o2.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.07);
    g.gain.setValueAtTime(peak * 0.85, t + Math.max(0.08, dur - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(dest);
    [o, o2, vib].forEach((n) => {
      n.start(t);
      n.stop(t + dur + 0.2);
    });
    this.noise(dest, t, Math.min(0.18, dur), peak * 0.18, 'bandpass', freq * 2, 3);
  }

  private pad(dest: AudioNode, freqs: number[], t: number, dur: number, peak: number, cutoff = 1100): void {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.35);
    g.gain.setValueAtTime(peak, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.15);
    f.connect(g);
    g.connect(dest);
    for (const fr of freqs) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.18 / freqs.length;
        o.connect(og);
        og.connect(f);
        o.start(t);
        o.stop(t + dur * 1.2);
      }
    }
  }

  private brass(dest: AudioNode, freqs: number[], t: number, dur: number, peak: number): void {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.45);
    f.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
    f.connect(g);
    g.connect(dest);
    for (const fr of freqs) {
      for (const det of [-9, 0, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.15 / freqs.length;
        o.connect(og);
        og.connect(f);
        o.start(t);
        o.stop(t + dur * 1.1);
      }
    }
  }

  private kick(dest: AudioNode, t: number, peak: number, pitch = 1): void {
    this.osc(dest, 'sine', 130 * pitch, t, 0.28, peak, 0.002, 38 * pitch);
    this.noise(dest, t, 0.02, peak * 0.25, 'highpass', 2500);
  }

  private tom(dest: AudioNode, t: number, peak: number, freq = 150): void {
    this.osc(dest, 'sine', freq, t, 0.35, peak, 0.003, freq * 0.55);
    this.noise(dest, t, 0.08, peak * 0.3, 'bandpass', freq * 3, 1.5);
  }

  // ───────────────────────────── UI / meta SFX ─────────────────────────────

  public playUIHover(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.5)!;
    const t = this.ctx!.currentTime;
    this.osc(out, 'sine', 2100 * rand(0.03), t, 0.05, 0.05, 0.002);
  }

  public playUISelect(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.6)!;
    const t = this.ctx!.currentTime;
    this.osc(out, 'triangle', 880, t, 0.09, 0.12, 0.003);
    this.osc(out, 'triangle', 1320, t + 0.05, 0.14, 0.1, 0.003);
  }

  public playUIPopup(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.55)!;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.18, 0.08, 'bandpass', 900, 1.2, 3200, 0.05);
    this.osc(out, 'sine', 1046 * rand(0.01), t + 0.04, 0.35, 0.07);
    this.osc(out, 'sine', 1568 * rand(0.01), t + 0.08, 0.4, 0.05);
  }

  public playCinematicWhoosh(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.9)!;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 1.6, 0.35, 'bandpass', 180, 1.4, 2800, 0.9);
    this.osc(out, 'sine', 58, t + 0.9, 1.4, 0.35, 0.05, 32);
  }

  /** Dramatic reveal hits for cutscenes. */
  public playStinger(kind: 'reveal' | 'betrayal' | 'triumph' | 'memory'): void {
    if (!this.canPlay()) return;
    const out = this.out(0.9)!;
    const t = this.ctx!.currentTime;
    if (kind === 'reveal') {
      this.brass(out, [NOTE(40), NOTE(47), NOTE(52), NOTE(53)], t, 2.2, 0.32);
      this.kick(out, t, 0.6, 0.7);
      this.metal(out, t, 180, 0.1, 2.4);
    } else if (kind === 'betrayal') {
      this.brass(out, [NOTE(38), NOTE(44), NOTE(50), NOTE(51)], t, 2.8, 0.4);
      this.kick(out, t, 0.8, 0.6);
      this.kick(out, t + 0.32, 0.6, 0.55);
      this.noise(out, t, 2.4, 0.18, 'lowpass', 300, 1, 60, 0.4);
    } else if (kind === 'triumph') {
      this.brass(out, [NOTE(50), NOTE(54), NOTE(57), NOTE(62)], t, 2.6, 0.34);
      [74, 78, 81, 86].forEach((m, i) => this.metal(out, t + i * 0.09, NOTE(m), 0.05, 2.0, [1, 3.01]));
    } else {
      // memory shimmer
      [83, 86, 90, 95, 98].forEach((m, i) => this.osc(out, 'sine', NOTE(m), t + i * 0.07, 2.2, 0.05, 0.02));
      this.noise(out, t, 1.8, 0.05, 'highpass', 6000, 0.5, 9000, 0.6);
    }
  }

  // ───────────────────────────── Combat SFX ─────────────────────────────

  /** Weapon whoosh; higher ASPD = faster, higher-pitched swish. */
  public playSwing(aspd = 160, heavy = false): void {
    if (!this.canPlay()) return;
    const out = this.out(0.7)!;
    const t = this.ctx!.currentTime;
    const speed = Math.max(0.75, Math.min(1.6, (aspd - 130) / 40 + 0.8));
    const dur = (heavy ? 0.24 : 0.17) / speed;
    const base = (heavy ? 260 : 420) * speed * rand(0.12);
    this.noise(out, t, dur, heavy ? 0.32 : 0.24, 'bandpass', base, 1.8, base * 4.2, dur * 0.35);
  }

  /** Metallic sword-on-target clang (+ air whoosh body). */
  public playSwordClang(velocity = 1): void {
    if (!this.canPlay()) return;
    const out = this.out(1)!;
    const t = this.ctx!.currentTime;
    const p = rand(0.1);
    this.noise(out, t, 0.12, 0.22 * velocity, 'bandpass', 380 * p, 1.6, 1700 * p, 0.02);
    this.osc(out, 'sine', 125 * p, t, 0.1, 0.22 * velocity, 0.002, 44);
    this.metal(out, t + 0.008, 1150 * p, 0.045 * velocity, 0.22, [1, 2.41, 3.87, 5.43]);
    this.noise(out, t, 0.03, 0.1 * velocity, 'highpass', 5200 * p);
  }

  public playAxeThud(velocity = 1): void {
    if (!this.canPlay()) return;
    const out = this.out(1)!;
    const t = this.ctx!.currentTime;
    const p = rand(0.12);
    this.osc(out, 'sawtooth', 145 * p, t, 0.22, 0.22 * velocity, 0.002, 38);
    this.osc(out, 'sine', 70 * p, t, 0.3, 0.35 * velocity, 0.002, 30);
    this.noise(out, t, 0.12, 0.25 * velocity, 'lowpass', 600 * p);
  }

  /** Bash: heavy bass thud + bright shield clang. */
  public playBash(): void {
    if (!this.canPlay()) return;
    const out = this.out(1.1)!;
    const t = this.ctx!.currentTime;
    this.kick(out, t, 0.8, 0.75 * rand(0.06));
    this.osc(out, 'sine', 55, t, 0.5, 0.4, 0.002, 28);
    this.noise(out, t, 0.25, 0.3, 'lowpass', 900, 1, 120);
    this.metal(out, t + 0.01, 620 * rand(0.05), 0.08, 0.6, [1, 2.76, 5.4]);
  }

  /** Critical hit: sharp glass-shatter + chime accent. */
  public playCrit(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.95)!;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.22, 0.18, 'highpass', 4200 * rand(0.1), 0.7);
    for (let i = 0; i < 6; i++) {
      this.osc(out, 'sine', (2600 + Math.random() * 3800), t + i * 0.012 + Math.random() * 0.01, 0.12, 0.035, 0.001);
    }
    this.metal(out, t + 0.02, NOTE(88) * rand(0.02), 0.06, 0.9, [1, 2.0, 3.01]);
  }

  /** 1-damage tank clink (high-VIT Knight). */
  public playTankClang(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.9)!;
    const t = this.ctx!.currentTime;
    this.metal(out, t, 1480 * rand(0.04), 0.07, 0.55, [1, 2.76, 5.4, 8.93]);
    this.noise(out, t, 0.04, 0.08, 'highpass', 6000);
  }

  /** Auto Guard / Shield Reflect: anvil-like deflection with a ringing tail. */
  public playBlock(): void {
    if (!this.canPlay()) return;
    const out = this.out(1)!;
    const t = this.ctx!.currentTime;
    this.metal(out, t, 740 * rand(0.04), 0.1, 0.9, [1, 2.41, 3.87, 6.1]);
    this.osc(out, 'sine', 160, t, 0.12, 0.2, 0.002, 70);
    this.noise(out, t, 0.06, 0.15, 'bandpass', 3200, 2);
  }

  public playBowTwang(velocity = 1): void {
    if (!this.canPlay()) return;
    const out = this.out(0.9)!;
    const t = this.ctx!.currentTime;
    const p = rand(0.08);
    this.osc(out, 'triangle', 330 * p, t, 0.16, 0.2 * velocity, 0.002, 140 * p);
    this.pluck(out, 196 * p, t, 0.08 * velocity, 0.25, 1.4);
    this.noise(out, t, 0.08, 0.1 * velocity, 'highpass', 3000 * p);
  }

  public playArcaneBlast(velocity = 1): void {
    if (!this.canPlay()) return;
    const out = this.out(0.9)!;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const p = rand(0.1);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(780 * p, t);
    o.frequency.exponentialRampToValueAtTime(190 * p, t + 0.25);
    const mod = ctx.createOscillator();
    mod.frequency.value = 42 * p;
    const modG = ctx.createGain();
    modG.gain.value = 180;
    mod.connect(modG);
    modG.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2 * velocity, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g);
    g.connect(out);
    o.start(t);
    mod.start(t);
    o.stop(t + 0.3);
    mod.stop(t + 0.3);
    this.noise(out, t, 0.2, 0.06 * velocity, 'bandpass', 2400, 3, 800);
  }

  /** Fire Bolt: crackling flame burst. */
  public playFireBolt(hits = 1): void {
    if (!this.canPlay()) return;
    const out = this.out(0.9)!;
    const t = this.ctx!.currentTime;
    const n = Math.min(10, Math.max(1, hits));
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.05;
      this.noise(out, tt, 0.22, 0.16, 'bandpass', 700 * rand(0.2), 0.9, 2400, 0.01);
      this.osc(out, 'sine', 90 * rand(0.1), tt, 0.18, 0.12, 0.003, 45);
    }
    // crackle grains
    for (let i = 0; i < 10 + n * 2; i++) {
      this.noise(out, t + Math.random() * (0.25 + n * 0.05), 0.012, 0.12, 'highpass', 3000 + Math.random() * 3000);
    }
  }

  /** Lightning Bolt: snappy electric arcs. */
  public playLightning(hits = 1): void {
    if (!this.canPlay()) return;
    const out = this.out(0.9)!;
    const t = this.ctx!.currentTime;
    const n = Math.min(10, Math.max(1, hits));
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.055;
      this.osc(out, 'square', 1900 * rand(0.3), tt, 0.06, 0.05, 0.001, 300);
      this.noise(out, tt, 0.09, 0.22, 'highpass', 1800, 0.8);
      this.osc(out, 'sawtooth', 60, tt, 0.14, 0.12, 0.001, 35);
    }
  }

  /** Frost Diver / freeze / thaw: crystalline ice shatter. */
  public playIceShatter(velocity = 1): void {
    if (!this.canPlay()) return;
    const out = this.out(0.85)!;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 9; i++) {
      this.osc(out, 'sine', 2200 + Math.random() * 4200, t + Math.random() * 0.12, 0.25 + Math.random() * 0.3, 0.04 * velocity, 0.001);
    }
    this.noise(out, t, 0.3, 0.14 * velocity, 'highpass', 5000, 0.8, 9000);
    this.osc(out, 'triangle', 420 * rand(0.05), t, 0.4, 0.05 * velocity, 0.002, 260);
  }

  public playIceNova(): void {
    this.playIceShatter(1.2);
  }

  /** Magnum Break / Meteor Storm: big boom. */
  public playExplosion(): void {
    if (!this.canPlay()) return;
    const out = this.out(1.1)!;
    const t = this.ctx!.currentTime;
    this.kick(out, t, 0.75, 0.6 * rand(0.08));
    this.noise(out, t, 0.7, 0.4, 'lowpass', 1800 * rand(0.15), 0.8, 90, 0.004);
    this.osc(out, 'sine', 48, t, 0.8, 0.3, 0.004, 25);
    for (let i = 0; i < 8; i++) {
      this.noise(out, t + 0.05 + Math.random() * 0.4, 0.015, 0.08, 'highpass', 2500 + Math.random() * 3000);
    }
  }

  public playMeteorImpact(): void {
    this.playExplosion();
  }

  public playBossFinisher(): void {
    if (!this.canPlay()) return;
    const out = this.out(1.2)!;
    const t = this.ctx!.currentTime;
    this.kick(out, t, 1.0, 0.5);
    this.noise(out, t, 1.6, 0.35, 'lowpass', 2400, 0.7, 60, 0.003);
    this.brass(out, [NOTE(38), NOTE(45), NOTE(50)], t + 0.05, 2.4, 0.25);
    this.metal(out, t + 0.1, 220, 0.12, 3.0);
  }

  public playBoneShatter(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.9)!;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 6; i++) {
      const tt = t + i * 0.03 + Math.random() * 0.02;
      const f = 480 + Math.random() * 700;
      this.osc(out, 'square', f, tt, 0.05, 0.07, 0.001, f * 0.45);
    }
    this.noise(out, t, 0.14, 0.18, 'bandpass', 1600, 1.2);
    this.osc(out, 'sine', 110, t, 0.12, 0.12, 0.002, 50);
  }

  public playBattleCry(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.85)!;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const p = rand(0.08);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(118 * p, t);
    o.frequency.linearRampToValueAtTime(150 * p, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(86 * p, t + 0.45);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 650 * p;
    f.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(f);
    f.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.52);
    this.brass(out, [NOTE(45), NOTE(52)], t, 0.7, 0.12);
  }

  public playDodge(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.8)!;
    const t = this.ctx!.currentTime;
    this.noise(out, t, 0.22, 0.2, 'bandpass', 500 * rand(0.15), 1.2, 2600, 0.04);
    this.osc(out, 'sine', 90, t + 0.15, 0.1, 0.08, 0.003, 50);
  }

  public playPlayerHit(): void {
    if (!this.canPlay()) return;
    const out = this.out(1)!;
    const t = this.ctx!.currentTime;
    this.osc(out, 'sine', 95 * rand(0.1), t, 0.22, 0.35, 0.002, 40);
    this.noise(out, t, 0.14, 0.22, 'lowpass', 1100, 1, 300);
    this.osc(out, 'sawtooth', 210 * rand(0.1), t, 0.12, 0.06, 0.002, 120);
  }

  public playFootstep(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.55)!;
    const t = this.ctx!.currentTime;
    const p = rand(0.2);
    this.noise(out, t, 0.07, 0.14, 'lowpass', 420 * p, 0.8);
    this.osc(out, 'sine', 80 * p, t, 0.06, 0.08, 0.002, 50);
    this.noise(out, t + 0.01, 0.025, 0.035, 'highpass', 3500 * p);
  }

  // ───────────────────────────── Magic / healing / progression ─────────────────────────────

  /** Rising harmonic arcane hum during a cast bar — tremolo accelerates with DEX. */
  public startCastHum(dex: number, element: 'fire' | 'wind' | 'water' | 'arcane' = 'arcane'): void {
    if (!this.canPlay() || this.castHum) return;
    const ctx = this.ctx!;
    const out = this.out(0.8)!;
    const t = ctx.currentTime;
    const base = element === 'fire' ? 196 : element === 'wind' ? 262 : element === 'water' ? 233 : 220;
    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = base;
    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = base * 1.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 4;
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4 + dex * 0.12;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.3;
    lfo.connect(lfoG);
    lfoG.connect(trem.gain);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 0.15);
    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(trem);
    trem.connect(gain);
    gain.connect(out);
    oscA.start(t);
    oscB.start(t);
    lfo.start(t);
    this.castHum = { oscA, oscB, lfo, gain, filter, dex, base };
  }

  public updateCastHum(progress: number): void {
    if (!this.castHum || !this.ctx) return;
    const t = this.ctx.currentTime;
    const p = Math.max(0, Math.min(1, progress));
    const h = this.castHum;
    // Pitch climbs an octave and the shimmer rate accelerates (faster with high DEX)
    h.oscA.frequency.setTargetAtTime(h.base * (1 + p), t, 0.05);
    h.oscB.frequency.setTargetAtTime(h.base * 1.5 * (1 + p * 1.05), t, 0.05);
    h.lfo.frequency.setTargetAtTime((4 + h.dex * 0.12) * (1 + p * 2.5), t, 0.05);
    h.filter.frequency.setTargetAtTime(900 + p * 3200, t, 0.05);
    h.gain.gain.setTargetAtTime(0.08 + p * 0.07, t, 0.05);
  }

  public stopCastHum(released: boolean): void {
    if (!this.castHum || !this.ctx) return;
    const h = this.castHum;
    this.castHum = null;
    const t = this.ctx.currentTime;
    h.gain.gain.cancelScheduledValues(t);
    h.gain.gain.setTargetAtTime(0.0001, t, released ? 0.03 : 0.08);
    [h.oscA, h.oscB, h.lfo].forEach((o) => o.stop(t + 0.4));
    if (released && this.canPlay()) {
      const out = this.out(0.7)!;
      this.osc(out, 'sine', 880, t, 0.25, 0.06, 0.002, 1760);
    }
  }

  /** Warm harp-like chime gliss (Heal / Blessings). */
  public playHeal(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.8)!;
    const t = this.ctx!.currentTime;
    [72, 76, 79, 84, 88].forEach((m, i) => this.pluck(out, NOTE(m), t + i * 0.055, 0.09, 1.4, 0.7));
    this.osc(out, 'sine', NOTE(96), t + 0.3, 1.2, 0.03, 0.05);
  }

  public playLevelUp(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.95)!;
    const t = this.ctx!.currentTime;
    [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => this.pluck(out, NOTE(m), t + i * 0.06, 0.11, 1.6, 0.8));
    this.pad(out, [NOTE(60), NOTE(64), NOTE(67), NOTE(72)], t + 0.3, 1.6, 0.12, 2400);
    [96, 100, 103].forEach((m, i) => this.metal(out, t + 0.45 + i * 0.08, NOTE(m), 0.025, 1.4, [1, 3.0]));
  }

  public playJobChange(): void {
    if (!this.canPlay()) return;
    const out = this.out(1)!;
    const t = this.ctx!.currentTime;
    this.brass(out, [NOTE(50), NOTE(57), NOTE(62)], t, 1.2, 0.25);
    this.brass(out, [NOTE(55), NOTE(62), NOTE(67), NOTE(71)], t + 0.9, 2.2, 0.3);
    [74, 79, 83, 86, 91].forEach((m, i) => this.pluck(out, NOTE(m), t + 0.9 + i * 0.07, 0.1, 1.8, 0.8));
    this.kick(out, t + 0.9, 0.5, 0.7);
  }

  public playChestChime(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.85)!;
    const t = this.ctx!.currentTime;
    [72, 76, 79, 84].forEach((m, i) => this.metal(out, t + i * 0.065, NOTE(m), 0.06, 0.8, [1, 2.0, 3.0]));
  }

  public playCoinClink(count = 3): void {
    if (!this.canPlay()) return;
    const out = this.out(0.7)!;
    const t = this.ctx!.currentTime;
    const n = Math.max(1, Math.min(6, count));
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.045 + Math.random() * 0.04);
      this.metal(out, tt, (2400 + Math.random() * 900), 0.045, 0.28, [1, 1.52, 2.73]);
    }
  }

  public playPotionGulp(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.8)!;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.16;
      this.osc(out, 'sine', 170 * rand(0.1), tt, 0.12, 0.16, 0.01, 330 * rand(0.1));
      this.noise(out, tt, 0.1, 0.05, 'lowpass', 700);
    }
    this.osc(out, 'sine', NOTE(84), t + 0.55, 0.4, 0.04, 0.02);
  }

  public playEchoShard(): void {
    this.playStinger('memory');
  }

  public playChainRattle(): void {
    if (!this.canPlay()) return;
    const out = this.out(0.8)!;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 14; i++) {
      this.metal(out, t + i * 0.04 + Math.random() * 0.03, 900 + Math.random() * 1600, 0.03, 0.15, [1, 2.4]);
    }
    this.osc(out, 'sawtooth', 55, t, 1.2, 0.12, 0.2, 40);
  }

  /**
   * Blacksmith refinement: rhythmic anvil strikes building tension, then a harmonic fanfare
   * (success) or a dull clunk (failure). Returns seconds until the verdict lands.
   */
  public playRefine(success: boolean, level: number): number {
    const strikes = 3 + Math.min(4, Math.floor(level / 2));
    let tOff = 0;
    const times: number[] = [];
    for (let i = 0; i < strikes; i++) {
      times.push(tOff);
      tOff += Math.max(0.14, 0.42 - i * 0.05);
    }
    const verdictAt = tOff + 0.25;
    if (!this.canPlay()) return verdictAt;
    const out = this.out(1)!;
    const t = this.ctx!.currentTime;
    times.forEach((dt, i) => {
      const tt = t + dt;
      const v = 0.6 + i * 0.08;
      this.metal(out, tt, 520 * rand(0.03) * (1 + i * 0.02), 0.09 * v, 0.7, [1, 2.76, 5.4, 8.93]);
      this.osc(out, 'sine', 90, tt, 0.12, 0.25 * v, 0.002, 45);
      this.noise(out, tt, 0.05, 0.12 * v, 'highpass', 4000);
    });
    // tension riser under the hammering
    this.noise(out, t, verdictAt, 0.06, 'bandpass', 300, 2, 3000, verdictAt * 0.9);
    const tv = t + verdictAt;
    if (success) {
      const high = level >= 7;
      this.brass(out, high ? [NOTE(62), NOTE(66), NOTE(69), NOTE(74)] : [NOTE(60), NOTE(64), NOTE(67)], tv, 1.6, 0.28);
      [72, 76, 79, 84, 88, 91].forEach((m, i) => this.metal(out, tv + i * 0.06, NOTE(m + (high ? 2 : 0)), 0.04, 1.2, [1, 2.0, 3.0]));
      if (level >= 10) this.playStinger('triumph');
    } else {
      this.osc(out, 'sine', 70, tv, 0.5, 0.4, 0.003, 40);
      this.noise(out, tv, 0.35, 0.3, 'lowpass', 500, 1, 120);
      this.osc(out, 'sawtooth', NOTE(40), tv + 0.1, 0.6, 0.08, 0.01, NOTE(39));
      this.metal(out, tv, 310, 0.05, 0.25, [1, 1.47]);
    }
    return verdictAt;
  }

  // ───────────────────────────── Adaptive music ─────────────────────────────

  public setCombatIntensity(target: number): void {
    this.combatIntensity = Math.max(0, Math.min(1, target));
  }

  public setMusicMode(mode: MusicMode): void {
    if (mode === 'cutscene' && this.mode !== 'cutscene') this.modeBeforeCutscene = this.mode;
    this.mode = mode;
    this.updateLayerTargets();
  }

  /** Swap into the dramatic cutscene score, then restore whatever was playing. */
  public setCutsceneMusic(on: boolean): void {
    if (on) this.setMusicMode('cutscene');
    else if (this.mode === 'cutscene') this.setMusicMode(this.modeBeforeCutscene === 'silent' ? 'explore' : this.modeBeforeCutscene);
  }

  /** Mode to land on once the current cutscene ends (or immediately if none is playing). */
  public setResumeMode(mode: MusicMode): void {
    if (this.mode === 'cutscene') this.modeBeforeCutscene = mode;
    else this.setMusicMode(mode);
  }

  public getMusicMode(): MusicMode {
    return this.mode;
  }

  private updateLayerTargets(): void {
    if (!this.layers || !this.ctx) return;
    const m = this.mode;
    this.layers.town.target = m === 'town' ? 1 : 0;
    this.layers.explore.target = m === 'explore' ? 1 : 0;
    this.layers.boss.target = m === 'boss' ? 1 : m === 'cutscene' ? 0.85 : 0;
    const t = this.ctx.currentTime;
    // ~2.5s smooth crossfade
    (['town', 'explore', 'boss'] as const).forEach((k) => {
      const L = this.layers![k];
      L.gain.gain.cancelScheduledValues(t);
      L.gain.gain.setTargetAtTime(L.target, t, 0.9);
      if (L.target > 0 && L.nextStep < t) {
        L.nextStep = t + 0.05;
      }
    });
    if (this.bgmVerbSend) {
      // Dungeons get a deeper cave echo
      this.bgmVerbSend.gain.setTargetAtTime(m === 'town' ? 0.24 : 0.4, t, 0.8);
    }
    if (this.sfxVerbSend) this.sfxVerbSend.gain.setTargetAtTime(m === 'town' ? 0.08 : 0.2, t, 0.8);
  }

  private initMusic(): void {
    const ctx = this.ctx!;
    const mk = (): LayerState => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.bgmBus!);
      return { gain: g, nextStep: ctx.currentTime + 0.1, step: 0, target: 0 };
    };
    this.layers = { town: mk(), explore: mk(), boss: mk() };

    // Persistent subterranean drone for the dungeon layer
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 220;
    this.droneFilter.Q.value = 3;
    const droneG = ctx.createGain();
    droneG.gain.value = 0.32;
    this.droneFilter.connect(droneG);
    droneG.connect(this.layers.explore.gain);
    for (const [freq, type, amp] of [
      [NOTE(26), 'sawtooth', 0.5],
      [NOTE(33), 'triangle', 0.32],
      [NOTE(38) * 1.003, 'triangle', 0.18],
    ] as Array<[number, OscillatorType, number]>) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g);
      g.connect(this.droneFilter);
      o.start();
    }
    // Slow filter breathing
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 90;
    lfo.connect(lfoG);
    lfoG.connect(this.droneFilter.frequency);
    lfo.start();

    this.updateLayerTargets();
    if (this.schedulerId === null) {
      this.schedulerId = window.setInterval(() => this.schedule(), 30);
    }
  }

  /** Look-ahead step sequencer (independent of frame rate / pauses). */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.layers || ctx.state !== 'running') return;
    const horizon = ctx.currentTime + 0.18;
    const run = (L: LayerState, bpm: number, fn: (step: number, t: number, dest: AudioNode, stepDur: number) => void) => {
      const active = L.target > 0 || L.gain.gain.value > 0.003;
      if (!active) return;
      const stepDur = 60 / bpm / 4; // 16th notes
      if (L.nextStep < ctx.currentTime - 0.5) L.nextStep = ctx.currentTime + 0.02;
      while (L.nextStep < horizon) {
        fn(L.step, L.nextStep, L.gain, stepDur);
        L.step++;
        L.nextStep += stepDur;
      }
    };
    run(this.layers.town, 84, (s, t, d, sd) => this.townStep(s, t, d, sd));
    run(this.layers.explore, 70, (s, t, d, sd) => this.dungeonStep(s, t, d, sd));
    run(this.layers.boss, 132, (s, t, d, sd) => this.bossStep(s, t, d, sd));
  }

  /**
   * Oakhaven theme — D minor → F → C → D major (pastoral "minor-to-major" lift every 8 bars).
   * Plucked lute arpeggios, a breathy flute melody, warm pads and a soft frame drum.
   */
  private townStep(step: number, t: number, dest: AudioNode, sd: number): void {
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    // Chord roots (MIDI) + quality
    const prog: Array<[number, number[]]> = [
      [50, [0, 3, 7]], // Dm
      [46, [0, 4, 7]], // Bb
      [53, [0, 4, 7]], // F
      [48, [0, 4, 7]], // C
      [50, [0, 3, 7]], // Dm
      [43, [0, 3, 7]], // Gm
      [45, [0, 4, 7]], // A (dominant)
      [50, [0, 4, 7]], // D major — the hopeful lift
    ];
    const [root, q] = prog[bar];
    if (s === 0) {
      this.pad(dest, q.map((i) => NOTE(root + i + 12)), t, sd * 16, 0.07, 1300);
      this.osc(dest, 'triangle', NOTE(root - 12), t, sd * 14, 0.08, 0.05);
    }
    // Lute arpeggio pattern
    const arp = [0, 1, 2, 1, 3, 2, 1, 2];
    if (s % 2 === 0) {
      const idx = arp[(s / 2) % arp.length];
      const notes = [root, root + q[1], root + q[2], root + 12];
      this.pluck(dest, NOTE(notes[idx] + 12), t, 0.07 * (s === 0 ? 1.3 : 1), 1.0, 0.85);
    }
    // Frame drum
    if (s === 0 || s === 8) this.tom(dest, t, s === 0 ? 0.1 : 0.06, 110);
    if (s === 6 || s === 14) this.noise(dest, t, 0.05, 0.025, 'bandpass', 1800, 2);

    // Flute melody: generated phrase walking the scale with chord-tone landings
    if (s === 0 || s === 6 || s === 10 || (s === 12 && bar % 2 === 1)) {
      const scale = bar === 7 ? [0, 2, 4, 6, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]; // D major on the lift bar
      const st = this.melodyState;
      const leap = Math.random() < 0.7 ? (Math.random() < 0.5 ? -1 : 1) : Math.random() < 0.5 ? -2 : 2;
      st.lastDegree = Math.max(0, Math.min(9, st.lastDegree + leap));
      if (s === 0) st.lastDegree = [0, 2, 4][Math.floor(Math.random() * 3)];
      const deg = st.lastDegree;
      const midi = 74 + scale[deg % 7] + Math.floor(deg / 7) * 12;
      const len = s === 0 ? sd * 5.5 : sd * 3.5;
      if (Math.random() < 0.85) this.flute(dest, NOTE(midi), t, len, 0.055);
    }
  }

  /** Dungeon theme — tense drone (persistent) + sparse echoing chimes, combat adds pulse. */
  private dungeonStep(step: number, t: number, dest: AudioNode, sd: number): void {
    const s = step % 16;
    if (this.droneFilter && this.ctx) {
      this.droneFilter.frequency.setTargetAtTime(200 + this.combatIntensity * 380, t, 0.6);
    }
    // Sparse chimes (D phrygian pentatonic shards) with long echo
    if (s % 4 === 0 && Math.random() < 0.09) {
      const notes = [74, 75, 79, 81, 82, 86, 87];
      const m = notes[Math.floor(Math.random() * notes.length)];
      this.metal(dest, t, NOTE(m), 0.035, 2.6, [1, 2.76, 5.4]);
      // echo repeats
      this.metal(dest, t + sd * 6, NOTE(m), 0.014, 2.0, [1, 2.76]);
    }
    if (step % 64 === 0 && Math.random() < 0.6) {
      this.noise(dest, t, 4.0, 0.05, 'lowpass', 160, 1, 60, 1.5); // distant rumble
    }
    // Low heartbeat percussion as combat heats up
    const ci = this.combatIntensity;
    if (ci > 0.15) {
      if (s === 0 || s === 3) this.kick(dest, t, 0.22 * ci * (s === 0 ? 1 : 0.6), 0.8);
      if (ci > 0.6 && (s === 8 || s === 11)) this.tom(dest, t, 0.12 * ci, 95);
      if (ci > 0.5 && s % 2 === 0) this.noise(dest, t, 0.03, 0.02 * ci, 'highpass', 6000);
    }
  }

  /** Boss / Cutscene theme — E phrygian driving bass pulse with brass-like swells. */
  private bossStep(step: number, t: number, dest: AudioNode, sd: number): void {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const roots = [40, 36, 38, 35]; // E, C, D, B
    const root = roots[bar];
    const cut = this.mode === 'cutscene';
    if (s === 0) {
      const triad = bar === 3 ? [0, 4, 7] : [0, 3, 7];
      this.brass(dest, triad.map((i) => NOTE(root + 12 + i)), t, sd * 15, cut ? 0.12 : 0.1);
      this.pad(dest, [NOTE(root + 24), NOTE(root + 31)], t, sd * 16, 0.05, 1800);
    }
    // Driving 8th-note bass pulse
    if (s % 2 === 0 && !(cut && s % 4 !== 0)) {
      const ctx = this.ctx!;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = NOTE(root - 12 + (s === 14 ? 1 : 0));
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 6;
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(140, t + sd * 1.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + sd * 1.9);
      o.connect(f);
      f.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + sd * 2);
    }
    // War drums
    if (!cut) {
      if (s === 0 || s === 8 || s === 10) this.kick(dest, t, 0.32, 0.9);
      if (s === 4 || s === 12) this.tom(dest, t, 0.18, 170);
      if (s === 14 || s === 15) this.tom(dest, t, 0.12, 120);
      if (s % 2 === 1) this.noise(dest, t, 0.03, 0.025, 'highpass', 7000);
    } else if (s === 0) {
      this.kick(dest, t, 0.28, 0.7);
    }
  }

  /** Per-frame hook (kept for API compatibility; music runs on its own look-ahead timer). */
  public update(_dt: number): void {
    if (this.ctx && this.ctx.state === 'suspended' && !this.muted) {
      // some browsers suspend on tab switch; resume quietly
      this.ctx.resume().catch(() => {});
    }
  }
}
