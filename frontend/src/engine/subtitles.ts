// Subtitles: the movie's lines (in movie frames), their one look, the ops that edit them, the timing of spoken sound,
// and the draw over a finished frame. Pure, no DOM; text is measured with the context it is drawn on.
import { uid, locate } from './model';
import { findDeep } from './character-ops';
import { timeKeys } from './retime';
import { fontCss, fontEpoch } from './text-layout';
import type { Content, Movie, SubtitleCue, SubtitleStyle, Subtitles, TextStyle } from './types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type NewCue = Omit<SubtitleCue, 'id'>;

/** A line in seconds (a voice, a listening or a subtitle file). */
export interface TimedLine { start: number; end: number; text: string }

export const SUBTITLE_DEFAULTS: SubtitleStyle = { font: 'Inter', size: 5, position: 'bottom', color: '#ffffff', band: true };

const SIZE_MIN = 2;
const SIZE_MAX = 15;
const POSITIONS: ReadonlyArray<SubtitleStyle['position']> = ['top', 'middle', 'bottom'];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function subtitlesOf(m: Movie): Subtitles {
  return m.subtitles ?? { show: true, style: { ...SUBTITLE_DEFAULTS }, cues: [] };
}

// ---- cleaning ----

const byTime = (a: SubtitleCue, b: SubtitleCue): number => a.start - b.start || a.end - b.end;

/** A cue in whole frames with start >= 0 and at least one frame long, or null when its text is empty or a time is not a number. */
function cleanCue(c: NewCue, id: string): SubtitleCue | null {
  const text = typeof c.text === 'string' ? c.text.trim() : '';
  if (!text || !Number.isFinite(c.start) || !Number.isFinite(c.end)) return null;
  const start = Math.max(0, Math.round(c.start));
  const end = Math.max(start + 1, Math.round(c.end));
  const out: SubtitleCue = { id, start, end, text };
  if (typeof c.from === 'string' && c.from) out.from = c.from;
  return out;
}

const sizeOf = (v: unknown, old: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(v * 10) / 10)) : old;
const fontOf = (v: unknown, old: string): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : old);
const positionOf = (v: unknown, old: SubtitleStyle['position']): SubtitleStyle['position'] =>
  POSITIONS.includes(v as SubtitleStyle['position']) ? (v as SubtitleStyle['position']) : old;
const colorOf = (v: unknown, old: string): string => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : old);
const bandOf = (v: unknown, old: boolean): boolean => (typeof v === 'boolean' ? v : old);

function mergeStyle(old: SubtitleStyle, p: Partial<Record<keyof SubtitleStyle, unknown>>): SubtitleStyle {
  return {
    font: fontOf(p.font, old.font),
    size: sizeOf(p.size, old.size),
    position: positionOf(p.position, old.position),
    color: colorOf(p.color, old.color),
    band: bandOf(p.band, old.band),
  };
}

const sameStyle = (a: SubtitleStyle, b: SubtitleStyle): boolean =>
  a.font === b.font && a.size === b.size && a.position === b.position && a.color === b.color && a.band === b.band;

const sameCue = (a: NewCue, b: NewCue): boolean => a.start === b.start && a.end === b.end && a.text === b.text && a.from === b.from;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** For normalize.ts: a clean copy of what a file holds, or null when it holds nothing a fresh movie would not have. */
export function tidySubtitles(raw: unknown): Subtitles | null {
  if (!isRecord(raw)) return null;
  const style = mergeStyle(SUBTITLE_DEFAULTS, isRecord(raw.style) ? raw.style : {});
  const show = typeof raw.show === 'boolean' ? raw.show : true;
  const seen = new Set<string>();
  const cues: SubtitleCue[] = [];
  for (const r of Array.isArray(raw.cues) ? raw.cues : []) {
    if (!isRecord(r)) continue;
    const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : uid('sb');
    const c = cleanCue({
      start: typeof r.start === 'number' ? r.start : NaN,
      end: typeof r.end === 'number' ? r.end : NaN,
      text: typeof r.text === 'string' ? r.text : '',
      ...(typeof r.from === 'string' ? { from: r.from } : {}),
    }, id);
    if (!c) continue;
    seen.add(id);
    cues.push(c);
  }
  if (!cues.length && show && sameStyle(style, SUBTITLE_DEFAULTS)) return null;
  return { show, style, cues: cues.sort(byTime) };
}

