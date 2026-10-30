// VideoPool: decoded video for the renderer, the exporter and the Timeline filmstrip.
//
// Per asset one mediabunny Input; per "lane" (one per block on the Timeline, up to MAX_LANES per asset) one
// forward-pulling frame generator, so two blocks of one video at different times do not make each other seek.
// The generator is pulled only as far as the wanted window needs (decode ahead during playback, nothing when
// idle). Every decoded frame is copied to a canvas by CanvasSink (which closes the VideoFrame right away, so the
// decoder never stalls on held frames); canvases are what we cache, and eviction zeroes them to free memory.
// A jump restarts the generator at the target, and mediabunny seeks to the nearest key frame. While the Playhead
// is dragged, a lane shows the nearest key frame (one packet to decode) and refines to the exact frame once the
// drag rests.
import { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input, type InputVideoTrack } from 'mediabunny';
import type { MediaInfo, VideoSource } from './types';
import { blobHash, ThumbCache } from './thumb-cache';

/** Upper bound for decoded frames over all assets, in bytes. */
const CAP_BYTES = 768 * 1024 * 1024;
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
const THUMB_QUEUE = 96;
/** Decode foci per asset (one per active block). */
const MAX_LANES = 4;
/** A drag is "resting" this long after the last new target. */
const SCRUB_REST_MS = 80;
/** Two misses on different targets this close in time are a drag. */
const SCRUB_WINDOW_MS = 250;
/** Frames pulled for one exact() request before giving up (a file whose timestamps never reach the target). */
const EXACT_PULL_CAP = 30000;
/** Generator restarts for one exact() request before giving up. */
const EXACT_RESTART_CAP = 8;
const QUICK_KEEP = 4;
/** An exact() request protects its lane from eviction for this long. */
const HOLD_MS = 2000;
/** Fresh lanes tried for one exact() request whose lane was disposed under it. */
const EXACT_LANE_RETRIES = 6;

/** Thrown by probe when the file is a video whose codec the browser cannot decode. */
export class UndecodableVideo extends Error {}

type Cv = HTMLCanvasElement | OffscreenCanvas;

interface Frame {
  ts: number;
  end: number;
  canvas: Cv;
  bytes: number;
  /** The frame decoded right after this one in the same run (timestamps may leave a gap between them). */
  next?: Frame;
}

/** `gone` is true when the lane was disposed under the waiter: the caller must ask again on a fresh lane. */
interface Waiter { t: number; res: (gone?: boolean) => void; pulled: number; restarts: number }

interface Thumb { canvas: Cv; bytes: number }

interface ThumbJob { key: string; t: number; w: number; h: number; seen: number }

type Gen = AsyncGenerator<{ canvas: Cv; timestamp: number; duration: number }, void, unknown>;

/** A frame's canvas, or null once `free()` has shrunk it to 0x0. */
const live = (f: Frame | null | undefined): Cv | null => (f && f.canvas.width > 0 ? f.canvas : null);

interface Base {
  id: string;
  input: Input;
  track: InputVideoTrack | null;
  packets: EncodedPacketSink | null;
  ready: boolean;
  failed: boolean;
  disposed: boolean;
  opening: Promise<void>;
  fps: number;
  firstTs: number;
  duration: number;
  lanes: Map<string, Lane>;
  lastAny: Frame | null;
  hash: Promise<string> | null;
  thumbSinks: Map<string, CanvasSink>;
  thumbJobs: Map<string, ThumbJob>;
  thumbBusy: boolean;
  thumbSize: { w: number; h: number } | null;
  prefillTimer: number;
  prefillPass: number;
}

interface Lane {
  key: string;
  b: Base;
  gone: boolean;
  sink: CanvasSink | null;
  qsink: CanvasSink | null;
  frames: Frame[];
  quick: Frame[];
  quickT: number;
  quickBusy: boolean;
  gen: Gen | null;
  genEnd: number;
  genCount: number;
  lastYield: Frame | null;
  running: boolean;
  focus: number;
  ahead: number;
  finalTs: number;
  lastShown: Frame | null;
  pinned: Frame[];
  waiters: Waiter[];
  want: number;
  used: number;
  lastPrefetch: number;
  missT: number;
  missAt: number;
  scrubbing: boolean;
  scrubTimer: number;
  /** An exact() request (export, Perform takes) keeps this lane from eviction until this time. */
  hold: number;
}

