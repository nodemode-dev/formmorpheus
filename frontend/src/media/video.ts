// VideoPool: decoded video for the renderer, the exporter and the Timeline filmstrip.
//
// Per asset one mediabunny Input and one forward-pulling frame generator. The generator is pulled only as far
// as the wanted window needs (decode ahead during playback, nothing when idle), so a paused Playhead costs
// nothing. Every decoded frame is copied to a canvas by CanvasSink (which closes the VideoFrame right away, so
// the decoder never stalls on held frames); canvases are what we cache, and eviction zeroes them to free memory
// at once. A jump restarts the generator at the target, and mediabunny seeks to the nearest key frame.
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack } from 'mediabunny';
import type { MediaInfo, VideoSource } from './types';

/** Upper bound for decoded frames over all assets, in bytes. */
const CAP_BYTES = 400 * 1024 * 1024;
/** Seconds of frames kept behind the focus for backwards scrubbing. */
const BEHIND = 1;
/** Default read-ahead in seconds when nobody asked for more. */
const AHEAD = 1;
/** A forward jump shorter than this is decoded through instead of seeking. */
const THROUGH = 1.5;
/** WebM and some MP4 timestamps are rounded to the millisecond; a request k/fps may land 0.7 ms before its frame. */
const EPS = 7.5e-4;
const THUMB_CAP_BYTES = 48 * 1024 * 1024;
const THUMB_BUCKET = 0.25;
const THUMB_QUEUE = 48;

/** Thrown by probe when the file is a video whose codec the browser cannot decode. */
export class UndecodableVideo extends Error {}

interface Frame {
  ts: number;
  end: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  bytes: number;
}

interface Waiter { t: number; res: () => void }

interface Thumb { canvas: HTMLCanvasElement | OffscreenCanvas; bytes: number }

interface Ent {
  id: string;
  input: Input;
  track: InputVideoTrack | null;
  sink: CanvasSink | null;
  ready: boolean;
  failed: boolean;
  disposed: boolean;
  opening: Promise<void>;
  fps: number;
  firstTs: number;
  duration: number;
  frames: Frame[];
  gen: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number }, void, unknown> | null;
  genEnd: number;
  genCount: number;
  running: boolean;
  focus: number;
  ahead: number;
  finalTs: number;
  lastShown: Frame | null;
  pinned: Frame[];
  waiters: Waiter[];
  want: number;
  thumbSinks: Map<string, CanvasSink>;
  thumbQueue: { key: string; t: number; w: number; h: number }[];
  thumbBusy: boolean;
}

export class VideoPool implements VideoSource {
  private ents = new Map<string, Ent>();
  private thumbs = new Map<string, Thumb>();
  private thumbBytes = 0;

  constructor(private blobOf: (assetId: string) => Blob | undefined, private onReady: () => void) {}

