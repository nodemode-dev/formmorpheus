// The exporter: renders movie frames offscreen and hands them to an encoder (mediabunny for video,
// GifWriter for GIF, a zip for picture sequences). One job per call; cancel() stops within a frame.
import {
  AudioBufferSource, BufferTarget, CanvasSource, MovOutputFormat, Mp4OutputFormat, Output, QUALITY_HIGH,
  QUALITY_LOW, QUALITY_MEDIUM, QUALITY_VERY_HIGH, WebMOutputFormat, canEncodeAudio, canEncodeVideo,
  type AudioCodec, type Quality, type VideoCodec,
} from 'mediabunny';
import { Zip, ZipPassThrough } from 'fflate';
import type { Movie } from '../engine/types';
import type { Renderer, View } from '../engine/render';
import type { AudioEngine } from '../media/audio';
import { GifWriter, quantize } from './gif';
import { encodeRaw, pictureHasAlpha, pictureMime, type RawPicture } from './still-formats';
import type { ExportJob, ExportOptions, ExportProgress, ExportResult, PictureExt } from './types';

type Deps = { movie: Movie; renderer: Renderer; audio: AudioEngine | null };

const QUALITY: Record<ExportOptions['quality'], Quality> = {
  low: QUALITY_LOW, medium: QUALITY_MEDIUM, high: QUALITY_HIGH, 'very-high': QUALITY_VERY_HIGH,
};
const JPEG_QUALITY: Record<ExportOptions['quality'], number> = { low: 0.6, medium: 0.8, high: 0.92, 'very-high': 0.98 };
const GIF_MEMORY_LIMIT = 1.5 * 1024 * 1024 * 1024;
const GIF_SAMPLE_FRAMES = 24;

/** True when this browser can encode AAC sound (otherwise the engine does it). */
export async function browserHasAac(): Promise<boolean> {
  try {
    for (const sampleRate of [44100, 48000]) if (!(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate, quality: QUALITY_HIGH }))) return false;
    return true;
  } catch { return false; }
}

function abortError(): Error {
  return new DOMException('Export cancelled', 'AbortError');
}

function safeName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim();
  return s || 'movie';
}

