// The floating Flipbook frame strip (Phase 5): rows of frame cells under a ruler, bottom centre of the Draw & Paint view.
// Built once; refresh() patches rows and cells in place by key and never rebuilds a mounted subtree.
import { addFlipTrack, clearFrame, deleteFlipTrack, deleteFrame, duplicateFrame, insertFrame, moveFlipTrack, pasteFrames, patchFlipTrack, setHold } from '../engine/flip-ops';
import { flipLength, flipStartOf } from '../engine/model';
import type { Content, FlipTrack, FlipbookFrame } from '../engine/types';
import { el, patchList, q, setClass, setHidden, setStyleVar, setText } from './dom';
import { icon } from './icons';
import { Popover, popField, popRow, popSep } from './popover';

export interface StripHost {
  content(): Content | null;
  row(): number;
  index(): number;
  select(row: number, index: number): void;
  run(label: string, fn: (c: Content) => Content, merge?: string): void;
  playing(): boolean;
  togglePlay(): void;
  thumb(row: number, index: number, w: number, h: number): CanvasImageSource | null;
  fps(): number;
}

const COL = 36;
const CELL_H = 26;
const TW = 68;
const TH = 52;
const LONG_PRESS = 500;

/** Shared across strips: copied frames stay until the next copy. */
let clipboard: FlipbookFrame[] = [];

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
const ICO = {
  cut: svg('<circle cx="6" cy="18" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M7.6 16 18 4M16.4 16 6 4"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V5.7a2.2 2.2 0 0 0-2.2-2.2H5.7a2.2 2.2 0 0 0-2.2 2.2v7.6a2.2 2.2 0 0 0 2.2 2.2h2.8"/>'),
  paste: svg('<rect x="5" y="5" width="14" height="16" rx="2.2"/><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 12h6M9 16h4"/>'),
  dup: svg('<rect x="3.5" y="7" width="11" height="13" rx="2.2"/><path d="M9 4h9a2.5 2.5 0 0 1 2.5 2.5V16"/>'),
  tracks: svg('<rect x="3" y="4" width="18" height="4.4" rx="1.4"/><rect x="3" y="10" width="18" height="4.4" rx="1.4"/><rect x="3" y="16" width="18" height="4.4" rx="1.4"/>'),
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
};
const glyph = (s: string, size = 16): string => `<span class="icon" style="width:${size}px;height:${size}px" aria-hidden="true">${s}</span>`;

interface RowItem { t: FlipTrack; r: number }
interface CellItem { f: FlipbookFrame; r: number; i: number; start: number; t: FlipTrack }

export class FlipStrip {
  readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly playIco: HTMLElement;
  private readonly playLab: HTMLElement;
  private readonly ruler: HTMLElement;
  private readonly rulerInner: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly cellMenu: Popover;
  private readonly rowMenu: Popover;
  private readonly shots = new WeakMap<HTMLElement, HTMLCanvasElement>();
  private sx = 0;
  private laneW = 400;
  private cols = 0;
  private lastSel = '';
  private cellTarget: { track: string; frame: string } | null = null;
  private rowTarget: string | null = null;
  private pressTimer = 0;
  private suppressClick = false;
  private ro: ResizeObserver | null = null;
  private readonly cm: {
    cut: ReturnType<typeof tile>; copy: ReturnType<typeof tile>; paste: ReturnType<typeof tile>; dup: ReturnType<typeof tile>;
    hold: ReturnType<typeof popField>; clear: ReturnType<typeof popRow>; del: ReturnType<typeof popRow>; ins: ReturnType<typeof popRow>;
  };
  private readonly rm: {
    rename: ReturnType<typeof popRow>; toggle: ReturnType<typeof popRow>; up: ReturnType<typeof popRow>; down: ReturnType<typeof popRow>; del: ReturnType<typeof popRow>;
    range: HTMLInputElement; pct: HTMLElement;
  };

