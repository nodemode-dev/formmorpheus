// The question when a movie with content changes frame rate: keep the frames where they are (the movie then plays
// faster or slower, as the reference does) or retime them to keep each length in seconds.
import { Dialog } from './dialogs';
import { el, setText } from './dom';
import { t } from './i18n';
import { tf } from './i18n-fill';

export type FpsChoice = 'keep-frames' | 'retime' | 'cancel';

class FpsChange extends Dialog {
  private readonly lead = el('<p class="cv-note"></p>');
  private readonly detail = el('<p class="cv-note"></p>');
  private readonly keepBtn: HTMLButtonElement;
  private resolve: ((v: FpsChoice) => void) | null = null;
  constructor() {
    super('Change frame rate', 480);
    this.body.append(this.lead, this.detail);
    this.button('Keep timing', 'ghost', () => this.finish('retime')).classList.add('cv-btn-apart');
    this.button('Cancel', 'ghost', () => this.finish('cancel'));
    this.keepBtn = this.button('Keep frames', 'primary', () => this.finish('keep-frames'));
    this.onClose = () => this.finish('cancel');
  }
  ask(from: number, to: number, seconds: number, newSeconds: number): Promise<FpsChoice> {
    setText(this.lead, tf('Every block and keyframe stays on the same frame, so the movie plays at the new speed: {from} to {to} frames per second, about {before} seconds long becomes {after} seconds.', { from, to, before: seconds.toFixed(1), after: newSeconds.toFixed(1) }));
    setText(this.detail, t('Choose Keep timing instead to move blocks and keyframes so each keeps its length in seconds. Undo restores either.'));
    this.open(this.keepBtn);
    return new Promise((r) => { this.resolve = r; });
  }
  private finish(v: FpsChoice): void {
    const r = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    r?.(v);
  }
}

let dlg: FpsChange | null = null;
export function askFpsChange(from: number, to: number, durationFrames: number): Promise<FpsChoice> {
  dlg ??= new FpsChange();
  return dlg.ask(from, to, durationFrames / Math.max(1, from), durationFrames / Math.max(1, to));
}
