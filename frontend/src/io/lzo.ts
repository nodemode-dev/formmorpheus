// Block decompressors for the tile files of a `.procreate` artwork document: LZO1X (the older `.chunk` tiles) and the LZ4
// block format inside Apple's framing (the newer `.lz4` tiles). Written from the public descriptions of both formats;
// both write into a buffer of the size the caller knows, so a damaged or hostile tile can never grow memory.

/** LZO1X decompression of a stream with no header, into exactly `outLen` bytes (shorter output is zero-filled). Throws on damage. */
export function lzo1xDecompress(src: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  let ip = 0, op = 0;
  const n = src.length;
  const need = (k: number): void => { if (ip + k > n) throw new Error('lzo: input ends early'); };
  const lits = (k: number): void => {
    if (k < 0 || ip + k > n || op + k > outLen) throw new Error('lzo: literal run out of range');
    for (let i = 0; i < k; i++) out[op++] = src[ip++];
  };
  const copy = (dist: number, len: number): void => {
    if (dist < 1 || dist > op || op + len > outLen) throw new Error('lzo: match out of range');
    let from = op - dist;
    for (let i = 0; i < len; i++) out[op++] = out[from++];
  };
  /** Extra length bytes: a run of zeros adds 255 each, the first non-zero byte ends it. */
  const ext = (base: number): number => {
    let t = 0;
    for (;;) { need(1); if (src[ip] !== 0) break; t += 255; ip++; if (t > 1 << 24) throw new Error('lzo: length too long'); }
    return t + base + src[ip++];
  };
  // state: 0 = the next small opcode starts a literal run; 1..3 = a match was followed by that many literals (the next
  // small opcode is a two-byte match); 4 = a long literal run just ended (the next small opcode is a three-byte match)
  let state = 0;
  need(1);
  if (src[0] > 17) {
    const k = src[ip++] - 17;
    lits(k);
    state = k < 4 ? k : 4;
  }
  for (;;) {
    need(1);
    const t = src[ip++];
    if (t < 16) {
      if (state === 0) {
        const k = (t === 0 ? ext(15) : t) + 3;
        lits(k);
        state = 4;
        continue;
      }
      need(1);
      const b = src[ip++];
      if (state === 4) copy(1 + 0x0800 + (t >> 2) + (b << 2), 3);
      else copy(1 + (t >> 2) + (b << 2), 2);
      const next = t & 3;
      lits(next);
      state = next;
      continue;
    }
    let dist: number, len: number, next: number;
    if (t >= 64) {
      need(1);
      dist = 1 + ((t >> 2) & 7) + (src[ip++] << 3);
      len = (t >> 5) + 1;
      next = t & 3;
    } else if (t >= 32) {
      len = (t & 31) === 0 ? ext(31) + 2 : (t & 31) + 2;
      need(2);
      const v = src[ip] | (src[ip + 1] << 8);
      ip += 2;
      dist = 1 + (v >> 2);
      next = v & 3;
    } else {
      len = (t & 7) === 0 ? ext(7) + 2 : (t & 7) + 2;
      need(2);
      const v = src[ip] | (src[ip + 1] << 8);
      ip += 2;
      const far = ((t & 8) << 11) + (v >> 2);
      if (far === 0) break;   // the end-of-stream marker (11 00 00)
      dist = far + 0x4000;
      next = v & 3;
    }
    copy(dist, len);
    lits(next);
    state = next;
  }
  return out;
}

/** One LZ4 block into `out` at `op`, matches may reach back into earlier output (the chained dictionary). Returns the new end. */
function lz4Block(src: Uint8Array, ip: number, end: number, out: Uint8Array, op: number): number {
  const cap = out.length;
  while (ip < end) {
    const token = src[ip++];
    let lit = token >> 4;
    if (lit === 15) { let b: number; do { if (ip >= end) throw new Error('lz4: input ends early'); b = src[ip++]; lit += b; } while (b === 255); }
    if (ip + lit > end || op + lit > cap) throw new Error('lz4: literal run out of range');
    for (let i = 0; i < lit; i++) out[op++] = src[ip++];
    if (ip >= end) break;
    if (ip + 2 > end) throw new Error('lz4: input ends early');
    const dist = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    let len = token & 15;
    if (len === 15) { let b: number; do { if (ip >= end) throw new Error('lz4: input ends early'); b = src[ip++]; len += b; } while (b === 255); }
    len += 4;
    if (dist < 1 || dist > op || op + len > cap) throw new Error('lz4: match out of range');
    let from = op - dist;
    for (let i = 0; i < len; i++) out[op++] = out[from++];
  }
  return op;
}

/** Apple's LZ4 framing: blocks marked `bv41` (decoded size, encoded size, data), `bv4-` (stored) and an end mark `bv4$`. */
export function lz4FrameDecompress(src: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const tag = (at: number): string => String.fromCharCode(src[at], src[at + 1], src[at + 2], src[at + 3]);
  let ip = 0, op = 0;
  while (ip + 4 <= src.length) {
    const m = tag(ip);
    if (m === 'bv4$') break;
    if (m === 'bv41') {
      if (ip + 12 > src.length) throw new Error('lz4: block header cut short');
      const raw = dv.getUint32(ip + 4, true), packed = dv.getUint32(ip + 8, true);
      ip += 12;
      if (ip + packed > src.length || op + raw > outLen) throw new Error('lz4: block out of range');
      const done = lz4Block(src, ip, ip + packed, out, op);
      if (done !== op + raw) throw new Error('lz4: block size differs from its header');
      op = done;
      ip += packed;
    } else if (m === 'bv4-') {
      if (ip + 8 > src.length) throw new Error('lz4: block header cut short');
      const raw = dv.getUint32(ip + 4, true);
      ip += 8;
      if (ip + raw > src.length || op + raw > outLen) throw new Error('lz4: block out of range');
      out.set(src.subarray(ip, ip + raw), op);
      op += raw;
      ip += raw;
    } else throw new Error('lz4: unknown block mark');
  }
  return out;
}
