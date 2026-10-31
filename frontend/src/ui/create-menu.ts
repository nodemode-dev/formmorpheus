import { el, q, setClass, setDisabled, setText } from './dom';
import { icon } from './icons';
import type { Commands } from './commands';
import { t } from './i18n';
import { Popover, popRow, popSep, type PopRow } from './popover';

/** A command id, a separator, or a titled group of further items (the same shape the menu bar uses). */
export type CreateItem = string | '-' | { label: string; items: CreateItem[] };

const TILES: Array<{ id: string; icon: string }> = [
  { id: 'add-flipbook', icon: 'flipbook' },
  { id: 'add-drawing', icon: 'drawing' },
  { id: 'add-text', icon: 'text' },
  { id: 'add-track', icon: 'track' },
];
const FILES: Array<{ id: string; icon: string }> = [
  { id: 'import-photo', icon: 'image' },
  { id: 'import-video', icon: 'video' },
  { id: 'import-file', icon: 'upload' },
];

/** The "+" menu as a card: "Add new", four icon tiles, then Photo, Video and File rows, and a More row for the rest.
 *  Built once; each open only patches labels and enabled states. */
export class CreateMenu {
  private readonly pop = new Popover('fm-create', 296);
  private readonly tiles: Array<{ id: string; node: HTMLButtonElement; label: HTMLElement }> = [];
  private readonly rows: Array<{ id: string; row: PopRow }> = [];
  private readonly more: HTMLElement;
  private moreItems: CreateItem[] | null;
  private anchor: HTMLElement | null = null;

  constructor(private readonly commands: Commands, moreItems: CreateItem[]) {
    this.moreItems = null;
    const head = el<HTMLElement>('<div class="fm-cr-title"></div>');
    setText(head, t('Add new'));
    const grid = el<HTMLElement>('<div class="fm-cr-tiles"></div>');
    for (const [i, def] of TILES.entries()) {
      const node = el<HTMLButtonElement>(`<button class="fm-cr-tile" type="button" style="--i:${i}"><span class="fm-cr-glyph">${icon(def.icon, 26)}</span><span class="fm-cr-label"></span></button>`);
      node.addEventListener('click', () => this.run(def.id));
      this.tiles.push({ id: def.id, node, label: q(node, '.fm-cr-label') });
      grid.appendChild(node);
    }
    this.pop.body.append(head, grid);
    for (const def of FILES) {
      const row = popRow(null, def.id);
      row.el.classList.add('fm-cr-row');
      row.el.append(el<HTMLElement>(`<span class="fm-cr-rowicon">${icon(def.icon, 20)}</span>`));
      row.el.addEventListener('click', () => this.run(def.id));
      this.rows.push({ id: def.id, row });
      this.pop.body.appendChild(row.el);
    }
    this.pop.body.appendChild(popSep());
    const moreRow = popRow(null, 'More', { sub: true });
    moreRow.el.classList.add('fm-cr-row');
    setText(q(moreRow.el, '.fm-pop-label'), t('More'));
    // the commands behind these rows are registered after this menu is made, so the rows are built on the first open
    this.more = Popover.panel('fm-pop fm-pop-sub fm-cr-more');
    this.moreItems = moreItems;
    this.pop.attachSub(moreRow.el, this.more);
    this.pop.body.appendChild(moreRow.el);
    this.pop.onHide(() => { if (this.anchor) setClass(this.anchor, 'is-on', false); this.anchor = null; });
  }

  get isOpen(): boolean { return this.pop.isOpen; }

  close(): void { this.pop.hide(); }

  /** Above the "+" button; the button turns solid while the card is open. */
  openFor(anchor: HTMLElement): void {
    this.refresh();
    this.anchor = anchor;
    setClass(anchor, 'is-on', true);
    this.pop.showFor(anchor, 'above');
  }

  /** At a point (the keyboard shortcut opens it mid Stage). */
  openAt(x: number, y: number): void {
    this.refresh();
    this.pop.showAt(x, y);
  }

  private run(id: string): void {
    this.pop.hide();
    this.commands.run(id);
  }

  private label(id: string): string {
    const cmd = this.commands.get(id);
    return cmd ? t(this.commands.label(cmd)).replace(/\.\.\.$/, '') : id;
  }

  private ok(id: string): boolean {
    const cmd = this.commands.get(id);
    return !!cmd && this.commands.enabled(cmd);
  }

  private fill(panel: HTMLElement, items: CreateItem[]): void {
    for (const item of items) {
      if (item === '-') { panel.appendChild(popSep()); continue; }
      if (typeof item === 'object') {
        const row = popRow(null, item.label, { sub: true });
        setText(q(row.el, '.fm-pop-label'), t(item.label));
        const inner = Popover.panel('fm-pop fm-pop-sub fm-cr-more');
        this.fill(inner, item.items);
        this.pop.attachSub(row.el, inner);
        panel.appendChild(row.el);
        continue;
      }
      if (!this.commands.get(item)) continue;
      const row = popRow(null, item, { check: !!this.commands.get(item)?.checked });
      row.el.addEventListener('click', () => this.run(item));
      this.rows.push({ id: item, row });
      panel.appendChild(row.el);
    }
  }

  /** Labels, enabled states and checks, patched in place. */
  private refresh(): void {
    if (this.moreItems) { this.fill(this.more, this.moreItems); this.moreItems = null; }
    for (const tile of this.tiles) {
      setText(tile.label, this.label(tile.id));
      setDisabled(tile.node, !this.ok(tile.id));
    }
    for (const r of this.rows) {
      r.row.setLabel(this.label(r.id));
      r.row.setDisabled(!this.ok(r.id));
      const cmd = this.commands.get(r.id);
      if (cmd?.checked) r.row.setChecked(!!cmd.checked());
    }
  }
}
