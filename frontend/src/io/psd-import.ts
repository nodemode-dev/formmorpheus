// Layered PSD / PSB reader written from the file format's public layout (no library): RGB and grey documents of 8 or 16
// bits, raw, RLE and zip channel data, layer names, opacity, visibility, blend modes, clipping, transparency lock,
// layer masks and groups. Layers with no stored pixels (adjustments) arrive empty. A document with no layers opens as
// its merged picture. CMYK, indexed and 32-bit documents are refused with a message.
import type { BlendMode } from '../engine/types';
import { baseOf, noteSet, type LayeredDoc, type LayerSpec, type Raster } from './layered-import';

export const isPsd = (b: Uint8Array): boolean => b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53;

const BLEND: Record<string, BlendMode> = {
  'norm': 'normal', 'dark': 'darken', 'mul ': 'multiply', 'idiv': 'color-burn', 'lbrn': 'linear-burn', 'dkCl': 'darker-color',
  'lite': 'lighten', 'scrn': 'screen', 'div ': 'color-dodge', 'lddg': 'add', 'lgCl': 'lighter-color', 'over': 'overlay',
  'sLit': 'soft-light', 'hLit': 'hard-light', 'vLit': 'vivid-light', 'lLit': 'linear-light', 'pLit': 'pin-light', 'hMix': 'hard-mix',
  'diff': 'difference', 'smud': 'exclusion', 'fsub': 'subtract', 'fdiv': 'divide', 'hue ': 'hue', 'sat ': 'saturation',
  'colr': 'color', 'lum ': 'luminosity', 'pass': 'passthrough',
};

class Cur {
  p: number;
  readonly v: DataView;
  constructor(readonly d: Uint8Array, p = 0) { this.p = p; this.v = new DataView(d.buffer, d.byteOffset, d.byteLength); }
  u8(): number { return this.d[this.p++]; }
  u16(): number { const n = this.v.getUint16(this.p); this.p += 2; return n; }
  i16(): number { const n = this.v.getInt16(this.p); this.p += 2; return n; }
  u32(): number { const n = this.v.getUint32(this.p); this.p += 4; return n; }
  i32(): number { const n = this.v.getInt32(this.p); this.p += 4; return n; }
  u64(): number { const n = Number(this.v.getBigUint64(this.p)); this.p += 8; return n; }
  tag(): string { const s = String.fromCharCode(this.d[this.p], this.d[this.p + 1], this.d[this.p + 2], this.d[this.p + 3]); this.p += 4; return s; }
}

