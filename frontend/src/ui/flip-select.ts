// Frame selection of the Flipbook strip: a set of frames named by track id and frame id (so it survives other edits),
// range select, the previous selection for Reload, and the box that a lasso drag draws over the rows.
import type { FrameRef } from '../engine/flip-ops';
import type { Content } from '../engine/types';
import { el } from './dom';

export class FlipSelect {
  private sets = new Map<string, Set<string>>();
  private prev: FrameRef[] = [];
  anchor: { track: string; frame: string } | null = null;
  /** Multi-select mode: a plain click toggles instead of moving the open frame. */
  multi = false;

  get count(): number {
    let n = 0;
    for (const s of this.sets.values()) n += s.size;
    return n;
  }

  has(track: string, frame: string): boolean { return this.sets.get(track)?.has(frame) ?? false; }

  refs(): FrameRef[] {
    return Array.from(this.sets, ([track, s]) => ({ track, frames: Array.from(s) })).filter((r) => r.frames.length);
  }

  clear(): boolean {
    if (!this.count) return false;
    this.prev = this.refs();
    this.sets = new Map();
    return true;
  }

  /** Replaces the selection (a lasso, a drop); an empty list clears. */
  set(refs: FrameRef[]): void {
    if (this.count) this.prev = this.refs();
    this.sets = new Map(refs.filter((r) => r.frames.length).map((r) => [r.track, new Set(r.frames)]));
  }

  add(track: string, frame: string): void {
    let s = this.sets.get(track);
    if (!s) this.sets.set(track, (s = new Set()));
    s.add(frame);
    this.anchor = { track, frame };
  }

  toggle(track: string, frame: string): void {
    const s = this.sets.get(track);
    if (s?.has(frame)) {
      s.delete(frame);
      if (!s.size) this.sets.delete(track);
    } else this.add(track, frame);
    this.anchor = { track, frame };
  }

  /** Shift-click: every frame between the anchor and this one, over the rows between them. */
  range(c: Content, track: string, frame: string): void {
    const a = this.anchor;
    if (!a) { this.set([{ track, frames: [frame] }]); this.anchor = { track, frame }; return; }
    const span = (id: string, f: string): [number, number] | null => {
      const t = c.flip.find((x) => x.id === id);
      if (!t) return null;
      let at = 0;
      for (const fr of t.frames) {
        const h = Math.max(1, fr.hold);
        if (fr.id === f) return [at, at + h];
        at += h;
      }
      return null;
    };
    const s0 = span(a.track, a.frame), s1 = span(track, frame);
    if (!s0 || !s1) return;
    const lo = Math.min(s0[0], s1[0]), hi = Math.max(s0[1], s1[1]);
    const r0 = c.flip.findIndex((t) => t.id === a.track), r1 = c.flip.findIndex((t) => t.id === track);
    const refs: FrameRef[] = [];
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      const t = c.flip[r];
      const ids: string[] = [];
      let at = 0;
      for (const fr of t.frames) {
        const h = Math.max(1, fr.hold);
        if (at < hi && at + h > lo) ids.push(fr.id);
        at += h;
      }
      refs.push({ track: t.id, frames: ids });
    }
    const keep = this.anchor;
    this.set(refs);
    this.anchor = keep;
  }

  /** Brings the previous selection back, dropping frames that no longer exist. */
  reload(c: Content): boolean {
    const live = this.prev
      .map((r) => ({ track: r.track, frames: r.frames.filter((id) => c.flip.some((t) => t.id === r.track && t.frames.some((f) => f.id === id))) }))
      .filter((r) => r.frames.length);
    if (!live.length) return false;
    this.sets = new Map(live.map((r) => [r.track, new Set(r.frames)]));
    return true;
  }

  /** Follows frames that moved to another row and drops ids that vanished from the content. */
  prune(c: Content): boolean {
    let changed = false;
    for (const [track, s] of Array.from(this.sets)) {
      const t = c.flip.find((x) => x.id === track);
      for (const id of Array.from(s)) {
        if (t?.frames.some((f) => f.id === id)) continue;
        s.delete(id);
        changed = true;
        const to = c.flip.find((x) => x.frames.some((f) => f.id === id));
        if (to) { let n = this.sets.get(to.id); if (!n) this.sets.set(to.id, (n = new Set())); n.add(id); }
      }
      if (!s.size) this.sets.delete(track);
    }
    return changed;
  }
}

/** True when the point is inside the closed loop (even-odd). */
export function loopContains(pts: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** True when the line the pointer drew passes through the rectangle (sampled every few pixels, so a fast flick still counts). */
export function pathTouches(pts: readonly { x: number; y: number }[], r: { left: number; right: number; top: number; bottom: number }): boolean {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[i + 1] ?? a;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
  }
  return false;
}

/** The loop a lasso drag draws, freehand: one SVG built once, its points patched as the pointer moves. A loop that closes on itself
 *  selects the cells it encloses; a plain stroke across cells selects the cells it crosses. */
export class Lasso {
  readonly el: SVGSVGElement;
  private readonly poly: SVGPolygonElement;
  private pts: { x: number; y: number }[] = [];
  constructor(private readonly host: HTMLElement) {
    this.el = el('<svg class="fm-fs-lasso" hidden aria-hidden="true"><polygon class="fm-fs-lasso-fill" points=""/></svg>') as unknown as SVGSVGElement;
    this.poly = this.el.querySelector('polygon') as SVGPolygonElement;
    host.appendChild(this.el);
  }

  // an SVG element has no .hidden property, so the attribute is toggled
  begin(x: number, y: number): void {
    this.pts = [{ x, y }];
    this.el.removeAttribute('hidden');
    this.move(x, y);
  }

  /** Adds a point; returns the loop so far in client coordinates. */
  move(x: number, y: number): readonly { x: number; y: number }[] {
    const last = this.pts[this.pts.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) >= 2) this.pts.push({ x, y });
    const r = this.host.getBoundingClientRect();
    this.poly.setAttribute('points', this.pts.map((p) => `${(p.x - r.left).toFixed(1)},${(p.y - r.top).toFixed(1)}`).join(' '));
    return this.pts;
  }

  end(): void { this.el.setAttribute('hidden', ''); this.pts = []; }
}