// ---- ops ----

function withSubs(m: Movie, s: Subtitles): Movie {
  return { ...m, subtitles: s };
}

export function setSubtitleShow(m: Movie, on: boolean): Movie {
  const s = subtitlesOf(m);
  if (m.subtitles && s.show === on) return m;
  return withSubs(m, { ...s, show: on });
}

export function setSubtitleStyle(m: Movie, patch: Partial<SubtitleStyle>): Movie {
  const s = subtitlesOf(m);
  const style = mergeStyle(s.style, patch);
  if (sameStyle(style, s.style)) return m;
  return withSubs(m, { ...s, style });
}

function cleanAll(cues: NewCue[]): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  for (const c of cues) { const k = cleanCue(c, uid('sb')); if (k) out.push(k); }
  return out;
}

/** Adds lines, sorted by start; `replaceFrom` first drops the lines made from that sound block. */
export function addCues(m: Movie, cues: NewCue[], replaceFrom?: string): Movie {
  const s = subtitlesOf(m);
  const kept = replaceFrom ? s.cues.filter((c) => c.from !== replaceFrom) : s.cues;
  const added = cleanAll(cues);
  if (!added.length && kept.length === s.cues.length) return m;
  return withSubs(m, { ...s, cues: [...kept, ...added].sort(byTime) });
}

/** Replaces every line. */
export function setCues(m: Movie, cues: NewCue[]): Movie {
  const s = subtitlesOf(m);
  const next = cleanAll(cues).sort(byTime);
  if (next.length === s.cues.length && next.every((c, i) => sameCue(c, s.cues[i]))) return m;
  return withSubs(m, { ...s, cues: next });
}

/** Edits one line; one edited to empty text is removed. */
export function updateCue(m: Movie, id: string, patch: Partial<NewCue>): Movie {
  const s = subtitlesOf(m);
  const i = s.cues.findIndex((c) => c.id === id);
  if (i < 0) return m;
  const old = s.cues[i];
  const merged: NewCue = {
    start: patch.start ?? old.start,
    end: patch.end ?? old.end,
    text: patch.text ?? old.text,
    ...(patch.from !== undefined ? { from: patch.from } : old.from !== undefined ? { from: old.from } : {}),
  };
  // a start moved past the old end carries the line along rather than collapsing it to one frame
  if (patch.start !== undefined && patch.end === undefined && merged.start >= old.end) merged.end = merged.start + (old.end - old.start);
  const c = cleanCue(merged, id);
  if (c && sameCue(c, old)) return m;
  const rest = s.cues.filter((x) => x.id !== id);
  return withSubs(m, { ...s, cues: c ? [...rest, c].sort(byTime) : rest });
}

export function deleteCues(m: Movie, ids: string[]): Movie {
  const s = subtitlesOf(m);
  const drop = new Set(ids);
  const cues = s.cues.filter((c) => !drop.has(c.id));
  if (cues.length === s.cues.length) return m;
  return withSubs(m, { ...s, cues });
}

// ---- sentences and estimated timing ----

const CJK_END = new Set(['。', '！', '？', '｡', '．']);
const ASCII_END = new Set(['.', '!', '?', '…']);
const CLOSERS = new Set(['"', '\'', ')', ']', '}', '”', '’', '」', '』', '）', '》', '〉']);
const MIN_FRAGMENT = 3;

