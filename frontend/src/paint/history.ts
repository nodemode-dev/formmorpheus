// Undo stack of the paint document. Pixel entries hold a PixelPatch (stroke, fill);
// layer entries hold two layer-list snapshots (rasters are referenced, not copied)
// plus the patches of any raster the edit changed in place (merge down).

import type { PaintLayer, PixelPatch, Raster, Rect } from './types';
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
}

export interface LayerSnapshot {
  layers: SnapLayer[];
  active: string;
}

export type PaintEntry =
  | { kind: 'pixels'; label: string; patch: PixelPatch }
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

function entryBytes(e: PaintEntry): number {
  if (e.kind === 'pixels') return e.patch.before.byteLength + e.patch.after.byteLength;
  let n = 0;
  if (e.patches) for (const p of e.patches) n += p.before.byteLength + p.after.byteLength;
  // Rasters held by only one side stay alive only through this entry.
  const a = new Set<Raster>();
  for (const l of e.after.layers) a.add(l.raster);
  const b = new Set<Raster>();
  for (const l of e.before.layers) {
    b.add(l.raster);
    if (!a.has(l.raster)) n += l.raster.data.byteLength;
  }
  for (const r of a) if (!b.has(r)) n += r.data.byteLength;
  return n;
}

export class PaintHistory {
  private undoStack: PaintEntry[] = [];
  private redoStack: PaintEntry[] = [];
  private bytes = 0;
  private dropped = false;

  constructor(
    private readonly host: PaintHost,
    public depth = 200,
    public budget = 1.5 * 1024 * 1024 * 1024,
  ) {}

  push(e: PaintEntry): void {
    this.redoStack.length = 0;
    const top = this.undoStack[this.undoStack.length - 1];
    if (e.kind === 'layers' && e.tag && top && top.kind === 'layers' && top.tag === e.tag) {
      top.after = e.after;
      return;
    }
    this.undoStack.push(e);
    this.bytes += entryBytes(e);
    while (this.undoStack.length > 1 && (this.undoStack.length > this.depth || this.bytes > this.budget)) {
      const old = this.undoStack.shift()!;
      this.bytes -= entryBytes(old);
      this.dropped = true;
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
      const l = this.host.layerById(e.patch.layer);
      if (!l) return;
      writeRect(l.raster, e.patch.rect, forward ? e.patch.after : e.patch.before);
      this.host.touch(l.raster, e.patch.rect);
      this.host.changed('pixels', e.patch.rect);
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
