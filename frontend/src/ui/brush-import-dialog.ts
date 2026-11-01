// Import preview for brush files: a tree of the file's sets and brushes with a stroke thumbnail each, a check box per
// brush and per set (tri-state), and a note on every brush whose settings could only be approximated. Only the chosen
// brushes land. The dialog is built once; each opening fills the tree while the dialog is still hidden, and every
// later change (check, collapse, tips only) patches the rows in place. Thumbnails are drawn lazily, visible rows
// first, in idle time, so a 500-brush file opens at once.

import '../styles/brush-import-dialog.css';
import { importBrushFile, type ImportResult } from '../io/brush-import';
import { makePresets } from '../paint/brushes';
import { renderBrushPreview } from '../paint/preview';
import type { Brush } from '../paint/types';
import { brushStore } from './brush-store';
import { Dialog } from './dialogs';
import { el, escapeHtml, q, setClass, setDisabled, setHidden, setText, setTitle } from './dom';
import { t, tn } from './i18n';
import { tf } from './i18n-fill';

const TW = 160, TH = 44;
const INK = { r: 20, g: 20, b: 24 };
const CHEV = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5.5 3.5 10.5 8l-5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface ImportChoice {
  /** Only the chosen brushes, grouped as in the file. */
  sets: { name: string; brushes: Brush[] }[];
  mode: 'new' | 'current';
  libName: string;
  count: number;
}

export interface LandResult { added: number; firstSet: string | null; newLib: boolean }

interface Item { b: Brush; tipB: Brush | null; on: boolean; row: HTMLElement; cb: HTMLInputElement; cv: HTMLCanvasElement; drawn: boolean; stale: boolean; grp: Grp }
interface Grp { name: string; items: Item[]; box: HTMLElement; head: HTMLElement; cb: HTMLInputElement; count: HTMLElement; open: boolean }
type Nav = { g: Grp; it: Item | null };

/** The brush with only its tip kept: what the plain tip import has always made. */
function tipOnly(b: Brush): Brush {
  const sampled = !!b.tipImage;
  return {
    id: b.id, name: b.name, set: b.set, tip: sampled ? 'sampled' : b.tip, softness: sampled ? 0 : b.softness, maxSize: b.maxSize, minSize: b.minSize,
    spacing: b.spacing, flow: 1, pressureSize: [0.5, 1], pressureFlow: [0.7, 1], tilt: 0, scatter: 0, rotationJitter: 0, followStroke: false,
    roundness: 1, grain: 0, smoothing: 0.2, pickup: 0.5, presets: makePresets(1), ...(b.tipImage ? { tipImage: b.tipImage } : {}), custom: true,
  };
}

/** Per-brush notes on settings that were approximated (read loosely: the field is optional). */
const notesOf = (r: ImportResult): Record<string, string[]> | undefined => (r as ImportResult & { notes?: Record<string, string[]> }).notes;

const idle =(fn: () => void): void => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 300 }); else window.setTimeout(fn, 16);
};

class BrushImportDialog {
  private readonly dlg = new Dialog('Import brushes', 600);
  private readonly head = el<HTMLElement>('<div class="fm-bi-head"><div class="fm-bi-file"></div><div class="fm-bi-sub"></div></div>');
  private readonly fileEl = q(this.head, '.fm-bi-file');
  private readonly subEl = q(this.head, '.fm-bi-sub');
  private readonly bar = el<HTMLElement>('<div class="fm-bi-bar"><span class="fm-bi-sel"></span><span class="fm-bi-gap"></span><button class="cv-btn cv-btn-ghost" type="button" data-all>Select all</button><button class="cv-btn cv-btn-ghost" type="button" data-none>Select none</button></div>');
  private readonly selEl = q(this.bar, '.fm-bi-sel');
  private readonly list = el<HTMLElement>('<div class="fm-bi-list" role="tree" tabindex="0"></div>');
  private readonly optNew = el<HTMLInputElement>('<input type="radio" name="fm-bi-dest" value="new">');
  private readonly optCur = el<HTMLInputElement>('<input type="radio" name="fm-bi-dest" value="current">');
  private readonly curName = el<HTMLElement>('<span class="fm-bi-libn"></span>');
  private readonly newName = el<HTMLElement>('<span class="fm-bi-libn"></span>');
  private readonly tips = el<HTMLInputElement>('<input type="checkbox">');
  private readonly tipsRow: HTMLElement;
  private readonly px = el<HTMLInputElement>('<input type="checkbox">');
  private readonly pxRow: HTMLElement;
  private res: ImportResult | null = null;
  private readonly go: HTMLButtonElement;
  private groups: Grp[] = [];
  private cur: Nav | null = null;
  private fileBase = '';
  private resolve: ((c: ImportChoice | null) => void) | null = null;
  private io: IntersectionObserver | null = null;
  private readonly vis = new Set<Item>();
  private hot: Item[] = [];
  private pumping = false;
  private tmp: HTMLCanvasElement | null = null;

