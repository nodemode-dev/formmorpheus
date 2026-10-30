// Contracts of the media layer (Phase 8): decoding video and sound, the audio clock, and what the
// renderer and the exporter ask of them. Implementations: video.ts (VideoPool), audio.ts (AudioEngine),
// import.ts (probing and turning files into assets and content).

/** What a probe of a media file found. Durations in seconds. */
export interface MediaInfo {
  kind: 'video' | 'audio' | 'image' | 'animated-image' | 'font';
  mime: string;
  width: number;
  height: number;
  /** Seconds; 0 for a still. */
  duration: number;
  /** The source's own frame rate (video, animated image); 0 when unknown or a still. */
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  codec: string;
}

/** The renderer's view of decoded video. */
export interface VideoSource {
  /**
   * The frame shown at `seconds` into the asset, synchronously, for on-screen drawing: the decoded frame
   * nearest at or before that time when cached, otherwise the last frame drawn for that asset (never a
   * blank), while a decode is requested in the background (the pool calls its onReady when it lands).
   */
  frame(assetId: string, seconds: number): CanvasImageSource | null;
  /** Resolves when `frame(assetId, seconds)` will return the exact frame for that time (export, thumbnails). */
  exact(assetId: string, seconds: number): Promise<void>;
  /** Hint during playback: decode ahead from `seconds` for `ahead` seconds. */
  prefetch(assetId: string, seconds: number, ahead: number): void;
}

/** One sounding block for the audio engine: where it plays in the movie and which asset seconds it reads. */
export interface AudioClip {
  contentId: string;
  assetId: string;
  /** Movie seconds where the clip starts and ends. */
  start: number;
  end: number;
  /** Asset seconds read at `start`. */
  offset: number;
  /** Linear gain over movie time (content volume times the Volume lane), sampled by the engine. */
  gain: (movieSeconds: number) => number;
}

export interface ClockSource {
  /** Milliseconds on the playback clock (the audio hardware clock while sound plays). */
  now(): number;
}
