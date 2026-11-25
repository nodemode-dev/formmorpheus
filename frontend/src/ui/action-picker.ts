// The action picker: the character's own actions, then the starter actions. One card, built once; rows for the
// character's own actions come from a pool and are relabelled in place each time it opens.
import { BUILTIN_ACTIONS } from '../engine/actions-builtin';
import type { CharacterInfo } from '../engine/types';
import { el, q, setHidden, setText } from './dom';
import { t } from './i18n';
import { Popover, popRow, popSep, type PopRow } from './popover';

export type PickMode = 'apply' | 'swap' | 'export' | 'delete';

const TITLES: Record<PickMode, string> = { apply: 'Apply Action', swap: 'Swap Action', export: 'Export Action', delete: 'Delete Action' };

interface Slot { row: PopRow; id: string }

export class ActionPicker {
  private readonly pop = new Popover('fm-act-pick', 260);
  private readonly title = el<HTMLElement>('<div class="fm-pop-row fm-pop-note"><span class="fm-pop-label"></span></div>');
  private readonly none = el<HTMLElement>('<div class="fm-pop-row fm-pop-note"><span class="fm-pop-label">No actions of its own yet</span></div>');
  private readonly starterSep = popSep();
  private readonly starterHead = el<HTMLElement>('<div class="fm-pop-row fm-pop-note"><span class="fm-pop-label">Starter actions</span></div>');
  private readonly own: Slot[] = [];
  private readonly starters: Slot[] = [];
  private readonly clearSep = popSep();
  private readonly clearRow = popRow(null, 'Clear Action', { danger: true });
  private pick: ((id: string) => void) | null = null;
  private clear: (() => void) | null = null;

  constructor() {
    this.pop.el.setAttribute('role', 'menu');
    this.pop.body.append(this.title, this.none, this.starterSep, this.starterHead);
    for (const a of BUILTIN_ACTIONS) {
      const slot: Slot = { row: popRow(null, a.name, { check: true }), id: a.id };
      if (a.loop) slot.row.setValue('Loop');
      slot.row.el.addEventListener('click', () => this.choose(slot.id));
      this.starters.push(slot);
      this.pop.body.appendChild(slot.row.el);
    }
    this.clearRow.el.addEventListener('click', () => { const fn = this.clear; this.pop.hide(); fn?.(); });
    this.pop.body.append(this.clearSep, this.clearRow.el);
  }

  get isOpen(): boolean { return this.pop.isOpen; }

  /** Opens at (x, y) for `ch`; `current` is checked; `clear` adds Clear Action (a placed span). */
  open(x: number, y: number, ch: CharacterInfo, mode: PickMode, current: string | null, pick: (id: string) => void, clear?: () => void): void {
    this.pick = pick;
    this.clear = clear ?? null;
    setText(q(this.title, '.fm-pop-label'), TITLES[mode]);
    const list = ch.actions;
    while (this.own.length < list.length) {
      const slot: Slot = { row: popRow(null, '', { check: true }), id: '' };
      // the person's own names are never translated
      slot.row.el.setAttribute('data-no-i18n', '');
      slot.row.el.addEventListener('click', () => this.choose(slot.id));
      this.own.push(slot);
      this.pop.body.insertBefore(slot.row.el, this.starterSep);
    }
    this.own.forEach((slot, i) => {
      const a = list[i];
      setHidden(slot.row.el, !a);
      if (!a) return;
      slot.id = a.id;
      slot.row.setLabel(a.name);
      slot.row.setValue(a.loop ? t('Loop') : '');
      slot.row.setChecked(a.id === current);
    });
    setHidden(this.none, list.length > 0);
    const starters = mode !== 'delete';
    setHidden(this.starterSep, !starters);
    setHidden(this.starterHead, !starters);
    for (const s of this.starters) { setHidden(s.row.el, !starters); s.row.setChecked(s.id === current); }
    setHidden(this.clearSep, !clear);
    setHidden(this.clearRow.el, !clear);
    this.pop.showAt(x, y);
  }

  hide(): void { this.pop.hide(); }

  private choose(id: string): void {
    const fn = this.pick;
    this.pop.hide();
    if (id) fn?.(id);
  }
}
