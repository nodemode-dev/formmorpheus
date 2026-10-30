// One text layout for everything that needs to know where Text sits: the CPU draw, the GPU text texture, the Warp and Distort
// rectangle, the Stage box and the inline editor. Pure maths over an OffscreenCanvas measurer (no DOM).
import type { Movie, TextStyle } from './types';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface TextRect { x: number; y: number; w: number; h: number }
/** One positioned run: `x` is its left edge, `y` the middle of its line, `size` its own size (small capitals are smaller). */
export interface TextPart { text: string; x: number; y: number; size: number; w: number }
export interface TextLine { y: number; x0: number; x1: number; parts: TextPart[] }
export interface TextLayout {
  /** The text block itself, without padding (what the Stage box and the wrap nodes show). */
  inner: TextRect;
  /** The inner block plus room for overhang and outline (what Warp, Distort and the GPU texture cover). */
  box: TextRect;
  lines: TextLine[];
  /** Distance from a line's middle to its baseline. */
  base: number;
  pad: number;
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
interface Tok { t: string; size: number; w: number; kern: number }

/** Case and small capitals: lower case letters become capitals at a smaller size. */
function pieces(s: TextStyle, line: string): Array<{ t: string; size: number }> {
  if (s.caps === 'upper') return [{ t: line.toUpperCase(), size: s.size }];
  if (s.caps === 'lower') return [{ t: line.toLowerCase(), size: s.size }];
  if (s.caps !== 'small') return [{ t: line, size: s.size }];
  const out: Array<{ t: string; size: number }> = [];
  for (const ch of line) {
    const lower = ch !== ch.toUpperCase();
    const size = lower ? s.size * SMALL_CAP_SCALE : s.size, t = lower ? ch.toUpperCase() : ch;
    const last = out[out.length - 1];
    if (last && last.size === size) last.t += t; else out.push({ t, size });
  }
  return out;
}

function tokens(c: Ctx, s: TextStyle, line: string, split: boolean): Tok[] {
  const out: Tok[] = [];
  const f48 = s.kerning === 'optical' ? fontCss(s, S48) : '';
  for (const p of pieces(s, line)) {
    c.font = fontCss(s, p.size);
    const parts = s.kerning === 'optical' ? Array.from(p.t) : split ? p.t.match(/\S+|\s+/g) ?? [] : [p.t];
    for (const t of parts) {
      const prev = out[out.length - 1];
      if (prev && f48) prev.kern = opticalKern(f48, Array.from(prev.t).pop() as string, t, p.size);
      out.push({ t, size: p.size, w: c.measureText(t).width, kern: 0 });
    }
  }
  return out;
}

function widthOf(c: Ctx, s: TextStyle, line: string): number {
  let w = 0;
  const ts = tokens(c, s, line, false);
  for (const k of ts) w += k.w + k.kern;
  return ts.length ? w - trackPx(s) : 0;
}

const CJK = '\\u3000-\\u9fff\\uff00-\\uffef';
const BREAKS = new RegExp(`[^\\s${CJK}]+|[${CJK}]|\\s+`, 'g');

/** Greedy wrap of one paragraph to `max`; an over-long word breaks between letters. */
function wrap(c: Ctx, s: TextStyle, para: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  // width of `cur` as drawn (trailing spaces included), kept by adding each piece's own width: a piece is measured once, not the whole line again
  let curW = 0;
  const track = trackPx(s);
  const flush = (): void => { out.push(cur.replace(/\s+$/, '')); cur = ''; curW = 0; };
  for (const piece of para.match(BREAKS) ?? ['']) {
    const blank = /^\s+$/.test(piece);
    if (!cur && blank) continue;
    const pw = widthOf(c, s, piece);
    // trailing spaces never count against the line
    const fits = !cur || blank || curW + pw + track <= max;
    if (fits) { curW = cur ? curW + pw + track : pw; cur += piece; }
    else { flush(); cur = piece; curW = pw; }
    if (curW > max && cur.length > 1) {
      // an over-long word breaks between letters: the longest prefix that fits, found by halving
      while (cur.length > 1 && widthOf(c, s, cur) > max) {
        const chars = Array.from(cur);
        let lo = 1, hi = chars.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (widthOf(c, s, chars.slice(0, mid).join('')) <= max) lo = mid; else hi = mid - 1;
        }
        out.push(chars.slice(0, lo).join(''));
        cur = chars.slice(lo).join('');
      }
      curW = widthOf(c, s, cur);
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
  const strokeW = s.stroke ? s.stroke.width : 0;
  const pad = s.size * 0.4 + strokeW;
  const paras = s.text.split('\n');
  const fallback = (): TextLayout => {
    const w = Math.max(...paras.map((l) => l.length), 1) * s.size * 0.6, h = paras.length * lh;
    const inner = { x: W / 2 - w / 2, y: H / 2 - h / 2 - shift, w, h };
    return { inner, box: { x: inner.x - pad, y: inner.y - pad, w: w + pad * 2, h: h + pad * 2 }, lines: [], base: s.size * 0.35, pad };
  };
  if (!c) return fallback();
  c.save();
  c.font = fontCss(s);
  setSpacing(c, s);
  const fa = c.measureText('Hg');
  const base = fa.fontBoundingBoxAscent !== undefined ? (fa.fontBoundingBoxAscent - fa.fontBoundingBoxDescent) / 2 : s.size * 0.35;
  const lines: TextLine[] = [];
  let inner: TextRect;

  if (s.vertical) {
    const step = s.size + trackPx(s);
    const cols = paras.map((p) => Array.from(s.caps === 'upper' ? p.toUpperCase() : s.caps === 'lower' ? p.toLowerCase() : p));
    const n = cols.length, longest = Math.max(1, ...cols.map((x) => x.length));
    const iw = n * lh, ih = longest * step;
    inner = { x: W / 2 - iw / 2, y: H / 2 - ih / 2 - shift, w: iw, h: ih };
    cols.forEach((chars, i) => {
      const cx = inner.x + iw - (i + 0.5) * lh, len = chars.length * step;
      const top = s.align === 'right' ? inner.y + ih - len : s.align === 'center' ? inner.y + (ih - len) / 2 : inner.y;
      const parts = chars.map((ch, j) => {
        c.font = fontCss(s);
        const w = c.measureText(ch).width;
        return { text: ch, x: cx - w / 2, y: top + (j + 0.5) * step, size: s.size, w };
      });
      lines.push({ y: cx, x0: cx, x1: cx, parts });
    });
  } else {
    const wide = s.boxW && s.boxW > 0 ? s.boxW : 0;
    const rows: Array<{ text: string; last: boolean }> = [];
    for (const p of paras) {
      const ls = wide ? wrap(c, s, p, wide) : [p];
      ls.forEach((t, i) => rows.push({ text: t, last: i === ls.length - 1 }));
    }
    const widths = rows.map((r) => widthOf(c, s, r.text));
    const iw = wide || Math.max(0, ...widths);
    const ih = rows.length * lh;
    const justify = s.align === 'justify';
    const ix = wide ? W / 2 - wide / 2 : s.align === 'right' ? W * 0.9 - iw : s.align === 'center' ? W / 2 - iw / 2 : W * 0.1;
    inner = { x: ix, y: H / 2 - ih / 2 - shift, w: iw, h: ih };
    rows.forEach((r, i) => {
      const y = inner.y + (i + 0.5) * lh;
      const spaced = justify && !r.last && /\s/.test(r.text.trim());
      const ts = tokens(c, s, r.text, spaced);
      const spaces = spaced ? ts.filter((k) => /^\s+$/.test(k.t)).length : 0;
      const extra = spaces ? Math.max(0, iw - widths[i]) / spaces : 0;
      const lw = widths[i] + extra * spaces;
      let x = s.align === 'center' ? ix + (iw - lw) / 2 : s.align === 'right' ? ix + iw - lw : ix;
      const x0 = x;
      const parts: TextPart[] = [];
      const track = trackPx(s);
      for (const k of ts) {
        if (k.t.trim() || !spaced) parts.push({ text: k.t, x, y, size: k.size, w: k.w });
        x += k.w + k.kern + (spaced && /^\s+$/.test(k.t) ? extra : 0);
      }
      lines.push({ y, x0, x1: Math.max(x0, x - (ts.length ? track : 0)), parts });
    });
  }
  c.restore();
  return { inner, box: { x: inner.x - pad, y: inner.y - pad, w: inner.w + pad * 2, h: inner.h + pad * 2 }, lines, base, pad };
}

/** Paints a layout (made by `layoutText` for the same style) in the style's colour. */
export function paintText(ctx: Ctx, s: TextStyle, lay: TextLayout): void {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  setSpacing(ctx, s);
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const stroke = s.stroke && s.stroke.width > 0 ? s.stroke : null;
  const run = (strokePass: boolean): void => {
    for (const l of lay.lines) for (const p of l.parts) {
      ctx.font = fontCss(s, p.size);
      if (strokePass) ctx.strokeText(p.text, p.x, p.y); else ctx.fillText(p.text, p.x, p.y);
    }
  };
  if (stroke) { ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width * 2; run(true); }
  ctx.fillStyle = s.color;
  run(false);
  if ((s.underline || s.strike) && !s.vertical) {
    const th = Math.max(1, s.size / 18);
    for (const l of lay.lines) {
      if (l.x1 <= l.x0) continue;
      if (s.underline) ctx.fillRect(l.x0, l.y + lay.base + s.size * 0.12 - th / 2, l.x1 - l.x0, th);
      if (s.strike) ctx.fillRect(l.x0, l.y + lay.base - s.size * 0.28 - th / 2, l.x1 - l.x0, th);
    }
  }
  ctx.restore();
}
