// Subtitles: timed lines kept as ordinary Text blocks on the one track marked `subtitles`, so the Stage and the
// export draw them with no renderer of their own. Seconds in, frames stored. Pure, no DOM; nothing given is changed.
import { content as makeContent, defaultText, end, track as makeTrack } from './model';
import { OpError } from './ops';
import { TITLE_PRESETS } from './text-presets';
import type { TextBoxFx } from './text-rich';
import type { Content, Movie, TextStyle, Track } from './types';

/** Seconds on the movie's timeline. */
export interface SubtitleLine { start: number; end: number; text: string }

export interface SubtitleStyle {
  font: string;
  size: 'small' | 'medium' | 'large';
  position: 'top' | 'middle' | 'bottom';
  color: string;
  band: boolean;
}

export const SUBTITLE_DEFAULTS: SubtitleStyle = { font: defaultText().font, size: 'medium', position: 'bottom', color: '#ffffff', band: true };

export const SUBTITLE_TRACK_NAME = 'Subtitles';
/** Pause between two spoken sentences; the voice code joins sentences with the same gap, so lines and sound agree. */
export const SENTENCE_GAP_SECONDS = 0.3;
/** A sentence longer than this is split into lines of at most LINE_CHARS. */
export const SENTENCE_CHARS = 84;
export const LINE_CHARS = 42;
export const LINE_WORDS = 7;
/** A silence longer than this between two heard words starts a new line. */
export const WORD_GAP_SECONDS = 0.7;

/** Text size as a share of the movie's height. */
const SIZE_SHARE: Record<SubtitleStyle['size'], number> = { small: 0.035, medium: 0.045, large: 0.06 };
/** Top and bottom: how far in from the edge the block's centre sits, as a share of the height. */
const EDGE_SHARE = 0.08;
/** Lines wrap inside this share of the movie's width, so a long one never runs off the picture. */
const WRAP_SHARE = 0.8;
const PRESET_ID = 'subtitle';
const SIZES = Object.keys(SIZE_SHARE) as SubtitleStyle['size'][];
const POSITIONS: SubtitleStyle['position'][] = ['top', 'middle', 'bottom'];

const ms = (seconds: number): number => Math.round(seconds * 1000) / 1000;
const clean = (text: string): string => text.replace(/[ \t]+/g, ' ').trim();

function presetLook(s: TextStyle, movie: Movie): TextStyle {
  const p = TITLE_PRESETS.find((x) => x.id === PRESET_ID);
  if (!p) throw new Error('The subtitle preset is missing.');
  return p.apply(s, movie.width, movie.height);
}

function sizePx(movie: Movie, size: SubtitleStyle['size']): number {
  return Math.max(1, Math.round(movie.height * SIZE_SHARE[size]));
}

/** A text block is laid out around the movie's centre, so `transform.y` is the offset of its centre from there. */
function yFor(movie: Movie, position: SubtitleStyle['position']): number {
  const reach = Math.round(movie.height * (0.5 - EDGE_SHARE));
  return position === 'top' ? -reach : position === 'bottom' ? reach : 0;
}

function nearest<K extends string>(keys: readonly K[], value: number, of: (k: K) => number): K {
  return keys.reduce((best, k) => (Math.abs(of(k) - value) < Math.abs(of(best) - value) ? k : best), keys[0]);
}

function textStyle(movie: Movie, text: string, style: SubtitleStyle): TextStyle {
  const { box, ...plain } = presetLook({ ...defaultText(), text, font: style.font }, movie);
  return {
    ...plain, ...(style.band && box ? { box } : {}),
    preset: PRESET_ID, size: sizePx(movie, style.size), color: style.color, boxW: Math.round(movie.width * WRAP_SHARE),
  };
}

function lineContent(movie: Movie, line: SubtitleLine, style: SubtitleStyle): Content | null {
  const text = clean(line.text);
  if (!text || !Number.isFinite(line.start) || !Number.isFinite(line.end)) return null;
  const start = Math.max(0, Math.round(line.start * movie.fps));
  // the end is rounded, not the length, so lines that touch in seconds still touch in frames
  const duration = Math.max(1, Math.round(line.end * movie.fps) - start);
  const base = makeContent('text', start, duration, { name: text.slice(0, 80), text: textStyle(movie, text, style) });
  return { ...base, transform: { ...base.transform, y: yFor(movie, style.position) } };
}

