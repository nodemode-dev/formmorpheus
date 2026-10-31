/** The descriptor reader of brush files (.abr, versions 6 to 10): the tree format the preset settings are stored in, and
 *  the 'phry' folder list. Every value type of the grammar is read; the few types that carry no length (undocumented ones)
 *  cannot be skipped, so on one of those the walk stops and what was read so far is kept (the caller is told via `error`).
 *  All integers are big-endian. Limits on depth and node count keep a hostile file from running away. */

export interface UnitVal { u: string; v: number }
export interface EnumVal { t: string; e: string }
export interface DescNode { cls: string; items: Map<string, DescValue> }
export type DescValue = number | boolean | string | UnitVal | EnumVal | DescNode | DescValue[] | null;

export function isNode(v: unknown): v is DescNode { return !!v && typeof v === 'object' && 'items' in (v as object) && 'cls' in (v as object); }
export function isUnit(v: unknown): v is UnitVal { return !!v && typeof v === 'object' && 'u' in (v as object) && 'v' in (v as object); }
export function isEnum(v: unknown): v is EnumVal { return !!v && typeof v === 'object' && 'e' in (v as object) && 't' in (v as object); }

const MAX_DEPTH = 24, MAX_NODES = 400_000;

/** One descriptor at `pos` (just past the u32 version). Returns the tree read; `error` is set when the walk stopped early. */
export function readDescriptor(v: DataView, pos: number, end = v.byteLength): { root: DescNode; error: string | null } {
  let p = pos, nodes = 0;
  const root: DescNode = { cls: '', items: new Map() };
  const need = (n: number): void => { if (n < 0 || p + n > end) throw new RangeError('descriptor ran past its section'); };
  const u32 = (): number => { need(4); const x = v.getUint32(p); p += 4; return x; };
  const i32 = (): number => { need(4); const x = v.getInt32(p); p += 4; return x; };
  const u8 = (): number => { need(1); return v.getUint8(p++); };
  const f64 = (): number => { need(8); const x = v.getFloat64(p); p += 8; return x; };
  const four = (): string => { need(4); const s = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3)); p += 4; return s; };
  const key = (): string => {
    const n = u32() || 4;
    if (n > 256) throw new RangeError('bad key length');
    need(n);
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(p + i));
    p += n;
    return s;
  };
  const text = (): string => {
    const n = u32();
    need(n * 2);
    let s = '';
    for (let i = 0; i < n; i++) { const c = v.getUint16(p + i * 2); if (c) s += String.fromCharCode(c); }
    p += n * 2;
    return s;
  };
  const skipBytes = (): void => { const n = u32(); need(n); p += n; };

  /** Reads a value of `type`, handing it to `set` as soon as a container exists, so a failure keeps the partial tree. */
  const value = (type: string, set: (x: DescValue) => void, depth: number): void => {
    if (depth > MAX_DEPTH) throw new RangeError('descriptor too deep');
    if (++nodes > MAX_NODES) throw new RangeError('descriptor too large');
    switch (type) {
      case 'Objc': case 'GlbO': {
        const node: DescNode = { cls: '', items: new Map() };
        set(node);
        fillNode(node, depth);
        return;
      }
      case 'VlLs': {
        const arr: DescValue[] = [];
        set(arr);
        const n = u32();
        if (n > end - p) throw new RangeError('bad list length');
        for (let i = 0; i < n; i++) value(four(), (x) => { arr.push(x); }, depth + 1);
        return;
      }
      case 'doub': set(f64()); return;
      case 'UntF': { const u = four(); set({ u, v: f64() }); return; }
      case 'UnFl': { const u = four(), n = u32(); if (n * 8 > end - p) throw new RangeError('bad list length'); const arr: DescValue[] = []; set(arr); for (let i = 0; i < n; i++) arr.push({ u, v: f64() }); return; }
      case 'long': set(i32()); return;
      case 'comp': { need(8); set(Number(v.getBigInt64(p))); p += 8; return; }
      case 'bool': set(u8() !== 0); return;
      case 'TEXT': set(text()); return;
      case 'enum': { const t = key(), e = key(); set({ t, e }); return; }
      case 'type': case 'GlbC': { text(); set(key()); return; }
      case 'tdta': case 'alis': skipBytes(); set(null); return;
      case 'Pth ': skipBytes(); set(null); return;
      case 'obj ': {
        const n = u32();
        if (n > 4096) throw new RangeError('bad reference');
        for (let i = 0; i < n; i++) {
          const t = four();
          switch (t) {
            case 'prop': text(); key(); key(); break;
            case 'Clss': text(); key(); break;
            case 'Enmr': text(); key(); key(); key(); break;
            case 'rele': text(); key(); u32(); break;
            case 'Idnt': case 'indx': u32(); break;
            case 'name': text(); key(); text(); break;
            default: throw new RangeError('unknown reference item');
          }
        }
        set(null);
        return;
      }
      default: throw new RangeError(`unknown descriptor type ${type}`);
    }
  };
  const fillNode = (node: DescNode, depth: number): void => {
    text();
    node.cls = key();
    const n = u32();
    if (n > end - p) throw new RangeError('bad item count');
    for (let i = 0; i < n; i++) {
      const k = key(), t = four();
      value(t, (x) => { node.items.set(k, x); }, depth + 1);
    }
  };

  let error: string | null = null;
  try { fillNode(root, 0); } catch (e) { error = e instanceof Error ? e.message : 'unreadable descriptor'; }
  return { root, error };
}

// ---- getters ----------------------------------------------------------------

/** A number from a plain number or a unit value (percent stays 0..100, angle in degrees, pixels as is). */
export function numOf(x: DescValue | undefined): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (isUnit(x)) return Number.isFinite(x.v) ? x.v : null;
  return null;
}
export function textOf(x: DescValue | undefined): string | null { return typeof x === 'string' ? x : null; }
export function boolOf(x: DescValue | undefined): boolean | null { return typeof x === 'boolean' ? x : null; }

/** A dynamics group (size, angle, roundness, count, scatter, texture depth, colour, opacity, flow): control, fade steps, jitter, minimum. */
export interface Dyn { control: number; steps: number; jitter: number; min: number }
export function dynOf(x: DescValue | undefined): Dyn | null {
  if (!isNode(x)) return null;
  const g = (k: string, d: number): number => numOf(x.items.get(k)) ?? d;
  return { control: g('bVTy', 0), steps: g('fStp', 25), jitter: g('jitter', 0), min: g('Mnm ', 0) };
}

/** Folder path of each preset, from a 'phry' section (the descriptor starts just past its u32 version). `count` is how many presets it lists. */
export function readPhry(v: DataView, start: number, end: number): { paths: string[][]; error: string | null } {
  const { root, error } = readDescriptor(v, start, end);
  const list = root.items.get('hierarchy');
  const paths: string[][] = [];
  if (Array.isArray(list)) {
    const stack: string[] = [];
    for (const it of list) {
      if (!isNode(it)) continue;
      if (it.cls === 'Grup') stack.push((textOf(it.items.get('Nm  ')) ?? '').trim());
      else if (it.cls === 'groupEnd') stack.pop();
      else if (it.cls === 'preset') paths.push(stack.filter((s) => s));
    }
  }
  return { paths, error };
}