  constructor() {
    const opts = el<HTMLElement>('<div class="fm-bi-opts"></div>');
    const mk = (input: HTMLInputElement, label: string, extra: HTMLElement): HTMLElement => {
      const l = el<HTMLElement>('<label class="fm-bi-opt"><span class="fm-bi-txt"></span></label>');
      l.prepend(input);
      setText(q(l, '.fm-bi-txt'), t(label));
      l.append(extra);
      return l;
    };
    this.tipsRow = mk(this.tips, 'Tips only (ignore preset settings)', el('<span></span>'));
    this.pxRow = mk(this.px, 'Use the file\'s pixel sizes', el('<span></span>'));
    opts.append(mk(this.optNew, 'Add as a new library', this.newName), mk(this.optCur, 'Add to the current library', this.curName), this.tipsRow, this.pxRow);
    this.dlg.body.append(this.head, this.bar, this.list, opts);
    this.dlg.body.classList.add('fm-bi-body');
    this.dlg.button('Cancel', 'ghost', () => this.dlg.close());
    this.go = this.dlg.button('Import', 'primary', () => this.commit());
    this.dlg.onClose = () => { this.teardown(); const r = this.resolve; this.resolve = null; r?.(null); };
    q(this.bar, '[data-all]').addEventListener('click', () => this.setAll(true));
    q(this.bar, '[data-none]').addEventListener('click', () => this.setAll(false));
    this.tips.addEventListener('change', () => this.reread());
    this.px.addEventListener('change', () => this.reread());
    this.list.addEventListener('change', (e) => this.onChange(e));
    this.list.addEventListener('click', (e) => this.onClick(e));
    this.dlg.scrim.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Opens the dialog for one parsed file; resolves with the chosen brushes, or null when cancelled. */
  choose(fileName: string, r: ImportResult, isAbr: boolean): Promise<ImportChoice | null> {
    this.resolve?.(null);
    this.fileBase = fileName.replace(/\.[^.]+$/, '').slice(0, 40) || 'Brushes';
    const src = r.sets && r.sets.length ? r.sets : [{ name: (r.setName ?? this.fileBase), brushes: r.brushes }];
    const notes = notesOf(r);
    this.fill(src, notes);
    this.res = r;
    setText(this.fileEl, fileName);
    this.subline(r, notes);
    setText(this.newName, `"${this.fileBase}"`);
    setText(this.curName, `"${brushStore.lib(brushStore.activeLib())?.name ?? ''}"`);
    const pickNew = isAbr || !!r.sets;
    this.optNew.checked = pickNew; this.optCur.checked = !pickNew;
    this.tips.checked = false;
    this.px.checked = false;
    setHidden(this.tipsRow, !isAbr);
    setHidden(this.pxRow, !isAbr || !r.reparse);
    this.updateCounts();
    this.setCur(this.nav()[0] ?? null);
    this.io = new IntersectionObserver((es) => this.seen(es), { root: this.list, rootMargin: '160px 0px' });
    for (const g of this.groups) for (const it of g.items) this.io.observe(it.row);
    return new Promise((res) => {
      this.resolve = res;
      this.dlg.open(this.list);
      this.updateCounts();   // open() re-reads the footer labels, so the count is written after it
    });
  }

  /** The line under the file name: counts, approximated settings, skipped brushes. */
  private subline(r: ImportResult, notes: Record<string, string[]> | undefined): void {
    const total = this.groups.reduce((n, g) => n + g.items.length, 0);
    const approx = this.groups.reduce((n, g) => n + g.items.filter((i) => notes?.[i.b.id]?.length).length, 0);
    const bits = [tn(total, '{n} brush', '{n} brushes'), tn(this.groups.length, '{n} set', '{n} sets')];
    if (approx) bits.push(tn(approx, '{n} approximated', '{n} approximated'));
    if (r.skipped) bits.push(tn(r.skipped, '{n} skipped', '{n} skipped'));
    setText(this.subEl, bits.join(' · '));
    setTitle(this.subEl, r.skipped && r.skippedKeys?.length ? `${t('Not read')}: ${r.skippedKeys.slice(0, 20).join(', ')}` : '');
  }

  /** Tips only and pixel sizes: the file is read again with those options and every row is patched in place (same order,
   *  same checks); a file with no re-read keeps the old tip-only reduction. */
  private reread(): void {
    const r = this.res;
    if (!r?.reparse) { this.restale(); return; }
    let nr: ImportResult;
    try { nr = r.reparse({ applySettings: !this.tips.checked, absoluteSizes: this.px.checked }); } catch { this.restale(); return; }
    const flat = (nr.sets && nr.sets.length ? nr.sets : [{ name: '', brushes: nr.brushes }]).flatMap((s) => s.brushes);
    const notes = notesOf(nr);
    let i = 0;
    for (const g of this.groups) for (const it of g.items) {
      const nb = flat[i++];
      if (!nb) continue;
      it.b = nb; it.tipB = null;
      const bd = q(it.row, '.fm-bi-badge'), nt = notes?.[nb.id];
      if (nt && nt.length) { setText(bd, tn(nt.length, '{n} setting approximated', '{n} settings approximated')); bd.title = nt.join('\n'); setHidden(bd, false); }
      else { bd.title = ''; setHidden(bd, true); }
    }
    this.res = { ...r, ...nr, reparse: r.reparse };
    this.subline(nr, notes);
    this.restale();
  }

  // ---- tree -------------------------------------------------------------------

  private fill(src: { name: string; brushes: Brush[] }[], notes: Record<string, string[]> | undefined): void {
    this.groups = [];
    this.vis.clear(); this.hot = [];
    const frag = document.createDocumentFragment();
    let n = 0;
    for (const s of src) {
      if (!s.brushes.length) continue;
      const box = el<HTMLElement>('<div class="fm-bi-set is-open" role="group"></div>');
      const head = el<HTMLElement>(`<div class="fm-bi-sethead" role="treeitem"><button class="fm-bi-chev" type="button" tabindex="-1" aria-label="${escapeHtml(t('Expand'))}">${CHEV}</button><input type="checkbox" tabindex="-1" data-set><span class="fm-bi-setname"></span><span class="fm-bi-setn"></span></div>`);
      setText(q(head, '.fm-bi-setname'), s.name);
      const g: Grp = { name: s.name, items: [], box, head, cb: q<HTMLInputElement>(head, 'input'), count: q(head, '.fm-bi-setn'), open: true };
      const body = el<HTMLElement>('<div class="fm-bi-rows"></div>');
      for (const b of s.brushes) {
        const row = el<HTMLElement>('<div class="fm-bi-row" role="treeitem"><input type="checkbox" tabindex="-1" checked><canvas></canvas><span class="fm-bi-name"></span><span class="fm-bi-badge" hidden></span></div>');
        const cv = q<HTMLCanvasElement>(row, 'canvas');
        cv.width = TW; cv.height = TH;
        setText(q(row, '.fm-bi-name'), b.name);
        row.dataset.i = String(n++);
        const nt = notes?.[b.id];
        if (nt && nt.length) {
          const bd = q(row, '.fm-bi-badge');
          setText(bd, tn(nt.length, '{n} setting approximated', '{n} settings approximated'));
          bd.title = nt.join('\n');
          setHidden(bd, false);
        }
        const it: Item = { b, tipB: null, on: true, row, cb: q<HTMLInputElement>(row, 'input'), cv, drawn: false, stale: false, grp: g };
        g.items.push(it);
        body.append(row);
      }
      box.append(head, body);
      frag.append(box);
      this.groups.push(g);
    }
    // the list is hidden with the dialog, so swapping its content now cannot flash
    this.list.replaceChildren(frag);
    this.list.scrollTop = 0;
  }

  private nav(): Nav[] {
    const out: Nav[] = [];
    for (const g of this.groups) {
      out.push({ g, it: null });
      if (g.open) for (const it of g.items) out.push({ g, it });
    }
    return out;
  }

  private setCur(n: Nav | null): void {
    if (this.cur) setClass(this.cur.it ? this.cur.it.row : this.cur.g.head, 'is-cur', false);
    this.cur = n;
    if (!n) return;
    const node = n.it ? n.it.row : n.g.head;
    setClass(node, 'is-cur', true);
    const lr = this.list.getBoundingClientRect(), r = node.getBoundingClientRect();
    if (r.top < lr.top) this.list.scrollTop -= lr.top - r.top;
    else if (r.bottom > lr.bottom) this.list.scrollTop += r.bottom - lr.bottom;
  }

  private updateCounts(): void {
    let on = 0, all = 0;
    for (const g of this.groups) {
      const n = g.items.reduce((s, i) => s + (i.on ? 1 : 0), 0);
      on += n; all += g.items.length;
      const full = n === g.items.length;
      if (g.cb.checked !== full) g.cb.checked = full;
      const part = n > 0 && !full;
      if (g.cb.indeterminate !== part) g.cb.indeterminate = part;
      setText(g.count, `${n}/${g.items.length}`);
    }
    setText(this.selEl, tf('{n} of {all} selected', { n: on, all }));
    setDisabled(this.go, on === 0);
    const label = on === 1 ? t('Import 1 brush') : t('Import {n} brushes').replace('{n}', String(on));
    setText(this.go, label);
    this.go.dataset.shown = label;
  }

  private setItem(it: Item, on: boolean): void {
    it.on = on;
    if (it.cb.checked !== on) it.cb.checked = on;
    setClass(it.row, 'is-off', !on);
  }

  private setAll(on: boolean): void {
    for (const g of this.groups) for (const it of g.items) this.setItem(it, on);
    this.updateCounts();
  }

  private toggleGroup(g: Grp, open: boolean): void {
    g.open = open;
    setClass(g.box, 'is-open', open);
    // a hidden current row moves to its set
    if (!open && this.cur && this.cur.g === g && this.cur.it) this.setCur({ g, it: null });
  }

  private onChange(e: Event): void {
    const c = e.target;
    if (!(c instanceof HTMLInputElement)) return;
    const head = c.closest<HTMLElement>('.fm-bi-sethead'), row = c.closest<HTMLElement>('.fm-bi-row');
    if (head) {
      const g = this.groups.find((x) => x.head === head);
      if (g) for (const it of g.items) this.setItem(it, c.checked);
    } else if (row) {
      const it = this.itemOf(row);
      if (it) this.setItem(it, c.checked);
    }
    this.updateCounts();
  }

  private itemOf(row: HTMLElement): Item | undefined {
    for (const g of this.groups) { const it = g.items.find((i) => i.row === row); if (it) return it; }
    return undefined;
  }

  private onClick(e: MouseEvent): void {
    const tg = e.target as HTMLElement;
    const head = tg.closest<HTMLElement>('.fm-bi-sethead'), row = tg.closest<HTMLElement>('.fm-bi-row');
    if (head) {
      const g = this.groups.find((x) => x.head === head);
      if (!g) return;
      this.setCur({ g, it: null });
      if (tg.closest('.fm-bi-chev')) this.toggleGroup(g, !g.open);
    } else if (row) {
      const it = this.itemOf(row);
      if (it) this.setCur({ g: it.grp, it });
    }
    this.list.focus({ preventScroll: true });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const onList = e.target === this.list;
    if (e.key === 'Enter') {
      const tg = e.target as HTMLElement;
      if (tg instanceof HTMLButtonElement || this.go.disabled) return;
      e.preventDefault();
      this.commit();
      return;
    }
    if (!onList) return;
    const nav = this.nav();
    let at = this.cur ? nav.findIndex((n) => n.g === this.cur!.g && n.it === this.cur!.it) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End' || e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? 8 : e.key === 'PageUp' ? -8 : 0;
      at = e.key === 'Home' ? 0 : e.key === 'End' ? nav.length - 1 : Math.min(nav.length - 1, Math.max(0, at + step));
      this.setCur(nav[at] ?? null);
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      const c = this.cur;
      if (!c) return;
      if (c.it) this.setItem(c.it, !c.it.on);
      else { const to = !c.g.items.every((i) => i.on); for (const it of c.g.items) this.setItem(it, to); }
      this.updateCounts();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const c = this.cur;
      if (!c) return;
      if (e.key === 'ArrowLeft') { if (c.it) this.setCur({ g: c.g, it: null }); else this.toggleGroup(c.g, false); }
      else if (!c.g.open && !c.it) this.toggleGroup(c.g, true);
      else if (!c.it && c.g.items[0]) this.setCur({ g: c.g, it: c.g.items[0] });
    }
  }

