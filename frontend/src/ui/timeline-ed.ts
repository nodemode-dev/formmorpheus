// Timeline extras: snapping with its indicator line, markers on the ruler, the transition length handle.
// The Timeline owns one TimelineEd and calls it from a few hooks; nothing here rebuilds mounted DOM.
import type { Engine } from '../engine/engine';
import { end } from '../engine/model';
import * as ops from '../engine/ops';
import * as mk from '../engine/marker-ops';
import { edgesOf, reachFrames, snapDelta, snapTargets } from '../engine/snap';
import { halves, MIN_TRANSITION, windowOf } from '../engine/transitions';
import type { Content, Highlight, Movie } from '../engine/types';
import { el, q, setClass } from './dom';
import { Popover, popRow } from './popover';

export interface EdGeo {
  fx(frame: number): number;
  xf(x: number): number;
  laneTop(i: number): number;
  blockH(): number;
  ppf(): number;
  ruler: HTMLCanvasElement;
  tracks: HTMLCanvasElement;
  schedule(): void;
}

const SNAP_KEY = 'fm.snap';
let snapOn = true;
try { snapOn = localStorage.getItem(SNAP_KEY) !== '0'; } catch { /* storage blocked: on */ }
const snapListeners = new Set<() => void>();

export const timelineSnap = {
  get on(): boolean { return snapOn; },
  set(on: boolean): void {
    snapOn = on;
    try { localStorage.setItem(SNAP_KEY, on ? '1' : '0'); } catch { /* not kept */ }
    for (const f of snapListeners) f();
  },
  listen(f: () => void): void { snapListeners.add(f); },
};

const FLAG_H = 12;

interface Pal { accent: string; text: string; muted: string; ruler: string; hl: Record<Highlight, string> }

export class TimelineEd {
  /** The frame of the snap indicator while a drag is pulled to a target. */
  line: number | null = null;
  private cache: { tag: string; targets: number[]; edges: number[] } | null = null;
  private readonly pop = new Popover('fm-mk-pop', 232);
  private readonly nameIn: HTMLInputElement;
  private readonly swatches = new Map<string, HTMLButtonElement>();
  private editing: string | null = null;

