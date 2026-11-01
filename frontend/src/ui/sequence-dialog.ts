// The question when several numbered pictures are imported together: one Flipbook at a frame rate (the file names
// carry none), or each picture on its own as before.
import { Dialog } from './dialogs';
import { el, setText } from './dom';
import { tf } from './i18n-fill';

export type SequenceChoice = { as: 'flipbook'; fps: number } | { as: 'separate' } | null;

class SequenceDialog extends Dialog {
  private readonly lead = el('<p class="cv-note"></p>');
  private readonly fps = el<HTMLInputElement>('<input class="cv-input" type="number" min="1" max="240" step="1" aria-label="Frames per second">');
  private readonly one: HTMLButtonElement;
  private resolve: ((v: SequenceChoice) => void) | null = null;
  constructor() {
    super('Numbered pictures', 460);
    this.body.append(this.lead);
    this.field('Frame rate (frames per second)', this.fps);
    // room for the slider that opens under the field, so it never covers the buttons
    const room = el('<div aria-hidden="true"></div>');
    room.style.height = 'var(--space-7)';
    this.body.append(room);
    this.button('Cancel', 'ghost', () => this.finish(null));
    this.button('Import separately', 'ghost', () => this.finish({ as: 'separate' }));
    this.one = this.button('Import as one Flipbook', 'primary', () => {
      const n = Math.round(Number(this.fps.value));
      this.finish({ as: 'flipbook', fps: Number.isFinite(n) && n >= 1 ? Math.min(240, n) : 12 });
    });
    this.fps.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.one.click(); } });
    this.onClose = () => this.finish(null);
  }
  ask(count: number, first: string, defaultFps: number): Promise<SequenceChoice> {
    setText(this.lead, tf('These {n} pictures ({first} and on) are numbered in order. They have no frame rate of their own: type the rate they were made at so the timing stays the same.', { n: count, first }));
    this.fps.value = String(defaultFps);
    this.open(this.fps);
    this.fps.select();
    return new Promise((r) => { this.resolve = r; });
  }
  private finish(v: SequenceChoice): void {
    const r = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    r?.(v);
  }
}

let dlg: SequenceDialog | null = null;
export function askSequence(count: number, first: string, defaultFps: number): Promise<SequenceChoice> {
  dlg ??= new SequenceDialog();
  return dlg.ask(count, first, defaultFps);
}
