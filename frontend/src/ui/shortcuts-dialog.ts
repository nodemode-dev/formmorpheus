// Keyboard Shortcuts: every command with its keys; search, add a key by pressing it, remove, reset one or all.
// A key already taken is moved to the command being edited and the status line says whose it was.
import { canonCombo, comboOf, formatKeys, type Command, type Commands } from './commands';
import { Dialog, confirmAction } from './dialogs';
import { el, patchList, q, setClass, setHidden, setText, setTitle } from './dom';
import { icon } from './icons';
import { t } from './i18n';
import { KEY_LAYOUTS, capsOf, detectKeyLayout, getKeyLayout, setKeyLayout, type KeyLayout } from './key-layout';
import '../styles/shortcuts.css';

interface Row { id: string; label: string; group: string; keys: string[]; changed: boolean }

export class ShortcutsDialog extends Dialog {
  private readonly list = el('<div class="fm-sc-list" role="list"></div>');
  private readonly search = el<HTMLInputElement>('<input class="cv-input fm-sc-search" type="text" placeholder="Search commands or keys" spellcheck="false" aria-label="Search commands or keys">');
  private readonly status = el('<div class="fm-sc-status" aria-live="polite"></div>');
  private readonly empty = el('<p class="cv-note fm-sc-empty" hidden>No command matches.</p>');
  private recording: string | null = null;
  private rows: Row[] = [];

