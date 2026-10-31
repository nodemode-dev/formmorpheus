// The page's side of the paint Worker (paint/paint-worker.ts). A RemoteStroke looks like the old
// PumpedStroke to the paint view: `add` takes pen samples, `drain` posts them, `finish` lands the undo patch
// (now a promise, since the last stamps arrive from the worker). Changed rectangles come back as transferred
// bytes and are written into the layer here, with 64 px snapshots of what they replaced, so undo patches and
// a cancelled stroke are built on this thread exactly as Stroke built them. Samples the worker has not
// confirmed yet are exposed so the view can draw them as a thin live preview under the pen.
//
// Cross-origin isolation (SharedArrayBuffer) is not used: the pages here (Vite dev, the engine-served build,
// the Tauri webview) are not isolated, and transferred rectangles are small next to a stamp's cost.

import type { Mask, PenSample, PixelPatch, Point, Raster, Rect, StrokeSettings } from '../paint/types';
import { getPressureCurve } from '../paint/dynamics';
import { isParked, parkedEmpty } from '../paint/tiles';
import type { FromWorker, ToWorker } from '../paint/paint-worker';

const TILE = 64;
/** Selection masks the worker keeps by id (equal to SEL_CACHE in paint/paint-worker.ts). */
const SEL_CACHE = 4;

export interface BridgeTarget {
  id: string;
  raster: Raster;
  /** The layer's current pixel version: the worker's mirror is reused while it is unchanged. */
  version: () => number;
}

export interface BridgeHooks {
  /** A rectangle of the layer changed (null: only a confirmation arrived). */
  landed: (rect: Rect | null) => void;
}

let nextId = 1;
let nextSel = 1;
const selIds = new WeakMap<Mask, number>();

export class PaintBridge {
  private worker: Worker | null = null;
  private mirror: { raster: Raster; version: number } | null = null;
  private current: RemoteStroke | null = null;
  private sentSel = new Set<number>();
  broken = false;

  static supported(): boolean {
    try { if (localStorage.getItem('fm.paintWorker') === '0') return false; } catch { /* storage blocked */ }
    return typeof Worker !== 'undefined';
  }

