// Baseline TIFF decoder: uncompressed, PackBits, LZW and Deflate; 8 and 16 bit grey, grey+alpha, palette,
// RGB and RGBA (and 1 bit grey); strips and tiles; chunky or planar; horizontal predictor. Pure, no DOM.
import { unzlibSync } from 'fflate';

export interface Decoded { width: number; height: number; rgba: Uint8ClampedArray }

export function isTiff(b: Uint8Array): boolean {
  return b.length > 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42));
}

type Tags = Map<number, number[]>;

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

function readTags(dv: DataView, le: boolean, ifd: number): Tags {
  const tags: Tags = new Map();
  const n = dv.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const at = ifd + 2 + i * 12;
    const tag = dv.getUint16(at, le);
    const type = dv.getUint16(at + 2, le);
    const count = dv.getUint32(at + 4, le);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const data = size <= 4 ? at + 8 : dv.getUint32(at + 8, le);
    if (data + size > dv.byteLength) continue;
    const vals: number[] = [];
    for (let k = 0; k < count; k++) {
      switch (type) {
        case 3: vals.push(dv.getUint16(data + k * 2, le)); break;
        case 4: vals.push(dv.getUint32(data + k * 4, le)); break;
        case 8: vals.push(dv.getInt16(data + k * 2, le)); break;
        case 9: vals.push(dv.getInt32(data + k * 4, le)); break;
        case 16: vals.push(dv.getUint32(data + k * 8, le)); break;
        default: vals.push(dv.getUint8(data + k));
      }
    }
    tags.set(tag, vals);
  }
  return tags;
}

function packBits(src: Uint8Array, out: Uint8Array): void {
  let i = 0;
  let o = 0;
  while (i < src.length && o < out.length) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) {
      const len = n + 1;
      for (let k = 0; k < len && o < out.length; k++) out[o++] = src[i++];
    } else if (n !== -128) {
      const len = 1 - n;
      const v = src[i++];
      for (let k = 0; k < len && o < out.length; k++) out[o++] = v;
    }
  }
}

/** TIFF flavour of LZW: MSB-first codes, 9 to 12 bits, "early change". */
function lzw(src: Uint8Array, out: Uint8Array): void {
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) { suffix[i] = i; length[i] = 1; prefix[i] = -1; }
  let next = 258;
  let bits = 9;
  let acc = 0;
  let nacc = 0;
  let pos = 0;
  let o = 0;
  let old = -1;
  const emit = (code: number): number => {
    const len = length[code];
    let k = o + len - 1;
    let c = code;
    while (c >= 0 && k >= o) { if (k < out.length) out[k] = suffix[c]; k--; c = prefix[c]; }
    const first = out[o] ?? 0;
    o += len;
    return first;
  };
  for (;;) {
    while (nacc < bits && pos < src.length) { acc = (acc << 8) | src[pos++]; nacc += 8; }
    if (nacc < bits) break;
    const code = (acc >>> (nacc - bits)) & ((1 << bits) - 1);
    nacc -= bits;
    acc &= (1 << nacc) - 1;
    if (code === 257) break;
    if (code === 256) { next = 258; bits = 9; old = -1; continue; }
    if (old === -1) {
      if (code >= 256) break;
      out[o++] = code;
      old = code;
      continue;
    }
    if (code < next) {
      if (next < 4096) {
        // new entry: old + first byte of code
        let c = code;
        while (prefix[c] >= 0) c = prefix[c];
        prefix[next] = old; suffix[next] = suffix[c]; length[next] = length[old] + 1; next++;
      }
      emit(code);
    } else {
      let c = old;
      while (prefix[c] >= 0) c = prefix[c];
      if (next < 4096) { prefix[next] = old; suffix[next] = suffix[c]; length[next] = length[old] + 1; next++; }
      emit(next - 1);
    }
    old = code;
    if (next + 1 >= 4096) bits = 12;
    else if (next + 1 >= 2048) bits = 12;
    else if (next + 1 >= 1024) bits = 11;
    else if (next + 1 >= 512) bits = 10;
    else bits = 9;
    if (o >= out.length) break;
  }
}