  // ---- thumbnails ----------------------------------------------------------------

  private seen(es: IntersectionObserverEntry[]): void {
    for (const en of es) {
      const it = this.itemOf(en.target as HTMLElement);
      if (!it) continue;
      if (en.isIntersecting) {
        this.vis.add(it);
        if (!it.drawn || it.stale) this.hot.push(it);
      } else this.vis.delete(it);
    }
    this.kick();
  }

  /** Redraws the shown thumbnails when tips only changes; the old picture stays until the new one replaces it. */
  private restale(): void {
    for (const g of this.groups) for (const it of g.items) if (it.drawn) it.stale = true;
    for (const it of this.vis) if (it.stale) this.hot.push(it);
    this.kick();
  }

  private kick(): void {
    if (this.pumping || !this.hot.length) return;
    this.pumping = true;
    idle(() => this.pump());
  }

  private pump(): void {
    const t0 = performance.now();
    while (this.hot.length && performance.now() - t0 < 10) {
      const it = this.hot.shift()!;
      if (!this.vis.has(it) || (it.drawn && !it.stale)) continue;
      this.draw(it);
    }
    this.pumping = false;
    // the last-seen rows are the ones nearest the viewer's eye in the scroll direction: take them first
    this.kick();
  }

  private draw(it: Item): void {
    it.drawn = true; it.stale = false;
    let b = it.b;
    if (this.tips.checked && !this.res?.reparse) b = it.tipB ?? (it.tipB = tipOnly(it.b));
    try {
      const r = renderBrushPreview(b, TW, TH, INK);
      const tmp = this.tmp ?? (this.tmp = document.createElement('canvas'));
      if (tmp.width !== TW) { tmp.width = TW; tmp.height = TH; }
      tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data), TW, TH), 0, 0);
      const g = it.cv.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, TW, TH);
      g.drawImage(tmp, 0, 0);
    } catch { /* a brush the engine cannot draw keeps a blank thumbnail */ }
  }

  private teardown(): void {
    this.io?.disconnect();
    this.io = null;
    this.vis.clear();
    this.hot = [];
  }

  // ---- result ---------------------------------------------------------------------

  private commit(): void {
    if (!this.resolve || this.go.disabled) return;
    const tipsOnly = this.tips.checked && !this.tipsRow.hidden && !this.res?.reparse;
    const sets = this.groups
      .map((g) => ({ name: g.name, brushes: g.items.filter((i) => i.on).map((i) => (tipsOnly ? tipOnly(i.b) : i.b)) }))
      .filter((s) => s.brushes.length);
    const count = sets.reduce((n, s) => n + s.brushes.length, 0);
    const res = this.resolve;
    this.resolve = null;
    res({ sets, mode: this.optCur.checked ? 'current' : 'new', libName: this.fileBase, count });
    this.dlg.close();
  }
}

