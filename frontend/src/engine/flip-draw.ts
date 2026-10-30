// Flipbook rows with masks (Phase 13). A row set to a mask is not drawn: it cuts the row beneath it,
// the way a masking Timeline block cuts the block under it. Engine code: no DOM.
import { flipIndexAt } from './model';
import type { BlendMode, Content, DrawingLayer } from './types';

type G = OffscreenCanvasRenderingContext2D;

/** What the renderer lends: its surface pool, its layer drawing and its mask step. */
export interface FlipHost {
  surface(): OffscreenCanvas;
  release(s: OffscreenCanvas): void;
  layers(ctx: G, layers: DrawingLayer[]): void;
  mask(target: OffscreenCanvas, mask: OffscreenCanvas, mode: 'alpha' | 'luminance', invert: boolean): void;
  blendOp(b: BlendMode): GlobalCompositeOperation;
  /** Pixel-maths modes the canvas has no operation for: true when handled (the surface is blended onto ctx). */
  blendInto?(ctx: G, s: OffscreenCanvas, b: BlendMode, alpha: number): boolean;
}

export function isMaskRow(t: { mask?: string }): boolean {
  return t.mask === 'alpha' || t.mask === 'luminance';
}

/** A clipping row is drawn, but only where the row below it has pixels. */
export function isClipRow(t: { mask?: string }): boolean {
  return t.mask === 'clipping';
}

/** True when any visible row is a mask or a clipping row over another visible row. */
export function hasRowMask(c: Content): boolean {
  let below = false;
  for (let i = c.flip.length - 1; i >= 0; i--) {
    const t = c.flip[i];
    if (t.hidden) continue;
    if (below && (isMaskRow(t) || isClipRow(t))) return true;
    below = true;
  }
  return false;
}

/** `ctx` carries the content transform and base alpha; rows draw bottom to top, a mask row cuts the row held below it. */
export function drawMaskedRows(host: FlipHost, ctx: G, c: Content, local: number): void {
  const base = ctx.getTransform();
  const baseAlpha = ctx.globalAlpha;
  const baseOp = ctx.globalCompositeOperation;
  let held: { s: OffscreenCanvas; opacity: number; blend: BlendMode } | null = null;
  const commit = (): void => {
    if (!held) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = baseAlpha * held.opacity;
    ctx.globalCompositeOperation = held.blend === 'normal' ? baseOp : host.blendOp(held.blend);
    if (!(held.blend !== 'normal' && host.blendInto?.(ctx, held.s, held.blend, baseAlpha * held.opacity))) ctx.drawImage(held.s, 0, 0);
    ctx.restore();
    host.release(held.s);
    held = null;
  };
  for (let i = c.flip.length - 1; i >= 0; i--) {
    const t = c.flip[i];
    if (t.hidden) continue;
    const fi = flipIndexAt(t, local);
    if (fi < 0) continue;
    const s = host.surface();
    const g = s.getContext('2d') as G;
    g.setTransform(base);
    host.layers(g, t.frames[fi].layers);
    // the surface is later drawn and masked in pixels, so it must not keep the content transform
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (isMaskRow(t) && held) {
      host.mask((held as { s: OffscreenCanvas }).s, s, t.mask as 'alpha' | 'luminance', !!t.maskInvert);
      host.release(s);
      continue;
    }
    if (t.opacity <= 0) { host.release(s); continue; }
    // clip to the pixels of the row below, which is still held (a mask row above it has already cut it)
    if (isClipRow(t) && held) host.mask(s, (held as { s: OffscreenCanvas }).s, 'alpha', false);
    commit();
    held = { s, opacity: t.opacity, blend: t.blend };
  }
  commit();
}
