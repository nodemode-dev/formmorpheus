// One text layout for everything that needs to know where Text sits: the CPU draw, the GPU text texture, the Warp and Distort
// rectangle, the Stage box and the inline editor. Pure maths over an OffscreenCanvas measurer (no DOM).
import type { Movie, TextStyle } from './types';
import { evalAnim, sideSpan, type GlyphBox, type TextPhase } from './text-anim';
import { hasRuns, looksOf, type EffStyle, type Looks } from './text-rich';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface TextRect { x: number; y: number; w: number; h: number }
/** One positioned run: `x` is its left edge, `y` the middle of its line (moved by a run's baseline shift), `size` its own size (small capitals are smaller). `e` is its look (Looks.list) and `i` the offset of its first character in the text. */
export interface TextPart { text: string; x: number; y: number; size: number; w: number; e: number; i: number }
export interface TextLine { y: number; x0: number; x1: number; parts: TextPart[] }
/** One drawn letter: where it sits, for the animators and the editor's caret. `i` is its offset in the text. */
export interface TextGlyph extends GlyphBox { t: string; e: number; i: number; sp?: boolean }
export interface TextLayout {
  /** The text block itself, without padding (what the Stage box and the wrap nodes show). */
  inner: TextRect;
  /** The inner block plus room for overhang, outline, shadow, box and the animators (what Warp, Distort and the GPU texture cover). */
  box: TextRect;
  lines: TextLine[];
  /** Distance from a line's middle to its baseline at the block's size. */
  base: number;
  pad: number;
  looks: Looks;
  /** Height of each line (its largest letter times the leading). */
  heights: number[];
  /** Letters in reading order; made on first use. */
  glyphs?: TextGlyph[];
  /** Every character (spaces too) in reading order, for the caret and selection of the inline editor; made on first use. */
  chars?: TextGlyph[];
}

const SMALL_CAP_SCALE = 0.8;
// Per-glyph fallback for scripts Inter lacks; the faces load lazily (media/font-bundle.ts)
const SCRIPT_FALLBACK = '"Noto Sans", "Noto Sans Arabic", "Noto Sans JP", "Noto Sans SC", "Noto Sans KR", "Noto Sans Thai", "Noto Sans Devanagari"';
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

/** Bumped when a font finishes loading so cached text pictures are drawn again. */
let epoch = 0;
export const fontEpoch = (): number => epoch;
export function bumpFontEpoch(): void { epoch++; }

export function fontCss(s: TextStyle, size: number = s.size): string {
  const fam = GENERIC.has(s.font) ? s.font : JSON.stringify(s.font);
  return `${s.italic ? 'italic ' : ''}${s.weight} ${size}px ${fam}, Inter, ${SCRIPT_FALLBACK}, sans-serif`;
}

/** CSS font of one look at `size`. */
export const effFont = (e: EffStyle, size: number = e.size): string => fontCss({ font: e.font, weight: e.weight, italic: e.italic } as TextStyle, size);
const trackOf = (e: EffStyle): number => (e.tracking / 1000) * e.size;

let mctx: OffscreenCanvasRenderingContext2D | null | undefined;
function measurer(): OffscreenCanvasRenderingContext2D | null {
  if (mctx === undefined) mctx = typeof OffscreenCanvas === 'undefined' ? null : (new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null);
  return mctx;
}

const trackPx = (s: TextStyle): number => ((s.tracking ?? 0) / 1000) * s.size;
export const lineHeight = (s: TextStyle): number => s.size * (s.leading ?? 1.2);

function setSpacing(c: Ctx, s: TextStyle): void {
  const x = c as unknown as { letterSpacing?: string; fontKerning?: string };
  if ('letterSpacing' in x) x.letterSpacing = `${trackPx(s)}px`;
  if ('fontKerning' in x) x.fontKerning = s.kerning ? 'none' : 'auto';
}

