// The exposure sheet of a Flipbook: movie frames run down the page, the Flipbook's tracks are columns, a cell is a drawing
// (its number where it starts, a line while it is held), then a dialogue column (the sound's waveform scrolling by, the
// mouth shape names of a lip-sync) and a notes column. Holds, order and notes are edited here; everything goes through
// the strip's host, so each action is one undo step. Built once; rows are pooled and patched in place by frame number.
import { copyFrame, deleteFrames, insertFrame, isBlank, moveFrames, setHolds, type FrameRef } from '../engine/flip-ops';
import { nudgeFrame, setNote } from '../engine/flip-time';
import { flipIndexAt, flipLength, flipStartOf } from '../engine/model';
import { srcFrame } from '../engine/retime';
import { soundBlocks } from '../media/audio-edit';
import type { Content, FlipTrack } from '../engine/types';
import { el, patchList, q, setClass, setHidden, setStyleVar, setText, setValue } from './dom';
import type { FlipSelect } from './flip-select';
import { flipServices } from './flip-services';
import type { StripHost } from './flip-strip';

const RH = 22;
const OVERSCAN = 6;

const X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

interface CellModel { t: FlipTrack; r: number; n: number }

export class FlipXSheet {
  readonly root: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly cols: HTMLElement;
  private readonly hrows: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly guide: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly dialName: HTMLElement;
  private lastCur = -1;
  private typed = '';
  private typedAt = 0;
  private readonly asked = new Set<string>();
  private fps = 24;
  onChange: (() => void) | null = null;

  constructor(private readonly host: StripHost, private readonly sel: FlipSelect, private readonly repaint: () => void) {
    this.root = el<HTMLElement>(
      `<div class="fm-xs" hidden tabindex="0" role="grid" aria-label="Exposure sheet">` +
        `<div class="fm-xs-head"><span class="fm-xs-title">Exposure sheet</span><span class="fm-xs-sub"></span>` +
        `<button class="fm-xs-x" type="button" data-act="close" title="Close the exposure sheet" aria-label="Close">${X_ICON}</button></div>` +
        `<div class="fm-xs-scroll"><div class="fm-xs-sheet">` +
          `<div class="fm-xs-cols"><div class="fm-xs-hno">No.</div><div class="fm-xs-hdial"><span class="fm-xs-dial-name">Dialogue</span></div><div class="fm-xs-hrows"></div><div class="fm-xs-hnote">Notes</div></div>` +
          `<div class="fm-xs-grid"><div class="fm-xs-guide" hidden></div></div>` +
        `</div></div>` +
        `<div class="fm-xs-foot">Up and Down: drawing · Left and Right: track · 1 to 9: hold · + and -: longer or shorter · Alt+Up or Down: move · I: insert · Delete</div></div>`);
    this.scroll = q(this.root, '.fm-xs-scroll');
    this.sheet = q(this.root, '.fm-xs-sheet');
    this.cols = q(this.root, '.fm-xs-cols');
    this.hrows = q(this.root, '.fm-xs-hrows');
    this.grid = q(this.root, '.fm-xs-grid');
    this.guide = q(this.root, '.fm-xs-guide');
    this.sub = q(this.root, '.fm-xs-sub');
    this.dialName = q(this.root, '.fm-xs-dial-name');
    this.wire();
  }

  get isOpen(): boolean { return !this.root.hidden; }

  open(on: boolean): void {
    setHidden(this.root, !on);
    if (on) { this.lastCur = -1; this.refresh(); this.root.focus({ preventScroll: true }); }
    this.onChange?.();
  }

  toggle(): void { this.open(!this.isOpen); }

  dispose(): void { this.root.remove(); }

  // ---- geometry ----

  private total(c: Content): number {
    const len = c.flip.reduce((m, t) => Math.max(m, flipLength(t)), 0);
    return Math.max(len, c.duration + c.offset, 1);
  }

  /** The content time (in flipbook frames) the playhead sits at. */
  private current(c: Content): number {
    const t = c.flip[this.host.row()];
    const idx = this.host.index();
    if (!t) return 0;
    const start = flipStartOf(t, idx);
    const e = flipServices.engine;
    if (this.host.playing() || !e) return start;
    const local = e.frame - c.start + c.offset;
    return flipIndexAt(t, local) === idx ? local : start;
  }

  // ---- painting ----

