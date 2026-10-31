// The paint Worker: it holds a mirror of the layer being painted and runs the stroke engine on it, so a
// heavy brush (a big soft airbrush, a wet blending brush) never blocks the page. The page sends pen samples;
// the worker stamps them with the same Stroke code that used to run on the page, and posts back the bytes of
// each changed rectangle (transferred, not copied). Undo patches are built on the page from those bytes.
// Nothing here touches the DOM.

import type { PenSample, Point, Raster, Rect, StrokeSettings, Mask } from './types';
import { Stroke } from './stroke';
import { setPressureCurve } from './dynamics';
import { hasShine } from './shine';

export type ToWorker =
  | {
    t: 'begin'; id: number; layer: string; w: number; h: number;
    /** The layer's bytes when the worker's mirror is stale, else null. */
    full: Uint8ClampedArray | null;
    /** The layer is empty: the worker makes its own blank mirror. */
    blank?: boolean;
    /** Selection id, and its pixels the first time that id is sent. */
    selId: number; sel: Mask | null;
    settings: Omit<StrokeSettings, 'selection'>;
    curve: Point[];
  }
  | { t: 'add'; id: number; samples: PenSample[] }
  | { t: 'finish'; id: number }
  | { t: 'cancel'; id: number };

export type FromWorker =
  | { t: 'step'; id: number; n: number; rect: Rect | null; bytes: Uint8ClampedArray | null }
  | { t: 'done'; id: number; n: number; rect: Rect | null; bytes: Uint8ClampedArray | null }
  | { t: 'error'; id: number; msg: string }
  /** The selection id is not cached here: the page resends the mask and the stroke falls back to its own thread. */
  | { t: 'miss'; id: number };

const FLUSH_MS = 10;
/** Selections kept by id; the page keeps the same number. */
const SEL_CACHE = 4; // keep equal to SEL_CACHE in ui/paint-bridge.ts

interface Live { id: number; stroke: Stroke; n: number; acc: Rect | null; last: number; timer: number; shine: boolean }

function flush(l: Live): void {
  if (l.timer) { clearTimeout(l.timer); l.timer = 0; }
  reply('step', l, l.acc);
  l.acc = null;
  l.last = performance.now();
}

let mirror: { layer: string; raster: Raster } | null = null;
let live: Live | null = null;
const sels = new Map<number, Mask>();

const ctx = self as unknown as { postMessage(m: FromWorker, t?: Transferable[]): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };

function grab(r: Raster, rc: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rc.w * rc.h * 4);
  for (let y = 0; y < rc.h; y++) {
    const o = ((rc.y + y) * r.width + rc.x) * 4;
    out.set(r.data.subarray(o, o + rc.w * 4), y * rc.w * 4);
  }
  return out;
}

function unite(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
}

function reply(kind: 'step' | 'done', l: Live, rect: Rect | null): void {
  if (rect && mirror) {
    const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
    const x1 = Math.min(mirror.raster.width, rect.x + rect.w), y1 = Math.min(mirror.raster.height, rect.y + rect.h);
    rect = x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  const bytes = rect && mirror ? grab(mirror.raster, rect) : null;
  ctx.postMessage({ t: kind, id: l.id, n: l.n, rect, bytes }, bytes ? [bytes.buffer] : []);
}

ctx.onmessage = (e: MessageEvent<ToWorker>): void => {
  const m = e.data;
  try {
    if (m.t === 'begin') {
      if (m.full) mirror = { layer: m.layer, raster: { width: m.w, height: m.h, data: m.full } };
      else if (m.blank) mirror = { layer: m.layer, raster: { width: m.w, height: m.h, data: new Uint8ClampedArray(m.w * m.h * 4) } };
      if (!mirror || mirror.raster.width !== m.w || mirror.raster.height !== m.h) throw new Error('mirror missing');
      if (m.sel) sels.set(m.selId, m.sel);
      if (m.selId && !sels.has(m.selId)) { ctx.postMessage({ t: 'miss', id: m.id }); return; }
      // most recent last, so the cache evicts in the same order as the page's list (SEL_CACHE ids)
      const selection = m.selId ? sels.get(m.selId) ?? null : null;
      if (m.selId && selection) { sels.delete(m.selId); sels.set(m.selId, selection); }
      while (sels.size > SEL_CACHE) sels.delete(sels.keys().next().value as number);
      setPressureCurve(m.curve);
      live = { id: m.id, stroke: new Stroke(mirror.raster, m.layer, { ...m.settings, selection }), n: 0, acc: null, last: 0, timer: 0, shine: m.settings.tool === 'paint' && hasShine(m.settings.brush.shine) };
      return;
    }
    const l = live;
    if (!l || l.id !== m.id) return; // a stroke that was cancelled: its late messages are dropped
    if (m.t === 'add') {
      for (const s of m.samples) {
        const r = l.stroke.add(s);
        l.n++;
        if (r) l.acc = unite(l.acc, r);
      }
      // rectangles are posted at most every FLUSH_MS: a backlog of samples costs the page one copy, not one per sample
      const t = performance.now();
      if (t - l.last >= FLUSH_MS) flush(l);
      else if (!l.timer) l.timer = setTimeout(() => { l.timer = 0; if (live === l) flush(l); }, FLUSH_MS - (t - l.last)) as unknown as number;
    } else if (m.t === 'finish') {
      if (l.timer) { clearTimeout(l.timer); l.timer = 0; }
      const patch = l.stroke.finish();
      live = null;
      // finishing a lit material bakes the whole stroke, so its whole rectangle comes back
      const tail = l.shine ? (patch ? patch.rect : null) : l.stroke.lastCallRect();
      reply('done', l, tail ? unite(l.acc, tail) : l.acc);
    } else if (m.t === 'cancel') {
      if (l.timer) { clearTimeout(l.timer); l.timer = 0; }
      l.stroke.cancel();
      live = null;
    }
  } catch (err) {
    live = null;
    mirror = null;
    ctx.postMessage({ t: 'error', id: m.id, msg: String((err as Error)?.message ?? err) });
  }
};
