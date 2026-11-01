import '../styles/shell-f3s.css';
import { el, q, setHidden, setStyleVar, setText } from './dom';
import { t } from './i18n';
import { loadPrefs, updatePrefs } from './prefs';

/** Contextual tips (FV-221): a short, one-line toast, 36 px high, the first time a person enters Perform, Keyframe, a
 *  Flipbook or Draw & Paint. It sits in the top left of the Stage panel (the gutter around the movie, never the middle),
 *  leaves by itself after four seconds (the pointer on it holds it), and each tip shows once. The "Show tips" preference
 *  turns them all off. Built once. */
export type TipId = 'perform' | 'keyframe' | 'flipbook' | 'paint';

const TIPS: Record<TipId, string> = {
  perform: 'Press the red disc, then drag a block on the Stage to record motion.',
  keyframe: 'Move the Playhead and change a value to set a key there.',
  flipbook: 'Turn on Onion skins to see the frames around the one you draw.',
  paint: 'Hold Ctrl and turn the wheel to zoom. Undo steps back one stroke.',
};
const SHOWN_MS = 4000;

export class Tips {
  private readonly root = el(`<div class="fm-tip" role="status" aria-live="polite" hidden>
    <span class="fm-tip-text"></span>
    <button class="fm-tip-got" type="button">Got it</button>
  </div>`);
  private shown: TipId | null = null;
  private timer = 0;

  constructor() {
    q(this.root, 'button').addEventListener('click', () => this.dismiss());
    // the pointer resting on the tip, or focus inside it, holds it; leaving starts the clock again
    this.root.addEventListener('pointerenter', () => window.clearTimeout(this.timer));
    this.root.addEventListener('pointerleave', () => this.arm());
    window.addEventListener('resize', () => { if (this.shown) this.place(); });
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
  }

  private arm(): void {
    window.clearTimeout(this.timer);
    if (this.shown) this.timer = window.setTimeout(() => this.dismiss(), SHOWN_MS);
  }

  /** The movie frame in the window, so a tip keeps clear of the picture (set by the app once the Stage exists). */
  frame: () => DOMRect | null = () => null;

  /** A corner of the Stage panel, inside its margin, that the movie frame does not cover: top left, top right, bottom right, bottom left past the timecode. */
  private place(): void {
    const r = document.querySelector<HTMLElement>('.fm-stage-wrap')?.getBoundingClientRect();
    const left = r?.left ?? 0, top = r?.top ?? 40, right = r?.right ?? window.innerWidth, bottom = r?.bottom ?? 400;
    const w = this.root.offsetWidth || 360, h = 36, f = this.frame();
    const spots: Array<[number, number]> = [[left + 16, top + 12], [right - w - 16, top + 12], [right - w - 16, bottom - h - 12], [left + 280, bottom - h - 12]];
    const hit = ([x, y]: [number, number]): number => (f ? Math.max(0, Math.min(x + w, f.right + 8) - Math.max(x, f.left - 8)) * Math.max(0, Math.min(y + h, f.bottom + 8) - Math.max(y, f.top - 8)) : 0);
    let best = spots.find((s) => hit(s) === 0);
    if (!best) {
      // the frame fills the panel: dock the tip on the status bar line, centred, clear of the picture
      const sb = document.querySelector<HTMLElement>('.cv-status')?.getBoundingClientRect();
      best = sb && sb.height >= 24 && sb.top > 0 && sb.top < window.innerHeight ? [Math.max(8, (window.innerWidth - w) / 2), sb.top + (sb.height - h) / 2] : spots.slice().sort((a, b) => hit(a) - hit(b))[0];
    }
    setStyleVar(this.root, '--x', `${Math.round(best[0])}px`);
    setStyleVar(this.root, '--y', `${Math.round(best[1])}px`);
  }

  /** Shows the tip for `id` unless tips are off or it was already seen. */
  enter(id: TipId): void {
    const p = loadPrefs();
    if (!p.showTips || p.tipsSeen.includes(id)) return;
    updatePrefs({ tipsSeen: [...p.tipsSeen, id] });
    this.shown = id;
    setText(q(this.root, '.fm-tip-text'), t(TIPS[id]));
    setHidden(this.root, false);
    this.place();   // after it is shown, so its width can be measured
    this.arm();
  }

  dismiss(): void {
    this.shown = null;
    window.clearTimeout(this.timer);
    setHidden(this.root, true);
  }

  get visible(): TipId | null { return this.shown; }
}