async function inflate(src: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([src as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
}

/** One channel's rows as 8-bit samples (16-bit reduced to its high byte). */
async function channelPlane(d: Uint8Array, at: number, end: number, w: number, h: number, depth: number, big: boolean, comp: number, rleCounts?: number[]): Promise<Uint8Array> {
  const bps = depth >> 3, rowBytes = w * bps;
  let raw: Uint8Array;
  if (comp === 0) raw = d.subarray(at, at + rowBytes * h);
  else if (comp === 1) {
    raw = new Uint8Array(rowBytes * h);
    let src = at;
    const counts = rleCounts as number[];
    for (let y = 0; y < h; y++) {
      const stop = src + counts[y];
      let o = y * rowBytes;
      const rowEnd = o + rowBytes;
      while (src < stop && o < rowEnd) {
        const n = (d[src++] << 24) >> 24;
        if (n >= 0) { const len = Math.min(n + 1, rowEnd - o); raw.set(d.subarray(src, src + len), o); src += n + 1; o += len; }
        else if (n !== -128) { const len = Math.min(1 - n, rowEnd - o); raw.fill(d[src++], o, o + len); o += len; }
      }
      src = stop;
    }
  } else {
    raw = await inflate(d.subarray(at, end));
    if (raw.length < rowBytes * h) { const g = new Uint8Array(rowBytes * h); g.set(raw); raw = g; }
    if (comp === 3) {
      for (let y = 0; y < h; y++) {
        const r = y * rowBytes;
        if (bps === 1) for (let x = 1; x < w; x++) raw[r + x] = (raw[r + x] + raw[r + x - 1]) & 255;
        else for (let x = 1; x < w; x++) {
          const i = r + x * 2, prev = (raw[i - 2] << 8) | raw[i - 1], cur = (((raw[i] << 8) | raw[i + 1]) + prev) & 0xffff;
          raw[i] = cur >> 8; raw[i + 1] = cur & 255;
        }
      }
    }
  }
  if (bps === 1) return raw.length === rowBytes * h ? raw : raw.slice(0, rowBytes * h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = raw[i * bps];
  return out;
}

interface ChInfo { id: number; len: number }
interface Rec {
  top: number; left: number; bottom: number; right: number;
  chans: ChInfo[]; blend: string; opacity: number; clip: boolean; flags: number;
  mask: { top: number; left: number; bottom: number; right: number; def: number; flags: number } | null;
  name: string; section: number; sectionBlend: string | null;
}

export async function readPsd(file: File): Promise<LayeredDoc> {
  const d = new Uint8Array(await file.arrayBuffer());
  if (!isPsd(d)) throw new Error(`${file.name} is not a PSD file.`);
  const c = new Cur(d, 4);
  const version = c.u16();
  if (version !== 1 && version !== 2) throw new Error(`${file.name} is not a PSD or PSB file.`);
  const big = version === 2;
  c.p += 6;
  const nChannels = c.u16(), H = c.u32(), W = c.u32(), depth = c.u16(), mode = c.u16();
  if (!(W >= 1 && H >= 1 && W <= 30000 && H <= 30000)) throw new Error(`${file.name}: its size cannot be opened.`);
  if (depth !== 8 && depth !== 16) throw new Error(`${file.name} is a ${depth}-bit PSD; only 8 and 16 bit open.`);
  if (mode !== 1 && mode !== 3) throw new Error(`${file.name} is a ${mode === 4 ? 'CMYK' : mode === 2 ? 'indexed color' : mode === 0 ? 'bitmap' : 'this color mode'} PSD; only RGB and grayscale open. Convert it to RGB first.`);
  const notes = noteSet();
  const skip = (cur: Cur): void => { const n = cur.u32(); cur.p += n; };
  skip(c);   // color mode data
  skip(c);   // image resources
  const lmLen = big ? c.u64() : c.u32();
  const lmEnd = c.p + lmLen;
  const layers: LayerSpec[] = [];

  const readLayerInfo = async (start: number, len: number): Promise<void> => {
    const l = new Cur(d, start);
    let count = l.i16();
    if (count < 0) count = -count;   // first alpha channel is the merged picture's transparency
    const recs: Rec[] = [];
    for (let i = 0; i < count; i++) {
      const top = l.i32(), left = l.i32(), bottom = l.i32(), right = l.i32(), nc = l.u16(), chans: ChInfo[] = [];
      for (let k = 0; k < nc; k++) { const id = l.i16(); chans.push({ id, len: big ? l.u64() : l.u32() }); }
      l.tag();
      const blend = l.tag(), opacity = l.u8(), clip = l.u8() === 1, flags = l.u8();
      l.p += 1;
      const exLen = l.u32();
      const extraEnd = l.p + exLen;
      const ml = l.u32();
      const maskEnd = l.p + ml;
      let mask: Rec['mask'] = null;
      if (ml >= 18) {
        const mt = l.i32(), mlf = l.i32(), mb = l.i32(), mr = l.i32(), def = l.u8(), mf = l.u8();
        mask = { top: mt, left: mlf, bottom: mb, right: mr, def, flags: mf };
      }
      l.p = maskEnd;
      skip(l);   // blending ranges
      const rec: Rec = { top, left, bottom, right, chans, blend, opacity, clip, flags, mask, name: '', section: 0, sectionBlend: null };
      parseExtra(d, rec, l.p, extraEnd, big);
      recs.push(rec);
      l.p = extraEnd;
    }
    // channel image data follows the records, in record order
    let at = l.p;
    const rasters: Array<{ rgb: Raster | null; mask: Raster | null; maskOutside: number }> = [];
    for (const r of recs) {
      const w = Math.max(0, r.right - r.left), h = Math.max(0, r.bottom - r.top);
      const planes = new Map<number, Uint8Array>();
      let maskPlane: Uint8Array | null = null;
      for (const ch of r.chans) {
        const start = at, end = at + ch.len;
        at = end;
        if (ch.len < 2) continue;
        const isMask = ch.id === -2;
        const cw = isMask ? Math.max(0, (r.mask?.right ?? 0) - (r.mask?.left ?? 0)) : w;
        const chh = isMask ? Math.max(0, (r.mask?.bottom ?? 0) - (r.mask?.top ?? 0)) : h;
        if (!cw || !chh || cw * chh > 400_000_000) continue;
        const comp = (d[start] << 8) | d[start + 1];
        let p = start + 2, counts: number[] | undefined;
        if (comp === 1) {
          counts = [];
          for (let y = 0; y < chh; y++) { counts.push(big ? Number(new DataView(d.buffer, d.byteOffset).getUint32(p + y * 4)) : (d[p + y * 2] << 8) | d[p + y * 2 + 1]); }
          p += chh * (big ? 4 : 2);
        }
        try {
          const plane = await channelPlane(d, p, end, cw, chh, depth, big, comp, counts);
          if (isMask) maskPlane = plane; else planes.set(ch.id, plane);
        } catch { notes.add('Some channels could not be decoded and were left out.'); }
      }
      let rgb: Raster | null = null;
      if (w && h && planes.size) {
        const rgba = new Uint8ClampedArray(w * h * 4);
        const R = planes.get(0), G = mode === 1 ? R : planes.get(1), B = mode === 1 ? R : planes.get(2), A = planes.get(-1);
        for (let i = 0, o = 0; i < w * h; i++, o += 4) {
          rgba[o] = R ? R[i] : 0; rgba[o + 1] = G ? G[i] : 0; rgba[o + 2] = B ? B[i] : 0; rgba[o + 3] = A ? A[i] : 255;
        }
        rgb = { rgba, w, h, x: r.left, y: r.top };
      }
      let mask: Raster | null = null;
      if (r.mask && maskPlane) {
        const mw = r.mask.right - r.mask.left, mh = r.mask.bottom - r.mask.top;
        const rgba = new Uint8ClampedArray(mw * mh * 4);
        const inv = (r.mask.flags & 4) !== 0;
        for (let i = 0, o = 0; i < mw * mh; i++, o += 4) { rgba[o] = inv ? 255 - maskPlane[i] : maskPlane[i]; rgba[o + 3] = 255; }
        mask = { rgba, w: mw, h: mh, x: r.mask.left, y: r.mask.top };
      }
      const outside = r.mask ? ((r.mask.flags & 4) !== 0 ? 255 - r.mask.def : r.mask.def) : 255;
      rasters.push({ rgb, mask, maskOutside: outside });
    }
    void len;
    // records run bottom to top; walk them top first, a folder opening its group and the bounding divider closing it
    const stack: string[] = [];
    let n = 0;
    for (let i = recs.length - 1; i >= 0; i--) {
      const r = recs[i], pix = rasters[i];
      if (r.section === 3) { stack.pop(); continue; }
      const blendKey = r.section === 1 || r.section === 2 ? (r.sectionBlend ?? r.blend) : r.blend;
      const blend = BLEND[blendKey] ?? 'normal';
      if (!(blendKey in BLEND)) notes.add(`"${blendKey.trim()}" is not a blend mode formmorpheus has; those layers open as Normal.`);
      const spec: LayerSpec = {
        id: `p${n++}`, name: r.name || (r.section ? 'Group' : 'Layer'), visible: (r.flags & 2) === 0, opacity: r.opacity / 255, blend,
        group: r.section === 1 || r.section === 2, parent: stack.length ? stack[stack.length - 1] : null, clipping: r.clip, alphaLock: (r.flags & 1) !== 0,
        collapsed: r.section === 2, pixels: pix.rgb,
        mask: pix.mask ? { raster: pix.mask, outside: pix.maskOutside, enabled: (r.mask!.flags & 2) === 0 } : null,
      };
      layers.push(spec);
      if (spec.group) stack.push(spec.id);
    }
  };

  const infoLen = big ? c.u64() : c.u32();
  const infoStart = c.p;
  if (infoLen > 0) await readLayerInfo(infoStart, infoLen);
  else {
    // a 16 or 32 bit file keeps its layers in a tagged block after the global mask
    let p = infoStart;
    p += 4 + new DataView(d.buffer, d.byteOffset).getUint32(p);
    while (p + 12 <= lmEnd) {
      const sig = String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]);
      if (sig !== '8BIM' && sig !== '8B64') break;
      const key = String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7]);
      const wide = big && (key === 'Lr16' || key === 'Lr32' || key === 'Layr');
      const dv = new DataView(d.buffer, d.byteOffset);
      const len = wide ? Number(dv.getBigUint64(p + 8)) : dv.getUint32(p + 8);
      const body = p + 8 + (wide ? 8 : 4);
      if (key === 'Lr16' || key === 'Lr32' || key === 'Layr') { await readLayerInfo(body, len); break; }
      p = body + len + ((4 - (len % 4)) % 4);
    }
  }

  if (!layers.some((l) => !l.group)) {
    layers.length = 0;
    const merged = await readMerged(d, lmEnd, W, H, nChannels, depth, big, mode);
    if (!merged) throw new Error(`${file.name} holds no layers and no readable merged picture.`);
    layers.push({ id: 'bg', name: 'Background', visible: true, opacity: 1, blend: 'normal', group: false, parent: null, clipping: false, alphaLock: false, pixels: merged, mask: null });
    notes.add('This file has no layers; it opened as its merged picture.');
  }
  return { name: baseOf(file.name), width: W, height: H, layers, notes: notes.list() };
}

