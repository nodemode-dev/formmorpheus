// Round trips with the owner's sibling apps: a Drawing or a frame goes out as a formvis document, a movie's
// tracks as a formvfx composition bundle, and both come back as content. The byte formats live in formvis-doc.ts
// and formvfx-doc.ts; this file does the picture work (canvas) between them and the movie model.
import { animate } from '../engine/keys';
import { content as makeContent, drawingLayer, uid } from '../engine/model';
import type { Renderer } from '../engine/render';
import type { Asset, Content, DrawingLayer, Movie } from '../engine/types';
import type { ImportResult } from '../media/import';
import { PaintDoc } from '../paint/doc';
import { FORMVIS_EXT, looksLikeFormvis, parseFormvis, writeFormvis, type FvLayer } from './formvis-doc';
import { FORMVFX_EXT, looksLikeFormvfx, parseFormvfx, writeFormvfx, type VfxPicture } from './formvfx-doc';

type BlobOf = (id: string) => Blob | undefined;

const bytesOf = async (b: Blob): Promise<Uint8Array> => new Uint8Array(await b.arrayBuffer());
const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';

async function pngOf(c: OffscreenCanvas): Promise<Uint8Array> {
  return bytesOf(await c.convertToBlob({ type: 'image/png' }));
}

/** A mask as an opaque grey picture (white reveals), whatever the stored picture's alpha holds. */
async function greyMask(blob: Blob, w: number, h: number): Promise<Uint8Array> {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const cv = new OffscreenCanvas(w, h);
  const cx = cv.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  cx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = cx.getImageData(0, 0, w, h);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  cx.putImageData(img, 0, 0);
  return pngOf(cv);
}

async function thumbOf(width: number, height: number, draw: (cx: OffscreenCanvasRenderingContext2D, k: number) => void): Promise<Uint8Array> {
  const k = Math.min(1, 512 / Math.max(width, height));
  const cv = new OffscreenCanvas(Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k)));
  draw(cv.getContext('2d') as OffscreenCanvasRenderingContext2D, k);
  return pngOf(cv);
}

/** The layers composed as the Drawing shows them, on a canvas the size of the movie. */
async function flatten(movie: Movie, layers: DrawingLayer[], blobOf: BlobOf): Promise<OffscreenCanvas> {
  const doc = await PaintDoc.load(movie.width, movie.height, layers, blobOf);
  const r = doc.flattened();
  const cv = new OffscreenCanvas(r.width, r.height);
  (cv.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  doc.dispose();
  return cv;
}

export interface Outgoing { blob: Blob; name: string; note?: string }

/** The id a Drawing leaves under, so the edited file finds its way back to it. */
export const documentIdOf = (contentId: string): string => `fm-${contentId}`;

// ---- formvis

export async function drawingToFormvis(movie: Movie, c: Content, blobOf: BlobOf): Promise<Outgoing> {
  const layers: FvLayer[] = [];
  for (const l of c.layers) {
    const img = !l.group && l.pixels ? blobOf(l.pixels) : undefined;
    const mk = !l.group && l.mask ? blobOf(l.mask) : undefined;
    layers.push({
      id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, group: !!l.group, parent: l.parent ?? null,
      collapsed: !!l.collapsed, alphaLock: l.alphaLock, clipping: l.clipping,
      image: img ? await bytesOf(img) : null, mask: mk ? await greyMask(mk, movie.width, movie.height) : null,
      maskOn: l.maskOn !== false, maskLinked: l.maskLinked !== false,
    });
  }
  const flat = await flatten(movie, c.layers, blobOf);
  const thumbnail = await thumbOf(movie.width, movie.height, (cx, k) => { cx.scale(k, k); cx.drawImage(flat, 0, 0); });
  const bytes = writeFormvis({ name: c.name, width: movie.width, height: movie.height, layers, documentId: documentIdOf(c.id), thumbnail });
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), name: `${safe(c.name)}.${FORMVIS_EXT}` };
}

