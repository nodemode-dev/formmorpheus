// The audio engine: decodes sound (audio contents and the sound of video files), draws waveform peaks,
// plays the movie's sound on one AudioContext and acts as the playback clock while it plays, so the
// picture follows the sound card instead of drifting from it. Also scrubs and renders mixdowns.

import { Input, BlobSource, ALL_FORMATS, AudioBufferSink } from 'mediabunny';
import { animate } from '../engine/keys';
import { end } from '../engine/model';
import type { Movie, Track } from '../engine/types';
import type { AudioClip, ClockSource } from './types';

export interface Peaks { min: Float32Array; max: Float32Array; perSecond: number }

const PEAKS_PER_SECOND = 200;
const SCRUB_MIN_GAP_MS = 30;
const SCRUB_MIN_SECONDS = 0.04;

interface Session {
  movie: Movie;
  clips: AudioClip[];
  /** AudioContext time at which movie second `pos0` is heard. */
  startCtx: number;
  pos0: number;
  nodes: Map<string, { src: AudioBufferSourceNode; gain: GainNode }>;
}

export class AudioEngine implements ClockSource {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer | null>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private peakCache = new Map<string, Peaks>();
  private session: Session | null = null;
  private clockOn = false;
  private startPerf = 0;
  private startCtxTime = 0;
  private scrubNodes: { src: AudioBufferSourceNode; env: GainNode }[] = [];
  private scrubAt = 0;
  private unlockBound: (() => void) | null = null;
  private disposed = false;

  constructor(private blobOf: (assetId: string) => Blob | undefined, private onPeaks: (assetId: string) => void) {}

  get active(): boolean {
    return this.session !== null && this.session.clips.length > 0;
  }

  private context(): AudioContext | null {
    if (this.disposed) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
      } catch {
        return null;
      }
      this.armUnlock();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private armUnlock(): void {
    if (typeof window === 'undefined' || this.unlockBound) return;
    const go = (): void => {
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      if (this.ctx && this.ctx.state === 'running') this.disarmUnlock();
    };
    this.unlockBound = go;
    for (const t of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(t, go, true);
  }

  private disarmUnlock(): void {
    if (!this.unlockBound) return;
    for (const t of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(t, this.unlockBound, true);
    this.unlockBound = null;
  }

  private latency(): number {
    const c = this.ctx;
    if (!c) return 0;
    const l = (c as AudioContext & { outputLatency?: number }).outputLatency || c.baseLatency || 0;
    return Math.min(0.25, Math.max(0, l));
  }

  // ---- decoding and peaks ----

  decode(assetId: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(assetId)) return Promise.resolve(this.buffers.get(assetId) ?? null);
    const inflight = this.pending.get(assetId);
    if (inflight) return inflight;
    const p = this.decodeNow(assetId).then((buf) => {
      this.pending.delete(assetId);
      this.buffers.set(assetId, buf);
      if (buf) {
        this.peakCache.set(assetId, computePeaks(buf));
        this.onPeaks(assetId);
        this.late(assetId);
      }
      return buf;
    });
    this.pending.set(assetId, p);
    return p;
  }

  private async decodeNow(assetId: string): Promise<AudioBuffer | null> {
    const blob = this.blobOf(assetId);
    const ctx = this.context();
    if (!blob || !ctx) return null;
    try {
      const data = await blob.arrayBuffer();
      return await ctx.decodeAudioData(data);
    } catch {
      /* fall through to the demuxer path */
    }
    try {
      return await this.decodeWithDemuxer(blob, ctx);
    } catch {
      return null;
    }
  }

  private async decodeWithDemuxer(blob: Blob, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return null;
      const sink = new AudioBufferSink(track);
      const parts: AudioBuffer[] = [];
      let frames = 0;
      for await (const w of sink.buffers()) {
        parts.push(w.buffer);
        frames += w.buffer.length;
      }
      if (!parts.length) return null;
      const first = parts[0];
      const out = ctx.createBuffer(first.numberOfChannels, frames, first.sampleRate);
      let at = 0;
      for (const p of parts) {
        for (let ch = 0; ch < out.numberOfChannels; ch++) {
          out.getChannelData(ch).set(p.getChannelData(Math.min(ch, p.numberOfChannels - 1)), at);
        }
        at += p.length;
      }
      return out;
    } finally {
      input.dispose();
    }
  }

  peaks(assetId: string): Peaks | null {
    return this.peakCache.get(assetId) ?? null;
  }

  // ---- the audible blocks of a movie ----