/** Unicode layer name (luni) or the Pascal name, and the section divider (lsct) from a layer's extra data. */
function parseExtra(d: Uint8Array, r: Rec, nameAt: number, extraEnd: number, big: boolean): void {
  const dv = new DataView(d.buffer, d.byteOffset);
  let p = nameAt;
  const nameLen = d[p];
  const pascal = new TextDecoder('latin1').decode(d.subarray(p + 1, p + 1 + nameLen));
  p += (1 + nameLen + 3) & ~3;
  r.name = pascal;
  while (p + 12 <= extraEnd) {
    const sig = String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]);
    if (sig !== '8BIM' && sig !== '8B64') { p++; continue; }
    const key = String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7]);
    const wide = big && (sig === '8B64' || ['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD'].includes(key));
    const len = wide ? Number(dv.getBigUint64(p + 8)) : dv.getUint32(p + 8);
    const body = p + 8 + (wide ? 8 : 4);
    if (key === 'luni' && len >= 4) {
      const n = dv.getUint32(body);
      let s = '';
      for (let i = 0; i < n && body + 4 + i * 2 + 1 < extraEnd; i++) s += String.fromCharCode(dv.getUint16(body + 4 + i * 2));
      if (s) r.name = s.replace(/\0+$/, '');
    } else if (key === 'lsct' && len >= 4) {
      r.section = dv.getUint32(body);
      if (len >= 12 && String.fromCharCode(d[body + 4], d[body + 5], d[body + 6], d[body + 7]) === '8BIM') r.sectionBlend = String.fromCharCode(d[body + 8], d[body + 9], d[body + 10], d[body + 11]);
    }
    p = body + len;
  }
}