// ---- optical kerning (measured from the letter shapes, cached per pair) ----
const S48 = 48;
interface Edges { adv: number; left: Array<number | null>; right: Array<number | null> }
const edges = new Map<string, Edges>();
function glyphEdges(font48: string, ch: string): Edges {
  const key = `${font48}|${ch}`, have = edges.get(key);
  if (have) return have;
  const w = Math.ceil(S48 * 2.5), h = Math.ceil(S48 * 1.5), ox = S48 / 2, baseY = S48;
  const cv = new OffscreenCanvas(w, h);
  const c = cv.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  c.font = font48;
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#000';
  c.fillText(ch, ox, baseY);
  const adv = c.measureText(ch).width, top = Math.round(baseY - S48 * 0.72), bottom = Math.round(baseY + S48 * 0.02);
  const data = c.getImageData(0, 0, w, h).data, left: Array<number | null> = [], right: Array<number | null> = [];
  for (let y = top; y < bottom; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 96) { if (lo < 0) lo = x; hi = x + 1; }
    left.push(lo < 0 ? null : lo - ox);
    right.push(hi < 0 ? null : hi - ox);
  }
  const e = { adv, left, right };
  edges.set(key, e);
  return e;
}
function opticalGap(font48: string, a: string, b: string): number {
  const ea = glyphEdges(font48, a), eb = glyphEdges(font48, b), cap = S48 * 0.3;
  let sum = 0, n = 0;
  for (let i = 0; i < ea.left.length; i++) {
    const r = ea.right[i], l = eb.left[i];
    if (r === null && l === null) continue;
    sum += Math.min(2 * cap, (r === null ? cap : ea.adv - r) + (l === null ? cap : l));
    n += 1;
  }
  return n ? sum / n : 2 * cap;
}
const pairs = new Map<string, number>();
/** Optical kerning between two characters in pixels at `size`; spaces add nothing. */
function opticalKern(font48: string, a: string, b: string, size: number): number {
  if (/\s/.test(a) || /\s/.test(b)) return 0;
  const key = `${font48}|${a}|${b}`, have = pairs.get(key);
  if (have !== undefined) return have * (size / S48);
  const adj = Math.max(-0.2 * S48, Math.min(0.1 * S48, (opticalGap(font48, 'n', 'n') - opticalGap(font48, a, b)) * 0.5));
  pairs.set(key, adj);
  return adj * (size / S48);
}

// ---- tokens: the pieces a line is drawn in ----
interface Tok { t: string; size: number; w: number; kern: number; e: number; i: number }

/** Case and small capitals: lower case letters become capitals at a smaller size. */
function pieces(s: TextStyle, line: string, size: number): Array<{ t: string; size: number }> {
  if (s.caps === 'upper') return [{ t: line.toUpperCase(), size }];
  if (s.caps === 'lower') return [{ t: line.toLowerCase(), size }];
  if (s.caps !== 'small') return [{ t: line, size }];
  const out: Array<{ t: string; size: number }> = [];
  for (const ch of line) {
    const lower = ch !== ch.toUpperCase();
    const sz = lower ? size * SMALL_CAP_SCALE : size, t = lower ? ch.toUpperCase() : ch;
    const last = out[out.length - 1];
    if (last && last.size === sz) last.t += t; else out.push({ t, size: sz });
  }
  return out;
}

/** The pieces a line (starting at offset `off` of the text) is drawn in: one run of equal look at a time. */
function tokens(c: Ctx, s: TextStyle, L: Looks, line: string, off: number, split: boolean): Tok[] {
  const out: Tok[] = [];
  const optical = s.kerning === 'optical';
  // cut the line where the look changes
  const segs: Array<{ e: number; from: number; to: number }> = [];
  for (let k = 0; k < line.length; k++) {
    const e = L.at ? L.at[off + k] : 0, last = segs[segs.length - 1];
    if (last && last.e === e) last.to = k + 1; else segs.push({ e, from: k, to: k + 1 });
  }
  for (const sg of segs) {
    const look = L.list[sg.e], f48 = optical ? effFont(look, S48) : '';
    (c as unknown as { letterSpacing?: string }).letterSpacing = `${trackOf(look)}px`;
    let pos = sg.from;
    for (const p of pieces(s, line.slice(sg.from, sg.to), look.size)) {
      c.font = effFont(look, p.size);
      const parts = optical ? Array.from(p.t) : split ? p.t.match(/\S+|\s+/g) ?? [] : [p.t];
      for (const t of parts) {
        const prev = out[out.length - 1];
        if (prev && f48) prev.kern = opticalKern(f48, Array.from(prev.t).pop() as string, t, p.size);
        out.push({ t, size: p.size, w: c.measureText(t).width, kern: 0, e: sg.e, i: off + pos });
        pos += t.length;
      }
    }
  }
  return out;
}

