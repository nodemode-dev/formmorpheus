// The iPad menu bar and hardware keyboard (phase 59). The page owns the command registry; the shell builds the system
// menu bar from a tree the page sends, and sends back one `command` message per chosen item.
//
//   page to native  menu    { kind: 'tree', rev, menus }   the tree (labels already translated), sent when it changes
//                   menu    { kind: 'text', focused }      a text field has focus (edit keys then go to the field)
//   native to page  command { id, source: 'native' }       a menu item was chosen, or its key was pressed
//                   menuReady { rev }                      the system menu bar was rebuilt from tree `rev`
//
// Keys: the system takes only combos that hold the command key (or a function key), because a plain key such as Space
// or a letter would be stolen from text fields. Once a tree is built the page stops listening to the real key events of
// exactly those combos; a chosen command whose key is one of them is replayed here as one synthetic keydown, so every
// handler the page already has (Draw & Paint, the Timeline, dialogs) sees it as before. Until the shell says
// `menuReady` nothing is swallowed, so a missing or late menu never costs a shortcut.
import { canonCombo, comboOf, type Commands } from '../ui/commands';
import { isMac } from '../ui/dom';
import { onLanguage, t } from '../ui/i18n';
import { trimMenu, type MenuDef, type MenuItem } from '../ui/menu';
import { textFieldFocused } from '../ui/native-menu';
import { platform } from './index';

interface KeyDef { name: string; mods: string[] }
interface TreeItem { sep?: true; id?: string; label?: string; enabled?: boolean; checked?: boolean; key?: KeyDef; items?: TreeItem[] }
interface TreeMenu { id: string; label: string; items: TreeItem[] }

const NAMED = new Set(['Up', 'Down', 'Left', 'Right', 'Escape', 'Backspace', 'Delete', 'Enter']);
const PUNCT = new Set(['[', ']', '=', '-', '/', ',', '.', ';', "'", '\\', '`']);
const TEXT_EDITS = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'select-all']);
const TEXT_COMBOS = new Set(['Mod+Z', 'Mod+Shift+Z', 'Mod+Y', 'Mod+X', 'Mod+C', 'Mod+V', 'Mod+A'].map(canonCombo));

/** The system key of a combo, or null when the combo stays with the page (no command key, a plain key, a reserved key). */
export function nativeKey(combo: string | undefined): KeyDef | null {
  if (!combo || combo.endsWith('++')) return null;
  const parts = canonCombo(combo).split('+');
  const key = parts.pop() ?? '';
  const f = /^F([1-9]|1[0-2])$/.test(key);
  if (!parts.includes('Mod') && !f) return null;
  if (!(f || NAMED.has(key) || /^[A-Z0-9]$/.test(key) || PUNCT.has(key))) return null;
  const mods: string[] = [];
  if (parts.includes('Mod')) mods.push('command');
  if (parts.includes('Shift')) mods.push('shift');
  if (parts.includes('Alt')) mods.push('alt');
  return { name: key, mods };
}

/** The keydown a combo stands for, built so comboOf reads it back as the same combo. */
function syntheticKey(combo: string): KeyboardEvent | null {
  const parts = canonCombo(combo).split('+');
  const key = parts.pop() ?? '';
  const arrows: Record<string, string> = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };
  const codes: Record<string, string> = { '[': 'BracketLeft', ']': 'BracketRight', '=': 'Equal', '-': 'Minus', '/': 'Slash', ',': 'Comma', '.': 'Period', ';': 'Semicolon', "'": 'Quote', '\\': 'Backslash', '`': 'Backquote', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', Enter: 'Enter' };
  let code = '', k = key;
  if (/^[A-Z]$/.test(key)) { code = `Key${key}`; k = parts.includes('Shift') ? key : key.toLowerCase(); }
  else if (/^[0-9]$/.test(key)) code = `Digit${key}`;
  else if (key in arrows) { code = arrows[key]; k = arrows[key]; }
  else if (key in codes) code = codes[key];
  else if (/^F\d+$/.test(key)) code = key;
  else return null;
  const mod = parts.includes('Mod');
  return new KeyboardEvent('keydown', {
    key: k, code, bubbles: true, cancelable: true, composed: true,
    altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift'), metaKey: mod && isMac, ctrlKey: mod && !isMac,
  });
}

let owned = new Set<string>();
const ownedByRev = new Map<number, Set<string>>();
// One key press must run once whether the system, the page or both see it: whichever arrives second is dropped.
const DEDUPE_MS = 300;
const realAt = new Map<string, number>();
const replayAt = new Map<string, number>();

// Registered when the module loads, before the app's own listeners, and only on iPad; a replayed key is not trusted, so it passes.
if (platform.kind === 'ipad') {
  window.addEventListener('keydown', (e) => {
    if (!e.isTrusted) return;
    const combo = comboOf(e);
    const now = performance.now();
    realAt.set(combo, now);
    // the system's copy already ran this key as a replay: this real one is the duplicate
    if (now - (replayAt.get(combo) ?? -1e9) < DEDUPE_MS) { e.stopImmediatePropagation(); e.preventDefault(); return; }
  }, true);
}

