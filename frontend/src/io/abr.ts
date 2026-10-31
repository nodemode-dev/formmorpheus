/** Brush files (.abr): the binary layer. Two families exist. Versions 1 and 2: a count, then each brush's type and size;
 *  sampled brushes (type 2) carry spacing, a name (version 2), bounds, depth and pixels (raw or PackBits by row), computed
 *  ones (type 1) carry spacing, diameter, roundness, angle and hardness. Versions 6 to 10: a subversion, then 8BIM sections:
 *  'samp' the sampled tips (a pascal-string id, 10 or 264 bytes to skip, bounds, depth, compression, pixels), 'patt' the
 *  patterns (abr-patt.ts), 'desc' the presets as a descriptor tree (abr-desc.ts) and 'phry' the folders. Whatever cannot be
 *  read is left out with a warning; the rest of the file is still used. A tip's grey is the paint: 255 paints fully, 0 not
 *  at all. Tips over 512 pixels are reduced, never dropped; 16-bit levels (0 to 32768) are scaled to 8 bits. */

import { readDescriptor, readPhry, isNode, textOf, numOf, type DescNode, type DescValue } from './abr-desc';
import { readPatterns, type AbrPattern } from './abr-patt';

export interface SampledTip { w: number; h: number; data: Uint8Array }
/** `spacing` is a fraction of the tip's diameter: 0.25 is the file's 25 percent. */
export interface AbrBrush { name: string; tip: SampledTip; spacing: number; /** The folders it sat in, outermost first, joined by a slash. */ folder?: string }

class Reader {
  pos = 0;
  constructor(readonly v: DataView) {}
  get left(): number { return this.v.byteLength - this.pos; }
  u8(): number { return this.v.getUint8(this.pos++); }
  u16(): number { const x = this.v.getUint16(this.pos); this.pos += 2; return x; }
  i32(): number { const x = this.v.getInt32(this.pos); this.pos += 4; return x; }
  u32(): number { const x = this.v.getUint32(this.pos); this.pos += 4; return x; }
  skip(n: number): void { this.pos += n; }
}

/** Rows of PackBits: `h` row byte counts (16-bit), then each row's runs; a row decodes to `rowBytes` bytes. */
function unpackRows(r: Reader, rowBytes: number, h: number): Uint8Array | null {
  if (r.left < h * 2) return null;
  const out = new Uint8Array(rowBytes * h), counts: number[] = [];
  for (let y = 0; y < h; y++) counts.push(r.u16());
  for (let y = 0; y < h; y++) {
    // every read stays inside the file and inside the row's declared byte count
    const end = Math.min(r.pos + counts[y], r.pos + r.left);
    let x = 0;
    while (r.pos < end && x < rowBytes) {
      let n = r.u8();
      if (n >= 128) n -= 256;
      if (n < 0) {
        if (n === -128) continue;
        if (r.pos >= end) break;
        const v = r.u8();
        for (let k = 0; k < 1 - n && x < rowBytes; k++) out[y * rowBytes + x++] = v;
      } else {
        const take = Math.min(n + 1, rowBytes - x, end - r.pos);
        for (let k = 0; k < take; k++) out[y * rowBytes + x++] = r.u8();
      }
    }
    r.pos = end;
  }
  return out;
}

/** The most pixels a tip may have (the source app allows 5000 x 5000) and the side tips are reduced to. */
const MAX_PIXELS = 36_000_000;
const TIP_SIDE = 512;

/** A tip with its size as stored (`srcW` x `srcH`) and its pixels, reduced to at most 512 a side. */
export interface DecodedTip extends SampledTip { srcW: number; srcH: number }

