// Draw & Paint keeps its "Track 1 · frame 3 of 24" label out of the top bar (the tools own that row) and shows it in
// the status bar, where the mode hint sits. The status bar is the shell's: this only swaps its hint text while a
// drawing is open and puts the old text back when it closes.

import { setText } from './dom';

let held: string | null = null;

const hintEl = (): HTMLElement | null => document.querySelector<HTMLElement>('.cv-st-hint');

/** Show `text` in the status bar's hint; null gives the shell its own text back. */
export function paintHint(text: string | null): void {
  const h = hintEl();
  if (!h) return;
  if (text === null) {
    if (held !== null) { setText(h, held); held = null; }
    return;
  }
  if (held === null) held = h.textContent ?? '';
  if (h.textContent !== text) setText(h, text);
}