  /** `groupOf` names the menu a command sits in; `changed` is called after every edit so the app can keep the bindings. */
  constructor(private readonly commands: Commands, private readonly groupOf: (id: string) => string, private readonly changed: () => void) {
    super('Keyboard Shortcuts', 640);
    // the layout card (FV-241): keycaps are drawn for this layout; the commands stay on the same physical keys
    const card = el('<div class="fm-sc-layout"><label class="fm-sc-layout-row"><span>Keyboard layout</span><select class="cv-input" aria-label="Keyboard layout"></select></label><p class="fm-sc-layout-note">Keycaps show the letters of this layout. A shortcut belongs to a physical key, so it does not move when the layout changes.</p></div>');
    const pickLayout = q<HTMLSelectElement>(card, 'select');
    for (const [id, label] of KEY_LAYOUTS) { const o = el<HTMLOptionElement>('<option></option>'); o.value = id; o.textContent = t(label); pickLayout.appendChild(o); }
    pickLayout.value = getKeyLayout();
    pickLayout.addEventListener('change', () => setKeyLayout(pickLayout.value as KeyLayout));
    document.addEventListener('fm:key-layout', () => { pickLayout.value = getKeyLayout(); if (this.isOpen) this.render(); });
    this.body.append(card, this.search, el('<div class="fm-sc-head"><span>Command</span><span>Keys</span><span></span></div>'), this.list, this.empty, this.status);
    this.search.addEventListener('input', () => this.render());
    this.list.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const id = target.closest<HTMLElement>('.fm-sc-row')?.dataset.key;
      if (!id) return;
      const rm = target.closest<HTMLElement>('[data-rm]');
      if (rm) { this.set(id, this.keysOf(id).filter((k) => k !== rm.dataset.rm)); return; }
      if (target.closest('[data-rec]')) { this.record(this.recording === id ? null : id); return; }
      if (target.closest('[data-reset]')) this.set(id, this.commands.defaultKeys(id));
    });
    this.scrim.addEventListener('keydown', (e) => this.keydown(e), true);
    this.button('Reset All', 'ghost', () => { void this.resetAll(); });
    this.button('Done', 'primary', () => this.close());
    this.onClose = () => this.record(null);
  }

  show(): void {
    detectKeyLayout();
    this.search.value = '';
    setText(this.status, '');
    this.render();
    this.open(this.search);
  }

  private cmds(): Command[] {
    return this.commands.all().filter((c) => !c.id.startsWith('recent:'));
  }

  private keysOf(id: string): string[] { return [...(this.commands.get(id)?.keys ?? [])]; }

  private set(id: string, keys: string[]): void {
    const moved: string[] = [];
    for (const k of keys) {
      const owner = this.commands.forCombo(k);
      if (owner && owner.id !== id) moved.push(`${formatKeys(k)} ${t('moved from')} ${this.commands.label(owner)}`);
    }
    this.commands.setKeys(id, keys);
    this.changed();
    this.render();
    setText(this.status, moved.join('; '));
  }

  private record(id: string | null): void {
    this.recording = id;
    for (const n of Array.from(this.list.children) as HTMLElement[]) setClass(n, 'is-recording', n.dataset.key === id);
    if (id) {
      const c = this.commands.get(id);
      setText(this.status, `${t('Press the keys for')} ${c ? this.commands.label(c) : ''} (${t('Esc cancels')})`);
    }
  }

  private keydown(e: KeyboardEvent): void {
    if (!this.recording) return;
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'CapsLock') return;
    e.preventDefault();
    e.stopPropagation();
    const id = this.recording;
    if (e.key === 'Escape' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) { this.record(null); setText(this.status, ''); return; }
    const combo = canonCombo(comboOf(e));
    this.record(null);
    const have = this.keysOf(id);
    if (!have.includes(combo)) this.set(id, [...have, combo]);
    else setText(this.status, '');
  }

  private async resetAll(): Promise<void> {
    if (!(await confirmAction('Reset Keyboard Shortcuts', 'Set every command back to its default keys?', 'Reset', true))) return;
    this.commands.resetKeys();
    this.changed();
    this.render();
    setText(this.status, t('Every command is back to its default keys.'));
  }

  private render(): void {
    const words = this.search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const all: Row[] = this.cmds().map((c) => {
      const keys = c.keys ?? [], d = this.commands.defaultKeys(c.id);
      return { id: c.id, label: this.commands.label(c).replace(/\.\.\.$/, ''), group: this.groupOf(c.id), keys: [...keys], changed: keys.join('|') !== d.join('|') };
    });
    this.rows = all.filter((r) => !words.length || words.every((w) => `${r.label} ${r.group} ${r.keys.map(formatKeys).join(' ')}`.toLowerCase().includes(w)));
    const fillRow = (n: HTMLElement, r: Row): void => {
      setText(q(n, '.fm-sc-label'), r.label);
      setText(q(n, '.fm-sc-group'), r.group);
      patchList(q(n, '.fm-sc-keys'), r.keys, {
        key: (k) => k,
        create: (k) => { const c = el(`<span class="fm-sc-chip"><span class="fm-sc-caps"></span><button type="button" title="Remove this key" aria-label="Remove this key">${icon('close', 10)}</button></span>`); fillChip(c, k); return c; },
        update: fillChip,
      });
      setClass(n, 'is-changed', r.changed);
      setClass(n, 'is-recording', this.recording === r.id);
      const reset = q<HTMLButtonElement>(n, '[data-reset]');
      setTitle(reset, r.changed ? t('Back to the default keys') : t('Already the default'));
      if (reset.disabled !== !r.changed) reset.disabled = !r.changed;
    };
    // one keycap per key; the caps are patched in place when the layout changes
    const fillChip = (c: HTMLElement, k: string): void => {
      patchList(q(c, '.fm-sc-caps'), capsOf(k).map((text, at) => ({ text, at })), {
        key: (x) => String(x.at),
        create: (x) => { const kb = el<HTMLElement>('<kbd class="fm-sc-cap"></kbd>'); kb.textContent = x.text; return kb; },
        update: (n, x) => { if (n.textContent !== x.text) n.textContent = x.text; },
      });
      c.title = formatKeys(k);
      (c.lastElementChild as HTMLElement).dataset.rm = k;
    };
    patchList(this.list, this.rows, {
      key: (r) => r.id,
      create: (r) => { const n = el(`<div class="fm-sc-row" role="listitem"><span class="fm-sc-name"><span class="fm-sc-label"></span><span class="fm-sc-group"></span></span><span class="fm-sc-keys"></span><span class="fm-sc-acts"><button class="cv-icon-btn" type="button" data-rec title="Add a key: press the keys">${icon('plus', 13)}</button><button class="cv-icon-btn" type="button" data-reset title="Back to the default keys">${icon('undo', 13)}</button></span></div>`); fillRow(n, r); return n; },
      update: fillRow,
    });
    setHidden(this.empty, this.rows.length > 0);
  }
}