export class VideoPool implements VideoSource {
  private bases = new Map<string, Base>();
  private thumbs = new Map<string, Thumb>();
  private thumbBytes = 0;
  private staged: Map<string, Blob> | null = null;
  private cache = new ThumbCache();
  private busyUntil = 0;

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

  /** Blobs for a movie still being opened (not yet in the Engine's asset map); cleared by forget or forgetExcept. */
  stage(blobs: Map<string, Blob> | null): void {
    this.staged = blobs;
  }

  frame(assetId: string, seconds: number, laneKey = ''): CanvasImageSource | null {
    const b = this.base(assetId);
    if (!b) return null;
    if (!b.ready || !b.track) return live(b.lastAny);
    const e = this.lane(b, laneKey);
    const t = this.clamp(b, seconds);
    e.focus = t;
    e.used = performance.now();
    const hit = this.find(e, t);
    if (hit) {
      e.lastShown = hit;
      b.lastAny = hit;
      this.ensure(e);
      return hit.canvas;
    }
    e.want = t;
    this.noteMiss(e, t);
    // a sibling lane of this asset may hold exactly this picture (the start of a looping movie, prefetched)
    for (const s of b.lanes.values()) {
      if (s === e) continue;
      const h = this.find(s, t);
      if (h) { b.lastAny = h; return h.canvas; }
    }
    // nearest cached frame by time, not merely the last shown: two blocks of one video at different times
    // (a split, a duplicate) must not show each other's picture while decoding
    let near: Frame | null = null;
    const consider = (f: Frame): void => { if (!near || Math.abs(f.ts - t) < Math.abs(near.ts - t)) near = f; };
    for (const f of e.frames) consider(f);
    for (const f of e.quick) consider(f);
    // lastShown / lastAny may point at a frame another lane already freed (a 0x0 canvas throws in drawImage)
    return live(near as Frame | null) ?? live(e.lastShown) ?? live(b.lastAny);
  }

  exact(assetId: string, seconds: number, laneKey = ''): Promise<void> {
    const b = this.base(assetId);
    if (!b || b.failed) return Promise.resolve();
    return b.opening.then(async () => {
      // a lane disposed under the waiter would otherwise end the wait on a nearby frame: ask again on a fresh lane
      for (let attempt = 0; attempt < EXACT_LANE_RETRIES; attempt++) {
        if (b.disposed || b.failed || !b.track) return;
        const e = this.lane(b, laneKey);
        e.hold = performance.now() + HOLD_MS;
        const t = this.clamp(b, seconds);
        const hit = this.find(e, t);
        if (hit) { this.pin(e, hit); e.lastShown = hit; b.lastAny = hit; e.focus = t; this.ensure(e); return; }
        const gone = await new Promise<boolean>((res) => {
          e.waiters.push({ t, res: (g) => res(g === true), pulled: 0, restarts: 0 });
          void this.pump(e);
        });
        if (!gone) return;
      }
    });
  }

  prefetch(assetId: string, seconds: number, ahead: number, laneKey = ''): void {
    const b = this.base(assetId);
    if (!b || !b.ready || !b.track) return;
    const e = this.lane(b, laneKey);
    e.focus = this.clamp(b, seconds);
    e.ahead = Math.max(0.25, Math.min(ahead, 10));
    e.used = e.lastPrefetch = performance.now();
    this.busyUntil = e.used + 1500;
    if (e.scrubbing) this.endScrub(e, false);
    this.ensure(e);
  }

  /** Drops one lane (a wrap prefetch that has done its job); the asset and its other lanes stay. */
  release(assetId: string, laneKey: string): void {
    const b = this.bases.get(assetId);
    const e = b?.lanes.get(laneKey);
    if (!b || !e) return;
    b.lanes.delete(laneKey);
    this.disposeLane(e);
  }