  constructor(private readonly host: StripHost) {
    this.root = el<HTMLElement>(
      `<div class="fm-fs" tabindex="0" role="group" aria-label="Flipbook frames">` +
        `<div class="fm-fs-head"><button class="fm-fs-play" type="button"><span class="fm-fs-play-ico"></span><span class="fm-fs-play-lab">Play</span></button>` +
        `<span class="fm-fs-grip" aria-hidden="true"></span>` +
        `<button class="fm-fs-ib" data-act="track" type="button" title="Add track" aria-label="Add track">${glyph(ICO.tracks, 18)}</button>` +
        `<button class="fm-fs-ib" data-act="frame" type="button" title="Add frame" aria-label="Add frame">${icon('plus', 18)}</button></div>` +
        `<div class="fm-fs-body"><div class="fm-fs-rulerrow"><div class="fm-fs-corner"></div><div class="fm-fs-ruler"><div class="fm-fs-ruler-in"></div></div></div>` +
        `<div class="fm-fs-rows"></div></div></div>`);
    this.head = q(this.root, '.fm-fs-head');
    this.playBtn = q(this.root, '.fm-fs-play');
    this.playIco = q(this.root, '.fm-fs-play-ico');
    this.playLab = q(this.root, '.fm-fs-play-lab');
    this.ruler = q(this.root, '.fm-fs-ruler');
    this.rulerInner = q(this.root, '.fm-fs-ruler-in');
    this.rows = q(this.root, '.fm-fs-rows');

    this.cellMenu = new Popover('fm-fs-menu', 232);
    this.rowMenu = new Popover('fm-fs-menu', 232);
    this.cm = this.buildCellMenu();
    this.rm = this.buildRowMenu();
    this.wire();
    this.ro = new ResizeObserver(() => { this.measure(); this.paint(); });
    this.ro.observe(this.ruler);
    this.refresh();
  }

  /** Forget drawn thumbnails so the next refresh draws them all again. */
  invalidate(): void {
    for (const n of Array.from(this.rows.querySelectorAll<HTMLElement>('.fm-fs-cell'))) delete n.dataset.sig;
    this.refresh();
  }

  refresh(): void { this.paint(); }

  dispose(): void {
    window.clearTimeout(this.pressTimer);
    this.ro?.disconnect();
    this.cellMenu.hide();
    this.rowMenu.hide();
    this.cellMenu.el.remove();
    this.rowMenu.el.remove();
    this.root.remove();
  }

  // ---- painting ----

  private measure(): void {
    const w = this.ruler.clientWidth;
    if (w > 0) this.laneW = w;
  }

  private clampScroll(): void {
    const max = Math.max(0, this.cols * COL - this.laneW + COL);
    this.sx = Math.max(0, Math.min(max, this.sx));
  }

