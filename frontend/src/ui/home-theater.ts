import { api, type LibraryStack } from '../io/api';
import { el, q, setClass, setDisabled, setHidden, setText } from './dom';
import { confirmAction, promptName } from './dialogs';
import { icon } from './icons';
import { Popover, popRow, popSep, type PopRow } from './popover';
import { toast } from './toast';
import '../styles/theater.css';

/** Theater management on Home's Movies page: Select mode (several movies at once), a context menu per movie
 *  (Open, Rename, Duplicate, Share / Export, Delete), and stacks: one flat level of folders made by dragging a
 *  movie onto another or by Select > Stack. The movies stay where they are; the engine keeps the stack list. */
export interface TheaterHost {
  /** Re-reads the library and the stacks and patches the grid. */
  refresh(): Promise<void>;
  /** Re-filters and patches the grid from what was read. */
  render(): void;
  open(name: string): void;
  isOpen(name: string): boolean;
  forget(name: string): void;
}

export interface Target { movie?: string; stack?: string }

export const keyOf = (t: Target): string => (t.stack ? `stk:${t.stack}` : `lib:${t.movie}`);

const MENU_ICONS = { open: 'folderOpen', rename: 'tPencil', dup: 'duplicate', share: 'upload', out: 'chevronLeft', ungroup: 'folderOpen', select: 'check', del: 'delete' } as const;

export class TheaterTools {
  stacks: LibraryStack[] = [];
  current: string | null = null;
  selecting = false;
  readonly selected = new Set<string>();
  /** The last pointer position that opened a menu through touch, so the click that follows is ignored. */
  suppressClick = false;

  private readonly wrap = el(`<div class="cv-th">
    <button class="cv-th-back" type="button" hidden>${icon('chevronLeft', 14)}<span class="cv-th-stackname"></span></button>
    <button class="cv-th-select" type="button" aria-pressed="false">${icon('check', 14)}<span>Select</span></button>
    <div class="cv-th-actions" hidden>
      <span class="cv-th-count"></span>
      <button class="cv-th-act" type="button" data-act="stack">${icon('folder', 14)}<span>Stack</span></button>
      <button class="cv-th-act" type="button" data-act="dup">${icon('duplicate', 14)}<span>Duplicate</span></button>
      <button class="cv-th-act is-danger" type="button" data-act="del">${icon('delete', 14)}<span>Delete</span></button>
    </div>
  </div>`);
  private readonly back = q<HTMLButtonElement>(this.wrap, '.cv-th-back');
  private readonly selBtn = q<HTMLButtonElement>(this.wrap, '.cv-th-select');
  private readonly actions = q(this.wrap, '.cv-th-actions');
  private readonly menu = new Popover('cv-th-menu', 200);
  private readonly rows: Record<keyof typeof MENU_ICONS, PopRow>;
  private target: Target = {};