/** Box reduction so a huge tip is shrunk, never dropped. */
function reduce(w: number, h: number, data: Uint8Array): DecodedTip {
  const k = Math.max(w, h) / TIP_SIDE;
  if (k <= 1) return { w, h, data, srcW: w, srcH: h };
  const nw = Math.max(1, Math.round(w / k)), nh = Math.max(1, Math.round(h / k)), out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * k), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((y + 1) * k)));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * k), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((x + 1) * k)));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += data[yy * w + xx]; n++; }
      out[y * nw + x] = Math.round(s / Math.max(1, n));
    }
  }
  return { w: nw, h: nh, data: out, srcW: w, srcH: h };
}

/** Pixels of `depth` bits (8 or 16), raw or packed, as an 8-bit tip. 16-bit levels run 0 to 32768 (65535 when any is higher). */
function pixels(r: Reader, w: number, h: number, depth: number, packed: boolean): DecodedTip | null {
  if (w <= 0 || h <= 0 || w * h > MAX_PIXELS || (depth !== 8 && depth !== 16)) return null;
  const bpp = depth / 8;
  let raw: Uint8Array | null;
  if (packed) raw = unpackRows(r, w * bpp, h);
  else {
    if (r.left < w * h * bpp) return null;
    raw = new Uint8Array(r.v.buffer, r.v.byteOffset + r.pos, w * h * bpp);
    r.skip(w * h * bpp);
  }
  if (!raw) return null;
  if (depth === 8) return reduce(w, h, packed ? raw : raw.slice());
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), out = new Uint8Array(w * h);
  let mx = 0;
  for (let i = 0; i < out.length; i++) mx = Math.max(mx, dv.getUint16(i * 2));
  const k = mx > 32768 ? 255 / 65535 : 255 / 32768;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.round(dv.getUint16(i * 2) * k));
  return reduce(w, h, out);
}

/** A brush of a version 1 or 2 file: sampled (a picture) or computed (round, from numbers). */
export interface AbrLegacy {
  name: string;
  /** A fraction of the diameter. */
  spacing: number;
  tip?: DecodedTip;
  /** Computed brushes: diameter in pixels, hardness and roundness in percent, angle in degrees. */
  computed?: { diameter: number; hardness: number; roundness: number; angle: number };
}

function readOld(r: Reader, version: number, base: string, warnings: string[]): AbrLegacy[] {
  const count = r.u16(), out: AbrLegacy[] = [];
  for (let i = 0; i < count && r.left > 6; i++) {
    const type = r.u16(), size = r.u32(), next = r.pos + size;
    try {
      if (type === 2) {
        r.skip(4);
        const spacing = r.u16();
        let name = `${base} ${out.length + 1}`;
        if (version === 2) {
          const len = r.u32();
          if (len > 1024) throw new RangeError('bad name');
          let s = '';
          for (let k = 0; k < len; k++) { const c = r.u16(); if (c) s += String.fromCharCode(c); }
          if (s.trim()) name = s.trim();
        }
        r.skip(1 + 8);
        const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32(), depth = r.u16(), packed = r.u8() === 1;
        const tip = pixels(r, right - left, bottom - top, depth, packed);
        if (tip) out.push({ name, tip, spacing: spacing / 100 });
        else warnings.push(`Tip ${i + 1} could not be read.`);
      } else if (type === 1) {
        r.skip(4);
        const spacing = r.u16(), diameter = r.u16(), roundness = r.u16(), angle = r.v.getInt16(r.pos), hardness = r.v.getUint16(r.pos + 2);
        out.push({ name: `${base} ${out.length + 1}`, spacing: spacing / 100, computed: { diameter, hardness, roundness, angle } });
      }
    } catch { warnings.push(`Brush ${i + 1} could not be read.`); }
    r.pos = next;
  }
  return out;
}

/** A computed brush's numbers (spacing in percent), for the picture-only view in `parseAbr`. */
interface Computed { id: string; name: string; diameter: number; hardness: number; angle: number; roundness: number; spacing: number }

/** A preset of a version 6 to 10 file: its descriptor and the folders it sat in (outermost first). */
export interface AbrPreset { node: DescNode; folder: string[] }

