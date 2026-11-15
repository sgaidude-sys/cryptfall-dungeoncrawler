import type { SoundEngine, VolumeChannel } from '../audio/SoundEngine';

/**
 * Persistent top-corner audio widget (lives outside the HUD root so HUD re-renders never wipe it):
 * a mute toggle plus an expandable Master / SFX / Music mixer.
 */
export class AudioControls {
  private root: HTMLElement;
  private btn: HTMLButtonElement;
  private panel: HTMLElement;
  private open = false;

  constructor(private sound: SoundEngine) {
    this.root = document.createElement('div');
    this.root.id = 'audio-controls';
    this.root.innerHTML = `
      <button class="ac-btn" id="ac-toggle" title="Audio (M to mute)" aria-label="Audio settings"></button>
      <div class="ac-panel" id="ac-panel">
        <div class="ac-title">Audio Mixer</div>
        ${(['master', 'sfx', 'bgm'] as VolumeChannel[])
          .map(
            (ch) => `
          <label class="ac-row">
            <span>${ch === 'master' ? 'Master' : ch === 'sfx' ? 'Effects' : 'Music'}</span>
            <input type="range" min="0" max="100" step="1" data-ch="${ch}" />
            <span class="ac-val" data-val="${ch}"></span>
          </label>`
          )
          .join('')}
        <button class="ac-mute" id="ac-mute"></button>
      </div>
    `;
    document.body.appendChild(this.root);
    this.btn = this.root.querySelector('#ac-toggle')!;
    this.panel = this.root.querySelector('#ac-panel')!;

    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sound.unlock();
      this.open = !this.open;
      this.panel.classList.toggle('open', this.open);
      this.sound.playUISelect();
    });
    this.btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.sound.unlock();
      this.sound.toggleMute();
    });
    this.root.querySelector('#ac-mute')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sound.unlock();
      this.sound.toggleMute();
    });
    this.root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((input) => {
      input.addEventListener('input', () => {
        this.sound.unlock();
        this.sound.setVolume(input.dataset.ch as VolumeChannel, Number(input.value) / 100);
      });
      input.addEventListener('change', () => this.sound.playUIHover());
    });
    // Keep clicks inside the widget from reaching the game (attack / unlock handlers)
    ['mousedown', 'pointerdown', 'mouseup'].forEach((evt) =>
      this.root.addEventListener(evt, (e) => e.stopPropagation())
    );
    document.addEventListener('click', (e) => {
      if (this.open && !this.root.contains(e.target as Node)) {
        this.open = false;
        this.panel.classList.remove('open');
      }
    });

    this.sound.onChange(() => this.sync());
    this.sync();
  }

  public setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  private sync(): void {
    const muted = this.sound.isMuted();
    const master = this.sound.getVolume('master');
    this.btn.textContent = muted || master === 0 ? '🔇' : master < 0.4 ? '🔈' : master < 0.75 ? '🔉' : '🔊';
    this.btn.classList.toggle('muted', muted);
    this.root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((input) => {
      const ch = input.dataset.ch as VolumeChannel;
      const v = Math.round(this.sound.getVolume(ch) * 100);
      if (document.activeElement !== input) input.value = String(v);
      const label = this.root.querySelector(`[data-val="${ch}"]`);
      if (label) label.textContent = `${v}`;
    });
    const muteBtn = this.root.querySelector('#ac-mute');
    if (muteBtn) muteBtn.textContent = muted ? 'Unmute (M)' : 'Mute All (M)';
  }
}
