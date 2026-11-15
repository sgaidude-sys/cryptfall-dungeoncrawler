export class CutsceneOverlay {
  private root: HTMLElement;
  private topBar: HTMLElement;
  private botBar: HTMLElement;
  private fadeEl: HTMLElement;
  private skipBtn: HTMLButtonElement;
  private chapterCard: HTMLElement;
  private dialogueBox: HTMLElement;
  private portraitEl: HTMLElement;
  private speakerNameEl: HTMLElement;
  private speakerTitleEl: HTMLElement;
  private dialogueTextEl: HTMLElement;
  private continueHintEl: HTMLElement;

  private advanceResolver: (() => void) | null = null;
  private typewriterTimer: number | null = null;
  private fullText = '';
  private isTyping = false;
  public onSkip?: () => void;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'cutscene-director-root';
    this.root.innerHTML = `
      <div class="cs-fade" id="cs-fade"></div>
      <div class="cs-bar cs-bar-top" id="cs-bar-top"></div>
      <div class="cs-bar cs-bar-bot" id="cs-bar-bot"></div>
      <button class="cs-skip-btn" id="cs-skip-btn">Skip Cutscene [ESC]</button>
      <div class="cs-chapter-card" id="cs-chapter-card">
        <div class="cs-chapter-act" id="cs-chapter-act"></div>
        <div class="cs-chapter-rule"></div>
        <div class="cs-chapter-title" id="cs-chapter-title"></div>
        <div class="cs-chapter-sub" id="cs-chapter-sub"></div>
        <div class="cs-chapter-rule"></div>
      </div>
      <div class="cs-dialogue-box" id="cs-dialogue-box">
        <div class="cs-portrait" id="cs-portrait"></div>
        <div class="cs-dialogue-body">
          <div class="cs-speaker-row">
            <span class="cs-speaker-name" id="cs-speaker-name"></span>
            <span class="cs-speaker-title" id="cs-speaker-title"></span>
          </div>
          <div class="cs-dialogue-text" id="cs-dialogue-text"></div>
          <div class="cs-continue-hint" id="cs-continue-hint">Space / Click to Continue &#9660;</div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.topBar = this.root.querySelector('#cs-bar-top')!;
    this.botBar = this.root.querySelector('#cs-bar-bot')!;
    this.fadeEl = this.root.querySelector('#cs-fade')!;
    this.skipBtn = this.root.querySelector('#cs-skip-btn')!;
    this.chapterCard = this.root.querySelector('#cs-chapter-card')!;
    this.dialogueBox = this.root.querySelector('#cs-dialogue-box')!;
    this.portraitEl = this.root.querySelector('#cs-portrait')!;
    this.speakerNameEl = this.root.querySelector('#cs-speaker-name')!;
    this.speakerTitleEl = this.root.querySelector('#cs-speaker-title')!;
    this.dialogueTextEl = this.root.querySelector('#cs-dialogue-text')!;
    this.continueHintEl = this.root.querySelector('#cs-continue-hint')!;

    this.skipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSkip?.();
    });

    this.dialogueBox.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleAdvanceInput();
    });
  }

  public showLetterbox(visible: boolean): void {
    this.root.classList.toggle('active', visible);
    this.topBar.classList.toggle('open', visible);
    this.botBar.classList.toggle('open', visible);
    this.skipBtn.classList.toggle('open', visible);
    if (!visible) {
      this.hideDialogue();
      this.chapterCard.classList.remove('open');
      this.fadeEl.style.opacity = '0';
    }
  }

  public setFade(toBlack: boolean, durationSec: number): Promise<void> {
    this.fadeEl.style.transition = `opacity ${Math.max(0.05, durationSec)}s ease`;
    this.fadeEl.style.opacity = toBlack ? '1' : '0';
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(50, durationSec * 1000)));
  }

  public showChapterCard(actNumber: string, title: string, subtitle: string, durationSec = 2.8): Promise<void> {
    const actEl = this.root.querySelector('#cs-chapter-act')!;
    const titleEl = this.root.querySelector('#cs-chapter-title')!;
    const subEl = this.root.querySelector('#cs-chapter-sub')!;
    actEl.textContent = actNumber;
    titleEl.textContent = title;
    subEl.textContent = subtitle;
    this.chapterCard.classList.add('open');
    return new Promise((resolve) => {
      window.setTimeout(() => {
        this.chapterCard.classList.remove('open');
        window.setTimeout(resolve, 400);
      }, durationSec * 1000);
    });
  }

  public say(
    speakerName: string,
    speakerTitle: string,
    portraitTintHex: string,
    text: string,
    typewriterSpeedMs = 20
  ): Promise<void> {
    this.clearTypewriter();
    this.fullText = text;
    this.isTyping = true;
    this.speakerNameEl.textContent = speakerName;
    this.speakerTitleEl.textContent = speakerTitle;
    this.portraitEl.style.background = `radial-gradient(circle at 35% 30%, ${portraitTintHex}, #0d101b 78%)`;
    this.portraitEl.style.borderColor = portraitTintHex;
    this.portraitEl.textContent = speakerName.slice(0, 1).toUpperCase();
    this.dialogueTextEl.textContent = '';
    this.continueHintEl.style.opacity = '0.25';
    this.dialogueBox.classList.add('open');

    let idx = 0;
    this.typewriterTimer = window.setInterval(() => {
      idx++;
      this.dialogueTextEl.textContent = this.fullText.slice(0, idx);
      if (idx >= this.fullText.length) {
        this.finishTyping();
      }
    }, Math.max(8, typewriterSpeedMs));

    return new Promise((resolve) => {
      this.advanceResolver = resolve;
    });
  }

  public handleAdvanceInput(): void {
    if (!this.advanceResolver) return;
    if (this.isTyping) {
      this.finishTyping();
      return;
    }
    const res = this.advanceResolver;
    this.advanceResolver = null;
    this.hideDialogue();
    res();
  }

  public forceResolve(): void {
    this.clearTypewriter();
    this.isTyping = false;
    if (this.advanceResolver) {
      const res = this.advanceResolver;
      this.advanceResolver = null;
      res();
    }
    this.hideDialogue();
    this.chapterCard.classList.remove('open');
  }

  private finishTyping(): void {
    this.clearTypewriter();
    this.isTyping = false;
    this.dialogueTextEl.textContent = this.fullText;
    this.continueHintEl.style.opacity = '1';
  }

  private hideDialogue(): void {
    this.dialogueBox.classList.remove('open');
  }

  private clearTypewriter(): void {
    if (this.typewriterTimer !== null) {
      window.clearInterval(this.typewriterTimer);
      this.typewriterTimer = null;
    }
  }
}
