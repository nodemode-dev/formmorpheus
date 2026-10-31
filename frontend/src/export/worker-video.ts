// Video decoding inside the export worker: a VideoSource for the Renderer that needs no document.
// Same frame choice as media/video.ts (the last frame whose time is at or before the request, within EPS) and the
// same draw (rotation, flip, alpha kept), so a worker export carries the pictures the window would have drawn.
// Per block (lane) one forward generator; an export asks for frames in order, a jump or a backward step restarts it.
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type InputVideoTrack, type VideoSample } from 'mediabunny';
import type { VideoSource } from '../media/types';

const EPS = 7.5e-4;
/** A forward jump shorter than this is decoded through instead of seeking. */
const THROUGH = 1.5;

interface Base {
  input: Input;
  opening: Promise<boolean>;
  track: InputVideoTrack | null;
  sink: VideoSampleSink | null;
  firstTs: number;
  duration: number;
  fps: number;
  conv: { rot: 0 | 90 | 180 | 270; flip: boolean; w: number; h: number } | null;
}

interface Lane {
  gen: AsyncGenerator<VideoSample, void, unknown> | null;
  cur: VideoSample | null;
  peek: VideoSample | null;
  done: boolean;
  canvas: OffscreenCanvas | null;
  /** The timestamp of the frame `canvas` shows. */
  shown: number;
}

export class WorkerVideo implements VideoSource {
  private readonly bases = new Map<string, Base>();
  private readonly lanes = new Map<string, Lane>();
  /** Asset ids whose video could not be opened or decoded (their blocks draw nothing); the export reports them as a warning. */
  readonly failed = new Set<string>();

  constructor(private readonly blobOf: (id: string) => Blob | undefined) {}

  private base(id: string): Base | null {
    const have = this.bases.get(id);
    if (have) return have;
    const blob = this.blobOf(id);
    if (!blob) return null;
    const b: Base = { input: new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }), opening: Promise.resolve(false), track: null, sink: null, firstTs: 0, duration: 0, fps: 30, conv: null };
    b.opening = (async () => {
      try {
        const track = await b.input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) { this.failed.add(id); return false; }
        b.track = track;
        b.firstTs = await track.getFirstTimestamp();
        b.duration = await track.computeDuration();
        try { b.fps = Math.max(1, (await track.computePacketStats(120)).averagePacketRate || 30); } catch { b.fps = 30; }
        const rot = (await track.getRotation()) as 0 | 90 | 180 | 270;
        const flip = await track.getFlip();
        const sw = await track.getSquarePixelWidth();
        const sh = await track.getSquarePixelHeight();
        b.conv = { rot, flip, w: rot % 180 === 0 ? sw : sh, h: rot % 180 === 0 ? sh : sw };
        b.sink = new VideoSampleSink(track);
        return true;
      } catch { this.failed.add(id); return false; }
    })();
    this.bases.set(id, b);
    return b;
  }

  private lane(assetId: string, key: string): Lane {
    const k = `${assetId}|${key}`;
    let l = this.lanes.get(k);
    if (!l) { l = { gen: null, cur: null, peek: null, done: false, canvas: null, shown: -1 }; this.lanes.set(k, l); }
    return l;
  }

  private clamp(b: Base, s: number): number {
    const last = Math.max(b.firstTs, b.duration - Math.min(0.5 / b.fps, 0.004));
    return Math.min(Math.max(s, 0), last);
  }

  private reset(l: Lane): void {
    void l.gen?.return(undefined).catch(() => undefined);
    l.gen = null;
    l.cur?.close();
    l.peek?.close();
    l.cur = null;
    l.peek = null;
    l.done = false;
  }

  frame(assetId: string, _seconds: number, lane = ''): CanvasImageSource | null {
    return this.lanes.get(`${assetId}|${lane}`)?.canvas ?? null;
  }

  prefetch(): void { /* an export asks for exact frames in order */ }

  release(assetId: string, lane: string): void {
    const k = `${assetId}|${lane}`;
    const l = this.lanes.get(k);
    if (l) { this.reset(l); this.lanes.delete(k); }
  }

  async exact(assetId: string, seconds: number, lane = ''): Promise<void> {
    const b = this.base(assetId);
    if (!b || !(await b.opening) || !b.sink || !b.conv) return;
    const l = this.lane(assetId, lane);
    const t = this.clamp(b, seconds);
    const behind = l.cur && t < l.cur.timestamp - EPS;
    const far = l.cur && t - l.cur.timestamp > THROUGH;
    if (!l.gen || behind || far) { this.reset(l); l.gen = b.sink.samples(t); }
    for (;;) {
      if (!l.peek && !l.done) {
        const r = await l.gen.next();
        if (r.done) l.done = true; else l.peek = r.value;
      }
      const p = l.peek;
      // the first frame of a file may start after t: it is what shows before the start
      if (!p || (l.cur && p.timestamp > t + EPS)) break;
      l.cur?.close();
      l.cur = p;
      l.peek = null;
    }
    const cur = l.cur;
    if (!cur || cur.timestamp === l.shown) return;
    const cv = l.canvas && l.canvas.width === b.conv.w && l.canvas.height === b.conv.h ? l.canvas : new OffscreenCanvas(b.conv.w, b.conv.h);
    const ctx = cv.getContext('2d', { alpha: true }) as OffscreenCanvasRenderingContext2D;
    ctx.clearRect(0, 0, cv.width, cv.height);
    cur.drawWithFit(ctx, { fit: 'fill', rotation: b.conv.rot, flip: b.conv.flip });
    l.canvas = cv;
    l.shown = cur.timestamp;
  }

  /** Releases every decoder (the worker is about to end). */
  dispose(): void {
    for (const l of this.lanes.values()) this.reset(l);
    this.lanes.clear();
    for (const b of this.bases.values()) b.input.dispose();
    this.bases.clear();
  }
}