  thumb(assetId: string, seconds: number, w: number, h: number): CanvasImageSource | null {
    const b = this.base(assetId);
    const bucket = Math.max(0, Math.round(seconds / THUMB_BUCKET)) * THUMB_BUCKET;
    const key = `${assetId}|${bucket}|${Math.round(w)}x${Math.round(h)}`;
    const hit = this.thumbs.get(key);
    if (hit) { this.thumbs.delete(key); this.thumbs.set(key, hit); return hit.canvas; }
    if (!b || b.failed) return null;
    const now = performance.now();
    const have = b.thumbJobs.get(key);
    if (have) have.seen = now;
    else {
      b.thumbJobs.set(key, { key, t: bucket, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), seen: now });
      if (b.thumbJobs.size > THUMB_QUEUE) {
        // drop the stalest request
        let old: ThumbJob | null = null;
        for (const j of b.thumbJobs.values()) if (!old || j.seen < old.seen) old = j;
        if (old) b.thumbJobs.delete(old.key);
      }
    }
    b.thumbSize = { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
    void b.opening.then(() => this.thumbLoop(b));
    return null;
  }

  forget(assetId?: string): void {
    const ids = assetId === undefined ? [...this.bases.keys()] : [assetId];
    for (const id of ids) {
      const b = this.bases.get(id);
      if (!b) continue;
      this.bases.delete(id);
      this.disposeBase(b);
    }
    if (assetId === undefined) this.staged = null;
    for (const [k, th] of [...this.thumbs]) {
      if (assetId === undefined || k.startsWith(`${assetId}|`)) { this.thumbs.delete(k); this.thumbBytes -= th.bytes; this.free(th.canvas); }
    }
  }

  /** Forgets every asset not in `keep` (a movie being swapped in keeps its own decoded first frames). */
  forgetExcept(keep: Set<string>): void {
    for (const id of [...this.bases.keys()]) if (!keep.has(id)) this.forget(id);
    this.staged = null;
  }

  // ---- bases and lanes

  private base(id: string): Base | null {
    const have = this.bases.get(id);
    if (have) return have;
    const blob = this.staged?.get(id) ?? this.blobOf(id);
    if (!blob) return null;
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const b: Base = {
      id, input, track: null, packets: null, ready: false, failed: false, disposed: false, opening: Promise.resolve(),
      fps: 30, firstTs: 0, duration: 0, lanes: new Map(), lastAny: null, hash: null,
      thumbSinks: new Map(), thumbJobs: new Map(), thumbBusy: false, thumbSize: null, prefillTimer: 0, prefillPass: 0,
    };
    b.opening = this.open(b, blob);
    this.bases.set(id, b);
    return b;
  }

  private lane(b: Base, key: string): Lane {
    const have = b.lanes.get(key);
    if (have) return have;
    // lanes an exact() request holds (export asks for every block of a frame before drawing any) are never the victim;
    // when all are held the asset grows past MAX_LANES for a moment instead of evicting a picture about to be drawn
    const now = performance.now();
    while (b.lanes.size >= MAX_LANES) {
      let old: Lane | null = null;
      for (const l of b.lanes.values()) if (l.hold <= now && l.waiters.length === 0 && (!old || l.used < old.used)) old = l;
      if (!old) break;
      b.lanes.delete(old.key);
      this.disposeLane(old);
    }
    const e: Lane = {
      key, b, gone: false, sink: b.track ? new CanvasSink(b.track, { alpha: true }) : null, qsink: null, frames: [], quick: [], quickT: -1, quickBusy: false,
      gen: null, genEnd: 0, genCount: 0, lastYield: null, running: false, focus: 0, ahead: AHEAD, finalTs: -1,
      lastShown: null, pinned: [], waiters: [], want: -1, used: performance.now(), lastPrefetch: 0, missT: -1, missAt: 0,
      scrubbing: false, scrubTimer: 0, hold: 0,
    };
    b.lanes.set(key, e);
    return e;
  }

  private async open(b: Base, blob: Blob): Promise<void> {
    try {
      const track = await b.input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new Error('video cannot be decoded');
      b.track = track;
      b.firstTs = await track.getFirstTimestamp();
      b.duration = await track.computeDuration();
      try { b.fps = Math.max(1, (await track.computePacketStats(120)).averagePacketRate || 30); } catch { b.fps = 30; }
      b.packets = new EncodedPacketSink(track);
      for (const l of b.lanes.values()) if (!l.sink) l.sink = new CanvasSink(track, { alpha: true });
      b.hash = blobHash(blob).catch(() => `${blob.size}`);
      b.ready = true;
      if (b.disposed) return;
      this.onReady();
    } catch {
      b.failed = true;
      for (const l of b.lanes.values()) for (const w of l.waiters.splice(0)) w.res();
    }
  }

