import '../styles/onboarding.css';
import { el, q, setClass, setHidden, setStyleVar, setText } from './dom';
import { t } from './i18n';

/** The first-run tour: a few coach marks over the working screen, each pointing at one part (a ring around it and a
 *  card beside it). Skippable at any step (the button or Esc), and shown again from Help. Built once; moving between
 *  steps only changes text, classes and position variables. */
interface Step { title: string; text: string; target: () => HTMLElement | null }

const first = (...sel: string[]): HTMLElement | null => {
  for (const s of sel) { const n = document.querySelector<HTMLElement>(s); if (n && n.offsetParent !== null) return n; }
  return null;
};

const STEPS: readonly Step[] = [
  { title: 'The Stage', text: 'This is your picture. Click a block to select it and drag it to move it. Hold Ctrl and turn the wheel to zoom.', target: () => first('.fm-stage') },
  { title: 'The Timeline', text: 'Every drawing, Flipbook, text, picture, video and sound is a block on a track. Drag the Playhead to move through time and drag a block to move it.', target: () => first('.fm-tl-host') },
  { title: 'Three modes', text: 'Compose arranges blocks. Perform records a drag on the Stage as motion. Keyframe sets values at the frames you choose.', target: () => first('.fm-mode')?.parentElement ?? null },
  { title: 'The Create menu', text: 'Add a Drawing, a Flipbook or text, start a new track, or import a picture, video or sound.', target: () => first('[data-act="create"]') },
  { title: 'Stage Options', text: 'Open View, then Stage Options, or right-click the Stage, to set the background color, transparency, the timecode and Onion skins. Help, then Take the Tour, shows this again.', target: () => first('.cv-menubar .cv-menu-btn:nth-child(5)', '.fm-stage') },
];

const SEEN = 'formmorpheus.tour';
export const tourSeen = (): boolean => { try { return localStorage.getItem(SEEN) === '1'; } catch { return true; } };
const markSeen = (): void => { try { localStorage.setItem(SEEN, '1'); } catch { /* shown again next start */ } };

export class Tour {
  private readonly root = el(`<div class="fm-tour" hidden>
    <div class="fm-tour-shield"></div>
    <div class="fm-tour-ring"></div>
    <div class="fm-tour-card" role="dialog" aria-live="polite" aria-label="Tour">
      <div class="fm-tour-count"></div>
      <div class="fm-tour-title"></div>
      <p class="fm-tour-text"></p>
      <div class="fm-tour-dots"></div>
      <div class="fm-tour-actions">
        <button class="cv-btn cv-btn-ghost" type="button" data-t="skip">Skip tour</button>
        <span class="fm-tour-gap"></span>
        <button class="cv-btn" type="button" data-t="back">Back</button>
        <button class="cv-btn cv-btn-primary" type="button" data-t="next">Next</button>
      </div>
    </div>
  </div>`);
  private readonly card = q(this.root, '.fm-tour-card');
  private readonly back = q<HTMLButtonElement>(this.root, '[data-t="back"]');
  private readonly next = q<HTMLButtonElement>(this.root, '[data-t="next"]');
  private readonly dots: HTMLElement[] = [];
  private at = 0;
  private active = false;

  constructor() {
    const dots = q(this.root, '.fm-tour-dots');
    for (let i = 0; i < STEPS.length; i++) { const d = el('<span class="fm-tour-dot"></span>'); dots.appendChild(d); this.dots.push(d); }
    this.root.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t;
      if (a === 'skip') this.stop();
      else if (a === 'back') this.go(this.at - 1);
      else if (a === 'next') this.go(this.at + 1);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const k = e.key;
      if (k === 'Escape') this.stop();
      else if (k === 'ArrowRight' || k === 'Enter') this.go(this.at + 1);
      else if (k === 'ArrowLeft') this.go(this.at - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    window.addEventListener('resize', () => { if (this.active) this.place(); });
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
  }

  get isActive(): boolean { return this.active; }

  start(): void {
    this.active = true;
    setHidden(this.root, false);
    this.go(0);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    markSeen();
    setHidden(this.root, true);
  }

  private go(i: number): void {
    if (i >= STEPS.length) { this.stop(); return; }
    this.at = Math.max(0, i);
    const s = STEPS[this.at];
    setText(q(this.root, '.fm-tour-count'), `${this.at + 1} / ${STEPS.length}`);
    setText(q(this.root, '.fm-tour-title'), t(s.title));
    setText(q(this.root, '.fm-tour-text'), t(s.text));
    this.dots.forEach((d, n) => { setClass(d, 'is-current', n === this.at); setClass(d, 'is-done', n < this.at); });
    this.back.disabled = this.at === 0;
    setText(this.next, t(this.at === STEPS.length - 1 ? 'Done' : 'Next'));
    this.place();
  }

  /** Puts the ring on the target and the card beside it: below, else above, else inside the target's top. */
  private place(): void {
    const target = STEPS[this.at].target();
    const vw = window.innerWidth, vh = window.innerHeight, pad = 6;
    const r = target?.getBoundingClientRect() ?? new DOMRect(vw / 2 - 120, vh / 2 - 60, 240, 120);
    const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
    const w = Math.min(vw - x, r.width + pad * 2), h = Math.min(vh - y, r.height + pad * 2);
    const ring = q(this.root, '.fm-tour-ring');
    setStyleVar(ring, '--x', `${x}px`);
    setStyleVar(ring, '--y', `${y}px`);
    setStyleVar(ring, '--w', `${w}px`);
    setStyleVar(ring, '--h', `${h}px`);
    const cw = Math.min(340, vw - 32), ch = this.card.offsetHeight || 190;
    let cy = y + h + 12;
    if (cy + ch > vh - 12) cy = y - ch - 12;
    if (cy < 12) cy = Math.min(vh - ch - 12, y + 16);   // no room around a big target: sit inside its top
    const cx = Math.min(vw - cw - 16, Math.max(16, r.left + r.width / 2 - cw / 2));
    setStyleVar(this.card, '--x', `${cx}px`);
    setStyleVar(this.card, '--y', `${Math.max(12, cy)}px`);
    setStyleVar(this.card, '--w', `${cw}px`);
  }
}