  static async probe(file: Blob): Promise<MediaInfo> {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const mime = (await input.getMimeType().catch(() => '')) || file.type;
      const v = await input.getPrimaryVideoTrack();
      const a = await input.getPrimaryAudioTrack();
      if (!v && !a) throw new Error('no tracks');
      const duration = await input.computeDuration();
      if (v) {
        // a video this browser cannot decode (HEVC or ProRes in many browsers) would place a block that stays blank
        if (!(await v.canDecode().catch(() => false))) throw new UndecodableVideo(`${v.codec ?? 'This'} video cannot be decoded by this browser.`);
        let fps = 0;
        try { fps = (await v.computePacketStats(120)).averagePacketRate; } catch { fps = 0; }
        return {
          kind: 'video', mime, width: v.displayWidth, height: v.displayHeight, duration, fps,
          hasVideo: true, hasAudio: !!a, codec: v.codec ?? '',
        };
      }
      return { kind: 'audio', mime, width: 0, height: 0, duration, fps: 0, hasVideo: false, hasAudio: true, codec: a?.codec ?? '' };
    } finally {
      input.dispose();
    }
  }

  frame(assetId: string, seconds: number): CanvasImageSource | null {
    const e = this.entry(assetId);
    if (!e || !e.ready || !e.track) return e?.lastShown?.canvas ?? null;
    const t = this.clamp(e, seconds);
    e.focus = t;
    const hit = this.find(e, t);
    if (hit) {
      e.lastShown = hit;
      this.ensure(e);
      return hit.canvas;
    }
    e.want = t;
    this.ensure(e);
    // nearest cached frame by time, not merely the last shown: two blocks of one video at different times
    // (a split, a duplicate) must not show each other's picture while decoding
    let near: Frame | null = null;
    for (const f of e.frames) if (!near || Math.abs(f.ts - t) < Math.abs(near.ts - t)) near = f;
    return (near ?? e.lastShown)?.canvas ?? null;
  }

  exact(assetId: string, seconds: number): Promise<void> {
    const e = this.entry(assetId);
    if (!e || e.failed) return Promise.resolve();
    return e.opening.then(() => {
      if (e.disposed || e.failed || !e.track) return;
      const t = this.clamp(e, seconds);
      const hit = this.find(e, t);
      if (hit) { this.pin(e, hit); e.lastShown = hit; e.focus = t; this.ensure(e); return; }
      return new Promise<void>((res) => {
        e.waiters.push({ t, res });
        void this.pump(e);
      });
    });
  }

  prefetch(assetId: string, seconds: number, ahead: number): void {
    const e = this.entry(assetId);
    if (!e || !e.ready || !e.track) return;
    e.focus = this.clamp(e, seconds);
    e.ahead = Math.max(0.25, Math.min(ahead, 10));
    this.ensure(e);
  }

  thumb(assetId: string, seconds: number, w: number, h: number): CanvasImageSource | null {
    const e = this.entry(assetId);
    const bucket = Math.max(0, Math.round(seconds / THUMB_BUCKET)) * THUMB_BUCKET;
    const key = `${assetId}|${bucket}|${Math.round(w)}x${Math.round(h)}`;
    const hit = this.thumbs.get(key);
    if (hit) { this.thumbs.delete(key); this.thumbs.set(key, hit); return hit.canvas; }
    if (!e || e.failed) return null;
    if (!e.thumbQueue.some((q) => q.key === key)) {
      e.thumbQueue.push({ key, t: bucket, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) });
      if (e.thumbQueue.length > THUMB_QUEUE) e.thumbQueue.shift();
    }
    void e.opening.then(() => this.thumbLoop(e));
    return null;
  }

  forget(assetId?: string): void {
    const ids = assetId === undefined ? [...this.ents.keys()] : [assetId];
    for (const id of ids) {
      const e = this.ents.get(id);
      if (!e) continue;
      this.ents.delete(id);
      this.dispose(e);
    }
    for (const [k, th] of [...this.thumbs]) {
      if (assetId === undefined || k.startsWith(`${assetId}|`)) { this.thumbs.delete(k); this.thumbBytes -= th.bytes; this.free(th.canvas); }
    }
  }

  // ---- entries

  private entry(id: string): Ent | null {
    const have = this.ents.get(id);
    if (have) return have;
    const blob = this.blobOf(id);
    if (!blob) return null;
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const e: Ent = {
      id, input, track: null, sink: null, ready: false, failed: false, disposed: false, opening: Promise.resolve(),
      fps: 30, firstTs: 0, duration: 0, frames: [], gen: null, genEnd: 0, genCount: 0, running: false, focus: 0, ahead: AHEAD,
      finalTs: -1, lastShown: null, pinned: [], waiters: [], want: -1,
      thumbSinks: new Map(), thumbQueue: [], thumbBusy: false,
    };
    e.opening = this.open(e);
    this.ents.set(id, e);
    return e;
  }

  private async open(e: Ent): Promise<void> {
    try {
      const track = await e.input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new Error('video cannot be decoded');
      e.track = track;
      e.firstTs = await track.getFirstTimestamp();
      e.duration = await track.computeDuration();
      try { e.fps = Math.max(1, (await track.computePacketStats(120)).averagePacketRate || 30); } catch { e.fps = 30; }
      e.sink = new CanvasSink(track);
      e.ready = true;
      if (e.disposed) return;
      this.onReady();
    } catch {
      e.failed = true;
      for (const w of e.waiters.splice(0)) w.res();
    }
  }

  private dispose(e: Ent): void {
    e.disposed = true;
    const g = e.gen;
    e.gen = null;
    if (g) void g.return(undefined).catch(() => undefined);
    for (const f of e.frames) { this.free(f.canvas); }
    e.frames = [];
    e.lastShown = null;
    e.pinned = [];
    e.thumbQueue = [];
    for (const w of e.waiters.splice(0)) w.res();
    try { e.input.dispose(); } catch { /* already gone */ }
  }

  private free(c: HTMLCanvasElement | OffscreenCanvas): void {
    c.width = 0;
    c.height = 0;
  }

  private clamp(e: Ent, s: number): number {
    const last = Math.max(e.firstTs, e.duration - 0.5 / e.fps);
    return Math.min(Math.max(s, 0), last);
  }

  // ---- cache lookup

  private find(e: Ent, t: number): Frame | null {
    const fr = e.frames;
    let lo = 0;
    let hi = fr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fr[mid].ts <= t + EPS) lo = mid + 1; else hi = mid;
    }
    const i = lo - 1;
    if (i < 0) return fr.length && t < e.firstTs + EPS && fr[0].ts <= e.firstTs + EPS ? fr[0] : null;
    const f = fr[i];
    // the next frame, once decoded, wins by the search above; until then a request on the seam must wait
    if (t < f.end - EPS || f.ts === e.finalTs) return f;
    return null;
  }

  /** Seconds up to which frames are cached contiguously from `t`; Infinity when that reaches the final frame. */
  private coverEnd(e: Ent, t: number): number {
    const f = this.find(e, t);
    if (!f) return -1;
    let i = e.frames.indexOf(f);
    let cur = f;
    while (cur.ts !== e.finalTs && i + 1 < e.frames.length && e.frames[i + 1].ts <= cur.end + 1e-3) { i++; cur = e.frames[i]; }
    return cur.ts === e.finalTs ? Infinity : cur.end;
  }

  private effAhead(e: Ent): number {
    const f = e.frames[0];
    if (!f) return e.ahead;
    const live = Math.max(1, [...this.ents.values()].filter((x) => x.frames.length).length);
    const fit = Math.floor((CAP_BYTES * 0.6) / live / Math.max(1, f.bytes));
    return Math.max(0.2, Math.min(e.ahead, (fit * 0.7) / e.fps));
  }

  private pin(e: Ent, f: Frame): void {
    if (e.pinned.includes(f)) return;
    e.pinned.push(f);
    if (e.pinned.length > 6) e.pinned.shift();
  }

  private ensure(e: Ent): void {
    if (e.running || e.disposed || e.failed) return;
    const cov = this.coverEnd(e, e.focus);
    if (cov >= e.focus + this.effAhead(e)) return;
    void this.pump(e);
  }

  // ---- decoding

  private settle(e: Ent): void {
    if (!e.waiters.length) return;
    const left: Waiter[] = [];
    for (const w of e.waiters) {
      const hit = this.find(e, w.t);
      if (hit) { this.pin(e, hit); e.lastShown = hit; w.res(); } else left.push(w);
    }
    e.waiters = left;
  }

  private async pump(e: Ent): Promise<void> {
    if (e.running) return;
    e.running = true;
    try {
      while (!e.disposed && e.sink) {
        this.settle(e);
        const exactMode = e.waiters.length > 0;
        const focus = exactMode ? e.waiters[0].t : e.focus;
        if (exactMode) e.focus = focus;
        const cov = this.coverEnd(e, focus);
        const want = focus + (exactMode ? Math.min(this.effAhead(e), 0.5) : this.effAhead(e));
        if (cov >= want && !exactMode) break;
        if (exactMode && cov >= focus + EPS && cov >= want) { this.settle(e); continue; }
        const startT = cov >= 0 ? cov : focus;
        let g = e.gen;
        if (!g || e.genEnd > startT + 1e-3 || startT - e.genEnd > THROUGH) {
          if (g) void g.return(undefined).catch(() => undefined);
          let s = startT;
          const first = e.frames[0];
          if (cov < 0 && first && first.ts > startT && first.ts - startT < THROUGH) s = Math.max(e.firstTs, startT - 0.5);
          g = e.sink.canvases(s);
          e.gen = g;
          e.genEnd = s;
          e.genCount = 0;
        }
        let r: IteratorResult<{ canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number }, void>;
        try { r = await g.next(); } catch { r = { done: true, value: undefined }; }
        if (e.disposed) break;
        if (e.gen !== g) continue;
        if (r.done) {
          e.gen = null;
          const last = e.frames[e.frames.length - 1];
          if (!last || e.genCount === 0) { for (const w of e.waiters.splice(0)) w.res(); break; }
          e.finalTs = last.ts;
          continue;
        }
        e.genCount++;
        const w = r.value;
        const end = w.timestamp + Math.max(w.duration, 0);
        e.genEnd = end;
        this.insert(e, { ts: w.timestamp, end, canvas: w.canvas, bytes: w.canvas.width * w.canvas.height * 4 });
      }
    } finally {
      e.running = false;
    }
  }

  private insert(e: Ent, f: Frame): void {
    const fr = e.frames;
    // skip pre-roll that is already behind the window
    if (f.end < e.focus - BEHIND) { this.free(f.canvas); return; }
    let i = fr.length;
    while (i > 0 && fr[i - 1].ts > f.ts) i--;
    if (i > 0 && Math.abs(fr[i - 1].ts - f.ts) < 1e-6) { this.free(f.canvas); return; }
    fr.splice(i, 0, f);
    // a frame that only just finished may be the one the renderer waited for
    const had = e.want >= 0 && f.ts <= e.want + EPS && e.want < f.end + EPS;
    this.trim(e);
    this.settle(e);
    if (had) { e.want = -1; this.onReady(); }
  }

  private total(): number {
    let n = 0;
    for (const e of this.ents.values()) for (const f of e.frames) n += f.bytes;
    return n;
  }

  private protectedFrame(e: Ent, f: Frame): boolean {
    return f === e.lastShown || e.pinned.includes(f);
  }

  private trim(e: Ent): void {
    const hi = e.focus + Math.max(this.effAhead(e), AHEAD) + 0.5;
    const lo = e.focus - BEHIND;
    const keep: Frame[] = [];
    for (const f of e.frames) {
      const inside = f.end >= lo && f.ts <= hi;
      if (inside || this.protectedFrame(e, f)) keep.push(f); else this.free(f.canvas);
    }
    e.frames = keep;
    let sum = this.total();
    if (sum <= CAP_BYTES) return;
    // over budget: drop the frames farthest from each asset's focus first
    const all: { e: Ent; f: Frame; d: number }[] = [];
    for (const x of this.ents.values()) {
      for (const f of x.frames) {
        if (this.protectedFrame(x, f)) continue;
        const mid = (f.ts + f.end) / 2;
        all.push({ e: x, f, d: mid >= x.focus ? mid - x.focus : (x.focus - mid) * 2 });
      }
    }
    all.sort((a, b) => b.d - a.d);
    for (const it of all) {
      if (sum <= CAP_BYTES) break;
      const k = it.e.frames.indexOf(it.f);
      if (k >= 0) { it.e.frames.splice(k, 1); sum -= it.f.bytes; this.free(it.f.canvas); }
    }
  }

  // ---- thumbnails

  private async thumbLoop(e: Ent): Promise<void> {
    if (e.thumbBusy || e.disposed || !e.track) return;
    e.thumbBusy = true;
    try {
      while (!e.disposed && e.thumbQueue.length) {
        const job = e.thumbQueue.pop()!; // newest first: the view scrolled to what it wants now
        if (this.thumbs.has(job.key)) continue;
        const sk = `${job.w}x${job.h}`;
        let sink = e.thumbSinks.get(sk);
        if (!sink) {
          sink = new CanvasSink(e.track, { width: job.w, height: job.h, fit: 'cover' });
          e.thumbSinks.set(sk, sink);
          if (e.thumbSinks.size > 4) {
            const first = e.thumbSinks.keys().next().value;
            if (first !== undefined && first !== sk) e.thumbSinks.delete(first);
          }
        }
        let wc: Awaited<ReturnType<CanvasSink['getCanvas']>> = null;
        try { wc = await sink.getCanvas(Math.min(this.clamp(e, job.t), Math.max(e.firstTs, e.duration - 0.5 / e.fps))); } catch { wc = null; }
        if (e.disposed) return;
        if (!wc) continue;
        const bytes = wc.canvas.width * wc.canvas.height * 4;
        this.thumbs.set(job.key, { canvas: wc.canvas, bytes });
        this.thumbBytes += bytes;
        while (this.thumbBytes > THUMB_CAP_BYTES && this.thumbs.size > 1) {
          const oldest = this.thumbs.keys().next().value as string;
          const th = this.thumbs.get(oldest)!;
          this.thumbs.delete(oldest);
          this.thumbBytes -= th.bytes;
          this.free(th.canvas);
        }
        this.onReady();
      }
    } finally {
      e.thumbBusy = false;
    }
  }
}