  refresh(): void {
    if (this.root.hidden) return;
    const c = this.host.content();
    if (!c) return;
    this.fps = this.host.fps();
    const total = this.total(c);
    const ar = this.host.row();
    const cur = this.current(c);
    setText(this.sub, `${total} frames · ${this.fps} fps`);
    setStyleVar(this.sheet, '--xs-cols', String(Math.max(1, c.flip.length)));
    setStyleVar(this.grid, 'height', `${total * RH}px`);

    const heads = c.flip.map((t, r) => ({ t, r }));
    patchList(this.hrows, heads, {
      key: (h) => h.t.id,
      create: (h) => { const b = el<HTMLElement>(`<button class="fm-xs-hc" type="button" tabindex="-1"><span class="fm-xs-hc-name"></span></button>`); this.head(b, h.t, h.r, ar); return b; },
      update: (b, h) => this.head(b, h.t, h.r, ar),
    });

    // follow the playhead when it moved off screen
    if (cur !== this.lastCur) {
      this.lastCur = cur;
      const top = this.scroll.scrollTop, h = this.scroll.clientHeight - 30;
      if (cur * RH < top + 4 || (cur + 1) * RH > top + h) this.scroll.scrollTop = Math.max(0, cur * RH - h / 2);
    }
    const top = this.scroll.scrollTop;
    const lo = Math.max(0, Math.floor(top / RH) - OVERSCAN);
    const hi = Math.min(total - 1, Math.ceil((top + this.scroll.clientHeight) / RH) + OVERSCAN);
    const ns: number[] = [];
    for (let n = lo; n <= hi; n++) ns.push(n);

    // sound and the active column's notes
    const mv = flipServices.engine?.movie;
    const sounds = mv ? soundBlocks(mv) : [];
    const sound = sounds.find((s) => s.asset && mv?.assets[s.asset]);
    setText(this.dialName, sound ? sound.name : 'Dialogue');
    patchList(this.grid, ns, {
      key: (n) => String(n),
      create: (n) => this.createRow(n, c, cur, ar, sounds),
      update: (node, n) => this.updateRow(node, n, c, cur, ar, sounds),
    });
  }

  private head(b: HTMLElement, t: FlipTrack, r: number, ar: number): void {
    setText(q(b, '.fm-xs-hc-name'), t.name);
    setClass(b, 'is-active', r === ar);
    setClass(b, 'is-hidden', t.hidden);
    b.dataset.r = String(r);
    if (b.dataset.hl !== t.highlight) b.dataset.hl = t.highlight;
    const sh = t.shoot && t.shoot > 1 ? `on ${t.shoot}s` : '';
    b.title = sh ? `${t.name} · shoots ${sh}` : t.name;
  }

  private createRow(n: number, c: Content, cur: number, ar: number, sounds: Content[]): HTMLElement {
    const node = el<HTMLElement>(
      `<div class="fm-xs-row" role="row"><div class="fm-xs-no"></div><div class="fm-xs-dial"><span class="fm-xs-wave"></span><span class="fm-xs-mouth"></span></div>` +
        `<div class="fm-xs-cells"></div><div class="fm-xs-note"><input type="text" spellcheck="false" aria-label="Note" hidden></div></div>`);
    this.updateRow(node, n, c, cur, ar, sounds);
    return node;
  }

