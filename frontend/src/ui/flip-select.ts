// Frame selection of the Flipbook strip: a set of frames named by track id and frame id (so it survives other edits),
// range select, the previous selection for Reload, and the box that a lasso drag draws over the rows.
import type { FrameRef } from '../engine/flip-ops';
import type { Content } from '../engine/types';
import { el, setHidden, setStyleVar } from './dom';

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

/** The box a lasso drag draws: created once, then moved with CSS variables. */
export class Lasso {
  readonly el: HTMLElement;
  private x0 = 0;
  private y0 = 0;
  constructor(private readonly host: HTMLElement) {
    this.el = el<HTMLElement>('<div class="fm-fs-lasso" hidden></div>');
    host.appendChild(this.el);
  }

  begin(x: number, y: number): void {
    this.x0 = x;
    this.y0 = y;
    setHidden(this.el, false);
    this.move(x, y);
  }

  /** Moves the free corner; returns the box in client coordinates. */
  move(x: number, y: number): DOMRect {
    const r = this.host.getBoundingClientRect();
    const l = Math.min(this.x0, x), t = Math.min(this.y0, y), w = Math.abs(x - this.x0), h = Math.abs(y - this.y0);
    setStyleVar(this.el, '--lx', `${l - r.left}px`);
    setStyleVar(this.el, '--ly', `${t - r.top}px`);
    setStyleVar(this.el, '--lw', `${w}px`);
    setStyleVar(this.el, '--lh', `${h}px`);
    return new DOMRect(l, t, w, h);
  }

  end(): void { setHidden(this.el, true); }
}