async function readMerged(d: Uint8Array, from: number, W: number, H: number, nChannels: number, depth: number, big: boolean, mode: number): Promise<Raster | null> {
  const need = mode === 1 ? 1 : 3;
  if (nChannels < need) return null;
  const dv = new DataView(d.buffer, d.byteOffset);
  const comp = dv.getUint16(from);
  let p = from + 2;
  let counts: number[] | undefined;
  const per = (depth >> 3) * W * H;
  const planes: Uint8Array[] = [];
  const have = Math.min(nChannels, mode === 1 ? 2 : 4);
  if (comp === 1) {
    const total = H * nChannels;
    const all: number[] = [];
    for (let i = 0; i < total; i++) all.push(big ? dv.getUint32(p + i * 4) : dv.getUint16(p + i * 2));
    p += total * (big ? 4 : 2);
    counts = all;
    for (let ch = 0; ch < have; ch++) {
      const rows = counts.slice(ch * H, (ch + 1) * H);
      planes.push(await channelPlane(d, p, d.length, W, H, depth, big, 1, rows));
      for (const r of rows) p += r;
    }
  } else if (comp === 0) {
    for (let ch = 0; ch < have; ch++) { planes.push(await channelPlane(d, p, p + per, W, H, depth, big, 0)); p += per; }
  } else return null;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const R = planes[0], G = mode === 1 ? R : planes[1], B = mode === 1 ? R : planes[2], A = mode === 1 ? planes[1] : planes[3];
  for (let i = 0, o = 0; i < W * H; i++, o += 4) { rgba[o] = R[i]; rgba[o + 1] = G[i]; rgba[o + 2] = B[i]; rgba[o + 3] = A ? A[i] : 255; }
  return { rgba, w: W, h: H, x: 0, y: 0 };
}
