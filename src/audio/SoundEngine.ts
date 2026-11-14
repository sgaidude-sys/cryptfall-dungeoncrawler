export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private sfxBuffers = new Map<string, AudioBuffer>();
  private sfxLoading = false;
  private ambienceAudio: HTMLAudioElement | null = null;
  private bossAudio: HTMLAudioElement | null = null;
  private musicMode: 'explore' | 'boss' = 'explore';
  private droneGain: GainNode | null = null;
  private combatIntensity = 0; // 0..1
  private percTimer = 0;
  private percStep = 0;
  private muted = false;

  public unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.42;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(1.5);
      this.startDungeonDrone();
      this.preloadSfxBuffers();
      this.initMusicTracks();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this.ambienceAudio?.play().catch(() => {});
    this.bossAudio?.play().catch(() => {});
  }

  private initMusicTracks(): void {
    this.ambienceAudio = new Audio('./assets/sfx/music_ambience.mp3');
    this.ambienceAudio.loop = true;
    this.ambienceAudio.volume = 0.28;
    this.bossAudio = new Audio('./assets/sfx/music_boss.mp3');
    this.bossAudio.loop = true;
    this.bossAudio.volume = 0.0;
  }

  public setMusicMode(mode: 'explore' | 'boss'): void {
    this.musicMode = mode;
  }

  public playCinematicWhoosh(): void {
    this.playBuffer('cinematic_whoosh.mp3', 0.5, 0.96, 1.04);
  }

  private async preloadSfxBuffers(): Promise<void> {
    if (this.sfxLoading || !this.ctx) return;
    this.sfxLoading = true;
    const files = [
      'ui_hover.mp3', 'ui_select.mp3', 'ui_popup.mp3',
      'step1.mp3', 'step2.mp3',
      'fire_burst.wav', 'heavy_impact.wav', 'ice_nova.wav', 'cinematic_whoosh.mp3',
      'voice_atk1.wav', 'voice_atk2.wav', 'voice_hit1.wav', 'voice_hit2.wav',
    ];
    for (const f of files) {
      try {
        const res = await fetch(`./assets/sfx/${f}`);
        if (!res.ok) continue;
        const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr);
        this.sfxBuffers.set(f, buf);
      } catch {
        // Fallback to procedural synth if decode fails
      }
    }
  }

  private playBuffer(name: string, gainVal = 0.5, rateMin = 0.94, rateMax = 1.06): boolean {
    if (!this.ctx || !this.masterGain || this.muted) return false;
    const buf = this.sfxBuffers.get(name);
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rateMin + Math.random() * (rateMax - rateMin);
    const g = this.ctx.createGain();
    g.gain.value = gainVal;
    src.connect(g);
    g.connect(this.masterGain);
    src.start();
    return true;
  }

  public playUIHover(): void { this.playBuffer('ui_hover.mp3', 0.25, 0.98, 1.04); }
  public playUISelect(): void { this.playBuffer('ui_select.mp3', 0.35, 0.98, 1.03); }
  public playUIPopup(): void { this.playBuffer('ui_popup.mp3', 0.38, 0.98, 1.02); }
  public playIceNova(): void { this.playBuffer('ice_nova.wav', 0.42, 0.95, 1.05); }
  public playBattleCry(): void {
    if (Math.random() < 0.65) this.playBuffer(Math.random() < 0.5 ? 'voice_atk1.wav' : 'voice_atk2.wav', 0.45, 0.94, 1.06);
  }

  public setCombatIntensity(target: number): void {
    this.combatIntensity = Math.max(0, Math.min(1, target));
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.42, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  private createNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  private startDungeonDrone(): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.14;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 145;
    filter.Q.value = 2.5;
    filter.connect(this.droneGain);
    this.droneGain.connect(this.masterGain);

    for (const freq of [55, 82.41, 110.2]) {
      const osc = ctx.createOscillator();
      osc.type = freq === 55 ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = freq === 55 ? 0.35 : 0.2;
      osc.connect(g);
      g.connect(filter);
      osc.start();
    }
  }

  public update(dt: number): void {
    if (this.ambienceAudio && this.bossAudio) {
      const ambTarget = this.muted ? 0 : this.musicMode === 'explore' ? 0.30 : 0.08;
      const bossTarget = this.muted ? 0 : this.musicMode === 'boss' ? 0.36 : 0.0;
      this.ambienceAudio.volume += (ambTarget - this.ambienceAudio.volume) * Math.min(1, dt * 2.5);
      this.bossAudio.volume += (bossTarget - this.bossAudio.volume) * Math.min(1, dt * 2.5);
    }
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.droneGain) {
      const target = 0.12 + this.combatIntensity * 0.08;
      this.droneGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
    }
    if (this.combatIntensity > 0.15) {
      const interval = 0.38 - this.combatIntensity * 0.14;
      this.percTimer += dt;
      if (this.percTimer >= interval) {
        this.percTimer = 0;
        this.playCombatPercussion(this.percStep++, this.combatIntensity);
      }
    }
  }

  private playCombatPercussion(step: number, intensity: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const accent = step % 4 === 0 ? 1.0 : 0.55;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    const baseFreq = step % 4 === 0 ? 78 : 112;
    osc.frequency.setValueAtTime(baseFreq * (0.96 + Math.random() * 0.08), now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.14);
    g.gain.setValueAtTime(0.14 * intensity * accent, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g);
    g.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playSwordClang(velocity = 1): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pitch = 0.88 + Math.random() * 0.28;

    // Metallic ring partials
    for (const ratio of [1, 2.32, 3.71]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = ratio === 1 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(620 * ratio * pitch, now);
      osc.frequency.exponentialRampToValueAtTime(420 * ratio * pitch, now + 0.18);
      g.gain.setValueAtTime((0.16 / ratio) * velocity, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.23);
    }

    this.playNoiseBurst(0.08, 2200 * pitch, 'bandpass', 0.18 * velocity);
  }

  public playAxeThud(velocity = 1): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pitch = 0.85 + Math.random() * 0.25;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.18);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    g.gain.setValueAtTime(0.35 * velocity, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);

    this.playNoiseBurst(0.11, 520 * pitch, 'lowpass', 0.25 * velocity);
  }

  public playBowTwang(velocity = 1): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pitch = 0.92 + Math.random() * 0.18;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(135 * pitch, now + 0.14);
    g.gain.setValueAtTime(0.22 * velocity, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);

    this.playNoiseBurst(0.05, 3200 * pitch, 'highpass', 0.12 * velocity);
  }

  public playArcaneBlast(velocity = 1): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pitch = 0.9 + Math.random() * 0.22;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(760 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(190 * pitch, now + 0.24);

    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    mod.frequency.value = 42 * pitch;
    modG.gain.value = 180;
    mod.connect(modG);
    modG.connect(osc.frequency);

    g.gain.setValueAtTime(0.22 * velocity, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(g);
    g.connect(this.masterGain);
    mod.start(now);
    osc.start(now);
    mod.stop(now + 0.27);
    osc.stop(now + 0.27);
  }

  public playBoneShatter(): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    for (let i = 0; i < 5; i++) {
      const delay = i * 0.032 + Math.random() * 0.02;
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      const f = (480 + Math.random() * 650);
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.45, now + 0.045);
      g.gain.setValueAtTime(0.11, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.055);
    }
    this.playNoiseBurst(0.12, 1600, 'bandpass', 0.2);
  }

  public playChestChime(): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.065;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(0.16, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(now);
      osc.stop(now + 0.46);
    });
  }

  public playFootstep(): void {
    if (!this.ctx || !this.masterGain) return;
    if (this.playBuffer(Math.random() < 0.5 ? 'step1.mp3' : 'step2.mp3', 0.22, 0.88, 1.15)) return;
    const pitch = 0.8 + Math.random() * 0.4;
    this.playNoiseBurst(0.04, 340 * pitch, 'lowpass', 0.065);
  }

  public playDodge(): void {
    if (!this.ctx || !this.masterGain) return;
    this.playNoiseBurst(0.14, 900 + Math.random() * 300, 'bandpass', 0.16);
  }

  public playPlayerHit(): void {
    if (!this.ctx || !this.masterGain) return;
    this.playAxeThud(0.85);
    this.playBuffer(Math.random() < 0.5 ? 'voice_hit1.wav' : 'voice_hit2.wav', 0.42, 0.94, 1.05);
  }

  public playExplosion(): void {
    if (!this.ctx || !this.masterGain) return;
    this.playAxeThud(1.1);
    if (!this.playBuffer('fire_burst.wav', 0.45, 0.92, 1.08)) {
      this.playNoiseBurst(0.28, 420, 'lowpass', 0.35);
    }
    this.playBuffer('heavy_impact.wav', 0.38, 0.95, 1.05);
  }

  private playNoiseBurst(dur: number, freq: number, type: BiquadFilterType, gainVal: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + dur + 0.02);
  }
}
