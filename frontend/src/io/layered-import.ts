// Layered artwork (PSD, OpenRaster, Krita, Paint.NET) arrives here as a neutral LayeredDoc from the format readers
// (psd-import.ts, ora-import.ts, kra-import.ts, pdn-import.ts) and leaves as a Drawing: movie-sized picture assets
// for each layer and mask, in the Drawing's own layer list (top first, a group's members following it).
import { content as makeContent, drawingLayer, uid } from '../engine/model';
import type { Asset, BlendMode, DrawingLayer, Movie } from '../engine/types';
import type { ImportResult } from '../media/import';

/** Straight-alpha pixels of one layer or mask, placed with their top-left corner at (x, y) on the document's canvas. */
export interface Raster { rgba: Uint8ClampedArray; w: number; h: number; x: number; y: number }

export interface LayerSpec {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  group: boolean;
  /** Id of the enclosing group, null at the top. */
  parent: string | null;
  clipping: boolean;
  alphaLock: boolean;
  collapsed?: boolean;
  pixels: Raster | null;
  /** Grey mask: the red channel is the value (255 reveals). `outside` is the value beyond the raster's bounds. */
  mask: { raster: Raster; outside: number; enabled: boolean } | null;
}

export interface LayeredDoc {
  name: string;
  width: number;
  height: number;
  /** Top first, a group followed by its members. */
  layers: LayerSpec[];
  notes: string[];
}

export function noteSet(): { add(s: string): void; list(): string[] } {
  const s = new Set<string>();
  return { add: (n) => { s.add(n); }, list: () => [...s] };
}

/** Writes one raster into a movie-sized canvas scaled by k about the centre offset (ox, oy). */
function draw(cx: OffscreenCanvasRenderingContext2D, r: Raster, k: number, ox: number, oy: number): void {
  const tmp = new OffscreenCanvas(r.w, r.h);
  tmp.getContext('2d')!.putImageData(new ImageData(r.rgba as Uint8ClampedArray<ArrayBuffer>, r.w, r.h), 0, 0);
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(tmp, ox + r.x * k, oy + r.y * k, r.w * k, r.h * k);
}

const MAX_SIDE_FACTOR = 1;

export async function layeredToDrawing(doc: LayeredDoc, fileName: string, movie: Movie, at: number): Promise<ImportResult> {
  const W = movie.width, H = movie.height;
  // a document larger than the movie is scaled to fit; a smaller one keeps its pixels, centred
  const k = Math.min(MAX_SIDE_FACTOR, W / doc.width, H / doc.height);
  const ox = (W - doc.width * k) / 2, oy = (H - doc.height * k) / 2;
  const assets: { asset: Asset; blob: Blob }[] = [];
  const store = (name: string, blob: Blob): string => {
    const asset: Asset = { id: uid('a'), kind: 'pixels', name, mime: 'image/png', width: W, height: H, frames: 0, size: blob.size };
    assets.push({ asset, blob });
    return asset.id;
  };
  const ids = new Map<string, string>();
  for (const l of doc.layers) ids.set(l.id, uid('l'));
  const out: DrawingLayer[] = [];
  for (const l of doc.layers) {
    const d: DrawingLayer = { ...drawingLayer(l.name), id: ids.get(l.id) as string, visible: l.visible, opacity: Math.min(1, Math.max(0, l.opacity)), blend: l.blend, alphaLock: l.alphaLock, clipping: l.clipping };
    if (l.group) { d.group = true; if (l.collapsed) d.collapsed = true; }
    if (l.parent) d.parent = ids.get(l.parent) ?? null;
    if (l.pixels && l.pixels.w > 0 && l.pixels.h > 0 && !l.group) {
      const cv = new OffscreenCanvas(W, H);
      draw(cv.getContext('2d') as OffscreenCanvasRenderingContext2D, l.pixels, k, ox, oy);
      d.pixels = store(l.name, await cv.convertToBlob({ type: 'image/png' }));
    }
    if (l.mask) {
      const cv = new OffscreenCanvas(W, H);
      const cx = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
      const o = l.mask.outside;
      cx.fillStyle = `rgb(${o},${o},${o})`;
      cx.fillRect(0, 0, W, H);
      // the mask's value goes to grey and opaque, so a transparent texel cannot show the fill through
      const src = l.mask.raster, grey = new Uint8ClampedArray(src.rgba.length);
      for (let i = 0; i < grey.length; i += 4) { const v = src.rgba[i]; grey[i] = grey[i + 1] = grey[i + 2] = v; grey[i + 3] = 255; }
      draw(cx, { ...src, rgba: grey }, k, ox, oy);
      d.mask = store(`${l.name} mask`, await cv.convertToBlob({ type: 'image/png' }));
      d.maskOn = l.mask.enabled;
      d.maskLinked = true;
    }
    out.push(d);
  }
  if (!out.length) throw new Error(`${fileName} has no layers FormMorpheus can read.`);
  const c = makeContent('drawing', at, Math.max(1, movie.duration - at), { name: doc.name, layers: out });
  const n = doc.layers.filter((l) => !l.group).length;
  const notes = doc.notes.length ? ` ${doc.notes.join(' ')}` : '';
  return { assets, contents: [c], ownTrack: [false], notice: `${fileName}: ${n} ${n === 1 ? 'layer' : 'layers'}.${notes}` };
}

export const baseOf = (n: string): string => n.replace(/\.[^.]+$/, '') || n;

/** Decodes PNG bytes to straight-alpha pixels. */
export async function decodePng(bytes: Uint8Array, x = 0, y = 0): Promise<Raster> {
  const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const cx = cv.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  cx.drawImage(bmp, 0, 0);
  const w = bmp.width, h = bmp.height;
  bmp.close();
  return { rgba: cx.getImageData(0, 0, w, h).data, w, h, x, y };
}