  private disposeBase(b: Base): void {
    b.disposed = true;
    window.clearTimeout(b.prefillTimer);
    for (const l of b.lanes.values()) this.disposeLane(l);
    b.lanes.clear();
    b.thumbJobs.clear();
    try { b.input.dispose(); } catch { /* already gone */ }
  }

  private disposeLane(e: Lane): void {
    e.gone = true;
    window.clearTimeout(e.scrubTimer);
    const g = e.gen;
    e.gen = null;
    if (g) void g.return(undefined).catch(() => undefined);
    for (const f of e.frames) this.free(f.canvas);
    for (const f of e.quick) this.free(f.canvas);
    e.frames = [];
    e.quick = [];
    e.lastShown = null;
    e.pinned = [];
    for (const w of e.waiters.splice(0)) w.res(true);
  }

  private free(c: Cv): void {
    c.width = 0;
    c.height = 0;
  }

  private clamp(b: Base, s: number): number {
    // variable frame rate: the average rate says nothing about the last frame's span, so stay a few ms inside the end
    const last = Math.max(b.firstTs, b.duration - Math.min(0.5 / b.fps, 0.004));
    return Math.min(Math.max(s, 0), last);
  }

  private dead(e: Lane): boolean {
    return e.b.disposed || e.gone;
  }

  // ---- cache lookup

