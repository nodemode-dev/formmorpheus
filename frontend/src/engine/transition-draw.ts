// Mixes the two sides of a transition onto one surface. Both the CPU path and the GPU path (which defers
// transition frames to the CPU) use this, so a frame is the same picture on either.
import type { ActiveTransition } from './transitions';

type Src = CanvasImageSource;
export interface MixRect { x: number; y: number; w: number; h: number }

/**
 * `out` is cleared. `a` is the outgoing picture, `b` the incoming; `oa`, `ob` their block opacities (0 to 1).
 * `rect` is the movie frame in surface pixels: wipes, pushes and the dip colour stay inside it.
 */
export function mixTransition(out: OffscreenCanvasRenderingContext2D, a: Src | null, b: Src | null, oa: number, ob: number, tx: ActiveTransition, rect: MixRect): void {
  const p = tx.p;
  const rx = Math.round(rect.x), ry = Math.round(rect.y), rw = Math.max(1, Math.round(rect.w)), rh = Math.max(1, Math.round(rect.h));
  out.save();
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.globalCompositeOperation = 'source-over';
  const draw = (img: Src | null, alpha: number, dx = 0, dy = 0): void => {
    if (!img || alpha <= 0) return;
    out.globalAlpha = alpha;
    out.drawImage(img, dx, dy);
  };
  switch (tx.tr.kind) {
    case 'crossfade': {
      // premultiplied sum: both sides keep their own edges where the other is empty
      out.globalCompositeOperation = 'lighter';
      draw(a, (1 - p) * oa);
      draw(b, p * ob);
      break;
    }
    case 'dip': {
      const first = p < 0.5;
      draw(first ? a : b, first ? oa : ob);
      const k = first ? p * 2 : 2 - p * 2;
      out.globalAlpha = Math.min(1, Math.max(0, k));
      out.fillStyle = tx.tr.color ?? '#000000';
      out.fillRect(rx, ry, rw, rh);
      break;
    }
    case 'wipe': {
      draw(a, oa);
      const dir = tx.tr.dir ?? 'l';
      out.save();
      out.beginPath();
      if (dir === 'l') out.rect(rx, ry, Math.round(rw * p), rh);
      else if (dir === 'r') { const w = Math.round(rw * p); out.rect(rx + rw - w, ry, w, rh); }
      else if (dir === 'u') { const h = Math.round(rh * p); out.rect(rx, ry + rh - h, rw, h); }
      else out.rect(rx, ry, rw, Math.round(rh * p));
      out.clip();
      draw(b, ob);
      out.restore();
      break;
    }
    case 'push': {
      const dir = tx.tr.dir ?? 'l';
      // the new picture enters from the named side; the old one leaves the other way
      const sx = dir === 'l' ? 1 : dir === 'r' ? -1 : 0, sy = dir === 'd' ? 1 : dir === 'u' ? -1 : 0;
      const ox = Math.round(rw * p) * sx, oy = Math.round(rh * p) * sy;
      out.save();
      out.beginPath();
      out.rect(rx, ry, rw, rh);
      out.clip();
      draw(a, oa, ox, oy);
      draw(b, ob, ox - rw * sx, oy - rh * sy);
      out.restore();
      break;
    }
  }
  out.restore();
}
