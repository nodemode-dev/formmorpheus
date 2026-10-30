// Pen button play: the pen's barrel or eraser button toggles playback (the desktop stand-in for a squeeze), when the
// Preferences row is on. The press is swallowed so it does not also open a context menu.
import { loadPrefs } from './prefs';

let armed = false;

export function installPenPlay(): void {
  if (armed) return;
  armed = true;
  let swallow = 0;
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'pen' || !e.isTrusted) return;
    const button = e.button === 5 || (e.button === 2 && (e.buttons & 2) !== 0);
    if (!button || !loadPrefs().penPlay) return;
    swallow = e.timeStamp;
    e.preventDefault();
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent('fm:command', { detail: 'play' }));
  }, true);
  document.addEventListener('contextmenu', (e) => {
    if (swallow && e.timeStamp - swallow < 600) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}
