// A small progress chip for slow Draw & Paint work (Crop and resize of a big canvas). Built once, patched in place.

import '../styles/paint-progress.css';
import { el, q, setHidden, setStyleVar, setText } from './dom';

export class ProgressChip {
  readonly root = el<HTMLElement>('<div class="fm-prog" role="status" aria-live="polite" hidden><span class="fm-prog-text"></span><span class="fm-prog-bar"><i></i></span></div>');
  private readonly text = q(this.root, '.fm-prog-text');
  private readonly bar = q(this.root, '.fm-prog-bar');

  /** `frac` 0..1; the chip shows when called and stays until `hide`. */
  show(label: string, frac: number): void {
    setHidden(this.root, false);
    setText(this.text, label);
    setStyleVar(this.bar, '--p', String(Math.max(0, Math.min(1, frac))));
  }

  hide(): void { setHidden(this.root, true); }
}
