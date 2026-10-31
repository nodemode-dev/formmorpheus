// Rich titles: styled runs, shadow, background box and the build on / build off animators of a Text block.
// Types and the per-character style lookup only; layout is in text-layout.ts and the animator maths in text-anim.ts. Pure, no DOM.
import type { Ease, TextStyle } from './types';

/** A span of the text (UTF-16 offsets, `to` exclusive) with its own look; each field set overrides the block's. */
export interface TextRun {
  from: number;
  to: number;
  font?: string;
  size?: number;
  weight?: number;
  color?: string;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Letter spacing in thousandths of an em. */
  tracking?: number;
  /** Baseline shift in movie pixels (positive raises the span). */
  baseline?: number;
  /** Outline of the span; a width of 0 switches the block's outline off for it. */
  stroke?: { color: string; width: number };
}

export interface TextShadow {
  color: string;
  /** Direction the shadow falls, degrees (0 right, 90 down). */
  angle: number;
  /** Distance in movie pixels. */
  distance: number;
  /** Blur radius in movie pixels. */
  blur: number;
  /** 0..1 (default 0.6). */
  opacity?: number;
}

export interface TextBoxFx {
  color: string;
  /** Room around the letters in movie pixels. */
  padding: number;
  radius: number;
  opacity: number;
  /** One box per line, or one for the whole block. */
  mode: 'line' | 'block';
}

export type AnimUnit = 'char' | 'word' | 'line';
export type AnimOrder = 'forward' | 'backward' | 'center' | 'random';
export type AnimDir = 'up' | 'down' | 'left' | 'right';

/** One side (build on or build off) of the animators. Frames are movie frames. */
export interface TextAnimSide {
  unit: AnimUnit;
  fade: boolean;
  slide?: { dir: AnimDir; dist: number };
  /** Scale of a unit while it is hidden (1: none). */
  scale?: number;
  /** Turn of a unit while it is hidden, degrees. */
  rotate?: number;
  /** Blur of a unit while it is hidden, movie pixels. */
  blur?: number;
  /** Frames one unit takes. */
  dur: number;
  /** Frames between the starts of two units. */
  stagger: number;
  order: AnimOrder;
  seed: number;
  ease: Ease;
  /** In: frames after the block starts. Out: frames before the block ends that the last unit finishes. */
  offset: number;
}

export interface TextType {
  /** Characters per second. */
  cps: number;
  cursor: boolean;
  /** Frames after the block starts. */
  offset: number;
  /** Erase at the end, back to front. */
  erase?: boolean;
  /** Frames before the block ends that the erasing finishes. */
  eraseOffset?: number;
}

export interface TextAnim {
  in?: TextAnimSide;
  out?: TextAnimSide;
  type?: TextType;
}

/** The look of one character after the block's style and the runs are folded together. */
export interface EffStyle {
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  color: string;
  underline: boolean;
  strike: boolean;
  tracking: number;
  baseline: number;
  stroke: { color: string; width: number } | null;
}

export const baseEff = (s: TextStyle): EffStyle => ({
  font: s.font, size: s.size, weight: s.weight, italic: !!s.italic, color: s.color, underline: !!s.underline, strike: !!s.strike,
  tracking: s.tracking ?? 0, baseline: 0, stroke: s.stroke && s.stroke.width > 0 ? s.stroke : null,
});

export const hasRuns = (s: TextStyle): boolean => !!s.runs && s.runs.some((r) => r.to > r.from);

export interface Looks {
  /** Distinct looks; index 0 is the block's own. */
  list: EffStyle[];
  /** Per UTF-16 offset: index into `list` (null when the text has no runs: everything is 0). */
  at: Uint16Array | null;
}

const lookCache = new WeakMap<TextStyle, Looks>();

/** Folds the runs into one look per character (runs apply in order, a later run wins). Cached per style object. */
export function looksOf(s: TextStyle): Looks {
  const have = lookCache.get(s);
  if (have) return have;
  const base = baseEff(s);
  let out: Looks;
  if (!hasRuns(s)) out = { list: [base], at: null };
  else {
    const n = s.text.length, at = new Uint16Array(n + 1), list = [base], keys = new Map<string, number>([[JSON.stringify(base), 0]]);
    const cur: EffStyle[] = new Array(n + 1);
    for (let i = 0; i <= n; i++) cur[i] = base;
    for (const r of s.runs as TextRun[]) {
      const a = Math.max(0, Math.min(n, r.from)), b = Math.max(a, Math.min(n, r.to));
      for (let i = a; i < b; i++) {
        const e = { ...cur[i] };
        if (r.font !== undefined) e.font = r.font;
        if (r.size !== undefined) e.size = r.size;
        if (r.weight !== undefined) e.weight = r.weight;
        if (r.color !== undefined) e.color = r.color;
        if (r.italic !== undefined) e.italic = r.italic;
        if (r.underline !== undefined) e.underline = r.underline;
        if (r.strike !== undefined) e.strike = r.strike;
        if (r.tracking !== undefined) e.tracking = r.tracking;
        if (r.baseline !== undefined) e.baseline = r.baseline;
        if (r.stroke !== undefined) e.stroke = r.stroke.width > 0 ? r.stroke : null;
        cur[i] = e;
      }
    }
    for (let i = 0; i <= n; i++) {
      const k = JSON.stringify(cur[i]);
      let id = keys.get(k);
      if (id === undefined) { id = list.length; list.push(cur[i]); keys.set(k, id); }
      at[i] = id;
    }
    out = { list, at };
  }
  lookCache.set(s, out);
  return out;
}

