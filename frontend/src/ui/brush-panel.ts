// Brush panel of Draw & Paint: sets on the left, brushes with a live stroke preview on the right.
// Right-click (or double-click for Pressure & Smoothing) manages brushes and sets; files dropped on
// the panel, or picked with Import, land in the Imported set.
import { el, patchList, q, setClass, setHidden, setText } from './dom';
import { t, tn } from './i18n';
import { brushStore, IMPORTED_ID, type BrushSet } from './brush-store';
import { renderBrushPreview } from '../paint/preview';
import { importBrushFile } from '../io/brush-import';
import type { Brush } from '../paint/types';

const RECENT_KEY = 'formmorpheus.brushes.recent';
const RECENT = 'recent';
const RECENT_MAX = 8;
const PW = 190, PH = 40, SCALE = 2;
const DRAG_BRUSH = 'application/x-fm-brush', DRAG_SET = 'application/x-fm-set';

const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>';
const ICON_CLEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg>';
const ICON_RECENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const ICON_SET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17c3-9 6-9 8-4s5 4 8-5"/></svg>';
const ICON_IMPORT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14"/></svg>';
const ICON_ADD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>';

type Tool = 'paint' | 'smudge' | 'erase';
type Act = 'rename' | 'duplicate' | 'delete' | 'up' | 'down' | 'pressure' | 'import' | 'newset' | 'restore';

const LABEL: Record<Act, string> = {
  rename: 'Rename', duplicate: 'Duplicate', delete: 'Delete', up: 'Move up', down: 'Move down',
  pressure: 'Pressure & Smoothing', import: 'Import brushes', newset: 'New set', restore: 'Restore starter brushes',
};

interface Prev { canvas: HTMLCanvasElement; rev: number; set: string }

export class BrushPanel {
  readonly root: HTMLElement;
  private readonly setsEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly searchEl: HTMLInputElement;
  private readonly clearEl: HTMLElement;
  private readonly fileEl: HTMLInputElement;
  private readonly menuEl: HTMLElement;
  private readonly menuItems: HTMLButtonElement[];
  private readonly renameEl: HTMLInputElement;
  private readonly cardEl: HTMLElement;
  private readonly cardName: HTMLElement;
  private readonly cardPrev: HTMLCanvasElement;
  private readonly sliders: Record<string, { input: HTMLInputElement; out: HTMLElement }> = {};
  private readonly previews = new Map<string, Prev>();
  private recent: string[] = [];
  private activeSet = RECENT;
  private currentId = '';
  private anchor: HTMLElement | null = null;
  private opened = false;
  private freezeRecent = false;
  private menuTarget: { kind: 'brush' | 'set' | 'panel'; id: string } | null = null;
  private renaming: { kind: 'brush' | 'set'; id: string } | null = null;
  private cardId = '';
  private cardRaf = 0;
  private noteTimer = 0;
  private dragging: { kind: 'brush' | 'set'; id: string } | null = null;