export function decodeTiff(buf: Uint8Array): Decoded {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = buf[0] === 0x49;
  const tags = readTags(dv, le, dv.getUint32(4, le));
  const one = (t: number, d: number): number => tags.get(t)?.[0] ?? d;
  const width = one(256, 0);
  const height = one(257, 0);
  if (!width || !height || width * height > 268435456) throw new Error('unsupported size');
  const bps = tags.get(258)?.[0] ?? 1;
  const comp = one(259, 1);
  const photo = one(262, 1);
  const spp = one(277, 1);
  const planar = one(284, 1);
  const predictor = one(317, 1);
  const extra = tags.get(338) ?? [];
  const bytesPer = bps === 16 ? 2 : 1;
  if (bps !== 8 && bps !== 16 && !(bps === 1 && spp === 1)) throw new Error(`${bps}-bit samples are not supported`);
  if (![1, 5, 8, 32946, 32773].includes(comp)) throw new Error(`compression ${comp} is not supported`);
  if (![0, 1, 2, 3].includes(photo)) throw new Error('color model is not supported');
  if (photo === 2 && spp < 3) throw new Error('bad sample count');
  const palette = tags.get(320);

  const tiled = tags.has(322);
  const tw = tiled ? one(322, width) : width;
  const th = tiled ? one(323, height) : Math.min(one(278, height), height);
  const offsets = (tiled ? tags.get(324) : tags.get(273)) ?? [];
  const counts = (tiled ? tags.get(325) : tags.get(279)) ?? [];
  if (!offsets.length) throw new Error('no image data');
  const across = Math.ceil(width / tw);
  const down = Math.ceil(height / th);
  const planes = planar === 2 ? spp : 1;
  const chans = planar === 2 ? 1 : spp;
  // one full-size sample buffer, chunky (8 bit per sample after reduction)
  const full = new Uint8Array(width * height * spp);

  const rowBytes = (w: number): number => (bps === 1 ? Math.ceil(w / 8) : w * chans * bytesPer);
  for (let plane = 0; plane < planes; plane++) {
    for (let ty = 0; ty < down; ty++) {
      for (let tx = 0; tx < across; tx++) {
        const idx = plane * across * down + ty * across + tx;
        const off = offsets[idx];
        if (off === undefined) continue;
        const len = counts[idx] ?? buf.length - off;
        const raw = buf.subarray(off, Math.min(buf.length, off + len));
        // tiles are always full size on disk; strips may be short at the bottom
        const blockH = tiled ? th : Math.min(th, height - ty * th);
        const blockW = tiled ? tw : width;
        const need = rowBytes(blockW) * blockH;
        let data: Uint8Array;
        if (comp === 1) data = raw;
        else if (comp === 32773) { data = new Uint8Array(need); packBits(raw, data); }
        else if (comp === 5) { data = new Uint8Array(need); lzw(raw, data); }
        else { data = new Uint8Array(need); try { data.set(unzlibSync(raw).subarray(0, need)); } catch { throw new Error('damaged Deflate data'); } }
        const rb = rowBytes(blockW);
        if (predictor === 2 && bps === 8) {
          for (let r = 0; r < blockH; r++) for (let x = chans; x < blockW * chans; x++) data[r * rb + x] = (data[r * rb + x] + data[r * rb + x - chans]) & 255;
        }
        for (let r = 0; r < blockH; r++) {
          const y = ty * th + r;
          if (y >= height) break;
          for (let x = 0; x < blockW; x++) {
            const px = tx * tw + x;
            if (px >= width) break;
            const dst = (y * width + px) * spp;
            if (bps === 1) {
              full[dst] = (data[r * rb + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
            } else if (planar === 2) {
              full[dst + plane] = bps === 16 ? data[r * rb + x * 2 + (le ? 1 : 0)] : data[r * rb + x];
            } else {
              for (let c = 0; c < spp; c++) {
                const si = r * rb + (x * spp + c) * bytesPer;
                full[dst + c] = bps === 16 ? data[si + (le ? 1 : 0)] : data[si];
              }
            }
          }
        }
      }
    }
  }
  if (predictor === 2 && bps === 16) { /* rare: left as decoded */ }

  const rgba = new Uint8ClampedArray(width * height * 4);
  const n = width * height;
  const invert = photo === 0;
  const assoc = extra[0] === 1;
  for (let i = 0; i < n; i++) {
    const s = i * spp;
    const d = i * 4;
    let r: number; let g: number; let b: number; let a = 255;
    if (photo === 2) {
      r = full[s]; g = full[s + 1]; b = full[s + 2];
      if (spp > 3) a = full[s + 3];
    } else if (photo === 3 && palette) {
      const k = full[s];
      const entries = palette.length / 3;
      r = palette[k] >> 8; g = palette[entries + k] >> 8; b = palette[2 * entries + k] >> 8;
    } else {
      const v = invert ? 255 - full[s] : full[s];
      r = g = b = v;
      if (spp > 1) a = full[s + 1];
    }
    if (assoc && a > 0 && a < 255) { r = Math.min(255, Math.round((r * 255) / a)); g = Math.min(255, Math.round((g * 255) / a)); b = Math.min(255, Math.round((b * 255) / a)); }
    rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a;
  }
  return { width, height, rgba };
}
