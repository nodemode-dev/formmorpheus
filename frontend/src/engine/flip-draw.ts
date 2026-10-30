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

/** A row drawn by the caller instead of from its stored layers (the Draw & Paint canvas draws the row being edited live). */
export interface RowLive { row: number; draw: (g: G) => void }

/** True when a visible row has a blend, a clipping or a mask: the plain stacking of rows would differ from the Stage. */
export function hasRowMix(c: Content): boolean {
  return c.flip.some((t) => !t.hidden && (t.blend !== 'normal' || isMaskRow(t) || isClipRow(t)));
}

/**
 * Draws a Flipbook's rows as the Stage does (row blend, clipping, masks) onto a screen context, through surfaces of
 * the screen's pixel size. `ctx` carries the world-to-screen transform; the result is drawn at identity.
 */
export class RowPreview {
  private readonly pool: OffscreenCanvas[] = [];

  private surface(w: number, h: number): OffscreenCanvas {
    const s = this.pool.pop() ?? new OffscreenCanvas(w, h);
    if (s.width !== w || s.height !== h) { s.width = w; s.height = h; }
    const g = s.getContext('2d', { willReadFrequently: true }) as G;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    return s;
  }

  draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, c: Content, local: number, live: RowLive, layers: (g: G, l: DrawingLayer[]) => void, blendOp: (b: BlendMode) => GlobalCompositeOperation, blendInto: FlipHost['blendInto']): void {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const out = this.surface(w, h);
    const og = out.getContext('2d') as G;
    og.setTransform(ctx.getTransform());
    const host: FlipHost = {
      surface: () => this.surface(w, h),
      release: (s) => { if (this.pool.length < 6) this.pool.push(s); },
      layers,
      mask: (target, mask, mode, invert) => {
        const tc = target.getContext('2d') as G;
        if (!(mode === 'alpha' && !invert)) {
          const mc = mask.getContext('2d') as G;
          const img = mc.getImageData(0, 0, mask.width, mask.height);
          const d = img.data;
          for (let p = 0; p < d.length; p += 4) {
            let a = mode === 'luminance' ? ((d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) * d[p + 3]) / 255 : d[p + 3];
            if (invert) a = 255 - a;
            d[p + 3] = a;
          }
          mc.putImageData(img, 0, 0);
        }
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(mask, 0, 0);
        tc.globalCompositeOperation = 'source-over';
      },
      blendOp,
      blendInto,
    };
    drawMaskedRows(host, og, c, local, live);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(out, 0, 0);
    ctx.restore();
    this.pool.push(out);
  }
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
export function drawMaskedRows(host: FlipHost, ctx: G, c: Content, local: number, live?: RowLive): void {
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
    if (fi < 0) {
      // a mask row with nothing to show is an empty mask: it hides the row below (inverted, it leaves it whole)
      if (isMaskRow(t) && held && !t.maskInvert) { host.release(held.s); held = null; }
      continue;
    }
    const s = host.surface();
    const g = s.getContext('2d') as G;
    g.setTransform(base);
    if (live && live.row === i) live.draw(g); else host.layers(g, t.frames[fi].layers);
    // the surface is later drawn and masked in pixels, so it must not keep the content transform
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (isMaskRow(t) && held) {
      if (t.opacity < 1) {
        // the row's own opacity scales the mask
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = `rgba(0,0,0,${Math.max(0, t.opacity)})`;
        g.fillRect(0, 0, s.width, s.height);
        g.globalCompositeOperation = 'source-over';
      }
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
