// The exporter: renders movie frames offscreen and hands them to an encoder (mediabunny for video,
// GifWriter for GIF, a zip for picture sequences). One job per call; cancel() stops within a frame.
import {
  AudioSample, AudioSampleSource, BufferTarget, CanvasSource, MovOutputFormat, Mp4OutputFormat, Output, QUALITY_HIGH,
  QUALITY_LOW, QUALITY_MEDIUM, QUALITY_VERY_HIGH, WebMOutputFormat, canEncodeAudio, canEncodeVideo,
  type AudioCodec, type Quality, type VideoCodec,
} from 'mediabunny';
import { Zip, ZipPassThrough } from 'fflate';
import type { Content, Movie } from '../engine/types';
import type { Renderer, View } from '../engine/render';
import type { AudioEngine } from '../media/audio';
import { GifWriter, quantize } from './gif';
import { encodeRaw, pictureHasAlpha, pictureMime, type RawPicture } from './still-formats';
import { bitrateForSize, frameName, movieFrameAt, outFps, stepsFor, viewFor } from './delivery';
import { drawDelivery, loadWatermark, type ReadyWatermark } from './reframe';
import { ApngWriter, APNG_MAX_BYTES, SizeOver, WebpAnimWriter } from './anim-image';
import { encodePsdLayer, writePsdEncoded, PSD_MAX_BYTES, type PsdEncodedLayer } from './psd';
import { animate } from '../engine/keys';
import type { ExportJob, ExportOptions, ExportProgress, ExportResult, PictureExt } from './types';
/** A finished sound mixdown as planar PCM (an AudioBuffer fits; a worker has no AudioBuffer, so it gets plain arrays). */
export interface PcmMix {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}
export type MixSource = Pick<AudioEngine, 'mixdown'> | { mixdown(movie: Movie, from: number, to: number, sampleRate?: number, only?: string, lufs?: number): Promise<PcmMix | null> };
export type Deps = { movie: Movie; renderer: Renderer; audio: MixSource | null };

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

/** Exports on this thread (also what runs inside the export worker, and the fallback of export/worker-host.ts). */
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

export function normalise(o: ExportOptions): ExportOptions {
  const video = o.format === 'mp4' || o.format === 'webm' || o.format === 'mov';
  let width = Math.max(1, Math.round(o.width)), height = Math.max(1, Math.round(o.height));
  if (video) { width = Math.max(2, width & ~1); height = Math.max(2, height & ~1); }
  const from = Math.max(0, Math.round(o.from));
  const to = Math.max(from + 1, Math.round(o.to));
  return { ...o, width, height, from, to };
}

