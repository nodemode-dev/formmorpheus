// What the Generate voice and Subtitles cards work out before they touch the page or the movie: timing shared between
// sentences, typed seconds, the part of a sound a block plays, and the one movie step that lands a voice. Pure, so
// it is tested with no model and no window.
import { content as makeContent, end } from '../engine/model';
import * as ops from '../engine/ops';
import { SUBTITLE_DEFAULTS, addSubtitles, linesFromSentences, readSubtitles, subtitleTrack, writeSubtitles, type SubtitleLine, type SubtitleStyle } from '../engine/subtitles';
import type { Asset, Content, Movie } from '../engine/types';
import { splitSentences } from '../media/speech/sentences';
import { LANG_NAMES } from './i18n/langs';

export const VOICE_TRACK_NAME = 'Voice';
export const VOICE_NAME = 'Generated voice';
/** Length of a line added by hand at the Playhead. */
export const NEW_LINE_SECONDS = 2;

const SIZES: readonly SubtitleStyle['size'][] = ['small', 'medium', 'large'];
const POSITIONS: readonly SubtitleStyle['position'][] = ['top', 'middle', 'bottom'];

/** A sound's whole length shared between the sentences of its text by their letters, for speech that came back as one piece. */
export function sentenceShares(text: string, seconds: number): { text: string; seconds: number }[] {
  const parts = splitSentences(text);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const span = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (!total) return [];
  return parts.map((p) => ({ text: p, seconds: (span * p.length) / total }));
}

/** Subtitle lines for speech that came back as one piece: no silence is assumed between its sentences. */
export function linesForWholeSound(text: string, seconds: number, startSeconds: number): SubtitleLine[] {
  return linesFromSentences(sentenceShares(text, seconds), startSeconds, 0);
}

/** Seconds typed by a person: "12.5", "12,5", "1:02.5" or "1:02:03". Null when it is not a time. */
export function parseSeconds(text: string): number | null {
  const s = text.trim().replace(',', '.').replace(/\s*s$/i, '');
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d*)?$|^\.\d+$/.test(s)) return null;
  const parts = s.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((sum, p) => sum * 60 + p, 0);
}

/** Seconds with one decimal, the form the line list shows and reads back. */
export function formatSeconds(seconds: number): string {
  return (Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10) / 10).toFixed(1);
}

/** A line's typed times as frames, kept between its neighbours (`lo` and `hi`) and at least one frame long. */
export function clampSpan(startSeconds: number, endSeconds: number, fps: number, lo: number, hi: number): { start: number; duration: number } {
  const top = Math.max(lo + 1, hi);
  const start = Math.min(top - 1, Math.max(lo, Math.round(startSeconds * fps)));
  const stop = Math.min(top, Math.max(start + 1, Math.round(endSeconds * fps)));
  return { start, duration: stop - start };
}

/** The samples of a decoded sound that a block plays: its offset and length in frames, at the block's speed. */
export function sampleRange(offsetFrames: number, durationFrames: number, fps: number, sampleRate: number, length: number, speed = 1): { from: number; to: number } {
  const rate = speed > 0 && Number.isFinite(speed) ? speed : 1;
  const from = Math.min(length, Math.max(0, Math.round((offsetFrames / fps) * sampleRate)));
  const to = Math.min(length, Math.max(from, from + Math.round(((durationFrames * rate) / fps) * sampleRate)));
  return { from, to };
}

/** Channels averaged into one, between two samples. */
export function monoSamples(channels: readonly Float32Array[], from: number, to: number): Float32Array {
  const out = new Float32Array(Math.max(0, to - from));
  if (!channels.length) return out;
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[from + i] ?? 0;
  if (channels.length > 1) for (let i = 0; i < out.length; i++) out[i] /= channels.length;
  return out;
}

/** What the card's controls hold, as they come from the page. */
export interface StyleControls { font: string; size: string; position: string; color: string; band: boolean }

/** The card's controls as a style; anything that is not a known choice keeps `fallback`'s value. */
export function styleFromControls(raw: StyleControls, fallback: SubtitleStyle = SUBTITLE_DEFAULTS): SubtitleStyle {
  const color = raw.color.trim().toLowerCase();
  return {
    font: raw.font.trim() || fallback.font,
    size: SIZES.find((s) => s === raw.size) ?? fallback.size,
    position: POSITIONS.find((p) => p === raw.position) ?? fallback.position,
    color: /^#[0-9a-f]{6}$/.test(color) ? color : fallback.color,
    band: raw.band,
  };
}

