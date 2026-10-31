// Editing the sound of a block and a track: fades, pan, level, normalize, mute and solo. Pure model code
// (no DOM): every function takes a Movie and returns the next one, to be run as one undo step.
import { OpError, updateContent } from '../engine/ops';
import { laneOf } from '../engine/keys';
import type { Content, Movie, Track } from '../engine/types';

export const MAX_LEVEL = 4;
/** Normalize aims a little under full scale so a later pan or sum does not clip. */
export const NORMALIZE_PEAK = 0.97;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function isSound(c: Content): boolean {
  return c.kind === 'audio';
}

/** Fade lengths kept inside the block: together they never exceed its length. */
export function fadeLimits(c: Content, fadeIn: number, fadeOut: number, prefer: 'in' | 'out'): { fadeIn: number; fadeOut: number } {
  let a = clamp(Math.round(fadeIn), 0, c.duration);
  let b = clamp(Math.round(fadeOut), 0, c.duration);
  if (a + b > c.duration) {
    if (prefer === 'in') b = c.duration - a;
    else a = c.duration - b;
  }
  return { fadeIn: a, fadeOut: b };
}

export function setFade(m: Movie, id: string, which: 'in' | 'out', frames: number): Movie {
  return updateContent(m, id, (c) => {
    if (!isSound(c)) throw new OpError('Only sound has fades.');
    const f = fadeLimits(c, which === 'in' ? frames : c.fadeIn ?? 0, which === 'out' ? frames : c.fadeOut ?? 0, which);
    const next: Content = { ...c };
    if (f.fadeIn > 0) next.fadeIn = f.fadeIn; else delete next.fadeIn;
    if (f.fadeOut > 0) next.fadeOut = f.fadeOut; else delete next.fadeOut;
    return next;
  });
}

export function setPan(m: Movie, id: string, pan: number): Movie {
  return updateContent(m, id, (c) => {
    const next: Content = { ...c };
    const v = clamp(Math.round(pan * 100) / 100, -1, 1);
    if (v !== 0) next.pan = v; else delete next.pan;
    return next;
  });
}

export function setLevel(m: Movie, id: string, level: number): Movie {
  return updateContent(m, id, (c) => ({ ...c, volume: clamp(level, 0, MAX_LEVEL) }));
}

/**
 * Scales the block's level (and every key of its Level lane) so the part it plays reaches a target loudness.
 * `measured` is the integrated LUFS of the raw asset over that part; the loudest level key stands for the block.
 */
export function normalizeLoudness(m: Movie, id: string, measured: number, target: number): Movie {
  if (!Number.isFinite(measured)) throw new OpError('This sound is too quiet to measure, so there is nothing to normalize.');
  return updateContent(m, id, (c) => {
    const lane = laneOf(c, 'volume');
    const keyed = lane?.channels.level?.length ? Math.max(...lane.channels.level.map((k) => k.value)) : c.volume;
    const now = measured + 20 * Math.log10(Math.max(0.0001, keyed));
    const ratio = Math.pow(10, (target - now) / 20);
    const next: Content = { ...c, volume: clamp(c.volume * ratio, 0, MAX_LEVEL) };
    if (lane?.channels.level?.length) {
      const channels = { ...lane.channels, level: lane.channels.level.map((k) => ({ ...k, value: clamp(k.value * ratio, 0, MAX_LEVEL) })) };
      next.keys = c.keys.map((l) => (l === lane ? { ...lane, channels } : l));
    }
    return next;
  });
}

/**
 * Scales the block's level (and every key of its Level lane) so the loudest sample it plays reaches the target.
 * `peak` is the loudest raw sample of the asset over the part the block plays.
 */
export function normalize(m: Movie, id: string, peak: number): Movie {
  if (!(peak > 0.0005)) throw new OpError('This sound is silent, so there is nothing to normalize.');
  return updateContent(m, id, (c) => {
    const lane = laneOf(c, 'volume');
    const keyed = lane?.channels.level?.length ? Math.max(...lane.channels.level.map((k) => k.value)) : c.volume;
    const top = Math.max(0.0001, keyed) * peak;
    const ratio = NORMALIZE_PEAK / top;
    const next: Content = { ...c, volume: clamp(c.volume * ratio, 0, MAX_LEVEL) };
    if (lane?.channels.level?.length) {
      const channels = { ...lane.channels, level: lane.channels.level.map((k) => ({ ...k, value: clamp(k.value * ratio, 0, MAX_LEVEL) })) };
      next.keys = c.keys.map((l) => (l === lane ? { ...lane, channels } : l));
    }
    return next;
  });
}

function patchTrack(m: Movie, trackId: string, fn: (t: Track) => Track): Movie {
  if (!m.tracks.some((t) => t.id === trackId)) throw new OpError('That track no longer exists.');
  return { ...m, tracks: m.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

export function setMute(m: Movie, trackId: string, on: boolean): Movie {
  return patchTrack(m, trackId, (t) => {
    const next: Track = { ...t };
    if (on) next.mute = true; else delete next.mute;
    return next;
  });
}

export function setSolo(m: Movie, trackId: string, on: boolean): Movie {
  return patchTrack(m, trackId, (t) => {
    const next: Track = { ...t };
    if (on) next.solo = true; else delete next.solo;
    return next;
  });
}

/** Gain of the fades at a local frame of the block (1 between them), for drawing the waveform as it will sound. */
export function fadeGain(c: Content, local: number): number {
  let g = 1;
  const fi = c.fadeIn ?? 0, fo = c.fadeOut ?? 0;
  if (fi > 0 && local < fi) g *= Math.max(0, local / fi);
  if (fo > 0 && local > c.duration - fo) g *= Math.max(0, (c.duration - local) / fo);
  return g;
}

/** The sound blocks of a movie, top level and inside groups. */
export function soundBlocks(m: Movie): Content[] {
  const out: Content[] = [];
  const walk = (ts: Track[]): void => { for (const t of ts) for (const c of t.content) { if (c.kind === 'audio') out.push(c); if (c.tracks.length) walk(c.tracks); } };
  walk(m.tracks);
  return out;
}