export class Run {
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
    const gif = o.format === 'gif' || o.format === 'apng' || o.format === 'psd' || /^(tiff|tga|bmp)-frames$/.test(o.format) || o.picture === 'tiff' || o.picture === 'tga' || o.picture === 'bmp';
    this.ctx = this.canvas.getContext('2d', gif ? { willReadFrequently: true } : undefined) as OffscreenCanvasRenderingContext2D;
    this.view = viewFor(o, movie.width, movie.height);
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
    if (!this.wmLoaded) { this.wm = await loadWatermark(this.o.watermark); this.wmLoaded = true; }
    drawDelivery(renderer, this.ctx, movie, f, this.o, this.keepAlpha, this.wm);
  }
  private wm: ReadyWatermark | null = null;
  private wmLoaded = false;

  private name(ext: string): string {
    return `${safeName(this.deps.movie.name)}.${ext}`;
  }

  /** Output frame count at the output rate, and the movie frame shown by output frame `i`. */
  private steps(): number { return stepsFor(this.o, this.deps.movie.fps); }
  private at(i: number): number { return movieFrameAt(i, this.o, this.deps.movie.fps); }
  private bitrateUsed = 0;

  /** Runs once; when a target size is set, runs again with a smaller (or larger) bitrate or picture until the file fits. */
  async go(): Promise<ExportResult> {
    const o = this.o;
    const limit = o.targetBytes;
    const sized = !!limit && (o.format === 'mp4' || o.format === 'webm' || o.format === 'mov' || o.format === 'gif' || o.format === 'apng' || o.format === 'webp-anim');
    // a pass that stops early as far over the target reports its projected size instead of a file
    const attempt = async (r: Run): Promise<{ res: ExportResult | null; size: number }> => {
      try { const out = await r.once(); return { res: out, size: out.blob.size }; } catch (e) {
        if (sized && e instanceof SizeOver) return { res: null, size: e.estimate };
        throw e;
      }
    };
    const first = await attempt(this);
    if (!sized || !limit) return first.res as ExportResult;
    let res = first.res, size = first.size;
    const video = o.format === 'mp4' || o.format === 'webm' || o.format === 'mov';
    let cur: ExportOptions = o, bitrate = this.bitrateUsed;
    // the best file so far: the largest one that is not over the target
    let best: ExportResult | null = res && size <= limit ? res : null;
    for (let pass = 0; pass < (video ? 3 : 6); pass++) {
      const ratio = limit / Math.max(1, size);
      // within 8 % under the target is close enough; a picture also stops at the size that was asked for
      if (ratio >= 1 && (ratio <= 1.08 || (!video && cur.width >= o.width))) break;
      if (video) {
        bitrate = Math.max(30_000, Math.round(bitrate * ratio * 0.98));
        cur = { ...cur, videoBitrate: bitrate };
      } else {
        const k = Math.sqrt(ratio) * (ratio < 1 ? 0.95 : 0.99);
        const w = Math.min(o.width, Math.max(16, Math.round(cur.width * k)));
        cur = { ...cur, width: w, height: Math.min(o.height, Math.max(16, Math.round((cur.height * w) / cur.width))) };
      }
      const next = new Run(this.deps, cur, this.progress, this.isCancelled, this.setCancel);
      next.warnings.push(...this.warnings);
      const a = await attempt(next);
      res = a.res;
      size = a.size;
      bitrate = next.bitrateUsed || bitrate;
      if (res && size <= limit && (!best || size > best.blob.size)) best = res;
    }
    if (best) return best;
    if (!res) throw new SizeOver(size, 'The picture could not be made small enough for the size you asked for.');
    if (size > limit * 1.001) res.warnings.push('The file could not be made small enough for the size you asked for.');
    return res;
  }

  private async once(): Promise<ExportResult> {
    const fmt = this.o.format;
    // the GPU switch holds still for the whole export, so no frame is composed by the other path
    const unpinGpu = this.deps.renderer.pinGpu();
    const unpinOriginals = this.deps.renderer.pinOriginals();
    const unpin = (): void => { unpinOriginals(); unpinGpu(); };
    try {
      this.check();
      let r: Omit<ExportResult, 'warnings'>;
      if (fmt === 'mp4' || fmt === 'webm' || fmt === 'mov') r = await this.video(fmt);
      else if (fmt === 'gif') r = await this.gif();
      else if (fmt === 'png-still') r = await this.still();
      else if (fmt === 'apng' || fmt === 'webp-anim') r = await this.animated(fmt);
      else if (fmt === 'psd') r = await this.psd();
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
    const total = this.steps();
    const fps = outFps(o, movie.fps);
    const format = fmt === 'mp4' ? new Mp4OutputFormat() : fmt === 'mov' ? new MovOutputFormat() : new WebMOutputFormat();
    const picked = await this.pickVideoCodec(fmt, format.getSupportedVideoCodecs());
    if (!picked) throw new Error(`This browser cannot encode ${fmt.toUpperCase()} video at ${o.width} x ${o.height}.`);
    // the encoder decides: w/o alpha in the codec the background must be painted, not left transparent (it would encode black)
    this.keepAlpha = this.keepAlpha && picked.alpha;
    this.check();

    // Sound first: the mixdown is a quick offline render, and decides whether an audio track exists.
    let mix: PcmMix | null = null;
    let audioCodec: AudioCodec | null = null;
    if (o.includeAudio && audio) {
      this.progress('audio', 0, 1);
      const forward = await audio.mixdown(movie, o.from, o.to, 48000, undefined, o.loudness);
      this.progress('audio', 1, 1);
      this.check();
      if (forward) {
        audioCodec = await this.pickAudioCodec(fmt, format.getSupportedAudioCodecs(), forward);
        if (audioCodec) mix = o.pingpong && total > ((o.to - o.from) * fps) / movie.fps ? padSilence(forward, total / fps) : forward;
        else this.warnings.push('No audio encoder is available in this browser, so the sound was left out.');
      }
    }

    const target = new BufferTarget();
    const output = new Output({ format, target });
    this.setCancel(() => { void output.cancel().catch(() => {}); });
    // a target size becomes a constant bitrate; an explicit bitrate stays variable
    const bits = o.videoBitrate ?? (o.targetBytes ? bitrateForSize(o.targetBytes, total / fps, mix !== null && audioCodec !== null) : 0);
    this.bitrateUsed = bits;
    const source = new CanvasSource(this.canvas, {
      codec: picked.codec, alpha: picked.alpha ? 'keep' : 'discard',
      ...(bits > 0 ? { bitrate: bits, bitrateMode: o.targetBytes ? ('constant' as const) : ('variable' as const) } : { quality: QUALITY[o.quality] }),
    });
    output.addVideoTrack(source, { frameRate: fps });
    let asource: AudioSampleSource | null = null;
    if (mix && audioCodec) {
      asource = new AudioSampleSource({ codec: audioCodec, quality: QUALITY[o.quality] });
      output.addAudioTrack(asource);
    }
    try {
      await output.start();
      // Not awaited until the picture is done: awaiting it here could wait on a track that has not started.
      const audioDone = asource && mix ? addPcm(asource, mix) : Promise.resolve();
      audioDone.catch(() => {});
      const dt = 1 / fps;
      for (let i = 0; i < total; i++) {
        this.check();
        await this.render(this.at(i));
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

  private async pickAudioCodec(fmt: 'mp4' | 'webm' | 'mov', supported: AudioCodec[], buf: PcmMix): Promise<AudioCodec | null> {
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
    const total = this.steps();
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
    const ideal = 100 / outFps(o, movie.fps);
    let emitted = 0;
    for (let i = 0; i < total; i++) {
      this.check();
      const f = this.at(i);
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

  // Animated pictures and layered files ------------------------------------------------------------

  private async animated(fmt: 'apng' | 'webp-anim'): Promise<Omit<ExportResult, 'warnings'>> {
    const { movie } = this.deps;
    const o = this.o;
    const total = this.steps();
    const fps = outFps(o, movie.fps);
    const loops = Math.max(0, Math.round(o.loops ?? 0));
    if (fmt === 'apng') {
      // the delay is 1 / fps seconds, kept exact inside the 16 bit fraction
      const [dn, dd] = fps <= 65 ? [1000, Math.round(fps * 1000)] : [1, Math.max(1, Math.round(fps))];
      // with a target size, a pass that is clearly over (4x) stops early instead of finishing a huge file
      const w = new ApngWriter(o.width, o.height, this.keepAlpha, total, loops, dn, dd, o.targetBytes ? Math.min(APNG_MAX_BYTES, o.targetBytes * 4) : APNG_MAX_BYTES);
      for (let i = 0; i < total; i++) {
        this.check();
        await this.render(this.at(i));
        w.addFrame(this.grab());
        this.progress('frames', i + 1, total);
        await yieldTurn();
      }
      this.progress('finishing', 0, 1);
      const blob = w.finish();
      this.progress('finishing', 1, 1);
      return { blob, name: this.name('png'), mime: 'image/png' };
    }
    const w = new WebpAnimWriter(o.width, o.height);
    const q = o.lossless ? 1 : Math.min(0.97, JPEG_QUALITY[o.quality]);
    let at = 0;
    for (let i = 0; i < total; i++) {
      this.check();
      await this.render(this.at(i));
      const blob = await this.canvas.convertToBlob({ type: 'image/webp', quality: q });
      // frame times are rounded on the running total, so 30 fps does not drift to 30.3
      const next = Math.round(((i + 1) * 1000) / fps);
      w.addFrame(new Uint8Array(await blob.arrayBuffer()), next - at);
      at = next;
      this.progress('frames', i + 1, total);
      await yieldTurn();
    }
    this.progress('finishing', 0, 1);
    const data = w.finish(loops);
    this.progress('finishing', 1, 1);
    return { blob: new Blob([data as BlobPart], { type: 'image/webp' }), name: this.name('webp'), mime: 'image/webp' };
  }

  /** One layer per visible track at the first frame, with the block's blend mode and opacity; the flattened picture beside them. */
  private async psd(): Promise<Omit<ExportResult, 'warnings'>> {
    const { movie, renderer } = this.deps;
    const o = this.o;
    const f = o.from;
    const live = (c: Content): boolean => f >= c.start && f < c.start + c.duration;
    const tracks = movie.tracks.filter((t) => !t.hidden && t.content.some(live));
    const total = tracks.length + 1;
    this.progress('frames', 0, total);
    await this.render(f);
    const merged = new Uint8ClampedArray(this.grab());
    this.progress('frames', 1, total);
    // each layer is encoded as soon as it is drawn and its pixels dropped: only the compressed layers pile up
    const layers: PsdEncodedLayer[] = [];
    let held = 0;
    const keep = (l: PsdEncodedLayer): void => {
      held += l.rec.length + l.dat.length;
      if (held > PSD_MAX_BYTES / 2) throw new Error('These layers are too large for one PSD file (about 2 GB). Export fewer tracks or a smaller size.');
      layers.push(l);
    };
    if (!this.keepAlpha) {
      const px = new OffscreenCanvas(1, 1).getContext('2d') as OffscreenCanvasRenderingContext2D;
      px.fillStyle = movie.background;
      px.fillRect(0, 0, 1, 1);
      const c = px.getImageData(0, 0, 1, 1).data;
      const fill = new Uint8ClampedArray(o.width * o.height * 4);
      for (let i = 0; i < fill.length; i += 4) { fill[i] = c[0]; fill[i + 1] = c[1]; fill[i + 2] = c[2]; fill[i + 3] = 255; }
      keep(encodePsdLayer(o.width, o.height, { name: 'Background', rgba: fill, opacity: 1, blend: 'normal' }));
    }
    // bottom of the Timeline first, as a PSD lists its layers
    for (let n = tracks.length - 1; n >= 0; n--) {
      this.check();
      const tr = tracks[n];
      const active = tr.content.filter(live);
      const top = active[active.length - 1];
      // the layer carries the opacity and blend mode, so the pixels are drawn plain (other tracks hidden keep parents working)
      const plain = (c: Content): Content => {
        const k: Content = { ...c, opacity: 1, blend: 'normal', keys: c.keys.filter((l) => l.kind !== 'opacity') };
        delete k.transition;
        return k;
      };
      const shadow: Movie = { ...movie, transparent: true, tracks: movie.tracks.map((t) => (t === tr ? { ...t, content: t.content.map(plain) } : { ...t, hidden: true })) };
      await renderer.prepareFrame(shadow, f);
      renderer.drawFrame(this.ctx, shadow, f, this.view, { backstage: false, background: movie.background, transparentChecker: null, keepAlpha: true, exact: true });
      // grab() is the shared readback buffer: encode straight from it, no copy of the pixels is kept
      keep(encodePsdLayer(o.width, o.height, {
        name: tr.name || top.name || `Track ${movie.tracks.indexOf(tr) + 1}`, rgba: this.grab(),
        opacity: Math.max(0, Math.min(1, animate(top, f - top.start).opacity)), blend: top.blend,
      }));
      this.progress('frames', layers.length + (this.keepAlpha ? 1 : 0), total);
      await yieldTurn();
    }
    this.progress('finishing', 0, 1);
    const data = writePsdEncoded(o.width, o.height, layers, merged, this.keepAlpha);
    this.progress('finishing', 1, 1);
    return { blob: new Blob([data as BlobPart], { type: 'image/vnd.adobe.photoshop' }), name: this.name('psd'), mime: 'image/vnd.adobe.photoshop' };
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
    const total = this.steps();
    const ext = this.ext();
    const base = safeName(this.deps.movie.name);
    const fps = this.deps.movie.fps;
    const used = new Set<string>();
    const parts: BlobPart[] = [];
    let failure: Error | null = null;
    const zip = new Zip((err, chunk) => {
      if (err) failure = err;
      else parts.push(chunk);
    });
    const digits = Math.max(5, String(total).length);
    for (let i = 0; i < total; i++) {
      this.check();
      const mf = this.at(i);
      await this.render(mf);
      const blob = await this.toBlob(ext);
      let stem = frameName(o.namePattern ?? '', base, i + 1, digits, mf, fps);
      // a pattern without {n} can repeat (a ping pong, a slower rate): keep every file
      for (let k = 2; used.has(stem); k++) stem = `${frameName(o.namePattern ?? '', base, i + 1, digits, mf, fps)}_${k}`;
      used.add(stem);
      const entry = new ZipPassThrough(`${base}/${stem}.${ext}`);
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
function padSilence(buf: PcmMix, seconds: number): PcmMix {
  const length = Math.max(buf.length, Math.round(seconds * buf.sampleRate));
  const data = Array.from({ length: buf.numberOfChannels }, (_, c) => { const d = new Float32Array(length); d.set(buf.getChannelData(c)); return d; });
  return { numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate, length, getChannelData: (c) => data[c] };
}

/** Feeds a mixdown to the encoder in planar chunks of at most 5 s of mono 48 kHz (what an AudioBuffer source would do). */
async function addPcm(source: AudioSampleSource, mix: PcmMix): Promise<void> {
  const ch = mix.numberOfChannels;
  const per = Math.floor((48000 * 5) / ch);
  for (let at = 0; at < mix.length; at += per) {
    const n = Math.min(per, mix.length - at);
    const data = new Float32Array(ch * n);
    for (let c = 0; c < ch; c++) data.set(mix.getChannelData(c).subarray(at, at + n), c * n);
    const sample = new AudioSample({ format: 'f32-planar', sampleRate: mix.sampleRate, numberOfFrames: n, numberOfChannels: ch, timestamp: at / mix.sampleRate, data });
    try { await source.add(sample); } finally { sample.close(); }
  }
}