function widthOf(c: Ctx, s: TextStyle, L: Looks, line: string, off: number): number {
  let w = 0;
  const ts = tokens(c, s, L, line, off, false);
  for (const k of ts) w += k.w + k.kern;
  return ts.length ? w - trackOf(L.list[ts[ts.length - 1].e]) : 0;
}

const CJK = '\\u3000-\\u9fff\\uff00-\\uffef';
const BREAKS = new RegExp(`[^\\s${CJK}]+|[${CJK}]|\\s+`, 'g');

/** Greedy wrap of one paragraph to `max`; an over-long word breaks between letters. */
function wrap(c: Ctx, s: TextStyle, L: Looks, para: string, paraOff: number, max: number): Array<{ text: string; off: number }> {
  const out: Array<{ text: string; off: number }> = [];
  let cur = '', curOff = paraOff;
  // width of `cur` as drawn (trailing spaces included), kept by adding each piece's own width: a piece is measured once, not the whole line again
  let curW = 0;
  const flush = (): void => { out.push({ text: cur.replace(/\s+$/, ''), off: curOff }); cur = ''; curW = 0; };
  const base = trackPx(s);
  let at = 0;
  for (const piece of para.match(BREAKS) ?? ['']) {
    const pOff = paraOff + at;
    at += piece.length;
    const blank = /^\s+$/.test(piece);
    if (!cur && blank) continue;
    const pw = widthOf(c, s, L, piece, pOff);
    // trailing spaces never count against the line
    const track = L.at ? trackOf(L.list[L.at[pOff]]) : base;
    const fits = !cur || blank || curW + pw + track <= max;
    if (fits) { if (!cur) curOff = pOff; curW = cur ? curW + pw + track : pw; cur += piece; }
    else { flush(); cur = piece; curOff = pOff; curW = pw; }
    if (curW > max && cur.length > 1) {
      // an over-long word breaks between letters: the longest prefix that fits, found by halving
      while (cur.length > 1 && widthOf(c, s, L, cur, curOff) > max) {
        const chars = Array.from(cur);
        let lo = 1, hi = chars.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (widthOf(c, s, L, chars.slice(0, mid).join(''), curOff) <= max) lo = mid; else hi = mid - 1;
        }
        const head = chars.slice(0, lo).join('');
        out.push({ text: head, off: curOff });
        cur = chars.slice(lo).join('');
        curOff += head.length;
      }
      curW = widthOf(c, s, L, cur, curOff);
    }
  }
  if (cur || !out.length) flush();
  return out;
}

/** Layouts kept per style + text + movie size + font load count (a few hundred bytes each); a layout is read-only for its callers. */
const layoutCache = new Map<string, TextLayout>();
const LAYOUT_CAP = 64;

/** Where every run of the Text sits in movie pixels (cached per style, text and movie size until a font loads). */
export function layoutText(s: TextStyle, movie: Movie): TextLayout {
  const key = `${epoch}|${movie.width}x${movie.height}|${JSON.stringify(s)}`;
  const have = layoutCache.get(key);
  if (have) { layoutCache.delete(key); layoutCache.set(key, have); return have; }
  const lay = layoutNow(s, movie);
  layoutCache.set(key, lay);
  if (layoutCache.size > LAYOUT_CAP) layoutCache.delete(layoutCache.keys().next().value as string);
  return lay;
}

