// Undo stack of the paint document. Pixel entries hold a PixelPatch (stroke, fill);
// layer entries hold two layer-list snapshots (rasters are referenced, not copied)
// plus the patches of any raster the edit changed in place (merge down).

import { memory } from '../platform/ipad-memory';
import type { PaintLayer, PaintMask, PixelPatch, Raster, Rect } from './types';
import type { BlendMode } from '../engine/types';

export interface SnapLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  alphaLock: boolean;
  clipping: boolean;
  source: string | null;
  raster: Raster;
  group?: boolean;
  parent?: string | null;
  collapsed?: boolean;
  mask?: PaintMask | null;
  maskSource?: string | null;
}

export interface LayerSnapshot {
  layers: SnapLayer[];
  active: string;
}

/** Default cap on the bytes all paint undo entries may hold; the oldest entries drop beyond it. */
export const PAINT_HISTORY_BUDGET = 1024 * 1024 * 1024;
const TILE = 128;
/** Patches under this many bytes stay one rectangle: tiling them saves nothing. */
const TILE_MIN_BYTES = 256 * 1024;

/**
 * A stroke that already knows which 64 px tiles it changed hands its undo step over as those tiles (row runs of
 * them) here, keyed by the patch it returns; the patch itself then only carries the bounding rect. The history
 * takes the tiles as they are: no copy of the bounding box, no scan of it.
 */
export const patchTiles = new WeakMap<PixelPatch, PixelPatch[]>();

/** Where the history reports that it dropped its oldest steps (the paint view shows it in its toast). */
export const historyNotice: { handler: ((text: string) => void) | null } = { handler: null };

export type PaintEntry =
  | { kind: 'pixels'; label: string; patches: PixelPatch[] }
  | { kind: 'layers'; label: string; before: LayerSnapshot; after: LayerSnapshot; tag?: string; patches?: PixelPatch[] };

/** What the history needs from its document. */
export interface PaintHost {
  layerById(id: string): PaintLayer | null;
  /** Replace the layer list and active id with a snapshot. */
  restore(s: LayerSnapshot): void;
  /** Raster bytes changed inside rect: invalidate caches, bump versions. */
  touch(raster: Raster, rect: Rect): void;
  changed(what: 'pixels' | 'layers', rect?: Rect): void;
}

/** Copy `bytes` (a rect's rows) into the raster. */
export function writeRect(r: Raster, rect: Rect, bytes: Uint8ClampedArray): void {
  const rowLen = rect.w * 4;
  for (let y = 0; y < rect.h; y++) {
    const dst = ((rect.y + y) * r.width + rect.x) * 4;
    r.data.set(bytes.subarray(y * rowLen, (y + 1) * rowLen), dst);
  }
}

/** Copy a rect's rows out of the raster. */
export function readRect(r: Raster, rect: Rect): Uint8ClampedArray {
  const rowLen = rect.w * 4;
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    const src = ((rect.y + y) * r.width + rect.x) * 4;
    out.set(r.data.subarray(src, src + rowLen), y * rowLen);
  }
  return out;
}

/**
 * A big patch (a long stroke has a bounding box close to the whole layer) is kept as only the
 * TILE-sized squares whose pixels changed, so a 4K stroke costs its length, not its bounding box.
 */
export function tilePatch(p: PixelPatch): PixelPatch[] {
  const { rect, before, after } = p;
  if (before.byteLength < TILE_MIN_BYTES || before.byteOffset % 4 || after.byteOffset % 4) return [p];
  const a = new Uint32Array(before.buffer, before.byteOffset, before.byteLength >> 2);
  const b = new Uint32Array(after.buffer, after.byteOffset, after.byteLength >> 2);
  const out: PixelPatch[] = [];
  let kept = 0;
  for (let ty = 0; ty < rect.h; ty += TILE) {
    const th = Math.min(TILE, rect.h - ty);
    for (let tx = 0; tx < rect.w; tx += TILE) {
      const tw = Math.min(TILE, rect.w - tx);
      let same = true;
      for (let y = 0; y < th && same; y++) {
        let i = (ty + y) * rect.w + tx;
        for (let x = 0; x < tw; x++, i++) if (a[i] !== b[i]) { same = false; break; }
      }
      if (same) continue;
      const tb = new Uint8ClampedArray(tw * th * 4), ta = new Uint8ClampedArray(tw * th * 4);
      for (let y = 0; y < th; y++) {
        const src = ((ty + y) * rect.w + tx) * 4;
        tb.set(before.subarray(src, src + tw * 4), y * tw * 4);
        ta.set(after.subarray(src, src + tw * 4), y * tw * 4);
      }
      kept += tb.byteLength;
      out.push({ layer: p.layer, rect: { x: rect.x + tx, y: rect.y + ty, w: tw, h: th }, before: tb, after: ta });
    }
  }
  return kept * 4 < before.byteLength * 3 ? out : [p];
}

function entryBytes(e: PaintEntry): number {
  if (e.kind === 'pixels') {
    let n = 0;
    for (const p of e.patches) n += p.before.byteLength + p.after.byteLength;
    return n;
  }
  let n = 0;
  if (e.patches) for (const p of e.patches) n += p.before.byteLength + p.after.byteLength;
  // Rasters held by only one side stay alive only through this entry.
  const a = new Set<Raster>();
  for (const l of e.after.layers) { a.add(l.raster); if (l.mask) a.add(l.mask.raster); }
  const b = new Set<Raster>();
  for (const l of e.before.layers) {
    for (const r of l.mask ? [l.raster, l.mask.raster] : [l.raster]) {
      b.add(r);
      if (!a.has(r)) n += r.width * r.height * 4;   // by size, not by `data`: reading it would unpark an idle layer, and the figure must not drift as layers park
    }
  }
  for (const r of a) if (!b.has(r)) n += r.width * r.height * 4;
  return n;
}