  private readonly onDown = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (!t || this.root.contains(t) || this.anchor?.contains(t)) {
      if (t && !this.menuEl.hidden && !this.menuEl.contains(t)) this.closeMenu();
      return;
    }
    this.close();
  };
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (this.renaming) { this.endRename(false); return; }
    if (!this.menuEl.hidden) { this.closeMenu(); return; }
    if (!this.cardEl.hidden) { this.closeCard(); return; }
    if (this.searchEl.value) { this.searchEl.value = ''; this.onSearch(); return; }
    this.close();
  };

  constructor(private readonly opts: { onPick: (brush: Brush) => void }) {
    this.root = el<HTMLElement>(`<div class="fm-bp fm-pp-glass" hidden>
      <div class="fm-bp-head"><div class="fm-bp-title">Brushes</div>
        <button type="button" class="fm-bp-tool" data-act="import" title="Import brushes" aria-label="Import brushes">${ICON_IMPORT}</button>
        <button type="button" class="fm-bp-tool" data-act="newset" title="New set" aria-label="New set">${ICON_ADD}</button>
        <button type="button" class="fm-bp-tool" data-act="more" title="More" aria-label="More">${ICON_MORE}</button>
      </div>
      <label class="fm-bp-search"><span class="fm-bp-glass">${ICON_SEARCH}</span><input type="text" placeholder="Search" spellcheck="false" autocomplete="off"><button type="button" class="fm-bp-clear" hidden aria-label="Clear">${ICON_CLEAR}</button></label>
      <div class="fm-bp-cols">
        <div class="fm-bp-sets"></div>
        <div class="fm-bp-lists"><div class="fm-bp-list"></div><div class="fm-bp-empty" hidden></div></div>
      </div>
      <div class="fm-bp-note" hidden></div>
      <input class="fm-bp-file" type="file" accept=".abr,.brush,.brushset,image/*" multiple hidden>
      <input class="fm-bp-rename" type="text" maxlength="60" hidden spellcheck="false" autocomplete="off">
      <div class="fm-bp-menu fm-pp-glass" hidden>${(Array.from({ length: 7 }, () => '<button type="button" class="fm-bp-mi" hidden></button>')).join('')}</div>
      <div class="fm-bp-card" hidden>
        <div class="fm-bp-card-head"><div class="fm-bp-card-title">Pressure &amp; Smoothing</div><button type="button" class="fm-bp-card-done">Done</button></div>
        <div class="fm-bp-card-name"></div>
        <canvas class="fm-bp-card-prev"></canvas>
        <div class="fm-bp-flds">
          ${['pressureSize|Pressure to size', 'pressureFlow|Pressure to opacity', 'pressureGamma|Pressure curve', 'stabilization|Stabilization', 'motionFilter|Motion filtering', 'expression|Expression']
            .map((s) => { const [k, l] = s.split('|'); return `<label class="fm-bp-fld"><span class="fm-bp-fld-name">${l}</span><input type="range" min="0" max="100" step="1" data-k="${k}"><output></output></label>`; }).join('')}
        </div>
      </div>
    </div>`);
    this.setsEl = q(this.root, '.fm-bp-sets');
    this.listEl = q(this.root, '.fm-bp-list');
    this.emptyEl = q(this.root, '.fm-bp-empty');
    this.noteEl = q(this.root, '.fm-bp-note');
    this.searchEl = q<HTMLInputElement>(this.root, '.fm-bp-search input');
    this.clearEl = q(this.root, '.fm-bp-clear');
    this.fileEl = q<HTMLInputElement>(this.root, '.fm-bp-file');
    this.menuEl = q(this.root, '.fm-bp-menu');
    this.menuItems = Array.from(this.menuEl.querySelectorAll<HTMLButtonElement>('.fm-bp-mi'));
    this.renameEl = q<HTMLInputElement>(this.root, '.fm-bp-rename');
    this.cardEl = q(this.root, '.fm-bp-card');
    this.cardName = q(this.root, '.fm-bp-card-name');
    this.cardPrev = q<HTMLCanvasElement>(this.root, '.fm-bp-card-prev');
    this.cardPrev.width = 280 * SCALE;
    this.cardPrev.height = 56 * SCALE;
    for (const inp of Array.from(this.cardEl.querySelectorAll<HTMLInputElement>('input[data-k]'))) this.sliders[inp.dataset.k ?? ''] = { input: inp, out: q(inp.parentElement as HTMLElement, 'output') };
    this.loadRecent();

    brushStore.subscribe(() => { if (this.opened) this.sync(); else this.dirty = true; });
    void brushStore.load();

    this.setsEl.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-bp-set');
      if (!row) return;
      this.searchEl.value = '';
      this.activeSet = row.dataset.set ?? RECENT;
      this.freezeRecent = false;
      this.sync();
      this.listEl.scrollTop = 0;
    });
    this.listEl.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-bp-row');
      const b = row?.dataset.key ? brushStore.brush(row.dataset.key) : null;
      if (b) this.pick(b);
    });
    this.listEl.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-bp-row');
      if (row?.dataset.key) this.openCard(row.dataset.key);
    });
    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>('.fm-bp-row'), set = t.closest<HTMLElement>('.fm-bp-set');
      if (row?.dataset.key) this.openMenu(e.clientX, e.clientY, { kind: 'brush', id: row.dataset.key });
      else if (set && set.dataset.set && set.dataset.set !== RECENT) this.openMenu(e.clientX, e.clientY, { kind: 'set', id: set.dataset.set });
    });
    this.menuEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.fm-bp-mi');
      if (b?.dataset.act) this.runAct(b.dataset.act as Act);
    });
    for (const btn of Array.from(this.root.querySelectorAll<HTMLElement>('.fm-bp-tool'))) {
      btn.addEventListener('click', (e) => {
        const act = btn.dataset.act;
        if (act === 'import') this.fileEl.click();
        else if (act === 'newset') this.newSet();
        else { const r = btn.getBoundingClientRect(); this.openMenu(r.left, r.bottom + 4, { kind: 'panel', id: '' }); }
        e.stopPropagation();
      });
    }
    this.searchEl.addEventListener('input', () => this.onSearch());
    this.searchEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = this.items()[0];
      if (first) this.pick(first);
    });
    this.clearEl.addEventListener('click', () => { this.searchEl.value = ''; this.onSearch(); this.searchEl.focus(); });
    this.renameEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.endRename(true);
      else if (e.key === 'Escape') this.endRename(false);
    });
    this.renameEl.addEventListener('blur', () => this.endRename(true));
    this.fileEl.addEventListener('change', () => { const f = Array.from(this.fileEl.files ?? []); this.fileEl.value = ''; void this.importFiles(f); });
    this.root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    this.root.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void this.importFiles(files);
    });
    q(this.cardEl, '.fm-bp-card-done').addEventListener('click', () => this.closeCard());
    this.cardEl.addEventListener('input', (e) => {
      const inp = e.target as HTMLInputElement;
      if (inp.dataset.k) this.applySlider(inp.dataset.k, Number(inp.value));
    });
    this.wireDrag();
  }

  private dirty = false;
  private revealPending = false;

  open(anchor: HTMLElement, tool: Tool, currentId: string): void {
    this.anchor = anchor;
    this.currentId = currentId;
    this.root.dataset.tool = tool;
    this.searchEl.value = '';
    const home = brushStore.setOf(currentId);
    this.activeSet = home ? home.id : (this.recent.length ? RECENT : (brushStore.sets()[0]?.id ?? RECENT));
    this.freezeRecent = false;
    if (!this.root.parentElement) (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    this.root.hidden = false;
    this.closeMenu();
    this.closeCard();
    this.place();
    this.revealPending = true;
    this.sync();
    this.dirty = false;
    this.opened = true;
    document.addEventListener('pointerdown', this.onDown, true);
    document.addEventListener('keydown', this.onKey, true);
    const sel = this.listEl.querySelector<HTMLElement>('.fm-bp-row.is-selected');
    sel?.scrollIntoView({ block: 'center' });
  }

  close(): void {
    if (!this.opened) return;
    this.endRename(true);
    this.opened = false;
    this.root.hidden = true;
    this.anchor = null;
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
  }

  isOpen(): boolean { return this.opened; }

  private place(): void {
    const a = this.anchor;
    if (!a) return;
    const host = (this.root.offsetParent as HTMLElement | null) ?? document.body;
    const hr = host.getBoundingClientRect(), ar = a.getBoundingClientRect();
    const w = this.root.offsetWidth || 320;
    const left = Math.max(8, ar.right - hr.left - w);
    const top = ar.bottom - hr.top + 8;
    const height = Math.max(260, host.clientHeight - top - 12);
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.height = `${Math.round(height)}px`;
  }

  private onSearch(): void {
    setHidden(this.clearEl, !this.searchEl.value);
    this.freezeRecent = false;
    this.sync();
    this.listEl.scrollTop = 0;
  }

  private searching(): boolean { return this.searchEl.value.trim().length > 0; }

  private items(): Brush[] {
    if (this.searching()) {
      const s = this.searchEl.value.trim().toLowerCase();
      return brushStore.all().filter((b) => b.name.toLowerCase().includes(s) || b.set.toLowerCase().includes(s));
    }
    if (this.activeSet === RECENT) {
      const out: Brush[] = [];
      for (const id of this.recent) { const b = brushStore.brush(id); if (b) out.push(b); }
      return out;
    }
    return brushStore.brushesOf(this.activeSet);
  }

  /** Patches the set rows, the brush rows and the empty note in place. */
  private sync(): void {
    const searching = this.searching();
    if (!searching && this.activeSet !== RECENT && !brushStore.set(this.activeSet)) this.activeSet = brushStore.sets()[0]?.id ?? RECENT;
    setHidden(this.clearEl, !searching);
    setClass(this.setsEl, 'is-dim', searching);
    const sets: { id: string; name: string; recent: boolean }[] = [{ id: RECENT, name: 'Recent', recent: true }, ...brushStore.sets().map((s: BrushSet) => ({ id: s.id, name: s.id === IMPORTED_ID ? 'Imported' : s.name, recent: false }))];
    patchList(this.setsEl, sets, {
      key: (s) => s.id,
      create: (s) => {
        const row = el<HTMLElement>(`<div class="fm-bp-set" role="button" tabindex="-1" data-set="${s.id}"${s.recent ? '' : ' draggable="true"'}><span class="fm-bp-set-ico">${s.recent ? ICON_RECENT : ICON_SET}</span><span class="fm-bp-set-name"></span></div>`);
        setText(q(row, '.fm-bp-set-name'), s.name);
        setClass(row, 'is-active', !searching && s.id === this.activeSet);
        return row;
      },
      update: (row, s) => {
        setText(q(row, '.fm-bp-set-name'), s.name);
        setClass(row, 'is-active', !searching && s.id === this.activeSet);
      },
    });
    const items = this.items();
    patchList(this.listEl, items, {
      key: (b) => b.id,
      create: (b) => {
        const row = el<HTMLElement>('<div class="fm-bp-row" draggable="true"><span class="fm-bp-name"></span><span class="fm-bp-tag"></span></div>');
        row.dataset.key = b.id;
        row.insertBefore(this.previewOf(b), row.firstChild);
        setText(q(row, '.fm-bp-name'), b.name);
        setClass(row, 'is-selected', b.id === this.currentId);
        setText(q(row, '.fm-bp-tag'), searching ? b.set : '');
        return row;
      },
      update: (row, b) => {
        const prev = row.querySelector<HTMLCanvasElement>('.fm-bp-prev');
        if (prev) this.previewOf(b);
        setText(q(row, '.fm-bp-name'), b.name);
        setClass(row, 'is-selected', b.id === this.currentId);
        setText(q(row, '.fm-bp-tag'), searching ? b.set : '');
      },
    });
    if (this.revealPending) {
      this.revealPending = false;
      this.setsEl.querySelector<HTMLElement>('.fm-bp-set.is-active')?.scrollIntoView({ block: 'nearest' });
    }
    setHidden(this.emptyEl, items.length > 0);
    setText(this.emptyEl, searching ? 'No brushes found' : this.activeSet === RECENT ? 'No recent brushes yet' : 'No brushes in this set');
  }

  /** The stroke preview canvas of a brush, painted again in place when the brush changed. */
  private previewOf(b: Brush): HTMLCanvasElement {
    const rev = brushStore.rev(b.id);
    let p = this.previews.get(b.id);
    if (p && p.rev === rev) return p.canvas;
    if (!p) {
      const c = document.createElement('canvas');
      c.className = 'fm-bp-prev';
      c.width = PW * SCALE;
      c.height = PH * SCALE;
      p = { canvas: c, rev: -1, set: b.set };
      this.previews.set(b.id, p);
    }
    p.rev = rev;
    paintPreview(p.canvas, b);
    return p.canvas;
  }

  private pick(b: Brush): void {
    this.currentId = b.id;
    this.pushRecent(b.id);
    // Keep the Recent order still while the user is looking at it.
    if (this.activeSet === RECENT && !this.searching()) this.freezeRecent = true;
    for (const row of Array.from(this.listEl.children) as HTMLElement[]) setClass(row, 'is-selected', row.dataset.key === b.id);
    this.opts.onPick(b);
  }

  // ---- management ---------------------------------------------------------------

  private openMenu(x: number, y: number, target: { kind: 'brush' | 'set' | 'panel'; id: string }): void {
    this.menuTarget = target;
    let acts: Act[];
    if (target.kind === 'brush') acts = ['pressure', 'rename', 'duplicate', 'up', 'down', 'delete'];
    else if (target.kind === 'set') acts = ['rename', 'duplicate', 'up', 'down', 'delete'];
    else acts = ['import', 'newset', 'restore'];
    if (target.kind === 'set' && target.id === IMPORTED_ID) acts = ['up', 'down'];
    this.menuItems.forEach((b, i) => {
      const a = acts[i];
      setHidden(b, !a);
      if (!a) return;
      b.dataset.act = a;
      setText(b, target.kind === 'set' && a === 'delete' ? 'Delete set' : target.kind === 'set' && a === 'rename' ? 'Rename set' : target.kind === 'set' && a === 'duplicate' ? 'Duplicate set' : LABEL[a]);
      setClass(b, 'is-danger', a === 'delete');
    });
    const host = this.root.getBoundingClientRect();
    this.menuEl.hidden = false;
    const mw = this.menuEl.offsetWidth, mh = this.menuEl.offsetHeight;
    const left = Math.min(Math.max(4, x - host.left), host.width - mw - 4);
    const top = Math.min(Math.max(4, y - host.top), host.height - mh - 4);
    this.menuEl.style.left = `${Math.round(left)}px`;
    this.menuEl.style.top = `${Math.round(top)}px`;
  }

  private closeMenu(): void { setHidden(this.menuEl, true); }

  private runAct(act: Act): void {
    const t = this.menuTarget;
    this.closeMenu();
    if (!t) return;
    if (t.kind === 'panel') {
      if (act === 'import') this.fileEl.click();
      else if (act === 'newset') this.newSet();
      else if (act === 'restore') { brushStore.resetAll(); this.activeSet = brushStore.sets()[0]?.id ?? RECENT; this.sync(); this.note('Starter brushes restored'); }
      return;
    }
    if (t.kind === 'brush') {
      if (act === 'pressure') this.openCard(t.id);
      else if (act === 'rename') this.beginRename('brush', t.id);
      else if (act === 'duplicate') brushStore.duplicate(t.id);
      else if (act === 'delete') brushStore.remove(t.id);
      else if (act === 'up') brushStore.step(t.id, -1);
      else if (act === 'down') brushStore.step(t.id, 1);
      return;
    }
    if (act === 'rename') this.beginRename('set', t.id);
    else if (act === 'duplicate') { const id = brushStore.duplicateSet(t.id); if (id) this.activeSet = id; this.sync(); }
    else if (act === 'delete') brushStore.removeSet(t.id);
    else if (act === 'up') brushStore.stepSet(t.id, -1);
    else if (act === 'down') brushStore.stepSet(t.id, 1);
  }

  private newSet(): void {
    const id = brushStore.addSet('New set');
    this.activeSet = id;
    this.searchEl.value = '';
    this.sync();
    this.beginRename('set', id);
  }

  private beginRename(kind: 'brush' | 'set', id: string): void {
    const host = kind === 'brush' ? this.listEl.querySelector<HTMLElement>(`.fm-bp-row[data-key="${id}"]`) : this.setsEl.querySelector<HTMLElement>(`.fm-bp-set[data-set="${id}"]`);
    if (!host) return;
    const r = host.getBoundingClientRect(), pr = this.root.getBoundingClientRect();
    this.renaming = { kind, id };
    this.renameEl.value = kind === 'brush' ? (brushStore.brush(id)?.name ?? '') : (brushStore.set(id)?.name ?? '');
    this.renameEl.style.left = `${Math.round(r.left - pr.left)}px`;
    this.renameEl.style.top = `${Math.round(r.top - pr.top + (kind === 'brush' ? 2 : 0))}px`;
    this.renameEl.style.width = `${Math.round(kind === 'brush' ? Math.min(r.width, 180) : r.width)}px`;
    this.renameEl.hidden = false;
    this.renameEl.focus();
    this.renameEl.select();
  }

  private endRename(commit: boolean): void {
    const r = this.renaming;
    if (!r) return;
    this.renaming = null;
    const v = this.renameEl.value;
    this.renameEl.hidden = true;
    if (!commit) return;
    if (r.kind === 'brush') brushStore.rename(r.id, v); else brushStore.renameSet(r.id, v);
  }

  private async importFiles(files: File[]): Promise<void> {
    let added = 0, failed = 0, last = '';
    for (const f of files) {
      try {
        const r = await importBrushFile(f);
        if (r.brushes.length) { brushStore.addImported(r.brushes); added += r.brushes.length; } else failed++;
      } catch (e) { failed++; last = e instanceof Error ? e.message : ''; }
    }
    if (added) { this.activeSet = IMPORTED_ID; this.searchEl.value = ''; this.revealPending = true; this.sync(); this.listEl.scrollTop = 0; }
    this.note(added ? tn(added, 'Imported {n} brush', 'Imported {n} brushes') : (last || t('No brushes found in that file')));
    if (added && failed) this.note(`${tn(added, 'Imported {n} brush', 'Imported {n} brushes')}, ${tn(failed, '{n} skipped', '{n} skipped')}`);
  }

  private note(text: string): void {
    setText(this.noteEl, text);
    setHidden(this.noteEl, !text);
    if (this.noteTimer) window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => { setHidden(this.noteEl, true); }, 4000);
  }

  // ---- drag to reorder ----------------------------------------------------------

  private wireDrag(): void {
    const clear = (): void => { for (const n of Array.from(this.root.querySelectorAll('.is-drop, .is-drop-after'))) n.classList.remove('is-drop', 'is-drop-after'); };
    this.root.addEventListener('dragstart', (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>('.fm-bp-row'), set = t.closest<HTMLElement>('.fm-bp-set');
      if (row?.dataset.key) { this.dragging = { kind: 'brush', id: row.dataset.key }; e.dataTransfer?.setData(DRAG_BRUSH, row.dataset.key); }
      else if (set?.dataset.set && set.dataset.set !== RECENT) { this.dragging = { kind: 'set', id: set.dataset.set }; e.dataTransfer?.setData(DRAG_SET, set.dataset.set); }
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    this.root.addEventListener('dragover', (e) => {
      const d = this.dragging;
      if (!d) return;
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>('.fm-bp-row'), set = t.closest<HTMLElement>('.fm-bp-set');
      clear();
      if (d.kind === 'brush' && row && !this.searching() && this.activeSet !== RECENT && row.dataset.key !== d.id) {
        e.preventDefault();
        const r = row.getBoundingClientRect();
        row.classList.add(e.clientY > r.top + r.height / 2 ? 'is-drop-after' : 'is-drop');
      } else if (d.kind === 'brush' && set && set.dataset.set !== RECENT) { e.preventDefault(); set.classList.add('is-drop'); }
      else if (d.kind === 'set' && set && set.dataset.set !== RECENT && set.dataset.set !== d.id) { e.preventDefault(); set.classList.add('is-drop'); }
    });
    this.root.addEventListener('dragleave', (e) => { if (!this.root.contains(e.relatedTarget as Node | null)) clear(); });
    this.root.addEventListener('dragend', () => { this.dragging = null; clear(); });
    this.root.addEventListener('drop', (e) => {
      const d = this.dragging;
      this.dragging = null;
      clear();
      if (!d) return;
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>('.fm-bp-row'), set = t.closest<HTMLElement>('.fm-bp-set');
      e.preventDefault();
      if (d.kind === 'brush') {
        if (row?.dataset.key && row.dataset.key !== d.id && this.activeSet !== RECENT && !this.searching()) {
          const r = row.getBoundingClientRect();
          const after = e.clientY > r.top + r.height / 2;
          const ids = brushStore.set(this.activeSet)?.ids ?? [];
          const at = ids.indexOf(row.dataset.key);
          const before = after ? (ids[at + 1] ?? null) : row.dataset.key;
          if (before !== d.id) brushStore.move(d.id, this.activeSet, before);
        } else if (set?.dataset.set && set.dataset.set !== RECENT) brushStore.move(d.id, set.dataset.set, null);
      } else if (set?.dataset.set && set.dataset.set !== RECENT && set.dataset.set !== d.id) brushStore.moveSet(d.id, set.dataset.set);
    });
  }

  // ---- Pressure & Smoothing card -------------------------------------------------

  private openCard(id: string): void {
    const b = brushStore.brush(id);
    if (!b) return;
    this.cardId = id;
    setText(this.cardName, b.name);
    this.syncSliders(b);
    this.cardEl.hidden = false;
    this.drawCard();
  }

  private closeCard(): void { setHidden(this.cardEl, true); this.cardId = ''; }

  private syncSliders(b: Brush): void {
    const set = (k: string, v: number): void => { const s = this.sliders[k]; if (!s) return; const r = String(Math.round(v)); if (s.input.value !== r) s.input.value = r; setText(s.out, r); };
    set('pressureSize', (1 - b.pressureSize[0]) * 100);
    set('pressureFlow', (1 - b.pressureFlow[0]) * 100);
    set('pressureGamma', (Math.log((b.pressureGamma ?? 1) / 0.4) / Math.log(6.25)) * 100);
    set('stabilization', b.stabilization ?? 0);
    set('motionFilter', b.motionFilter ?? 0);
    set('expression', b.expression ?? 0);
  }

  private applySlider(k: string, v: number): void {
    const b = brushStore.brush(this.cardId);
    if (!b) return;
    if (k === 'pressureSize') brushStore.edit(this.cardId, { pressureSize: [Math.max(0.02, 1 - v / 100), b.pressureSize[1]] });
    else if (k === 'pressureFlow') brushStore.edit(this.cardId, { pressureFlow: [Math.max(0.02, 1 - v / 100), b.pressureFlow[1]] });
    else if (k === 'pressureGamma') brushStore.edit(this.cardId, { pressureGamma: Math.round(0.4 * Math.pow(6.25, v / 100) * 100) / 100 });
    else if (k === 'stabilization' || k === 'motionFilter' || k === 'expression') brushStore.edit(this.cardId, { [k]: v } as Partial<Brush>);
    const nb = brushStore.brush(this.cardId);
    if (nb) this.syncSliders(nb);
    if (!this.cardRaf) this.cardRaf = requestAnimationFrame(() => { this.cardRaf = 0; this.drawCard(); });
  }

  private drawCard(): void {
    const b = brushStore.brush(this.cardId);
    if (b) paintPreview(this.cardPrev, b, 280, 56);
  }

  // ---- recent -------------------------------------------------------------------

  private pushRecent(id: string): void {
    if (this.freezeRecent && this.recent.includes(id)) return;
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent)); } catch { /* storage may be blocked */ }
  }

  private loadRecent(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      if (Array.isArray(raw)) this.recent = raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX);
    } catch { this.recent = []; }
  }
}

function paintPreview(c: HTMLCanvasElement, b: Brush, w = PW, h = PH): void {
  try {
    const r = renderBrushPreview(b, w * SCALE, h * SCALE, { r: 255, g: 255, b: 255 });
    c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  } catch { /* an empty preview is acceptable */ }
}
