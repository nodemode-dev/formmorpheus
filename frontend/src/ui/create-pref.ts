/** Creating a Drawing or a Flipbook goes straight into Draw & Paint, as the Handbook says (v0.17.0 reverses FV-202).
 *  This per-viewer choice turns it off; a stored choice is kept, a missing one means on. */
const KEY = 'formmorpheus.openPaintOnCreate';

export function openPaintOnCreate(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function setOpenPaintOnCreate(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* the choice lasts until the page closes */ }
}
