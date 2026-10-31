// Delivery maths for the exporter (pure, no DOM): output frame mapping for a frame-rate override, the bitrate a
// target file size needs, a size estimate, the built-in delivery presets and the frame name pattern.
import type { ExportOptions } from './types';
import { placeView } from './reframe';

/** Output frame rate: the override, otherwise the movie's. */
export function outFps(o: Pick<ExportOptions, 'fps'>, movieFps: number): number {
  return o.fps && o.fps > 0 ? o.fps : movieFps;
}

/** Movie steps before any rate change: [from, to), plus the return leg of a ping pong. */
function baseSteps(o: Pick<ExportOptions, 'from' | 'to' | 'pingpong'>): number {
  const n = Math.max(1, o.to - o.from);
  return o.pingpong && n >= 3 ? n + (n - 2) : n;
}

/** Number of output frames at the output rate (the duration stays the same). */
export function stepsFor(o: Pick<ExportOptions, 'from' | 'to' | 'pingpong' | 'fps'>, movieFps: number): number {
  return Math.max(1, Math.round((baseSteps(o) * outFps(o, movieFps)) / movieFps));
}

/** The movie frame shown by output frame `i`. */
export function movieFrameAt(i: number, o: Pick<ExportOptions, 'from' | 'to' | 'pingpong' | 'fps'>, movieFps: number): number {
  const n = o.to - o.from;
  const j = Math.min(baseSteps(o) - 1, Math.max(0, Math.floor((i * movieFps) / outFps(o, movieFps))));
  return j < n ? o.from + j : o.to - 2 - (j - n);
}

/** The picture view that places the movie in an output of `width` x `height`: fit (letterbox) or cover (crop). */
export function viewFor(o: { width: number; height: number; fit?: 'contain' | 'cover' | 'blur'; focus?: { x: number; y: number } }, movieW: number, movieH: number) {
  return placeView(o, movieW, movieH);
}

export const AUDIO_BPS = 128_000;

/** Video bits per second that make `bytes` over `seconds`, leaving room for sound and the container. */
export function bitrateForSize(bytes: number, seconds: number, audio: boolean): number {
  const total = (bytes * 8 * 0.985) / Math.max(0.1, seconds);
  return Math.max(30_000, Math.round(total - (audio ? AUDIO_BPS : 0)));
}

export type EstimateKind = 'video' | 'gif' | 'webp-anim' | 'apng' | 'psd' | 'still' | 'frames';

export interface EstimateIn {
  kind: EstimateKind; width: number; height: number; steps: number; fps: number;
  audio: boolean; quality: ExportOptions['quality']; alpha: boolean; picture?: string;
  rate?: { mode: 'quality' | 'bitrate' | 'size'; kbps: number; mb: number }; layers?: number; lossless?: boolean; prores?: boolean;
}

const BPP = { low: 0.035, medium: 0.07, high: 0.12, 'very-high': 0.22 };

/** Bytes the export is expected to take; a guess for the dialog, not a promise. */
export function estimateBytes(e: EstimateIn): number {
  const px = e.width * e.height, seconds = e.steps / e.fps;
  switch (e.kind) {
    case 'video': {
      if (e.prores) return px * e.steps * 0.9;
      if (e.rate?.mode === 'size') return e.rate.mb * 1_048_576;
      const bits = e.rate?.mode === 'bitrate' ? e.rate.kbps * 1000 : px * e.fps * BPP[e.quality] * 0.6;
      return (bits + (e.audio ? AUDIO_BPS : 0)) * seconds / 8;
    }
    case 'gif': return px * e.steps * 0.2;
    case 'webp-anim': return px * e.steps * (e.lossless ? 1.1 : e.quality === 'low' ? 0.04 : e.quality === 'medium' ? 0.08 : 0.16);
    case 'apng': return px * e.steps * (e.alpha ? 1.4 : 1.1);
    case 'psd': return px * 4 * Math.max(1, e.layers ?? 3) * 0.35 + px * 4 * 0.35;
    case 'still': return px * (e.picture === 'jpg' ? 0.25 : 1.2);
    default: return px * e.steps * (e.picture === 'jpg' ? 0.25 : e.picture === 'webp' ? 0.2 : e.picture === 'bmp' || e.picture === 'tga' ? 3 : 1.2);
  }
}