export function splitSentences(text: string): string[] {
  const chars = Array.from(text ?? '');
  const raw: string[] = [];
  let cur = '';
  const flush = (): void => { const t = cur.trim(); if (t) raw.push(t); cur = ''; };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\n' || ch === '\r') { flush(); continue; }
    cur += ch;
    const cjk = CJK_END.has(ch);
    if (!cjk && !ASCII_END.has(ch)) continue;
    // take the whole run of marks and closing quotes with the sentence
    while (i + 1 < chars.length && (CJK_END.has(chars[i + 1]) || ASCII_END.has(chars[i + 1]) || CLOSERS.has(chars[i + 1]))) cur += chars[++i];
    // a Latin mark ends a sentence only before a space or the end, so 3.14 and e.g. stay whole
    const next = chars[i + 1];
    if (cjk || next === undefined || /\s/.test(next)) flush();
  }
  flush();
  const out: string[] = [];
  for (const s of raw) {
    const joint = (a: string, b: string): string => (/[\x21-\x7e]$/.test(a) || /^[\x21-\x7e]/.test(b) ? `${a} ${b}` : `${a}${b}`);
    if (Array.from(s).length < MIN_FRAGMENT && out.length) out[out.length - 1] = joint(out[out.length - 1], s);
    else if (out.length && Array.from(out[out.length - 1]).length < MIN_FRAGMENT) out[out.length - 1] = joint(out[out.length - 1], s);
    else out.push(s);
  }
  return out;
}

const PIECE_MAX = 84;

/** A sentence over PIECE_MAX characters broken at commas (preferred) or spaces into pieces of about that size. */
function pieces(sentence: string): string[] {
  const out: string[] = [];
  let rest = Array.from(sentence);
  while (rest.length > PIECE_MAX) {
    let cut = -1;
    for (let i = PIECE_MAX - 1; i >= Math.floor(PIECE_MAX * 0.4); i--) if (/[,，、;；]/.test(rest[i])) { cut = i + 1; break; }
    if (cut < 0) for (let i = PIECE_MAX; i > 0; i--) if (/\s/.test(rest[i])) { cut = i; break; }
    if (cut <= 0) cut = PIECE_MAX;
    const head = rest.slice(0, cut).join('').trim();
    if (head) out.push(head);
    rest = Array.from(rest.slice(cut).join('').trimStart());
  }
  const tail = rest.join('').trim();
  if (tail) out.push(tail);
  return out;
}

/** No timing known: each sentence (or piece of a long one) gets a share of `seconds` by its length, in order, with no gaps. */
export function estimateLines(text: string, seconds: number): TimedLine[] {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return [];
  const parts = splitSentences(text).flatMap(pieces);
  const lens = parts.map((p) => Math.max(1, Array.from(p).length));
  const total = lens.reduce((a, b) => a + b, 0);
  const out: TimedLine[] = [];
  let at = 0, sum = 0;
  for (let i = 0; i < parts.length; i++) {
    sum += lens[i];
    const end = i === parts.length - 1 ? seconds : (seconds * sum) / total;
    out.push({ start: at, end, text: parts[i] });
    at = end;
  }
  return out;
}

// ---- sound blocks ----

/** The block and the groups around it (outermost first), wherever it sits. */
function findBlock(m: Movie, contentId: string): { c: Content; groups: Content[] } | null {
  const top = locate(m, contentId);
  if (top) return { c: top.content, groups: [] };
  const deep = findDeep(m, contentId);
  return deep ? { c: deep.content, groups: deep.groups } : null;
}

function isSound(m: Movie, c: Content): boolean {
  const a = c.asset ? m.assets[c.asset] : undefined;
  if (!a) return false;
  if (c.kind === 'audio') return a.kind === 'audio' || a.kind === 'video';
  return c.kind === 'video' && a.hasAudio === true;
}

/**
 * Seconds inside the sound to movie frames, the way media/audio.ts schedules the block: a group shifts by
 * start - offset, the block plays source frame offset + local * speed (reversed: offset + (duration - local) * speed),
 * and only what lies inside the block and its groups on the Timeline is heard.
 */
