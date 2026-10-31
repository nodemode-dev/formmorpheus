/** Creating a Drawing or a Flipbook leaves the person on the Timeline with the new block selected and its Edit pill
 *  showing (FV-202). This per-viewer choice brings back the earlier behaviour: go straight into Draw & Paint. */
const KEY = 'formmorpheus.openPaintOnCreate';

export function openPaintOnCreate(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setOpenPaintOnCreate(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* the choice lasts until the page closes */ }
}
