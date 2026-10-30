import { end, flipIndexAt } from './model';
import { animate, type Animated } from './keys';
import { gaussianBlur, hsb, lensBlur, noise, sharpen } from '../paint/filters';
import type { Raster } from '../paint/types';
import type { BlendMode, Content, Movie, Track } from './types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Surface = OffscreenCanvas;

const BLEND_OP: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light',
  difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
  add: 'lighter', passthrough: 'source-over',
};

const BITMAP_CAP = 160;

export interface View {
  scale: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}

export function fitView(movie: Movie, width: number, height: number, margin = 0.06): View {
  const room = 1 - margin * 2;
  const scale = Math.min((width * room) / movie.width, (height * room) / movie.height);
  return { scale, ox: (width - movie.width * scale) / 2, oy: (height - movie.height * scale) / 2, width, height };
}

export class Renderer {
  private readonly bitmaps = new Map<string, ImageBitmap | null>();
  private readonly pending = new Set<string>();
  private readonly pool: Surface[] = [];
  private pw = 0;
  private ph = 0;
  private spare: Raster = { width: 0, height: 0, data: new Uint8ClampedArray(0) };

  constructor(private readonly blobOf: (id: string) => Blob | undefined, private readonly onReady: () => void) {}

  forget(): void {
    for (const b of this.bitmaps.values()) b?.close();
    this.bitmaps.clear();
    this.pending.clear();
  }

  async preload(blobs: Map<string, Blob>): Promise<void> {
    await Promise.all(Array.from(blobs, async ([id, blob]) => {
      if (this.bitmaps.has(id) || !blob.type.startsWith('image/')) return;
      try { this.keep(id, await createImageBitmap(blob)); } catch { this.keep(id, null); }
    }));
  }

  bitmap(id: string | null): ImageBitmap | null {
    if (!id) return null;
    const have = this.bitmaps.get(id);
    if (have !== undefined) {
      // most recently used last, so eviction takes the oldest
      this.bitmaps.delete(id);
      this.bitmaps.set(id, have);
      return have;
    }
    if (!this.pending.has(id)) {
      const blob = this.blobOf(id);
      if (!blob) return null;
      this.pending.add(id);
      createImageBitmap(blob).then((bmp) => { this.keep(id, bmp); }, () => { this.keep(id, null); }).finally(() => { this.pending.delete(id); this.onReady(); });
    }
    return null;
  }

  /** Decoded pictures are capped (each 4K layer is about 33 MB); the least recently drawn are closed and decode again on demand. */
  private keep(id: string, bmp: ImageBitmap | null): void {
    this.bitmaps.set(id, bmp);
    while (this.bitmaps.size > BITMAP_CAP) {
      const oldest = this.bitmaps.keys().next().value as string;
      this.bitmaps.get(oldest)?.close();
      this.bitmaps.delete(oldest);
    }
  }

