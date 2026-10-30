// The Parent row of the content options menu: a submenu listing every content a block may follow. Rows are
// made once and relabelled in place each time the menu opens. A choice that would loop is refused with a message.
import type { Engine } from '../engine/engine';
import { unparent, setParent } from '../engine/parenting';
import { allContents } from '../engine/transform';
import { setClass, setHidden } from './dom';
import { Popover, popRow, popSep, type PopRow } from './popover';

export class ParentPicker {
  readonly row: PopRow = popRow(null, 'Parent', { sub: true });
  private readonly panel: HTMLElement;
  private readonly none: PopRow;
  private readonly pool: { row: PopRow; id: string }[] = [];
  private childId: string | null = null;

  constructor(private readonly engine: Engine, private readonly host: Popover) {
    this.panel = Popover.panel('fm-pop fm-cm-sub fm-cm-parent fm-pop-sub');
    this.none = popRow(null, 'None', { check: true });
    this.none.el.addEventListener('click', () => this.choose(null));
    this.panel.append(this.none.el, popSep());
    host.attachSub(this.row.el, this.panel, () => this.fill());
  }

  /** Enables the row for a single selected content. */
  patch(ids: string[]): void {
    this.childId = ids.length === 1 ? ids[0] : null;
    this.row.setDisabled(!this.childId);
    const m = this.engine.movie, c = this.childId && m ? this.engine.selected[0] : null;
    const p = c?.parent && m ? allContents(m).find((x) => x.c.id === c.parent)?.c : null;
    this.row.setValue(p ? p.name : '');
  }

  private fill(): void {
    const m = this.engine.movie, id = this.childId;
    if (!m || !id) return;
    const child = this.engine.selected[0];
    const list = allContents(m).filter((x) => x.c.id !== id);
    while (this.pool.length < list.length) {
      const row = popRow(null, '', { check: true });
      const slot = { row, id: '' };
      row.el.addEventListener('click', () => this.choose(slot.id));
      this.pool.push(slot);
      this.panel.appendChild(row.el);
    }
    this.pool.forEach((slot, i) => {
      const x = list[i];
      setHidden(slot.row.el, !x);
      if (!x) return;
      slot.id = x.c.id;
      slot.row.setLabel(`${'  '.repeat(x.depth)}${x.c.name}`);
      slot.row.setChecked(child?.parent === x.c.id);
    });
    this.none.setChecked(!child?.parent);
    setClass(this.none.el, 'is-disabled', !child?.parent);
  }

  private choose(parentId: string | null): void {
    const id = this.childId;
    if (!id) return;
    const frame = this.engine.frame;
    if (parentId) this.engine.run('Set Parent', (m) => setParent(m, id, parentId));
    else this.engine.run('Unparent', (m) => unparent(m, id, frame));
    this.host.hide();
  }
}