/** The languages speech to text is offered in: English first, then the interface's languages by two-letter code. */
export function listenLanguages(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [code, name] of LANG_NAMES) {
    // the speech model files Norwegian under "no"
    const two = code === 'nb' ? 'no' : code.slice(0, 2).toLowerCase();
    if (out.some(([c]) => c === two)) continue;
    out.push([two, name.replace(/\s*\(.*\)$/, '')]);
  }
  return out;
}

/** Lines joined to the movie's subtitles; the first lines of a movie take `style`, later ones the style already there. */
export function addLines(movie: Movie, lines: SubtitleLine[], style: SubtitleStyle): Movie {
  if (!lines.length) return movie;
  return readSubtitles(movie).lines.length ? addSubtitles(movie, lines) : writeSubtitles(movie, lines, style);
}

/** The subtitle blocks in time order. */
export function lineBlocks(movie: Movie): Content[] {
  const tr = subtitleTrack(movie);
  return tr ? tr.content.filter((c) => c.kind === 'text' && !!c.text).sort((a, b) => a.start - b.start) : [];
}

/** An empty line of NEW_LINE_SECONDS at `startSeconds`, and its id so the card can put the caret in it. */
export function addEmptyLine(movie: Movie, startSeconds: number, style: SubtitleStyle): { movie: Movie; id: string | null } {
  const had = new Set(lineBlocks(movie).map((c) => c.id));
  // a line with no words is not kept by the subtitle code, so it is made with one and emptied
  const made = addLines(movie, [{ start: startSeconds, end: startSeconds + NEW_LINE_SECONDS, text: '-' }], style);
  const fresh = lineBlocks(made).find((c) => !had.has(c.id));
  if (!fresh) return { movie, id: null };
  return { movie: ops.updateContent(made, fresh.id, (c) => (c.text ? { ...c, name: '', text: { ...c.text, text: '' } } : c)), id: fresh.id };
}

/** One line taken away; the subtitles track goes with its last block. */
export function removeLine(movie: Movie, id: string): Movie {
  const tr = subtitleTrack(movie);
  if (!tr || !tr.content.some((c) => c.id === id)) return movie;
  const next = ops.deleteContent(movie, [id]);
  return tr.content.length === 1 ? ops.deleteTrack(next, tr.id) : next;
}

/**
 * The lines that start inside a span of frames taken away, and how many they were. Lines heard from a sound stand in
 * for the ones already under it: left there, the two sets would cut each other into slivers.
 */
export function clearSpan(movie: Movie, from: number, to: number): { movie: Movie; removed: number } {
  const tr = subtitleTrack(movie);
  const ids = lineBlocks(movie).filter((c) => c.start >= from && c.start < to).map((c) => c.id);
  if (!tr || !ids.length) return { movie, removed: 0 };
  const next = ops.deleteContent(movie, ids);
  return { movie: tr.content.length === ids.length ? ops.deleteTrack(next, tr.id) : next, removed: ids.length };
}

export interface VoicePlacement { movie: Movie; blockId: string }

/**
 * A generated voice on the movie in one step: its sound on a new track named Voice from `startFrame`, its lines on
 * the subtitles track, and the movie made long enough to play all of it. `assetId` is the id its sound is kept under.
 */
export function placeVoice(movie: Movie, sound: { assetId: string; mime: string; size: number; seconds: number }, startFrame: number, lines: SubtitleLine[], style: SubtitleStyle): VoicePlacement {
  const frames = Math.max(1, Math.round(sound.seconds * movie.fps));
  const asset: Asset = { id: sound.assetId, kind: 'audio', name: VOICE_NAME, mime: sound.mime, width: 0, height: 0, frames, size: sound.size, seconds: sound.seconds };
  const block = makeContent('audio', startFrame, frames, { name: VOICE_NAME, asset: asset.id });
  const added = ops.addTrack({ ...movie, assets: { ...movie.assets, [asset.id]: asset } }, 0, VOICE_TRACK_NAME);
  const placed = ops.placeContent(added.movie, added.track.id, block).movie;
  const long = { ...placed, duration: Math.max(placed.duration, end(block)) };
  return { movie: addLines(long, lines, style), blockId: block.id };
}
