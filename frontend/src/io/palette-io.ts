// Palette files, in and out, and a palette from a picture. Pure: bytes, text and typed arrays only (no DOM).
//
// Formats
//   .swatches  a zip holding Swatches.json: an array with one palette object { name, swatches: [ { hue, saturation,
//              brightness, alpha?, origin?, colorSpace? } | null ] }, hue / saturation / brightness 0 to 1, at most 30
//              swatches. CONFIRMED by two public readers and a generator: the zip, the file name Swatches.json, the
//              one-element array, `name`, `swatches`, null padding, hue / saturation / brightness. ASSUMED: alpha, origin
//              and colorSpace are written as 1, 0 and 0 (readers that need them get plain values).
//   .ase       Adobe Swatch Exchange, big-endian: "ASEF", version 1.0, a block count, blocks of group start (0xC001),
//              group end (0xC002) and colour (0x0001: UTF-16 name, 4-letter model, floats, a type). Read: RGB, CMYK,
//              Gray and LAB entries; written: RGB.
//   .gpl       a text palette: "GIMP Palette", Name:, Columns:, a "#" line, then "R G B name" lines.
//   .fmpal     our own JSON: { format: "formmorpheus-palette", version: 1, name, colors: ["#rrggbb" | null] }.
// A palette from an image uses k-means in linear light (5 to 30 colors), seeded so the result is repeatable.

import { zipSync } from 'fflate';
import { safeUnzipOr } from './safe-unzip';

export interface Rgb { r: number; g: number; b: number }
export interface PaletteData { name: string; colors: Rgb[] }

export const MAX_COLORS = 30;
/** Palettes one imported file may add; colors read per palette before the cap to MAX_COLORS. */
export const MAX_PALETTES = 64;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const byte = (v: number): number => (Number.isFinite(v) ? clamp(Math.round(v), 0, 255) : 0);
export const toHex = (c: Rgb): string => '#' + [c.r, c.g, c.b].map((v) => byte(v).toString(16).padStart(2, '0')).join('');
export function fromHex(s: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ---- colour maths ------------------------------------------------------------------

export function rgbToHsb(c: Rgb): { h: number; s: number; b: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s: mx === 0 ? 0 : d / mx, b: mx };
}

export function hsbToRgb(h: number, s: number, v: number): Rgb {
  const hh = ((h % 1) + 1) % 1 * 6, i = Math.floor(hh), f = hh - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return { r: byte(r * 255), g: byte(g * 255), b: byte(b * 255) };
}

// ---- readers -------------------------------------------------------------------------

export function parseGpl(text: string, fallback: string): PaletteData {
  const lines = text.split(/\r?\n/);
  if (!/^GIMP Palette/i.test(lines[0] ?? '')) throw new Error('This is not a GPL palette.');
  let name = fallback;
  const colors: Rgb[] = [];
  for (const raw of lines.slice(1)) {
    const l = raw.trim();
    if (!l) continue;
    const nm = /^Name:\s*(.*)$/i.exec(l);
    if (nm) { if (nm[1].trim()) name = nm[1].trim(); continue; }
    if (l.startsWith('#') || /^Columns:/i.test(l)) continue;
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(l);
    if (m) colors.push({ r: byte(+m[1]), g: byte(+m[2]), b: byte(+m[3]) });
    if (colors.length >= MAX_COLORS) break;
  }
  return { name, colors };
}

