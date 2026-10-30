// Picture encoders the canvas cannot write itself: TIFF (uncompressed or deflate), TGA and BMP.
// All take straight (non-premultiplied) RGBA bytes as ImageData gives them and return the file bytes.
import { zlibSync } from 'fflate';

export type RawPicture = 'tiff' | 'tga' | 'bmp';

/** Formats that can carry transparency (BMP and JPG cannot). */
export function pictureHasAlpha(ext: string): boolean {
  return ext === 'png' || ext === 'tiff' || ext === 'tga' || ext === 'webp';
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', tiff: 'image/tiff', tga: 'image/x-tga', bmp: 'image/bmp' };
export function pictureMime(ext: string): string {
  return MIME[ext] ?? 'application/octet-stream';
}

/** Baseline little-endian TIFF, RGB or RGBA (unassociated alpha), strips of about 64 KB. */
export function encodeTiff(rgba: Uint8ClampedArray, w: number, h: number, alpha: boolean, deflate: boolean): Uint8Array {
  const spp = alpha ? 4 : 3;
  const rowBytes = w * spp;
  const rowsPerStrip = Math.max(1, Math.min(h, Math.floor(65536 / rowBytes)));
  const strips = Math.ceil(h / rowsPerStrip);
  const chunks: Uint8Array[] = [];
  const row = new Uint8Array(rowBytes);
  for (let s = 0; s < strips; s++) {
    const y0 = s * rowsPerStrip, rows = Math.min(rowsPerStrip, h - y0);
    const raw = new Uint8Array(rows * rowBytes);
    for (let r = 0; r < rows; r++) {
      let p = (y0 + r) * w * 4, o = 0;
      if (alpha) { row.set(rgba.subarray(p, p + rowBytes)); }
      else for (let x = 0; x < w; x++, p += 4) { row[o++] = rgba[p]; row[o++] = rgba[p + 1]; row[o++] = rgba[p + 2]; }
      raw.set(row, r * rowBytes);
    }
    chunks.push(deflate ? zlibSync(raw, { level: 6 }) : raw);
  }
  const entries = alpha ? 11 : 10;
  const ifdStart = 8, ifdBytes = 2 + entries * 12 + 4;
  let extra = ifdStart + ifdBytes;
  const bpsAt = extra; extra += spp * 2;
  const offsAt = strips > 1 ? extra : 0; if (strips > 1) extra += strips * 4;
  const cntAt = strips > 1 ? extra : 0; if (strips > 1) extra += strips * 4;
  const dataAt = extra;
  const total = dataAt + chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, ifdStart, true);
  dv.setUint16(ifdStart, entries, true);
  let e = ifdStart + 2;
  const tag = (id: number, type: number, count: number, value: number): void => {
    dv.setUint16(e, id, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, count, true);
    if (type === 3 && count === 1) dv.setUint16(e + 8, value, true); else dv.setUint32(e + 8, value, true);
    e += 12;
  };
  const offsets: number[] = [];
  let at = dataAt;
  for (const c of chunks) { offsets.push(at); at += c.length; }
  tag(256, 4, 1, w);
  tag(257, 4, 1, h);
  tag(258, 3, spp, bpsAt);
  tag(259, 3, 1, deflate ? 8 : 1);
  tag(262, 3, 1, 2);
  tag(273, 4, strips, strips > 1 ? offsAt : offsets[0]);
  tag(277, 3, 1, spp);
  tag(278, 4, 1, rowsPerStrip);
  tag(279, 4, strips, strips > 1 ? cntAt : chunks[0].length);
  tag(284, 3, 1, 1);
  if (alpha) tag(338, 3, 1, 2);
  dv.setUint32(e, 0, true);
  for (let i = 0; i < spp; i++) dv.setUint16(bpsAt + i * 2, 8, true);
  if (strips > 1) for (let i = 0; i < strips; i++) { dv.setUint32(offsAt + i * 4, offsets[i], true); dv.setUint32(cntAt + i * 4, chunks[i].length, true); }
  chunks.forEach((c, i) => out.set(c, offsets[i]));
  return out;
}

/** Uncompressed true-colour TGA, top-left origin, 32 bit with alpha or 24 bit. */
export function encodeTga(rgba: Uint8ClampedArray, w: number, h: number, alpha: boolean): Uint8Array {
  const bpp = alpha ? 4 : 3;
  const out = new Uint8Array(18 + w * h * bpp);
  const dv = new DataView(out.buffer);
  out[2] = 2;
  dv.setUint16(12, w, true); dv.setUint16(14, h, true);
  out[16] = bpp * 8;
  out[17] = 0x20 | (alpha ? 8 : 0);
  let o = 18;
  for (let p = 0, n = w * h * 4; p < n; p += 4) {
    out[o++] = rgba[p + 2]; out[o++] = rgba[p + 1]; out[o++] = rgba[p];
    if (alpha) out[o++] = rgba[p + 3];
  }
  return out;
}

/** 24 bit bottom-up BMP (no transparency). */
export function encodeBmp(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const stride = (w * 3 + 3) & ~3;
  const size = 54 + stride * h;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  dv.setUint32(2, size, true); dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
  dv.setUint32(34, stride * h, true); dv.setUint32(38, 2835, true); dv.setUint32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * stride, p = y * w * 4;
    for (let x = 0; x < w; x++, p += 4) { out[o++] = rgba[p + 2]; out[o++] = rgba[p + 1]; out[o++] = rgba[p]; }
  }
  return out;
}

export function encodeRaw(ext: RawPicture, rgba: Uint8ClampedArray, w: number, h: number, alpha: boolean, deflate: boolean): Uint8Array {
  if (ext === 'tiff') return encodeTiff(rgba, w, h, alpha, deflate);
  if (ext === 'tga') return encodeTga(rgba, w, h, alpha);
  return encodeBmp(rgba, w, h);
}
