import { api, openOutput } from '../io/api';
import { baseName, isDiskPath } from '../io/disk';
import { el, patchList, q, setClass, setHidden, setText, setTitle, swapMedia } from './dom';
import { confirmAction } from './dialogs';
import { icon } from './icons';
import { dateText, onLanguage, t } from './i18n';
import { toast } from './toast';
import { TheaterTools, type Target } from './home-theater';
import { TheaterCarry } from './theater-carry';
import { TheaterPreview } from './theater-preview';

/** Home's file browser (1.87.1, CLOSE_GAPS P02): Recent, Projects (the library) and Outputs (exports), each as a
 *  thumbnail grid or a list with name, kind, size and when it changed; filter, sort, open on click, and Remove from
 *  Recent. Rows are patched in place by key and thumbnails swap in once decoded, so nothing blinks or shifts. */
export interface HomeFilesDeps {
  recent: () => string[];
  openRecent: (nameOrPath: string) => void;
  openPath: (path: string) => void;
  removeRecent: (nameOrPath: string) => void;
  /** The library name of the movie open behind Home, or null. */
  openName?: () => string | null;
}

type Tab = 'recent' | 'projects' | 'outputs';
type Sort = 'opened' | 'name' | 'size' | 'kind' | 'manual';
type View = 'grid' | 'list';
type Thumb = { name: string } | { path: string; project: boolean } | null;

interface Item { inside?: string[]; key: string; name: string; kind: string; size: number; when: number; missing: boolean; where: string; thumb: Thumb; open: () => void; remove: (() => void) | null; target?: Target }

const PREFS = 'formmorpheus.home';
const PICTURE = /\.(png|jpe?g|webp|gif|avif)$/i;
const PROJECT = /\.fmo$/i;
const OUTPUTS_KEY = 'formmorpheus.outputs';

function readPrefs(): { tab: Tab; sort: Sort; view: View } {
  const out = { tab: 'recent' as Tab, sort: 'opened' as Sort, view: 'grid' as View };
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<typeof out>;
    if (v.tab === 'recent' || v.tab === 'projects' || v.tab === 'outputs') out.tab = v.tab;
    if (v.sort === 'opened' || v.sort === 'name' || v.sort === 'size' || v.sort === 'kind' || v.sort === 'manual') out.sort = v.sort;
    if (v.view === 'grid' || v.view === 'list') out.view = v.view;
  } catch { /* defaults */ }
  return out;
}

function storedOutputs(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OUTPUTS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  } catch { return []; }
}