  constructor(private readonly h: TheaterHost, bar: HTMLElement) {
    const before = bar.querySelector('.cv-hf-filter');
    bar.insertBefore(this.wrap, before);
    this.selBtn.addEventListener('click', () => this.setSelecting(!this.selecting));
    this.back.addEventListener('click', () => this.enter(null));
    this.back.addEventListener('dragover', (e) => { if (this.current) e.preventDefault(); });
    this.back.addEventListener('drop', (e) => {
      e.preventDefault();
      const k = e.dataTransfer?.getData('text/plain') ?? '';
      if (this.current && k.startsWith('lib:')) void this.moveOut([k.slice(4)]);
    });
    this.actions.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      const names = this.selectedMovies();
      if (b.dataset.act === 'stack') void this.stackThem(names);
      else if (b.dataset.act === 'dup') void this.duplicate(names);
      else void this.trashSelection();
    });
    const mk = (id: keyof typeof MENU_ICONS, label: string, danger = false): PopRow => {
      const r = popRow(MENU_ICONS[id], label, { danger });
      r.el.addEventListener('click', () => { this.menu.hide(); void this.run(id); });
      return r;
    };
    this.rows = { open: mk('open', 'Open'), rename: mk('rename', 'Rename'), dup: mk('dup', 'Duplicate'), share: mk('share', 'Share / Export'),
      out: mk('out', 'Remove from stack'), ungroup: mk('ungroup', 'Ungroup'), select: mk('select', 'Select'), del: mk('del', 'Delete', true) };
    this.menu.body.append(this.rows.open.el, this.rows.rename.el, this.rows.dup.el, this.rows.share.el, this.rows.out.el, this.rows.ungroup.el, popSep(), this.rows.select.el, popSep(), this.rows.del.el);
    this.paint();
  }

  async load(): Promise<void> {
    this.stacks = await api.stacks();
    if (this.current && !this.stacks.some((s) => s.id === this.current)) this.current = null;
  }

  stackOf(name: string): LibraryStack | undefined {
    return this.stacks.find((s) => s.items.includes(name));
  }

  stackById(id: string): LibraryStack | undefined {
    return this.stacks.find((s) => s.id === id);
  }

  /** True when the movie shows in the current view: at the top when it is in no stack, or inside its open stack. */
  visible(name: string): boolean {
    const s = this.stackOf(name);
    return this.current ? s?.id === this.current : !s;
  }

  enter(id: string | null): void {
    this.current = id;
    this.selected.clear();
    this.paint();
    this.h.render();
  }

  setSelecting(on: boolean): void {
    this.selecting = on;
    if (!on) this.selected.clear();
    this.paint();
    this.h.render();
  }

  toggle(key: string): void {
    if (this.selected.has(key)) this.selected.delete(key); else this.selected.add(key);
    this.paint();
    this.h.render();
  }

  private selectedMovies(): string[] {
    return [...this.selected].filter((k) => k.startsWith('lib:')).map((k) => k.slice(4));
  }

  /** Toolbar state: attribute and text writes only. */
  paint(): void {
    const st = this.current ? this.stackById(this.current) : undefined;
    setHidden(this.back, !st);
    setText(q(this.back, '.cv-th-stackname'), st?.name ?? '');
    setClass(this.selBtn, 'is-active', this.selecting);
    this.selBtn.setAttribute('aria-pressed', String(this.selecting));
    setHidden(this.actions, !this.selecting);
    const n = this.selected.size;
    setText(q(this.actions, '.cv-th-count'), n === 1 ? '1 selected' : `${n} selected`);
    const movies = this.selectedMovies().length;
    for (const b of Array.from(this.actions.querySelectorAll<HTMLButtonElement>('[data-act]'))) {
      setDisabled(b, b.dataset.act === 'del' ? n === 0 : movies === 0);
    }
  }

  // ---------------------------------------------------------------- context menu

  show(t: Target, x: number, y: number): void {
    this.target = t;
    const stack = !!t.stack;
    const inStack = !!t.movie && !!this.stackOf(t.movie);
    setHidden(this.rows.share.el, stack);
    setHidden(this.rows.dup.el, stack);
    setHidden(this.rows.out.el, !inStack);
    setHidden(this.rows.ungroup.el, !stack);
    this.rows.del.setLabel(stack ? 'Delete stack' : 'Delete');
    this.rows.select.setLabel(this.selecting ? 'Done selecting' : 'Select');
    this.menu.showAt(x, y);
  }

  private async run(id: keyof typeof MENU_ICONS): Promise<void> {
    const t = this.target;
    try {
      if (id === 'open') { if (t.stack) this.enter(t.stack); else if (t.movie) this.h.open(t.movie); }
      else if (id === 'select') { this.setSelecting(!this.selecting); }
      else if (id === 'rename') await (t.stack ? this.renameStack(t.stack) : this.rename(t.movie ?? ''));
      else if (id === 'dup' && t.movie) await this.duplicate([t.movie]);
      else if (id === 'share' && t.movie) await this.share(t.movie);
      else if (id === 'out' && t.movie) await this.moveOut([t.movie]);
      else if (id === 'ungroup' && t.stack) await this.ungroup(t.stack);
      else if (id === 'del') {
        if (t.stack) await this.ungroup(t.stack);
        else if (t.movie) await this.trash([t.movie]);
      }
    } catch (err) { toast((err as Error).message, 'error'); }
  }

  // ---------------------------------------------------------------- actions

  async rename(name: string): Promise<void> {
    if (this.h.isOpen(name)) { toast('Close the movie before renaming it.', 'error'); return; }
    const to = await promptName('Rename movie', name, 'Rename');
    if (!to || to === name) return;
    await api.renameMovie(name, to);
    this.h.forget(name);
    await this.h.refresh();
  }

  async renameStack(id: string): Promise<void> {
    const to = await promptName('Rename stack', this.stackById(id)?.name ?? 'Stack', 'Rename');
    if (!to) return;
    await api.updateStack(id, { name: to });
    await this.h.refresh();
  }

  async duplicate(names: string[]): Promise<void> {
    for (const n of names) await api.duplicateMovie(n);
    if (names.length) toast(names.length === 1 ? 'Movie duplicated.' : `${names.length} movies duplicated.`);
    await this.h.refresh();
  }

  async share(name: string): Promise<void> {
    const blob = await api.readMovie(name);
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `${name}.fmo`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async trash(names: string[]): Promise<void> {
    const open = names.find((n) => this.h.isOpen(n));
    if (open) { toast('Close the movie before deleting it.', 'error'); return; }
    const label = names.length === 1 ? `"${names[0]}"` : `${names.length} movies`;
    if (!(await confirmAction('Delete?', `${label} moves to Recently Deleted, where it stays for 30 days.`, 'Delete', true))) return;
    for (const n of names) { await api.deleteMovie(n); this.h.forget(n); }
    this.selected.clear();
    this.paint();
    await this.h.refresh();
  }

  private async trashSelection(): Promise<void> {
    const stacks = [...this.selected].filter((k) => k.startsWith('stk:')).map((k) => k.slice(4));
    const movies = this.selectedMovies();
    try {
      if (movies.length) await this.trash(movies);
      for (const s of stacks) await api.ungroupStack(s);
      if (stacks.length) { this.selected.clear(); this.paint(); await this.h.refresh(); }
    } catch (err) { toast((err as Error).message, 'error'); }
  }

  async stackThem(names: string[]): Promise<void> {
    if (!names.length) return;
    try {
      await api.createStack(names);
      this.selected.clear();
      this.setSelecting(false);
      await this.h.refresh();
    } catch (err) { toast((err as Error).message, 'error'); }
  }

  async ungroup(id: string): Promise<void> {
    await api.ungroupStack(id);
    if (this.current === id) this.current = null;
    this.selected.clear();
    this.paint();
    await this.h.refresh();
  }

  async moveOut(names: string[]): Promise<void> {
    const s = this.stackOf(names[0]);
    if (!s) return;
    try {
      await api.updateStack(s.id, { items: s.items.filter((i) => !names.includes(i)) });
      if (this.current === s.id && s.items.every((i) => names.includes(i))) this.current = null;
      await this.h.refresh();
    } catch (err) { toast((err as Error).message, 'error'); }
  }

  /** A movie dragged onto another movie makes a stack of both; onto a stack it joins it. */
  async dropOn(draggedKey: string, over: Target): Promise<void> {
    if (!draggedKey.startsWith('lib:')) return;
    const names = this.selecting && this.selected.has(draggedKey) ? this.selectedMovies() : [draggedKey.slice(4)];
    try {
      if (over.stack) {
        const s = this.stackById(over.stack);
        if (!s) return;
        await api.updateStack(s.id, { items: [...s.items, ...names.filter((n) => !s.items.includes(n))] });
      } else if (over.movie && !names.includes(over.movie)) {
        await api.createStack([over.movie, ...names]);
      } else return;
      this.selected.clear();
      this.paint();
      await this.h.refresh();
    } catch (err) { toast((err as Error).message, 'error'); }
  }
}