  private find(e: Lane, t: number): Frame | null {
    const fr = e.frames;
    let lo = 0;
    let hi = fr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fr[mid].ts <= t + EPS) lo = mid + 1; else hi = mid;
    }
    const i = lo - 1;
    if (i < 0) return fr.length && t < e.b.firstTs + EPS && fr[0].ts <= e.b.firstTs + EPS ? fr[0] : null;
    const f = fr[i];
    // the next frame, once decoded, wins by the search above; until then a request on the seam must wait
    if (t < f.end - EPS || f.ts === e.finalTs) return f;
    // variable frame rate: a frame whose stated span ends before the next one starts still covers the gap
    if (f.next && fr[i + 1] === f.next) return f;
    return null;
  }

  /** Seconds up to which frames are cached contiguously from `t`; Infinity when that reaches the final frame. */
  private coverEnd(e: Lane, t: number): number {
    const f = this.find(e, t);
    if (!f) return -1;
    let i = e.frames.indexOf(f);
    let cur = f;
    while (cur.ts !== e.finalTs && i + 1 < e.frames.length && (e.frames[i + 1].ts <= cur.end + 1e-3 || cur.next === e.frames[i + 1])) { i++; cur = e.frames[i]; }
    return cur.ts === e.finalTs ? Infinity : cur.end;
  }

  private effAhead(e: Lane): number {
    const f = e.frames[0];
    if (!f) return e.ahead;
    let live = 0;
    for (const b of this.bases.values()) for (const l of b.lanes.values()) if (l.frames.length) live++;
    live = Math.max(1, live);
    const fit = Math.floor((CAP_BYTES * 0.6) / live / Math.max(1, f.bytes));
    return Math.max(0.2, Math.min(e.ahead, (fit * 0.7) / e.b.fps));
  }

  private pin(e: Lane, f: Frame): void {
    if (e.pinned.includes(f)) return;
    e.pinned.push(f);
    if (e.pinned.length > 6) e.pinned.shift();
  }

  private ensure(e: Lane): void {
    if (e.running || this.dead(e) || e.b.failed || e.scrubbing) return;
    const cov = this.coverEnd(e, e.focus);
    if (cov >= e.focus + this.effAhead(e)) return;
    void this.pump(e);
  }

  // ---- scrubbing: nearest key frame now, exact frame when the drag rests

  private noteMiss(e: Lane, t: number): void {
    const now = performance.now();
    const playing = now - e.lastPrefetch < 400;
    const moved = Math.abs(t - e.missT) > 0.5 / e.b.fps;
    const recent = now - e.missAt < SCRUB_WINDOW_MS;
    if (moved) {
      if (!playing && e.missT >= 0 && recent) {
        e.scrubbing = true;
        window.clearTimeout(e.scrubTimer);
        e.scrubTimer = window.setTimeout(() => this.endScrub(e, true), SCRUB_REST_MS);
      }
      e.missT = t;
      e.missAt = now;
      if (!playing && this.farFromCache(e, t)) this.askQuick(e, t);
    } else if (!e.scrubbing) {
      e.missAt = now;
    }
    if (!e.scrubbing) this.ensure(e);
  }

  private endScrub(e: Lane, refine: boolean): void {
    window.clearTimeout(e.scrubTimer);
    e.scrubTimer = 0;
    e.scrubbing = false;
    e.missT = -1;
    if (refine && !this.dead(e)) { e.quickT = -1; this.ensure(e); }
  }

  private farFromCache(e: Lane, t: number): boolean {
    for (const f of e.frames) if (Math.abs(f.ts - t) < 0.3) return false;
    return true;
  }

  private askQuick(e: Lane, t: number): void {
    e.quickT = t;
    if (!e.quickBusy) void this.quickLoop(e);
  }

  private async quickLoop(e: Lane): Promise<void> {
    const b = e.b;
    if (e.quickBusy || !b.track || !b.packets) return;
    e.quickBusy = true;
    try {
      while (!this.dead(e) && e.quickT >= 0) {
        const t = e.quickT;
        e.quickT = -1;
        if (this.find(e, t)) continue;
        const kts = await this.nearKey(b, t);
        if (this.dead(e)) return;
        if (kts === null) continue;
        if (e.quick.some((f) => Math.abs(f.ts - kts) < 1e-6) || e.frames.some((f) => Math.abs(f.ts - kts) < 1e-6)) { this.onReady(); continue; }
        if (!e.qsink) e.qsink = new CanvasSink(b.track, { alpha: true });
        let wc: Awaited<ReturnType<CanvasSink['getCanvas']>> = null;
        try { wc = await e.qsink.getCanvas(kts); } catch { wc = null; }
        if (this.dead(e)) { if (wc) this.free(wc.canvas); return; }
        if (!wc) continue;
        e.quick.push({ ts: wc.timestamp, end: wc.timestamp + Math.max(wc.duration, 0), canvas: wc.canvas, bytes: wc.canvas.width * wc.canvas.height * 4 });
        while (e.quick.length > QUICK_KEEP) { const old = e.quick.shift(); if (old) this.free(old.canvas); }
        this.onReady();
      }
    } finally {
      e.quickBusy = false;
      if (!this.dead(e) && e.quickT >= 0) void this.quickLoop(e);
    }
  }

  /** Timestamp of the key frame nearest to `t` (before or after). */
  private async nearKey(b: Base, t: number): Promise<number | null> {
    try {
      const sink = b.packets;
      if (!sink) return null;
      const prev = await sink.getKeyPacket(t);
      const next = prev ? await sink.getNextKeyPacket(prev) : await sink.getFirstKeyPacket();
      if (!prev) return next ? next.timestamp : null;
      if (next && next.timestamp - t < t - prev.timestamp) return next.timestamp;
      return prev.timestamp;
    } catch {
      return null;
    }
  }

  // ---- decoding

  private settle(e: Lane): void {
    if (!e.waiters.length) return;
    const left: Waiter[] = [];
    for (const w of e.waiters) {
      const hit = this.find(e, w.t);
      if (hit) { this.pin(e, hit); e.lastShown = hit; e.b.lastAny = hit; w.res(); } else left.push(w);
    }
    e.waiters = left;
  }

  /** Gives up on a waiter that cannot be satisfied: it gets the nearest cached frame instead of a hang. */
  private abandon(e: Lane, w: Waiter): void {
    let near: Frame | null = null;
    for (const f of e.frames) if (!near || Math.abs(f.ts - w.t) < Math.abs(near.ts - w.t)) near = f;
    if (near) { this.pin(e, near); e.lastShown = near; e.b.lastAny = near; }
    e.waiters = e.waiters.filter((x) => x !== w);
    w.res();
  }

  private async pump(e: Lane): Promise<void> {
    if (e.running) return;
    e.running = true;
    try {
      while (!this.dead(e) && e.sink) {
        this.settle(e);
        const exactMode = e.waiters.length > 0;
        if (!exactMode && e.scrubbing) break;
        const head = exactMode ? e.waiters[0] : null;
        const focus = head ? head.t : e.focus;
        if (head) e.focus = focus;
        const cov = this.coverEnd(e, focus);
        const want = focus + (exactMode ? Math.min(this.effAhead(e), 0.5) : this.effAhead(e));
        if (cov >= want && !exactMode) break;
        if (exactMode && cov >= focus + EPS && cov >= want) { this.settle(e); continue; }
        const startT = cov >= 0 ? cov : focus;
        let g = e.gen;
        if (!g || e.genEnd > startT + 1e-3 || startT - e.genEnd > THROUGH) {
          if (head && g && ++head.restarts > EXACT_RESTART_CAP) { this.abandon(e, head); continue; }
          if (g) void g.return(undefined).catch(() => undefined);
          let s = startT;
          const first = e.frames[0];
          if (cov < 0 && first && first.ts > startT && first.ts - startT < THROUGH) s = Math.max(e.b.firstTs, startT - 0.5);
          g = e.sink.canvases(s);
          e.gen = g;
          e.genEnd = s;
          e.genCount = 0;
          e.lastYield = null;
        }
        let r: IteratorResult<{ canvas: Cv; timestamp: number; duration: number }, void>;
        try { r = await g.next(); } catch { r = { done: true, value: undefined }; }
        if (this.dead(e)) break;
        if (e.gen !== g) continue;
        if (r.done) {
          e.gen = null;
          const last = e.frames[e.frames.length - 1];
          if (!last || e.genCount === 0) { for (const w of e.waiters.splice(0)) w.res(); break; }
          e.finalTs = last.ts;
          continue;
        }
        e.genCount++;
        if (head && ++head.pulled > EXACT_PULL_CAP) { this.abandon(e, head); continue; }
        const w = r.value;
        const end = w.timestamp + Math.max(w.duration, 0);
        e.genEnd = end;
        const canon = this.insert(e, { ts: w.timestamp, end, canvas: w.canvas, bytes: w.canvas.width * w.canvas.height * 4 });
        if (canon && e.lastYield && e.lastYield !== canon && e.lastYield.ts < canon.ts) e.lastYield.next = canon;
        e.lastYield = canon;
      }
    } finally {
      e.running = false;
    }
  }

  private insert(e: Lane, f: Frame): Frame | null {
    const fr = e.frames;
    // skip pre-roll that is already behind the window
    if (f.end < e.focus - BEHIND) { this.free(f.canvas); return null; }
    let i = fr.length;
    while (i > 0 && fr[i - 1].ts > f.ts) i--;
    if (i > 0 && Math.abs(fr[i - 1].ts - f.ts) < 1e-6) { const dup = fr[i - 1]; this.free(f.canvas); return dup; }
    fr.splice(i, 0, f);
    // a frame that only just finished may be the one the renderer waited for
    const had = e.want >= 0 && f.ts <= e.want + EPS && e.want < f.end + EPS;
    this.trim(e);
    this.settle(e);
    if (had) {
      e.want = -1;
      // the exact frame has landed: key frame stand-ins are no longer needed
      for (const q of e.quick) this.free(q.canvas);
      e.quick = [];
      this.onReady();
    }
    return f;
  }

  private total(): number {
    let n = 0;
    for (const b of this.bases.values()) for (const e of b.lanes.values()) { for (const f of e.frames) n += f.bytes; for (const f of e.quick) n += f.bytes; }
    return n;
  }

  private protectedFrame(e: Lane, f: Frame): boolean {
    return f === e.lastShown || e.pinned.includes(f);
  }

  private trim(e: Lane): void {
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
    // over budget: drop the frames farthest from each lane's focus first
    const all: { e: Lane; f: Frame; d: number }[] = [];
    for (const b of this.bases.values()) {
      for (const x of b.lanes.values()) {
        for (const f of x.frames) {
          if (this.protectedFrame(x, f)) continue;
          const mid = (f.ts + f.end) / 2;
          all.push({ e: x, f, d: mid >= x.focus ? mid - x.focus : (x.focus - mid) * 2 });
        }
      }
    }
    all.sort((a, b) => b.d - a.d);
    for (const it of all) {
      if (sum <= CAP_BYTES) break;
      const k = it.e.frames.indexOf(it.f);
      if (k >= 0) { it.e.frames.splice(k, 1); sum -= it.f.bytes; this.free(it.f.canvas); }
    }
  }

  // ---- thumbnails: visible tiles first, then the rest of the clip while idle; cached across reopen

  private sinkFor(b: Base, w: number, h: number): CanvasSink | null {
    if (!b.track) return null;
    const sk = `${w}x${h}`;
    let sink = b.thumbSinks.get(sk);
    if (!sink) {
      sink = new CanvasSink(b.track, { width: w, height: h, fit: 'cover', alpha: true });
      b.thumbSinks.set(sk, sink);
      if (b.thumbSinks.size > 4) {
        const first = b.thumbSinks.keys().next().value;
        if (first !== undefined && first !== sk) b.thumbSinks.delete(first);
      }
    }
    return sink;
  }

  private putThumb(key: string, canvas: Cv): void {
    const bytes = canvas.width * canvas.height * 4;
    this.thumbs.set(key, { canvas, bytes });
    this.thumbBytes += bytes;
    while (this.thumbBytes > THUMB_CAP_BYTES && this.thumbs.size > 1) {
      const oldest = this.thumbs.keys().next().value as string;
      const th = this.thumbs.get(oldest)!;
      this.thumbs.delete(oldest);
      this.thumbBytes -= th.bytes;
      this.free(th.canvas);
    }
  }

  private storeThumb(b: Base, tail: string, canvas: Cv): void {
    const w = canvas.width, h = canvas.height;
    try {
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx || !b.hash) return;
      const data = ctx.getImageData(0, 0, w, h).data;
      void b.hash.then((hash) => this.cache.put(`${hash}|${tail}`, w, h, data));
    } catch { /* a lost canvas is not cached */ }
  }

  /** The key part after the asset id: `bucket|WxH`. */
  private static tail(key: string): string {
    return key.slice(key.indexOf('|') + 1);
  }

  private fromCache(b: Base, jobs: ThumbJob[], cached: Map<string, { w: number; h: number; rgba: Uint8ClampedArray<ArrayBuffer> }>, hash: string): ThumbJob[] {
    const miss: ThumbJob[] = [];
    for (const j of jobs) {
      const c = cached.get(`${hash}|${VideoPool.tail(j.key)}`);
      if (!c) { miss.push(j); continue; }
      const cv = new OffscreenCanvas(c.w, c.h);
      cv.getContext('2d')!.putImageData(new ImageData(c.rgba, c.w, c.h), 0, 0);
      this.putThumb(j.key, cv);
    }
    if (miss.length < jobs.length) this.onReady();
    void b;
    return miss;
  }

  private async thumbLoop(b: Base): Promise<void> {
    if (b.thumbBusy || b.disposed || !b.track) return;
    b.thumbBusy = true;
    try {
      while (!b.disposed && b.thumbJobs.size) {
        // the freshest requests are what is on screen now; older ones scrolled away and wait
        let newest = 0;
        for (const j of b.thumbJobs.values()) if (j.seen > newest) newest = j.seen;
        const fresh = [...b.thumbJobs.values()].filter((j) => j.seen >= newest - 120).sort((a, c) => a.t - c.t);
        const lead = fresh[0];
        const batch = fresh.filter((j) => j.w === lead.w && j.h === lead.h).slice(0, 24);
        for (const j of batch) b.thumbJobs.delete(j.key);
        const todo = batch.filter((j) => !this.thumbs.has(j.key));
        if (!todo.length) continue;
        // cached from an earlier session?
        const hash = await (b.hash ?? Promise.resolve(''));
        const cached = await this.cache.getMany(todo.map((j) => `${hash}|${VideoPool.tail(j.key)}`));
        if (b.disposed) return;
        const miss = this.fromCache(b, todo, cached, hash);
        if (miss.length) await this.decodeThumbs(b, miss);
      }
    } finally {
      b.thumbBusy = false;
    }
    this.schedulePrefill(b);
  }

  /** Decodes thumbnails for sorted jobs in one pass (each packet decoded once). */
  private async decodeThumbs(b: Base, jobs: ThumbJob[]): Promise<void> {
    const sink = this.sinkFor(b, jobs[0].w, jobs[0].h);
    if (!sink) return;
    const last = Math.max(b.firstTs, b.duration - 0.5 / b.fps);
    const gen = sink.canvasesAtTimestamps(jobs.map((j) => Math.min(Math.max(j.t, b.firstTs), last)));
    let i = 0;
    try {
      for (;;) {
        const r = await gen.next();
        if (r.done || b.disposed) break;
        const j = jobs[i++];
        if (r.value) {
          this.putThumb(j.key, r.value.canvas);
          this.storeThumb(b, VideoPool.tail(j.key), r.value.canvas);
          this.onReady();
        }
        // the view moved on: the rest of this batch is no longer what is visible
        if (i < jobs.length && b.thumbJobs.size && performance.now() - Math.max(...jobs.slice(i).map((x) => x.seen)) > 600) break;
      }
    } catch { /* a bad frame costs a tile, not the strip */ }
    finally { void gen.return(undefined).catch(() => undefined); }
    for (let k = i; k < jobs.length; k++) if (!this.thumbs.has(jobs[k].key)) b.thumbJobs.set(jobs[k].key, jobs[k]);
  }

  private idle(b: Base): boolean {
    if (performance.now() < this.busyUntil) return false;
    for (const l of b.lanes.values()) if (l.running || l.waiters.length || l.scrubbing) return false;
    return true;
  }

  private schedulePrefill(b: Base): void {
    if (b.disposed || !b.thumbSize || b.prefillPass >= 5) return;
    window.clearTimeout(b.prefillTimer);
    b.prefillTimer = window.setTimeout(() => { void this.prefill(b); }, 700);
  }

  /** Fills the rest of the clip at the last requested size, coarse to fine, only while nothing else decodes. */
  private async prefill(b: Base): Promise<void> {
    if (b.disposed || b.thumbBusy || !b.thumbSize || !b.track) return;
    if (!this.idle(b)) { this.schedulePrefill(b); return; }
    const { w, h } = b.thumbSize;
    const n = Math.floor(Math.max(0, b.duration - b.firstTs) / THUMB_BUCKET);
    if (n < 1 || n > 800) { b.prefillPass = 99; return; }
    const strides = [16, 8, 4, 2, 1];
    const stride = strides[b.prefillPass];
    const jobs: ThumbJob[] = [];
    for (let k = 0; k <= n; k += stride) {
      if (stride < 16 && k % (stride * 2) === 0) continue;
      const t = k * THUMB_BUCKET;
      const key = `${b.id}|${t}|${w}x${h}`;
      if (!this.thumbs.has(key)) jobs.push({ key, t, w, h, seen: 0 });
    }
    b.prefillPass++;
    b.thumbBusy = true;
    try {
      const hash = await (b.hash ?? Promise.resolve(''));
      const cached = await this.cache.getMany(jobs.map((j) => `${hash}|${VideoPool.tail(j.key)}`));
      const miss = this.fromCache(b, jobs, cached, hash);
      const sink = this.sinkFor(b, w, h);
      if (sink && miss.length) {
        const last = Math.max(b.firstTs, b.duration - 0.5 / b.fps);
        const gen = sink.canvasesAtTimestamps(miss.map((j) => Math.min(Math.max(j.t, b.firstTs), last)));
        let i = 0;
        try {
          for (;;) {
            const r = await gen.next();
            if (r.done || b.disposed) break;
            const j = miss[i++];
            if (r.value) { this.putThumb(j.key, r.value.canvas); this.storeThumb(b, VideoPool.tail(j.key), r.value.canvas); }
            // visible work arrived or playback started: stop, the next idle moment resumes this pass
            if (b.thumbJobs.size || !this.idle(b)) { b.prefillPass = Math.max(0, b.prefillPass - 1); break; }
          }
        } catch { /* skip */ } finally { void gen.return(undefined).catch(() => undefined); }
      }
      this.onReady();
    } finally {
      b.thumbBusy = false;
    }
    if (b.thumbJobs.size) void this.thumbLoop(b);
    else this.schedulePrefill(b);
  }
}
