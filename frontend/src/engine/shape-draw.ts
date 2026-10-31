// Canvas painting of a shape. The CPU raster is the one drawer: the GPU compositor takes its picture (render.ts needsCpu),
// so both paths and every export show the same pixels. No DOM.
import { bounds, outline, paintStops, rgbOf, trimmed, trimOutline, type ShapeVals, type Sub } from './shape';
import type { ShapeDef } from './shape-types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const css = (r: number, g: number, b: number, a: number): string => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${Math.min(1, Math.max(0, a)).toFixed(4)})`;

function pathOf(subs: Sub[]): Path2D {
  const p = new Path2D();
  for (const s of subs) {
    const n = s.p.length / 2;
    if (n < 2) continue;
    p.moveTo(s.p[0], s.p[1]);
    for (let i = 1; i < n; i++) p.lineTo(s.p[i * 2], s.p[i * 2 + 1]);
    if (s.closed) p.closePath();
  }
  return p;
}

function fillStyle(ctx: Ctx, d: ShapeDef, v: ShapeVals, box: [number, number, number, number]): string | CanvasGradient | null {
  const f = d.fill;
  if (!f || v.fillA <= 0) return null;
  if (f.kind === 'solid') return css(v.fillR, v.fillG, v.fillB, v.fillA);
  const stops = paintStops(f);
  const w = Math.max(1, box[2] - box[0]), h = Math.max(1, box[3] - box[1]);
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  let g: CanvasGradient;
  if (f.kind === 'linear') {
    const a = (v.ga * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    const L = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    g = ctx.createLinearGradient(cx - dx * L, cy - dy * L, cx + dx * L, cy + dy * L);
  } else {
    const gx = cx + v.gcx * (w / 2), gy = cy + v.gcy * (h / 2);
    g = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(w, h) / 2);
  }
  // stop positions are keyable; they stay in order so a crossing pair cannot throw
  let last = 0;
  stops.forEach((s, i) => {
    const o = Math.min(1, Math.max(last, v[`o${i}`] ?? s.o));
    last = o;
    const [r, gg, b] = rgbOf(s.color);
    g.addColorStop(o, css(r, gg, b, (s.alpha ?? 1) * v.fillA));
  });
  return g;
}

/**
 * Draws the shape centred on the movie centre. `ctx` already carries the content's transform in movie pixels.
 * `maskOnly` paints the closed shape in opaque white (an Adjustment's mask) and nothing else.
 */
export function paintShape(ctx: Ctx, d: ShapeDef, v: ShapeVals, movie: { width: number; height: number }, maskOnly = false, solid = false): void {
  // a Solid with no size of its own fills the movie
  if (solid && (v.w <= 0 || v.h <= 0)) v = { ...v, w: v.w > 0 ? v.w : movie.width, h: v.h > 0 ? v.h : movie.height };
  const subs = outline(d, v);
  if (!subs.length) return;
  const box = bounds(subs) ?? [-v.w / 2, -v.h / 2, v.w / 2, v.h / 2];
  ctx.save();
  ctx.translate(movie.width / 2, movie.height / 2);
  const closed = subs.filter((s) => s.closed);
  if (maskOnly) {
    if (closed.length) { ctx.fillStyle = '#ffffff'; ctx.fill(pathOf(closed)); }
    ctx.restore();
    return;
  }
  const fs = closed.length ? fillStyle(ctx, d, v, box) : null;
  if (fs) { ctx.fillStyle = fs; ctx.fill(pathOf(closed)); }
  const st = d.stroke;
  if (st && v.strokeW > 0 && v.strokeA > 0) {
    const cut = trimmed(v);
    const runs = cut ? trimOutline(subs, v) : subs;
    if (runs.length) {
      const align = !cut && closed.length === subs.length ? st.align ?? 'center' : 'center';
      ctx.strokeStyle = css(v.strokeR, v.strokeG, v.strokeB, v.strokeA);
      ctx.lineCap = st.cap ?? 'butt';
      ctx.lineJoin = st.join ?? 'miter';
      ctx.miterLimit = st.miter ?? 4;
      if (v.dash > 0) { ctx.setLineDash([v.dash, Math.max(0, v.gap)]); ctx.lineDashOffset = v.dashOffset; }
      const p = pathOf(runs);
      if (align === 'center') {
        ctx.lineWidth = v.strokeW;
        ctx.stroke(p);
      } else {
        // inside / outside: stroke twice as wide and keep the half that lies on the wanted side of the outline
        ctx.lineWidth = v.strokeW * 2;
        ctx.save();
        if (align === 'inside') ctx.clip(pathOf(subs));
        else {
          const big = new Path2D();
          const pad = v.strokeW * 2 + 8;
          big.rect(box[0] - pad - 1e4, box[1] - pad - 1e4, box[2] - box[0] + 2 * pad + 2e4, box[3] - box[1] + 2 * pad + 2e4);
          big.addPath(pathOf(subs));
          ctx.clip(big, 'evenodd');
        }
        ctx.stroke(p);
        ctx.restore();
      }
      if (v.dash > 0) ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

/** Diagonal half-light half-dark tile that stands for an Adjustment block in thumbnails. */
export function paintAdjustGlyph(ctx: Ctx, w: number, h: number): void {
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#26262c');
  g.addColorStop(0.5, '#8a8a96');
  g.addColorStop(1, '#ececf2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
