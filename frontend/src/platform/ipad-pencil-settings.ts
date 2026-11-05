// The Apple Pencil rows of Preferences > Pen and Tablet. Built once with the page; null on the desktop, so nothing is
// added there. Finger painting is the existing preference (its row lives with the gestures), shown here the other
// way round as "Draw with Pencil only".

import { gesturePrefs, setFingerPaints } from '../ui/gestures';
import { checkRow, selectRow } from '../ui/panels/controls';
import { isIpadPencil, onPencilChange, pencilPrefs, setPencilPrefs, type PencilAction } from './ipad-pencil';

const ACTIONS: ReadonlyArray<readonly [string, string]> = [
  ['system', 'Follow system setting'], ['color', 'Show color picker'], ['eraser', 'Switch to eraser'],
  ['undo', 'Undo'], ['toggle', 'Toggle brush and eraser'], ['off', 'Off'],
];

export interface PencilRows {
  rows: HTMLElement[];
  /** Fills the rows from the saved choices; call each time Preferences opens. */
  sync(): void;
}

export function pencilRows(): PencilRows | null {
  if (!isIpadPencil()) return null;
  const squeeze = selectRow('Squeeze action', ACTIONS, (v) => setPencilPrefs({ squeeze: v as PencilAction }));
  const tap = selectRow('Double-tap action', ACTIONS, (v) => setPencilPrefs({ tap: v as PencilAction }));
  const only = checkRow('Draw with Pencil only', (v) => setFingerPaints(!v));
  const hover = checkRow('Show the brush outline while the Pencil hovers', (v) => setPencilPrefs({ hoverPreview: v }));
  const sync = (): void => {
    const p = pencilPrefs();
    squeeze.set(p.squeeze);
    tap.set(p.tap);
    hover.set(p.hoverPreview);
    only.set(!gesturePrefs().fingerPaints);
  };
  onPencilChange(sync);
  return { rows: [squeeze.el, tap.el, only.el, hover.el], sync };
}
