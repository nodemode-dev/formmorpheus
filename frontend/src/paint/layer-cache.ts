// While one layer is painted, everything below it and everything above it changes rarely. Each side is drawn once
// into a canvas of its own, and a frame then draws three surfaces (below, the active layer with its live preview,
// above) instead of every layer. Only plain stacks qualify: no groups, masks or clipping layers, and every layer
// except the active one drawn normally (a blend mode reads what is under it, which a cached side does not have).
// Anything else, a base alpha or a non-default operation on the target, draws the whole list as before.
// Needs OffscreenCanvas only, like layer-tree.ts.

import { drawTree, type SurfacePool, type TreeHooks, type TreeItem, type TreeLive } from './layer-tree';
import type { Rect } from './types';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface CacheItem extends TreeItem {
  /** Bumped on every pixel change. */
  version: number;
  mask?: unknown;
}

interface Side { c: OffscreenCanvas; key: string }

export class LayerCache {
  private below: Side | null = null;
  private above: Side | null = null;

  constructor(private readonly w: number, private readonly h: number) {}

  /** True when this list can use the cache with `active` as the painted layer. */
  static fits(items: readonly CacheItem[], active: string): boolean {
    let found = false;
    for (const l of items) {
      if (l.group || l.parent || l.clipping || l.mask) return false;
      if (l.id === active) { found = true; continue; }
      if (l.blend !== 'normal') return false;
    }
    return found;
  }

  /** Draws the list onto ctx; false when it does not qualify (the caller draws it in full). */
  draw(ctx: Ctx, items: readonly CacheItem[], active: string, hooks: TreeHooks<CacheItem>, pool: SurfacePool, live: TreeLive | undefined, region: Rect | undefined): boolean {
    if (ctx.globalAlpha !== 1 || ctx.globalCompositeOperation !== 'source-over' || !LayerCache.fits(items, active)) return false;
    const at = items.findIndex((l) => l.id === active);
    const top = items.slice(0, at), mine = items[at], bottom = items.slice(at + 1);
    // lowest first: the caller's list is top first
    const lo = this.side('below', bottom, hooks, pool);
    const hi = this.side('above', top, hooks, pool);
    const R: Rect = region ?? { x: 0, y: 0, w: this.w, h: this.h };
    if (lo) ctx.drawImage(lo.c, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
    drawTree(ctx, [mine], this.w, this.h, hooks, pool, live, region);
    if (hi) ctx.drawImage(hi.c, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
    return true;
  }

  private side(which: 'below' | 'above', items: readonly CacheItem[], hooks: TreeHooks<CacheItem>, pool: SurfacePool): Side | null {
    const shown = items.filter((l) => l.visible && l.opacity > 0);
    if (!shown.length) { this.release(which); return null; }
    const key = shown.map((l) => `${l.id}:${l.version}:${l.opacity}`).join('|');
    let s = which === 'below' ? this.below : this.above;
    if (s && s.key === key) return s;
    if (!s) {
      s = { c: new OffscreenCanvas(this.w, this.h), key };
      if (which === 'below') this.below = s; else this.above = s;
    }
    const x = s.c.getContext('2d') as OffscreenCanvasRenderingContext2D;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, this.w, this.h);
    drawTree(x, shown, this.w, this.h, hooks, pool);
    s.key = key;
    return s;
  }

  private release(which: 'below' | 'above'): void {
    const s = which === 'below' ? this.below : this.above;
    if (!s) return;
    s.c.width = 0;
    if (which === 'below') this.below = null; else this.above = null;
  }

  dispose(): void {
    this.release('below');
    this.release('above');
  }
}
