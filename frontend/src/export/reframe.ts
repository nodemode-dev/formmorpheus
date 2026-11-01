// How a movie frame is placed in an output of another shape, and the watermark laid over it. Pure drawing, no DOM
// (OffscreenCanvas only), so the page, the export worker and the preview all draw the same picture.
// fit 'contain': bars; 'cover': crop around a focus point; 'blur': the frame fitted inside a blurred, darkened copy of itself that fills the output.
import type { Renderer, View } from '../engine/render';
import type { Movie } from '../engine/types';
import type { ExportOptions, Watermark } from './types';

type Ctx = OffscreenCanvasRenderingContext2D;
export type Delivery = Pick<ExportOptions, 'width' | 'height' | 'fit' | 'focus' | 'watermark'>;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The picture view for fit or cover; `cover` keeps the focus point (0..1 of the movie, default the centre) as near the middle of the output as the crop allows. */
export function placeView(o: { width: number; height: number; fit?: 'contain' | 'cover' | 'blur'; focus?: { x: number; y: number } }, movieW: number, movieH: number, mode?: 'contain' | 'cover'): View {
  const m = mode ?? (o.fit === 'cover' ? 'cover' : 'contain');
  const k = m === 'cover' ? Math.max(o.width / movieW, o.height / movieH) : Math.min(o.width / movieW, o.height / movieH);
  const fw = movieW * k, fh = movieH * k;
  let ox = (o.width - fw) / 2, oy = (o.height - fh) / 2;
  if (m === 'cover') {
    const f = o.focus ?? { x: 0.5, y: 0.5 };
    if (fw > o.width) ox = clamp(o.width / 2 - clamp(f.x, 0, 1) * fw, o.width - fw, 0);
    if (fh > o.height) oy = clamp(o.height / 2 - clamp(f.y, 0, 1) * fh, o.height - fh, 0);
  }
  return { scale: k, ox, oy, width: o.width, height: o.height };
}

interface Scratch { a: OffscreenCanvas; b: OffscreenCanvas; s: OffscreenCanvas; q: OffscreenCanvas }
let scratch: Scratch | null = null;

function scratchFor(w: number, h: number): Scratch {
  if (scratch && scratch.a.width === w && scratch.a.height === h) return scratch;
  const sw = Math.max(2, Math.round(w / 8)), sh = Math.max(2, Math.round(h / 8));
  scratch = { a: new OffscreenCanvas(w, h), b: new OffscreenCanvas(w, h), s: new OffscreenCanvas(sw, sh), q: new OffscreenCanvas(Math.max(2, Math.round(sw / 4)), Math.max(2, Math.round(sh / 4))) };
  return scratch;
}

let filterWorks: boolean | undefined;
/** Whether this canvas really applies ctx.filter: the property is there AND a value written reads back (a context that
 *  ignores it accepts the assignment without error, so a try/catch cannot tell). */
function canFilter(ctx: Ctx): boolean {
  if (filterWorks !== undefined) return filterWorks;
  const f = ctx as unknown as { filter?: string };
  if (!('filter' in ctx)) return (filterWorks = false);
  const keep = f.filter;
  f.filter = 'blur(2px)';
  filterWorks = f.filter === 'blur(2px)';
  f.filter = keep ?? 'none';
  return filterWorks;
}

type DrawOpts = { backstage: boolean; background: string; transparentChecker: null; keepAlpha: boolean; exact: boolean };


