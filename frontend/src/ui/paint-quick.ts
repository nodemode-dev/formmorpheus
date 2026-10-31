// QuickShape for the Draw & Paint canvas: watches the stroke that is down, and when the pen rests at its end for
// half a second replaces the raw stroke with the recognised shape (paint/quickshape.ts). While the pen stays down the
// shape follows it; Shift makes it regular. The host re-stamps the stroke; this class owns the timing and the state.
// Also Shift+click: a straight line from where the last stroke ended.

import { fitShape, forceShape, pressureAt, shapePoints, type Pt, type Shape, type ShapeKind } from '../paint/quickshape';
import { Popover, popRow } from './popover';
import { toast } from './toast';
import { t as tr } from './i18n';

export const DWELL_MS = 500;
const STILL_PX = 3;

export interface QuickHost {
  /** True when this pointer's stroke may snap (tool, mode and preference allow it). */
  allowed(e: PointerEvent): boolean;
  toCanvas(clientX: number, clientY: number): Pt;
  /** Throws away the stroke in progress and stamps these points instead (pressure per point), as the live stroke. */
  restamp(pts: Pt[], pressure: number[], template: unknown): void;
  /** The stroke ended: undo it and stamp another outline as one step. */
  replaceLast(pts: Pt[], pressure: number[], template: unknown): void;
  say(text: string): void;
}

export class QuickShapeCtl {
  shape: Shape | null = null;
  /** The end of the last finished stroke, in canvas pixels: where Shift+click starts a line. */
  lastEnd: Pt | null = null;
  lastProfile: number[] = [];
  private raw: Pt[] = [];
  private prs: number[] = [];
  private tpl: unknown = null;
  private armed = false;
  private anchor = { x: 0, y: 0 };
  private timer = 0;
  private pointer: Pt | null = null;
  private regular = false;
  private frame = 0;
  private last: { raw: Pt[]; prs: number[]; tpl: unknown } | null = null;
  private pop: Popover | null = null;

  constructor(private readonly host: QuickHost) {}

  /** The pen went down: start watching. */
  start(e: PointerEvent): void {
    this.reset();
    this.armed = this.host.allowed(e);
    this.anchor = { x: e.clientX, y: e.clientY };
    this.regular = e.shiftKey;
    if (this.armed) this.arm();
  }

  /** Samples that reached the stroke (the host calls this from its feed). */
  record(samples: { x: number; y: number; pressure: number; predicted?: boolean }[]): void {
    if (this.shape) return;
    for (const s of samples) {
      if (s.predicted) continue;
      this.raw.push({ x: s.x, y: s.y });
      this.prs.push(s.pressure);
      this.tpl = s;
    }
  }

  /** True while a snapped shape is following the pointer: the host must not add the raw samples. */
  moved(e: PointerEvent): boolean {
    if (!this.armed) return false;
    if (this.shape) {
      this.pointer = this.host.toCanvas(e.clientX, e.clientY);
      this.regular = e.shiftKey;
      this.schedule();
      return true;
    }
    if (Math.hypot(e.clientX - this.anchor.x, e.clientY - this.anchor.y) > STILL_PX) { this.anchor = { x: e.clientX, y: e.clientY }; this.arm(); }
    return false;
  }

  /** Shift pressed or released while the shape is held. */
  shift(on: boolean): void {
    if (!this.shape || this.regular === on) return;
    this.regular = on;
    this.schedule();
  }

  /** Shift+click: begin a line from the last stroke end to the pressed point; the pointer drags its end. */
  startLine(to: Pt, e: PointerEvent): boolean {
    const from = this.lastEnd;
    if (!from) return false;
    this.reset();
    this.armed = true;
    this.raw = [from, to];
    this.prs = this.lastProfile.length ? this.lastProfile : [0.6, 0.6];
    this.regular = false;
    this.shape = { kind: 'line', closed: false, grab: to, v: [from], sweep: 0, rx: 0, ry: 0, rot: 0 };
    this.pointer = to;
    this.tpl = null;
    void e;
    this.apply();
    return true;
  }

  /** The pen came up (or the stroke was cancelled): remember where it ended and, for a snapped shape, offer Edit Shape. */
  finish(cancelled: boolean): void {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const s = this.shape;
    if (!cancelled && this.raw.length) {
      let end = this.raw[this.raw.length - 1];
      if (s) { const pts = shapePoints(s, this.pointer, this.regular); end = pts[pts.length - 1] ?? end; }
      this.lastEnd = end;
      this.lastProfile = this.prs.length > 1 ? this.prs.slice() : [];
      if (s) {
        this.last = { raw: this.raw.slice(), prs: this.prs.slice(), tpl: this.tpl };
        if (s.kind !== 'line' || this.raw.length > 2) this.offerEdit(s.kind);
      }
    }
    this.reset();
  }

  private reset(): void {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.timer = 0;
    this.shape = null;
    this.raw = [];
    this.prs = [];
    this.pointer = null;
    this.armed = false;
  }

  private arm(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.snap(), DWELL_MS);
  }

  private snap(): void {
    this.timer = 0;
    if (this.shape || this.raw.length < 4) return;
    const s = fitShape(this.raw);
    if (!s) return;
    this.shape = s;
    this.pointer = null;
    this.apply();
    this.host.say(tr(label(s.kind)));
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.apply(); });
  }

  private apply(): void {
    const s = this.shape;
    if (!s) return;
    const pts = shapePoints(s, this.pointer, this.regular);
    const prs = pts.map((_, i) => pressureAt(this.prs, pts.length > 1 ? i / (pts.length - 1) : 0));
    this.host.restamp(pts, prs, this.tpl);
  }

  private offerEdit(kind: ShapeKind): void {
    void kind;
    toast(tr('Shape created'), 'info', { ms: 4000, actions: [{ label: tr('Edit Shape'), run: () => this.menu() }] });
  }

  /** The type menu: the last snapped shape is redone as another kind (one undo step either way). */
  private menu(): void {
    const l = this.last;
    if (!l) return;
    this.pop ??= new Popover('fm-qs-menu', 190);
    const pop = this.pop;
    while (pop.body.firstChild) pop.body.removeChild(pop.body.firstChild);
    for (const [kind, name] of [['line', 'Line'], ['ellipse', 'Ellipse'], ['rectangle', 'Rectangle'], ['triangle', 'Triangle']] as const) {
      const row = popRow(null, tr(name));
      row.el.addEventListener('click', () => {
        pop.hide();
        const s = forceShape(l.raw, kind);
        const pts = shapePoints(s, null, false);
        this.host.replaceLast(pts, pts.map((_, i) => pressureAt(l.prs, pts.length > 1 ? i / (pts.length - 1) : 0)), l.tpl);
        this.lastEnd = pts[pts.length - 1] ?? this.lastEnd;
      });
      pop.body.appendChild(row.el);
    }
    pop.showAt(window.innerWidth / 2 - 95, 56);
  }
}

function label(k: ShapeKind): string {
  return k === 'line' ? 'Line' : k === 'arc' ? 'Arc' : k === 'ellipse' ? 'Ellipse' : k === 'rectangle' ? 'Rectangle' : k === 'triangle' ? 'Triangle' : 'Polygon';
}
