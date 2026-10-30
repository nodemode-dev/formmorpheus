// Krita (.kra / .krz) reader, adapted from the family's layered-image reader: a ZIP holding maindoc.xml (the layer
// tree, topmost first), a tiled pixel file per paint layer and mergedimage.png. 8 and 16 bit RGBA are decoded (16 bit
// reduced to 8); other colour models open as the merged picture.
import { safeUnzipOr } from './safe-unzip';
import type { BlendMode } from '../engine/types';
import { baseOf, decodePng, noteSet, type LayeredDoc, type LayerSpec, type Raster } from './layered-import';

export const isKra = (name: string, head: Uint8Array): boolean => /\.(kra|krz)$/i.test(name) && head[0] === 0x50 && head[1] === 0x4b;

const FROM_KRA = new Map<string, BlendMode>([
  ['normal', 'normal'], ['multiply', 'multiply'], ['screen', 'screen'], ['overlay', 'overlay'], ['darken', 'darken'], ['lighten', 'lighten'],
  ['dodge', 'color-dodge'], ['burn', 'color-burn'], ['diff', 'difference'], ['hard_light', 'hard-light'], ['soft_light', 'soft-light'],
  ['soft_light_svg', 'soft-light'], ['soft_light_pegtop_delphi', 'soft-light'], ['hue', 'hue'], ['saturation', 'saturation'], ['color', 'color'],
  ['luminize', 'luminosity'], ['luminosity', 'luminosity'], ['linear_dodge', 'add'], ['add', 'add'], ['linear_burn', 'linear-burn'],
  ['divide', 'divide'], ['subtract', 'subtract'], ['exclusion', 'exclusion'], ['vivid_light', 'vivid-light'],
  ['linear_light', 'linear-light'], ['pin_light', 'pin-light'], ['hard_mix', 'hard-mix'], ['darker color', 'darker-color'], ['lighter color', 'lighter-color'],
]);

const TILE_PIXELS = 64 * 64;

/** The format's LZF: a control byte under 32 copies that many plus one literals; otherwise a back reference. */
function lzf(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let i = 0, o = 0;
  while (i < src.length && o < expected) {
    const c = src[i++];
    if (c < 32) {
      const n = c + 1;
      if (i + n > src.length || o + n > expected) throw new Error('a tile is damaged');
      out.set(src.subarray(i, i + n), o);
      i += n; o += n;
    } else {
      let len = c >> 5;
      if (len === 7) len += src[i++];
      len += 2;
      const ref = o - ((c & 31) << 8) - src[i++] - 1;
      if (ref < 0 || o + len > expected) throw new Error('a tile is damaged');
      for (let k = 0; k < len; k++) out[o++] = out[ref + k];
    }
  }
  return out;
}

interface Tile { x: number; y: number; px: Uint8Array }

/** Tiles of one paint-layer file: 64 by 64, planar B, G, R, A of one byte (8 bit) or two (16 bit); a 1-byte pixel is a mask. */
function readTiles(data: Uint8Array): { tiles: Tile[]; bytes: number; gray: boolean } | null {
  let pos = 0;
  const line = (): string => {
    let end = pos;
    while (end < data.length && data[end] !== 10) end++;
    const s = new TextDecoder().decode(data.subarray(pos, end));
    pos = end + 1;
    return s;
  };
  let tw = 64, th = 64, pixelSize = 4, count = 0;
  for (let n = 0; n < 16 && pos < data.length; n++) {
    const [key, val] = line().trim().split(/\s+/);
    if (key === 'TILEWIDTH') tw = Number(val);
    else if (key === 'TILEHEIGHT') th = Number(val);
    else if (key === 'PIXELSIZE') pixelSize = Number(val);
    else if (key === 'DATA') { count = Number(val); break; }
  }
  if (tw !== 64 || th !== 64 || (pixelSize !== 1 && pixelSize !== 4 && pixelSize !== 8)) return null;
  const bytes = pixelSize === 1 ? 1 : pixelSize / 4, tileBytes = TILE_PIXELS * pixelSize;
  const tiles: Tile[] = [];
  for (let t = 0; t < count && pos < data.length; t++) {
    const head = line().trim().split(',');
    const x = Number(head[0]), y = Number(head[1]), size = Number(head[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size) || size < 1 || pos + size > data.length) throw new Error('a tile is damaged');
    const body = data.subarray(pos, pos + size);
    pos += size;
    const px = body[0] === 1 ? lzf(body.subarray(1), tileBytes) : body.slice(1, 1 + tileBytes);
    if (px.length < tileBytes) throw new Error('a tile is damaged');
    tiles.push({ x, y, px });
  }
  return { tiles, bytes, gray: pixelSize === 1 };
}

