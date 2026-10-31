// Adjustment content on the CPU raster: everything drawn on lower tracks so far is copied, the block's own live
// filters run on the copy, and the result replaces the backdrop through the block's opacity and optional mask.
// The GPU compositor asks for the same weight picture (adjustWeight), so both paths mix with identical numbers.
import type { Animated } from './keys';
import type { Content, Movie } from './types';

type Surf = OffscreenCanvas;
type C2 = OffscreenCanvasRenderingContext2D;
interface ViewLike { scale: number; ox: number; oy: number; width: number; height: number }

/** What the renderer lends: scratch surfaces, its filter pass and its content drawer. */
export interface AdjustHost {
  surface(): Surf;
  release(s: Surf): void;
  filters(s: Surf, a: Animated, view: ViewLike, movie: Movie): void;
  draw(ctx: C2, c: Content, local: number, view: ViewLike, movie: Movie, a: Animated): void;
}

/** True when the block has any live filter to apply. */
export function hasFilters(a: Animated): boolean {
  return !!(a.blur || a.sharpen || a.noise || a.hsb || a.lens || a.boil || (a.fx && a.fx.length));
}

/**
 * The mix weight of an Adjustment as alpha on a view-sized surface (opacity times the mask, the mask softened by its
 * feather and flipped when inverted), or null when the weight is the plain opacity everywhere. `use` runs before the
 * surface goes back to the pool.
 */
export function adjustWeight(h: AdjustHost, c: Content, local: number, view: ViewLike, movie: Movie, a: Animated, op: number, use: (w: Surf | null) => void): void {
  if (!c.shape) { use(null); return; }
  const m = h.surface();
  const mc = m.getContext('2d') as C2;
  h.draw(mc, c, local, view, movie, a);
  const feather = (a.shape && a.shape.feather !== undefined ? a.shape.feather : c.shape.feather ?? 0) * view.scale;
  if (feather > 0.2) {
    // the same blur the live filters use, sized so its deviation is the feather in movie pixels
    const amount = feather / Math.max(1, Math.max(movie.width, movie.height) * 0.05 * view.scale);
    h.filters(m, { blur: amount, sharpen: 0, noise: null, hsb: null, lens: null, boil: null, fx: null } as unknown as Animated, view, movie);
  }
  mc.setTransform(1, 0, 0, 1, 0, 0);
  mc.globalAlpha = 1;
  if (c.maskInvert) {
    mc.globalCompositeOperation = 'source-out';
    mc.fillStyle = '#ffffff';
    mc.fillRect(0, 0, m.width, m.height);
  }
  if (op < 1) {
    mc.globalCompositeOperation = 'destination-in';
    mc.fillStyle = `rgba(0,0,0,${op.toFixed(5)})`;
    mc.fillRect(0, 0, m.width, m.height);
  }
  mc.globalCompositeOperation = 'source-over';
  try { use(m); } finally { h.release(m); }
}

/** Mixes the filtered copy of `out` back: out = out * (1 - w) + filtered * w. */
export function applyAdjustCpu(h: AdjustHost, out: C2, c: Content, a: Animated, local: number, view: ViewLike, movie: Movie): void {
  if (!hasFilters(a)) return;
  const op = Math.min(1, Math.max(0, a.opacity));
  if (op <= 0) return;
  const cv = out.canvas as Surf;
  const s = h.surface();
  const sc = s.getContext('2d') as C2;
  sc.drawImage(cv, 0, 0);
  h.filters(s, a, view, movie);
  out.save();
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.globalAlpha = 1;
  adjustWeight(h, c, local, view, movie, a, op, (w) => {
    if (w) {
      out.globalCompositeOperation = 'destination-out';
      out.drawImage(w, 0, 0);
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(w, 0, 0);
      sc.globalCompositeOperation = 'source-over';
      // 'lighter' adds the two weighted halves; source-over would attenuate the sum where the weight is partial
      out.globalCompositeOperation = 'lighter';
      out.drawImage(s, 0, 0);
    } else if (op >= 1) {
      out.globalCompositeOperation = 'copy';
      out.drawImage(s, 0, 0);
    } else {
      out.globalCompositeOperation = 'destination-out';
      out.fillStyle = `rgba(0,0,0,${op.toFixed(5)})`;
      out.fillRect(0, 0, cv.width, cv.height);
      out.globalCompositeOperation = 'lighter';
      out.globalAlpha = op;
      out.drawImage(s, 0, 0);
    }
  });
  out.restore();
  h.release(s);
}