  clips(movie: Movie): AudioClip[] {
    const out: AudioClip[] = [];
    const fps = movie.fps;
    const walk = (tracks: Track[], shift: number, lo: number, hi: number, parent: (s: number) => number): void => {
      for (const t of tracks) {
        if (t.hidden) continue;
        for (const c of t.content) {
          if (c.kind === 'group') {
            const cs = c.start + shift;
            const own = (s: number): number => parent(s) * Math.max(0, animate(c, s * fps - cs).volume);
            walk(c.tracks, shift + c.start - c.offset, Math.max(lo, cs), Math.min(hi, end(c) + shift), own);
            continue;
          }
          if (!c.asset) continue;
          const asset = movie.assets[c.asset];
          if (!asset) continue;
          if (c.kind === 'audio') {
            if (asset.kind !== 'audio' && asset.kind !== 'video') continue;
          } else if (c.kind === 'video') {
            if (!(c.volume > 0) || !asset.hasAudio) continue;
          } else continue;
          const cs = c.start + shift;
          const f0 = Math.max(cs, lo);
          const f1 = Math.min(cs + c.duration, hi);
          if (f1 <= f0) continue;
          out.push({
            contentId: c.id,
            assetId: c.asset,
            start: f0 / fps,
            end: f1 / fps,
            offset: (f0 - cs + c.offset) / fps,
            gain: (s) => parent(s) * Math.max(0, animate(c, Math.max(0, s * fps - cs)).volume),
          });
        }
      }
    };
    walk(movie.tracks, 0, 0, Number.POSITIVE_INFINITY, () => 1);
    return out;
  }

  // ---- playback ----

  play(movie: Movie, frame: number, direction: 1 | -1): void {
    // the clock must not jump: a restart at a loop wrap continues from the time the Engine just read
    const keep = this.now();
    this.stop();
    const ctx = this.context();
    const pos0 = frame / movie.fps;
    this.startPerf = keep;
    if (!ctx) { this.clockOn = false; return; }
    const clips = direction === 1 ? this.clips(movie).filter((c) => c.end > pos0) : [];
    const s: Session = { movie, clips, startCtx: 0, pos0, nodes: new Map() };
    this.session = s;
    if (ctx.state === 'running') { this.startClock(s, ctx); return; }
    // a context that is still waking (created by this very Play, or the first gesture) starts the sound
    // when it runs, at the movie time reached by then; the picture runs on the system clock meanwhile
    const perf0 = performance.now();
    void ctx.resume().then(() => {
      if (this.session !== s || ctx.state !== 'running') return;
      s.pos0 = pos0 + (performance.now() - perf0) / 1000;
      s.clips = s.clips.filter((c) => c.end > s.pos0);
      this.startPerf = this.now();
      this.startClock(s, ctx);
    }).catch(() => {});
  }

  /**
   * Starts the sound a little ahead (output latency plus 20 ms) so the first samples are not cut: movie time
   * `pos0` is heard at `startCtx`, and the clock holds still until then (now() never runs backwards).
   */
  private startClock(s: Session, ctx: AudioContext): void {
    s.startCtx = ctx.currentTime + this.latency() + 0.02;
    this.startCtxTime = s.startCtx;
    this.clockOn = true;
    for (const c of s.clips) this.place(s, c);
  }

  private place(s: Session, clip: AudioClip): void {
    const ctx = this.ctx;
    if (!ctx || s.nodes.has(clip.contentId + clip.start)) return;
    const buf = this.buffers.get(clip.assetId);
    if (buf === undefined) { void this.decode(clip.assetId); return; }
    if (buf === null) return;
    const lat = this.latency();
    const nodes = scheduleClip(ctx, ctx.destination, buf, clip, (t) => s.startCtx + (t - s.pos0) - lat, ctx.currentTime + 0.005, Math.max(s.pos0, clip.start), s.movie.fps);
    if (nodes) s.nodes.set(clip.contentId + clip.start, nodes);
  }

  /** A decode landed while playing: start the clips that were waiting for it. */
  private late(assetId: string): void {
    const s = this.session;
    if (!s || !this.clockOn) return;
    for (const c of s.clips) if (c.assetId === assetId) this.place(s, c);
  }

  stop(): void {
    const s = this.session;
    this.session = null;
    this.clockOn = false;
    if (!s) return;
    for (const n of s.nodes.values()) {
      try { n.src.stop(); } catch { /* not started */ }
      n.src.disconnect();
      n.gain.disconnect();
    }
  }

  now(): number {
    const c = this.ctx;
    if (this.clockOn && c) return this.startPerf + Math.max(0, c.currentTime - this.startCtxTime) * 1000;
    return performance.now();
  }

  // ---- scrubbing ----