function restyled(movie: Movie, c: Content, style: SubtitleStyle): Content {
  if (c.kind !== 'text' || !c.text) return c;
  // only the fields the style owns change, so runs, keys and anything else set by hand stay
  const { box: old, ...rest } = c.text;
  const box: TextBoxFx | undefined = style.band ? old ?? presetLook(c.text, movie).box : undefined;
  return {
    ...c,
    text: { ...rest, font: style.font, size: sizePx(movie, style.size), color: style.color, ...(box ? { box } : {}) },
    transform: { ...c.transform, y: yFor(movie, style.position) },
  };
}

/** Sorted by start with no overlap: a later block trims the one before it, and of two that start together the later given stays. */
function settle(items: Content[]): Content[] {
  const out: Content[] = [];
  for (const c of [...items].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && last.start === c.start) out[out.length - 1] = c;
    else {
      if (last && end(last) > c.start) out[out.length - 1] = { ...last, duration: c.start - last.start };
      out.push(c);
    }
  }
  return out;
}

const isLine = (c: Content): boolean => c.kind === 'text' && !!c.text;

function withContent(movie: Movie, tr: Track | null, items: Content[]): Movie {
  if (!items.length) return tr ? { ...movie, tracks: movie.tracks.filter((t) => t.id !== tr.id) } : movie;
  if (tr) return { ...movie, tracks: movie.tracks.map((t) => (t.id === tr.id ? { ...t, content: items } : t)) };
  // index 0 is drawn last, so the new track is on top of every other
  const made: Track = { ...makeTrack(SUBTITLE_TRACK_NAME, items), screen: true, subtitles: true };
  return { ...movie, tracks: [made, ...movie.tracks] };
}

function open(movie: Movie): Track | null {
  const tr = subtitleTrack(movie);
  if (tr?.locked) throw new OpError('Track is locked');
  return tr;
}

export function subtitleTrack(movie: Movie): Track | null {
  return movie.tracks.find((t) => t.subtitles === true) ?? null;
}

/** Whatever text blocks the track holds now, made here or edited by hand; the style is read from the first one. */
export function readSubtitles(movie: Movie): { lines: SubtitleLine[]; style: SubtitleStyle; shown: boolean } {
  const tr = subtitleTrack(movie);
  const blocks = tr ? tr.content.filter(isLine).sort((a, b) => a.start - b.start) : [];
  const lines = blocks.map((c) => ({ start: ms(c.start / movie.fps), end: ms(end(c) / movie.fps), text: (c.text as TextStyle).text }));
  const first = blocks[0];
  const s = first?.text;
  const style: SubtitleStyle = first && s ? {
    font: s.font,
    size: nearest(SIZES, s.size, (k) => movie.height * SIZE_SHARE[k]),
    position: nearest(POSITIONS, first.transform.y, (k) => yFor(movie, k)),
    color: s.color,
    band: !!s.box,
  } : { ...SUBTITLE_DEFAULTS };
  return { lines, style, shown: tr ? !tr.hidden : true };
}

/** Replaces every line. Makes the track (on top, fixed to the screen) when absent; removes it when nothing is left on it. */
export function writeSubtitles(movie: Movie, lines: SubtitleLine[], style: SubtitleStyle): Movie {
  const tr = open(movie);
  const made = lines.map((l) => lineContent(movie, l, style)).filter((c): c is Content => c !== null);
  // anything that is not a line (a picture a person dropped on the track) is theirs and stays
  const others = tr ? tr.content.filter((c) => !isLine(c)) : [];
  return withContent(movie, tr, settle([...others, ...made]));
}

/** Merges lines into what is there, in the style of what is there. A later line trims the one before it. */
export function addSubtitles(movie: Movie, lines: SubtitleLine[]): Movie {
  const tr = open(movie);
  const { style } = readSubtitles(movie);
  const made = lines.map((l) => lineContent(movie, l, style)).filter((c): c is Content => c !== null);
  if (!made.length && tr?.content.length) return movie;
  return withContent(movie, tr, settle([...(tr?.content ?? []), ...made]));
}

export function restyleSubtitles(movie: Movie, style: SubtitleStyle): Movie {
  const tr = open(movie);
  if (!tr) return movie;
  return withContent(movie, tr, tr.content.map((c) => restyled(movie, c, style)));
}

export function showSubtitles(movie: Movie, shown: boolean): Movie {
  const tr = subtitleTrack(movie);
  if (!tr || tr.hidden === !shown) return movie;
  return { ...movie, tracks: movie.tracks.map((t) => (t.id === tr.id ? { ...t, hidden: !shown } : t)) };
}