function layoutNow(s: TextStyle, movie: Movie): TextLayout {
  const c = measurer();
  const W = movie.width, H = movie.height;
  const lh = lineHeight(s), shift = s.baseline ?? 0;
  const L = looksOf(s);
  let maxSize = s.size, strokeW = s.stroke ? s.stroke.width : 0;
  for (const e of L.list) { maxSize = Math.max(maxSize, e.size); strokeW = Math.max(strokeW, e.stroke ? e.stroke.width : 0); }
  let pad = maxSize * 0.4 + strokeW;
  if (L.list.length > 1) pad += Math.max(0, ...L.list.map((e) => Math.abs(e.baseline)));
  if (s.shadow) pad += s.shadow.distance + s.shadow.blur * 2;
  if (s.box) pad += s.box.padding;
  if (s.anim) pad += animReach(s);
  const leading = s.leading ?? 1.2;
  const paras = s.text.split('\n');
  const fallback = (): TextLayout => {
    const w = Math.max(...paras.map((l) => l.length), 1) * s.size * 0.6, h = paras.length * lh;
    const inner = { x: W / 2 - w / 2, y: H / 2 - h / 2 - shift, w, h };
    return { inner, box: { x: inner.x - pad, y: inner.y - pad, w: w + pad * 2, h: h + pad * 2 }, lines: [], base: s.size * 0.35, pad, looks: L, heights: paras.map(() => lh) };
  };
  if (!c) return fallback();
  c.save();
  c.font = fontCss(s);
  setSpacing(c, s);
  const fa = c.measureText('Hg');
  const base = fa.fontBoundingBoxAscent !== undefined ? (fa.fontBoundingBoxAscent - fa.fontBoundingBoxDescent) / 2 : s.size * 0.35;
  const lines: TextLine[] = [];
  let inner: TextRect;
  let heights: number[] = [];
  const pOffs: number[] = [];
  { let o = 0; for (const p of paras) { pOffs.push(o); o += p.length + 1; } }

  if (s.vertical) {
    const step = s.size + trackPx(s);
    const cols = paras.map((p) => Array.from(s.caps === 'upper' ? p.toUpperCase() : s.caps === 'lower' ? p.toLowerCase() : p));
    const n = cols.length, longest = Math.max(1, ...cols.map((x) => x.length));
    const iw = n * lh, ih = longest * step;
    inner = { x: W / 2 - iw / 2, y: H / 2 - ih / 2 - shift, w: iw, h: ih };
    heights = cols.map(() => lh);
    cols.forEach((chars, i) => {
      const cx = inner.x + iw - (i + 0.5) * lh, len = chars.length * step;
      const top = s.align === 'right' ? inner.y + ih - len : s.align === 'center' ? inner.y + (ih - len) / 2 : inner.y;
      const parts = chars.map((ch, j) => {
        c.font = fontCss(s);
        const w = c.measureText(ch).width;
        return { text: ch, x: cx - w / 2, y: top + (j + 0.5) * step, size: s.size, w, e: 0, i: pOffs[i] + j };
      });
      lines.push({ y: cx, x0: cx, x1: cx, parts });
    });
  } else {
    const wide = s.boxW && s.boxW > 0 ? s.boxW : 0;
    const rows: Array<{ text: string; off: number; last: boolean }> = [];
    paras.forEach((p, pi) => {
      const ls = wide ? wrap(c, s, L, p, pOffs[pi], wide) : [{ text: p, off: pOffs[pi] }];
      ls.forEach((t, i) => rows.push({ text: t.text, off: t.off, last: i === ls.length - 1 }));
    });
    const widths = rows.map((r) => widthOf(c, s, L, r.text, r.off));
    // a line is as tall as its largest letter; its baseline is shared by every letter on it
    const rowSize = rows.map((r) => {
      let m = L.list[L.at ? L.at[Math.min(r.off, s.text.length)] : 0].size;
      if (L.at) for (let k = 0; k < r.text.length; k++) m = Math.max(m, L.list[L.at[r.off + k]].size);
      return m;
    });
    heights = rowSize.map((z) => z * leading);
    const iw = wide || Math.max(0, ...widths);
    const ih = heights.reduce((a, b) => a + b, 0);
    const justify = s.align === 'justify';
    const ix = wide ? W / 2 - wide / 2 : s.align === 'right' ? W * 0.9 - iw : s.align === 'center' ? W / 2 - iw / 2 : W * 0.1;
    inner = { x: ix, y: H / 2 - ih / 2 - shift, w: iw, h: ih };
    let top = inner.y;
    rows.forEach((r, i) => {
      const y = top + heights[i] / 2;
      top += heights[i];
      const spaced = justify && !r.last && /\s/.test(r.text.trim());
      const ts = tokens(c, s, L, r.text, r.off, spaced);
      const spaces = spaced ? ts.filter((k) => /^\s+$/.test(k.t)).length : 0;
      const extra = spaces ? Math.max(0, iw - widths[i]) / spaces : 0;
      const lw = widths[i] + extra * spaces;
      let x = s.align === 'center' ? ix + (iw - lw) / 2 : s.align === 'right' ? ix + iw - lw : ix;
      const x0 = x;
      const parts: TextPart[] = [];
      const track = ts.length ? trackOf(L.list[ts[ts.length - 1].e]) : 0;
      // letters of different sizes share one baseline: a letter's middle sits half its own height above it
      const lineBase = base * (rowSize[i] / s.size);
      for (const k of ts) {
        const look = L.list[k.e];
        const py = y + lineBase - base * (look.size / s.size) - look.baseline;
        if (k.t.trim() || !spaced) parts.push({ text: k.t, x, y: py, size: k.size, w: k.w, e: k.e, i: k.i });
        x += k.w + k.kern + (spaced && /^\s+$/.test(k.t) ? extra : 0);
      }
      lines.push({ y, x0, x1: Math.max(x0, x - (ts.length ? track : 0)), parts });
    });
  }
  c.restore();
  return { inner, box: { x: inner.x - pad, y: inner.y - pad, w: inner.w + pad * 2, h: inner.h + pad * 2 }, lines, base, pad, looks: L, heights };
}