  private paint(): void {
    const c = this.host.content();
    const list = c?.flip ?? [];
    const ar = this.host.row();
    const ai = this.host.index();
    this.cols = list.reduce((m, t) => Math.max(m, flipLength(t)), 0);
    const active = list[ar];
    const aStart = active ? flipStartOf(active, ai) : 0;
    const aHold = active?.frames[ai] ? Math.max(1, active.frames[ai].hold) : 1;

    const playing = this.host.playing();
    this.playBtn.classList.toggle('is-playing', playing);
    if (this.playIco.dataset.on !== (playing ? '1' : '0')) {
      this.playIco.dataset.on = playing ? '1' : '0';
      this.playIco.replaceChildren(el(glyph(playing ? ICO.pause : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5z"/></svg>', 14)));
    }
    setText(this.playLab, playing ? 'Pause' : 'Play');

    this.measure();
    const sel = `${active?.id ?? ''}:${ai}`;
    if (sel !== this.lastSel) {
      this.lastSel = sel;
      const from = aStart * COL;
      const to = (aStart + aHold) * COL;
      if (from < this.sx) this.sx = from;
      else if (to > this.sx + this.laneW) this.sx = Math.min(from, to - this.laneW);
    }
    this.clampScroll();
    setStyleVar(this.root, '--sx', `${-this.sx}px`);

    // ruler: one tiny node per column, keyed by column number
    const nums: number[] = [];
    for (let n = 1; n <= this.cols; n++) nums.push(n);
    patchList(this.rulerInner, nums, {
      key: (n) => String(n),
      create: (n) => { const s = el(`<span class="fm-fs-num">${n}</span>`); setClass(s, 'is-cur', n > aStart && n <= aStart + aHold); return s; },
      update: (node, n) => setClass(node, 'is-cur', n > aStart && n <= aStart + aHold),
    });
    setStyleVar(this.rulerInner, 'width', `${this.cols * COL}px`);

    const items: RowItem[] = list.map((t, r) => ({ t, r }));
    patchList(this.rows, items, {
      key: (it) => it.t.id,
      create: (it) => { const n = this.createRow(it); this.updateRow(n, it, ar, ai); return n; },
      update: (node, it) => this.updateRow(node, it, ar, ai),
    });
    setClass(this.rows, 'is-scroll', list.length > 3);
    setHidden(this.root, !c);
  }

  private createRow(_it: RowItem): HTMLElement {
    return el<HTMLElement>(
      `<div class="fm-fs-row"><div class="fm-fs-label"><input class="fm-fs-vis" type="checkbox" aria-label="Visible">` +
        `<span class="fm-fs-name"></span><input class="fm-fs-rename" type="text" spellcheck="false" hidden></div>` +
        `<div class="fm-fs-lane"><div class="fm-fs-lane-in"></div></div></div>`);
  }

  private updateRow(node: HTMLElement, it: RowItem, ar: number, ai: number): void {
    const { t, r } = it;
    const label = q<HTMLElement>(node, '.fm-fs-label');
    const vis = q<HTMLInputElement>(node, '.fm-fs-vis');
    if (vis.checked !== !t.hidden) vis.checked = !t.hidden;
    setText(q(node, '.fm-fs-name'), t.name);
    setClass(label, 'is-active', r === ar);
    setClass(node, 'is-hidden', t.hidden);
    if (label.dataset.hl !== t.highlight) label.dataset.hl = t.highlight;
    const inner = q<HTMLElement>(node, '.fm-fs-lane-in');
    const lo = Math.floor(this.sx / COL) - 6;
    const hi = Math.ceil((this.sx + this.laneW) / COL) + 6;
    let start = 0;
    const cells: CellItem[] = t.frames.map((f, i) => {
      const it2 = { f, r, i, start, t };
      start += Math.max(1, f.hold);
      return it2;
    });
    const upd = (cell: HTMLElement, c: CellItem): void => {
      const hold = Math.max(1, c.f.hold);
      setStyleVar(cell, 'width', `${hold * COL - 2}px`);
      setClass(cell, 'is-cur', c.r === ar && c.i === ai);
      setClass(cell, 'is-held', hold > 1);
      setText(q(cell, '.fm-fs-hold'), hold > 1 ? `×${hold}` : '');
      if (c.start + hold >= lo && c.start <= hi) this.drawCell(cell, c);
    };
    patchList(inner, cells, {
      key: (c) => c.f.id,
      create: (c) => { const n = el<HTMLElement>(`<div class="fm-fs-cell"><span class="fm-fs-hold"></span></div>`); upd(n, c); return n; },
      update: upd,
    });
  }

  private drawCell(cell: HTMLElement, c: CellItem): void {
    const sig = c.f.layers.map((l) => `${l.id}:${l.pixels ?? ''}:${l.visible ? 1 : 0}:${l.opacity}`).join('|') + `#${Math.max(1, c.f.hold)}`;
    if (cell.dataset.sig === sig) return;
    let cv = this.shots.get(cell);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = TW;
      cv.height = TH;
      cv.className = 'fm-fs-shot';
      cell.insertBefore(cv, cell.firstChild);
      this.shots.set(cell, cv);
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (c.f.layers.every((l) => l.pixels === null)) {
      ctx.clearRect(0, 0, TW, TH);
      cell.dataset.sig = sig;
      return;
    }
    const src = this.host.thumb(c.r, c.i, TW, TH);
    if (!src) return;
    const s = src as unknown as { width: number; height: number };
    const k = Math.min(TW / (s.width || TW), TH / (s.height || TH));
    const w = (s.width || TW) * k;
    const h = (s.height || TH) * k;
    ctx.clearRect(0, 0, TW, TH);
    ctx.drawImage(src, (TW - w) / 2, (TH - h) / 2, w, h);
    cell.dataset.sig = sig;
  }

  // ---- lookup ----

  private find(trackId: string, frameId?: string): { c: Content; r: number; i: number; t: FlipTrack } | null {
    const c = this.host.content();
    if (!c) return null;
    const r = c.flip.findIndex((t) => t.id === trackId);
    if (r < 0) return null;
    const t = c.flip[r];
    const i = frameId ? t.frames.findIndex((f) => f.id === frameId) : -1;
    return { c, r, i, t };
  }

  private cellAt(n: HTMLElement | null): { track: string; frame: string } | null {
    const cell = n?.closest<HTMLElement>('.fm-fs-cell');
    const row = cell?.closest<HTMLElement>('.fm-fs-row');
    if (!cell || !row || !cell.dataset.key || !row.dataset.key) return null;
    return { track: row.dataset.key, frame: cell.dataset.key };
  }

  // ---- edits ----

  private clampSel(r: number, i: number): void {
    const c = this.host.content();
    if (!c || !c.flip.length) return;
    const row = Math.max(0, Math.min(c.flip.length - 1, r));
    this.host.select(row, Math.max(0, Math.min(c.flip[row].frames.length - 1, i)));
  }

  private addFrame(): void {
    const r = this.host.row(), i = this.host.index();
    this.host.run('Add frame', (c) => insertFrame(c, r, i));
    this.clampSel(r, i + 1);
  }

  private addTrack(): void {
    const fps = this.host.fps();
    this.host.run('Add track', (c) => addFlipTrack(c, fps));
    this.clampSel(0, this.host.index());
  }

  private step(d: number): void {
    const c = this.host.content();
    const t = c?.flip[this.host.row()];
    if (!t) return;
    const i = Math.max(0, Math.min(t.frames.length - 1, this.host.index() + d));
    if (i !== this.host.index()) this.host.select(this.host.row(), i);
  }

  /** Index the active frame ends up at after the frame list of the active row changed at `at`. */
  private cellAction(kind: 'cut' | 'copy' | 'paste' | 'dup' | 'ins' | 'clear' | 'del'): void {
    const tg = this.cellTarget;
    const hit = tg ? this.find(tg.track, tg.frame) : null;
    this.cellMenu.hide();
    if (!hit || hit.i < 0) return;
    const { r, i, t } = hit;
    const onRow = r === this.host.row();
    const act = this.host.index();
    const frame = t.frames[i];
    const afterInsert = (n: number): void => {
      // frames were added after i: the active frame shifts only when it sits after the target
      const base = onRow && act > i ? act + n : onRow ? act : this.host.index();
      this.clampSel(r, onRow && act === i ? i + 1 : base);
    };
    switch (kind) {
      case 'copy': clipboard = [frame]; break;
      case 'cut':
        clipboard = [frame];
        this.host.run('Cut frame', (c) => deleteFrame(c, r, i));
        this.clampSel(r, onRow ? (act > i ? act - 1 : Math.min(act, i)) : this.host.index());
        break;
      case 'paste':
        if (!clipboard.length) return;
        { const items = clipboard; this.host.run('Paste frames', (c) => pasteFrames(c, r, i, items)); afterInsert(items.length); }
        break;
      case 'dup': this.host.run('Duplicate frame', (c) => duplicateFrame(c, r, i)); afterInsert(1); break;
      case 'ins': this.host.run('Insert frame', (c) => insertFrame(c, r, i)); afterInsert(1); break;
      case 'clear': this.host.run('Clear frame', (c) => clearFrame(c, r, i)); this.host.select(r, onRow ? act : i); break;
      case 'del':
        this.host.run('Delete frame', (c) => deleteFrame(c, r, i));
        this.clampSel(r, onRow ? (act > i ? act - 1 : Math.min(act, i)) : this.host.index());
        break;
    }
  }

  private commitHold(): void {
    const tg = this.cellTarget;
    const hit = tg ? this.find(tg.track, tg.frame) : null;
    const n = parseInt(this.cm.hold.input.value, 10);
    this.cellMenu.hide();
    if (!hit || hit.i < 0 || !Number.isFinite(n)) return;
    this.host.run('Frame duration', (c) => setHold(c, hit.r, hit.i, n));
    this.host.select(this.host.row(), this.host.index());
  }

  private rowAction(kind: 'rename' | 'toggle' | 'up' | 'down' | 'del'): void {
    const id = this.rowTarget;
    const hit = id ? this.find(id) : null;
    this.rowMenu.hide();
    if (!hit) return;
    const { r, t } = hit;
    const wasActive = r === this.host.row();
    const activeId = this.host.content()?.flip[this.host.row()]?.id ?? '';
    const follow = (): void => {
      const c = this.host.content();
      const nr = c ? c.flip.findIndex((x) => x.id === activeId) : -1;
      if (nr >= 0 && c && nr !== this.host.row()) this.clampSel(nr, this.host.index());
    };
    switch (kind) {
      case 'rename': this.startRename(id as string); break;
      case 'toggle': this.host.run(t.hidden ? 'Show track' : 'Hide track', (c) => patchFlipTrack(c, r, { hidden: !t.hidden })); break;
      case 'up': if (r > 0) { this.host.run('Move track up', (c) => moveFlipTrack(c, r, r - 1)); follow(); } break;
      case 'down': this.host.run('Move track down', (c) => moveFlipTrack(c, r, r + 1)); follow(); break;
      case 'del':
        if (hit.c.flip.length <= 1) return;
        this.host.run('Delete track', (c) => deleteFlipTrack(c, r));
        if (wasActive) this.clampSel(Math.min(r, hit.c.flip.length - 2), 0);
        else follow();
        break;
    }
  }

  private startRename(id: string): void {
    const row = this.rows.querySelector<HTMLElement>(`.fm-fs-row[data-key="${CSS.escape(id)}"]`);
    const hit = this.find(id);
    if (!row || !hit) return;
    const inp = q<HTMLInputElement>(row, '.fm-fs-rename');
    const name = q<HTMLElement>(row, '.fm-fs-name');
    inp.value = hit.t.name;
    inp.hidden = false;
    name.hidden = true;
    inp.focus();
    inp.select();
    let done = false;
    const end = (commit: boolean): void => {
      if (done) return;
      done = true;
      inp.removeEventListener('keydown', onKey);
      inp.removeEventListener('blur', onBlur);
      const v = inp.value.trim();
      inp.hidden = true;
      name.hidden = false;
      const cur = this.find(id);
      if (commit && v && cur && v !== cur.t.name) this.host.run('Rename track', (c) => patchFlipTrack(c, cur.r, { name: v }));
      this.root.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); end(true); }
      else if (e.key === 'Escape') { e.preventDefault(); end(false); }
    };
    const onBlur = (): void => end(true);
    inp.addEventListener('keydown', onKey);
    inp.addEventListener('blur', onBlur);
  }

  // ---- menus ----

  private buildCellMenu(): FlipStrip['cm'] {
    const tiles = el<HTMLElement>('<div class="fm-cm-tiles"></div>');
    const cut = tile(ICO.cut, 'Cut', () => this.cellAction('cut'));
    const copy = tile(ICO.copy, 'Copy', () => this.cellAction('copy'));
    const paste = tile(ICO.paste, 'Paste', () => this.cellAction('paste'));
    const dup = tile(ICO.dup, 'Duplicate', () => this.cellAction('dup'));
    tiles.append(cut.el, copy.el, paste.el, dup.el);
    const ins = popRow('plus', 'Insert frame');
    ins.el.addEventListener('click', () => this.cellAction('ins'));
    const hold = popField('film', 'Frame duration', () => this.commitHold());
    hold.input.inputMode = 'numeric';
    hold.el.append(el('<span class="fm-pop-val">frames</span>'));
    const clear = popRow('eraser', 'Clear frame');
    clear.el.addEventListener('click', () => this.cellAction('clear'));
    const del = popRow('delete', 'Delete frame', { danger: true });
    del.el.addEventListener('click', () => this.cellAction('del'));
    this.cellMenu.body.append(tiles, popSep(), ins.el, hold.el, clear.el, popSep(), del.el);
    return { cut, copy, paste, dup, hold, clear, del, ins };
  }

  private buildRowMenu(): FlipStrip['rm'] {
    const rename = popRow('typeTool', 'Rename');
    rename.el.addEventListener('click', () => this.rowAction('rename'));
    const op = el<HTMLElement>(
      `<div class="fm-cm-opacity"><div class="fm-cm-opacity-head"><span>Opacity</span><span class="fm-cm-pct">100%</span></div>` +
        `<input class="fm-cm-range" type="range" min="0" max="100" step="1" value="100" aria-label="Track opacity"></div>`);
    const range = q<HTMLInputElement>(op, 'input');
    const pct = q<HTMLElement>(op, '.fm-cm-pct');
    range.addEventListener('input', () => {
      const id = this.rowTarget;
      const hit = id ? this.find(id) : null;
      const v = Number(range.value);
      setText(pct, `${v}%`);
      setStyleVar(range, '--fm-pct', `${v}%`);
      if (hit) this.host.run('Track opacity', (c) => patchFlipTrack(c, hit.r, { opacity: v / 100 }), `fs-op-${hit.t.id}`);
    });
    const toggle = popRow('eyeOff', 'Hide');
    toggle.el.addEventListener('click', () => this.rowAction('toggle'));
    const up = popRow('chevronUp', 'Move up');
    up.el.addEventListener('click', () => this.rowAction('up'));
    const down = popRow('chevronDown', 'Move down');
    down.el.addEventListener('click', () => this.rowAction('down'));
    const del = popRow('delete', 'Delete track', { danger: true });
    del.el.addEventListener('click', () => this.rowAction('del'));
    this.rowMenu.body.append(rename.el, op, toggle.el, popSep(), up.el, down.el, popSep(), del.el);
    return { rename, toggle, up, down, del, range, pct };
  }

  private openCellMenu(tg: { track: string; frame: string }, x: number, y: number): void {
    const hit = this.find(tg.track, tg.frame);
    if (!hit || hit.i < 0) return;
    this.rowMenu.hide();
    this.cellTarget = tg;
    this.cm.hold.set(String(Math.max(1, hit.t.frames[hit.i].hold)));
    this.cm.paste.setDisabled(!clipboard.length);
    this.cellMenu.showAt(x, y);
  }

  private openRowMenu(id: string, x: number, y: number): void {
    const hit = this.find(id);
    if (!hit) return;
    this.cellMenu.hide();
    this.rowTarget = id;
    const pct = Math.round(hit.t.opacity * 100);
    this.rm.range.value = String(pct);
    setText(this.rm.pct, `${pct}%`);
    setStyleVar(this.rm.range, '--fm-pct', `${pct}%`);
    this.rm.toggle.setLabel(hit.t.hidden ? 'Show' : 'Hide');
    this.rm.up.setDisabled(hit.r === 0);
    this.rm.down.setDisabled(hit.r === hit.c.flip.length - 1);
    this.rm.del.setDisabled(hit.c.flip.length <= 1);
    this.rowMenu.showAt(x, y);
  }

  // ---- input ----

  private wire(): void {
    this.playBtn.addEventListener('click', () => this.host.togglePlay());
    this.head.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'frame') this.addFrame();
      else if (act === 'track') this.addTrack();
    });

    this.rows.addEventListener('click', (e) => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const t = e.target as HTMLElement;
      if (t.classList.contains('fm-fs-vis')) {
        const id = t.closest<HTMLElement>('.fm-fs-row')?.dataset.key;
        const hit = id ? this.find(id) : null;
        if (hit) this.host.run(hit.t.hidden ? 'Show track' : 'Hide track', (c) => patchFlipTrack(c, hit.r, { hidden: !hit.t.hidden }));
        return;
      }
      if (t.classList.contains('fm-fs-rename')) return;
      const tg = this.cellAt(t);
      if (tg) {
        const hit = this.find(tg.track, tg.frame);
        if (hit && hit.i >= 0) this.host.select(hit.r, hit.i);
        this.root.focus({ preventScroll: true });
        return;
      }
      if (t.closest('.fm-fs-label')) {
        const id = t.closest<HTMLElement>('.fm-fs-row')?.dataset.key;
        const hit = id ? this.find(id) : null;
        if (hit) this.host.select(hit.r, Math.min(this.host.index(), hit.t.frames.length - 1));
        this.root.focus({ preventScroll: true });
      }
    });

    this.rows.addEventListener('contextmenu', (e) => {
      const t = e.target as HTMLElement;
      const tg = this.cellAt(t);
      if (tg) { e.preventDefault(); this.openCellMenu(tg, e.clientX, e.clientY); return; }
      const lab = t.closest('.fm-fs-label');
      const id = lab?.closest<HTMLElement>('.fm-fs-row')?.dataset.key;
      if (id) { e.preventDefault(); this.openRowMenu(id, e.clientX, e.clientY); }
    });

    // long press opens the cell menu on touch and pen
    let sx = 0, sy = 0;
    this.rows.addEventListener('pointerdown', (e) => {
      const tg = this.cellAt(e.target as HTMLElement);
      if (!tg || e.button !== 0 || e.pointerType === 'mouse') return;
      sx = e.clientX; sy = e.clientY;
      window.clearTimeout(this.pressTimer);
      this.pressTimer = window.setTimeout(() => {
        this.suppressClick = true;
        this.openCellMenu(tg, sx, sy);
      }, LONG_PRESS);
    });
    const cancel = (): void => window.clearTimeout(this.pressTimer);
    this.rows.addEventListener('pointerup', cancel);
    this.rows.addEventListener('pointercancel', cancel);
    this.rows.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 6) cancel(); });

    // horizontal pan: wheel over lanes and ruler, drag on the ruler
    this.root.addEventListener('wheel', (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.fm-fs-lane, .fm-fs-ruler, .fm-fs-corner')) return;
      const over = t.closest('.fm-fs-lane');
      const dy = e.deltaY, dx = e.deltaX;
      if (over && !e.shiftKey && Math.abs(dy) > Math.abs(dx) && this.rows.scrollHeight > this.rows.clientHeight + 1) return;
      e.preventDefault();
      this.sx += (Math.abs(dx) > Math.abs(dy) ? dx : dy);
      this.paint();
    }, { passive: false });

    this.ruler.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.ruler.setPointerCapture(e.pointerId);
      let last = e.clientX;
      const move = (m: PointerEvent): void => { this.sx -= m.clientX - last; last = m.clientX; this.paint(); };
      const up = (): void => { this.ruler.removeEventListener('pointermove', move); this.ruler.removeEventListener('pointerup', up); this.ruler.removeEventListener('pointercancel', up); };
      this.ruler.addEventListener('pointermove', move);
      this.ruler.addEventListener('pointerup', up);
      this.ruler.addEventListener('pointercancel', up);
    });

    // drag by the header
    this.head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      const box = this.root.getBoundingClientRect();
      const par = (this.root.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      const dx0 = parseFloat(this.root.style.getPropertyValue('--dx')) || 0;
      const dy0 = parseFloat(this.root.style.getPropertyValue('--dy')) || 0;
      const x0 = e.clientX, y0 = e.clientY;
      this.head.setPointerCapture(e.pointerId);
      this.root.classList.add('is-dragging');
      const move = (m: PointerEvent): void => {
        let dx = dx0 + m.clientX - x0, dy = dy0 + m.clientY - y0;
        if (par) {
          dx = Math.max(par.left - box.left + dx0, Math.min(par.right - box.right + dx0, dx));
          dy = Math.max(par.top - box.top + dy0, Math.min(par.bottom - box.bottom + dy0, dy));
        }
        this.root.style.setProperty('--dx', `${Math.round(dx)}px`);
        this.root.style.setProperty('--dy', `${Math.round(dy)}px`);
      };
      const up = (): void => {
        this.root.classList.remove('is-dragging');
        this.head.removeEventListener('pointermove', move);
        this.head.removeEventListener('pointerup', up);
        this.head.removeEventListener('pointercancel', up);
      };
      this.head.addEventListener('pointermove', move);
      this.head.addEventListener('pointerup', up);
      this.head.addEventListener('pointercancel', up);
    });

    this.root.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === ',') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'ArrowRight' || e.key === '.') { e.preventDefault(); this.step(1); }
    });
  }
}

function tile(svgStr: string, label: string, on: () => void): { el: HTMLButtonElement; setDisabled(v: boolean): void } {
  const b = el<HTMLButtonElement>(`<button class="fm-cm-tile" type="button">${glyph(svgStr, 18)}<span>${label}</span></button>`);
  b.addEventListener('click', on);
  return { el: b, setDisabled: (v) => setClass(b, 'is-disabled', v) };
}