/** Adobe Swatch Exchange. Group names become separate palettes when a file has several groups. */
export function parseAse(bytes: Uint8Array, fallback: string): PaletteData[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || v.getUint32(0) !== 0x41534546) throw new Error('This is not an ASE palette.');
  const count = v.getUint32(8);
  const out: PaletteData[] = [];
  let cur: PaletteData = { name: fallback, colors: [] };
  let at = 12;
  const f32 = (o: number): number => v.getFloat32(o);
  const name = (o: number, n: number): string => { let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint16(o + i * 2)); return s; };
  for (let i = 0; i < count && at + 6 <= bytes.length; i++) {
    const type = v.getUint16(at), len = v.getUint32(at + 2), body = at + 6;
    if (len > bytes.length - body) break;
    if (out.length >= MAX_PALETTES) break;
    // a name or color that reaches past its block is a damaged entry: skip it
    const n = len >= 2 ? v.getUint16(body) : 0;
    if (type === 0xc001) {
      if (cur.colors.length) out.push(cur);
      cur = { name: len >= 2 + n * 2 ? name(body + 2, Math.min(n, 64)).trim() || fallback : fallback, colors: [] };
    } else if (type === 0x0001 && len >= 2 + n * 2 + 4) {
      let o = body + 2 + n * 2;
      if (o + 4 > body + len) { at = body + len; continue; }
      const model = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
      o += 4;
      let c: Rgb | null = null;
      const need = model === 'CMYK' ? 16 : model === 'Gray' ? 4 : 12;
      if (cur.colors.length >= MAX_COLORS || o + need > body + len) c = null;
      else if (model === 'RGB ') c = { r: byte(f32(o) * 255), g: byte(f32(o + 4) * 255), b: byte(f32(o + 8) * 255) };
      else if (model === 'Gray') { const g = byte(f32(o) * 255); c = { r: g, g, b: g }; }
      else if (model === 'CMYK') {
        const C = f32(o), M = f32(o + 4), Y = f32(o + 8), K = f32(o + 12);
        c = { r: byte(255 * (1 - C) * (1 - K)), g: byte(255 * (1 - M) * (1 - K)), b: byte(255 * (1 - Y) * (1 - K)) };
      } else if (model === 'LAB ') c = labToRgb(f32(o) * 100, f32(o + 4), f32(o + 8));
      if (c) cur.colors.push(c);
    }
    at = body + len;
  }
  if (cur.colors.length) out.push(cur);
  return out;
}

function labToRgb(L: number, a: number, b: number): Rgb {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number): number => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29));
  const X = 0.95047 * inv(fx), Y = inv(fy), Z = 1.08883 * inv(fz);
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  const enc = (c: number): number => byte(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055));
  return { r: enc(lin[0]), g: enc(lin[1]), b: enc(lin[2]) };
}

interface SwatchJson { name?: unknown; swatches?: unknown }

function fromSwatchJson(root: unknown, fallback: string): PaletteData[] {
  const list = Array.isArray(root) ? root : [root];
  const out: PaletteData[] = [];
  for (const p of (list as SwatchJson[]).slice(0, MAX_PALETTES)) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.swatches)) continue;
    const colors: Rgb[] = [];
    for (const s of (p.swatches as unknown[]).slice(0, 4 * MAX_COLORS)) {
      const o = s as { hue?: unknown; saturation?: unknown; brightness?: unknown } | null;
      if (!o || typeof o.hue !== 'number' || typeof o.saturation !== 'number' || typeof o.brightness !== 'number') continue;
      colors.push(hsbToRgb(o.hue, clamp(o.saturation, 0, 1), clamp(o.brightness, 0, 1)));
    }
    out.push({ name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : fallback, colors });
  }
  return out;
}

/** The .swatches zip or any zip that holds a Swatches.json. */
export function parseSwatches(bytes: Uint8Array, fallback: string): PaletteData[] {
  const files = safeUnzipOr(bytes, 'This file is not a swatches archive.', { entry: 8 * 1024 * 1024, total: 16 * 1024 * 1024, count: 64 });
  const key = Object.keys(files).find((k) => /(^|\/)swatches\.json$/i.test(k));
  if (!key) throw new Error('This archive holds no Swatches.json.');
  let json: unknown;
  try { json = JSON.parse(new TextDecoder().decode(files[key])); } catch { throw new Error('The swatches could not be read.'); }
  return fromSwatchJson(json, fallback);
}

function parseFmpal(text: string, fallback: string): PaletteData {
  let j: { format?: unknown; name?: unknown; colors?: unknown };
  try { j = JSON.parse(text); } catch { throw new Error('This palette could not be read.'); }
  if (j.format !== 'formmorpheus-palette' || !Array.isArray(j.colors)) throw new Error('This is not a palette file.');
  const colors: Rgb[] = [];
  for (const c of (j.colors as unknown[]).slice(0, 4 * MAX_COLORS)) { const rgb = typeof c === 'string' ? fromHex(c) : null; if (rgb) colors.push(rgb); }
  return { name: typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, 32) : fallback, colors };
}

