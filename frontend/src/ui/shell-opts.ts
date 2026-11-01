import type { Command } from './commands';
import '../styles/chrome-options.css';

/** Two per-viewer shell choices kept beside the preferences: the Theater layout (G06) and the desktop chrome (FV-231).
 *  They are conveniences of one window, so they live in this window's storage, not in the movie or the shared prefs. */
export type TheaterLayout = 'gallery' | 'library';
export const THEATER_LAYOUTS: ReadonlyArray<readonly [TheaterLayout, string]> = [['gallery', 'Gallery'], ['library', 'Library']];

const LAYOUT_KEY = 'formmorpheus.theaterLayout';
const MENU_KEY = 'formmorpheus.hideMenuBar';
const STATUS_KEY = 'formmorpheus.hideStatusBar';

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* this session only */ } };

let layout: TheaterLayout = read(LAYOUT_KEY) === 'library' ? 'library' : 'gallery';

export function theaterLayout(): TheaterLayout { return layout; }

export function setTheaterLayout(v: TheaterLayout): void {
  if (v === layout) return;
  layout = v;
  write(LAYOUT_KEY, v);
  document.dispatchEvent(new CustomEvent('fm:theater-layout'));
}

/** The desktop window keeps its own title bar (traffic lights), so only the in-window menu bar can be put away. */
const canHideMenu = (): boolean => !document.documentElement.classList.contains('has-overlay-titlebar');

let menuHidden = read(MENU_KEY) === '1';
let statusHidden = read(STATUS_KEY) === '1';

function apply(): void {
  document.body.classList.toggle('fm-hide-menu', menuHidden && canHideMenu());
  document.body.classList.toggle('fm-hide-status', statusHidden);
  // the shell lays itself out again at its new height
  window.dispatchEvent(new Event('resize'));
}

/** View > Hide Menu Bar and Hide Status Bar: the bar slides away and comes back while the pointer rests on the screen edge. */
export function chromeCommands(): Command[] {
  apply();
  return [
    { id: 'chrome-hide-menu', label: 'Hide Menu Bar', enabled: canHideMenu, checked: () => menuHidden && canHideMenu(), run: () => { menuHidden = !menuHidden; write(MENU_KEY, menuHidden ? '1' : '0'); apply(); } },
    { id: 'chrome-hide-status', label: 'Hide Status Bar', checked: () => statusHidden, run: () => { statusHidden = !statusHidden; write(STATUS_KEY, statusHidden ? '1' : '0'); apply(); } },
  ];
}
