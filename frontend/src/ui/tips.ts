import '../styles/shell-f3s.css';
import { el, q, setHidden, setText } from './dom';
import { t } from './i18n';
import { loadPrefs, updatePrefs } from './prefs';

/** Contextual tip cards: one line and "Got it", the first time a person enters Perform, Keyframe, a Flipbook or
 *  Draw & Paint. Remembered in the preferences; the "Show tips" preference turns them all off. Built once. */
export type TipId = 'perform' | 'keyframe' | 'flipbook' | 'paint';

const TIPS: Record<TipId, string> = {
  perform: 'Tip: select a block, press the red record disc on the Playhead, then drag it on the Stage. The drag is recorded as motion.',
  keyframe: 'Tip: move the Playhead and change a value to set a keyframe there. Drag a key along its lane to retime it.',
  flipbook: 'Tip: a Flipbook is drawn one frame after another. Turn on Onion skins to see the frames around the one you are drawing.',
  paint: 'Tip: draw with the pen, the mouse or a finger. Hold Ctrl and turn the wheel to zoom, and Undo steps back one stroke.',
};

export class Tips {
  private readonly root = el(`<div class="fm-tip" role="status" aria-live="polite" hidden>
    <span class="fm-tip-text"></span>
    <button class="cv-btn cv-btn-primary" type="button">Got it</button>
  </div>`);
  private shown: TipId | null = null;

  constructor() {
    q(this.root, 'button').addEventListener('click', () => this.dismiss());
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
  }

  /** Shows the tip for `id` unless tips are off or it was already seen. */
  enter(id: TipId): void {
    const p = loadPrefs();
    if (!p.showTips || p.tipsSeen.includes(id)) return;
    updatePrefs({ tipsSeen: [...p.tipsSeen, id] });
    this.shown = id;
    setText(q(this.root, '.fm-tip-text'), t(TIPS[id]));
    setHidden(this.root, false);
  }

  dismiss(): void {
    this.shown = null;
    setHidden(this.root, true);
  }

  get visible(): TipId | null { return this.shown; }
}
