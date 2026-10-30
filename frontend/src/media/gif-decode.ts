// GIF decoder: LZW, global and local palettes, interlacing, transparency and the three disposal methods.
// Every returned frame is the fully composed picture at the logical screen size. Pure, no DOM.

export interface GifFrame { rgba: Uint8ClampedArray; delayMs: number }
export interface Gif { width: number; height: number; frames: GifFrame[] }

export function isGif(b: Uint8Array): boolean {
  return b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
}

function lzw(minBits: number, data: Uint8Array, out: Uint8Array): void {
  const clear = 1 << minBits;
  const eoi = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minBits + 1;
  let next = eoi + 1;
  let old = -1;
  let first = 0;
  let acc = 0;
  let nacc = 0;
  let pos = 0;
  let o = 0;
  while (o < out.length) {
    while (nacc < size && pos < data.length) { acc |= data[pos++] << nacc; nacc += 8; }
    if (nacc < size) break;
    let code = acc & ((1 << size) - 1);
    acc >>>= size;
    nacc -= size;
    if (code === clear) { size = minBits + 1; next = eoi + 1; old = -1; continue; }
    if (code === eoi) break;
    if (old === -1) { out[o++] = suffix[code]; old = code; first = code; continue; }
    const incode = code;
    let sp = 0;
    if (code >= next) { stack[sp++] = first; code = old; }
    while (code >= clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
    first = suffix[code];
    stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = old;
      suffix[next] = first;
      next++;
      if ((next & ((1 << size) - 1)) === 0 && next < 4096) size++;
    }
    old = incode;
    while (sp > 0 && o < out.length) out[o++] = stack[--sp];
  }
}

/** Pictures are composed one at a time, so a caller can stop early; each yielded rgba is its own copy. */
export function* gifFrames(b: Uint8Array): Generator<GifFrame, void, undefined> {
  if (!isGif(b)) throw new Error('not a GIF');
  let p = 6;
  const u16 = (): number => { const v = b[p] | (b[p + 1] << 8); p += 2; return v; };
  const width = u16();
  const height = u16();
  const flags = b[p++];
  p += 2; // background index, aspect
  let gct: Uint8Array | null = null;
  if (flags & 0x80) {
    const n = 3 * (1 << ((flags & 7) + 1));
    gct = b.subarray(p, p + n);
    p += n;
  }
  if (!width || !height) throw new Error('empty GIF');
  const canvas = new Uint8ClampedArray(width * height * 4);
  let delay = 100;
  let transparent = -1;
  let disposal = 0;

  while (p < b.length) {
    const tag = b[p++];
    if (tag === 0x3b) break;
    if (tag === 0x21) {
      const label = b[p++];
      if (label === 0xf9) {
        const pf = b[p + 1];
        disposal = (pf >> 2) & 7;
        delay = (b[p + 2] | (b[p + 3] << 8)) * 10;
        transparent = pf & 1 ? b[p + 4] : -1;
      }
      while (p < b.length && b[p] !== 0) p += b[p] + 1;
      p++;
      continue;
    }
    if (tag !== 0x2c) break;
    const ix = u16(); const iy = u16(); const iw = u16(); const ih = u16();
    const pf = b[p++];
    let ct = gct;
    if (pf & 0x80) {
      const n = 3 * (1 << ((pf & 7) + 1));
      ct = b.subarray(p, p + n);
      p += n;
    }
    const interlaced = (pf & 0x40) !== 0;
    const minBits = b[p++];
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (p < b.length && b[p] !== 0) { chunks.push(b.subarray(p + 1, p + 1 + b[p])); total += b[p]; p += b[p] + 1; }
    p++;
    const data = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { data.set(c, at); at += c.length; }
    const idx = new Uint8Array(iw * ih);
    lzw(Math.max(2, Math.min(8, minBits)), data, idx);

    const backup = disposal === 3 ? canvas.slice() : null;
    // row order for interlaced images
    const rowOf = (r: number): number => {
      if (!interlaced) return r;
      const pass1 = Math.ceil(ih / 8);
      const pass2 = Math.ceil(Math.max(0, ih - 4) / 8);
      const pass3 = Math.ceil(Math.max(0, ih - 2) / 4);
      if (r < pass1) return r * 8;
      if (r < pass1 + pass2) return (r - pass1) * 8 + 4;
      if (r < pass1 + pass2 + pass3) return (r - pass1 - pass2) * 4 + 2;
      return (r - pass1 - pass2 - pass3) * 2 + 1;
    };
    for (let r = 0; r < ih; r++) {
      const y = iy + rowOf(r);
      if (y >= height) continue;
      for (let x = 0; x < iw; x++) {
        const px = ix + x;
        if (px >= width) break;
        const k = idx[r * iw + x];
        if (k === transparent || !ct) continue;
        const d = (y * width + px) * 4;
        canvas[d] = ct[k * 3]; canvas[d + 1] = ct[k * 3 + 1]; canvas[d + 2] = ct[k * 3 + 2]; canvas[d + 3] = 255;
      }
    }
    yield { rgba: canvas.slice(), delayMs: delay <= 10 ? 100 : delay };

    if (disposal === 2) {
      for (let y = iy; y < Math.min(height, iy + ih); y++) {
        for (let x = ix; x < Math.min(width, ix + iw); x++) canvas.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
      }
    } else if (disposal === 3 && backup) {
      canvas.set(backup);
    }
    disposal = 0;
    transparent = -1;
    delay = 100;
  }
}

/** Size and picture count from the block structure alone (no LZW), so an importer can budget before decoding. */
export function gifInfo(b: Uint8Array): { width: number; height: number; count: number } {
  if (!isGif(b)) throw new Error('not a GIF');
  const width = b[6] | (b[7] << 8);
  const height = b[8] | (b[9] << 8);
  if (!width || !height) throw new Error('empty GIF');
  let p = 13;
  if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));
  const skip = (): void => { while (p < b.length && b[p] !== 0) p += b[p] + 1; p++; };
  let count = 0;
  while (p < b.length) {
    const tag = b[p++];
    if (tag === 0x3b) break;
    if (tag === 0x21) { p++; skip(); continue; }
    if (tag !== 0x2c) break;
    p += 8;
    const pf = b[p++];
    if (pf & 0x80) p += 3 * (1 << ((pf & 7) + 1));
    p++;
    skip();
    count++;
  }
  return { width, height, count };
}

export function decodeGif(b: Uint8Array): Gif {
  const { width, height } = gifInfo(b);
  const frames = [...gifFrames(b)];
  if (!frames.length) throw new Error('GIF has no pictures');
  return { width, height, frames };
}
