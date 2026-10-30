// Binary property list writer (bplist00), the counterpart of the reader in brush-import.ts.
// The layout (header, objects, offset table, 32-byte trailer, type markers) follows Apple's published
// property list format. Supported values: null, boolean, number (non-negative integers as ints, everything
// else as 8-byte reals), string (ASCII or UTF-16BE), Uint8Array (data), arrays, plain objects (string keys)
// and Uid (the references an NSKeyedArchiver graph is made of). Pure: no DOM.

export class Uid { constructor(readonly n: number) {} }

export type PlistValue = null | boolean | number | string | Uint8Array | Uid | PlistValue[] | { [key: string]: PlistValue };

const byteLen = (n: number): number => (n < 0x100 ? 1 : n < 0x10000 ? 2 : n < 0x100000000 ? 4 : 8);

export function writeBinaryPlist(root: PlistValue): Uint8Array {
  // Objects are numbered once each; equal strings and numbers share a slot like Apple's own writer does.
  const nodes: PlistValue[] = [];
  const seen = new Map<string, number>();
  const refs = new Map<number, number[]>();
  const add = (v: PlistValue): number => {
    let key: string | null = null;
    if (typeof v === 'string') key = `s:${v}`;
    else if (typeof v === 'number') key = `n:${Object.is(v, -0) ? 0 : v}`;
    else if (typeof v === 'boolean') key = `b:${v}`;
    else if (v === null) key = 'z';
    if (key !== null) { const hit = seen.get(key); if (hit !== undefined) return hit; }
    const idx = nodes.length;
    nodes.push(v);
    if (key !== null) seen.set(key, idx);
    if (Array.isArray(v)) refs.set(idx, v.map(add));
    else if (v && typeof v === 'object' && !(v instanceof Uint8Array) && !(v instanceof Uid)) {
      const keys = Object.keys(v);
      refs.set(idx, [...keys.map(add), ...keys.map((k) => add((v as { [key: string]: PlistValue })[k]))]);
    }
    return idx;
  };
  add(root);
  const refSize = byteLen(nodes.length);

  const out: number[] = [];
  const bytes = (n: number, size: number): void => { for (let i = size - 1; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) % 256); };
  const head = (marker: number, len: number): void => {
    if (len < 15) { out.push((marker << 4) | len); return; }
    out.push((marker << 4) | 15);
    const s = byteLen(len);
    out.push(0x10 | Math.log2(s));
    bytes(len, s);
  };
  const f64 = (x: number): void => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x); for (const v of b) out.push(v); };

  for (const c of 'bplist00') out.push(c.charCodeAt(0));
  const offsets: number[] = [];
  nodes.forEach((v, i) => {
    offsets.push(out.length);
    if (v === null) out.push(0x00);
    else if (typeof v === 'boolean') out.push(v ? 0x09 : 0x08);
    else if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER) {
        const s = v < 0x100 ? 1 : v < 0x10000 ? 2 : v < 0x100000000 ? 4 : 8;
        out.push(0x10 | Math.log2(s));
        bytes(v, s);
      } else { out.push(0x23); f64(v); }
    } else if (typeof v === 'string') {
      if (/^[\x00-\x7f]*$/.test(v)) { head(5, v.length); for (let k = 0; k < v.length; k++) out.push(v.charCodeAt(k)); }
      else { head(6, v.length); for (let k = 0; k < v.length; k++) bytes(v.charCodeAt(k), 2); }
    } else if (v instanceof Uint8Array) { head(4, v.length); for (let k = 0; k < v.length; k++) out.push(v[k]); }
    else if (v instanceof Uid) { const s = byteLen(v.n); out.push(0x80 | (s - 1)); bytes(v.n, s); }
    else if (Array.isArray(v)) { head(0xa, v.length); for (const r of refs.get(i) ?? []) bytes(r, refSize); }
    else { head(0xd, Object.keys(v).length); for (const r of refs.get(i) ?? []) bytes(r, refSize); }
  });

  const tableAt = out.length;
  const offSize = byteLen(tableAt);
  for (const o of offsets) bytes(o, offSize);
  for (let i = 0; i < 6; i++) out.push(0);
  out.push(offSize, refSize);
  bytes(nodes.length, 8);
  bytes(0, 8);
  bytes(tableAt, 8);
  return Uint8Array.from(out);
}
