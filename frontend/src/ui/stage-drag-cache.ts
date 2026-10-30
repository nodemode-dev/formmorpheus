// Stage drag cache: while a block is dragged, scaled or rotated on the Stage, the tracks below it and above it are
// drawn once into two bitmaps and every pointer step draws only the moved block between them. Only plain stacks
// qualify (normal blend, no mask, no followers of the moved block, no video, CPU raster); anything else renders in
// full, as before. The picture sequence matches a full render, so ending the gesture shows no change.

import type { Renderer, View } from '../engine/render';
import { BACKSTAGE_DEFAULT } from '../engine/render';
import { end, locate } from '../engine/model';
import type { Content, Movie, Track } from '../engine/types';

interface Opts { backstage: boolean; background: string; transparentChecker: CanvasPattern | string | null }

const active = (t: Track, frame: number): Content | undefined => t.content.find((x) => frame >= x.start && frame < end(x));

/** What the picture at `frame` depends on: movie-wide fields, and the objects of each visible track's content (and its parents). Equal lists draw the same picture. */
export function pictureSig(m: Movie, frame: number, skip?: readonly string[]): unknown[] {
  const out: unknown[] = [frame, m.width, m.height, m.background, m.transparent, m.backstage, m.camera, m.assets, m.tracks.length];
  for (const t of m.tracks) {
    out.push(t.hidden, t.screen);
    if (t.hidden) continue;
    const c = active(t, frame);
    if (!c || c.kind === 'audio') { out.push(null); continue; }
    if (skip?.includes(c.id)) { out.push(c.id); continue; }
    out.push(c);
    let p = c.parent, n = 0;
    while (p && n++ < 8) {
      const pc = locate(m, p)?.content;
      out.push(pc);
      p = pc?.parent;
    }
  }
  return out;
}

export function sameSig(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Built { movie: Movie; frame: number; view: View; ids: string; sig: unknown[]; lo: number; hi: number; below: boolean; above: boolean }

export class DragCache {
  private b: Built | null = null;
  private below: OffscreenCanvas | null = null;
  private above: OffscreenCanvas | null = null;
  private mix: OffscreenCanvas | null = null;

  constructor(private readonly renderer: Renderer) {}

  get live(): boolean { return !!this.b; }

  drop(): void {
    this.b = null;
    // release the bitmaps' memory (a UHD Stage holds three)
    for (const c of [this.below, this.above, this.mix]) if (c) { c.width = 1; c.height = 1; }
    this.below = this.above = this.mix = null;
  }

  /** Draws the Stage picture for a gesture on `ids` into `ctx` (device pixels, the Stage canvas); false: render in full. */
  paint(ctx: CanvasRenderingContext2D, m: Movie, frame: number, view: View, ids: readonly string[], opts: Opts, camera: boolean): boolean {
    if (camera || this.renderer.gpuActive || !ids.length) { this.drop(); return false; }
    const key = ids.join();
    const sig = pictureSig(m, frame, ids);
    let b = this.b;
    if (!b || b.frame !== frame || b.ids !== key || b.view.scale !== view.scale || b.view.ox !== view.ox || b.view.oy !== view.oy || b.view.width !== view.width || b.view.height !== view.height || !sameSig(b.sig, sig)) {
      this.drop();
      b = this.build(m, frame, view, ids, key, sig);
      if (!b) return false;
    }
    const w = Math.round(view.width), h = Math.round(view.height);
    const mix = this.mix as OffscreenCanvas;
    const mc = mix.getContext('2d') as OffscreenCanvasRenderingContext2D;
    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.globalAlpha = 1;
    mc.globalCompositeOperation = 'source-over';
    mc.clearRect(0, 0, w, h);
    if (b.below && this.below) mc.drawImage(this.below, 0, 0);
    this.renderer.composeLayer(mc, { ...m, tracks: this.span(m, b.lo, b.hi) }, frame, view, true);
    if (b.above && this.above) mc.drawImage(this.above, 0, 0);
    this.wrap(ctx, m, view, opts, mix);
    return true;
  }

  /** Only tracks lo..hi stay visible. */
  private span(m: Movie, lo: number, hi: number): Track[] {
    return m.tracks.map((t, i) => (i >= lo && i <= hi ? t : t.hidden ? t : { ...t, hidden: true }));
  }

  private build(m: Movie, frame: number, view: View, ids: readonly string[], key: string, sig: unknown[]): Built | null {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < m.tracks.length; i++) {
      const t = m.tracks[i];
      if (t.hidden) continue;
      const c = active(t, frame);
      if (c && ids.includes(c.id)) { lo = Math.min(lo, i); hi = Math.max(hi, i); }
    }
    if (hi < lo) return null;
    // every visible block must composite by plain source-over for the three parts to equal one render
    let any = false;
    for (let i = 0; i < m.tracks.length; i++) {
      const t = m.tracks[i];
      if (t.hidden) continue;
      const c = active(t, frame);
      if (!c || c.kind === 'audio' || c.opacity <= 0) continue;
      if (c.kind === 'video' || c.blend !== 'normal' || c.mask !== 'none') return null;
      any = true;
      if (!ids.includes(c.id)) {
        let p = c.parent, n = 0;
        while (p && n++ < 8) { if (ids.includes(p)) return null; p = locate(m, p)?.content.parent; }
      }
    }
    if (!any) return null;
    const w = Math.max(1, Math.round(view.width)), h = Math.max(1, Math.round(view.height));
    const surf = (c: OffscreenCanvas | null): OffscreenCanvas => {
      const s = c ?? new OffscreenCanvas(w, h);
      if (s.width !== w || s.height !== h) { s.width = w; s.height = h; }
      return s;
    };
    const hasBelow = hi < m.tracks.length - 1, hasAbove = lo > 0;
    this.mix = surf(this.mix);
    const part = (cv: OffscreenCanvas, from: number, to: number): boolean => {
      const c = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, w, h);
      this.renderer.composeLayer(c, { ...m, tracks: this.span(m, from, to) }, frame, view, true);
      return this.renderer.takeComplete();
    };
    if (hasBelow) {
      this.below = surf(this.below);
      if (!part(this.below, hi + 1, m.tracks.length - 1)) { this.drop(); return null; }
    }
    if (hasAbove) {
      this.above = surf(this.above);
      if (!part(this.above, 0, lo - 1)) { this.drop(); return null; }
    }
    this.b = { movie: m, frame, view: { ...view }, ids: key, sig, lo, hi, below: hasBelow, above: hasAbove };
    return this.b;
  }

  /** The renderer's own wrap: background, backstage ghost outside the frame, then the frame's fill and the picture inside it. */
  private wrap(ctx: CanvasRenderingContext2D, m: Movie, view: View, opts: Opts, layer: OffscreenCanvas): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, view.width, view.height);
    const back = m.backstage ?? BACKSTAGE_DEFAULT;
    if (opts.backstage && back > 0) {
      ctx.globalAlpha = back;
      ctx.drawImage(layer, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.ox, view.oy, m.width * view.scale, m.height * view.scale);
    ctx.clip();
    ctx.fillStyle = m.transparent && opts.transparentChecker ? opts.transparentChecker : m.background;
    ctx.fillRect(view.ox, view.oy, m.width * view.scale, m.height * view.scale);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    ctx.restore();
  }
}