export async function readKra(file: File): Promise<LayeredDoc> {
  let parts: Record<string, Uint8Array>;
  parts = safeUnzipOr(new Uint8Array(await file.arrayBuffer()), `${file.name} is not a readable Krita file.`);
  const text = (n: string): string => new TextDecoder().decode(parts[n] ?? new Uint8Array());
  const xml = new DOMParser().parseFromString(text('maindoc.xml'), 'application/xml');
  const image = xml.querySelector('IMAGE');
  if (!image || xml.querySelector('parsererror')) throw new Error(`${file.name}: its maindoc.xml cannot be read.`);
  const W = Math.round(Number(image.getAttribute('width'))), H = Math.round(Number(image.getAttribute('height')));
  if (!(W >= 1 && H >= 1 && W <= 30000 && H <= 30000)) throw new Error(`${file.name}: its size cannot be opened.`);
  const docName = image.getAttribute('name') ?? '';
  const notes = noteSet();
  const layers: LayerSpec[] = [];
  const num = (e: Element, a: string, d: number): number => { const v = Number(e.getAttribute(a)); return e.hasAttribute(a) && Number.isFinite(v) ? v : d; };
  const childLayers = (e: Element): Element[] => {
    const holder = [...e.children].find((c) => c.tagName === 'layers');
    return holder ? [...holder.children].filter((c) => c.tagName === 'layer') : [];
  };
  const READABLE = new Set(['RGBA', 'RGBA16']);
  let notRgba = !READABLE.has(image.getAttribute('colorspacename') ?? 'RGBA');
  const file_ = (name: string): Uint8Array | undefined => parts[`${docName}/layers/${name}`];

  // a transparency mask: its 8-bit tiles over the level the file stores for the rest of the canvas
  const maskOf = (e: Element): LayerSpec['mask'] => {
    const holder = [...e.children].find((c) => c.tagName === 'masks');
    const m = holder ? [...holder.children].find((c) => c.getAttribute('nodetype') === 'transparencymask') : undefined;
    if (!m) return null;
    try {
      const fname = m.getAttribute('filename') ?? '', data = file_(fname), read = data ? readTiles(data) : null;
      if (!read || !read.gray) { notes.add('A transparency mask could not be read and was left out.'); return null; }
      const outside = file_(`${fname}.defaultpixel`)?.[0] ?? 255, ox = num(m, 'x', 0), oy = num(m, 'y', 0);
      const rgba = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < rgba.length; i += 4) { rgba[i] = outside; rgba[i + 3] = 255; }
      for (const t of read.tiles) for (let ty = 0; ty < 64; ty++) {
        const py = t.y + oy + ty;
        if (py < 0 || py >= H) continue;
        for (let tx = 0; tx < 64; tx++) { const px = t.x + ox + tx; if (px >= 0 && px < W) rgba[(py * W + px) * 4] = t.px[ty * 64 + tx]; }
      }
      return { raster: { rgba, w: W, h: H, x: 0, y: 0 }, outside, enabled: m.getAttribute('visible') !== '0' };
    } catch { notes.add('A transparency mask could not be read and was left out.'); return null; }
  };

  let n = 0;
  const walk = (list: Element[], parent: string | null): void => {
    for (const e of list) {
      const kind = e.getAttribute('nodetype') ?? '';
      const name = e.getAttribute('name') || (kind === 'grouplayer' ? 'Group' : 'Layer');
      const op = e.getAttribute('compositeop') ?? 'normal';
      const blend = FROM_KRA.get(op) ?? 'normal';
      const base = { visible: e.getAttribute('visible') !== '0', opacity: Math.min(1, Math.max(0, num(e, 'opacity', 255) / 255)), blend, parent, clipping: false, alphaLock: false };
      if (kind === 'grouplayer') {
        const id = `k${n++}`;
        layers.push({ ...base, id, name, group: true, pixels: null, mask: null });
        walk(childLayers(e), id);
        continue;
      }
      if (kind !== 'paintlayer') { notes.add(`"${name}" is a ${kind.replace(/layer$/, '') || 'special'} layer, which is not read from Krita files; it was left out.`); continue; }
      if (!READABLE.has(e.getAttribute('colorspacename') ?? 'RGBA')) { notRgba = true; continue; }
      const data = file_(e.getAttribute('filename') ?? '');
      if (!data) { notes.add('Some layers named pixel files the file does not hold, and were left out.'); continue; }
      const read = readTiles(data);
      if (!read || read.gray) { notRgba = true; continue; }
      if (!FROM_KRA.has(op)) notes.add(`${op} is not a blend mode formmorpheus has; those layers open as Normal.`);
      if (!read.tiles.length) { layers.push({ ...base, id: `k${n++}`, name, group: false, pixels: null, mask: maskOf(e) }); continue; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const t of read.tiles) { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x + 64); y1 = Math.max(y1, t.y + 64); }
      const w = x1 - x0, h = y1 - y0;
      if (w * h > 400_000_000) { notes.add('A layer is too large to open and was left out.'); continue; }
      if (read.bytes === 2) notes.add('16-bit layers were reduced to 8 bits per channel.');
      const rgba = new Uint8ClampedArray(w * h * 4), plane = TILE_PIXELS * read.bytes, hi = read.bytes - 1;
      for (const t of read.tiles) for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) {
        const s = (ty * 64 + tx) * read.bytes + hi, d = ((t.y - y0 + ty) * w + (t.x - x0 + tx)) * 4;
        rgba[d] = t.px[2 * plane + s]; rgba[d + 1] = t.px[plane + s]; rgba[d + 2] = t.px[s]; rgba[d + 3] = t.px[3 * plane + s];
      }
      const px: Raster = { rgba, w, h, x: num(e, 'x', 0) + x0, y: num(e, 'y', 0) + y0 };
      layers.push({ ...base, id: `k${n++}`, name, group: false, pixels: px, mask: maskOf(e) });
    }
  };
  const top = [...image.children].find((c) => c.tagName === 'layers');
  walk(top ? [...top.children].filter((c) => c.tagName === 'layer') : [], null);

  if (notRgba || !layers.some((l) => !l.group)) {
    const merged = parts['mergedimage.png'];
    if (!merged) throw new Error(`${file.name} holds no readable layers and no merged picture.`);
    layers.length = 0;
    layers.push({ id: 'bg', name: 'Background', visible: true, opacity: 1, blend: 'normal', group: false, parent: null, clipping: false, alphaLock: false, pixels: await decodePng(merged), mask: null });
    notes.add(notRgba ? 'This file is not 8-bit RGBA; it opened as its merged picture, one layer.' : 'This file has no pixel layers; it opened as its merged picture.');
  }
  return { name: baseOf(file.name), width: W, height: H, layers, notes: notes.list() };
}
