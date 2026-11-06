// Messages between the export window and the export worker (export-worker.ts). Types only.
import type { Movie } from '../engine/types';
import type { ExportOptions, ExportProgress } from './types';

/** One @font-face of the page's own fonts, read from its stylesheets, so the worker can load the same file. */
export interface FaceRule { family: string; url: string; weight: string; style: string; unicodeRange: string; stretch: string }

/** A face to load before drawing (what ensureTextFont loads on the main thread). */
export interface FontLoad { spec: string; text: string }

export interface StartMsg {
  t: 'start';
  /** 'file': run the whole export and send back the file; 'frames': send back one PNG per frame, in order. */
  mode: 'file' | 'frames';
  movie: Movie;
  /** Stored files of the pictures and fonts the movie uses. */
  blobs: Record<string, Blob>;
  faces: FaceRule[];
  loads: FontLoad[];
  /** The page composes on the GPU: the worker must too (or say it cannot, and the page falls back). */
  gpu: boolean;
  /** iPad: the page's memory tier, so the worker's caches use the same limits (absent on desktop). */
  memTier?: 'high' | 'mid' | 'low' | 'floor';
  opts: ExportOptions;
  /** Frames mode: key alpha, and the frame list length. */
  keepAlpha?: boolean;
  frameList?: number[];
  /** File mode: the sound mixdown made on the page (OfflineAudioContext is not in workers); null when there is none. */
  audio?: { present: boolean; sampleRate: number; channels: Float32Array[] | null };
}

export type ToWorker = StartMsg | { t: 'cancel' } | { t: 'consumed'; count: number };

export type FromWorker =
  | { t: 'ready' }
  | { t: 'progress'; p: ExportProgress }
  | { t: 'done'; blob: Blob; name: string; mime: string; warnings: string[]; gpuReset?: boolean }
  | { t: 'frame'; index: number; blob: Blob }
  | { t: 'error'; message: string; abort: boolean; fallback: boolean };