/** How far the animators move a letter beyond its resting place (room the text picture needs). */
function animReach(s: TextStyle): number {
  let r = 0;
  for (const side of [s.anim?.in, s.anim?.out]) {
    if (!side) continue;
    r = Math.max(r, side.slide ? side.slide.dist : 0, s.size * Math.max(0, (side.scale ?? 1) - 1), side.rotate ? s.size * 0.6 : 0, (side.blur ?? 0) * 3);
  }
  return r;
}

const rgba = (hex: string, a: number): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const noShadow = (ctx: Ctx): void => { ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

/** Canvas shadows live in device pixels: the movie-pixel distance and blur are carried through the current matrix. */
function shadowVec(ctx: Ctx, s: TextStyle): { color: string; blur: number; x: number; y: number } | null {
  const sh = s.shadow;
  if (!sh) return null;
  const m = ctx.getTransform(), r = (sh.angle * Math.PI) / 180, dx = Math.cos(r) * sh.distance, dy = Math.sin(r) * sh.distance;
  return { color: rgba(sh.color, sh.opacity ?? 0.6), blur: sh.blur * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)), x: m.a * dx + m.c * dy, y: m.b * dx + m.d * dy };
}

function useShadow(ctx: Ctx, v: ReturnType<typeof shadowVec>, on: boolean): void {
  if (!v || !on) { noShadow(ctx); return; }
  ctx.shadowColor = v.color;
  ctx.shadowBlur = v.blur;
  ctx.shadowOffsetX = v.x;
  ctx.shadowOffsetY = v.y;
}

/** The background box behind the text: one path for every line, so overlaps never double the opacity. */
function paintBox(ctx: Ctx, s: TextStyle, lay: TextLayout, lineAlpha: number[] | null): void {
  const b = s.box;
  if (!b) return;
  const top = lineAlpha ? Math.max(0, ...lineAlpha) : 1;
  if (top <= 0.001) return;
  ctx.save();
  ctx.fillStyle = b.color;
  const base = ctx.globalAlpha * b.opacity;
  ctx.globalAlpha = base * top;
  ctx.beginPath();
  const add = (x: number, y: number, w: number, h: number, li = -1): void => {
    const rr = (ctx as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect;
    // per-line boxes build with their own line (the box follows the animator)
    if (li >= 0 && lineAlpha) { ctx.fill(); ctx.beginPath(); ctx.globalAlpha = base * (lineAlpha[li] ?? 0); }
    if (b.radius > 0 && rr) rr.call(ctx, x, y, w, h, Math.min(b.radius, w / 2, h / 2)); else ctx.rect(x, y, w, h);
  };
  const lead = s.leading ?? 1.2, pad = b.padding;
  const live = lay.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.x1 > l.x0 || s.vertical);
  if (s.vertical) add(lay.inner.x - pad, lay.inner.y - pad, lay.inner.w + pad * 2, lay.inner.h + pad * 2);
  else if (b.mode === 'block' && live.length) {
    const first = live[0], last = live[live.length - 1];
    const top = first.l.y - lay.heights[first.i] / lead * 0.55 - pad * 0.5, bot = last.l.y + lay.heights[last.i] / lead * 0.55 + pad * 0.5;
    const x0 = Math.min(...live.map(({ l }) => l.x0)), x1 = Math.max(...live.map(({ l }) => l.x1));
    add(x0 - pad, top, x1 - x0 + pad * 2, bot - top);
  } else for (const { l, i } of live) {
    const half = lay.heights[i] / lead * 0.55 + pad * 0.5;
    add(l.x0 - pad, l.y - half, l.x1 - l.x0 + pad * 2, half * 2, i);
  }
  ctx.fill();
  ctx.restore();
}