/** A macrotask turn that is not throttled in background tabs. */
function yieldTurn(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

/** Movie frame of output step `i`: forward through [from, to), then back down to from + 1 for ping pong. */
function frameAt(i: number, from: number, to: number): number {
  const n = to - from;
  return i < n ? from + i : to - 2 - (i - n);
}

function stepCount(o: ExportOptions): number {
  const n = Math.max(1, o.to - o.from);
  return o.pingpong && n >= 3 ? n + (n - 2) : n;
}

export function startExport(deps: Deps, opts: ExportOptions): ExportJob {
  const listeners: ((p: ExportProgress) => void)[] = [];
  let cancelled = false;
  let onCancel: (() => void) | null = null;
  const job: ExportJob = {
    onProgress: (cb) => { listeners.push(cb); },
    cancel: () => { cancelled = true; onCancel?.(); },
    result: Promise.resolve(null as never),
  };
  const progress = (stage: ExportProgress['stage'], done: number, total: number) => {
    const p = { stage, done, total };
    for (const cb of listeners) cb(p);
  };
  const run = new Run(deps, normalise(opts), progress, () => cancelled, (fn) => { onCancel = fn; });
  (job as { result: Promise<ExportResult> }).result = run.go();
  // A caller that never reads `result` after cancelling must not trip an unhandled rejection.
  job.result.catch(() => {});
  return job;
}

function normalise(o: ExportOptions): ExportOptions {
  const video = o.format === 'mp4' || o.format === 'webm' || o.format === 'mov';
  let width = Math.max(1, Math.round(o.width)), height = Math.max(1, Math.round(o.height));
  if (video) { width = Math.max(2, width & ~1); height = Math.max(2, height & ~1); }
  const from = Math.max(0, Math.round(o.from));
  const to = Math.max(from + 1, Math.round(o.to));
  return { ...o, width, height, from, to };
}

class Run {
  private readonly warnings: string[] = [];
  private readonly canvas: OffscreenCanvas;
  private readonly ctx: OffscreenCanvasRenderingContext2D;
  private readonly view: View;
  private keepAlpha: boolean;

  constructor(
    private readonly deps: Deps,
    private readonly o: ExportOptions,
    private readonly progress: (stage: ExportProgress['stage'], done: number, total: number) => void,
    private readonly isCancelled: () => boolean,
    private readonly setCancel: (fn: () => void) => void,
  ) {
    const { movie } = deps;
    this.canvas = new OffscreenCanvas(o.width, o.height);
    const gif = o.format === 'gif' || /^(tiff|tga|bmp)-frames$/.test(o.format) || o.picture === 'tiff' || o.picture === 'tga' || o.picture === 'bmp';
    this.ctx = this.canvas.getContext('2d', gif ? { willReadFrequently: true } : undefined) as OffscreenCanvasRenderingContext2D;
    const scale = Math.min(o.width / movie.width, o.height / movie.height);
    this.view = { scale, ox: (o.width - movie.width * scale) / 2, oy: (o.height - movie.height * scale) / 2, width: o.width, height: o.height };
    this.keepAlpha = o.alpha && pictureHasAlpha(this.ext());
  }

  /** The picture type of a still or sequence (a plain GIF or video has no picture type and counts as png). */
  private ext(): PictureExt {
    const o = this.o;
    if (o.picture && (o.format === 'png-still' || o.format.endsWith('-frames'))) return o.picture;
    switch (o.format) {
      case 'jpg-frames': return 'jpg';
      case 'webp-frames': return 'webp';
      case 'tiff-frames': return 'tiff';
      case 'tga-frames': return 'tga';
      case 'bmp-frames': return 'bmp';
      default: return 'png';
    }
  }

  private check(): void {
    if (this.isCancelled()) throw abortError();
  }

  /** Renders movie frame `f` onto the shared canvas. */
  private async render(f: number): Promise<void> {
    const { movie, renderer } = this.deps;
    await renderer.prepareFrame(movie, f);
    renderer.drawFrame(this.ctx, movie, f, this.view, {
      backstage: false, background: movie.background, transparentChecker: null, keepAlpha: this.keepAlpha,
    });
  }

  private name(ext: string): string {
    return `${safeName(this.deps.movie.name)}.${ext}`;
  }

  async go(): Promise<ExportResult> {
    const fmt = this.o.format;
    // the GPU switch holds still for the whole export, so no frame is composed by the other path
    const unpin = this.deps.renderer.pinGpu();
    try {
      this.check();
      let r: Omit<ExportResult, 'warnings'>;
      if (fmt === 'mp4' || fmt === 'webm' || fmt === 'mov') r = await this.video(fmt);
      else if (fmt === 'gif') r = await this.gif();
      else if (fmt === 'png-still') r = await this.still();
      else if (fmt === 'prores-mov' || fmt === 'prores4444-mov' || fmt === 'hevc-mp4' || fmt === 'hevc-mov' || fmt === 'h264-mov' || fmt === 'h264-mp4') throw new Error('This format is encoded by the engine, not in the window.');
      else r = await this.sequence(fmt);
      return { ...r, warnings: this.warnings };
    } catch (e) {
      if (this.isCancelled() && !(e instanceof DOMException && e.name === 'AbortError')) throw abortError();
      throw e;
    } finally {
      unpin();
    }
  }

  // Video ----------------------------------------------------------------------------------------

  private async pickVideoCodec(fmt: 'mp4' | 'webm' | 'mov', supported: VideoCodec[]): Promise<{ codec: VideoCodec; alpha: boolean } | null> {
    const { width, height } = this.o;
    const quality = QUALITY[this.o.quality];
    const order: VideoCodec[] = fmt === 'webm' ? ['vp9', 'av1', 'vp8'] : ['avc', 'hevc', 'av1', 'vp9'];
    const wantAlpha = this.o.alpha && this.deps.movie.transparent;
    if (wantAlpha) {
      if (fmt === 'webm' && supported.includes('vp9') &&
          await canEncodeVideo('vp9', { width, height, quality, frameRate: this.deps.movie.fps, alpha: 'keep' })) {
        return { codec: 'vp9', alpha: true };
      }
      this.warnings.push(fmt === 'webm'
        ? 'This browser cannot encode WebM with transparency, so the background is filled.'
        : `${fmt.toUpperCase()} cannot carry transparency here (use WebM), so the background is filled.`);
    }
    for (const codec of order) {
      if (!supported.includes(codec)) continue;
      if (await canEncodeVideo(codec, { width, height, quality, frameRate: this.deps.movie.fps })) return { codec, alpha: false };
    }
    return null;
  }

  private async video(fmt: 'mp4' | 'webm' | 'mov'): Promise<Omit<ExportResult, 'warnings'>> {
    const { movie, audio } = this.deps;
    const o = this.o;
    const total = stepCount(o);
    const format = fmt === 'mp4' ? new Mp4OutputFormat() : fmt === 'mov' ? new MovOutputFormat() : new WebMOutputFormat();
    const picked = await this.pickVideoCodec(fmt, format.getSupportedVideoCodecs());
    if (!picked) throw new Error(`This browser cannot encode ${fmt.toUpperCase()} video at ${o.width} x ${o.height}.`);
    // the encoder decides: w/o alpha in the codec the background must be painted, not left transparent (it would encode black)
    this.keepAlpha = this.keepAlpha && picked.alpha;
    this.check();

    // Sound first: the mixdown is a quick offline render, and decides whether an audio track exists.
    let mix: AudioBuffer | null = null;
    let audioCodec: AudioCodec | null = null;
    if (o.includeAudio && audio) {
      this.progress('audio', 0, 1);
      const forward = await audio.mixdown(movie, o.from, o.to);
      this.progress('audio', 1, 1);
      this.check();
      if (forward) {
        audioCodec = await this.pickAudioCodec(fmt, format.getSupportedAudioCodecs(), forward);
        if (audioCodec) mix = o.pingpong && total > o.to - o.from ? padSilence(forward, total / movie.fps) : forward;
        else this.warnings.push('No audio encoder is available in this browser, so the sound was left out.');
      }
    }

    const target = new BufferTarget();
    const output = new Output({ format, target });
    this.setCancel(() => { void output.cancel().catch(() => {}); });
    const source = new CanvasSource(this.canvas, {
      codec: picked.codec, quality: QUALITY[o.quality], alpha: picked.alpha ? 'keep' : 'discard',
    });
    output.addVideoTrack(source, { frameRate: movie.fps });
    let asource: AudioBufferSource | null = null;
    if (mix && audioCodec) {
      asource = new AudioBufferSource({ codec: audioCodec, quality: QUALITY[o.quality] });
      output.addAudioTrack(asource);
    }
    try {
      await output.start();
      // Not awaited until the picture is done: awaiting it here could wait on a track that has not started.
      const audioDone = asource && mix ? asource.add(mix) : Promise.resolve();
      audioDone.catch(() => {});
      const dt = 1 / movie.fps;
      for (let i = 0; i < total; i++) {
        this.check();
        await this.render(frameAt(i, o.from, o.to));
        this.check();
        await source.add(i * dt, dt);
        this.progress('frames', i + 1, total);
        await yieldTurn();
      }
      this.progress('finishing', 0, 1);
      source.close();
      asource?.close();
      await audioDone;
      await output.finalize();
      this.progress('finishing', 1, 1);
    } catch (e) {
      try { await output.cancel(); } catch { /* already closed */ }
      if (this.isCancelled()) throw abortError();
      throw e;
    }
    const buf = target.buffer;
    if (!buf) throw new Error('The encoder produced no data.');
    const mime = fmt === 'mp4' ? 'video/mp4' : fmt === 'mov' ? 'video/quicktime' : 'video/webm';
    return { blob: new Blob([buf], { type: mime }), name: this.name(fmt), mime };
  }

  private async pickAudioCodec(fmt: 'mp4' | 'webm' | 'mov', supported: AudioCodec[], buf: AudioBuffer): Promise<AudioCodec | null> {
    const opts = { numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate, quality: QUALITY[this.o.quality] };
    if (this.o.audioCodec === 'pcm' && fmt === 'mov' && supported.includes('pcm-s16') && await canEncodeAudio('pcm-s16', opts)) return 'pcm-s16';
    const order: AudioCodec[] = fmt === 'webm' ? ['opus', 'vorbis'] : ['aac', 'opus'];
    for (const codec of order) {
      if (!supported.includes(codec)) continue;
      if (await canEncodeAudio(codec, opts)) {
        if (codec !== order[0]) this.warnings.push(`AAC is not available in this browser, so the sound was encoded as ${codec === 'opus' ? 'Opus' : codec}.`);
        return codec;
      }
    }
    return null;
  }

  // GIF ------------------------------------------------------------------------------------------

  private grab(): Uint8ClampedArray {
    return this.ctx.getImageData(0, 0, this.o.width, this.o.height).data;
  }

  private async gif(): Promise<Omit<ExportResult, 'warnings'>> {
    const { movie } = this.deps;
    const o = this.o;
    const total = stepCount(o);
    const n = o.to - o.from;
    const bytes = o.width * o.height * 4;
    const keep = n * bytes < GIF_MEMORY_LIMIT;
    // Frames are numbered by source frame (0..n-1); ping pong repeats earlier ones.
    const cache = new Map<number, Uint8ClampedArray>();
    const pick = Math.min(n, GIF_SAMPLE_FRAMES);
    const sample: number[] = [];
    for (let k = 0; k < pick; k++) sample.push(Math.min(n - 1, Math.floor((k * n) / pick)));
    const sampleData: Uint8ClampedArray[] = [];

    // Pass one: the palette comes from a spread of frames, so the first frame cannot dictate it.
    // The renders count toward the first half of the progress bar.
    const grabStep = keep ? n : pick;
    let grabbed = 0;
    for (const s of keep ? Array.from({ length: n }, (_, i) => i) : sample) {
      this.check();
      await this.render(o.from + s);
      const px = this.grab();
      if (keep) cache.set(s, px);
      if (sample.includes(s)) sampleData.push(keep ? px : new Uint8ClampedArray(px));
      this.progress('frames', ++grabbed, grabStep);
      await yieldTurn();
    }
    this.progress('encoding', 0, total);
    const palette = quantize(sampleData, Math.max(2, Math.min(256, Math.round(o.gif.colors))), o.gif.palette, o.gif.alphaThreshold);
    sampleData.length = 0;
    this.check();

    const writer = new GifWriter(o.width, o.height, o.gif.loop);
    writer.setOrdered(o.gif.smoothness ?? 2, o.gif.intensity ?? 50);
    const ideal = 100 / movie.fps;
    let emitted = 0;
    for (let i = 0; i < total; i++) {
      this.check();
      const f = frameAt(i, o.from, o.to);
      let px = cache.get(f - o.from);
      if (!px) {
        await this.render(f);
        px = this.grab();
      }
      let delay: number;
      if (o.gif.frameMs && o.gif.frameMs > 0) {
        delay = Math.max(2, Math.round(o.gif.frameMs / 10));
      } else if (o.gif.timing === 'exact') {
        delay = Math.max(2, Math.round((i + 1) * ideal - emitted));
        emitted += delay;
      } else {
        delay = Math.max(2, Math.round(ideal));
      }
      writer.addFrame(px, delay, palette, o.gif.dither, o.gif.alphaThreshold);
      this.progress('encoding', i + 1, total);
      await yieldTurn();
    }
    cache.clear();
    this.progress('finishing', 0, 1);
    const data = writer.finish();
    this.progress('finishing', 1, 1);
    return { blob: new Blob([data as BlobPart], { type: 'image/gif' }), name: this.name('gif'), mime: 'image/gif' };
  }

  // Pictures -------------------------------------------------------------------------------------

  /** The canvas as a file of the chosen picture type. */
  private async toBlob(ext: PictureExt): Promise<Blob> {
    if (ext === 'tiff' || ext === 'tga' || ext === 'bmp') {
      const bytes = encodeRaw(ext as RawPicture, this.grab(), this.o.width, this.o.height, this.keepAlpha, this.o.tiffDeflate === true);
      return new Blob([bytes as BlobPart], { type: pictureMime(ext) });
    }
    const type = pictureMime(ext);
    const q = ext === 'png' ? undefined : JPEG_QUALITY[this.o.quality];
    return this.canvas.convertToBlob({ type, quality: q });
  }

  private async still(): Promise<Omit<ExportResult, 'warnings'>> {
    const ext = this.ext();
    this.progress('frames', 0, 1);
    await this.render(this.o.from);
    const blob = await this.toBlob(ext);
    this.progress('frames', 1, 1);
    return { blob, name: this.name(ext), mime: pictureMime(ext) };
  }

  private async sequence(_fmt: ExportOptions['format']): Promise<Omit<ExportResult, 'warnings'>> {
    const o = this.o;
    const total = stepCount(o);
    const ext = this.ext();
    const base = safeName(this.deps.movie.name);
    const parts: BlobPart[] = [];
    let failure: Error | null = null;
    const zip = new Zip((err, chunk) => {
      if (err) failure = err;
      else parts.push(chunk);
    });
    const digits = Math.max(5, String(total).length);
    for (let i = 0; i < total; i++) {
      this.check();
      await this.render(frameAt(i, o.from, o.to));
      const blob = await this.toBlob(ext);
      const entry = new ZipPassThrough(`${base}/${base}_${String(i + 1).padStart(digits, '0')}.${ext}`);
      zip.add(entry);
      entry.push(new Uint8Array(await blob.arrayBuffer()), true);
      if (failure) throw failure;
      this.progress('frames', i + 1, total);
      await yieldTurn();
    }
    this.progress('finishing', 0, 1);
    zip.end();
    if (failure) throw failure;
    this.progress('finishing', 1, 1);
    return { blob: new Blob(parts, { type: 'application/zip' }), name: this.name('zip'), mime: 'application/zip' };
  }
}

/** The mixdown followed by silence up to `seconds` (the return leg of a ping pong). */
function padSilence(buf: AudioBuffer, seconds: number): AudioBuffer {
  const length = Math.max(buf.length, Math.round(seconds * buf.sampleRate));
  const out = new AudioBuffer({ length, sampleRate: buf.sampleRate, numberOfChannels: buf.numberOfChannels });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c), c);
  return out;
}