export interface IpadMenuOptions {
  commands: Commands;
  menus: () => MenuDef[];
  /** True while Draw & Paint is open: Undo and Redo then belong to its own history and stay enabled. */
  paintOpen: () => boolean;
  /** Subscribes to the app's change events (movie, selection, history, mode, playing, projects, saved). */
  onChange: (fn: () => void) => void;
}

export function installIpadMenu(opts: IpadMenuOptions): void {
  if (platform.kind !== 'ipad' || !platform.bridge.available) return;
  const { commands } = opts;
  let rev = 0, sent = '', timer = 0, textSent = false;
  const ownedNow = new Set<string>();

  const leaf = (id: string): TreeItem | null => {
    const cmd = commands.get(id);
    if (!cmd) return null;
    // the replayed key reaches Draw & Paint's own handler, whose history is not the movie's
    const paintHistory = (id === 'undo' || id === 'redo') && opts.paintOpen();
    const item: TreeItem = { id, label: t(commands.label(cmd)), enabled: paintHistory || commands.enabled(cmd) || (TEXT_EDITS.has(id) && textFieldFocused()) };
    if (cmd.checked) item.checked = !!cmd.checked();
    const first = cmd.keys?.[0];
    const key = nativeKey(first);
    // a disabled item is never fired by the system, so its key must stay with the page: only enabled combos are owned
    if (key && first) { item.key = key; if (item.enabled) ownedNow.add(canonCombo(first)); }
    return item;
  };
  const node = (spec: MenuItem): TreeItem | null => {
    if (spec === '-') return { sep: true };
    if (typeof spec === 'object') {
      const items = spec.items.map(node).filter((x): x is TreeItem => !!x);
      return items.some((x) => !x.sep) ? { label: t(spec.label), items } : null;
    }
    return leaf(spec);
  };
  const tree = (): TreeMenu[] => {
    ownedNow.clear();
    return opts.menus().map((def) => {
      const list = trimMenu(typeof def.items === 'function' ? def.items() : def.items);
      return { id: def.label, label: t(def.label), items: list.map(node).filter((x): x is TreeItem => !!x) };
    });
  };

  const send = (): void => {
    timer = 0;
    const menus = tree();
    const json = JSON.stringify(menus);
    if (json === sent) return;
    sent = json;
    rev += 1;
    ownedByRev.set(rev, new Set(ownedNow));
    if (ownedByRev.size > 8) ownedByRev.delete(ownedByRev.keys().next().value as number);
    platform.bridge.post('menu', { kind: 'tree', rev, menus });
  };
  const soon = (): void => { if (!timer) timer = window.setTimeout(send, 150); };

  const text = (): void => {
    const on = textFieldFocused();
    if (on === textSent) return;
    textSent = on;
    platform.bridge.post('menu', { kind: 'text', focused: on });
    soon();
  };

  platform.bridge.on('menuReady', (p) => {
    const set = ownedByRev.get(Number(p.rev));
    if (set) owned = set;
  });

  platform.bridge.on('command', (p) => {
    const id = typeof p.id === 'string' ? p.id : '';
    const cmd = commands.get(id);
    if (!cmd) return;
    if (TEXT_EDITS.has(id) && textFieldFocused()) {
      // the shell sends the standard edit action to the field itself; this is the fallback when it did not
      document.execCommand(id === 'select-all' ? 'selectAll' : id);
      return;
    }
    // a command whose key the system owns comes back as that key pressed, so every page handler sees it as before
    const inPaint = (id === 'undo' || id === 'redo') && opts.paintOpen();
    if (cmd.keys?.[0] && (inPaint || owned.has(canonCombo(cmd.keys[0])))) {
      // a text field keeps every other key for itself (the real key was not swallowed there)
      if (textFieldFocused() && !TEXT_COMBOS.has(canonCombo(cmd.keys[0]))) return;
      const combo = canonCombo(cmd.keys[0]), now = performance.now();
      // the page already ran this real key a moment ago: the system's copy is the duplicate
      if (now - (realAt.get(combo) ?? -1e9) < DEDUPE_MS) return;
      replayAt.set(combo, now);
      const ev = syntheticKey(cmd.keys[0]);
      if (ev) { (document.activeElement ?? document.body).dispatchEvent(ev); soon(); return; }
    }
    commands.run(id);
    soon();
  });

  for (const ev of ['pointerup', 'keyup'] as const) window.addEventListener(ev, soon, { passive: true });
  for (const ev of ['focusin', 'focusout'] as const) window.addEventListener(ev, () => { window.setTimeout(text, 0); }, { passive: true });
  opts.onChange(soon);
  onLanguage(soon);
  send();
}