/** Letters in reading order with their boxes (made from the layout once and kept on it). */
export function glyphsOf(s: TextStyle, lay: TextLayout): TextGlyph[] {
  if (lay.glyphs) return lay.glyphs;
  const c = measurer(), out: TextGlyph[] = [], all: TextGlyph[] = [];
  lay.lines.forEach((ln, li) => {
    let word = -1, prevSpace = true;
    for (const p of ln.parts) {
      const look = lay.looks.list[p.e];
      if (c) { c.font = effFont(look, p.size); (c as unknown as { letterSpacing?: string }).letterSpacing = `${trackOf(look)}px`; }
      let prefix = '', px = 0, idx = p.i;
      for (const ch of Array.from(p.text)) {
        const pw = c ? c.measureText(prefix + ch).width : px + p.size * 0.6, space = /\s/.test(ch);
        if (!space) {
          if (prevSpace) word++;
          const g = { t: ch, x: p.x + px, y: p.y, w: pw - px, size: p.size, line: li, word, e: p.e, i: idx };
          out.push(g);
          all.push(g);
        } else all.push({ t: ch, x: p.x + px, y: p.y, w: pw - px, size: p.size, line: li, word, e: p.e, i: idx, sp: true });
        prevSpace = space;
        prefix += ch;
        px = pw;
        idx += ch.length;
      }
    }
  });
  void s;
  lay.glyphs = out;
  lay.chars = all;
  return out;
}

/** Whether the animators leave the text as the plain draw would (so the cheaper path is exact). */
export function textSettled(s: TextStyle, lay: TextLayout, ph: TextPhase | null | undefined): boolean {
  if (!s.anim || !ph) return true;
  const r = evalAnim(s.anim, glyphsOf(s, lay), ph);
  return r.settled;
}

/** Frames the in and out animators of the style take (for the lane preview and the card). */
export function animSpans(s: TextStyle, lay: TextLayout): { in: number; out: number } {
  const g = glyphsOf(s, lay);
  const count = (u: 'char' | 'word' | 'line'): number => (u === 'char' ? g.length : new Set(g.map((x) => (u === 'word' ? `${x.line}:${x.word}` : x.line))).size);
  return { in: s.anim?.in ? sideSpan(s.anim.in, count(s.anim.in.unit)) : 0, out: s.anim?.out ? sideSpan(s.anim.out, count(s.anim.out.unit)) : 0 };
}

