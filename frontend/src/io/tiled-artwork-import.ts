// `.procreate` artwork reader, from the publicly documented layout: a ZIP holding Document.archive (a binary property
// list written by NSKeyedArchiver), one folder per layer named by its UUID with `col~row.chunk` (LZO1X) or `.lz4`
// tiles of 256 px (premultiplied RGBA, rows bottom-up, tile row 0 at the bottom of the canvas, edge tiles at their real
// size, empty tiles left out), and QuickLook/Thumbnail.png. The result is the neutral LayeredDoc every layered reader gives.
import { safeUnzipOr } from './safe-unzip';
import { parsePlist, unarchive } from './brush-import';
import { lz4FrameDecompress, lzo1xDecompress } from './lzo';
import type { BlendMode } from '../engine/types';
import { baseOf, decodePng, noteSet, type LayeredDoc, type LayerSpec, type Raster } from './layered-import';

/** The numbers Document.archive stores in `blend` / `extendedBlend`; any other value opens as Normal. */
const BLEND: Record<number, BlendMode> = {
  0: 'normal', 1: 'multiply', 2: 'screen', 3: 'add', 4: 'lighten', 5: 'exclusion', 6: 'difference', 7: 'subtract', 8: 'linear-burn',
  9: 'color-dodge', 10: 'color-burn', 11: 'overlay', 12: 'hard-light', 13: 'color', 14: 'luminosity', 15: 'hue', 16: 'saturation',
  17: 'soft-light', 19: 'darken', 20: 'hard-mix', 21: 'vivid-light', 22: 'linear-light', 23: 'pin-light', 24: 'lighter-color',
  25: 'darker-color', 26: 'divide',
};

export const isTiledArtwork = (name: string, head: Uint8Array): boolean => /\.procreate$/i.test(name) && head[0] === 0x50 && head[1] === 0x4b;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Uint8Array);
const numOf = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const bytesOf = (x: unknown): Uint8Array | null => (x instanceof Uint8Array ? x : isObj(x) && x['NS.data'] instanceof Uint8Array ? (x['NS.data'] as Uint8Array) : null);