  private surface(): Surface {
    const s = this.pool.pop() ?? new OffscreenCanvas(this.pw, this.ph);
    if (s.width !== this.pw || s.height !== this.ph) { s.width = this.pw; s.height = this.ph; }
    const c = s.getContext('2d') as OffscreenCanvasRenderingContext2D;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, s.width, s.height);
    return s;
  }

  private release(s: Surface): void {
    if (this.pool.length < 12) this.pool.push(s);
  }

  drawFrame(ctx: Ctx, movie: Movie, frame: number, view: View, opts: { backstage: boolean; background: string; transparentChecker: CanvasPattern | string | null }): void {
    this.pw = Math.max(1, Math.round(view.width));
    this.ph = Math.max(1, Math.round(view.height));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, view.width, view.height);
    const mw = movie.width * view.scale, mh = movie.height * view.scale;
    const layer = this.surface();
    this.composeTracks(layer.getContext('2d') as OffscreenCanvasRenderingContext2D, movie.tracks, frame, view, movie);
    if (opts.backstage) {
      ctx.globalAlpha = 0.28;
      ctx.drawImage(layer, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.ox, view.oy, mw, mh);
    ctx.clip();
    if (movie.transparent && opts.transparentChecker) {
      ctx.fillStyle = opts.transparentChecker;
      ctx.fillRect(view.ox, view.oy, mw, mh);
    } else {
      ctx.fillStyle = movie.background;
      ctx.fillRect(view.ox, view.oy, mw, mh);
    }
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    this.release(layer);
    ctx.restore();
  }

  private composeTracks(out: OffscreenCanvasRenderingContext2D, tracks: Track[], frame: number, view: View, movie: Movie): void {
    let held: { layer: Surface; c: Content; opacity: number } | null = null;
    const commit = (): void => {
      if (!held) return;
      out.globalAlpha = held.opacity;
      out.globalCompositeOperation = BLEND_OP[held.c.blend];
      out.drawImage(held.layer, 0, 0);
      out.globalAlpha = 1;
      out.globalCompositeOperation = 'source-over';
      this.release(held.layer);
      held = null;
    };
    for (let i = tracks.length - 1; i >= 0; i--) {
      const t = tracks[i];
      if (t.hidden) continue;
      const c = t.content.find((x) => frame >= x.start && frame < end(x));
      if (!c || c.opacity <= 0) continue;
      const a = animate(c, frame - c.start);
      if (a.opacity <= 0) continue;
      const layer = this.surface();
      const lc = layer.getContext('2d') as OffscreenCanvasRenderingContext2D;
      this.drawContent(lc, c, frame - c.start, view, movie, a);
      this.applyFilters(layer, a, view, movie);
      if ((c.mask === 'alpha' || c.mask === 'luminance') && held) {
        this.applyMask(held.layer, layer, c.mask, c.maskInvert);
        this.release(layer);
        continue;
      }
      if (c.mask === 'clipping' && held) {
        lc.globalCompositeOperation = 'destination-in';
        lc.drawImage(held.layer, 0, 0);
        lc.globalCompositeOperation = 'source-over';
      }
      commit();
      held = { layer, c, opacity: a.opacity };
    }
    commit();
  }

  private applyMask(target: Surface, mask: Surface, mode: 'alpha' | 'luminance', invert: boolean): void {
    const tc = target.getContext('2d') as OffscreenCanvasRenderingContext2D;
    if (mode === 'alpha' && !invert) {
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(mask, 0, 0);
      tc.globalCompositeOperation = 'source-over';
      return;
    }
    const mc = mask.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const img = mc.getImageData(0, 0, mask.width, mask.height);
    const d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      let a = mode === 'luminance' ? ((d[p] * 0.2126 + d[p + 1] * 0.7152 + d[p + 2] * 0.0722) * d[p + 3]) / 255 : d[p + 3];
      if (invert) a = 255 - a;
      d[p + 3] = a;
    }
    mc.putImageData(img, 0, 0);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(mask, 0, 0);
    tc.globalCompositeOperation = 'source-over';
  }

  drawContent(ctx: OffscreenCanvasRenderingContext2D, c: Content, local: number, view: View, movie: Movie, anim?: Animated): void {
    const t = anim ?? animate(c, local);
    ctx.save();
    ctx.translate(view.ox + (movie.width / 2 + t.x) * view.scale, view.oy + (movie.height / 2 + t.y) * view.scale);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.scale(t.scaleX * view.scale * (t.flipH ? -1 : 1), t.scaleY * view.scale * (t.flipV ? -1 : 1));
    ctx.translate(-movie.width / 2, -movie.height / 2);
    switch (c.kind) {
      case 'image': this.drawImageContent(ctx, c, movie); break;
      case 'drawing': this.drawLayers(ctx, c.layers, movie); break;
      case 'flipbook': this.drawFlipbook(ctx, c, local + c.offset, movie); break;
      case 'text': this.drawText(ctx, c, movie); break;
      case 'group': this.drawGroup(ctx, c, local + c.offset, movie); break;
      default: break;
    }
    ctx.restore();
  }

  private drawImageContent(ctx: OffscreenCanvasRenderingContext2D, c: Content, movie: Movie): void {
    const bmp = this.bitmap(c.asset);
    const asset = c.asset ? movie.assets[c.asset] : undefined;
    if (!bmp || !asset) return;
    const w = asset.width, h = asset.height;
    ctx.drawImage(bmp, (movie.width - w) / 2, (movie.height - h) / 2, w, h);
  }

  /** Draws a set of drawing layers in canvas pixels (the Draw & Paint view uses it for onion skins). */
  layersInto(ctx: OffscreenCanvasRenderingContext2D, layers: Content['layers'], movie: Movie): void {
    this.drawLayers(ctx, layers, movie);
  }

  /** Layer opacity multiplies the caller's alpha (a Flipbook row, a group member); a normal layer keeps the caller's blend. */
  private drawLayers(ctx: OffscreenCanvasRenderingContext2D, layers: Content['layers'], movie: Movie): void {
    const baseAlpha = ctx.globalAlpha, baseOp = ctx.globalCompositeOperation;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.opacity <= 0) continue;
      const bmp = this.bitmap(l.pixels);
      if (!bmp) continue;
      ctx.globalAlpha = baseAlpha * l.opacity;
      ctx.globalCompositeOperation = l.blend === 'normal' ? baseOp : BLEND_OP[l.blend];
      ctx.drawImage(bmp, 0, 0, movie.width, movie.height);
    }
    ctx.globalAlpha = baseAlpha;
    ctx.globalCompositeOperation = baseOp;
  }

  private drawFlipbook(ctx: OffscreenCanvasRenderingContext2D, c: Content, local: number, movie: Movie): void {
    for (let i = c.flip.length - 1; i >= 0; i--) {
      const t = c.flip[i];
      if (t.hidden || t.opacity <= 0) continue;
      const index = flipIndexAt(t, local);
      if (index < 0) continue;
      ctx.save();
      ctx.globalAlpha *= t.opacity;
      ctx.globalCompositeOperation = BLEND_OP[t.blend];
      this.drawLayers(ctx, t.frames[index].layers, movie);
      ctx.restore();
    }
  }

  /** Applies the live filters of a content (its keyframed Blur, Sharpen, Noise, HSB and Lens Blur) to its drawn surface. */
  private applyFilters(s: Surface, a: Animated, view: View, movie: Movie): void {
    if (!a.blur && !a.sharpen && !a.noise && !a.hsb && !a.lens) return;
    const sc = s.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const img = sc.getImageData(0, 0, s.width, s.height);
    let cur: Raster = { width: s.width, height: s.height, data: img.data };
    if (this.spare.data.length !== cur.data.length) this.spare = { width: s.width, height: s.height, data: new Uint8ClampedArray(cur.data.length) };
    let other: Raster = { width: s.width, height: s.height, data: this.spare.data };
    const step = (fn: (src: Raster, dst: Raster) => void): void => { fn(cur, other); const t = cur; cur = other; other = t; };
    const side = Math.max(movie.width, movie.height) * 0.05 * view.scale;
    if (a.hsb) hsb(cur, cur, a.hsb.hue, a.hsb.saturation, a.hsb.brightness);
    if (a.blur > 0) step((src, dst) => gaussianBlur(src, dst, a.blur * side));
    if (a.lens && a.lens.radius > 0) { const l = a.lens; step((src, dst) => lensBlur(src, dst, l.radius * side, l.brightness, l.contrast)); }
    if (a.sharpen > 0) step((src, dst) => sharpen(src, dst, a.sharpen));
    if (a.noise && a.noise.amount > 0) {
      const n = a.noise;
      step((src, dst) => noise(src, dst, { ...n, scale: Math.max(1, n.scale * view.scale), offsetX: n.offsetX * view.scale, offsetY: n.offsetY * view.scale }, 7));
    }
    if (cur.data !== img.data) img.data.set(cur.data);
    sc.putImageData(img, 0, 0);
  }

  private drawText(ctx: OffscreenCanvasRenderingContext2D, c: Content, movie: Movie): void {
    const s = c.text;
    if (!s) return;
    ctx.fillStyle = s.color;
    ctx.font = `${s.weight} ${s.size}px ${JSON.stringify(s.font)}, Inter, sans-serif`;
    ctx.textAlign = s.align;
    ctx.textBaseline = 'middle';
    const lines = s.text.split('\n');
    const lh = s.size * 1.2;
    const x = s.align === 'left' ? movie.width * 0.1 : s.align === 'right' ? movie.width * 0.9 : movie.width / 2;
    lines.forEach((line, i) => ctx.fillText(line, x, movie.height / 2 + (i - (lines.length - 1) / 2) * lh));
  }

  private drawGroup(ctx: OffscreenCanvasRenderingContext2D, g: Content, local: number, movie: Movie): void {
    const unit: View = { scale: 1, ox: 0, oy: 0, width: movie.width, height: movie.height };
    for (let i = g.tracks.length - 1; i >= 0; i--) {
      const t = g.tracks[i];
      if (t.hidden) continue;
      const c = t.content.find((x) => local >= x.start && local < end(x));
      if (!c || c.opacity <= 0) continue;
      ctx.save();
      ctx.globalAlpha = c.opacity;
      ctx.globalCompositeOperation = BLEND_OP[c.blend];
      this.drawContent(ctx, c, local - c.start, unit, movie);
      ctx.restore();
    }
  }

  thumb(ctx: CanvasRenderingContext2D, movie: Movie, c: Content, local: number, w: number, h: number): void {
    this.pw = Math.max(1, Math.round(w));
    this.ph = Math.max(1, Math.round(h));
    const s = this.surface();
    const sc = s.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const view = fitView(movie, w, h, 0);
    this.drawContent(sc, c, local, view, movie);
    ctx.drawImage(s, 0, 0);
    this.release(s);
  }
}
