// Contract of the exporter (Phase 9): what the Export dialog asks for and what a running job reports.

export type ExportFormat = 'mp4' | 'webm' | 'mov' | 'gif' | 'png-frames' | 'jpg-frames' | 'webp-frames' | 'png-still'
  | 'prores-mov' | 'prores4444-mov' | 'hevc-mp4' | 'hevc-mov'
  | 'tiff-frames' | 'tga-frames' | 'bmp-frames' | 'h264-mov' | 'h264-mp4';

export type PictureExt = 'png' | 'jpg' | 'webp' | 'tiff' | 'tga' | 'bmp';
export type AudioKind = 'aac' | 'pcm';
export type ProresProfile = 'proxy' | 'lt' | '422' | 'hq' | '4444' | '4444xq';

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  height: number;
  /** Movie frames [from, to). */
  from: number;
  to: number;
  pingpong: boolean;
  includeAudio: boolean;
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
  };
  /** Picture type of a still or a sequence; absent means what the format says. */
  picture?: PictureExt;
  tiffDeflate?: boolean;
  audioCodec?: AudioKind;
  proresProfile?: ProresProfile;
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
}

export interface ExportJob {
  onProgress(cb: (p: ExportProgress) => void): void;
  /** Stops within one frame; `result` then rejects with an AbortError. */
  cancel(): void;
  readonly result: Promise<ExportResult>;
}
