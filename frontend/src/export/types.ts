// Contract of the exporter (Phase 9): what the Export dialog asks for and what a running job reports.

export type ExportFormat = 'mp4' | 'webm' | 'mov' | 'gif' | 'png-frames' | 'jpg-frames' | 'webp-frames' | 'png-still';

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
  };
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
}

export interface ExportJob {
  onProgress(cb: (p: ExportProgress) => void): void;
  /** Stops within one frame; `result` then rejects with an AbortError. */
  cancel(): void;
  readonly result: Promise<ExportResult>;
}
