import { api, type LibraryStack } from '../io/api';
import { el, q, setClass, setDisabled, setHidden, setText } from './dom';
import { confirmAction, promptName } from './dialogs';
import { icon } from './icons';
import { Popover, popRow, popSep, type PopRow } from './popover';
import { tn } from './i18n';
import { toast } from './toast';
import { shareMovie } from './theater-share';
import '../styles/theater.css';

/** Theater management on Home's Movies page: Select mode (several movies at once), a context menu per movie
 *  (Open, Rename, Duplicate, Share / Export, Delete), a title popup to rename, and stacks: one flat level of real
 *  folders in the library, made by dropping a movie onto another or by Select > Stack. The engine keeps the manual
 *  order in a hidden order file per folder. */
export interface TheaterHost {
  /** Re-reads the library and the stacks and patches the grid. */
  refresh(): Promise<void>;
  /** Re-filters and patches the grid from what was read. */
  render(): void;
  open(name: string): void;
  isOpen(name: string): boolean;
  forget(name: string): void;
  /** The card keys shown now, in order. */
  visibleKeys(): string[];
  /** Turns the sort to Manual (the order the engine keeps for the folder) and re-renders. */
  setManual(): void;
}

export interface Target { movie?: string; stack?: string }
export type DropZone = 'before' | 'after' | 'into';
const OLD_ORDER = 'formmorpheus.theater-order';

export const keyOf = (t: Target): string => (t.stack ? `stk:${t.stack}` : `lib:${t.movie}`);

const MENU_ICONS = { open: 'folderOpen', rename: 'tPencil', dup: 'duplicate', share: 'upload', out: 'chevronLeft', ungroup: 'folderOpen', select: 'check', del: 'delete' } as const;

