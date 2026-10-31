// The audio engine: decodes sound (audio contents and the sound of video files), draws waveform peaks,
// plays the movie's sound on one AudioContext and acts as the playback clock while it plays, so the
// picture follows the sound card instead of drifting from it. Also scrubs and renders mixdowns.

import { Input, BlobSource, ALL_FORMATS, AudioBufferSink } from 'mediabunny';
import { activeDuck, activeFx, type AudioFx } from '../engine/audio-fx';
import { animate } from '../engine/keys';
import { end } from '../engine/model';
import { applyFx, applyGainCurve, duckGain, fxTail } from './audio-dsp';
import { runFx } from './audio-dsp-client';
import { LiveLoudness, integratedLufs, normalizeInPlace } from './loudness';
import { resample, reversed, stretch } from '../engine/time-stretch';
import { timeKeys } from '../engine/retime';
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
  nodes: Map<string, { src: AudioBufferSourceNode; gain?: GainNode }>;
  /** Top-level tracks played as one pre-rendered bus (track effects or ducking), by track id. */
  bus: Set<string>;
}

/** Sample rate of pre-rendered track buses: fixed so playback and export read the same numbers. */
const BUS_RATE = 48000;
/** Most sample values the pre-rendered buses may hold in memory together (4 bytes each); the oldest are dropped first. */
const BUS_CAP_SAMPLES = 96_000_000;

/** A pre-rendered stretch of a track's sound: planar channels starting at sample `from` (BUS_RATE) of movie time. */
interface Span { chs: Float32Array[]; from: number }

