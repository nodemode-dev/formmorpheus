// Graph editor: value and speed curves of a keyed lane's channels, with keys as points and Bezier handles on the
// selected key. Built once, patched in place; the curves are painted on one canvas. Every edit is an engine op
// (one undo step per drag).
import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import * as ops from '../engine/ops';
import * as keyOps from '../engine/key-ops';
import * as gOps from '../engine/graph-ops';
import { evalChannel, kindSpec, laneChannels, laneOf, shownOf } from '../engine/keys';
import type { ChannelSpec } from '../engine/keys';
import type { Content, Ease, Key, KeyKind } from '../engine/types';
import { el, q, setClass, setHidden, setText } from './dom';
import { t } from './i18n';

const PL = 56;
const PT = 26;
const PR = 16;
const PB = 58; // clear of the mode switcher that floats over the Timeline
const HIT = 9;

type Mode = 'value' | 'speed';
interface View { vc: number; sc: number }
interface Sel { channel: string; frame: number }
type Drag =
  | { kind: 'key'; base: Content; channel: string; from: number; cur: number; x0: number; y0: number; v0: number; lock: 0 | 1 | 2; moved: boolean; tag: string }
  | { kind: 'handle'; base: Content; channel: string; owner: number; side: 'out' | 'in'; tag: string; moved: boolean }
  | { kind: 'keys'; base: Content; items: Sel[]; anchor: Sel; x0: number; y0: number; moved: boolean; tag: string; shift: number }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; add: boolean }
  | { kind: 'pan'; x0: number; y0: number; t0: number; vc: number }
  | { kind: 'scrub' };

interface HandlePt { side: 'out' | 'in'; owner: number; x: number; y: number; ax: number; ay: number }

const PRESETS: { id: Ease; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'out', label: 'Ease in' },
  { id: 'in', label: 'Ease out' },
  { id: 'inout', label: 'Ease in & out' },
  { id: 'hold', label: 'Hold' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'elastic', label: 'Elastic' },
  { id: 'overshoot', label: 'Overshoot' },
  { id: 'custom', label: 'Custom' },
];

const CHEV = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

export class GraphEditor {
  readonly root = el(`<section class="fm-graph" hidden aria-label="Graph editor">
    <div class="fm-gr-bar">
      <span class="fm-gr-title"></span>
      <div class="fm-gr-chans" role="tablist" aria-label="Channels"></div>
      <span class="fm-gr-sep"></span>
      <div class="fm-gr-seg" role="group" aria-label="Curve">
        <button class="fm-gr-btn" type="button" data-mode="value" title="Value curve">Value</button>
        <button class="fm-gr-btn" type="button" data-mode="speed" title="Speed curve">Speed</button>
      </div>
      <span class="fm-gr-sep"></span>
      <div class="fm-gr-eases" role="group" aria-label="Easing of the selected key"></div>
      <span class="fm-gr-grow"></span>
      <span class="fm-gr-read"></span>
      <button class="fm-gr-btn" type="button" data-act="reverse" title="Reverse the keys of this lane">Reverse</button>
      <button class="fm-gr-btn" type="button" data-act="fit" title="Fit the curves in view">Fit</button>
      <button class="fm-gr-x" type="button" data-act="close" title="Close the Graph" aria-label="Close the Graph">${CHEV}</button>
    </div>
    <div class="fm-gr-plot"><canvas class="fm-gr-canvas" aria-label="Curves"></canvas><p class="fm-gr-empty" hidden>Select a content with keys to see its curves.</p></div>
  </section>`);