const sizeText = (n: number): string => (n <= 0 ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function whenText(at: number): string {
  if (!at) return '';
  const ms = at < 1e12 ? at * 1000 : at, s = (Date.now() - ms) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return t('{n} min ago').replace('{n}', String(Math.round(s / 60)));
  if (s < 86400) return t('{n} h ago').replace('{n}', String(Math.round(s / 3600)));
  if (s < 86400 * 7) return t('{n} d ago').replace('{n}', String(Math.round(s / 86400)));
  return dateText(ms);
}

const kindOf = (name: string): string => (/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? 'fmo').toUpperCase();

export class HomeFiles {
  readonly root = el(`<div class="cv-hf">
    <div class="cv-hf-bar">
      <div class="cv-hf-tabs" role="tablist" aria-label="Files">
        <button class="cv-hf-tab" type="button" role="tab" data-tab="recent">Recent</button>
        <button class="cv-hf-tab" type="button" role="tab" data-tab="projects">Projects</button>
        <button class="cv-hf-tab" type="button" role="tab" data-tab="outputs">Outputs</button>
      </div>
      <label class="cv-hf-filter">${icon('search', 14)}<input class="cv-hf-input" type="search" placeholder="Filter files" aria-label="Filter files" spellcheck="false"></label>
      <label class="cv-hf-sortbox"><span>Sort</span><select class="cv-hf-sort" aria-label="Sort by"><option value="opened">Most recent</option><option value="name">Name</option><option value="size">Size</option><option value="kind">Kind</option><option value="manual">Manual</option></select></label>
      <div class="cv-hf-views" role="group" aria-label="View">
        <button class="cv-hf-view" type="button" data-view="grid" title="Thumbnails" aria-label="Thumbnails">${icon('viewGrid', 16)}</button>
        <button class="cv-hf-view" type="button" data-view="list" title="List" aria-label="List">${icon('viewList', 16)}</button>
      </div>
    </div>
    <div class="cv-hf-head" aria-hidden="true"><span></span><span>Name</span><span>Kind</span><span>Size</span><span>Modified</span><span></span></div>
    <div class="cv-hf-items" role="list"></div>
    <p class="cv-hf-empty" hidden></p>
  </div>`);
  private readonly items = q(this.root, '.cv-hf-items');
  private readonly empty = q(this.root, '.cv-hf-empty');
  private readonly filter = q<HTMLInputElement>(this.root, '.cv-hf-input');
  private readonly sort = q<HTMLSelectElement>(this.root, '.cv-hf-sort');
  private prefs = readPrefs();
  private all: Item[] = [];
  private readonly thumbs = new Map<string, string>();
  private readonly loading = new Set<string>();
  private run = 0;
  /** Select mode, the movie menu and stacks: the Movies page only. */
  private readonly theater: TheaterTools | null;

  /** `fixed` shows one tab only (Home's own pages, 1.87.3); `limit` with `compact` is the Start page's short grid. */
  constructor(private readonly d: HomeFilesDeps, private readonly opts: { fixed?: Tab; limit?: number; compact?: boolean; onCount?: (n: number) => void } = {}) {
    if (opts.fixed) this.prefs.tab = opts.fixed;
    // the Theater is in the person's own order until they pick a sort
    try { if (opts.fixed === 'projects' && !opts.compact && !('sort' in (JSON.parse(localStorage.getItem(PREFS) ?? '{}') as object))) this.prefs.sort = 'manual'; } catch { /* default sort */ }
    if (opts.compact) this.prefs.view = 'grid';
    setClass(this.root, 'is-fixed', !!opts.fixed);
    setClass(this.root, 'is-compact', !!opts.compact);
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.cv-hf-tab'))) b.addEventListener('click', () => { this.prefs.tab = b.dataset.tab as Tab; this.save(); void this.refresh(); });
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.cv-hf-view'))) b.addEventListener('click', () => { this.prefs.view = b.dataset.view as View; this.save(); this.chrome(); });
    this.sort.value = this.prefs.sort;
    this.sort.addEventListener('change', () => { this.prefs.sort = this.sort.value as Sort; this.save(); this.render(); });
    this.filter.addEventListener('input', () => this.render());
    onLanguage(() => this.render());   // dates follow the language
    this.items.addEventListener('click', (e) => {
      const t = e.target as HTMLElement, row = t.closest<HTMLElement>('.cv-hf-item'), item = row ? this.all.find((i) => i.key === row.dataset.key) : undefined;
      if (!item) return;
      if (this.theater?.suppressClick) { this.theater.suppressClick = false; return; }
      if (t.closest('.cv-hf-remove')) { item.remove?.(); return; }
      // the title popup: a click on a card's name renames it (outside Select mode)
      const nameEl = t.closest<HTMLElement>('.cv-hf-name');
      if (nameEl && item.target && this.theater && !this.theater.selecting) { this.theater.titlePopup(item.target, nameEl); return; }
      if (this.theater?.selecting && item.target) { this.theater.toggle(item.key); return; }
      if (t.closest('.cv-hf-open')) item.open();
    });
    this.theater = opts.fixed === 'projects' ? new TheaterTools({
      refresh: () => this.refresh(), render: () => this.render(), open: (n) => this.d.openRecent(n),
      isOpen: (n) => this.d.openName?.() === n, forget: (n) => this.d.removeRecent(n),
      visibleKeys: () => Array.from(this.items.querySelectorAll<HTMLElement>('.cv-hf-item')).filter((n) => !n.hidden).map((n) => n.dataset.key ?? '').filter(Boolean),
      setManual: () => { this.prefs.sort = 'manual'; this.sort.value = 'manual'; this.save(); this.render(); },
    }, q(this.root, '.cv-hf-bar')) : null;
    if (this.theater) { this.wireTheater(this.theater); new TheaterPreview(this.items); }
    this.chrome();
  }

  /** Moves a movie or export to Recently Deleted after a confirmation, then re-reads the page. */
  private async trashIt(label: string, act: () => Promise<void>): Promise<void> {
    if (!(await confirmAction('Delete?', `${label} moves to Recently Deleted, where it stays for 30 days.`, 'Delete', true))) return;
    try { await act(); } catch (err) { toast((err as Error).message, 'error'); }
    void this.refresh();
    document.dispatchEvent(new CustomEvent('fm:library-changed'));   // the Recently Deleted count follows
  }

  private save(): void {
    if (this.opts.fixed) { this.prefs.tab = this.opts.fixed; }
    try { const keep = readPrefs(); localStorage.setItem(PREFS, JSON.stringify({ ...keep, sort: this.prefs.sort, view: this.opts.compact ? keep.view : this.prefs.view, tab: this.opts.fixed ? keep.tab : this.prefs.tab })); } catch { /* the choice lasts this session */ }
  }

  /** Tabs and view buttons pressed state, the grid or list class: attribute writes only. */
  private chrome(): void {
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>('.cv-hf-tab'))) { const on = b.dataset.tab === this.prefs.tab; setClass(b, 'is-active', on); if (b.getAttribute('aria-selected') !== String(on)) b.setAttribute('aria-selected', String(on)); }
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>('.cv-hf-view'))) { const on = b.dataset.view === this.prefs.view; setClass(b, 'is-active', on); if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on)); }
    setClass(this.root, 'is-list', this.prefs.view === 'list');
  }

  /** Reads the chosen tab's files and patches the view; a slower earlier read never overwrites a newer one. */
  async refresh(): Promise<void> {
    this.chrome();
    const run = ++this.run, tab = this.prefs.tab;
    let items: Item[] = [];
    if (tab === 'projects') {
      await this.theater?.load();
      items = (await api.library().catch(() => [])).map((i) => ({ key: `lib:${i.name}`, name: i.name, kind: 'FMO', size: i.size, when: i.modified, missing: false, where: 'Library', thumb: { name: i.name }, target: { movie: i.name }, open: () => this.d.openRecent(i.name), remove:() => { if (this.d.openName?.() === i.name) { toast('Close the movie before deleting it.', 'error'); return; } void this.trashIt(`"${i.name}"`, async () => { await api.deleteMovie(i.name); this.d.removeRecent(i.name); }); } }));
      if (this.theater) {
        const byName = new Map(items.map((i) => [i.name, i]));
        for (const s of this.theater.stacks) {
          const inside = s.items.map((n) => byName.get(n)).filter((i): i is Item => !!i);
          if (!inside.length) continue;
          const id = s.id;
          items.push({ inside: inside.map((i) => i.name), key: `stk:${id}`, name: s.name, kind: `Stack · ${inside.length}`, size: inside.reduce((a, i) => a + i.size, 0), when: Math.max(...inside.map((i) => i.when)), missing: false,
            where: 'Stack', thumb: inside[0].thumb, target: { stack: id }, open: () => this.theater?.enter(id), remove: () => { void this.theater?.ungroup(id); } });
        }
      }
    } else if (tab === 'outputs') {
      const engine = await api.outputs(), seen = new Set(engine.map((o) => o.path)), extra = storedOutputs().filter((p) => !seen.has(p));
      const stats = await api.stat(extra);
      items = [...engine.map((o) => ({ path: o.path, size: o.size, when: o.modified, missing: false })), ...stats.filter((s) => s.exists).map((s) => ({ path: s.path, size: s.size, when: s.modified, missing: false }))]
        .map((o) => ({ key: `out:${o.path}`, name: baseName(o.path), kind: kindOf(o.path), size: o.size, when: o.when, missing: o.missing, where: o.path, thumb: PICTURE.test(o.path) || PROJECT.test(o.path) ? { path: o.path, project: PROJECT.test(o.path) } : null, open: () => { void openOutput(o.path).then((done) => { if (!done) this.d.openPath(o.path); }); }, remove: () => { void this.trashIt(`"${baseName(o.path)}"`, () => api.deleteOutput(baseName(o.path))); } }));
    } else {
      const names = this.d.recent(), lib = new Map((await api.library().catch(() => [])).map((i) => [i.name, i])), stats = new Map((await api.stat(names.filter(isDiskPath))).map((s) => [s.path, s]));
      items = names.map((n) => {
        const disk = isDiskPath(n), s = disk ? stats.get(n) : undefined, l = disk ? undefined : lib.get(n);
        return { key: `rec:${n}`, name: disk ? baseName(n).replace(/\.[^.]+$/, '') : n, kind: disk ? kindOf(n) : 'FMO', size: s?.size ?? l?.size ?? 0, when: s?.modified ?? l?.modified ?? 0, missing: disk ? !s?.exists : !l, where: disk ? n : 'Library',
          thumb: disk ? (PROJECT.test(n) || PICTURE.test(n) ? { path: n, project: PROJECT.test(n) } : null) : { name: n }, open: () => this.d.openRecent(n), remove: () => { this.d.removeRecent(n); void this.refresh(); } };
      });
    }
    if (run !== this.run) return;
    this.all = items;
    this.opts.onCount?.(items.length);
    this.render();
  }

  /** Filter and sort the read files, then patch the rows by key. */
  private render(): void {
    const f = this.filter.value.trim().toLowerCase(), sort = this.prefs.sort;
    const th = this.theater;
    // a stack matches when its own name or any movie inside it does
    const matches = (i: Item): boolean => !f || i.name.toLowerCase().includes(f) || i.kind.toLowerCase() === f || !!i.inside?.some((n) => n.toLowerCase().includes(f));
    const inView = (i: Item): boolean => !th || !i.target || (i.target.stack ? !th.current : th.visible(i.target.movie ?? ''));
    const shown = this.all.filter((i) => matches(i) && inView(i));
    setClass(this.root, 'is-selecting', !!th?.selecting);
    if (sort === 'name') shown.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    else if (sort === 'size') shown.sort((a, b) => b.size - a.size);
    else if (sort === 'kind') shown.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    else if (sort === 'manual') {
      // the person's own order; anything new sits first, newest first
      const order = th ? th.orderOf() : [];
      const at = (k: string): number => { const i = order.indexOf(k); return i < 0 ? -1 : i; };
      shown.sort((a, b) => at(a.key) - at(b.key) || b.when - a.when);
    } else if (this.prefs.tab !== 'recent') shown.sort((a, b) => b.when - a.when);
    if (this.opts.limit) shown.splice(this.opts.limit);
    if (th && !this.opts.limit) {
      // Theater: every card stays mounted and keyed; those out of view (another stack, the filter) are hidden in place
      const on = new Set(shown.map((i) => i.key));
      patchList(this.items, [...shown, ...this.all.filter((i) => !on.has(i.key))], { key: (i) => i.key, create: (i) => this.row(i), update: (n, i) => this.fillRow(n, i) });
      for (const n of Array.from(this.items.children) as HTMLElement[]) { const off = !on.has(n.dataset.key ?? ''); if (n.hidden !== off) n.hidden = off; }
    } else patchList(this.items, shown, { key: (i) => i.key, create: (i) => this.row(i), update: (n, i) => this.fillRow(n, i) });
    const none = this.all.length === 0 ? (this.prefs.tab === 'recent' ? 'Movies you open or save appear here.' : this.prefs.tab === 'projects' ? 'No movies in the library yet. Save a movie to add it.' : 'Exports appear here once you export a movie.') : 'No files match the filter.';
    setText(this.empty, none);
    setHidden(this.empty, shown.length > 0);
  }

  /** Context menu (right click, or hold with touch and pen), and dragging a movie onto a movie or a stack. */
  private wireTheater(th: TheaterTools): void {
    const itemOf = (t: EventTarget | null): { row: HTMLElement; item: Item } | null => {
      const row = (t as HTMLElement | null)?.closest<HTMLElement>('.cv-hf-item');
      const item = row ? this.all.find((i) => i.key === row.dataset.key) : undefined;
      return row && item?.target ? { row, item } : null;
    };
    this.items.addEventListener('contextmenu', (e) => {
      const hit = itemOf(e.target);
      if (!hit?.item.target) return;
      e.preventDefault();
      th.show(hit.item.target, e.clientX, e.clientY);
    });
    // Hold or drag a card to carry it (or the selection); a touch hold released in place shows the menu.
    new TheaterCarry(this.items, th, {
      target: (k) => this.all.find((i) => i.key === k)?.target,
      list: () => this.prefs.view === 'list',
      menu: (target, x, y) => th.show(target, x, y),
    });
  }

  private row(i: Item): HTMLElement {
    const n = el(`<div class="cv-hf-item" role="listitem">
      <span class="cv-hf-check">${icon('check', 12)}</span>
      <button class="cv-hf-open" type="button"><span class="cv-hf-thumb"><img class="cv-hf-img" alt="" decoding="async" draggable="false" hidden><span class="cv-hf-glyph">${icon('fileImage', 22)}</span></span><span class="cv-hf-name"></span><span class="cv-hf-kind"></span><span class="cv-hf-size"></span><span class="cv-hf-when"></span></button>
      <button class="cv-hf-remove" type="button" title="Remove from Recent" aria-label="Remove from Recent">${icon('close', 12)}</button>
    </div>`);
    this.fillRow(n, i);
    return n;
  }

  private fillRow(n: HTMLElement, i: Item): void {
    setText(q(n, '.cv-hf-name'), i.name);
    setText(q(n, '.cv-hf-kind'), i.kind.startsWith('Stack · ') ? `${t('Stack')}${i.kind.slice(5)}` : i.kind);
    setText(q(n, '.cv-hf-size'), i.missing ? 'Missing' : sizeText(i.size));
    setText(q(n, '.cv-hf-when'), whenText(i.when));
    setTitle(q(n, '.cv-hf-open'), i.missing ? `${i.where} (not found)` : i.where);
    setClass(n, 'is-missing', i.missing);
    setClass(n, 'is-selected', !!this.theater?.selected.has(i.key));
    setClass(n, 'is-stack', !!i.target?.stack);
    setHidden(q(n, '.cv-hf-remove'), !i.remove);
    const rm = this.prefs.tab === 'recent' ? 'Remove from Recent' : 'Delete';
    setTitle(q(n, '.cv-hf-remove'), rm);
    if (q(n, '.cv-hf-remove').getAttribute('aria-label') !== rm) q(n, '.cv-hf-remove').setAttribute('aria-label', rm);
    const tk = i.thumb ? `${'name' in i.thumb ? `n:${i.thumb.name}` : `p:${i.thumb.path}`}|${i.when}` : '';
    if (n.dataset.thumb === tk) return;
    n.dataset.thumb = tk;
    const img = q<HTMLImageElement>(n, '.cv-hf-img');
    const url = this.thumbs.get(tk);
    if (url) { void swapMedia(img, url).then(() => this.showThumb(n, img)).catch(() => undefined); return; }
    if (!i.thumb || i.missing || this.loading.has(tk) || (!('name' in i.thumb) && !i.thumb.project && i.size > 40 * 1048576)) return;
    this.loading.add(tk);
    const th = i.thumb;
    void (async () => {
      let blob: Blob | null = null;
      if ('name' in th) blob = await api.thumbnail({ name: th.name });
      else if (th.project) blob = await api.thumbnail({ path: th.path });
      else blob = await api.readPath(th.path).catch(() => null);
      this.loading.delete(tk);
      if (!blob || !blob.size) return;
      const u = URL.createObjectURL(blob);
      this.thumbs.set(tk, u);
      if (n.dataset.thumb !== tk) return;
      try { await swapMedia(img, u); this.showThumb(n, img); } catch { /* the glyph stays */ }
    })();
  }

  private showThumb(n: HTMLElement, img: HTMLImageElement): void {
    setHidden(img, false);
    setHidden(q(n, '.cv-hf-glyph'), true);
  }
}