  scrub(movie: Movie, frame: number): void {
    if (this.session) return;
    const t = performance.now();
    if (t - this.scrubAt < SCRUB_MIN_GAP_MS) return;
    const ctx = this.context();
    if (!ctx || ctx.state !== 'running') return;
    this.scrubAt = t;
    this.silenceScrub();
    const fps = movie.fps;
    const s0 = frame / fps;
    const len = Math.max(SCRUB_MIN_SECONDS, 1 / fps);
    const now = ctx.currentTime + 0.003;
    for (const clip of this.clips(movie)) {
      if (clip.end <= s0 || clip.start > s0 + len) continue;
      const buf = this.buffers.get(clip.assetId);
      if (buf === undefined) { void this.decode(clip.assetId); continue; }
      if (!buf) continue;
      const env = ctx.createGain();
      env.connect(ctx.destination);
      const nodes = scheduleClip(ctx, env, buf, { ...clip, end: Math.min(clip.end, s0 + len) }, (x) => now + (x - s0), now, Math.max(s0, clip.start), fps);
      if (!nodes) { env.disconnect(); continue; }
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(1, now + 0.004);
      env.gain.setValueAtTime(1, now + len - 0.008);
      env.gain.linearRampToValueAtTime(0, now + len);
      this.scrubNodes.push({ src: nodes.src, env });
    }
  }

  private silenceScrub(): void {
    for (const n of this.scrubNodes) {
      try { n.src.stop(); } catch { /* already ended */ }
      n.src.disconnect();
      n.env.disconnect();
    }
    this.scrubNodes = [];
  }

  // ---- export ----

  async mixdown(movie: Movie, from: number, to: number, sampleRate = 48000): Promise<AudioBuffer | null> {
    const fps = movie.fps;
    const t0 = from / fps;
    const t1 = to / fps;
    if (!(t1 > t0)) return null;
    const clips = this.clips(movie).filter((c) => c.end > t0 && c.start < t1);
    if (!clips.length) return null;
    const bufs = await Promise.all(clips.map((c) => this.decode(c.assetId)));
    if (!bufs.some(Boolean)) return null;
    const off = new OfflineAudioContext(2, Math.max(1, Math.ceil((t1 - t0) * sampleRate)), sampleRate);
    let any = false;
    clips.forEach((clip, i) => {
      const buf = bufs[i];
      if (!buf) return;
      if (scheduleClip(off, off.destination, buf, clip, (t) => t - t0, 0, Math.max(t0, clip.start), fps, t1)) any = true;
    });
    if (!any) return null;
    return off.startRendering();
  }

  /** Drops decoded sound and peaks (a movie closed or replaced); they decode again on demand. */
  forget(): void {
    this.stop();
    this.buffers.clear();
    this.pending.clear();
    this.peakCache.clear();
  }

  dispose(): void {
    this.stop();
    this.silenceScrub();
    this.disarmUnlock();
    this.disposed = true;
    const c = this.ctx;
    this.ctx = null;
    if (c) void c.close().catch(() => {});
    this.buffers.clear();
    this.pending.clear();
    this.peakCache.clear();
  }
}

/**
 * Schedules one clip. `mapT` turns a movie second into a context time; the part of the clip before
 * `notBefore` (a context time) or before movie second `from` is skipped by advancing into the asset.
 */
function scheduleClip(
  ctx: BaseAudioContext,
  dest: AudioNode,
  buf: AudioBuffer,
  clip: AudioClip,
  mapT: (movieSeconds: number) => number,
  notBefore: number,
  from: number,
  fps: number,
  limitEnd = Number.POSITIVE_INFINITY,
): { src: AudioBufferSourceNode; gain: GainNode } | null {
  let startS = Math.max(clip.start, from);
  let when = mapT(startS);
  if (when < notBefore) {
    startS += notBefore - when;
    when = notBefore;
  }
  const endS = Math.min(clip.end, limitEnd);
  const off = clip.offset + (startS - clip.start);
  const dur = Math.min(endS - startS, buf.duration - off);
  if (!(dur > 0.0005) || off < 0) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  const n = Math.max(2, Math.ceil(dur * fps) + 1);
  const values = new Float32Array(n);
  let flat = true;
  for (let i = 0; i < n; i++) {
    values[i] = clip.gain(Math.min(endS, startS + i / fps));
    if (values[i] !== values[0]) flat = false;
  }
  gain.gain.value = values[0];
  if (!flat) {
    try { gain.gain.setValueCurveAtTime(values, when, dur); } catch { /* keep the flat value */ }
  }
  src.connect(gain);
  gain.connect(dest);
  src.start(when, off, dur);
  return { src, gain };
}

function computePeaks(buf: AudioBuffer): Peaks {
  const rate = buf.sampleRate;
  const buckets = Math.max(1, Math.ceil(buf.duration * PEAKS_PER_SECOND));
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const a = buf.getChannelData(0);
  const b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const step = rate / PEAKS_PER_SECOND;
  for (let k = 0; k < buckets; k++) {
    const s0 = Math.floor(k * step);
    const s1 = Math.min(a.length, Math.max(s0 + 1, Math.floor((k + 1) * step)));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = s0; i < s1; i++) {
      const v = b ? (a[i] + b[i]) * 0.5 : a[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[k] = lo === Infinity ? 0 : lo;
    max[k] = hi === -Infinity ? 0 : hi;
  }
  return { min, max, perSecond: PEAKS_PER_SECOND };
}
