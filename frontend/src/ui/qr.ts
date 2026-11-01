// A small QR code encoder: byte mode, error correction level M, versions 1 to 10 (up to 213 bytes), all eight masks
// tried and the best kept. No dependencies. `qrMatrix` gives the modules; `drawQr` paints them on a canvas.

// per version 1..10 at level M: [error-correction codewords per block, blocks of the first size, data codewords of
// the first size, blocks of the second size, data codewords of the second size]
const M_BLOCKS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
];
const ALIGN: ReadonlyArray<readonly number[]> = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// ---- Reed-Solomon over GF(256), polynomial 0x11D ----------------------------------

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a: number, b: number): number => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsRemainder(data: number[], degree: number): number[] {
  // generator: the product of (x - a^i), i = 0 .. degree - 1
  let gen = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) { next[j + 1] ^= gen[j]; next[j] ^= gmul(gen[j], EXP[i]); }
    gen = next;
  }
  // gen is lowest degree first and monic at the end
  const rem = new Array<number>(degree).fill(0);
  for (const b of data) {
    const f = b ^ rem[0];
    rem.shift(); rem.push(0);
    if (f) for (let i = 0; i < degree; i++) rem[i] ^= gmul(gen[degree - 1 - i], f);
  }
  return rem;
}

// ---- data codewords -------------------------------------------------------------------

function capacity(version: number): number {
  const [, b1, d1, b2, d2] = M_BLOCKS[version - 1];
  return b1 * d1 + b2 * d2;
}

function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number): void => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = capacity(version) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; out.push(v); }
  for (let pad = 0xec; out.length < capacity(version); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data: number[], version: number): number[] {
  const [ec, b1, d1, b2, d2] = M_BLOCKS[version - 1];
  const blocks: { d: number[]; e: number[] }[] = [];
  let at = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const n = i < b1 ? d1 : d2, d = data.slice(at, at + n);
    at += n;
    blocks.push({ d, e: rsRemainder(d, ec) });
  }
  const out: number[] = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

// ---- the matrix ------------------------------------------------------------------------------

class Grid {
  readonly size: number;
  readonly m: boolean[][];
  readonly fn: boolean[][];
  constructor(readonly version: number) {
    this.size = 17 + 4 * version;
    this.m = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  private set(x: number, y: number, dark: boolean): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.m[y][x] = dark; this.fn[y][x] = true;
  }
  private finder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); this.set(cx + dx, cy + dy, d !== 2 && d !== 4); }
  }
  drawFunction(): void {
    const s = this.size;
    for (let i = 0; i < s; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(s - 4, 3); this.finder(3, s - 4);
    const pos = ALIGN[this.version - 1], last = pos.length - 1;
    for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    this.format(0);
    if (this.version >= 7) {
      let rem = this.version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) !== 0, a = s - 11 + (i % 3), b = Math.floor(i / 3);
        this.set(a, b, dark); this.set(b, a, dark);
      }
    }
  }
  /** Format bits: level M is 00, then the mask number. */
  format(mask: number): void {
    const s = this.size, data = mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6)); this.set(8, 8, bit(7)); this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true);
  }
  place(words: number[]): void {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? s - 1 - vert : vert;
        if (!this.fn[y][x] && i < words.length * 8) { this.m[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
  }
  mask(k: number): void {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      let on: boolean;
      switch (k) {
        case 0: on = (x + y) % 2 === 0; break;
        case 1: on = y % 2 === 0; break;
        case 2: on = x % 3 === 0; break;
        case 3: on = (x + y) % 3 === 0; break;
        case 4: on = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: on = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: on = ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0; break;
        default: on = ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0; break;
      }
      if (on && !this.fn[y][x]) this.m[y][x] = !this.m[y][x];
    }
  }
  penalty(): number {
    const s = this.size, m = this.m;
    let score = 0;
    const line = (get: (i: number) => boolean): void => {
      let run = 1;
      for (let i = 1; i < s; i++) {
        if (get(i) === get(i - 1)) run++;
        else { if (run >= 5) score += 3 + run - 5; run = 1; }
      }
      if (run >= 5) score += 3 + run - 5;
      // 1:1:3:1:1 with four light modules on a side
      const str = Array.from({ length: s }, (_, i) => (get(i) ? '1' : '0')).join('');
      for (const pat of ['10111010000', '00001011101']) for (let at = str.indexOf(pat); at >= 0; at = str.indexOf(pat, at + 1)) score += 40;
    };
    for (let y = 0; y < s; y++) line((i) => m[y][i]);
    for (let x = 0; x < s; x++) line((i) => m[i][x]);
    let dark = 0;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      if (m[y][x]) dark++;
      if (x + 1 < s && y + 1 < s && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
    const total = s * s;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

/** The modules of a QR code for `text` (dark is true), or null when it does not fit in version 10. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const need = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
    if (need <= capacity(v) * 8) { version = v; break; }
  }
  if (!version) return null;
  const words = interleave(dataCodewords(bytes, version), version);
  const g = new Grid(version);
  g.drawFunction();
  g.place(words);
  let best = 0, bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    g.mask(k); g.format(k);
    const p = g.penalty();
    if (p < bestScore) { bestScore = p; best = k; }
    g.mask(k);
  }
  g.mask(best); g.format(best);
  return g.m;
}

/** Paints the code for `text` on `cv` (dark on light, four modules of quiet zone). Returns false when it does not fit. */
export function drawQr(cv: HTMLCanvasElement, text: string, px: number): boolean {
  const m = qrMatrix(text);
  const ctx = cv.getContext('2d');
  if (!m || !ctx) return false;
  const n = m.length + 8, k = Math.max(1, Math.floor(px / n));
  if (cv.width !== n * k) { cv.width = n * k; cv.height = n * k; }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#000000';
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (m[y][x]) ctx.fillRect((x + 4) * k, (y + 4) * k, k, k);
  return true;
}