let dialog: BrushImportDialog | null = null;

/** Shows the import preview for a parsed file; resolves with the chosen brushes or null. */
export function chooseBrushes(fileName: string, r: ImportResult, isAbr: boolean): Promise<ImportChoice | null> {
  if (!dialog) dialog = new BrushImportDialog();
  return dialog.choose(fileName, r, isAbr);
}

/** Puts the chosen brushes in the store: a new library named after the file, or sets in the current library. */
export function landChoice(c: ImportChoice): LandResult {
  if (!c.count) return { added: 0, firstSet: null, newLib: false };
  if (c.mode === 'new') {
    brushStore.addImportedLibrary(c.libName, c.sets);
    return { added: c.count, firstSet: brushStore.setsOf(brushStore.activeLib())[0]?.id ?? null, newLib: true };
  }
  let first: string | null = null;
  for (const s of c.sets) { const id = brushStore.addImportedSet(s.name, s.brushes); first ??= id; }
  return { added: c.count, firstSet: first, newLib: false };
}

export interface FileImport extends LandResult { skipped: number; cancelled: boolean }

/** Reads one brush file, lets the person choose, and lands the choice. A lone plain brush skips the dialog. */
export async function importFileWithPreview(file: File): Promise<FileImport> {
  const r = await importBrushFile(file);
  const isAbr = /\.abr$/i.test(file.name);
  const nBrushes = r.brushes.length;
  if (!nBrushes) return { added: 0, firstSet: null, newLib: false, skipped: r.skipped, cancelled: false };
  const nts = notesOf(r);
  const noted = !!nts && Object.values(nts).some((n) => n.length);
  if (nBrushes === 1 && !isAbr && !r.sets && !noted) {
    if (r.setName) { const id = brushStore.addImportedSet(r.setName, r.brushes); return { added: 1, firstSet: id, newLib: false, skipped: r.skipped, cancelled: false }; }
    brushStore.addImported(r.brushes);
    return { added: 1, firstSet: null, newLib: false, skipped: r.skipped, cancelled: false };
  }
  const c = await chooseBrushes(file.name, r, isAbr);
  if (!c) return { added: 0, firstSet: null, newLib: false, skipped: r.skipped, cancelled: true };
  return { ...landChoice(c), skipped: r.skipped, cancelled: false };
}