/** Edits the text inside the runs: offsets after `at` move by `delta` (typing in the middle keeps spans where they were). */
export function shiftRuns(runs: TextRun[] | undefined, at: number, removed: number, added: number): TextRun[] | undefined {
  if (!runs || !runs.length) return runs;
  const delta = added - removed, endCut = at + removed;
  const out: TextRun[] = [];
  for (const r of runs) {
    let from = r.from, to = r.to;
    if (from >= endCut) from += delta; else if (from > at) from = at + added;
    if (to >= endCut) to += delta; else if (to > at) to = at;
    // text typed inside a span joins the span
    if (r.from < at && r.to > at && removed === 0) to = r.to + added;
    if (to > from) out.push({ ...r, from, to });
  }
  return out.length ? out : undefined;
}

/** The change between two strings as the common prefix and suffix cut. */
export function diffText(a: string, b: string): { at: number; removed: number; added: number } {
  let p = 0;
  const m = Math.min(a.length, b.length);
  while (p < m && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < m - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { at: p, removed: a.length - p - s, added: b.length - p - s };
}

/** Sets (or, with `undefined`, clears) one field over [from,to) by splitting the runs there. */
export function paintRun(runs: TextRun[] | undefined, from: number, to: number, patch: Partial<Omit<TextRun, 'from' | 'to'>>): TextRun[] | undefined {
  if (to <= from) return runs;
  const list: TextRun[] = [];
  for (const r of runs ?? []) {
    if (r.to <= from || r.from >= to) { list.push(r); continue; }
    if (r.from < from) list.push({ ...r, to: from });
    if (r.to > to) list.push({ ...r, from: to });
    const mid: TextRun = { ...r, from: Math.max(r.from, from), to: Math.min(r.to, to) };
    list.push(mid);
  }
  // cover the gaps with fresh runs, then apply the patch to everything inside the range
  let pos = from;
  const inside = list.filter((r) => r.from >= from && r.to <= to).sort((a, b) => a.from - b.from);
  for (const r of inside) { if (r.from > pos) list.push({ from: pos, to: r.from }); pos = Math.max(pos, r.to); }
  if (pos < to) list.push({ from: pos, to });
  for (const r of list) {
    if (r.from >= from && r.to <= to) {
      for (const k of Object.keys(patch) as Array<keyof typeof patch>) {
        if (patch[k] === undefined) delete (r as unknown as Record<string, unknown>)[k];
        else (r as unknown as Record<string, unknown>)[k] = patch[k];
      }
    }
  }
  const merged = list.filter((r) => r.to > r.from && Object.keys(r).length > 2).sort((a, b) => a.from - b.from);
  // join neighbours that carry the same look
  const out: TextRun[] = [];
  for (const r of merged) {
    const last = out[out.length - 1];
    const { from: f, to: t, ...rest } = r;
    void f; void t;
    if (last && last.to === r.from) {
      const { from: f2, to: t2, ...lrest } = last;
      void f2; void t2;
      if (JSON.stringify(lrest) === JSON.stringify(rest)) { last.to = r.to; continue; }
    }
    out.push({ ...r });
  }
  return out.length ? out : undefined;
}

/** The value a field has over [from,to): the shared value, or undefined when it differs (or is the block's). */
export function runValue<K extends keyof Omit<TextRun, 'from' | 'to'>>(s: TextStyle, from: number, to: number, key: K): TextRun[K] | undefined {
  let v: TextRun[K] | undefined;
  let first = true;
  const L = looksOf(s);
  const eff = (i: number): EffStyle => L.list[L.at ? L.at[i] : 0];
  for (let i = from; i < to; i++) {
    const e = eff(i) as unknown as Record<string, unknown>;
    const x = e[key as string] as TextRun[K];
    if (first) { v = x; first = false; } else if (JSON.stringify(v) !== JSON.stringify(x)) return undefined;
  }
  return v;
}

export const DEFAULT_SIDE: TextAnimSide = { unit: 'char', fade: true, dur: 8, stagger: 2, order: 'forward', seed: 1, ease: 'out', offset: 0 };
