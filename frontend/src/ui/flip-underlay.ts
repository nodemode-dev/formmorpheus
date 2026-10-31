// The reference underlay of a Flipbook: a picture or video drawn under the drawing while drawing (Draw & Paint only).
// It is never read by the renderer, so the Stage and every export are exactly as without it.
import { locate } from '../engine/model';
import type { CanvasRect, Content, FlipUnderlay, Movie } from '../engine/types';
import { flipServices } from './flip-services';

interface Src {
  kind: 'image' | 'video';
  w: number;
  h: number;
  ready: boolean;
  img?: ImageBitmap;
  video?: HTMLVideoElement;
  url?: string;
  seconds: number;
  /** Evicted: late decode results are dropped. */
  gone?: boolean;
}

function findContent(m: Movie, id: string): Content | null {
  const hit = locate(m, id);
  if (hit) return hit.content;
  const walk = (list: Content[]): Content | null => {
    for (const c of list) {
      if (c.id === id) return c;
      if (c.kind === 'group') for (const t of c.tracks) { const r = walk(t.content); if (r) return r; }
    }
    return null;
  };
  for (const t of m.tracks) { const r = walk(t.content); if (r) return r; }
  return null;
}

export class UnderlayView {
  /** Asks the Draw & Paint view for a repaint (the picture or video frame arrived, or the settings changed). */
  onRedraw: (() => void) | null = null;
  private readonly srcs = new Map<string, Src>();
  private bound = false;
  private seen: { id: string; ref: FlipUnderlay | undefined } | null = null;

  private bind(): void {
    const e = flipServices.engine;
    if (this.bound || !e) return;
    this.bound = true;
    // an Undo, Redo or panel edit changed the underlay of the open Flipbook
    e.on('movie', (m) => {
      const s = this.seen;
      if (!s) return;
      const c = findContent(m, s.id);
      if (c && c.underlay !== s.ref) this.onRedraw?.();
    });
  }

  private source(u: FlipUnderlay): Src | null {
    const e = flipServices.engine;
    const have = this.srcs.get(u.asset);
    if (have) return have;
    const asset = e?.movie?.assets[u.asset];
    const blob = e?.assets.get(u.asset);
    if (!asset || !blob) return null;
    if (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'pixels') return null;
    if (this.srcs.size >= 4) this.evict(this.srcs.keys().next().value as string);
    const src: Src = { kind: asset.kind === 'video' ? 'video' : 'image', w: asset.width || 1, h: asset.height || 1, ready: false, seconds: asset.seconds ?? 0 };
    this.srcs.set(u.asset, src);
    if (src.kind === 'image') {
      void createImageBitmap(blob).then((bmp) => {
        // evicted while decoding: nobody will draw it, so free it at once
        if (src.gone) { bmp.close(); return; }
        src.img = bmp; src.w = bmp.width; src.h = bmp.height; src.ready = true; this.onRedraw?.();
      }, () => { this.evict(u.asset, src); });
    } else {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      src.url = URL.createObjectURL(blob);
      v.src = src.url;
      v.addEventListener('loadeddata', () => { if (src.gone) return; src.w = v.videoWidth || src.w; src.h = v.videoHeight || src.h; src.seconds = v.duration || src.seconds; src.ready = true; this.onRedraw?.(); });
      v.addEventListener('seeked', () => { if (!src.gone) this.onRedraw?.(); });
      v.addEventListener('error', () => { if (!src.gone) this.evict(u.asset, src); });
      src.video = v;
    }
    return src;
  }

  /** Frees a source: closes its bitmap, detaches its video and revokes the URL. `only` guards against dropping a newer source of the same asset. */
  private evict(asset: string, only?: Src): void {
    const s = this.srcs.get(asset);
    if (!s || (only && s !== only)) return;
    this.srcs.delete(asset);
    s.gone = true;
    s.ready = false;
    s.img?.close();
    s.img = undefined;
    if (s.video) {
      s.video.pause();
      s.video.removeAttribute('src');
      s.video.load();
      s.video = undefined;
    }
    if (s.url) { URL.revokeObjectURL(s.url); s.url = undefined; }
  }

  /** Frees every source (Draw & Paint closed or the movie changed). */
  release(): void {
    for (const k of [...this.srcs.keys()]) this.evict(k);
  }

  /** Draws the underlay in canvas pixels (the context carries the view transform and is clipped to the canvas). */
  draw(ctx: CanvasRenderingContext2D, c: Content, fps: number, kv: CanvasRect, local: number): void {
    this.bind();
    const u = c.kind === 'flipbook' ? c.underlay : undefined;
    this.seen = { id: c.id, ref: u };
    if (!u || !u.visible) return;
    const src = this.source(u);
    if (!src?.ready) return;
    const frame = src.kind === 'video' ? src.video : src.img;
    if (!frame) return;
    if (src.video) {
      const t = Math.max(0, Math.min(Math.max(0, src.seconds - 0.001), (local + u.offset) / Math.max(1, fps)));
      if (Math.abs(src.video.currentTime - t) > 0.5 / Math.max(1, fps)) src.video.currentTime = t;
    }
    const fit = Math.min(kv.w / src.w, kv.h / src.h) * Math.max(0.01, u.scale);
    const w = src.w * fit, h = src.h * fit;
    ctx.save();
    if (u.table) {
      // light table: lit paper, the reference showing through it
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = '#f4f0e6';
      ctx.fillRect(0, 0, kv.w, kv.h);
      ctx.globalCompositeOperation = 'multiply';
    }
    ctx.globalAlpha = Math.max(u.table ? 0.75 : 0, Math.min(1, u.opacity));
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frame, (kv.w - w) / 2 + u.x, (kv.h - h) / 2 + u.y, w, h);
    ctx.restore();
  }

  /** The natural size of an underlay's source, for the panel's Fit button. */
  sizeOf(u: FlipUnderlay): { w: number; h: number } | null {
    const a = flipServices.engine?.movie?.assets[u.asset];
    return a ? { w: a.width, h: a.height } : null;
  }
}

export const underlayView = new UnderlayView();