export function linesToCues(m: Movie, contentId: string, lines: TimedLine[]): NewCue[] {
  const f = findBlock(m, contentId);
  if (!f || !isSound(m, f.c)) return [];
  const c = f.c, fps = m.fps;
  let shift = 0, lo = 0, hi = Number.POSITIVE_INFINITY;
  for (const g of f.groups) {
    // playback leaves out sound in a retimed group, and so do we
    if (g.speed !== undefined && g.speed !== 1 || g.reverse) return [];
    const gs = g.start + shift;
    lo = Math.max(lo, gs);
    hi = Math.min(hi, gs + g.duration);
    shift += g.start - g.offset;
  }
  if (c.speed === 0 || timeKeys(c)) return [];
  const cs = c.start + shift, s = c.speed ?? 1, rev = c.reverse === true;
  lo = Math.max(lo, cs);
  hi = Math.min(hi, cs + c.duration);
  if (!(hi > lo)) return [];
  const local = (sec: number): number => (sec * fps - c.offset) / s;
  const out: NewCue[] = [];
  for (const l of lines) {
    const text = (l.text ?? '').trim();
    if (!text || !Number.isFinite(l.start) || !Number.isFinite(l.end) || l.end <= l.start) continue;
    let a = rev ? cs + c.duration - local(l.end) : cs + local(l.start);
    let b = rev ? cs + c.duration - local(l.start) : cs + local(l.end);
    a = Math.max(a, lo);
    b = Math.min(b, hi);
    if (b <= a) continue;
    const start = Math.round(a);
    if (start >= hi) continue;
    const end = Math.min(hi, Math.max(start + 1, Math.round(b)));
    out.push({ start, end, text, from: contentId });
  }
  return out;
}

/** Lines for a sound an AI voice spoke: its own timing, or an estimate over the sound's length; [] for any other sound. */
export function cuesForSound(m: Movie, contentId: string): NewCue[] {
  const f = findBlock(m, contentId);
  const a = f?.c.asset ? m.assets[f.c.asset] : undefined;
  const spoken = a?.spoken;
  if (!f || !a || !spoken) return [];
  const seconds = a.seconds ?? (f.c.offset + f.c.duration * (f.c.speed || 1)) / m.fps;
  const lines = spoken.cues.length ? spoken.cues : estimateLines(spoken.text, seconds);
  return linesToCues(m, contentId, lines);
}

// ---- reading ----

/** The line covering `frame`; of two that overlap, the one that started last. */
export function cueAt(m: Movie, frame: number): SubtitleCue | null {
  const cues = m.subtitles?.cues;
  if (!cues || !cues.length) return null;
  // the last cue starting at or before the frame, then back to the first that still covers it
  let lo = 0, hi = cues.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cues[mid].start <= frame) lo = mid + 1; else hi = mid; }
  for (let i = lo - 1; i >= 0; i--) if (frame < cues[i].end) return cues[i];
  return null;
}

/** Families an export must have loaded before it draws. */
export function subtitleFonts(m: Movie): string[] {
  const s = m.subtitles;
  return s && s.show && s.cues.length ? [s.style.font] : [];
}

// ---- drawing ----

const MAX_LINES = 3;
const WIDTH_SHARE = 0.88;
const EDGE_SHARE = 0.06;
const LINE_EM = 1.3;
const PAD_EM = 0.35;
const OUTLINE_EM = 0.08;
const BAND = 'rgba(0,0,0,0.6)';
const OUTLINE = 'rgba(0,0,0,0.85)';
const ELLIPSIS = '…';

interface Wrap { id: string; text: string; font: string; px: number; width: number; epoch: number; lines: string[]; widths: number[]; asc: number; desc: number }
let wrapCache: Wrap | null = null;

/** Breaks a word too wide for a line into pieces that fit (scripts written without spaces). */
function breakWord(ctx: Ctx, word: string, max: number, into: string[]): void {
  let cur = '';
  for (const ch of Array.from(word)) {
    if (cur && ctx.measureText(cur + ch).width > max) { into.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) into.push(cur);
}

function wrap(ctx: Ctx, text: string, max: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const tryLine = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(tryLine).width <= max) { cur = tryLine; continue; }
      if (cur) lines.push(cur);
      cur = '';
      if (ctx.measureText(word).width <= max) { cur = word; continue; }
      const bits: string[] = [];
      breakWord(ctx, word, max, bits);
      cur = bits.pop() ?? '';
      lines.push(...bits);
    }
    if (cur) lines.push(cur);
  }
  if (lines.length <= MAX_LINES) return lines;
  const kept = lines.slice(0, MAX_LINES);
  let last = Array.from(kept[MAX_LINES - 1]);
  while (last.length && ctx.measureText(last.join('').trimEnd() + ELLIPSIS).width > max) last.pop();
  kept[MAX_LINES - 1] = last.join('').trimEnd() + ELLIPSIS;
  return kept;
}