  private updateRow(node: HTMLElement, n: number, c: Content, cur: number, ar: number, sounds: Content[]): void {
    node.style.transform = `translateY(${n * RH}px)`;
    node.dataset.n = String(n);
    const sec = this.fps > 0 && n % this.fps === this.fps - 1;
    setClass(node, 'is-sec', sec);
    setClass(node, 'is-cur', n === cur);
    setClass(node, 'is-beyond', n >= c.duration + c.offset);
    const no = q(node, '.fm-xs-no');
    setText(no, String(n + 1));
    // dialogue: the sound's level in this frame, and a mouth shape name where a drawing with a name starts
    q(node, '.fm-xs-wave').style.setProperty('--a', this.level(c, n, sounds).toFixed(3));
    let mouth = '';
    for (const t of c.flip) {
      const len = flipLength(t);
      if (!len) continue;
      const fi = flipIndexAt(t, n);
      const f = t.frames[fi];
      if (f?.name && n % len === flipStartOf(t, fi)) { mouth = f.name; break; }
    }
    setText(q(node, '.fm-xs-mouth'), mouth);
    const items: CellModel[] = c.flip.map((t, r) => ({ t, r, n }));
    patchList(q(node, '.fm-xs-cells'), items, {
      key: (m) => m.t.id,
      create: (m) => { const cell = el<HTMLElement>(`<div class="fm-xs-c" role="gridcell"><span class="fm-xs-cn"></span><span class="fm-xs-trim"></span></div>`); this.cell(cell, m, c, cur, ar); return cell; },
      update: (cell, m) => this.cell(cell, m, c, cur, ar),
    });
    // notes follow the active column's drawing that starts in this frame
    const at = c.flip[ar];
    const input = q<HTMLInputElement>(node, 'input');
    const noteBox = q(node, '.fm-xs-note');
    if (at && flipLength(at)) {
      const fi = flipIndexAt(at, n);
      const starts = n % flipLength(at) === flipStartOf(at, fi) && n < flipLength(at);
      setHidden(input, !starts);
      setClass(noteBox, 'is-on', starts);
      if (starts) { input.dataset.fi = String(fi); setValue(input, at.frames[fi].note ?? ''); }
    } else setHidden(input, true);
  }

  private cell(cell: HTMLElement, m: CellModel, c: Content, cur: number, ar: number): void {
    const { t, r, n } = m;
    const len = flipLength(t);
    cell.dataset.r = String(r);
    cell.dataset.n = String(m.n);
    if (!len) return;
    const fi = flipIndexAt(t, n);
    const f = t.frames[fi];
    const hold = Math.max(1, f.hold);
    const pos = n % len;
    const s0 = flipStartOf(t, fi);
    const start = pos === s0, end = pos === s0 + hold - 1;
    cell.dataset.fi = String(fi);
    setClass(cell, 'is-start', start);
    setClass(cell, 'is-end', end);
    setClass(cell, 'is-hold', !start);
    setClass(cell, 'is-blank', isBlank(f));
    setClass(cell, 'is-loop', n >= len);
    setClass(cell, 'is-hidden', t.hidden);
    setClass(cell, 'is-active', r === ar);
    setClass(cell, 'is-cur', r === ar && fi === this.host.index());
    setClass(cell, 'is-sel', this.sel.has(t.id, f.id));
    setText(q(cell, '.fm-xs-cn'), start ? (f.name ? `${fi + 1} ${f.name}` : String(fi + 1)) : '');
    void cur;
    void c;
  }