  private ensure(): Worker | null {
    if (this.broken) return null;
    if (this.worker) return this.worker;
    try {
      const w = new Worker(new URL('../paint/paint-worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<FromWorker>) => this.current?.receive(e.data);
      w.onerror = () => this.fail();
      this.worker = w;
    } catch { this.broken = true; }
    return this.worker;
  }

  /** The worker died or threw: the live stroke is undone and strokes go back to this thread. */
  fail(): void {
    this.broken = true;
    this.mirror = null;
    this.worker?.terminate();
    this.worker = null;
    this.current?.abort();
  }

  /** Starts a stroke on the worker; null when strokes should run on this thread. */
  begin(target: BridgeTarget, settings: StrokeSettings, hooks: BridgeHooks): RemoteStroke | null {
    const w = this.ensure();
    if (!w || this.current) return null;
    const r = target.raster;
    const m = this.mirror;
    const fresh = !!m && m.raster === r && m.version === target.version();
    let full: Uint8ClampedArray | null = null;
    // a blank parked layer costs nothing to hand over; else the bytes are copied (the copy's buffer is transferred)
    const blank = !fresh && isParked(r) && parkedEmpty(r);
    if (!fresh && !blank) full = new Uint8ClampedArray(r.data);
    this.mirror = { raster: r, version: -1 };
    const sel = settings.selection;
    let selId = 0, selMask: Mask | null = null;
    if (sel) {
      selId = selIds.get(sel) ?? nextSel++;
      selIds.set(sel, selId);
      if (!this.sentSel.has(selId)) selMask = { width: sel.width, height: sel.height, data: sel.data.slice() };
      // most recent last: the worker evicts in the same order
      this.sentSel.delete(selId);
      this.sentSel.add(selId);
      while (this.sentSel.size > SEL_CACHE) this.sentSel.delete(this.sentSel.values().next().value as number);
    }
    const id = nextId++;
    const s = new RemoteStroke(this, w, id, target, hooks);
    this.current = s;
    const { selection: _drop, ...rest } = settings;
    void _drop;
    const msg: ToWorker = { t: 'begin', id, layer: target.id, w: r.width, h: r.height, full, blank, selId, sel: selMask, settings: rest, curve: getPressureCurve() };
    w.postMessage(msg, full ? [full.buffer] : []);
    return s;
  }

  /** The worker lost a selection: the next stroke sends its mask again. */
  forgetSelections(): void { this.sentSel.clear(); }

  /** Drops the worker and its mirror (Draw & Paint or the movie closed). */
  dispose(): void {
    this.current?.abort();
    this.mirror = null;
    this.sentSel.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  /** A stroke ended: the mirror matches the layer again when `ok`. */
  release(s: RemoteStroke, ok: boolean, version: number): void {
    if (this.current === s) this.current = null;
    if (this.mirror && ok) this.mirror.version = version;
    else this.mirror = null;
  }
}

let shared: PaintBridge | null = null;
export function paintBridge(): PaintBridge | null {
  if (!PaintBridge.supported()) return null;
  return (shared ??= new PaintBridge());
}

export class RemoteStroke {
  private readonly raster: Raster;
  private readonly w: number;
  private readonly h: number;
  private readonly tilesX: number;
  private readonly snap: (Uint8ClampedArray | undefined)[];
  private buffered: PenSample[] = [];
  private flying: PenSample[] = [];
  private confirmed: Point | null = null;
  private dx0 = 0; private dy0 = 0; private dx1 = 0; private dy1 = 0;
  private dirty = false;
  private ended = false;
  private waiter: ((p: PixelPatch | null) => void) | null = null;
  /** Always 0: stamping is not queued on this thread, so the frame pump has nothing to carry. */
  readonly pending = 0;

  constructor(private readonly bridge: PaintBridge, private readonly worker: Worker, private readonly id: number, private readonly target: BridgeTarget, private readonly hooks: BridgeHooks) {
    this.raster = target.raster;
    this.w = this.raster.width;
    this.h = this.raster.height;
    this.tilesX = Math.ceil(this.w / TILE);
    this.snap = new Array(this.tilesX * Math.ceil(this.h / TILE));
  }

  add(sample: PenSample): Rect | null {
    if (!this.ended && !sample.predicted) this.buffered.push(sample);
    return null;
  }

  /** Posts the samples gathered since the last call. */
  drain(_budgetMs?: number): Rect | null {
    if (this.ended || !this.buffered.length) return null;
    const samples = this.buffered;
    this.buffered = [];
    this.flying.push(...samples);
    this.worker.postMessage({ t: 'add', id: this.id, samples } satisfies ToWorker);
    return null;
  }

  /** Real samples the worker has not stamped yet, oldest first (for the live preview). */
  unconfirmed(): PenSample[] {
    return this.buffered.length ? [...this.flying, ...this.buffered] : this.flying;
  }

  /** The last real sample the worker has stamped. */
  confirmedPoint(): Point | null {
    return this.confirmed;
  }

  finish(): Promise<PixelPatch | null> {
    this.drain();
    return new Promise((resolve) => {
      if (this.ended) { resolve(null); return; }
      this.waiter = resolve;
      this.worker.postMessage({ t: 'finish', id: this.id } satisfies ToWorker);
    });
  }

  /** Puts the layer back at once; late messages from the worker are ignored. */
  cancel(): Rect | null {
    if (this.ended) return null;
    this.ended = true;
    this.worker.postMessage({ t: 'cancel', id: this.id } satisfies ToWorker);
    const rect = this.restore();
    this.bridge.release(this, true, this.target.version());
    return rect;
  }

  /** Worker failure: undo what landed so far. */
  abort(): void {
    if (this.ended) return;
    this.ended = true;
    const rect = this.restore();
    if (rect) this.hooks.landed(rect);
    this.bridge.release(this, false, 0);
    const w = this.waiter;
    this.waiter = null;
    w?.(null);
  }

  receive(m: FromWorker): void {
    if (m.id !== this.id || this.ended) return;
    if (m.t === 'error') { console.error('paint worker:', m.msg); this.bridge.fail(); return; }
    if (m.t === 'miss') { this.bridge.forgetSelections(); this.abort(); return; }
    // m.n counts the samples stamped so far in the whole stroke
    const upTo = Math.max(0, Math.min(this.flying.length, m.n - this.confirmedCount));
    if (upTo > 0) {
      this.confirmedCount += upTo;
      this.confirmed = { x: this.flying[upTo - 1].x, y: this.flying[upTo - 1].y };
      this.flying.splice(0, upTo);
    }
    if (m.rect && m.bytes) this.apply(m.rect, m.bytes);
    if (m.t === 'step') { this.hooks.landed(m.rect); this.lastVersion = this.target.version(); return; }
    // done: a layer version that moved since the last landed rectangle means something else wrote the layer (the mirror is stale)
    const foreign = this.lastVersion !== -2 && this.target.version() !== this.lastVersion;
    this.ended = true;
    let patch: PixelPatch | null = null;
    if (this.dirty) {
      const rect: Rect = { x: this.dx0, y: this.dy0, w: this.dx1 - this.dx0, h: this.dy1 - this.dy0 };
      patch = { layer: this.target.id, rect, before: this.copyRect(rect, true), after: this.copyRect(rect, false) };
    }
    this.hooks.landed(m.rect);
    this.snap.fill(undefined);
    this.bridge.release(this, !foreign, this.target.version());
    const w = this.waiter;
    this.waiter = null;
    w?.(patch);
  }

  private confirmedCount = 0;
  /** The layer version right after the last rectangle landed (-2: none yet). */
  private lastVersion = -2;

  /** Writes a rectangle from the worker into the layer, keeping the bytes it replaces for undo. */
  private apply(rc: Rect, bytes: Uint8ClampedArray): void {
    const x0 = rc.x, y0 = rc.y, x1 = rc.x + rc.w, y1 = rc.y + rc.h;
    if (!this.dirty) { this.dx0 = x0; this.dy0 = y0; this.dx1 = x1; this.dy1 = y1; this.dirty = true; }
    else {
      if (x0 < this.dx0) this.dx0 = x0;
      if (y0 < this.dy0) this.dy0 = y0;
      if (x1 > this.dx1) this.dx1 = x1;
      if (y1 > this.dy1) this.dy1 = y1;
    }
    const { w, h, raster } = this;
    const data = raster.data;
    for (let ty = y0 >> 6; ty <= (y1 - 1) >> 6; ty++) {
      for (let tx = x0 >> 6; tx <= (x1 - 1) >> 6; tx++) {
        const ti = ty * this.tilesX + tx;
        if (this.snap[ti]) continue;
        const t = new Uint8ClampedArray(TILE * TILE * 4);
        const sx = tx * TILE, sy = ty * TILE;
        const rw = Math.min(TILE, w - sx), rh = Math.min(TILE, h - sy);
        for (let row = 0; row < rh; row++) {
          const src = ((sy + row) * w + sx) * 4;
          t.set(data.subarray(src, src + rw * 4), row * TILE * 4);
        }
        this.snap[ti] = t;
      }
    }
    for (let row = 0; row < rc.h; row++) data.set(bytes.subarray(row * rc.w * 4, (row + 1) * rc.w * 4), ((y0 + row) * w + x0) * 4);
  }

  /** Puts every snapshotted tile back; the rectangle that changed, or null. */
  private restore(): Rect | null {
    if (!this.dirty) return null;
    const { w, h } = this;
    const data = this.raster.data;
    for (let ti = 0; ti < this.snap.length; ti++) {
      const t = this.snap[ti];
      if (!t) continue;
      const tx = (ti % this.tilesX) * TILE, ty = Math.floor(ti / this.tilesX) * TILE;
      const rw = Math.min(TILE, w - tx), rh = Math.min(TILE, h - ty);
      for (let row = 0; row < rh; row++) data.set(t.subarray(row * TILE * 4, row * TILE * 4 + rw * 4), ((ty + row) * w + tx) * 4);
    }
    this.snap.fill(undefined);
    return { x: this.dx0, y: this.dy0, w: this.dx1 - this.dx0, h: this.dy1 - this.dy0 };
  }

  /** Bytes of `rect`, current (before = false) or as they were before the stroke (before = true). */
  private copyRect(rect: Rect, before: boolean): Uint8ClampedArray {
    const { w } = this;
    const data = this.raster.data;
    const out = new Uint8ClampedArray(rect.w * rect.h * 4);
    for (let row = 0; row < rect.h; row++) {
      const y = rect.y + row;
      const src = (y * w + rect.x) * 4;
      out.set(data.subarray(src, src + rect.w * 4), row * rect.w * 4);
      if (!before) continue;
      const trow = (y >> 6) * this.tilesX;
      for (let tx = rect.x >> 6; tx <= (rect.x + rect.w - 1) >> 6; tx++) {
        const t = this.snap[trow + tx];
        if (!t) continue;
        const xa = Math.max(rect.x, tx * TILE), xb = Math.min(rect.x + rect.w, tx * TILE + TILE);
        const so = ((y & 63) * TILE + (xa - tx * TILE)) * 4;
        out.set(t.subarray(so, so + (xb - xa) * 4), (row * rect.w + (xa - rect.x)) * 4);
      }
    }
    return out;
  }
}