function wrapFor(ctx: Ctx, cue: SubtitleCue, font: string, px: number, width: number): Wrap {
  const ep = fontEpoch();
  const w = wrapCache;
  if (w && w.id === cue.id && w.text === cue.text && w.font === font && w.px === px && w.width === width && w.epoch === ep) return w;
  const lines = wrap(ctx, cue.text, width);
  const widths = lines.map((l) => ctx.measureText(l).width);
  const mt = ctx.measureText('Hg');
  const asc = Number.isFinite(mt.fontBoundingBoxAscent) && mt.fontBoundingBoxAscent > 0 ? mt.fontBoundingBoxAscent : px * 0.8;
  const desc = Number.isFinite(mt.fontBoundingBoxDescent) && mt.fontBoundingBoxDescent >= 0 ? mt.fontBoundingBoxDescent : px * 0.2;
  wrapCache = { id: cue.id, text: cue.text, font, px, width, epoch: ep, lines, widths, asc, desc };
  return wrapCache;
}

/** Draws the line covering `frame` over a finished frame, in device pixels; nothing when hidden or between lines. */
export function drawSubtitles(ctx: Ctx, m: Movie, frame: number, view: { scale: number; ox: number; oy: number; width: number; height: number }): void {
  const s = m.subtitles;
  if (!s || !s.show) return;
  const cue = cueAt(m, frame);
  if (!cue) return;
  const mw = m.width * view.scale, mh = m.height * view.scale;
  const px = (s.style.size / 100) * m.height * view.scale;
  if (!(px > 0.5) || !(mw > 0) || !(mh > 0)) return;
  const look: TextStyle = { text: '', font: s.style.font, size: px, weight: 600, color: s.style.color, align: 'center' };
  const font = fontCss(look, px);
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.rect(view.ox, view.oy, mw, mh);
    ctx.clip();
    ctx.font = font;
    if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const w = wrapFor(ctx, cue, font, px, WIDTH_SHARE * mw);
    const n = w.lines.length;
    if (!n) return;
    const lh = px * LINE_EM;
    const blockH = n * lh;
    const pos = s.style.position;
    const top = pos === 'top' ? view.oy + EDGE_SHARE * mh
      : pos === 'middle' ? view.oy + (mh - blockH) / 2
        : view.oy + mh - EDGE_SHARE * mh - blockH;
    const cx = view.ox + mw / 2;
    // the baseline sits so the font's own height is centred in each line box
    const baseIn = (lh - (w.asc + w.desc)) / 2 + w.asc;
    if (s.style.band) {
      const pad = PAD_EM * px, r = 0.25 * px;
      ctx.fillStyle = BAND;
      ctx.beginPath();
      // one path: where padded bands of neighbouring lines overlap they fill once, not twice as dark
      for (let i = 0; i < n; i++) {
        const lw = w.widths[i];
        const y = top + i * lh + (lh - px) / 2 - pad;
        ctx.roundRect(cx - lw / 2 - pad, y, lw + 2 * pad, px + 2 * pad, r);
      }
      ctx.fill();
    } else {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2 * OUTLINE_EM * px;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      for (let i = 0; i < n; i++) ctx.strokeText(w.lines[i], cx - w.widths[i] / 2, top + i * lh + baseIn);
    }
    ctx.fillStyle = s.style.color;
    for (let i = 0; i < n; i++) ctx.fillText(w.lines[i], cx - w.widths[i] / 2, top + i * lh + baseIn);
  } finally {
    ctx.restore();
  }
}