/** Presets in a 'desc' tree. A list under `Brsh` whose entries again hold a `Brsh` list is a folder (the older layout). */
function collectPresets(list: DescValue[], path: string[], out: AbrPreset[]): void {
  for (const it of list) {
    if (!isNode(it)) continue;
    const inner = it.items.get('Brsh');
    if (Array.isArray(inner)) collectPresets(inner, [...path, (textOf(it.items.get('Nm  ')) ?? '').trim()].filter((s) => s), out);
    // an entry with no tip is a preset the walk cut short, or not a brush at all
    else if (isNode(inner) || it.items.has('sampledData') || it.items.has('Dmtr')) out.push({ node: it, folder: path });
  }
}

/** A computed (round or elliptical) brush as a soft tip: full inside `hardness` percent of the radius, fading to nothing at the
 *  rim, squeezed to `roundness` percent and turned by `angle` degrees. At most 400 pixels across. */
function computedTip(c: Computed): SampledTip {
  const size = Math.max(2, Math.min(400, Math.round(c.diameter))), R = size / 2, hard = Math.max(0, Math.min(1, c.hardness / 100)), round = Math.max(0.01, Math.min(1, c.roundness / 100));
  const a = (-c.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x + 0.5 - R, dy = y + 0.5 - R, u = dx * ca + dy * sa, v = (-dx * sa + dy * ca) / round, d = Math.hypot(u, v) / R;
    data[y * size + x] = d >= 1 ? 0 : d <= hard ? 255 : Math.round(255 * (1 - (d - hard) / Math.max(0.001, 1 - hard)));
  }
  return { w: size, h: size, data };
}

/** A sampled tip of a version 6 to 10 file; `id` is what a preset's `sampledData` names. */
export interface AbrSample extends DecodedTip { id: string }

/** Everything an .abr file holds. Presets and legacy brushes are alternatives: a version 1 or 2 file has `legacy`, the rest `presets`. */
export interface AbrFile {
  version: number;
  samples: AbrSample[];
  patterns: AbrPattern[];
  presets: AbrPreset[];
  legacy: AbrLegacy[];
  /** Things that could not be read; the rest of the file was still used. */
  warnings: string[];
}

const sig4 = (v: DataView, p: number): string => String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));

/** Where the next '8BIM' starts at or just after `p` (sections are padded to four bytes, and some writers pad wrongly), or -1. */
function nextSection(v: DataView, p: number): number {
  for (let q = p; q <= p + 8 && q + 12 <= v.byteLength; q++) if (sig4(v, q) === '8BIM') return q;
  return -1;
}

function readSamples(v: DataView, start: number, end: number, sub: number, out: AbrSample[], warnings: string[]): void {
  const r = new Reader(v);
  r.pos = start;
  while (r.pos + 4 <= end) {
    const size = r.u32(), rec = r.pos, next = rec + size + ((4 - (size % 4)) % 4);
    if (size < 40 || rec + size > end) { if (size) warnings.push('A tip record was cut short.'); break; }
    try {
      const idLen = r.u8();
      let id = '';
      for (let k = 0; k < idLen; k++) id += String.fromCharCode(r.u8());
      r.skip(sub === 1 ? 10 : 264);
      const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32(), depth = r.u16(), packed = r.u8() === 1;
      const tip = pixels(r, right - left, bottom - top, depth, packed);
      if (tip) out.push({ ...tip, id: id.trim() });
      else warnings.push('A tip in the file could not be read.');
    } catch { warnings.push('A tip in the file could not be read.'); }
    r.pos = next;
  }
}

