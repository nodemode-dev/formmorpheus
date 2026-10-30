// Truevision TGA reader: colour-mapped, true-colour and grey pictures, raw or run-length packed, 8 to 32 bits, either origin.
// Pure bytes in, RGBA bytes out (straight alpha). A TGA has no signature at the start, so the footer or a strict header check decides.

export interface TgaPicture { width: number; height: number; rgba: Uint8ClampedArray }

const TYPES = new Set([1, 2, 3, 9, 10, 11]);

/** The 18-byte header is plausible for a picture this reader can decode. */
function headerOk(b: Uint8Array): boolean {
  if (b.length < 18) return false;
  const cmType = b[1], type = b[2], bits = b[16];
  const w = b[12] | (b[13] << 8), h = b[14] | (b[15] << 8);
  if (!TYPES.has(type) || cmType > 1 || !w || !h) return false;
  if ((type === 1 || type === 9) !== (cmType === 1)) return false;
  if (type === 3 || type === 11) return bits === 8 || bits === 16;
  if (type === 1 || type === 9) return bits === 8 || bits === 16;
  return bits === 15 || bits === 16 || bits === 24 || bits === 32;
}

export function isTga(b: Uint8Array, name = ''): boolean {
  if (!headerOk(b)) return false;
  // new-format files end with this footer; old ones are told apart by the name
  const tail = b.subarray(Math.max(0, b.length - 18));
  const footer = new TextDecoder('latin1').decode(tail);
  return footer.startsWith('TRUEVISION-XFILE') || /\.(tga|targa|icb|vda|vst)$/i.test(name);
}

export function decodeTga(b: Uint8Array): TgaPicture {
  if (!headerOk(b)) throw new Error('not a picture of a kind this reader knows');
  const idLen = b[0], cmType = b[1], type = b[2];
  const cmFirst = b[3] | (b[4] << 8), cmLen = b[5] | (b[6] << 8), cmBits = b[7];
  const width = b[12] | (b[13] << 8), height = b[14] | (b[15] << 8), bits = b[16], desc = b[17];
  if (width * height > 268435456) throw new Error('the picture is too large');
  const alphaBits = desc & 15;
  const bpp = (bits + 7) >> 3;
  let at = 18 + idLen;

  // colour map entries as RGBA
  let map: Uint8Array | null = null;
  if (cmType === 1) {
    const eb = (cmBits + 7) >> 3;
    map = new Uint8Array(cmLen * 4);
    for (let i = 0; i < cmLen; i++) writeColour(b, at + i * eb, cmBits, map, i * 4, alphaBits > 0 || cmBits === 32);
    at += cmLen * eb;
  }

  const total = width * height;
  const raw = new Uint8Array(total * bpp);
  const packed = type >= 9;
  if (!packed) {
    if (at + raw.length > b.length) throw new Error('the picture data ends early');
    raw.set(b.subarray(at, at + raw.length));
  } else {
    let o = 0;
    while (o < raw.length && at < b.length) {
      const c = b[at++], n = (c & 127) + 1;
      if (c & 128) {
        if (at + bpp > b.length) break;
        for (let k = 0; k < n && o < raw.length; k++) for (let j = 0; j < bpp; j++) raw[o++] = b[at + j];
        at += bpp;
      } else {
        const len = Math.min(n * bpp, raw.length - o, b.length - at);
        raw.set(b.subarray(at, at + len), o);
        o += len;
        at += len;
      }
    }
    if (o < raw.length) throw new Error('the picture data ends early');
  }

  const rgba = new Uint8ClampedArray(total * 4);
  const grey = type === 3 || type === 11;
  const hasAlpha = alphaBits > 0 && bits === 32 || (bits === 16 && !grey && alphaBits > 0 && cmType === 0);
  const topFirst = (desc & 0x20) !== 0, rightFirst = (desc & 0x10) !== 0;
  for (let y = 0; y < height; y++) {
    const dy = topFirst ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const dx = rightFirst ? width - 1 - x : x;
      const s = (y * width + x) * bpp, d = (dy * width + dx) * 4;
      if (map) {
        const idx = (bpp === 1 ? raw[s] : raw[s] | (raw[s + 1] << 8)) - cmFirst;
        const m = Math.max(0, Math.min(cmLen - 1, idx)) * 4;
        rgba[d] = map[m]; rgba[d + 1] = map[m + 1]; rgba[d + 2] = map[m + 2]; rgba[d + 3] = map[m + 3];
      } else if (grey) {
        const g = raw[s];
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g;
        rgba[d + 3] = bpp === 2 ? raw[s + 1] : 255;
      } else {
        writeColour(raw, s, bits, rgba, d, hasAlpha);
      }
    }
  }
  // 32-bit files from tools that leave the attribute byte at 0 are meant opaque
  if (bits === 32 && !hasAlpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width, height, rgba };
}

function writeColour(src: Uint8Array, s: number, bits: number, dst: Uint8Array | Uint8ClampedArray, d: number, alpha: boolean): void {
  if (bits === 15 || bits === 16) {
    const v = src[s] | (src[s + 1] << 8);
    dst[d] = ((v >> 10) & 31) * 255 / 31 + 0.5;
    dst[d + 1] = ((v >> 5) & 31) * 255 / 31 + 0.5;
    dst[d + 2] = (v & 31) * 255 / 31 + 0.5;
    dst[d + 3] = bits === 16 && alpha ? (v & 0x8000 ? 255 : 0) : 255;
  } else {
    dst[d] = src[s + 2]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s];
    dst[d + 3] = bits === 32 && alpha ? src[s + 3] : 255;
  }
}