/** Draws movie frame `f` into `ctx` the way the options place it, then the watermark. `wm` comes from loadWatermark. */
export function drawDelivery(renderer: Renderer, ctx: Ctx, movie: Movie, f: number, o: Delivery, keepAlpha: boolean, wm: ReadyWatermark | null): void {
  const base: DrawOpts = { backstage: false, background: movie.background, transparentChecker: null, keepAlpha, exact: true };
  const w = o.width, h = o.height;
  if (o.fit === 'blur' && Math.abs(w / h - movie.width / movie.height) > 0.005) {
    const sc = scratchFor(w, h);
    const ca = sc.a.getContext('2d') as Ctx, cb = sc.b.getContext('2d') as Ctx, cs = sc.s.getContext('2d') as Ctx;
    renderer.drawFrame(ca, movie, f, placeView(o, movie.width, movie.height, 'cover'), { ...base, keepAlpha: false });
    // shrink then spread back soft: a cheap, even blur that never leaves transparent edges
    cs.clearRect(0, 0, sc.s.width, sc.s.height);
    cs.drawImage(sc.a, 0, 0, sc.s.width, sc.s.height);
    ca.clearRect(0, 0, w, h);
    ca.imageSmoothingEnabled = true;
    ca.imageSmoothingQuality = 'high';
    const px = Math.max(2, Math.round(Math.max(w, h) / 90));
    if (canFilter(ca)) {
      ca.filter = `blur(${px}px)`;
      ca.drawImage(sc.s, -px * 2, -px * 2, w + px * 4, h + px * 4);
      ca.filter = 'none';
    } else {
      // no filter: shrink again and spread back up through the middle size, so the result is soft without the property
      const cq = sc.q.getContext('2d') as Ctx;
      cq.imageSmoothingEnabled = true;
      cq.imageSmoothingQuality = 'high';
      cq.clearRect(0, 0, sc.q.width, sc.q.height);
      cq.drawImage(sc.s, 0, 0, sc.q.width, sc.q.height);
      cs.clearRect(0, 0, sc.s.width, sc.s.height);
      cs.imageSmoothingEnabled = true;
      cs.imageSmoothingQuality = 'high';
      cs.drawImage(sc.q, 0, 0, sc.s.width, sc.s.height);
      ca.drawImage(sc.s, -px * 2, -px * 2, w + px * 4, h + px * 4);
    }
    ca.fillStyle = 'rgba(0,0,0,0.3)';
    ca.fillRect(0, 0, w, h);
    // the bars stay transparent so the blurred copy shows through (the renderer only keeps alpha outside the frame for a transparent movie)
    renderer.drawFrame(cb, movie, f, placeView(o, movie.width, movie.height, 'contain'), { ...base, background: 'rgba(0,0,0,0)', keepAlpha });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(sc.a, 0, 0);
    ctx.drawImage(sc.b, 0, 0);
    ctx.restore();
  } else {
    renderer.drawFrame(ctx, movie, f, placeView(o, movie.width, movie.height), base);
  }
  if (wm) wm.draw(ctx, w, h);
}

export interface ReadyWatermark { draw(ctx: Ctx, w: number, h: number): void; close(): void }

/** Decodes a watermark once for a whole export (a picture is read from its data URL); null when there is none. */
export async function loadWatermark(wm: Watermark | undefined): Promise<ReadyWatermark | null> {
  if (!wm || wm.opacity <= 0) return null;
  let bmp: ImageBitmap | null = null;
  if (wm.kind === 'image') {
    if (!wm.image) return null;
    try { bmp = await createImageBitmap(await (await fetch(wm.image)).blob()); } catch { return null; }
  } else if (!wm.text?.trim()) return null;
  const size = clamp(wm.size, 1, 100) / 100;
  return {
    close: () => bmp?.close(),
    draw(ctx, w, h) {
      const margin = Math.round(Math.min(w, h) * 0.04);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = clamp(wm.opacity, 0, 1);
      ctx.globalCompositeOperation = 'source-over';
      let bw: number, bh: number;
      if (bmp) { bw = Math.max(1, w * size); bh = bw * (bmp.height / bmp.width); if (bh > h * 0.9) { bh = h * 0.9; bw = bh * (bmp.width / bmp.height); } }
      else {
        const fs = Math.max(8, Math.round(Math.min(w, h) * size));
        ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
        bw = ctx.measureText(wm.text as string).width; bh = fs;
      }
      const left = wm.pos === 'tl' || wm.pos === 'bl' ? margin : wm.pos === 'tr' || wm.pos === 'br' ? w - margin - bw : (w - bw) / 2;
      const top = wm.pos === 'tl' || wm.pos === 'tr' ? margin : wm.pos === 'bl' || wm.pos === 'br' ? h - margin - bh : (h - bh) / 2;
      if (bmp) ctx.drawImage(bmp, left, top, bw, bh);
      else {
        ctx.textBaseline = 'top';
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = Math.max(2, bh * 0.12);
        ctx.fillStyle = wm.color || '#ffffff';
        ctx.fillText(wm.text as string, left, top);
      }
      ctx.restore();
    },
  };
}