function readSections(v: DataView, sub: number, f: AbrFile): void {
  let p = nextSection(v, 4), phry: string[][] | null = null;
  while (p >= 0 && p + 12 <= v.byteLength) {
    const key = sig4(v, p + 4), len = v.getUint32(p + 8), start = p + 12, end = Math.min(v.byteLength, start + len);
    try {
      if (key === 'samp') readSamples(v, start, end, sub, f.samples, f.warnings);
      else if (key === 'patt') f.patterns.push(...readPatterns(v, start, end, f.warnings));
      else if (key === 'desc' && start + 4 <= end) {
        const { root, error } = readDescriptor(v, start + 4, end);
        const list = root.items.get('Brsh');
        if (Array.isArray(list)) collectPresets(list, [], f.presets);
        if (error) f.warnings.push(`The preset list stops early (${error}); the presets before it were kept.`);
      } else if (key === 'phry' && start + 4 <= end) phry = readPhry(v, start + 4, end).paths;
    } catch (e) { f.warnings.push(`Section ${key} could not be read.`); void e; }
    // a section ends where its length says, rounded up to four; look a little further when the next one is not there
    const q = nextSection(v, end);
    p = q;
  }
  if (phry && phry.length === f.presets.length) f.presets.forEach((pr, i) => { if (!pr.folder.length) pr.folder = phry![i]; });
  else if (phry && phry.length && f.presets.length) f.warnings.push('The folder list does not match the presets, so folders were not used.');
}

/** Reads a whole .abr file; throws on a file that is not one. `base` names brushes the file does not name. */
export function parseAbrFile(buf: ArrayBuffer, base = 'Brush'): AbrFile {
  const v = new DataView(buf), r = new Reader(v);
  if (r.left < 4) throw new Error('This file is too short to be a brush file.');
  const version = r.u16();
  const f: AbrFile = { version, samples: [], patterns: [], presets: [], legacy: [], warnings: [] };
  if (version === 1 || version === 2) { f.legacy = readOld(r, version, base, f.warnings); return f; }
  if (version >= 6 && version <= 10) {
    const sub = r.u16();
    if (sub !== 1 && sub !== 2) throw new Error(`This brush file has a layout this reader does not know (${version}.${sub}).`);
    readSections(v, sub, f);
    return f;
  }
  throw new Error(`This is not an .abr brush file this reader knows (version ${version}).`);
}

/** The tips in an .abr file with their names, spacing and folder, computed brushes drawn as soft tips. Kept for callers that want pictures only. */
export function parseAbr(buf: ArrayBuffer, base = 'Brush'): AbrBrush[] {
  const f = parseAbrFile(buf, base), out: AbrBrush[] = [];
  for (const l of f.legacy) {
    const tip = l.tip ?? (l.computed ? computedTip({ id: '', name: l.name, diameter: l.computed.diameter, hardness: l.computed.hardness, angle: l.computed.angle, roundness: l.computed.roundness, spacing: l.spacing * 100 }) : null);
    if (tip) out.push({ name: l.name, tip: { w: tip.w, h: tip.h, data: tip.data }, spacing: l.spacing });
  }
  const byId = new Map(f.samples.map((s) => [s.id, s]));
  for (const pr of f.presets) {
    const it = pr.node.items.get('Brsh'), tipNode = isNode(it) ? it : pr.node;
    const sid = textOf(tipNode.items.get('sampledData'))?.trim(), s = sid ? byId.get(sid) : undefined;
    const sp = (numOf(pr.node.items.get('Spcn')) ?? numOf(tipNode.items.get('Spcn')) ?? 25) / 100;
    const name = (textOf(pr.node.items.get('Nm  ')) ?? '').trim() || `${base} ${out.length + 1}`;
    const folder = pr.folder.length ? { folder: pr.folder.join('/') } : {};
    if (s) out.push({ name, tip: { w: s.w, h: s.h, data: s.data }, spacing: sp, ...folder });
    else if (numOf(tipNode.items.get('Dmtr')) !== null) {
      const g = (k: string, d: number): number => numOf(tipNode.items.get(k)) ?? d;
      out.push({ name, tip: computedTip({ id: '', name, diameter: g('Dmtr', 20), hardness: g('Hrdn', 100), angle: g('Angl', 0), roundness: g('Rndn', 100), spacing: sp * 100 }), spacing: sp, ...folder });
    }
  }
  return out;
}
