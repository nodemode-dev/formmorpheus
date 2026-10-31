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
   * `lane` names the decode focus (the block's content id): blocks of one asset at different times each get
   * their own, so their seeks do not fight.
   */
  frame(assetId: string, seconds: number, lane?: string): CanvasImageSource | null;
  /** Resolves when `frame(assetId, seconds)` will return the exact frame for that time (export, thumbnails). */
  exact(assetId: string, seconds: number, lane?: string): Promise<void>;
  /** Hint during playback: decode ahead from `seconds` for `ahead` seconds. */
  prefetch(assetId: string, seconds: number, ahead: number, lane?: string): void;
  /** Drops a lane that is no longer needed (a prefetch for the start of a looping movie). */
  release?(assetId: string, lane: string): void;
}

/** One sounding block for the audio engine: where it plays in the movie and which asset seconds it reads. */
export interface AudioClip {
  contentId: string;
  assetId: string;
  /** Movie seconds where the clip starts and ends. */
  start: number;
  end: number;
  /** Asset seconds read at `start` (for a reversed clip, the upper end of the part that plays, read backward). */
  offset: number;
  /** Retimed block (engine/retime.ts): speed, direction, and whether the pitch is kept. Absent: normal. */
  retime?: { speed: number; reverse: boolean; keepPitch: boolean };
  /** Linear gain over movie time (content volume times the Volume lane), sampled by the engine. */
  gain: (movieSeconds: number) => number;
  /** Stereo position -1..1 over movie time; absent: centre. */
  pan?: (movieSeconds: number) => number;
  /** Fade lengths in seconds, and the whole block's span in movie seconds (the clip itself may be cut by a group). */
  fadeIn?: number;
  fadeOut?: number;
  blockStart?: number;
  blockEnd?: number;
}

export interface ClockSource {
  /** Milliseconds on the playback clock (the audio hardware clock while sound plays). */
  now(): number;
}
