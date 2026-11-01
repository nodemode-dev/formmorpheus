// A font collection (.ttc) holds several faces that share tables. Browsers load one face per file, so each face is
// copied out into a plain sfnt file of its own; every face then registers under its own family name.

const u32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];

export const isCollection = (b: Uint8Array): boolean => b.length > 16 && b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 && b[3] === 0x66;

/** The faces of a collection as separate font files (an empty list when the header is damaged). */
export function splitCollection(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  if (!isCollection(b)) return out;
  const count = Math.min(u32(b, 8), 64);
  for (let i = 0; i < count; i++) {
    try {
      const at = u32(b, 12 + i * 4);
      const n = u16(b, at + 4);
      if (!n || at + 12 + n * 16 > b.length) continue;
      let size = 12 + n * 16;
      const recs: Array<{ rec: number; off: number; len: number; to: number }> = [];
      for (let k = 0; k < n; k++) {
        const rec = at + 12 + k * 16, off = u32(b, rec + 8), len = u32(b, rec + 12);
        if (off + len > b.length) throw new Error('table past the end');
        recs.push({ rec, off, len, to: size });
        size += (len + 3) & ~3;
      }
      const f = new Uint8Array(size);
      f.set(b.subarray(at, at + 12 + n * 16));
      const dv = new DataView(f.buffer);
      recs.forEach((r, k) => {
        f.set(b.subarray(r.off, r.off + r.len), r.to);
        dv.setUint32(12 + k * 16 + 8, r.to);
      });
      out.push(f);
    } catch { /* a face that cannot be cut out is left out */ }
  }
  return out;
}