/** "{2048, 1536}" as [2048, 1536]. */
function sizeOf(s: unknown): [number, number] | null {
  const m = typeof s === 'string' ? /(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(s) : null;
  return m ? [Math.round(Number(m[1])), Math.round(Number(m[2]))] : null;
}

// one file may fill this many bytes of pictures; layers past it open empty, with a note (a hostile file cannot exhaust memory)
const MEM_BUDGET = 1536 * 1024 * 1024;
const MAX_PIXELS = 64 * 1024 * 1024;
let memLeft = MEM_BUDGET;
let memFull = false;

/** Tiles of one layer folder, laid on a W x H canvas as straight-alpha RGBA (channels = 4) or one-byte grey (channels = 1). */
function layerRaster(tiles: Map<string, Uint8Array>, W: number, H: number, tile: number, channels: 1 | 4): { raster: Raster; bad: number } | null {
  if (!tiles.size) return null;
  // a layer is W x H x 4 bytes whatever it holds: stop when the file asks for more than the window can keep
  if (memLeft < W * H * 4) { memFull = true; return null; }
  let rgba: Uint8ClampedArray;
  try { rgba = new Uint8ClampedArray(W * H * 4); } catch { memFull = true; return null; }
  memLeft -= W * H * 4;
  let bad = 0, any = false;
  for (const [file, data] of tiles) {
    const m = /(\d+)~(\d+)\.(chunk|lz4)$/i.exec(file);
    if (!m) continue;
    const col = Number(m[1]), row = Number(m[2]);
    const x0 = col * tile, tw = Math.min(tile, W - x0), th = Math.min(tile, H - row * tile);
    if (tw <= 0 || th <= 0) { bad++; continue; }
    let px: Uint8Array;
    try {
      const want = tw * th * channels;
      px = m[3].toLowerCase() === 'lz4' ? lz4FrameDecompress(data, want) : lzo1xDecompress(data, want);
    } catch { bad++; continue; }
    any = true;
    // tile row 0 is the bottom of the canvas and rows inside a tile run bottom-up too
    const yTop = H - row * tile - th;
    for (let j = 0; j < th; j++) {
      const src = j * tw * channels, dst = ((yTop + th - 1 - j) * W + x0) * 4;
      if (channels === 4) {
        for (let i = 0; i < tw; i++) {
          const s = src + i * 4, d = dst + i * 4, a = px[s + 3];
          if (a === 0) continue;
          // premultiplied to straight alpha, rounded
          rgba[d] = Math.min(255, ((px[s] * 255 + (a >> 1)) / a) | 0);
          rgba[d + 1] = Math.min(255, ((px[s + 1] * 255 + (a >> 1)) / a) | 0);
          rgba[d + 2] = Math.min(255, ((px[s + 2] * 255 + (a >> 1)) / a) | 0);
          rgba[d + 3] = a;
        }
      } else {
        for (let i = 0; i < tw; i++) { const v = px[src + i], d = dst + i * 4; rgba[d] = v; rgba[d + 1] = v; rgba[d + 2] = v; rgba[d + 3] = 255; }
      }
    }
  }
  return any || bad ? { raster: { rgba, w: W, h: H, x: 0, y: 0 }, bad } : null;
}

export async function readTiledArtwork(file: File): Promise<LayeredDoc> {
  const parts = safeUnzipOr(new Uint8Array(await file.arrayBuffer()), `${file.name} is not a readable .procreate artwork file.`);
  const arch = parts['Document.archive'];
  const notes = noteSet();
  const thumb = async (why: string): Promise<LayeredDoc> => {
    const png = parts['QuickLook/Thumbnail.png'];
    if (!png) throw new Error(`${file.name}: ${why}`);
    const r = await decodePng(png);
    return {
      name: baseOf(file.name), width: r.w, height: r.h, notes: [`${why} Only the preview picture was brought in.`],
      layers: [{ id: 'thumb', name: 'Preview', visible: true, opacity: 1, blend: 'normal', group: false, parent: null, clipping: false, alphaLock: false, pixels: r, mask: null }],
    };
  };
  if (!arch) return thumb('It has no Document.archive.');
  let doc: Obj;
  try {
    const root = unarchive(parsePlist(arch));
    if (!isObj(root)) throw new Error('shape');
    doc = root;
  } catch { return thumb('Its Document.archive cannot be read.'); }
  const size = sizeOf(doc.size);
  if (!size || !(size[0] >= 1 && size[1] >= 1 && size[0] <= 16384 && size[1] <= 16384)) return thumb('Its canvas size cannot be read.');
  const [W, H] = size;
  if (W * H > MAX_PIXELS) return thumb('Its canvas is too large to open in full.');
  memLeft = MEM_BUDGET;
  memFull = false;
  const tile = Math.max(16, Math.min(1024, Math.round(numOf(doc.tileSize, 256))));

  // tile files by layer folder
  const folders = new Map<string, Map<string, Uint8Array>>();
  for (const [path, data] of Object.entries(parts)) {
    const i = path.indexOf('/');
    if (i < 1 || !/\.(chunk|lz4)$/i.test(path)) continue;
    const id = path.slice(0, i);
    let f = folders.get(id);
    if (!f) folders.set(id, (f = new Map()));
    f.set(path.slice(i + 1), data);
  }

  const layers: LayerSpec[] = [];
  let n = 0, damaged = 0, drawn = 0;
  const blendOf = (o: Obj): BlendMode => {
    const ext = numOf(o.extendedBlend, 0), b = ext > 0 ? ext : numOf(o.blend, 0);
    if (!(b in BLEND)) { notes.add('Some blend modes are not ones formmorpheus has; those layers open as Normal.'); return 'normal'; }
    return BLEND[b];
  };
  const walk = (list: unknown, parent: string | null): void => {
    if (!Array.isArray(list)) return;
    for (const e of list) {
      if (!isObj(e)) continue;
      if (Array.isArray(e.children)) {
        const id = `g${n++}`;
        layers.push({
          id, name: typeof e.name === 'string' && e.name ? e.name : 'Group', visible: e.isHidden !== true, opacity: numOf(e.opacity, 1), blend: 'normal',
          group: true, parent, clipping: e.isClipped === true, alphaLock: false, collapsed: e.isCollapsed === true, pixels: null, mask: null,
        });
        walk(e.children, id);
        continue;
      }
      const type = numOf(e.type, 0);
      if (type !== 0) continue;
      const uuid = typeof e.UUID === 'string' ? e.UUID : '';
      const got = layerRaster(folders.get(uuid) ?? new Map(), W, H, tile, 4);
      if (got) { damaged += got.bad; drawn++; }
      let mask: LayerSpec['mask'] = null;
      if (isObj(e.mask) && typeof e.mask.UUID === 'string') {
        const mg = layerRaster(folders.get(e.mask.UUID) ?? new Map(), W, H, tile, 1);
        if (mg) { damaged += mg.bad; mask = { raster: mg.raster, outside: 0, enabled: e.mask.hidden !== true }; }
      }
      layers.push({
        id: `l${n++}`, name: typeof e.name === 'string' && e.name ? e.name : 'Layer', visible: e.hidden !== true, opacity: Math.min(1, Math.max(0, numOf(e.opacity, 1))),
        blend: blendOf(e), group: false, parent, clipping: e.clipped === true, alphaLock: e.preserve === true, pixels: got?.raster ?? null, mask,
      });
    }
  };
  // the layer tree is top first; a file without it lists its pixel layers flat
  if (Array.isArray(doc.unwrappedLayers)) walk(doc.unwrappedLayers, null);
  else walk(doc.layers, null);
  if (!layers.some((l) => !l.group)) return thumb('It holds no layers formmorpheus can read.');
  if (!drawn && folders.size) return thumb('Its tile files could not be decoded.');

  // the canvas colour sits under everything unless switched off: four little-endian float32 (r, g, b, a)
  const bg = bytesOf(doc.backgroundColor);
  if (doc.backgroundHidden !== true && bg && bg.length >= 16 && memLeft >= W * H * 4) {
    const f = new DataView(bg.buffer, bg.byteOffset, bg.byteLength);
    const c = [0, 1, 2, 3].map((i) => Math.round(Math.min(1, Math.max(0, f.getFloat32(i * 4, true))) * 255));
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255; }
    layers.push({ id: 'bg', name: 'Background color', visible: true, opacity: 1, blend: 'normal', group: false, parent: null, clipping: false, alphaLock: false, pixels: { rgba, w: W, h: H, x: 0, y: 0 }, mask: null });
  }
  if (memFull) notes.add('The file has more layers than fit in memory at this canvas size; the rest were left empty.');
  if (damaged) notes.add(`${damaged} damaged ${damaged === 1 ? 'tile was' : 'tiles were'} left empty.`);
  if (numOf(doc.orientation, 1) > 1 || doc.flippedHorizontally === true || doc.flippedVertically === true) notes.add('The canvas rotation or flip saved in the file was not applied.');
  const anim = doc.animation;
  if (isObj(anim) && anim.isActive === true) notes.add('Animation frames arrive as layers; use Convert Layers to Tracks to spread them out.');
  notes.add('Colors are read as sRGB.');
  return { name: baseOf(file.name), width: W, height: H, layers, notes: notes.list() };
}