/** Reads a palette file by its content (and its name when the content is ambiguous). One file can hold several palettes. */
export function parsePaletteFile(bytes: Uint8Array, fileName: string): PaletteData[] {
  const base = fileName.replace(/\.[^.]+$/, '').slice(0, 32) || 'Palette';
  let out: PaletteData[];
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) out = parseSwatches(bytes, base);
  else if (bytes.length >= 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'ASEF') out = parseAse(bytes, base);
  else {
    const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024)));
    if (/^GIMP Palette/i.test(text)) out = [parseGpl(text, base)];
    else if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
      // our own JSON, or a bare Swatches.json
      let j: unknown = null;
      try { j = JSON.parse(text); } catch { /* handled below */ }
      if (j && !Array.isArray(j) && (j as { format?: unknown }).format === 'formmorpheus-palette') out = [parseFmpal(text, base)];
      else if (j) out = fromSwatchJson(j, base);
      else throw new Error('This palette could not be read.');
    } else throw new Error('Palette files are .swatches, .ase, .gpl and .fmpal.');
  }
  out = out.filter((p) => p.colors.length > 0).slice(0, MAX_PALETTES).map((p) => ({ name: p.name.slice(0, 32), colors: p.colors.slice(0, MAX_COLORS) }));
  if (!out.length) throw new Error('This file holds no colors.');
  return out;
}

// ---- writers -------------------------------------------------------------------------

export function exportSwatches(p: PaletteData): Uint8Array {
  const swatches: ({ hue: number; saturation: number; brightness: number; alpha: number; origin: number; colorSpace: number } | null)[] = [];
  for (let i = 0; i < MAX_COLORS; i++) {
    const c = p.colors[i];
    if (!c) { swatches.push(null); continue; }
    const h = rgbToHsb(c);
    swatches.push({ hue: round4(h.h), saturation: round4(h.s), brightness: round4(h.b), alpha: 1, origin: 0, colorSpace: 0 });
  }
  const json = JSON.stringify([{ name: p.name, swatches }]);
  return zipSync({ 'Swatches.json': new TextEncoder().encode(json) }, { level: 6 });
}
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

export function exportGpl(p: PaletteData): Uint8Array {
  const lines = ['GIMP Palette', `Name: ${p.name.replace(/[\r\n]/g, ' ')}`, 'Columns: 10', '#'];
  for (const c of p.colors) lines.push(`${String(c.r).padStart(3)} ${String(c.g).padStart(3)} ${String(c.b).padStart(3)} ${toHex(c).toUpperCase()}`);
  return new TextEncoder().encode(lines.join('\n') + '\n');
}

export function exportAse(p: PaletteData): Uint8Array {
  const utf16 = (s: string): number[] => { const o: number[] = []; for (const ch of s.slice(0, 60)) o.push(ch.charCodeAt(0)); o.push(0); return o; };
  const blocks: Uint8Array[] = [];
  p.colors.forEach((c, i) => {
    const nm = utf16(toHex(c).toUpperCase());
    const body = new Uint8Array(2 + nm.length * 2 + 4 + 12 + 2), dv = new DataView(body.buffer);
    dv.setUint16(0, nm.length);
    nm.forEach((u, k) => dv.setUint16(2 + k * 2, u));
    let o = 2 + nm.length * 2;
    'RGB '.split('').forEach((ch, k) => dv.setUint8(o + k, ch.charCodeAt(0)));
    o += 4;
    dv.setFloat32(o, c.r / 255); dv.setFloat32(o + 4, c.g / 255); dv.setFloat32(o + 8, c.b / 255);
    dv.setUint16(o + 12, 2);
    const blk = new Uint8Array(6 + body.length), bv = new DataView(blk.buffer);
    bv.setUint16(0, 0x0001); bv.setUint32(2, body.length);
    blk.set(body, 6);
    blocks.push(blk);
    void i;
  });
  const head = new Uint8Array(12), hv = new DataView(head.buffer);
  hv.setUint32(0, 0x41534546); hv.setUint16(4, 1); hv.setUint16(6, 0); hv.setUint32(8, blocks.length);
  const out = new Uint8Array(12 + blocks.reduce((n, b) => n + b.length, 0));
  out.set(head, 0);
  let at = 12;
  for (const b of blocks) { out.set(b, at); at += b.length; }
  return out;
}

export function exportFmpal(p: PaletteData): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ format: 'formmorpheus-palette', version: 1, name: p.name, colors: p.colors.map(toHex) }, null, 1));
}

export type PaletteFormat = 'swatches' | 'ase' | 'gpl' | 'fmpal';
export const FORMAT_EXT: Record<PaletteFormat, string> = { swatches: 'swatches', ase: 'ase', gpl: 'gpl', fmpal: 'fmpal' };