export interface MeterLevel { peak: number; rms: number; clip: boolean }
interface TrackNode { gain: GainNode; an: AnalyserNode; clip: boolean }

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
  private master: GainNode | null = null;
  private monitor = true;
  private scrubOn = true;
  private masterAn: AnalyserNode | null = null;
  private masterClip = false;
  private meterBuf = new Float32Array(1024);
  /** Left and right taps of the master for the loudness readout. */
  private lrAn: AnalyserNode[] = [];
  private lrBuf: Float32Array[] = [];
  private readonly live = new LiveLoudness();
  private trackNodes = new Map<string, TrackNode>();
  private busCache = new Map<string, { sig: string; span: Span }>();
  private rawCache = new Map<string, { sig: string; span: Span }>();

  /** Drops the oldest cached buses until the held samples fit BUS_CAP_SAMPLES. */
  private trimBuses(): void {
    const size = (m: Map<string, { span: Span }>): number => { let n = 0; for (const e of m.values()) n += e.span.chs.length * (e.span.chs[0]?.length ?? 0); return n; };
    // a bus without ducking shares its arrays with the raw entry: count the larger of the two maps, drop raw first
    while (size(this.rawCache) + size(this.busCache) > BUS_CAP_SAMPLES) {
      const k = this.rawCache.keys().next().value ?? this.busCache.keys().next().value;
      if (k === undefined) break;
      if (this.rawCache.has(k)) this.rawCache.delete(k); else this.busCache.delete(k);
    }
  }

  /** The node a track's sound goes through (a gain and a level meter into the master); the master itself without a track. */
  private trackDest(id: string | undefined): AudioNode {
    const ctx = this.ctx;
    if (!ctx) throw new Error('no context');
    if (!id) return this.master ?? ctx.destination;
    let n = this.trackNodes.get(id);
    if (!n) {
      const gain = ctx.createGain();
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0;
      gain.connect(an);
      an.connect(this.master ?? ctx.destination);
      n = { gain, an, clip: false };
      this.trackNodes.set(id, n);
    }
    return n.gain;
  }

  /** Peak and RMS (linear, last ~20 ms) of a track, or of the master mix with no id; `clip` stays set until resetClip. */
  meter(id?: string): MeterLevel {
    const an = id ? this.trackNodes.get(id)?.an : this.masterAn;
    if (!an) return { peak: 0, rms: 0, clip: id ? false : this.masterClip };
    an.getFloatTimeDomainData(this.meterBuf.length === an.fftSize ? this.meterBuf : (this.meterBuf = new Float32Array(an.fftSize)));
    const d = this.meterBuf, from = d.length - 1024;
    let peak = 0, sum = 0;
    for (let i = from; i < d.length; i++) { const v = d[i]; const a = v < 0 ? -v : v; if (a > peak) peak = a; sum += v * v; }
    const lv = { peak, rms: Math.sqrt(sum / 1024), clip: false };
    if (id) {
      const n = this.trackNodes.get(id);
      if (n) { if (peak >= 0.999) n.clip = true; lv.clip = n.clip; }
    } else {
      if (peak >= 0.999) this.masterClip = true;
      lv.clip = this.masterClip;
    }
    return lv;
  }

  /** Short-term (3 s) and integrated loudness of what has played since resetLoudness; call about once per frame. */
  loudness(): { short: number; integrated: number } {
    if (this.lrAn.length === 2 && this.ctx) {
      this.lrAn.forEach((an, i) => {
        if (this.lrBuf[i]?.length !== an.fftSize) this.lrBuf[i] = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(this.lrBuf[i] as Float32Array<ArrayBuffer>);
      });
      let loud = false;
      for (const b of this.lrBuf) for (let i = b.length - 256; i < b.length; i++) if (b[i] > 0.00003 || b[i] < -0.00003) { loud = true; break; }
      if (loud) this.live.push(this.lrBuf, this.ctx.sampleRate, performance.now() / 1000);
    }
    return { short: this.live.shortTerm(), integrated: this.live.integrated() };
  }

  resetLoudness(): void { this.live.reset(); }

  resetClip(id?: string): void {
    if (id) { const n = this.trackNodes.get(id); if (n) n.clip = false; } else {
      this.masterClip = false;
      for (const n of this.trackNodes.values()) n.clip = false;
    }
  }

  /** Plays the movie's sound to the speakers (true) or keeps the clock running silent (false), as while recording a voice-over. */
  setMonitor(on: boolean): void {
    this.monitor = on;
    if (this.master) this.master.gain.value = on ? 1 : 0;
  }

  /** Audio scrubbing: the short bursts of sound heard while the Playhead is dragged. */
  setScrub(on: boolean): void {
    this.scrubOn = on;
    if (!on) this.silenceScrub();
  }

  get scrubbing(): boolean { return this.scrubOn; }

  /** Largest absolute sample of a decoded sound between two asset seconds (all channels), or 0 when it is not decoded. */
  peakIn(assetId: string, from: number, to: number): number {
    const buf = this.buffers.get(assetId);
    if (!buf) return 0;
    const a = Math.max(0, Math.floor(from * buf.sampleRate)), b = Math.min(buf.length, Math.ceil(to * buf.sampleRate));
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = a; i < b; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; }
    }
    return peak;
  }

  /** Integrated loudness (LUFS) of a decoded sound between two asset seconds; -Infinity when silent or not decoded. */
  lufsIn(assetId: string, from: number, to: number): number {
    const buf = this.buffers.get(assetId);
    if (!buf) return -Infinity;
    const a = Math.max(0, Math.floor(from * buf.sampleRate)), b = Math.min(buf.length, Math.ceil(to * buf.sampleRate));
    if (b <= a) return -Infinity;
    return integratedLufs(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).subarray(a, b)), buf.sampleRate);
  }

  /** The decoded sound, once decode() has landed. */
  bufferOf(assetId: string): AudioBuffer | null {
    return this.buffers.get(assetId) ?? null;
  }

  constructor(private blobOf: (assetId: string) => Blob | undefined, private onPeaks: (assetId: string) => void) {}

  get active(): boolean {
    return this.session !== null && this.session.clips.length > 0;
  }

  private context(): AudioContext | null {
    if (this.disposed) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.gain.value = this.monitor ? 1 : 0;
        this.master.connect(this.ctx.destination);
        this.masterAn = this.ctx.createAnalyser();
        this.masterAn.fftSize = 2048;
        this.masterAn.smoothingTimeConstant = 0;
        this.master.connect(this.masterAn);
        const split = this.ctx.createChannelSplitter(2);
        this.master.connect(split);
        this.lrAn = [0, 1].map((ch) => {
          const an = (this.ctx as AudioContext).createAnalyser();
          an.fftSize = 2048;
          an.smoothingTimeConstant = 0;
          split.connect(an, ch);
          return an;
        });
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
    const solo = movie.tracks.some((t) => t.solo);
    const walk = (tracks: Track[], shift: number, lo: number, hi: number, parent: (s: number) => number, top = true, topId = ''): void => {
      for (const t of tracks) {
        const tid = top ? t.id : topId;
        if (t.hidden || t.mute || (top && solo && !t.solo)) continue;
        for (const c of t.content) {
          if (c.kind === 'group') {
            // sound inside a retimed group is left out: its time is not a straight shift of the movie's
            if (c.speed !== undefined && c.speed !== 1 || c.reverse) continue;
            const cs = c.start + shift;
            const own = (s: number): number => parent(s) * Math.max(0, animate(c, s * fps - cs).volume);
            walk(c.tracks, shift + c.start - c.offset, Math.max(lo, cs), Math.min(hi, end(c) + shift), own, false, tid);
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
          // a held frame is silent; a retimed block reads its source faster, slower or backward
          if (c.speed === 0 || timeKeys(c)) continue;   // a Time Remap lane has no steady speed to stretch to: silent
          const rs = c.speed ?? 1, rev = c.reverse === true;
          const retimed = rs !== 1 || rev;
          const bfx = activeFx(c.fx);
          out.push({
            contentId: c.id,
            trackId: tid,
            ...(bfx ? { fx: bfx } : {}),
            assetId: c.asset,
            start: f0 / fps,
            end: f1 / fps,
            offset: (retimed ? (rev ? c.offset + (c.duration - (f0 - cs)) * rs : c.offset + (f0 - cs) * rs) : f0 - cs + c.offset) / fps,
            ...(retimed ? { retime: { speed: rs, reverse: rev, keepPitch: c.speedPitch !== true } } : {}),
            gain: (s) => parent(s) * Math.max(0, animate(c, Math.max(0, s * fps - cs)).volume),
            ...(c.kind === 'audio' ? {
              pan: (s: number) => Math.max(-1, Math.min(1, animate(c, Math.max(0, s * fps - cs)).pan)),
              fadeIn: (c.fadeIn ?? 0) / fps,
              fadeOut: (c.fadeOut ?? 0) / fps,
              blockStart: cs / fps,
              blockEnd: (cs + c.duration) / fps,
            } : {}),
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
    const bus = new Set(direction === 1 ? this.busTracks(movie).map((t) => t.id) : []);
    const clips = direction === 1 ? this.clips(movie).filter((c) => c.end > pos0 && !bus.has(c.trackId ?? '')) : [];
    const s: Session = { movie, clips, startCtx: 0, pos0, nodes: new Map(), bus };
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
    for (const id of s.bus) this.placeBus(s, id);
  }

  /** Starts a pre-rendered track bus (rendered first when not cached); it joins late, like a sound still decoding. */
  private placeBus(s: Session, id: string): void {
    const tr = s.movie.tracks.find((t) => t.id === id);
    if (!tr) return;
    void this.busBuffer(s.movie, tr, true).then((span) => {
      const ctx = this.ctx;
      if (!ctx || this.session !== s || !this.clockOn || !span || s.nodes.has('bus:' + id)) return;
      const chs = span.chs;
      const buf = ctx.createBuffer(chs.length, chs[0].length, BUS_RATE);
      chs.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      // the buffer holds only the stretch the track sounds in; it starts at movie second span.from / BUS_RATE
      const w0 = s.startCtx - s.pos0 - this.latency() + span.from / BUS_RATE;
      const now = ctx.currentTime + 0.005;
      const when = Math.max(w0, now);
      const off = when - w0;
      if (off >= buf.duration) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.trackDest(id));
      src.start(when, off);
      s.nodes.set('bus:' + id, { src });
    }, () => {});
  }

  /** Top-level tracks whose sound is summed, processed and ducked before the mix: track effects or a duck setting. */
  busTracks(movie: Movie): Track[] {
    const solo = movie.tracks.some((t) => t.solo);
    return movie.tracks.filter((t) => !t.hidden && !t.mute && !(solo && !t.solo)
      && (activeFx(t.fx) || (activeDuck(t.duck) && movie.tracks.some((o) => o.id === t.duck?.source))));
  }

  /** Slim text of everything that changes a track's sound, to know when a cached bus is stale. */
  private trackSig(movie: Movie, t: Track): string {
    const slim = (c: Track['content'][number]): unknown => (c.kind === 'audio' || c.kind === 'video'
      ? [c.id, c.asset, c.start, c.duration, c.offset, c.volume, c.pan, c.fadeIn, c.fadeOut, c.speed, c.reverse, c.speedPitch, c.fx, c.keys]
      : c.kind === 'group' ? c : 0);
    return JSON.stringify([movie.fps, movie.duration, movie.tracks.some((o) => o.solo), t.mute, t.hidden, t.content.map(slim)]);
  }

  /**
   * The track's sound at BUS_RATE after its own effects, before ducking: only the stretch from its first block to
   * its last (plus the effects' tail, up to the movie's end), not the whole movie. `live` marks a playback request:
   * a newer one for the same track supersedes it (a slider drag computes only its last setting).
   */
  private async trackRaw(movie: Movie, t: Track, live = false): Promise<Span | null> {
    const fx = activeFx(t.fx);
    const sig = this.trackSig(movie, t) + JSON.stringify(fx ?? 0);
    const hit = this.rawCache.get(t.id);
    if (hit && hit.sig === sig) return hit.span;
    const clips = this.clips(movie).filter((c) => c.trackId === t.id);
    if (!clips.length) return null;
    const bufs = await Promise.all(clips.map((c) => this.decode(c.assetId)));
    if (!bufs.some(Boolean)) return null;
    const total = Math.max(1, Math.ceil((movie.duration / movie.fps) * BUS_RATE));
    let a = Infinity, b = 0;
    clips.forEach((c, i) => {
      if (!bufs[i]) return;
      a = Math.min(a, c.start);
      b = Math.max(b, c.end + (c.fx ? fxTail(c.fx) : 0));
    });
    if (!(b > a)) return null;
    const from = Math.min(total - 1, Math.max(0, Math.floor(a * BUS_RATE)));
    const to = Math.min(total, Math.max(from + 1, Math.ceil((b + (fx ? fxTail(fx) : 0)) * BUS_RATE)));
    // block effects are computed in the worker first, so the offline graph below finds them cached
    await this.prepareFxFor(clips, bufs, live ? 'raw:' + t.id : undefined);
    const off = new OfflineAudioContext(2, to - from, BUS_RATE);
    const t0 = from / BUS_RATE;
    clips.forEach((clip, i) => { const bf = bufs[i]; if (bf) scheduleClip(off, off.destination, bf, clip, (x) => x - t0, 0, Math.max(clip.start, t0), movie.fps); });
    const rendered = await off.startRendering();
    let chs: Float32Array[] = [rendered.getChannelData(0), rendered.getChannelData(1)];
    if (fx) {
      const done = await runFx(chs, BUS_RATE, fx, live ? 'bus:' + t.id : undefined);
      if (!done) return null;
      chs = done;
    }
    const span: Span = { chs, from };
    this.rawCache.set(t.id, { sig, span });
    this.trimBuses();
    return span;
  }

  /** Computes the block effects of `clips` in the worker so the offline graph that follows finds them cached. */
  private async prepareFxFor(clips: AudioClip[], bufs: (AudioBuffer | null)[], tag?: string): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(clips.map((c, i) => { const b = bufs[i]; return b && c.fx ? fxPrepare(ctx, b, c, tag).catch(() => false) : true; }));
  }

  /** The bus of a track (effects, then ducking), cached while nothing that feeds it changed. */
  async busBuffer(movie: Movie, t: Track, live = false): Promise<Span | null> {
    const duck = activeDuck(t.duck);
    const src = duck ? movie.tracks.find((o) => o.id === duck.source) : undefined;
    const sig = this.trackSig(movie, t) + JSON.stringify([activeFx(t.fx) ?? 0, src && duck ? [duck, this.trackSig(movie, src), activeFx(src.fx) ?? 0] : 0]);
    const hit = this.busCache.get(t.id);
    if (hit && hit.sig === sig) return hit.span;
    let span = await this.trackRaw(movie, t, live);
    if (!span) return null;
    if (duck && src) {
      const side = await this.trackRaw(movie, src, live);
      if (side) {
        // the gain follows the side-chain over this track's stretch only (silence where the side track has no sound)
        const n = span.chs[0].length;
        const sc = side.chs.map((c) => {
          const o = new Float32Array(n);
          const lo = side.from - span!.from;
          for (let i = Math.max(0, -lo), j = Math.max(0, lo); i < c.length && j < n; i++, j++) o[j] = c[i];
          return o;
        });
        span = { chs: applyGainCurve(span.chs, duckGain(sc, BUS_RATE, duck)), from: span.from };
      }
    }
    this.busCache.set(t.id, { sig, span });
    this.trimBuses();
    return span;
  }

  private place(s: Session, clip: AudioClip): void {
    const ctx = this.ctx;
    if (!ctx || s.nodes.has(clip.contentId + clip.start)) return;
    const buf = this.buffers.get(clip.assetId);
    if (buf === undefined) { void this.decode(clip.assetId); return; }
    if (buf === null) return;
    // effects are computed off the page's thread first; the block joins late, like a sound still decoding
    if (clip.fx && !fxReady(ctx, buf, clip)) {
      void fxPrepare(ctx, buf, clip, 'play').then((ok) => { if (ok && this.session === s && this.clockOn) this.place(s, clip); }, () => {});
      return;
    }
    const lat = this.latency();
    const nodes = scheduleClip(ctx, this.trackDest(clip.trackId), buf, clip, (t) => s.startCtx + (t - s.pos0) - lat, ctx.currentTime + 0.005, Math.max(s.pos0, clip.start), s.movie.fps);
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
      n.gain?.disconnect();
    }
  }

  now(): number {
    const c = this.ctx;
    if (this.clockOn && c) return this.startPerf + Math.max(0, c.currentTime - this.startCtxTime) * 1000;
    return performance.now();
  }

  // ---- scrubbing ----

  scrub(movie: Movie, frame: number): void {
    if (this.session || !this.scrubOn) return;
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
      if (clip.fx && !fxReady(ctx, buf, clip)) { void fxPrepare(ctx, buf, clip, 'scrub').catch(() => {}); continue; }
      const env = ctx.createGain();
      env.connect(ctx.destination);
      // the whole block goes in (its effects are cached for it); only the window s0 .. s0 + len is heard
      const nodes = scheduleClip(ctx, env, buf, clip, (x) => now + (x - s0), now, Math.max(s0, clip.start), fps, s0 + len);
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

  /**
   * The movie's sound between two frames: the same graph playback builds (block effects, track buses, ducking),
   * rendered offline. `only` renders one top-level track alone (a stem).
   */
  async mixdown(movie: Movie, from: number, to: number, sampleRate = 48000, only?: string, lufs?: number): Promise<AudioBuffer | null> {
    const buf = await this.mixdownRaw(movie, from, to, sampleRate, only);
    // normalized to a target loudness: one measure over the whole range, one gain
    if (buf && lufs !== undefined) {
      const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
      const r = normalizeInPlace(chs, buf.sampleRate, lufs);
      this.lastNormalize = r;
    } else this.lastNormalize = null;
    return buf;
  }

  /** What the last normalized mixdown did: the loudness it measured, the gain and whether the peak held it back. */
  lastNormalize: { gain: number; limited: boolean; measured: number } | null = null;

  private async mixdownRaw(movie: Movie, from: number, to: number, sampleRate: number, only?: string): Promise<AudioBuffer | null> {
    const fps = movie.fps;
    const t0 = from / fps;
    const t1 = to / fps;
    if (!(t1 > t0)) return null;
    const bus = new Set(this.busTracks(movie).filter((t) => !only || t.id === only).map((t) => t.id));
    const all = this.clips(movie).filter((c) => c.end > t0 && c.start < t1 && (!only || c.trackId === only));
    const clips = all.filter((c) => !bus.has(c.trackId ?? ''));
    const busIds = [...bus].filter((id) => all.some((c) => c.trackId === id));
    if (!clips.length && !busIds.length) return null;
    const bufs = await Promise.all(clips.map((c) => this.decode(c.assetId)));
    await this.prepareFxFor(clips, bufs);
    const busChs = await Promise.all(busIds.map((id) => this.busBuffer(movie, movie.tracks.find((t) => t.id === id) as Track)));
    if (!bufs.some(Boolean) && !busChs.some(Boolean)) return null;
    const off = new OfflineAudioContext(2, Math.max(1, Math.ceil((t1 - t0) * sampleRate)), sampleRate);
    let any = false;
    clips.forEach((clip, i) => {
      const buf = bufs[i];
      if (!buf) return;
      if (scheduleClip(off, off.destination, buf, clip, (t) => t - t0, 0, Math.max(t0, clip.start), fps, t1)) any = true;
    });
    busChs.forEach((span) => {
      if (!span) return;
      const chs = span.chs;
      // the bus holds only the stretch it sounds in: it starts at movie second a
      const a = span.from / BUS_RATE, z = a + chs[0].length / BUS_RATE;
      const lo = Math.max(t0, a), hi = Math.min(t1, z);
      if (!(hi > lo)) return;
      const b = off.createBuffer(chs.length, chs[0].length, BUS_RATE);
      chs.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      const src = off.createBufferSource();
      src.buffer = b;
      src.connect(off.destination);
      src.start(lo - t0, lo - a, hi - lo);
      any = true;
    });
    if (!any) return null;
    return off.startRendering();
  }

  /** Top-level tracks that carry sound, for stems. */
  stemTracks(movie: Movie): Track[] {
    const ids = new Set(this.clips(movie).map((c) => c.trackId));
    return movie.tracks.filter((t) => ids.has(t.id));
  }

  /** Drops decoded sound and peaks (a movie closed or replaced); they decode again on demand. */
  forget(): void {
    this.stop();
    this.busCache.clear();
    this.rawCache.clear();
    this.buffers.clear();
    this.pending.clear();
    this.peakCache.clear();
  }

  dispose(): void {
    this.stop();
    this.silenceScrub();
    this.disarmUnlock();
    this.disposed = true;
    this.trackNodes.clear();
    this.busCache.clear();
    this.rawCache.clear();
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
  // a reverb keeps ringing after the block ends (into the silence after it), up to the effect's own decay
  const ring = clip.fx ? fxTail(clip.fx) : 0;
  const endS = Math.min(clip.end + ring, limitEnd);
  const pl = planFx(ctx, buf, clip);
  buf = pl.buf;
  const off = pl.off0 - pl.origin + (startS - clip.start);
  const dur = Math.min(endS - startS, buf.duration - off);
  if (!(dur > 0.0005) || off < 0) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  // fades are sampled finer than the frame rate so a short fade is not stepped
  const fi = clip.fadeIn ?? 0, fo = clip.fadeOut ?? 0;
  const rate = fi > 0 || fo > 0 ? Math.max(fps, 200) : fps;
  const bs = clip.blockStart ?? clip.start, be = clip.blockEnd ?? clip.end;
  const n = Math.max(2, Math.ceil(dur * rate) + 1);
  const values = new Float32Array(n);
  let flat = true;
  for (let i = 0; i < n; i++) {
    const s = Math.min(endS, startS + i / rate);
    let v = clip.gain(s);
    if (fi > 0 && s < bs + fi) v *= Math.max(0, (s - bs) / fi);
    if (fo > 0 && s > be - fo) v *= Math.max(0, (be - s) / fo);
    values[i] = v;
    if (v !== values[0]) flat = false;
  }
  gain.gain.value = values[0];
  if (!flat) {
    try { gain.gain.setValueCurveAtTime(values, when, dur); } catch { /* keep the flat value */ }
  }
  src.connect(gain);
  let tail: AudioNode = gain;
  if (clip.pan) {
    const pv = new Float32Array(Math.max(2, Math.ceil(dur * fps) + 1));
    let pflat = true;
    for (let i = 0; i < pv.length; i++) { pv[i] = clip.pan(Math.min(endS, startS + i / fps)); if (pv[i] !== pv[0]) pflat = false; }
    if (!pflat || Math.abs(pv[0]) > 0.001) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = pv[0];
      if (!pflat) { try { pan.pan.setValueCurveAtTime(pv, when, dur); } catch { /* keep the flat value */ } }
      gain.connect(pan);
      tail = pan;
    }
  }
  tail.connect(dest);
  src.start(when, off, dur);
  return { src, gain };
}

// ---- block effects: only the stretch a block plays is processed, cached under a memory cap ----

const fxMade = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
/** Most sample values the processed block buffers may hold together (4 bytes each); the oldest go first. */
const FX_CAP_SAMPLES = 48_000_000;
const fxOrder: { per: Map<string, AudioBuffer>; key: string; size: number }[] = [];
let fxHeld = 0;

const fxKey = (fx: AudioFx, s0: number, s1: number): string => `${JSON.stringify(fx)}|${s0}|${s1}`;

/** The source a block reads (retimed when it is), where it reads from, and the sample range its effects need. */
function fxSource(ctx: BaseAudioContext, buf: AudioBuffer, clip: AudioClip): { src: AudioBuffer; off0: number; s0: number; s1: number } {
  let off0 = clip.offset;
  let src = buf;
  if (clip.retime) {
    const rt = clip.retime;
    // the processed sound plays at normal rate in movie time, so offsets are scaled into it
    off0 = rt.reverse ? (buf.duration - clip.offset) / rt.speed : clip.offset / rt.speed;
    src = retimedBuffer(ctx, buf, rt);
  }
  const sr = src.sampleRate;
  const len = clip.end - clip.start + (clip.fx ? fxTail(clip.fx) : 0);
  const s0 = Math.min(src.length, Math.max(0, Math.floor(off0 * sr)));
  const s1 = Math.min(src.length, Math.max(s0, Math.ceil((off0 + len) * sr) + 1));
  return { src, off0, s0, s1 };
}

function planFx(ctx: BaseAudioContext, buf: AudioBuffer, clip: AudioClip): { buf: AudioBuffer; off0: number; origin: number } {
  const f = fxSource(ctx, buf, clip);
  if (!clip.fx) return { buf: f.src, off0: f.off0, origin: 0 };
  return { buf: fxBuffer(ctx, f.src, clip.fx, f.s0, f.s1), off0: f.off0, origin: f.s0 / f.src.sampleRate };
}

function fxLookup(src: AudioBuffer, key: string): AudioBuffer | undefined { return fxMade.get(src)?.get(key); }

function fxStore(ctx: BaseAudioContext, src: AudioBuffer, key: string, out: Float32Array[], len: number): AudioBuffer {
  const made = ctx.createBuffer(out.length, Math.max(1, len), src.sampleRate);
  out.forEach((c, i) => made.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  let per = fxMade.get(src);
  if (!per) { per = new Map(); fxMade.set(src, per); }
  per.set(key, made);
  const size = out.length * made.length;
  fxOrder.push({ per, key, size });
  fxHeld += size;
  while (fxHeld > FX_CAP_SAMPLES && fxOrder.length > 1) {
    const o = fxOrder.shift() as (typeof fxOrder)[number];
    o.per.delete(o.key);
    fxHeld -= o.size;
  }
  return made;
}

/** A block's sound run through its effects over [s0, s1) of its source, made once per setting and span (the same buffer plays and exports). */
function fxBuffer(ctx: BaseAudioContext, src: AudioBuffer, fx: AudioFx, s0: number, s1: number): AudioBuffer {
  const key = fxKey(fx, s0, s1);
  const have = fxLookup(src, key);
  if (have) return have;
  const chs: Float32Array[] = [];
  for (let c = 0; c < src.numberOfChannels; c++) chs.push(src.getChannelData(c).subarray(s0, s1));
  return fxStore(ctx, src, key, s1 > s0 ? applyFx(chs, src.sampleRate, fx) : chs.map(() => new Float32Array(1)), s1 - s0);
}

/** Whether a block's effect buffer is ready (or it has none). */
function fxReady(ctx: BaseAudioContext, buf: AudioBuffer, clip: AudioClip): boolean {
  if (!clip.fx) return true;
  const f = fxSource(ctx, buf, clip);
  return f.s1 <= f.s0 || !!fxLookup(f.src, fxKey(clip.fx, f.s0, f.s1));
}

/** Computes a block's effect buffer in the worker and caches it; false when a newer request took its place. */
async function fxPrepare(ctx: BaseAudioContext, buf: AudioBuffer, clip: AudioClip, tag?: string): Promise<boolean> {
  const fx = clip.fx;
  if (!fx) return true;
  const f = fxSource(ctx, buf, clip);
  const key = fxKey(fx, f.s0, f.s1);
  if (fxLookup(f.src, key) || f.s1 <= f.s0) return true;
  const chs: Float32Array[] = [];
  for (let c = 0; c < f.src.numberOfChannels; c++) chs.push(f.src.getChannelData(c).subarray(f.s0, f.s1));
  const out = await runFx(chs, f.src.sampleRate, fx, tag ? `${tag}:${clip.contentId}${clip.start}` : undefined);
  if (!out) return false;
  if (!fxLookup(f.src, key)) fxStore(ctx, f.src, key, out, f.s1 - f.s0);
  return true;
}

const retimed = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();

/** The whole sound at another speed and/or backward, made once per source buffer and setting. */
function retimedBuffer(ctx: BaseAudioContext, buf: AudioBuffer, rt: { speed: number; reverse: boolean; keepPitch: boolean }): AudioBuffer {
  const key = `${rt.speed}|${rt.reverse ? 1 : 0}|${rt.keepPitch ? 1 : 0}|${ctx.sampleRate}`;
  let per = retimed.get(buf);
  if (!per) { per = new Map(); retimed.set(buf, per); }
  const have = per.get(key);
  if (have) return have;
  let chs: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  if (rt.reverse) chs = chs.map(reversed);
  const out = rt.speed === 1 ? chs : rt.keepPitch ? stretch(chs, rt.speed, buf.sampleRate) : chs.map((c) => resample(c, rt.speed));
  const made = ctx.createBuffer(out.length, Math.max(1, out[0].length), buf.sampleRate);
  out.forEach((c, i) => made.getChannelData(i).set(c));
  per.set(key, made);
  return made;
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