/** The current frame: one layer per content showing, top track first, each drawn as it looks at that frame. */
export async function frameToFormvis(movie: Movie, frame: number, renderer: Renderer): Promise<Outgoing> {
  await renderer.prepareFrame(movie, frame);
  const layers: FvLayer[] = [];
  const view = { scale: 1, ox: 0, oy: 0, width: movie.width, height: movie.height };
  const walk = async (tracks: Movie['tracks']): Promise<void> => {
    for (const t of tracks) {
      if (t.hidden) continue;
      const c = t.content.find((x) => frame >= x.start && frame < x.start + x.duration);
      if (!c || c.kind === 'audio') continue;
      const cv = new OffscreenCanvas(movie.width, movie.height);
      const cx = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
      const a = animate(c, frame - c.start);
      renderer.drawContent(cx, c, frame - c.start, view, movie, { ...a, opacity: 1 });
      layers.push({
        id: c.id, name: c.name, visible: true, opacity: Math.min(1, Math.max(0, a.opacity)), blend: c.blend, group: false, parent: null,
        collapsed: false, alphaLock: false, clipping: false, image: await pngOf(cv), mask: null, maskOn: true, maskLinked: true,
      });
    }
  };
  await walk(movie.tracks);
  if (!layers.length) throw new Error('Nothing shows at this frame.');
  const thumbnail = await thumbOf(movie.width, movie.height, () => undefined);
  const bytes = writeFormvis({ name: movie.name, width: movie.width, height: movie.height, layers, thumbnail });
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), name: `${safe(movie.name)} frame ${frame + 1}.${FORMVIS_EXT}`, note: `${layers.length} ${layers.length === 1 ? 'layer' : 'layers'} written.` };
}