export function exportPalette(p: PaletteData, f: PaletteFormat): Uint8Array {
  return f === 'swatches' ? exportSwatches(p) : f === 'ase' ? exportAse(p) : f === 'gpl' ? exportGpl(p) : exportFmpal(p);
}

// ---- a palette from a picture --------------------------------------------------------

const DEC = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; DEC[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const enc = (l: number): number => byte(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));

/**
 * k-means over the picture's pixels in linear light, k-means++ start with a fixed seed. `rgba` is straight RGBA bytes;
 * pixels that are mostly transparent are skipped. The result runs from dark to light by hue family: sorted by hue,
 * then lightness, with greys last.
 */
export function paletteFromPixels(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, k: number): Rgb[] {
  const K = clamp(Math.round(k), 5, MAX_COLORS);
  // at most about 24,000 sample points, evenly strided
  const total = w * h, stride = Math.max(1, Math.floor(total / 24000));
  const pts: number[] = [];
  for (let i = 0; i < total; i += stride) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    pts.push(DEC[rgba[o]], DEC[rgba[o + 1]], DEC[rgba[o + 2]]);
  }
  const n = pts.length / 3;
  if (n === 0) return [];
  let seed = 0x9e3779b9;
  const rnd = (): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const kk = Math.min(K, n);
  const cen = new Float64Array(kk * 3);
  const d2 = new Float64Array(n).fill(Infinity);
  let pick = Math.floor(rnd() * n);
  for (let c = 0; c < kk; c++) {
    cen[c * 3] = pts[pick * 3]; cen[c * 3 + 1] = pts[pick * 3 + 1]; cen[c * 3 + 2] = pts[pick * 3 + 2];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dr = pts[i * 3] - cen[c * 3], dg = pts[i * 3 + 1] - cen[c * 3 + 1], db = pts[i * 3 + 2] - cen[c * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < d2[i]) d2[i] = d;
      sum += d2[i];
    }
    if (sum <= 0) { pick = Math.floor(rnd() * n); continue; }
    let r = rnd() * sum;
    pick = n - 1;
    for (let i = 0; i < n; i++) { r -= d2[i]; if (r <= 0) { pick = i; break; } }
  }
  const assign = new Int32Array(n);
  const sums = new Float64Array(kk * 3), cnt = new Float64Array(kk);
  for (let it = 0; it < 16; it++) {
    sums.fill(0); cnt.fill(0);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < kk; c++) {
        const dr = pts[i * 3] - cen[c * 3], dg = pts[i * 3 + 1] - cen[c * 3 + 1], db = pts[i * 3 + 2] - cen[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved++; }
      sums[best * 3] += pts[i * 3]; sums[best * 3 + 1] += pts[i * 3 + 1]; sums[best * 3 + 2] += pts[i * 3 + 2]; cnt[best]++;
    }
    for (let c = 0; c < kk; c++) {
      if (cnt[c] > 0) { cen[c * 3] = sums[c * 3] / cnt[c]; cen[c * 3 + 1] = sums[c * 3 + 1] / cnt[c]; cen[c * 3 + 2] = sums[c * 3 + 2] / cnt[c]; }
      else { const p = Math.floor(rnd() * n); cen[c * 3] = pts[p * 3]; cen[c * 3 + 1] = pts[p * 3 + 1]; cen[c * 3 + 2] = pts[p * 3 + 2]; }
    }
    if (it > 0 && moved === 0) break;
  }
  const out: { c: Rgb; hue: number; lum: number; grey: boolean; share: number }[] = [];
  for (let c = 0; c < kk; c++) {
    if (cnt[c] === 0) continue;
    const rgb = { r: enc(cen[c * 3]), g: enc(cen[c * 3 + 1]), b: enc(cen[c * 3 + 2]) };
    const hs = rgbToHsb(rgb);
    out.push({ c: rgb, hue: hs.h, lum: 0.2126 * cen[c * 3] + 0.7152 * cen[c * 3 + 1] + 0.0722 * cen[c * 3 + 2], grey: hs.s < 0.12, share: cnt[c] / n });
  }
  out.sort((a, b) => (a.grey === b.grey ? (a.grey ? a.lum - b.lum : Math.round(a.hue * 12) - Math.round(b.hue * 12) || a.lum - b.lum) : a.grey ? 1 : -1));
  return out.map((o) => o.c);
}