export class PaintHistory {
  private undoStack: PaintEntry[] = [];
  private redoStack: PaintEntry[] = [];
  private bytes = 0;
  private dropped = false;
  private warned = false;

  constructor(
    private readonly host: PaintHost,
    public depth = 200,
    public budget = memory.get('paintHistory'),
  ) {
    if (memory.kind !== 'ipad') return;
    const me = new WeakRef(this);
    const off = memory.watch('paintHistory', (v) => { const r = me.deref(); if (r) r.lowerTo(v); else off(); });
    const offD = memory.watch('paintUndoDepth', (v) => { const r = me.deref(); if (r) r.shedDepth(v); else offD(); });
    const offP = memory.onPressure((level) => { const r = me.deref(); if (!r) { offP(); return; } if (level !== 'tier') r.shedDepth(memory.get('undoFloor')); });
  }

  /** A lower memory tier or a warning: the byte limit drops to `bytes` and the oldest steps go until it holds (the newest step always stays). */
  private lowerTo(bytes: number): void {
    this.budget = Math.min(this.budget, bytes);
    this.dropOld(this.depth);
  }

  /** Keeps at most the newest `steps` undo steps and the same number of redo steps. */
  shedDepth(steps: number): void {
    if (!(steps >= 1) || !isFinite(steps)) return;
    this.dropOld(Math.min(this.depth, steps));
    if (this.redoStack.length > steps) this.redoStack.splice(0, this.redoStack.length - steps);
  }

  private dropOld(depth: number): void {
    while (this.undoStack.length > 1 && (this.undoStack.length > depth || this.bytes > this.budget)) {
      const old = this.undoStack.shift()!;
      this.bytes -= entryBytes(old);
      this.dropped = true;
    }
  }

  push(input: PaintEntry | { kind: 'pixels'; label: string; patch: PixelPatch }): void {
    const e: PaintEntry = 'patch' in input ? { kind: 'pixels', label: input.label, patches: patchTiles.get(input.patch) ?? tilePatch(input.patch) } : input;
    this.redoStack.length = 0;
    const top = this.undoStack[this.undoStack.length - 1];
    if (e.kind === 'layers' && e.tag && top && top.kind === 'layers' && top.tag === e.tag) {
      // a new object, so a document saved at the old top still sees a change
      this.undoStack[this.undoStack.length - 1] = { ...top, after: e.after };
      return;
    }
    this.undoStack.push(e);
    this.bytes += entryBytes(e);
    let overBudget = false;   // only a memory drop earns the toast; a depth drop is the setting working
    while (this.undoStack.length > 1 && (this.undoStack.length > Math.min(this.depth, memory.get('paintUndoDepth')) || this.bytes > this.budget)) {
      if (this.bytes > this.budget) overBudget = true;
      const old = this.undoStack.shift()!;
      this.bytes -= entryBytes(old);
      this.dropped = true;
    }
    if (!overBudget && this.bytes < this.budget / 2) this.warned = false;   // warn again after a real recovery
    if (overBudget && !this.warned) {
      this.warned = true;
      historyNotice.handler?.(`Paint history reached its ${Math.round(this.budget / 1048576)} MB limit: the oldest steps were dropped.`);
    }
  }

  /** The entry on top of the undo stack; identity marks a saved state. */
  top(): PaintEntry | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  /** True when oldest entries were discarded, so an empty stack no longer means "as loaded". */
  hasDropped(): boolean {
    return this.dropped;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  undoLabel(): string | null { return this.undoStack[this.undoStack.length - 1]?.label ?? null; }
  redoLabel(): string | null { return this.redoStack[this.redoStack.length - 1]?.label ?? null; }
  usedBytes(): number { return this.bytes; }

  /** Every raster the stacks keep alive (layers that a step removed still hold theirs); the document frees their canvas mirrors on dispose. */
  rasters(): Set<Raster> {
    const out = new Set<Raster>();
    for (const e of [...this.undoStack, ...this.redoStack]) {
      if (e.kind !== 'layers') continue;
      for (const l of [...e.before.layers, ...e.after.layers]) { out.add(l.raster); if (l.mask) out.add(l.mask.raster); }
    }
    return out;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.bytes -= entryBytes(e);
    this.redoStack.push(e);
    this.apply(e, false);
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.undoStack.push(e);
    this.bytes += entryBytes(e);
    this.apply(e, true);
    return true;
  }

  private apply(e: PaintEntry, forward: boolean): void {
    if (e.kind === 'pixels') {
      for (const p of e.patches) {
        const l = this.host.layerById(p.layer);
        if (!l) continue;
        writeRect(l.raster, p.rect, forward ? p.after : p.before);
        this.host.touch(l.raster, p.rect);
        this.host.changed('pixels', p.rect);
      }
      return;
    }
    const from = forward ? e.before : e.after;
    const to = forward ? e.after : e.before;
    if (e.patches) {
      const list = forward ? e.patches : e.patches.slice().reverse();
      for (const p of list) {
        const r = (to.layers.find((l) => l.id === p.layer) ?? from.layers.find((l) => l.id === p.layer))?.raster;
        if (!r) continue;
        writeRect(r, p.rect, forward ? p.after : p.before);
        this.host.touch(r, p.rect);
      }
    }
    this.host.restore(to);
    this.host.changed('layers');
  }
}