/** Words packed into lines of at most `max` characters; a single longer word keeps a line to itself. */
function wrapWords(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > max) { out.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

/** One line per spoken sentence, each starting where the one before ended plus the gap; a long sentence is split and shares its time by length. */
export function linesFromSentences(sentences: { text: string; seconds: number }[], startSeconds: number, gapSeconds: number = SENTENCE_GAP_SECONDS): SubtitleLine[] {
  const out: SubtitleLine[] = [];
  let at = startSeconds;
  for (const s of sentences) {
    const text = clean(s.text.replace(/\s+/g, ' '));
    const seconds = Math.max(0, s.seconds);
    const parts = text.length > SENTENCE_CHARS ? wrapWords(text, LINE_CHARS) : text ? [text] : [];
    const total = parts.reduce((sum, p) => sum + p.length, 0) || 1;
    let used = 0;
    for (const p of parts) {
      const from = at + (seconds * used) / total;
      used += p.length;
      out.push({ start: ms(from), end: ms(at + (seconds * used) / total), text: p });
    }
    // a sentence with no words still takes its time, so the lines after it stay under their sound
    at += seconds + gapSeconds;
  }
  return out;
}

const SENTENCE_END = /[.!?…]["'’”)\]]*$/;

/** Heard words grouped into lines: at most 42 characters or 7 words, and a new line after a gap over 0.7 s or sentence-ending punctuation. */
export function linesFromWords(words: { text: string; start: number; end: number }[], offsetSeconds = 0): SubtitleLine[] {
  const out: SubtitleLine[] = [];
  let cur: { start: number; end: number; parts: string[]; chars: number } | null = null;
  const close = (): void => {
    if (cur) out.push({ start: ms(cur.start + offsetSeconds), end: ms(Math.max(cur.end, cur.start) + offsetSeconds), text: cur.parts.join(' ') });
    cur = null;
  };
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    if (cur) {
      const full = cur.parts.length >= LINE_WORDS || cur.chars + 1 + text.length > LINE_CHARS;
      // rounded: times come in hundredths, and 1.1 - 0.4 must not count as over 0.7
      if (full || ms(w.start - cur.end) > WORD_GAP_SECONDS ||SENTENCE_END.test(cur.parts[cur.parts.length - 1])) close();
    }
    if (cur) { cur.parts.push(text); cur.chars += 1 + text.length; cur.end = Math.max(cur.end, w.end); }
    else cur = { start: w.start, end: w.end, parts: [text], chars: text.length };
  }
  close();
  return out;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

function srtTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const s = Math.floor(total / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)},${pad(total % 1000, 3)}`;
}

/** SubRip text: an index, the two times, the words and a blank line for each line. */
export function toSrt(lines: SubtitleLine[]): string {
  return lines
    .map((l) => ({ ...l, text: l.text.split(/\r?\n/).map(clean).filter(Boolean).join('\n') }))
    .filter((l) => l.text)
    .map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.text}\n`)
    .join('\n');
}

const SRT_TIME = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

const stamp = (h: string | undefined, m: string, s: string, frac: string): number =>
  Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(frac.padEnd(3, '0')) / 1000;

/**
 * Reads SubRip text. Line ends of any kind, a byte order mark, a dot for the comma and missing indexes are all read;
 * the rows of a cue are joined with a space, simple tags are dropped, and a cue that cannot be read is skipped.
 */
export function fromSrt(text: string): SubtitleLine[] {
  const out: SubtitleLine[] = [];
  let cur: { start: number; end: number; rows: string[] } | null = null;
  const close = (): void => {
    const words = cur ? clean(cur.rows.join(' ').replace(/<[^>]*>|\{\\[^}]*\}/g, '')) : '';
    if (cur && words && cur.end > cur.start) out.push({ start: cur.start, end: cur.end, text: words });
    cur = null;
  };
  for (const row of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const m = SRT_TIME.exec(row);
    if (m) {
      // with no blank line between two cues, the next cue's index is the last row gathered: it is not words
      if (cur && cur.rows.length && /^\d+$/.test(cur.rows[cur.rows.length - 1])) cur.rows.pop();
      close();
      cur = { start: stamp(m[1], m[2], m[3], m[4]), end: stamp(m[5], m[6], m[7], m[8]), rows: [] };
    } else if (!row.trim()) close();
    else if (cur) cur.rows.push(row.trim());
  }
  close();
  return out;
}