export class TheaterTools {
  stacks: LibraryStack[] = [];
  /** The manual order the engine keeps, by folder ('' is the top). */
  order: Record<string, string[]> = {};
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
  private readonly title = new Popover('cv-th-title', 260);
  private readonly titleInput = el<HTMLInputElement>('<input class="cv-th-title-input" type="text" maxlength="80" spellcheck="false" aria-label="Name">');
  private titleFor: Target = {};

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
    this.title.body.append(this.titleInput);
    this.titleInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const to = this.titleInput.value.trim(), t = this.titleFor;
      this.title.hide();
      void this.renameTo(t, to).catch((err: Error) => toast(err.message, 'error'));
    });
    this.paint();
  }

  async load(): Promise<void> {
    const data = await api.theater();
    this.stacks = data.stacks;
    this.order = data.order;
    if (this.current && !this.stacks.some((s) => s.id === this.current)) this.current = null;
    await this.adoptOldOrder();
  }

  /** The manual order used to live in this browser only; hand it to the engine once. */
  private async adoptOldOrder(): Promise<void> {
    let old: string[] = [];
    try { const v = JSON.parse(localStorage.getItem(OLD_ORDER) ?? '[]') as unknown; old = Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []; } catch { return; }
    if (!old.length) { try { localStorage.removeItem(OLD_ORDER); } catch { /* nothing to drop */ } return; }
    const has = Object.values(this.order).some((o) => o.length > 0);
    if (!has) {
      const by: Record<string, string[]> = { '': [] };
      for (const k of old) {
        const home = k.startsWith('lib:') ? (this.stackOf(k.slice(4))?.id ?? '') : '';
        (by[home] ??= []).push(k);
      }
      try { for (const [f, keys] of Object.entries(by)) if (keys.length) { await api.saveOrder(f || null, keys); this.order[f] = keys; } } catch { return; }
    }
    try { localStorage.removeItem(OLD_ORDER); } catch { /* it stays; harmless */ }
  }

  orderOf(): string[] {
    return this.order[this.current ?? ''] ?? [];
  }

  async setOrder(keys: string[]): Promise<void> {
    this.order[this.current ?? ''] = keys;
    try { await api.saveOrder(this.current, keys); } catch (err) { toast((err as Error).message, 'error'); }
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

  /** Opens a stack (null is the top). A carried pile keeps the selection. */
  enter(id: string | null, keepSelection = false): void {
    this.current = id;
    if (!keepSelection) this.selected.clear();
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
    setText(q(this.actions, '.cv-th-count'), tn(n, '{n} selected', '{n} selected'));
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
    await this.renameTo({ movie: name }, to);
  }

  async renameStack(id: string): Promise<void> {
    const to = await promptName('Rename stack', this.stackById(id)?.name ?? 'Stack', 'Rename');
    if (!to) return;
    await this.renameTo({ stack: id }, to);
  }

  /** Renames a movie or a stack (a stack is a folder, so its id follows). */
  async renameTo(t: Target, to: string): Promise<void> {
    if (!to) return;
    if (t.movie) {
      if (to === t.movie) return;
      if (this.h.isOpen(t.movie)) { toast('Close the movie before renaming it.', 'error'); return; }
      await api.renameMovie(t.movie, to);
      this.h.forget(t.movie);
    } else if (t.stack) {
      if (to === t.stack) return;
      const id = await api.updateStack(t.stack, { name: to });
      if (this.current === t.stack && id) this.current = id;
    }
    await this.h.refresh();
  }

  /** The title popup: click a card's name to rename it in place. */
  titlePopup(t: Target, anchor: HTMLElement): void {
    this.titleFor = t;
    this.titleInput.value = t.movie ?? this.stackById(t.stack ?? '')?.name ?? '';
    this.title.showFor(anchor, 'below');
    this.titleInput.focus();
    this.titleInput.select();
  }

  async duplicate(names: string[]): Promise<void> {
    for (const n of names) await api.duplicateMovie(n);
    if (names.length) toast(names.length === 1 ? 'Movie duplicated.' : `${names.length} movies duplicated.`);
    await this.h.refresh();
  }

  async share(name: string): Promise<void> {
    await shareMovie(name);
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
      for (const s of stacks) await this.ungroupInPlace(s);
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

  /** Ungroups a stack; its movies take the stack's place in the top order, in their stack order. */
  private async ungroupInPlace(id: string): Promise<void> {
    const s = this.stackById(id);
    const top = [...(this.order[''] ?? [])];
    const at = top.indexOf(`stk:${id}`);
    await api.ungroupStack(id);
    if (!s || at < 0) return;
    const freed = s.items.map((n) => `lib:${n}`);
    top.splice(at, 1, ...freed.filter((k) => !top.includes(k)));
    this.order[''] = top;
    try { await api.saveOrder(null, top); } catch { /* the order falls back to the engine's */ }
  }

  async ungroup(id: string): Promise<void> {
    await this.ungroupInPlace(id);
    if (this.current === id) this.current = null;
    this.selected.clear();
    this.paint();
    await this.h.refresh();
  }

  async moveOut(names: string[]): Promise<void> {
    try {
      await this.takeOut(names);
      await this.h.refresh();
    } catch (err) { toast((err as Error).message, 'error'); }
  }

  /** Moves movies out of whichever stacks hold them, to the top. */
  private async takeOut(names: string[]): Promise<void> {
    const byStack = new Map<string, LibraryStack>();
    for (const n of names) { const s = this.stackOf(n); if (s) byStack.set(s.id, s); }
    for (const s of byStack.values()) {
      await api.updateStack(s.id, { items: s.items.filter((i) => !names.includes(i)) });
      if (this.current === s.id && s.items.every((i) => names.includes(i))) this.current = null;
    }
  }

  /** A carried pile released over the back control goes to the top. */
  async carryOut(keys: string[]): Promise<void> {
    const names = keys.filter((k) => k.startsWith('lib:')).map((k) => k.slice(4));
    this.selected.clear();
    this.paint();
    await this.moveOut(names);
  }

  /** A carried pile released: onto a movie it makes a stack of both, onto a stack it joins, between cards (or on
   *  the grid, `over` null) it is placed there in the folder being shown, and the engine keeps that order. */
  async carryDrop(keys: string[], over: { key: string; zone: DropZone } | null): Promise<void> {
    const names = keys.filter((k) => k.startsWith('lib:')).map((k) => k.slice(4));
    try {
      if (over?.zone === 'into') {
        if (over.key.startsWith('stk:')) {
          const s = this.stackById(over.key.slice(4));
          if (!s || !names.length) return;
          await api.updateStack(s.id, { items: [...s.items, ...names.filter((n) => !s.items.includes(n))] });
        } else {
          const to = over.key.slice(4);
          if (!names.length || names.includes(to)) return;
          await api.createStack([to, ...names]);
        }
        this.selected.clear();
        this.paint();
        await this.h.refresh();
        return;
      }
      const here = this.current;
      const moving = names.filter((n) => (this.stackOf(n)?.id ?? null) !== here);
      const placed = keys.filter((k) => k.startsWith('lib:') || !here);
      if (!placed.length) return;
      if (moving.length) {
        if (here) {
          const s = this.stackById(here);
          if (!s) return;
          await api.updateStack(here, { items: [...s.items, ...moving] });
        } else await this.takeOut(moving);
        await this.h.refresh();
      }
      const shown = this.h.visibleKeys();
      const rest = shown.filter((k) => !placed.includes(k));
      let at = over ? rest.indexOf(over.key) : -1;
      if (at >= 0 && over?.zone === 'after') at += 1;
      if (at < 0) at = rest.length;
      rest.splice(at, 0, ...placed.filter((k) => shown.includes(k)));
      const hidden = this.orderOf().filter((k) => !rest.includes(k) && !placed.includes(k) && !shown.includes(k));
      await this.setOrder([...rest, ...hidden]);
      this.selected.clear();
      this.paint();
      this.h.setManual();
    } catch (err) { toast((err as Error).message, 'error'); }
  }
}