  /** 0..1 level of the first sound block over this frame (the loudest bucket of the frame's span). */
  private level(c: Content, n: number, sounds: Content[]): number {
    const e = flipServices.engine;
    const m = e?.movie;
    if (!m || !sounds.length) return 0;
    const mf = c.start - c.offset + n;
    for (const s of sounds) {
      if (mf < s.start || mf >= s.start + s.duration || !s.asset) continue;
      const p = flipServices.peaks(s.asset);
      if (!p) {
        if (!this.asked.has(s.asset)) { this.asked.add(s.asset); void flipServices.decode(s.asset).then(() => this.refresh()); }
        return 0;
      }
      const sec = srcFrame(s, mf - s.start) / m.fps;
      const a = Math.max(0, Math.floor(sec * p.perSecond));
      const b = Math.min(p.max.length, Math.max(a + 1, Math.ceil((sec + 1 / m.fps) * p.perSecond)));
      let peak = 0;
      for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(p.max[i]), Math.abs(p.min[i]));
      return Math.min(1, peak * 1.25) * Math.min(1, s.volume || 1);
    }
    return 0;
  }

  // ---- selection and edits ----

  private target(node: HTMLElement | null): { r: number; fi: number; n: number; t: FlipTrack; c: Content } | null {
    const cell = node?.closest<HTMLElement>('.fm-xs-c');
    const c = this.host.content();
    if (!cell || !c) return null;
    const r = Number(cell.dataset.r), n = Number(cell.dataset.n), fi = Number(cell.dataset.fi);
    const t = c.flip[r];
    if (!t || !t.frames[fi]) return null;
    return { r, fi, n, t, c };
  }

  private go(c: Content, r: number, fi: number, n: number): void {
    this.host.select(r, fi);
    const e = flipServices.engine;
    if (e) e.seek(c.start - c.offset + n);
  }

  private refsOf(c: Content): FrameRef[] {
    if (this.sel.count > 0) return this.sel.refs();
    const t = c.flip[this.host.row()], f = t?.frames[this.host.index()];
    return t && f ? [{ track: t.id, frames: [f.id] }] : [];
  }

  private press(e: PointerEvent): void {
    if (e.button !== 0) return;
    const tg = this.target(e.target as HTMLElement);
    if (!tg) return;
    this.root.focus({ preventScroll: true });
    const f = tg.t.frames[tg.fi];
    const x0 = e.clientX, y0 = e.clientY;
    const trim = (e.target as HTMLElement).classList.contains('fm-xs-trim');
    const refsFor = (): FrameRef[] => (this.sel.has(tg.t.id, f.id) && this.sel.count > 0 ? this.sel.refs() : [{ track: tg.t.id, frames: [f.id] }]);
    let mode: '' | 'trim' | 'move' = '';
    let dy = 0, drop = -1;
    const move = (m: PointerEvent): void => {
      dy = m.clientY - y0;
      if (!mode) {
        if (Math.abs(dy) < 5 && Math.abs(m.clientX - x0) < 5) return;
        mode = trim ? 'trim' : tg.n % flipLength(tg.t) === flipStartOf(tg.t, tg.fi) ? 'move' : '';
        if (!mode) return;
        this.root.classList.add('is-dragging');
      }
      if (mode === 'trim') {
        const k = Math.round(dy / RH);
        const hold = Math.max(1, Math.max(1, f.hold) + k);
        this.showGuide((flipStartOf(tg.t, tg.fi) + hold) * RH, `×${hold}`);
      } else {
        const rect = this.grid.getBoundingClientRect();
        const row = Math.max(0, Math.min(this.total(tg.c) - 1, Math.floor((m.clientY - rect.top) / RH)));
        drop = row;
        this.showGuide(row * RH, '');
      }
    };
    const up = (m: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      this.root.classList.remove('is-dragging');
      setHidden(this.guide, true);
      if (!mode) return;
      this.suppress = true;
      window.setTimeout(() => { this.suppress = false; }, 80);
      if (mode === 'trim') {
        const k = Math.round(dy / RH);
        if (k) { const refs = refsFor(); this.host.run('Frame duration', (x) => setHolds(x, refs, k, true)); }
      } else if (drop >= 0 && m) {
        const tf = flipIndexAt(tg.t, drop);
        const after = tf > tg.fi ? tf : tf - 1;
        if (tf !== tg.fi) { const refs = refsFor(); this.host.run('Move frames', (x) => moveFrames(x, refs, tg.t.id, after)); }
      }
    };
    const cancel = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); this.root.classList.remove('is-dragging'); setHidden(this.guide, true); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  private suppress = false;

  private showGuide(y: number, text: string): void {
    setStyleVar(this.guide, 'top', `${y - 1}px`);
    this.guide.dataset.t = text;
    setHidden(this.guide, false);
  }

  private click(e: MouseEvent): void {
    if (this.suppress) return;
    const t = e.target as HTMLElement;
    if (t.classList.contains('fm-xs-trim')) return;
    const tg = this.target(t);
    if (tg) {
      const f = tg.t.frames[tg.fi];
      if (e.shiftKey) { this.sel.range(tg.c, tg.t.id, f.id); this.repaint(); return; }
      if (e.ctrlKey || e.metaKey) { this.sel.toggle(tg.t.id, f.id); this.repaint(); return; }
      if (this.sel.clear()) this.repaint();
      this.go(tg.c, tg.r, tg.fi, tg.n);
      return;
    }
    // the frame number column seeks the frame in the active track
    const rowEl = t.closest<HTMLElement>('.fm-xs-row');
    const c = this.host.content();
    if (rowEl && c && t.closest('.fm-xs-no, .fm-xs-dial')) {
      const n = Number(rowEl.dataset.n) || 0;
      const r = this.host.row();
      const tr = c.flip[r];
      if (tr && flipLength(tr)) this.go(c, r, flipIndexAt(tr, n), n);
    }
  }

  private key(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); (e.target as HTMLInputElement).blur(); this.root.focus({ preventScroll: true }); }
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    e.stopPropagation();
    const c = this.host.content();
    const r = this.host.row(), idx = this.host.index();
    const t = c?.flip[r];
    const f = t?.frames[idx];
    if (!c || !t || !f) return;
    const refs = this.refsOf(c);
    const keep = (): void => e.preventDefault();
    const step = (d: number): void => { const to = Math.max(0, Math.min(t.frames.length - 1, idx + d)); if (to !== idx) this.go(c, r, to, flipStartOf(t, to)); };
    switch (e.key) {
      case 'ArrowDown': keep(); if (e.altKey) this.host.run('Move frame', (x) => nudgeFrame(x, r, idx, 1)); else step(1); return;
      case 'ArrowUp': keep(); if (e.altKey) this.host.run('Move frame', (x) => nudgeFrame(x, r, idx, -1)); else step(-1); return;
      case 'ArrowLeft': case 'ArrowRight': {
        keep();
        const r2 = Math.max(0, Math.min(c.flip.length - 1, r + (e.key === 'ArrowLeft' ? -1 : 1)));
        const t2 = c.flip[r2];
        if (r2 === r || !t2 || !flipLength(t2)) return;
        const cur = this.current(c);
        this.go(c, r2, flipIndexAt(t2, cur), cur);
        return;
      }
      case 'PageDown': case 'PageUp': {
        keep();
        const cur = Math.max(0, Math.min(this.total(c) - 1, this.current(c) + (e.key === 'PageDown' ? 1 : -1) * Math.max(1, this.fps)));
        this.go(c, r, flipIndexAt(t, cur), cur);
        return;
      }
      case 'Home': keep(); this.go(c, r, 0, 0); return;
      case 'End': keep(); this.go(c, r, t.frames.length - 1, flipStartOf(t, t.frames.length - 1)); return;
      case '+': case '=': keep(); this.host.run('Extend frame', (x) => setHolds(x, refs, 1, true)); return;
      case '-': case '_': keep(); this.host.run('Contract frame', (x) => setHolds(x, refs, -1, true)); return;
      case 'i': case 'I': case 'Insert': keep(); this.host.run('Insert frame', (x) => insertFrame(x, r, idx)); return;
      case 'd': case 'D': keep(); this.host.run('Duplicate frame', (x) => { const live = x.flip[r]?.frames[idx]; return live ? { ...x, flip: x.flip.map((tt, k) => (k === r ? { ...tt, frames: [...tt.frames.slice(0, idx + 1), copyFrame(live), ...tt.frames.slice(idx + 1)] } : tt)) } : x; }); return;
      case 'Delete': case 'Backspace': keep(); this.host.run('Delete frames', (x) => deleteFrames(x, refs)); return;
      case 'Enter': { keep(); const inp = this.grid.querySelector<HTMLInputElement>(`.fm-xs-row.is-cur input:not([hidden])`) ?? this.grid.querySelector<HTMLInputElement>('input:not([hidden])'); inp?.focus(); return; }
      case 'Escape': keep(); if (this.sel.count) { this.sel.clear(); this.sel.multi = false; this.repaint(); } else this.open(false); return;
      default:
        if (/^[0-9]$/.test(e.key)) {
          keep();
          const now = performance.now();
          this.typed = now - this.typedAt < 800 ? (this.typed + e.key).slice(-3) : e.key;
          this.typedAt = now;
          const n = Number(this.typed);
          if (n >= 1) this.host.run('Frame duration', (x) => setHolds(x, refs, n), 'xs-type-hold');
        }
    }
  }

  private wire(): void {
    this.root.addEventListener('pointerdown', (e) => this.press(e));
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="close"]')) { this.open(false); return; }
      const hc = (e.target as HTMLElement).closest<HTMLElement>('.fm-xs-hc');
      if (hc) {
        const c = this.host.content();
        const r = Number(hc.dataset.r);
        const t = c?.flip[r];
        if (c && t) this.host.select(r, Math.min(this.host.index(), t.frames.length - 1));
        return;
      }
      this.click(e);
    });
    this.root.addEventListener('keydown', (e) => this.key(e));
    this.scroll.addEventListener('scroll', () => this.refresh(), { passive: true });
    this.grid.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (!(input instanceof HTMLInputElement)) return;
      const c = this.host.content();
      const r = this.host.row();
      const fi = Number(input.dataset.fi);
      if (!c || !c.flip[r]?.frames[fi]) return;
      const v = input.value;
      if ((c.flip[r].frames[fi].note ?? '') !== v.trim()) this.host.run('Frame note', (x) => setNote(x, r, fi, v));
    });
    // a wheel over the sheet scrolls it and never pans the strip behind
    this.root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }
}