export function formatBytes(n: number): string {
  if (n < 1_048_576) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / 1_048_576;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** What a preset sets in the dialog. Fields left out keep the dialog's own choice. */
export interface PresetSpec {
  kind?: 'video' | 'gif' | 'webp-anim' | 'apng' | 'psd' | 'frames';
  codec?: 'h264' | 'hevc';
  container?: 'mp4' | 'mov';
  quality?: ExportOptions['quality'];
  box?: [number, number];
  longEdge?: number;
  fit?: 'contain' | 'cover' | 'blur';
  fps?: number;
  scale?: number;
  rate?: 'quality' | 'bitrate' | 'size';
  kbps?: number;
  mb?: number;
  loops?: number;
  lossless?: boolean;
  pattern?: string;
}

export interface Preset { id: string; label: string; spec: PresetSpec }

// Generic delivery targets by shape and limit; never named after a product.
export const BUILTIN_PRESETS: Preset[] = [
  { id: 'sq1080', label: 'Square 1080 · 30 fps', spec: { kind: 'video', codec: 'h264', container: 'mp4', box: [1080, 1080], fit: 'contain', fps: 30, scale: 100, rate: 'quality', quality: 'high' } },
  { id: 'vert1080', label: 'Vertical 1080x1920 · 30 fps', spec: { kind: 'video', codec: 'h264', container: 'mp4', box: [1080, 1920], fit: 'contain', fps: 30, scale: 100, rate: 'quality', quality: 'high' } },
  { id: 'wide1080', label: 'Widescreen 1080p · 30 fps', spec: { kind: 'video', codec: 'h264', container: 'mp4', box: [1920, 1080], fit: 'contain', fps: 30, scale: 100, rate: 'quality', quality: 'high' } },
  { id: 'wide4k', label: 'Widescreen 4K', spec: { kind: 'video', codec: 'h264', container: 'mp4', box: [3840, 2160], fit: 'contain', fps: 0, scale: 100, rate: 'bitrate', kbps: 40000 } },
  { id: 'email25', label: 'Email-friendly under 25 MB', spec: { kind: 'video', codec: 'h264', container: 'mp4', longEdge: 1280, fps: 30, scale: 100, rate: 'size', mb: 23 } },
  { id: 'gif8', label: 'Small GIF under 8 MB', spec: { kind: 'gif', longEdge: 480, fps: 15, scale: 100, rate: 'size', mb: 7.5 } },
  { id: 'webp5', label: 'Animated WebP under 5 MB', spec: { kind: 'webp-anim', longEdge: 640, fps: 20, scale: 100, rate: 'size', mb: 4.7, quality: 'medium', loops: 0 } },
  { id: 'apng', label: 'Transparent APNG · loops forever', spec: { kind: 'apng', fps: 0, scale: 100, rate: 'quality', loops: 0 } },
  { id: 'psd', label: 'Layered PSD of the current frame', spec: { kind: 'psd', scale: 100 } },
  { id: 'seq', label: 'Frame sequence by timecode', spec: { kind: 'frames', fps: 0, scale: 100, pattern: '{name}_{tc}' } },
];

const pad = (n: number, w = 2): string => String(Math.max(0, Math.floor(n))).padStart(w, '0');

/** Timecode of a movie frame for a file name (colons are not allowed in names): HH-MM-SS-FF. */
export function fileTimecode(frame: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps));
  const f = Math.max(0, Math.round(frame));
  const secs = Math.floor(f / rate);
  return `${pad(Math.floor(secs / 3600))}-${pad(Math.floor(secs / 60) % 60)}-${pad(secs % 60)}-${pad(f % rate)}`;
}

export const DEFAULT_PATTERN = '{name}_{n}';

/** Expands {name} {n} (the 1-based output number) {f} (the movie frame) {tc} (HH-MM-SS-FF) in a frame file name. */
export function frameName(pattern: string, name: string, n: number, digits: number, movieFrame: number, fps: number): string {
  const p = pattern.trim() || DEFAULT_PATTERN;
  const s = p
    .replace(/\{name\}/g, name)
    .replace(/\{n\}/g, pad(n, digits))
    .replace(/\{f\}/g, pad(movieFrame, digits))
    .replace(/\{tc\}/g, fileTimecode(movieFrame, fps));
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '') || `frame_${pad(n, digits)}`;
}
