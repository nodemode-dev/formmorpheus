// Animated picture files written by hand from the published container specs: APNG (PNG with the animation
// chunks) and animated WebP (RIFF with VP8X / ANIM / ANMF). Pure byte work, no DOM.
import { zlibSync } from 'fflate';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (v: number): Uint8Array => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const u16 = (v: number): Uint8Array => new Uint8Array([(v >>> 8) & 255, v & 255]);
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const t = ascii(type);
  return concat([u32(data.length), t, data, u32(crc32([t, data]))]);
}

/** zlib data of an RGBA (or RGB) picture with the Sub filter on every row. */
function deflatePixels(rgba: Uint8ClampedArray, w: number, h: number, alpha: boolean): Uint8Array {
  const bpp = alpha ? 4 : 3, stride = w * bpp;
  const raw = new Uint8Array((stride + 1) * h);
  const row = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    let s = y * w * 4;
    for (let x = 0, d = 0; x < w; x++, s += 4) {
      row[d++] = rgba[s]; row[d++] = rgba[s + 1]; row[d++] = rgba[s + 2];
      if (alpha) row[d++] = rgba[s + 3];
    }
    const o = y * (stride + 1);
    raw[o] = 1;
    for (let i = 0; i < stride; i++) raw[o + 1 + i] = (row[i] - (i >= bpp ? row[i - bpp] : 0)) & 255;
  }
  return zlibSync(raw, { level: 6 });
}

/** The file being written passed the size it may have (a hard cap, or four times a target size): `estimate` is where it was heading. */
export class SizeOver extends Error {
  constructor(readonly estimate: number, message: string) { super(message); }
}

/** The most an animated PNG may take before the export stops with a clear message. */
export const APNG_MAX_BYTES = 1_500_000_000;

/**
 * Writes the file as the frames arrive: each frame's chunks are made at once (the frame count and the delay are
 * known up front) and kept as a list of blob pieces, so nothing is joined into one buffer and the raw picture is
 * dropped as soon as it is compressed. `stopAt` ends a pass early once the projected size is clearly over.
 */
export class ApngWriter {
  private readonly parts: BlobPart[] = [];
  private seq = 0;
  private n = 0;
  private bytes = 0;

  constructor(
    private readonly w: number, private readonly h: number, private readonly alpha: boolean,
    private readonly total: number, plays: number, private readonly delayNum: number, private readonly delayDen: number,
    private readonly stopAt: number = APNG_MAX_BYTES,
  ) {
    this.put(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    this.put(pngChunk('IHDR', concat([u32(w), u32(h), new Uint8Array([8, alpha ? 6 : 2, 0, 0, 0])])));
    this.put(pngChunk('acTL', concat([u32(total), u32(Math.max(0, Math.round(plays)))])));
  }

  private put(b: Uint8Array): void { this.parts.push(b as BlobPart); this.bytes += b.length; }

  addFrame(rgba: Uint8ClampedArray): void {
    const { w, h } = this;
    const z = deflatePixels(rgba, w, h, this.alpha);
    this.put(pngChunk('fcTL', concat([u32(this.seq++), u32(w), u32(h), u32(0), u32(0), u16(this.delayNum), u16(this.delayDen), new Uint8Array([0, 0])])));
    // the data is split in chunks of at most 1 MB
    const step = 1 << 20;
    for (let o = 0; o < z.length; o += step) {
      const part = z.subarray(o, Math.min(z.length, o + step));
      this.put(this.n === 0 ? pngChunk('IDAT', part) : pngChunk('fdAT', concat([u32(this.seq++), part])));
    }
    this.n++;
    const est = this.n >= 2 ? (this.bytes / this.n) * this.total : this.bytes;
    if (this.bytes > this.stopAt || (this.n >= 2 && est > this.stopAt)) {
      this.parts.length = 0;
      throw new SizeOver(est, `This animated picture would be about ${Math.round(est / 1e6)} MB. Use a smaller size, fewer frames, or a video format.`);
    }
  }

  finish(): Blob {
    this.put(pngChunk('IEND', new Uint8Array(0)));
    const b = new Blob(this.parts, { type: 'image/png' });
    this.parts.length = 0;
    return b;
  }
}

// WebP --------------------------------------------------------------------------------------------------

interface WebpFrame { chunks: Uint8Array; hasAlpha: boolean }

/** The bitstream chunks (ALPH, VP8 / VP8L) of a one-picture WebP file. */
function webpParts(file: Uint8Array): WebpFrame {
  if (file.length < 20 || String.fromCharCode(...file.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...file.subarray(8, 12)) !== 'WEBP') {
    throw new Error('The browser did not produce a WebP picture.');
  }
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const keep: Uint8Array[] = [];
  let hasAlpha = false;
  for (let p = 12; p + 8 <= file.length;) {
    const type = String.fromCharCode(...file.subarray(p, p + 4));
    const len = dv.getUint32(p + 4, true);
    const end = p + 8 + len + (len & 1);
    if (type === 'ALPH') { hasAlpha = true; keep.push(file.subarray(p, Math.min(end, file.length))); }
    else if (type === 'VP8 ' || type === 'VP8L') {
      if (type === 'VP8L' && (file[p + 8 + 4] & 0x10)) hasAlpha = true;
      keep.push(file.subarray(p, Math.min(end, file.length)));
    } else if (type === 'VP8X' && (file[p + 8] & 0x10)) hasAlpha = true;
    p = end;
  }
  if (!keep.length) throw new Error('The WebP picture had no image data.');
  return { chunks: concat(keep), hasAlpha };
}

const le32 = (v: number): Uint8Array => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
const le24 = (v: number): Uint8Array => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255]);

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const body = data.length & 1 ? concat([data, new Uint8Array(1)]) : data;
  return concat([ascii(type), le32(data.length), body]);
}

export class WebpAnimWriter {
  private readonly frames: { part: WebpFrame; ms: number }[] = [];
  constructor(private readonly w: number, private readonly h: number) {}

  /** `file` is a still WebP of this frame (lossy or lossless) and `ms` how long it shows. */
  addFrame(file: Uint8Array, ms: number): void {
    this.frames.push({ part: webpParts(file), ms: Math.max(1, Math.min(0xffffff, Math.round(ms))) });
  }

  finish(loops: number): Uint8Array {
    const { w, h } = this;
    const alpha = this.frames.some((f) => f.part.hasAlpha);
    const vp8x = concat([new Uint8Array([0x02 | (alpha ? 0x10 : 0), 0, 0, 0]), le24(w - 1), le24(h - 1)]);
    const anim = concat([new Uint8Array([255, 255, 255, 255]), new Uint8Array([Math.max(0, loops) & 255, (Math.max(0, loops) >>> 8) & 255])]);
    const parts: Uint8Array[] = [riffChunk('VP8X', vp8x), riffChunk('ANIM', anim)];
    for (const f of this.frames) {
      // blend method 1: this frame replaces what is under it (each one is a whole picture)
      const head = concat([le24(0), le24(0), le24(w - 1), le24(h - 1), le24(f.ms), new Uint8Array([alpha ? 0x02 : 0x00])]);
      parts.push(riffChunk('ANMF', concat([head, f.part.chunks])));
    }
    const body = concat([ascii('WEBP'), ...parts]);
    this.frames.length = 0;
    return concat([ascii('RIFF'), le32(body.length), body]);
  }
}
