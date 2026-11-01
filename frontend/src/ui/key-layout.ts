/** The keyboard layout the Keyboard Shortcuts page names keys by (FV-241). A binding is a physical key ("KeyQ" is the
 *  key where a US keyboard has Q), so the commands never move; only the label drawn on the keycap follows the layout.
 *  Auto asks the browser for the real layout when it can (navigator.keyboard), else shows the US letters. */
export type KeyLayout = 'auto' | 'qwerty' | 'azerty' | 'qwertz' | 'dvorak' | 'colemak';
export const KEY_LAYOUTS: ReadonlyArray<readonly [KeyLayout, string]> = [['auto', 'Auto'], ['qwerty', 'QWERTY'], ['azerty', 'AZERTY'], ['qwertz', 'QWERTZ'], ['dvorak', 'Dvorak'], ['colemak', 'Colemak']];

/** Physical letter (as a US keyboard prints it) to the character that key prints on the layout. */
const MAPS: Record<Exclude<KeyLayout, 'auto' | 'qwerty'>, Record<string, string>> = {
  azerty: { Q: 'A', W: 'Z', A: 'Q', Z: 'W', M: ',' },
  qwertz: { Y: 'Z', Z: 'Y' },
  dvorak: { Q: "'", W: ',', E: '.', R: 'P', T: 'Y', Y: 'F', U: 'G', I: 'C', O: 'R', P: 'L', S: 'O', D: 'E', F: 'U', G: 'I', H: 'D', J: 'H', K: 'T', L: 'N', Z: ';', X: 'Q', C: 'J', V: 'K', B: 'X', N: 'B' },
  colemak: { E: 'F', R: 'P', T: 'G', Y: 'J', U: 'L', I: 'U', O: 'Y', P: ';', S: 'R', D: 'S', F: 'T', G: 'D', J: 'N', K: 'E', L: 'I', N: 'K' },
};

const KEY = 'formmorpheus.keyLayout';
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const GLYPHS: Record<string, string> = { Mod: isMac ? '⌘' : 'Ctrl', Alt: isMac ? '⌥' : 'Alt', Shift: isMac ? '⇧' : 'Shift', Ctrl: isMac ? '⌃' : 'Ctrl' };

let layout: KeyLayout = (() => { try { const v = localStorage.getItem(KEY); return KEY_LAYOUTS.some(([k]) => k === v) ? (v as KeyLayout) : 'auto'; } catch { return 'auto'; } })();
/** What the browser reports for each physical letter, once it has answered. */
let detected: Map<string, string> | null = null;
let asked = false;

export const getKeyLayout = (): KeyLayout => layout;

export function setKeyLayout(v: KeyLayout): void {
  layout = v;
  try { localStorage.setItem(KEY, v); } catch { /* this session only */ }
  document.dispatchEvent(new CustomEvent('fm:key-layout'));
}

/** Asks the browser for the real layout once; the page repaints its keycaps when the answer comes. */
export function detectKeyLayout(): void {
  if (asked) return;
  asked = true;
  const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  if (!kb?.getLayoutMap) return;
  void kb.getLayoutMap().then((m) => { detected = m; document.dispatchEvent(new CustomEvent('fm:key-layout')); }).catch(() => undefined);
}

function letter(ch: string): string {
  if (!/^[A-Z]$/.test(ch)) return ch;
  if (layout === 'auto') return detected?.get(`Key${ch}`)?.toUpperCase() ?? ch;
  if (layout === 'qwerty') return ch;
  return MAPS[layout][ch] ?? ch;
}

/** The keycaps of a combo, in order: "Alt+Shift+Mod+S" is Alt, Shift, Ctrl (or the Command glyph), S. A combo ending in '++' ends with the plus key. */
export function capsOf(combo: string): string[] {
  const parts = combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), '+'] : combo.split('+');
  // the command key first, then Alt (Option), then Shift: the order people read a shortcut in
  const rank = (p: string): number => (p === 'Mod' || p === 'Ctrl' ? 0 : p === 'Alt' ? 1 : p === 'Shift' ? 2 : 3);
  const mods = parts.slice(0, -1).sort((a, b) => rank(a) - rank(b)).map((p) => GLYPHS[p] ?? p);
  return [...mods, letter(parts[parts.length - 1])];
}
