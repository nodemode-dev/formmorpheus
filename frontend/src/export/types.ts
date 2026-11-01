// Contract of the exporter (Phase 9): what the Export dialog asks for and what a running job reports.

export type ExportFormat = 'mp4' | 'webm' | 'mov' | 'gif' | 'png-frames' | 'jpg-frames' | 'webp-frames' | 'png-still'
  | 'prores-mov' | 'prores4444-mov' | 'hevc-mp4' | 'hevc-mov'
  | 'tiff-frames' | 'tga-frames' | 'bmp-frames' | 'h264-mov' | 'h264-mp4'
  | 'apng' | 'webp-anim' | 'psd';

export type PictureExt = 'png' | 'jpg' | 'webp' | 'tiff' | 'tga' | 'bmp';
export type AudioKind = 'aac' | 'pcm';
export type ProresProfile = 'proxy' | 'lt' | '422' | 'hq' | '4444' | '4444xq';

export interface Watermark {
  kind: 'text' | 'image';
  text?: string;
  /** A data URL (the picture is read once per export). */
  image?: string;
  color?: string;
  pos: 'tl' | 'tr' | 'bl' | 'br' | 'c';
  /** 0..1 */
  opacity: number;
  /** Percent of the output width (picture) or of its short side (text). */
  size: number;
}

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  height: number;
  /** Movie frames [from, to). */
  from: number;
  to: number;
  pingpong: boolean;
  includeAudio: boolean;
  /** Bring the sound to this integrated loudness in LUFS (-14, -16, -23). */
  loudness?: number;
  alpha: boolean;
  quality: 'low' | 'medium' | 'high' | 'very-high';
  gif: {
    colors: number;
    dither: 'none' | 'floyd-steinberg' | 'ordered';
    palette: string[] | null;
    alphaThreshold: number;
    loop: boolean;
    timing: 'exact' | 'even';
    /** Fixed frame time in ms; 0 or absent is Automatic (1 s / FPS to the nearest 10 ms). */
    frameMs?: number;
    /** Stable (ordered) dithering: matrix doubles per step from 2x2 (0), and the strength 0 to 100. */
    smoothness?: number;
    intensity?: number;
    /** One GIF frame per movie frame (unchanged frames are not merged into holds). */
    exactFrames?: boolean;
  };
  /** Picture type of a still or a sequence; absent means what the format says. */
  picture?: PictureExt;
  tiffDeflate?: boolean;
  audioCodec?: AudioKind;
  proresProfile?: ProresProfile;
  // Delivery (export/delivery.ts); all optional, absent means the movie's own rate, quality presets and size.
  /** Output frame rate; absent: the movie's. */
  fps?: number;
  /** Fit the movie inside the output (letterbox, default), fill it (crop around `focus`), or fit it over a blurred copy of itself ('blur'). */
  fit?: 'contain' | 'cover' | 'blur';
  /** Crop focus for 'cover', as fractions of the movie frame (default the centre). */
  focus?: { x: number; y: number };
  /** A picture or text laid over every frame; absent: none. */
  watermark?: Watermark;
  /** Video bits per second (constant quality when absent). */
  videoBitrate?: number;
  /** Aim for this many bytes: video sets its bitrate, animated pictures shrink until they fit. */
  targetBytes?: number;
  /** APNG and animated WebP: 0 loops forever. */
  loops?: number;
  /** Animated WebP without loss. */
  lossless?: boolean;
  /** Frame file names of a sequence: {name} {n} {f} {tc}. */
  namePattern?: string;
}

export interface ExportProgress {
  done: number;
  total: number;
  stage: 'frames' | 'audio' | 'encoding' | 'finishing';
}

export interface ExportResult {
  blob: Blob;
  name: string;
  mime: string;
  /** Things the exporter changed on the way (a codec fallback, sound left out, alpha not supported). */
  warnings: string[];
  /** The engine already keeps the file in Exports (engine jobs), so the window must not save it again. */
  kept?: boolean;
  /** The graphics context was lost during the run, so part of the frames came from the CPU path; the window says so (the text is its own). */
  gpuReset?: boolean;
}

export interface ExportJob {
  onProgress(cb: (p: ExportProgress) => void): void;
  /** Stops within one frame; `result` then rejects with an AbortError. */
  cancel(): void;
  readonly result: Promise<ExportResult>;
}