/** Paints a layout (made by `layoutText` for the same style): box, shadow, outline, fill, lines, then the animators when a phase is given. */
export function paintText(ctx: Ctx, s: TextStyle, lay: TextLayout, ph?: TextPhase | null): void {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const L = lay.looks, runs = hasRuns(s);
  const sv = shadowVec(ctx, s);
  const res = s.anim && ph ? evalAnim(s.anim, glyphsOf(s, lay), ph) : null;
  const animated = !!res && (!res.settled);
  const lineOf = (e: EffStyle, g: { y: number }, x: number, w: number): void => {
    const th = Math.max(1, e.size / 18), baseY = g.y + lay.base * (e.size / s.size);
    ctx.fillStyle = e.color;
    if (e.underline) ctx.fillRect(x, baseY + e.size * 0.12 - th / 2, w, th);
    if (e.strike) ctx.fillRect(x, baseY - e.size * 0.28 - th / 2, w, th);
  };
  if (s.box) {
    let la: number[] | null = null;
    if (res && !res.settled) {
      const gl = glyphsOf(s, lay);
      la = lay.lines.map(() => 0);
      gl.forEach((g, i) => { const f = res.fx[i]; la![g.line] = Math.max(la![g.line], f.show * f.vis); });
      if (s.vertical || s.box.mode === 'block') la = la.map(() => Math.max(0, ...la!));
    }
    paintBox(ctx, s, lay, la);
  }
  if (!animated) {
    for (const pass of [0, 1]) {
      for (const l of lay.lines) for (const p of l.parts) {
        const e = L.list[p.e];
        ctx.font = effFont(e, p.size);
        setSpacingPx(ctx, trackOf(e));
        if (pass === 0) {
          if (!e.stroke) continue;
          ctx.strokeStyle = e.stroke.color;
          ctx.lineWidth = e.stroke.width * 2;
          useShadow(ctx, sv, true);
          ctx.strokeText(p.text, p.x, p.y);
        } else {
          ctx.fillStyle = e.color;
          useShadow(ctx, sv, !e.stroke);
          ctx.fillText(p.text, p.x, p.y);
        }
      }
    }
    noShadow(ctx);
    if (!s.vertical) {
      if (runs) {
        for (const l of lay.lines) for (const p of l.parts) { const e = L.list[p.e]; if (e.underline || e.strike) lineOf(e, p, p.x, p.w); }
      } else if (s.underline || s.strike) {
        const e = L.list[0];
        for (const l of lay.lines) if (l.x1 > l.x0) lineOf(e, l, l.x0, l.x1 - l.x0);
      }
    }
  } else if (res) {
    const gs = glyphsOf(s, lay), canBlur = 'filter' in ctx;
    const place = (i: number, run: () => void): void => {
      const f = res.fx[i], g = gs[i];
      if (!f.vis || f.alpha <= 0.002) return;
      ctx.save();
      ctx.globalAlpha *= Math.min(1, f.alpha);
      if (canBlur && f.blur > 0.05) (ctx as unknown as { filter: string }).filter = `blur(${f.blur * Math.sqrt(Math.abs(ctx.getTransform().a * ctx.getTransform().d)) }px)`;
      ctx.translate(f.cx + f.dx, f.cy + f.dy);
      ctx.rotate((f.rot * Math.PI) / 180);
      ctx.scale(f.scale, f.scale);
      ctx.translate(-f.cx, -f.cy);
      run();
      ctx.restore();
      void g;
    };
    for (const pass of [0, 1]) {
      gs.forEach((g, i) => {
        const e = L.list[g.e];
        place(i, () => {
          ctx.font = effFont(e, g.size);
          setSpacingPx(ctx, 0);
          if (pass === 0) {
            if (!e.stroke) return;
            ctx.strokeStyle = e.stroke.color;
            ctx.lineWidth = e.stroke.width * 2;
            useShadow(ctx, sv, true);
            ctx.strokeText(g.t, g.x, g.y);
          } else {
            ctx.fillStyle = e.color;
            useShadow(ctx, sv, !e.stroke);
            ctx.fillText(g.t, g.x, g.y);
            noShadow(ctx);
            if (!s.vertical && (e.underline || e.strike)) lineOf(e, g, g.x, g.w);
          }
        });
      });
    }
    noShadow(ctx);
    const cu = res.cursor;
    if (cu) {
      const e = L.list[gs[cu.glyph]?.e ?? 0];
      ctx.fillStyle = e.color;
      ctx.fillRect(cu.x + cu.size * 0.04, cu.y - cu.size * 0.55, Math.max(2, cu.size * 0.07), cu.size * 1.1);
    }
  }
  ctx.restore();
}

function setSpacingPx(ctx: Ctx, px: number): void {
  const x = ctx as unknown as { letterSpacing?: string };
  if ('letterSpacing' in x) x.letterSpacing = `${px}px`;
}