/** Reads a formvis document into a Drawing the size of the movie. A document that left from a Drawing of this movie replaces its layers. */
export async function formvisToDrawing(file: File, movie: Movie, at: number): Promise<ImportResult & { replaces?: string }> {
  const doc = parseFormvis(new Uint8Array(await file.arrayBuffer()), file.name);
  const W = movie.width, H = movie.height;
  const k = doc.width === W && doc.height === H ? 1 : Math.min(1, W / doc.width, H / doc.height);
  const ox = (W - doc.width * k) / 2, oy = (H - doc.height * k) / 2;
  const assets: { asset: Asset; blob: Blob }[] = [];
  const ids = new Map<string, string>();
  for (const l of doc.layers) ids.set(l.id, uid('l'));
  const store = (name: string, blob: Blob): string => {
    const asset: Asset = { id: uid('a'), kind: 'pixels', name, mime: 'image/png', width: W, height: H, frames: 0, size: blob.size };
    assets.push({ asset, blob });
    return asset.id;
  };
  const place = async (png: Uint8Array, p: { x: number; y: number; w: number; h: number; rotation: number; flipX: boolean; flipY: boolean }, fill: string | null): Promise<Blob> => {
    const bmp = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const cv = new OffscreenCanvas(W, H);
    const cx = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
    if (fill) { cx.fillStyle = fill; cx.fillRect(0, 0, W, H); }
    cx.translate(ox + k * (p.x + p.w / 2), oy + k * (p.y + p.h / 2));
    cx.rotate((p.rotation * Math.PI) / 180);
    cx.scale(k * (p.flipX ? -1 : 1), k * (p.flipY ? -1 : 1));
    cx.drawImage(bmp, -p.w / 2, -p.h / 2, p.w, p.h);
    bmp.close();
    return cv.convertToBlob({ type: 'image/png' });
  };
  const layers: DrawingLayer[] = [];
  for (const l of doc.layers) {
    const d: DrawingLayer = { ...drawingLayer(l.name), id: ids.get(l.id) as string, visible: l.visible, opacity: l.opacity, blend: l.blend, alphaLock: l.alphaLock, clipping: l.clipping };
    if (l.group) { d.group = true; if (l.collapsed) d.collapsed = true; }
    if (l.parent) d.parent = ids.get(l.parent) ?? null;
    if (l.image) {
      const pw = l.placement;
      const size = { w: pw.w, h: pw.h };
      const exact = k === 1 && pw.x === 0 && pw.y === 0 && !pw.rotation && !pw.flipX && !pw.flipY && size.w === W && size.h === H;
      d.pixels = store(l.name, exact ? new Blob([l.image as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : await place(l.image, pw, null));
    }
    if (l.mask) {
      const mp = l.maskPlacement ?? l.placement;
      d.mask = store(`${l.name} mask`, await place(l.mask, mp, '#000'));
      d.maskOn = l.maskOn;
      d.maskLinked = l.maskLinked;
    }
    layers.push(d);
  }
  if (!layers.length) throw new Error(`${file.name} has no layers formmorpheus can read.`);
  const c = makeContent('drawing', at, Math.max(1, movie.duration - at), { name: doc.name, layers });
  let replaces: string | undefined;
  const mine = doc.documentId && /^fm-/.test(doc.documentId) ? doc.documentId.slice(3) : null;
  const find = (tracks: Movie['tracks']): boolean => tracks.some((t) => t.content.some((x) => (x.id === mine && x.kind === 'drawing') || (x.kind === 'group' && find(x.tracks))));
  if (mine && find(movie.tracks)) replaces = mine;
  const base = `${layers.filter((l) => !l.group).length} ${layers.filter((l) => !l.group).length === 1 ? 'layer' : 'layers'}`;
  const notice = replaces ? `Drawing updated from ${file.name}: ${base}. Undo brings the old layers back.${doc.notes.length ? ` ${doc.notes.join(' ')}` : ''}` : `${file.name}: ${base}.${doc.notes.length ? ` ${doc.notes.join(' ')}` : ''}`;
  return { assets, contents: [c], ownTrack: [false], notice, replaces };
}

// ---- formvfx

const EXT_OF: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/tiff': 'tif' };

export async function movieToFormvfx(movie: Movie, blobOf: BlobOf): Promise<Outgoing> {
  const pictures = new Map<string, VfxPicture>();
  const used = new Set<string>();
  const nameFor = (base: string, ext: string): string => {
    let n = 1;
    const stem = safe(base);
    let f = `${stem}.${ext}`;
    while (used.has(f)) f = `${stem}-${++n}.${ext}`;
    used.add(f);
    return f;
  };
  const walk = async (tracks: Movie['tracks']): Promise<void> => {
    for (const t of tracks) for (const c of t.content) {
      if (c.kind === 'image' && c.asset) {
        const asset = movie.assets[c.asset], blob = blobOf(c.asset);
        if (!asset || !blob) continue;
        const ext = EXT_OF[asset.mime];
        if (ext) {
          pictures.set(c.id, { file: nameFor(asset.name || c.name, ext), bytes: await bytesOf(blob), width: asset.width, height: asset.height });
        } else {
          // a picture formvfx cannot read is handed over as PNG
          const bm = await createImageBitmap(blob);
          const cv = new OffscreenCanvas(bm.width, bm.height);
          (cv.getContext('2d') as OffscreenCanvasRenderingContext2D).drawImage(bm, 0, 0);
          bm.close();
          pictures.set(c.id, { file: nameFor(asset.name || c.name, 'png'), bytes: await pngOf(cv), width: cv.width, height: cv.height });
        }
      } else if (c.kind === 'drawing') {
        const cv = await flatten(movie, c.layers, blobOf);
        pictures.set(c.id, { file: nameFor(c.name, 'png'), bytes: await pngOf(cv), width: cv.width, height: cv.height });
      }
    }
  };
  await walk(movie.tracks);
  if (!pictures.size) throw new Error('There are no pictures or Drawings to send.');
  const out = writeFormvfx(movie, pictures, movie.name);
  const note = `${out.layers} ${out.layers === 1 ? 'layer' : 'layers'} written.${out.dropped.length ? ` Left out: ${out.dropped.join(', ')}.` : ''}`;
  return { blob: new Blob([out.zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), name: `${safe(movie.name)} formvfx.zip`, note };
}

export async function formvfxToTracks(file: File, movie: Movie): Promise<ImportResult> {
  const read = parseFormvfx(new Uint8Array(await file.arrayBuffer()), file.name, { fps: movie.fps, width: movie.width, height: movie.height });
  const assets: { asset: Asset; blob: Blob }[] = [];
  const contents: Content[] = [];
  const byFile = new Map<string, Asset>();
  for (const clip of read.clips) {
    const c = clip.content;
    if ('file' in clip.source) {
      const path = clip.source.file;
      let asset = byFile.get(path);
      if (!asset) {
        const bytes = read.files.get(path) as Uint8Array;
        const ext = (path.split('.').pop() ?? 'png').toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'tif' || ext === 'tiff' ? 'image/tiff' : `image/${ext}`;
        const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
        let bm: ImageBitmap;
        try { bm = await createImageBitmap(blob); } catch { read.notes.push(`${path.split('/').pop()} could not be read as a picture.`); continue; }
        asset = { id: uid('a'), kind: 'image', name: (path.split('/').pop() ?? path).replace(/\.[^.]+$/, ''), mime, width: bm.width, height: bm.height, frames: 0, size: blob.size };
        bm.close();
        byFile.set(path, asset);
        assets.push({ asset, blob });
      }
      c.asset = asset.id;
    } else {
      const { solid, width, height } = clip.source;
      const cv = new OffscreenCanvas(movie.width, movie.height);
      const cx = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
      cx.fillStyle = `rgb(${solid[0]},${solid[1]},${solid[2]})`;
      cx.fillRect((movie.width - width) / 2, (movie.height - height) / 2, width, height);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      const asset: Asset = { id: uid('a'), kind: 'pixels', name: c.name, mime: 'image/png', width: movie.width, height: movie.height, frames: 0, size: blob.size };
      assets.push({ asset, blob });
      const l = drawingLayer('Solid');
      l.pixels = asset.id;
      c.layers = [l];
    }
    contents.push(c);
  }
  if (!contents.length) throw new Error(`${file.name}: no layer could be brought in.${read.notes.length ? ` ${read.notes.join(' ')}` : ''}`);
  const tail = read.durationFrames > movie.duration ? ` The composition is ${read.durationFrames} frames; the movie is ${movie.duration}.` : '';
  return { assets, contents, ownTrack: contents.map(() => true), notice: `${contents.length} ${contents.length === 1 ? 'track' : 'tracks'} brought in from ${read.name}.${read.notes.length ? ` ${read.notes.slice(0, 4).join(' ')}` : ''}${tail}` };
}

/** Which round trip, if any, a file belongs to (reads the whole file only when it looks like a ZIP or a project). */
export async function sniffRoundTrip(file: File, head: Uint8Array): Promise<'formvis' | 'formvfx' | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const zip = head[0] === 0x50 && head[1] === 0x4b;
  if (!zip && ext !== FORMVFX_EXT && ext !== FORMVIS_EXT) return null;
  if (zip) {
    if (ext === 'fmo') return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (looksLikeFormvis(bytes)) return 'formvis';
    // a bundle holds a .fvxproj
    const { unzipSync } = await import('fflate');
    try { return Object.keys(unzipSync(bytes, { filter: (f) => /\.fvxproj$/i.test(f.name) })).length ? 'formvfx' : null; } catch { return null; }
  }
  const text = new TextDecoder().decode(await file.slice(0, 4096).arrayBuffer());
  return ext === FORMVFX_EXT || looksLikeFormvfx(text) ? 'formvfx' : null;
}