  constructor(private readonly engine: Engine, private readonly geo: EdGeo) {
    timelineSnap.listen(() => { if (!timelineSnap.on) this.clear(); });
    const field = el<HTMLElement>('<div class="fm-mk-field"><input class="fm-mk-name" type="text" maxlength="80" placeholder="Marker name" aria-label="Marker name"></div>');
    this.nameIn = q<HTMLInputElement>(field, 'input');
    this.nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.commitName(); this.pop.hide(); } });
    this.nameIn.addEventListener('change', () => this.commitName());
    const sw = el<HTMLElement>('<div class="fm-mk-swatches" role="group" aria-label="Marker color"></div>');
    for (const name of ['', ...mk.MARKER_COLORS]) {
      const b = el<HTMLButtonElement>(`<button class="fm-mk-sw" type="button" data-hl="${name || 'none'}" aria-label="${name || 'Default'}"><span class="fm-cm-dot" data-hl="${name || 'none'}"></span></button>`);
      b.addEventListener('click', () => {
        const id = this.editing;
        if (!id) return;
        this.engine.run('Marker Color', (m) => mk.patchMarker(m, id, { color: name || null }));
        this.paintSwatches(name);
      });
      this.swatches.set(name, b);
      sw.appendChild(b);
    }
    const del = popRow('trash', 'Delete marker', { danger: true });
    del.el.addEventListener('click', () => {
      const id = this.editing;
      this.pop.hide();
      if (id) this.engine.run('Delete Marker', (m) => mk.deleteMarker(m, id));
    });
    this.pop.body.append(field, sw, del.el);
    geo.ruler.addEventListener('contextmenu', (e) => {
      const hit = this.markerAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      this.edit(hit.id, e.clientX, e.clientY);
    });
    geo.ruler.addEventListener('dblclick', (e) => {
      const hit = this.markerAt(e.clientX, e.clientY);
      if (hit) this.edit(hit.id, e.clientX, e.clientY);
    });
  }

  // ---- snapping ----

  clear(): void {
    this.cache = null;
    if (this.line !== null) { this.line = null; this.geo.schedule(); }
  }

  private setLine(f: number | null): void {
    if (f !== this.line) { this.line = f; this.geo.schedule(); }
  }

  private active(e: PointerEvent | MouseEvent): boolean {
    return timelineSnap.on && !e.ctrlKey && !e.metaKey;
  }

  /** The total move (frames since the drag began) after pulling the moving blocks' edges to a target. */
  snapMove(m: Movie, ids: string[], tag: string, applied: number, total: number, e: PointerEvent): number {
    if (!this.active(e)) { this.setLine(null); return total; }
    if (!this.cache || this.cache.tag !== tag) {
      const skip = new Set(ids);
      const moving: Content[] = [];
      for (const t of m.tracks) for (const c of t.content) if (skip.has(c.id)) moving.push(c);
      this.cache = { tag, targets: snapTargets(m, this.engine.frame, skip), edges: edgesOf(moving).map((x) => x - applied) };
    }
    const r = snapDelta(this.cache.edges, this.cache.targets, total, reachFrames(this.geo.ppf()));
    this.setLine(r.line);
    return r.delta;
  }

  /** The total trim after pulling the dragged edge to a target. */
  snapTrim(m: Movie, id: string, edge: 'start' | 'end', tag: string, applied: number, total: number, e: PointerEvent): number {
    if (!this.active(e)) { this.setLine(null); return total; }
    if (!this.cache || this.cache.tag !== tag) {
      let item: Content | null = null;
      for (const t of m.tracks) for (const c of t.content) if (c.id === id) item = c;
      if (!item) return total;
      const here = edge === 'start' ? item.start : end(item);
      this.cache = { tag, targets: snapTargets(m, this.engine.frame, new Set([id])), edges: [here - applied] };
    }
    const r = snapDelta(this.cache.edges, this.cache.targets, total, reachFrames(this.geo.ppf()));
    this.setLine(r.line);
    return r.delta;
  }

  /** The total move of one edge that sat at movie frame `here` when the drag began (an action strip's), pulled to a target. */
  snapAt(m: Movie, here: number, tag: string, total: number, e: PointerEvent): number {
    if (!this.active(e)) { this.setLine(null); return total; }
    if (!this.cache || this.cache.tag !== tag) this.cache = { tag, targets: snapTargets(m, this.engine.frame, new Set()), edges: [here] };
    const r = snapDelta(this.cache.edges, this.cache.targets, total, reachFrames(this.geo.ppf()));
    this.setLine(r.line);
    return r.delta;
  }

  // ---- markers ----

  private markerAt(clientX: number, clientY: number): { id: string; frame: number } | null {
    const m = this.engine.movie;
    if (!m?.markers?.length) return null;
    const r = this.geo.ruler.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    if (y > FLAG_H + 6) return null;
    let best: { id: string; frame: number } | null = null, bd = 8;
    for (const k of m.markers) {
      const d = Math.abs(this.geo.fx(k.frame) - x);
      if (d <= bd) { bd = d; best = k; }
    }
    return best;
  }

  /** Ruler pointer-down: true when a marker took it (a drag moves it, a click goes to it). */
  rulerDown(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    const hit = this.markerAt(e.clientX, e.clientY);
    if (!hit) return false;
    const id = hit.id, x0 = e.clientX, f0 = hit.frame, tag = `marker-${Date.now()}`;
    let moved = false;
    this.engine.stop();
    this.geo.ruler.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const r = this.geo.ruler.getBoundingClientRect();
      const f = Math.max(0, Math.round(this.geo.xf(ev.clientX - r.left)));
      const cur = this.engine.movie?.markers?.find((k) => k.id === id);
      if (!cur || cur.frame === f) return;
      try { this.engine.run('Move Marker', (m) => mk.moveMarker(m, id, f), tag); } catch { /* another marker is there */ }
    };
    const up = (): void => {
      this.geo.ruler.removeEventListener('pointermove', move);
      this.geo.ruler.removeEventListener('pointerup', up);
      this.geo.ruler.removeEventListener('pointercancel', up);
      if (moved) this.engine.endGesture(); else this.engine.seek(f0);
    };
    this.geo.ruler.addEventListener('pointermove', move);
    this.geo.ruler.addEventListener('pointerup', up);
    this.geo.ruler.addEventListener('pointercancel', up);
    return true;
  }

  edit(id: string, x: number, y: number): void {
    const k = this.engine.movie?.markers?.find((v) => v.id === id);
    if (!k) return;
    this.editing = id;
    this.nameIn.value = k.name;
    this.paintSwatches(k.color ?? '');
    this.pop.showAt(x, y + 8);
    this.nameIn.focus();
    this.nameIn.select();
  }

  private paintSwatches(color: string): void {
    for (const [name, b] of this.swatches) setClass(b, 'is-on', name === color);
  }

  private commitName(): void {
    const id = this.editing;
    if (!id) return;
    const v = this.nameIn.value;
    const cur = this.engine.movie?.markers?.find((k) => k.id === id);
    if (cur && cur.name !== v) this.engine.run('Rename Marker', (m) => mk.patchMarker(m, id, { name: v }));
  }

  /** Flags on the ruler, then a hair line down it. */
  drawRuler(c: CanvasRenderingContext2D, m: Movie, p: Pal, width: number): void {
    const list = m.markers;
    if (!list?.length) return;
    c.save();
    c.font = '600 10px Inter, system-ui, sans-serif';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    for (const k of list) {
      const x = Math.round(this.geo.fx(k.frame)) + 0.5;
      if (x < -200 || x > width + 8) continue;
      const col = k.color && k.color in p.hl ? p.hl[k.color as Highlight] : p.accent;
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(x - 5, 0);
      c.lineTo(x + 5, 0);
      c.lineTo(x + 5, FLAG_H - 4);
      c.lineTo(x, FLAG_H);
      c.lineTo(x - 5, FLAG_H - 4);
      c.closePath();
      c.fill();
      c.globalAlpha = 0.5;
      c.fillRect(x - 0.5, FLAG_H, 1, 6);
      c.globalAlpha = 1;
      if (k.name) {
        const next = list.find((o) => o.frame > k.frame);
        const room = (next ? this.geo.fx(next.frame) : width) - x - 14;
        if (room > 24) {
          let s = k.name;
          while (s.length > 1 && c.measureText(s).width > room) s = s.slice(0, -1);
          c.fillStyle = p.text;
          c.fillText(s === k.name ? s : `${s}...`, x + 8, FLAG_H / 2 + 0.5);
        }
      }
    }
    c.restore();
  }

  // ---- transitions ----

  /** Bands over each transition window and the length handle at its right end, then the snap line. */
  drawTracks(c: CanvasRenderingContext2D, m: Movie, p: Pal, height: number): void {
    const bh = this.geo.blockH();
    c.save();
    for (let i = 0; i < m.tracks.length; i++) {
      const y = this.geo.laneTop(i);
      if (y + bh < 0 || y > height) continue;
      for (const b of m.tracks[i].content) {
        const w = windowOf(b);
        if (!w) continue;
        const x0 = this.geo.fx(w.from), x1 = this.geo.fx(w.to);
        c.globalAlpha = 0.38;
        c.fillStyle = p.accent;
        c.beginPath();
        c.moveTo(x0, y + bh);
        c.lineTo(x1, y);
        c.lineTo(x1, y + bh);
        c.closePath();
        c.fill();
        c.globalAlpha = 0.9;
        c.strokeStyle = p.accent;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(x0, y + bh);
        c.lineTo(x1, y);
        c.stroke();
        c.fillStyle = p.accent;
        c.globalAlpha = 1;
        c.fillRect(Math.round(x1) - 2, y + 4, 4, bh - 8);
      }
    }
    if (this.line !== null) {
      const x = Math.round(this.geo.fx(this.line)) + 0.5;
      c.strokeStyle = '#ffd24a';
      c.lineWidth = 1;
      c.setLineDash([4, 3]);
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, height);
      c.stroke();
      c.setLineDash([]);
    }
    c.restore();
  }

  /** Tracks pointer-down on a transition's length handle: true when it took the press. */
  tracksDown(e: PointerEvent): boolean {
    const m = this.engine.movie;
    if (!m || e.button !== 0) return false;
    const r = this.geo.tracks.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const bh = this.geo.blockH();
    let hit: Content | null = null;
    for (let i = 0; i < m.tracks.length && !hit; i++) {
      const top = this.geo.laneTop(i);
      if (y < top || y > top + bh) continue;
      for (const b of m.tracks[i].content) {
        const w = windowOf(b);
        if (w && Math.abs(this.geo.fx(w.to) - x) <= 6) { hit = b; break; }
      }
    }
    if (!hit) return false;
    const id = hit.id, tag = `tr-${Date.now()}`;
    this.engine.stop();
    this.geo.tracks.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      const mv = this.engine.movie;
      if (!mv) return;
      const rr = this.geo.tracks.getBoundingClientRect();
      const f = this.geo.xf(ev.clientX - rr.left);
      let dur = Math.max(MIN_TRANSITION, Math.round(2 * (f - hit!.start)));
      // never longer than either block can hold on its side
      const cur = this.find(mv, id);
      if (!cur) return;
      const prev = mv.tracks.flatMap((t) => (t.content.includes(cur) ? t.content : [])).find((o) => end(o) === cur.start);
      dur = Math.min(dur, 2 * Math.min(cur.duration, prev?.duration ?? cur.duration));
      if (cur.transition && halves(cur.transition)[0] + halves(cur.transition)[1] === dur) return;
      this.engine.run('Transition Length', (v) => ops.updateContent(v, id, (c) => (c.transition ? { ...c, transition: { ...c.transition, duration: dur } } : c)), tag);
    };
    const up = (): void => {
      this.geo.tracks.removeEventListener('pointermove', move);
      this.geo.tracks.removeEventListener('pointerup', up);
      this.geo.tracks.removeEventListener('pointercancel', up);
      this.engine.endGesture();
    };
    this.geo.tracks.addEventListener('pointermove', move);
    this.geo.tracks.addEventListener('pointerup', up);
    this.geo.tracks.addEventListener('pointercancel', up);
    return true;
  }

  private find(m: Movie, id: string): Content | null {
    for (const t of m.tracks) for (const c of t.content) if (c.id === id) return c;
    return null;
  }
}
