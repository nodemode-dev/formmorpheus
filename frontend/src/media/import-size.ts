// The default size of an imported picture or video (Fit, Fill or Original), kept in this browser.
import { scaleFor, type SizeMode } from '../engine/fit-ops';

const KEY = 'fm.importSize';

export function importSize(): SizeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'fit' || v === 'fill' || v === 'original') return v;
  } catch { /* storage blocked: the default */ }
  return 'fit';
}

export function setImportSize(mode: SizeMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* not kept */ }
}

/** Scale an import gets for a picture of `w` x `h` in a `mw` x `mh` movie. */
export function importScale(mw: number, mh: number, w: number, h: number): number {
  return scaleFor(importSize(), mw, mh, w, h);
}