  private readonly canvas = q<HTMLCanvasElement>(this.root, '.fm-gr-canvas');
  private readonly plot = q(this.root, '.fm-gr-plot');
  private readonly title = q(this.root, '.fm-gr-title');
  private readonly chans = q(this.root, '.fm-gr-chans');
  private readonly eases = q(this.root, '.fm-gr-eases');
  private readonly read = q(this.root, '.fm-gr-read');
  private readonly empty = q(this.root, '.fm-gr-empty');
  private readonly chips = new Map<string, HTMLButtonElement>();
  private readonly easeBtns = new Map<Ease, HTMLButtonElement>();
  private readonly modeBtns = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-mode]'));
  private id: string | null = null;
  private kind: KeyKind = 'move';
  private sel: Sel | null = null;
  /** Keys picked together by a box (or Shift-click); empty means just `sel`. */
  private multi = new Map<string, Sel>();
  private mode: Mode = 'value';
  private t0 = 0;
  private ppf = 8;
  private views: Record<Mode, View> = { value: { vc: 0, sc: 1 }, speed: { vc: 0, sc: 1 } };
  private drag: Drag | null = null;
  private raf = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private handles: HandlePt[] = [];
  private fitted = false;
  private chanKey = '';

  constructor(host: HTMLElement, private readonly engine: Engine) {
    host.appendChild(this.root);
    for (const p of PRESETS) {
      const b = el<HTMLButtonElement>('<button class="fm-gr-btn" type="button"></button>');
      b.textContent = p.label;
      b.addEventListener('click', () => this.setEase(p.id));
      this.eases.appendChild(b);
      this.easeBtns.set(p.id, b);
    }
    for (const b of this.modeBtns) b.addEventListener('click', () => this.setMode(b.dataset.mode as Mode));
    q(this.root, '[data-act="fit"]').addEventListener('click', () => this.fit());
    q(this.root, '[data-act="close"]').addEventListener('click', () => this.close());
    q(this.root, '[data-act="reverse"]').addEventListener('click', () => {
      const id = this.id, kind = this.kind;
      if (id) this.engine.run('Reverse Keyframes', (m) => ops.updateContent(m, id, (c) => keyOps.reverseKeys(c, kind)));
    });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', () => this.fit());
    new ResizeObserver(() => this.schedule()).observe(this.plot);
    const refresh = (): void => { if (this.isOpen) this.schedule(); };
    this.engine.on('movie', refresh);
    this.engine.on('time', refresh);
    this.engine.on('selection', () => { if (this.isOpen) { this.follow(); this.schedule(); } });
    new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  get isOpen(): boolean { return !this.root.hidden; }

  toggle(): void { if (this.isOpen) this.close(); else this.open(); }

  /** Open on a lane; without arguments, on the selected content's expanded (else first) keyed lane. */
  open(id?: string, kind?: KeyKind, channel?: string | null): void {
    const c = id ? this.find(id) : this.engine.selected.length === 1 ? this.engine.selected[0] : null;
    if (!c) { this.engine.notice('Select a content with keyframes to open the Graph.'); return; }
    let k = kind;
    if (!k) {
      const lane = c.keys.find((l) => l.expanded && Object.values(l.channels).some((x) => x.length)) ?? c.keys.find((l) => Object.values(l.channels).some((x) => x.length));
      k = lane?.kind;
    }
    if (!k) { this.engine.notice('Add keyframes first, then open the Graph.'); return; }
    this.id = c.id;
    this.kind = k;
    this.sel = null;
    this.multi.clear();
    this.chanKey = '';
    const lane = laneOf(c, k);
    const first = channel && lane?.channels[channel]?.length ? channel : lane ? laneChannels(lane).find((s) => lane.channels[s.id]?.length)?.id : undefined;
    if (first && lane) this.sel = { channel: first, frame: lane.channels[first][0].frame };
    this.fitted = false;
    setHidden(this.root, false);
    this.schedule();
  }

  close(): void {
    this.drag = null;
    setHidden(this.root, true);
    this.id = null;
  }

  private find(id: string): Content | null {
    const m = this.engine.movie;
    return m ? locate(m, id)?.content ?? null : null;
  }

  private content(): Content | null { return this.id ? this.find(this.id) : null; }

  /** Follow the selection to another content that has the same kind of lane. */
  private follow(): void {
    const s = this.engine.selected;
    if (s.length !== 1 || s[0].id === this.id) return;
    const lane = laneOf(s[0], this.kind);
    if (!lane || !Object.values(lane.channels).some((x) => x.length)) return;
    this.id = s[0].id;
    this.sel = null;
    this.multi.clear();
    this.chanKey = '';
    this.fitted = false;
  }

  // ---- geometry ----------------------------------------------------------

  private get ph(): number { return Math.max(10, this.h - PT - PB); }
  private tx(f: number): number { return PL + (f - this.t0) * this.ppf; }
  private fx(px: number): number { return this.t0 + (px - PL) / this.ppf; }
  private vy(v: number): number { const w = this.views[this.mode]; return PT + this.ph / 2 - (v - w.vc) * w.sc; }
  private yv(py: number): number { const w = this.views[this.mode]; return w.vc + (PT + this.ph / 2 - py) / w.sc; }

  private spec(channel: string): ChannelSpec | undefined { return kindSpec(this.kind).channels.find((s) => s.id === channel); }

  private keys(c: Content, channel: string): Key[] { return laneOf(c, this.kind)?.channels[channel] ?? []; }

  private speedAt(keys: Key[], f: number): number {
    const d = 0.05;
    return ((evalChannel(keys, f + d) ?? 0) - (evalChannel(keys, f - d) ?? 0)) / (2 * d);
  }

  private valueOf(keys: Key[], f: number): number {
    return this.mode === 'value' ? evalChannel(keys, f) ?? 0 : this.speedAt(keys, f);
  }

  /** Fit time to every visible key and the active curve's range (overshoot included) to the plot. */
  fit(): void {
    const c = this.content();
    if (!c || !this.sel) return;
    const lane = laneOf(c, this.kind);
    if (!lane) return;
    let f0 = Infinity, f1 = -Infinity;
    for (const id in lane.channels) for (const k of lane.channels[id]) { f0 = Math.min(f0, k.frame); f1 = Math.max(f1, k.frame); }
    if (!(f1 > f0)) { f0 = 0; f1 = Math.max(1, c.duration - 1); }
    const pw = Math.max(40, this.w - PL - PR);
    this.ppf = pw / ((f1 - f0) * 1.12);
    this.t0 = f0 - (f1 - f0) * 0.06;
    const keys = this.keys(c, this.sel.channel);
    let lo = Infinity, hi = -Infinity;
    for (let f = f0; f <= f1; f += Math.max(0.25, (f1 - f0) / 240)) {
      const v = this.valueOf(keys, f);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
    const sc = this.ph / ((hi - lo) * 1.3);
    this.views[this.mode] = { vc: (lo + hi) / 2, sc };
    this.fitted = true;
    this.schedule();
  }

  private setMode(m: Mode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.fitted = false;
    this.schedule();
  }

  // ---- edits -------------------------------------------------------------

  private setEase(ease: Ease): void {
    const id = this.id, s = this.sel, kind = this.kind;
    if (!id || !s) return;
    this.engine.run('Set Easing', (m) => ops.updateContent(m, id, (c) => gOps.setKeyEase(c, kind, s.channel, s.frame, ease)));
  }

  private applyKey(d: Extract<Drag, { kind: 'key' }>, e: PointerEvent): void {
    const id = this.id;
    if (!id) return;
    let dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    if (e.shiftKey && !d.lock) d.lock = Math.abs(dx) > Math.abs(dy) ? 1 : 2;
    if (!e.shiftKey) d.lock = 0;
    if (d.lock === 1) dy = 0;
    if (d.lock === 2) dx = 0;
    const to = Math.round(d.from + dx / this.ppf);
    const value = d.v0 - dy / this.views.value.sc;
    const { base, channel, from, tag } = d;
    const kind = this.kind;
    this.engine.run('Edit Keyframe', (m) => ops.updateContent(m, id, () => gOps.editKey(base, kind, channel, from, to, value)), tag);
    const now = this.find(id);
    if (!now) return;
    const list = this.keys(now, channel);
    const picked = list.find((k) => k.frame === to) ?? list.find((k) => k.value === value) ?? list.find((k) => k.frame === d.cur);
    if (picked) { d.cur = picked.frame; this.sel = { channel, frame: picked.frame }; }
  }

  private applyHandle(d: Extract<Drag, { kind: 'handle' }>, e: PointerEvent): void {
    const id = this.id;
    if (!id) return;
    const list = this.keys(d.base, d.channel);
    const i = list.findIndex((k) => k.frame === d.owner);
    const a = list[i], b = list[i + 1];
    if (!a || !b) return;
    const h0 = gOps.spanHandles(a);
    if (!h0) return;
    const r = this.canvas.getBoundingClientRect();
    let px = e.clientX - r.left, py = e.clientY - r.top;
    const anchorX = this.tx(d.side === 'out' ? a.frame : b.frame);
    const anchorY = this.vy(d.side === 'out' ? a.value : b.value);
    if (e.shiftKey) {
      const orig = d.side === 'out' ? h0.out : h0.in;
      const ox = this.tx(a.frame + orig[0] * (b.frame - a.frame)) - anchorX;
      const oy = this.vy(a.value + orig[1] * (b.value - a.value)) - anchorY;
      const len2 = ox * ox + oy * oy;
      if (len2 > 4) {
        const t = ((px - anchorX) * ox + (py - anchorY) * oy) / len2;
        px = anchorX + ox * t;
        py = anchorY + oy * t;
      }
    }
    const dt = b.frame - a.frame, dv = b.value - a.value;
    const hx = Math.min(1, Math.max(0, (this.fx(px) - a.frame) / dt));
    const orig = d.side === 'out' ? h0.out : h0.in;
    const hy = Math.abs(dv) < 1e-9 ? orig[1] : (this.yv(py) - a.value) / dv;
    const out: [number, number] = d.side === 'out' ? [hx, hy] : [h0.out[0], h0.out[1]];
    const inn: [number, number] = d.side === 'in' ? [hx, hy] : [h0.in[0], h0.in[1]];
    const { base, channel, owner, tag, side } = d;
    const kind = this.kind;
    const link = !e.altKey; // Alt breaks the handle from the one across the key
    this.engine.run('Edit Ease Curve', (m) => ops.updateContent(m, id, () => gOps.setHandlesLinked(base, kind, channel, owner, side, out, inn, link)), tag);
  }

  private applyKeys(d: Extract<Drag, { kind: 'keys' }>, e: PointerEvent): void {
    const id = this.id;
    if (!id) return;
    const dx = e.clientX - d.x0;
    let dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, e.clientY - d.y0) < 3) return;
    d.moved = true;
    let df = Math.round(dx / this.ppf);
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else df = 0; }
    const { base, items, tag } = d;
    const kind = this.kind;
    const act = this.sel?.channel ?? items[0].channel;
    const [a0, a1] = this.range(base, act);
    const dvAct = -dy / this.views.value.sc;
    // another channel's key sits on a mapped range: scale the move back to that channel's own units
    const dv = (ch: string): number => { if (ch === act) return dvAct; const [b0, b1] = this.range(base, ch); return (dvAct * (b1 - b0)) / (a1 - a0); };
    d.shift = gOps.clampShift(base, kind, items, df);
    this.engine.run('Edit Keyframes', (m) => ops.updateContent(m, id, () => gOps.moveKeys(base, kind, items, df, dv)), tag);
    this.multi.clear();
    for (const s of items) this.multi.set(`${s.channel}|${s.frame + d.shift}`, { channel: s.channel, frame: s.frame + d.shift });
    this.sel = { channel: d.anchor.channel, frame: d.anchor.frame + d.shift };
  }

  // ---- input -------------------------------------------------------------

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private down(e: PointerEvent): void {
    const c = this.content();
    if (!c || e.button > 1) return;
    const [x, y] = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) { this.beginPan(e); return; }
    if (y < PT) { this.drag = { kind: 'scrub' }; this.scrubTo(x); return; }
    if (this.mode === 'value') {
      for (const hp of this.handles) {
        if (Math.hypot(hp.x - x, hp.y - y) <= HIT && this.sel) {
          this.drag = { kind: 'handle', base: c, channel: this.sel.channel, owner: hp.owner, side: hp.side, tag: `graph-h-${Date.now()}`, moved: false };
          return;
        }
      }
    }
    const lane = laneOf(c, this.kind);
    if (lane) {
      let best: { ch: string; k: Key; d: number } | null = null;
      for (const id in lane.channels) {
        if (!this.visible(id)) continue;
        const isActive = this.sel?.channel === id;
        const keys = lane.channels[id];
        for (const k of keys) {
          const p = this.pointOf(c, id, k);
          const dist = Math.hypot(p[0] - x, p[1] - y) - (isActive ? 2 : 0);
          if (dist <= HIT && (!best || dist < best.d)) best = { ch: id, k, d: dist };
        }
      }
      if (best) {
        const hit: Sel = { channel: best.ch, frame: best.k.frame };
        const hk = `${hit.channel}|${hit.frame}`;
        if (e.shiftKey && this.mode === 'value') {
          // Shift-click adds or removes a key from the picked set
          if (!this.multi.size && this.sel) this.multi.set(`${this.sel.channel}|${this.sel.frame}`, { ...this.sel });
          if (this.multi.has(hk)) this.multi.delete(hk); else this.multi.set(hk, hit);
          this.sel = hit;
          this.schedule();
          return;
        }
        const together = this.mode === 'value' && this.multi.size > 1 && this.multi.has(hk);
        if (!together) this.multi.clear();
        this.sel = hit;
        this.engine.seek(c.start + best.k.frame);
        if (together) {
          this.drag = { kind: 'keys', base: c, items: Array.from(this.multi.values()), anchor: hit, x0: e.clientX, y0: e.clientY, moved: false, tag: `graph-m-${Date.now()}`, shift: 0 };
        } else if (this.mode === 'value') {
          this.drag = { kind: 'key', base: c, channel: best.ch, from: best.k.frame, cur: best.k.frame, x0: e.clientX, y0: e.clientY, v0: best.k.value, lock: 0, moved: false, tag: `graph-k-${Date.now()}` };
        } else this.drag = null;
        this.schedule();
        return;
      }
    }
    if (this.mode === 'value' && !e.altKey) {
      const add = e.shiftKey;
      if (!add) this.multi.clear();
      this.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, add };
      this.schedule();
      return;
    }
    this.beginPan(e);
  }

  private boxPick(d: Extract<Drag, { kind: 'box' }>): void {
    const c = this.content();
    const lane = c ? laneOf(c, this.kind) : null;
    if (!c || !lane) return;
    const xa = Math.min(d.x0, d.x1), xb = Math.max(d.x0, d.x1), ya = Math.min(d.y0, d.y1), yb = Math.max(d.y0, d.y1);
    if (!d.add) this.multi.clear();
    for (const id in lane.channels) {
      if (!this.visible(id)) continue;
      for (const k of lane.channels[id]) {
        const p = this.pointOf(c, id, k);
        if (p[0] >= xa && p[0] <= xb && p[1] >= ya && p[1] <= yb) this.multi.set(`${id}|${k.frame}`, { channel: id, frame: k.frame });
      }
    }
    if (this.multi.size) {
      const has = this.sel && this.multi.has(`${this.sel.channel}|${this.sel.frame}`);
      if (!has) this.sel = Array.from(this.multi.values())[0];
    }
  }

  private beginPan(e: PointerEvent): void {
    const w = this.views[this.mode];
    this.drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, t0: this.t0, vc: w.vc };
  }

  private scrubTo(x: number): void {
    const c = this.content();
    if (!c) return;
    this.engine.seek(c.start + Math.max(0, Math.min(c.duration - 1, Math.round(this.fx(x)))));
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'key') this.applyKey(d, e);
    else if (d.kind === 'keys') this.applyKeys(d, e);
    else if (d.kind === 'box') { [d.x1, d.y1] = this.local(e); this.schedule(); }
    else if (d.kind === 'handle') { d.moved = true; this.applyHandle(d, e); }
    else if (d.kind === 'pan') {
      this.t0 = d.t0 - (e.clientX - d.x0) / this.ppf;
      this.views[this.mode] = { vc: d.vc + (e.clientY - d.y0) / this.views[this.mode].sc, sc: this.views[this.mode].sc };
      this.schedule();
    } else this.scrubTo(this.local(e)[0]);
  }

  private up(e: PointerEvent): void {
    if (this.drag && (this.drag.kind === 'key' || this.drag.kind === 'handle' || this.drag.kind === 'keys')) this.engine.endGesture();
    if (this.drag && this.drag.kind === 'box') this.boxPick(this.drag);
    this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    this.schedule();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const [x, y] = this.local(e);
    const f = Math.exp(-e.deltaY * 0.0015);
    if (e.shiftKey || e.altKey) {
      const w = this.views[this.mode];
      const anchor = this.yv(y);
      const sc = Math.min(1e7, Math.max(1e-5, w.sc * f));
      this.views[this.mode] = { sc, vc: anchor - (PT + this.ph / 2 - y) / sc };
    } else {
      const anchor = this.fx(x);
      this.ppf = Math.min(400, Math.max(0.2, this.ppf * f));
      this.t0 = anchor - (x - PL) / this.ppf;
    }
    this.schedule();
  }

  // ---- drawing -----------------------------------------------------------

  private visible(channel: string): boolean { return !!this.sel && (channel === this.sel.channel || this.chips.get(channel)?.getAttribute('aria-pressed') !== 'false'); }

  /** Screen point of a key. Other channels share the active axis through a normalised range. */
  private pointOf(c: Content, channel: string, k: Key): [number, number] {
    const keys = this.keys(c, channel);
    if (this.mode === 'speed') return [this.tx(k.frame), this.vy(this.speedAt(keys, k.frame))];
    return [this.tx(k.frame), this.vy(this.mapValue(c, channel, k.value))];
  }

  private range(c: Content, channel: string): [number, number] {
    let lo = Infinity, hi = -Infinity;
    for (const k of this.keys(c, channel)) { lo = Math.min(lo, k.value); hi = Math.max(hi, k.value); }
    if (!isFinite(lo)) return [0, 1];
    if (hi - lo < 1e-9) hi = lo + 1;
    return [lo, hi];
  }

  /** A value of another channel mapped onto the active channel's range (for the ghost curves). */
  private mapValue(c: Content, channel: string, v: number): number {
    if (!this.sel || channel === this.sel.channel || this.mode === 'speed') return v;
    const [a0, a1] = this.range(c, this.sel.channel);
    const [b0, b1] = this.range(c, channel);
    return a0 + ((v - b0) / (b1 - b0)) * (a1 - a0);
  }

  private schedule(): void {
    if (this.raf || !this.isOpen) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  private syncChips(c: Content): void {
    const lane = laneOf(c, this.kind);
    const key = `${c.id}|${this.kind}|${lane ? Object.keys(lane.channels).filter((k) => lane.channels[k].length).join(',') : ''}`;
    const active = this.sel?.channel;
    if (key !== this.chanKey) {
      this.chanKey = key;
      for (const b of this.chips.values()) setHidden(b, true);
      if (lane) {
        for (const s of laneChannels(lane)) {
          if (!lane.channels[s.id]?.length) continue;
          let b = this.chips.get(s.id);
          if (!b) {
            b = el<HTMLButtonElement>('<button class="fm-gr-chip" type="button" role="tab"></button>');
            b.textContent = s.short;
            b.title = s.label;
            b.setAttribute('aria-pressed', 'true');
            const ch = s.id;
            b.addEventListener('click', () => {
              const cc = this.content();
              const list = cc ? this.keys(cc, ch) : [];
              if (list.length) { this.sel = { channel: ch, frame: list[0].frame }; this.fitted = false; this.schedule(); }
            });
            this.chips.set(s.id, b);
            this.chans.appendChild(b);
          }
          setHidden(b, false);
        }
      }
    }
    for (const [id, b] of this.chips) {
      const on = id === active;
      setClass(b, 'is-active', on);
      b.setAttribute('aria-selected', String(on));
    }
  }

  private palette(): Record<string, string> {
    const cs = getComputedStyle(this.root);
    const g = (n: string): string => cs.getPropertyValue(n).trim();
    return { bg: g('--bg-secondary') || '#17151b', grid: g('--border-color') || '#2a2a2a', text: g('--text-muted') || '#888', text2: g('--text-secondary') || '#aaa', hi: g('--text-primary') || '#fff', accent: g('--accent-color') || '#f97316', surface: g('--bg-tertiary') || '#222' };
  }

  private paint(): void {
    const c = this.content();
    const lane = c ? laneOf(c, this.kind) : null;
    const ok = !!c && !!lane && Object.values(lane.channels).some((x) => x.length);
    setHidden(this.empty, ok);
    if (!ok || !c || !lane) { if (this.isOpen && !c) this.close(); return; }
    if (!this.sel || !lane.channels[this.sel.channel]?.length) {
      const f = laneChannels(lane).find((s) => lane.channels[s.id]?.length);
      this.sel = f ? { channel: f.id, frame: lane.channels[f.id][0].frame } : null;
      if (!this.sel) return;
    }
    const sel = this.sel;
    const keysA = this.keys(c, sel.channel);
    if (!keysA.some((k) => k.frame === sel.frame)) sel.frame = keysA[0].frame;
    const rect = this.plot.getBoundingClientRect();
    const w = Math.max(100, Math.floor(rect.width)), h = Math.max(60, Math.floor(rect.height));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    if (!this.fitted) this.fit();
    this.fitted = true;
    this.syncChips(c);
    const spec = this.spec(sel.channel);
    const kd = kindSpec(this.kind);
    setText(this.title, kd.label);
    for (const b of this.modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode));
    const idx = keysA.findIndex((k) => k.frame === sel.frame);
    const key = keysA[idx];
    const hasSpan = idx >= 0 && idx < keysA.length - 1;
    for (const [id, b] of this.easeBtns) {
      b.setAttribute('aria-pressed', String(hasSpan && key.ease === id));
      b.disabled = !hasSpan;
    }
    const shown = (v: number): string => `${Math.round((spec ? shownOf(spec, v) : v) * 100) / 100}${spec?.unit === 'deg' ? '°' : spec?.unit ?? ''}`;
    setText(this.read, key ? `${t('Frame')} ${key.frame} · ${shown(key.value)}` : '');

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const P = this.palette();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    this.paintGrid(ctx, P, spec);
    const pw = this.w - PL - PR;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PL, PT, pw, this.ph);
    ctx.clip();
    // curves: ghosts first, the active channel on top
    const order = Object.keys(lane.channels).filter((id) => lane.channels[id].length && this.visible(id) && id !== sel.channel);
    order.push(sel.channel);
    for (const id of order) {
      const keys = lane.channels[id];
      const act = id === sel.channel;
      ctx.beginPath();
      ctx.lineWidth = act ? 2 : 1.25;
      ctx.strokeStyle = act ? P.accent : P.text2;
      ctx.globalAlpha = act ? 1 : 0.5;
      for (let px = PL; px <= PL + pw; px += 2) {
        const f = this.fx(px);
        const v = this.mode === 'speed' ? this.speedAt(keys, f) : this.mapValue(c, id, evalChannel(keys, f) ?? 0);
        const y = this.vy(v);
        if (px === PL) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // playhead
    const ph = this.tx(this.engine.frame - c.start);
    ctx.strokeStyle = P.hi;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ph + 0.5, PT);
    ctx.lineTo(ph + 0.5, PT + this.ph);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // handles of the selected key (unclipped, so an overshooting handle stays reachable)
    ctx.restore();
    this.handles = [];
    if (this.mode === 'value' && key) {
      const add = (side: 'out' | 'in', owner: Key, next: Key, ax: number, ay: number): void => {
        const hs = gOps.spanHandles(owner);
        if (!hs) return;
        const hh = side === 'out' ? hs.out : hs.in;
        const x = this.tx(owner.frame + hh[0] * (next.frame - owner.frame));
        const y = this.vy(owner.value + hh[1] * (next.value - owner.value));
        this.handles.push({ side, owner: owner.frame, x, y, ax, ay });
      };
      const [kx, ky] = this.pointOf(c, sel.channel, key);
      // both spans around the key, both handles of each: the leaving span's out and in (in sits on the next key),
      // the arriving span's out (on the previous key) and in
      const next = keysA[idx + 1], prev = keysA[idx - 1];
      if (hasSpan) {
        add('out', key, next, kx, ky);
        const [nx, ny] = this.pointOf(c, sel.channel, next);
        add('in', key, next, nx, ny);
      }
      if (prev) {
        const [px, py] = this.pointOf(c, sel.channel, prev);
        add('out', prev, key, px, py);
        add('in', prev, key, kx, ky);
      }
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 1;
      for (const hp of this.handles) {
        ctx.beginPath();
        ctx.moveTo(hp.ax, hp.ay);
        ctx.lineTo(hp.x, hp.y);
        ctx.stroke();
        ctx.fillStyle = P.bg;
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // keys
    ctx.save();
    ctx.beginPath();
    ctx.rect(PL - 8, PT, pw + 16, this.ph);
    ctx.clip();
    for (const id of order) {
      const act = id === sel.channel;
      for (const k of lane.channels[id]) {
        const [x, y] = this.pointOf(c, id, k);
        if (x < PL - 8 || x > PL + pw + 8) continue;
        const picked = this.multi.has(`${id}|${k.frame}`);
        const on = (act && k.frame === sel.frame) || picked;
        ctx.beginPath();
        ctx.rect(x - (on ? 5 : 4), y - (on ? 5 : 4), on ? 10 : 8, on ? 10 : 8);
        ctx.fillStyle = on ? P.accent : act ? P.hi : P.text2;
        ctx.globalAlpha = act ? 1 : 0.6;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (on) { ctx.strokeStyle = P.hi; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
    }
    ctx.restore();
    const bx = this.drag;
    if (bx && bx.kind === 'box') {
      ctx.fillStyle = P.accent;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(Math.min(bx.x0, bx.x1), Math.min(bx.y0, bx.y1), Math.abs(bx.x1 - bx.x0), Math.abs(bx.y1 - bx.y0));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(bx.x0, bx.x1) + 0.5, Math.min(bx.y0, bx.y1) + 0.5, Math.abs(bx.x1 - bx.x0), Math.abs(bx.y1 - bx.y0));
    }
  }

  private paintGrid(ctx: CanvasRenderingContext2D, P: Record<string, string>, spec: ChannelSpec | undefined): void {
    const pw = this.w - PL - PR;
    ctx.font = '500 10px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    // time
    const fstep = niceStep(48 / this.ppf);
    ctx.fillStyle = P.surface;
    ctx.fillRect(0, 0, this.w, PT);
    ctx.textAlign = 'center';
    for (let f = Math.ceil(this.fx(PL) / fstep) * fstep; this.tx(f) <= PL + pw; f += fstep) {
      const x = Math.round(this.tx(f)) + 0.5;
      ctx.strokeStyle = P.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, PT);
      ctx.lineTo(x, PT + this.ph);
      ctx.stroke();
      ctx.fillStyle = P.text;
      ctx.fillText(String(Math.round(f)), x, PT / 2);
    }
    // value
    const disp = this.mode === 'value' ? (spec?.display ?? 1) : (spec?.display ?? 1);
    const sc = this.views[this.mode].sc;
    const vstep = niceStep(34 / (sc * disp)) / disp;
    ctx.textAlign = 'right';
    const vTop = this.yv(PT), vBot = this.yv(PT + this.ph);
    // the grid walks the shown numbers (a shifted channel like HSB gets round labels), then maps each back to the stored value
    const sh = spec?.shift ?? 0, sstep = vstep * disp;
    for (let s = Math.ceil((vBot * disp + sh) / sstep - 1e-9) * sstep; (s - sh) / disp <= vTop; s += sstep) {
      const v = (s - sh) / disp;
      const y = Math.round(this.vy(v)) + 0.5;
      ctx.strokeStyle = P.grid;
      ctx.globalAlpha = Math.abs(v) < vstep * 1e-6 ? 1 : 0.55;
      ctx.beginPath();
      ctx.moveTo(PL, y);
      ctx.lineTo(PL + pw, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = P.text;
      ctx.fillText(String(Math.round((v * disp + (spec?.shift ?? 0)) * 100) / 100), PL - 8, y);
    }
  }
}
