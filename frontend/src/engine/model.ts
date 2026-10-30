import {
  FORMAT_VERSION, MAX_SIDE,
  type Content, type ContentKind, type DrawingLayer, type Movie, type OnionSettings, type TextStyle, type Track, type Transform,
} from './types';
import { clampFps, framesFor } from './time';

let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 0x10000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function identity(): Transform {
  return { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false };
}

export function defaultOnion(): OnionSettings {
  return { enabled: true, backwards: true, forwards: true, frames: 2, opacity: 0.35, tint: true, backColor: '#ff4f7a', foreColor: '#3a9bff', blendPrimary: false };
}

export function drawingLayer(name = 'Layer 1'): DrawingLayer {
  return { id: uid('l'), name, visible: true, opacity: 1, blend: 'normal', alphaLock: false, clipping: false, pixels: null };
}

const KIND_NAMES: Record<ContentKind, string> = {
  drawing: 'Drawing', flipbook: 'Flipbook', image: 'Image', video: 'Video', audio: 'Audio', text: 'Text', group: 'Group',
};

export function kindName(kind: ContentKind): string {
  return KIND_NAMES[kind];
}

export function defaultText(): TextStyle {
  return { text: 'Text', font: 'Inter', size: 160, weight: 600, color: '#ffffff', align: 'center' };
}

export function content(kind: ContentKind, start: number, duration: number, extra: Partial<Content> = {}): Content {
  const base: Content = {
    id: uid('c'),
    kind,
    name: KIND_NAMES[kind],
    start: Math.max(0, Math.round(start)),
    duration: Math.max(1, Math.round(duration)),
    offset: 0,
    opacity: 1,
    blend: 'normal',
    mask: 'none',
    maskInvert: false,
    highlight: 'none',
    transform: identity(),
    asset: null,
    layers: kind === 'drawing' ? [drawingLayer()] : [],
    frames: [],
    text: kind === 'text' ? defaultText() : null,
    tracks: [],
    volume: 1,
  };
  return { ...base, ...extra };
}

export function track(name: string, items: Content[] = []): Track {
  return { id: uid('t'), name, hidden: false, content: items };
}

export interface NewMovieOptions {
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  seconds?: number;
  flipbook?: boolean;
}

export function clampSide(n: number): number {
  return Math.min(MAX_SIDE, Math.max(16, Math.round(n)));
}

export function newMovie(opts: NewMovieOptions = {}): Movie {
  const fps = clampFps(opts.fps ?? 24);
  const duration = framesFor(opts.seconds ?? 10, fps);
  const movie: Movie = {
    format: FORMAT_VERSION,
    id: uid('m'),
    name: opts.name ?? 'Untitled Movie',
    width: clampSide(opts.width ?? 1920),
    height: clampSide(opts.height ?? 1080),
    fps,
    duration,
    background: '#ffffff',
    transparent: false,
    playback: 'loop',
    addKeyAtStart: true,
    onion: defaultOnion(),
    tracks: [],
    assets: {},
  };
  if (opts.flipbook) {
    const fb = content('flipbook', 0, Math.min(duration, Math.round(fps)), { name: 'Flipbook' });
    movie.tracks = [track('Track 1', [fb])];
  }
  return movie;
}

export function trackName(movie: Movie): string {
  const used = new Set(movie.tracks.map((t) => t.name));
  let n = movie.tracks.length + 1;
  while (used.has(`Track ${n}`)) n++;
  return `Track ${n}`;
}

export function end(c: Content): number {
  return c.start + c.duration;
}

export function sourceFrames(movie: Movie, c: Content): number {
  if (c.kind === 'flipbook') return c.frames.reduce((sum, f) => sum + Math.max(1, f.hold), 0) || Number.POSITIVE_INFINITY;
  if (c.kind !== 'video' && c.kind !== 'audio') return Number.POSITIVE_INFINITY;
  const asset = c.asset ? movie.assets[c.asset] : undefined;
  return asset && asset.frames > 0 ? asset.frames : Number.POSITIVE_INFINITY;
}

export function contentEnd(movie: Movie): number {
  let max = 0;
  const walk = (tracks: Track[]): void => {
    for (const t of tracks) for (const c of t.content) {
      max = Math.max(max, end(c));
      if (c.kind === 'group') walk(c.tracks);
    }
  };
  walk(movie.tracks);
  return max;
}

export interface Located {
  track: Track;
  trackIndex: number;
  content: Content;
  index: number;
}

export function locate(movie: Movie, id: string): Located | null {
  for (let ti = 0; ti < movie.tracks.length; ti++) {
    const t = movie.tracks[ti];
    const index = t.content.findIndex((c) => c.id === id);
    if (index >= 0) return { track: t, trackIndex: ti, content: t.content[index], index };
  }
  return null;
}

export function contentAt(t: Track, frame: number): Content | null {
  for (const c of t.content) if (frame >= c.start && frame < end(c)) return c;
  return null;
}

export function sortContent(items: Content[]): Content[] {
  return [...items].sort((a, b) => a.start - b.start);
}

export function freeSpan(t: Track, frame: number, ignore: Set<string> = new Set()): { from: number; to: number } {
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  for (const c of t.content) {
    if (ignore.has(c.id)) continue;
    if (end(c) <= frame) from = Math.max(from, end(c));
    else if (c.start > frame) to = Math.min(to, c.start);
    else return { from: frame, to: frame };
  }
  return { from, to };
}

export function fits(t: Track, start: number, duration: number, ignore: Set<string> = new Set()): boolean {
  const stop = start + duration;
  return t.content.every((c) => ignore.has(c.id) || stop <= c.start || start >= end(c));
}
