import { end, flipIndexAt } from './model';
import { drawMaskedRows, hasRowMask } from './flip-draw';
import { animate, type Animated } from './keys';
import { contentRect, drawTriangles, drawWarped, setStagePost } from './warp-draw';
import { canvasOf, MAX_CANVAS_SIDE } from './canvas';
import { memberMatrix, mul, ownMatrix, postMatrix, topMatrix, viewMat, type Mat } from './transform';
import { boneQuads } from './bones';
import { gaussianBlur, hsb, lensBlur, noise, sharpen } from '../paint/filters';
import { boil } from '../paint/boil';
import type { Raster } from '../paint/types';
import { hasTree } from '../paint/layer-tree';
import { drawLayerTree } from './layer-draw';
import { blendCanvasOnto, isPixelBlend } from './blend';
import type { VideoSource } from '../media/types';
import type { BlendMode, CanvasRect, Content, Movie, Track } from './types';
import { GpuCompositor, type GpuHost } from './gpu/compositor';
import { probeGpu, type ProbeResult } from './gpu/probe';
import { liveSet } from './gpu/live';
import { layoutText, paintText } from './text-layout';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Surface = OffscreenCanvas;

export const BLEND_OP: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light',
  difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
  add: 'lighter', passthrough: 'source-over',
  'linear-burn': 'source-over', 'darker-color': 'source-over', 'lighter-color': 'source-over', 'vivid-light': 'source-over', 'linear-light': 'source-over',
  'pin-light': 'source-over', 'hard-mix': 'source-over', subtract: 'source-over', divide: 'source-over',
};

/** Decoded pictures may hold this many bytes; the ones drawn in the last two frames always stay. */
const BITMAP_CAP_BYTES = 1024 * 1024 * 1024;
/** Canvas filters (blur) where the browser has them; others take the CPU path in paint/filters. */
const CANVAS_FILTER = typeof OffscreenCanvasRenderingContext2D !== 'undefined' && 'filter' in OffscreenCanvasRenderingContext2D.prototype;

/** Backstage visibility when a movie does not set its own. */
export const BACKSTAGE_DEFAULT = 0.2;

export interface View {
  scale: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}

/** Largest side and area (pixels) of the flat surface a Warp, Distort or bones content is drawn on before it is re-projected. */
const FLAT_SIDE = 8192;
const FLAT_AREA = 48 * 1024 * 1024;

/** Pixels per movie pixel of the flat surface: the view's scale, lowered only when the surface would pass the caps (a deep zoom). */
function flatScale(movie: Movie, view: View): number {
  const w = Math.max(1, movie.width * view.scale), h = Math.max(1, movie.height * view.scale);
  const k = Math.min(1, FLAT_SIDE / Math.max(w, h), Math.sqrt(FLAT_AREA / (w * h)));
  return view.scale * k;
}

export function fitView(movie: Movie, width: number, height: number, margin = 0.06): View {
  const room = 1 - margin * 2;
  const scale = Math.min((width * room) / movie.width, (height * room) / movie.height);
  return { scale, ox: (width - movie.width * scale) / 2, oy: (height - movie.height * scale) / 2, width, height };
}

export class Renderer {
  private readonly bitmaps = new Map<string, ImageBitmap | null>();
  private readonly pending = new Set<string>();
  /** Draw counter and the draw each picture was last used in (byte-cap eviction spares recent ones). */
  private gen = 0;
  private readonly used = new Map<string, number>();
  private readonly pool: Surface[] = [];
  /** Movie-sized flat surfaces for Warp / Distort (a stack, since a warped group may hold warped members). */
  private readonly warpPool: OffscreenCanvas[] = [];
  private pw = 0;
  private ph = 0;
  private spare: Raster = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
  private video: VideoSource | null = null;
  /** GPU compositing (engine/gpu): the compositor, whether frames use it, and the host it calls back into. */
  private gpu: GpuCompositor | null = null;
  private gpuOn = false;
  private gpuHostObj: GpuHost | null = null;
  private prunedFor: Movie | null = null;
  private noCamFor: Movie | null = null;
  private noCam: Movie | null = null;
  /** The compositor belongs to someone else (the probe borrows the main one): this renderer neither prunes nor disposes it. */
  private gpuShared = false;
  /** While an export runs the GPU switch holds still: what was asked for meanwhile lands afterwards. */
  private gpuPin: { want: boolean | null; shared?: GpuCompositor } | null = null;
  /** What the last probe measured; null before the first probe. */
  gpuProbe: ProbeResult | null = null;

  constructor(private readonly blobOf: (id: string) => Blob | undefined, private readonly onReady: () => void) {}

  /** Whether frames are composed on the GPU right now. */
  get gpuActive(): boolean {
    return this.gpuOn && !!this.gpu && this.gpu.ready;
  }

  /** Switches GPU compositing; false when WebGL2 is missing. The CPU path stays the reference and the fallback. `shared`: a compositor owned elsewhere (the probe). */
  useGpu(on: boolean, shared?: GpuCompositor): boolean {
    if (this.gpuPin) { this.gpuPin.want = on; this.gpuPin.shared = shared; return this.gpuOn; }
    if (!on) {
      if (this.gpuOn) { this.gpuOn = false; this.onReady(); }
      this.freeGpu();
      return false;
    }
    if (shared) { this.gpu = shared; this.gpuShared = true; }
    if (!this.gpu) {
      this.gpu = GpuCompositor.create();
      if (this.gpu) this.gpu.onRestore = () => { this.onReady(); };
    }
    if (!this.gpu) return false;
    if (!this.gpuOn) { this.gpuOn = true; if (!shared) this.onReady(); }
    return true;
  }

  /** Releases the WebGL context, programs and pooled surfaces of a compositor this renderer owns; it is made again when GPU is next asked for. */
  private freeGpu(): void {
    if (this.gpuShared) return;
    this.gpu?.dispose();
    this.gpu = null;
    this.prunedFor = null;
  }

  /** Holds the GPU state as it is until the returned function is called, so an export never mixes GPU and CPU frames. */
  pinGpu(): () => void {
    if (this.gpuPin) return () => undefined;
    const pin: { want: boolean | null; shared?: GpuCompositor } = { want: null };
    this.gpuPin = pin;
    return () => {
      if (this.gpuPin !== pin) return;
      this.gpuPin = null;
      if (pin.want !== null) this.useGpu(pin.want, pin.shared);
    };
  }

  /** Turns the GPU on when WebGL2 is available, a probe frame matches the CPU path and a heavy frame is not slower (software GL is); `force` skips the speed test. Resolves to whether it is on. */
  async autoGpu(force = false): Promise<boolean> {
    if (!this.gpu) {
      this.gpu = GpuCompositor.create();
      if (this.gpu) this.gpu.onRestore = () => { this.onReady(); };
    }
    if (!this.gpu) return false;
    const gpu = this.gpu;
    this.gpuProbe = await probeGpu(() => new Renderer(() => undefined, () => {}), gpu);
    if (!this.gpuProbe.ok || (!force && !this.gpuProbe.fast)) {
      // failed or slow: the context is not kept alive for nothing
      if (this.gpu === gpu && !this.gpuOn) this.freeGpu();
      return false;
    }
    return this.useGpu(true);
  }

  private gpuHost(): GpuHost {
    return this.gpuHostObj ?? (this.gpuHostObj = {
      bitmap: (id) => this.bitmap(id),
      video: (c, local, movie) => {
        if (!this.video || !c.asset) return null;
        this.incomplete = true;
        const img = this.video.frame(c.asset, Renderer.videoSeconds(c, local, movie), c.id);
        return img && 'width' in img ? (img as OffscreenCanvas) : null;
      },
      direct: (c, a, tracks, i, frame) => this.direct(c, a, tracks, i, frame),
      cpu: (c, a, local) => this.needsCpu(c, a, local),
      textBox: (c, movie, density, into) => this.textBox(c, movie, density, into),
      raster: (c, local, view, movie, a, into) => { this.drawContent(into.getContext('2d') as OffscreenCanvasRenderingContext2D, c, local, view as View, movie, a); },
    });
  }

  /** Draws a Text content tightly into `into` at `density` pixels per movie pixel; returns the movie-space box it covers. */
  private textBox(c: Content, movie: Movie, density: number, into: OffscreenCanvas): { x: number; y: number; w: number; h: number } | null {
    const s = c.text;
    if (!s || !s.text) return null;
    const mc = into.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const lay = layoutText(s, movie);
    const { x, y, w, h } = lay.box;
    const pw = Math.min(4096, Math.max(1, Math.ceil(w * density))), ph = Math.min(4096, Math.max(1, Math.ceil(h * density)));
    if (into.width !== pw || into.height !== ph) { into.width = pw; into.height = ph; }
    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.clearRect(0, 0, pw, ph);
    const k = pw / w, kv = ph / h;
    mc.setTransform(k, 0, 0, kv, -x * k, -y * kv);
    paintText(mc, s, lay);
    return { x, y, w, h };
  }

  /** Content the GPU compositor does not draw itself: Warp and Distort, layer groups and masks, row masks (a group that holds any). */
  private needsCpu(c: Content, a: Animated, local: number): boolean {
    if (a.warp || a.distort || a.bones) return true;
    // a canvas wider than a GPU texture can be goes through the CPU
    if (c.canvas && Math.max(c.canvas.w, c.canvas.h) > MAX_CANVAS_SIDE / 2) return true;
    switch (c.kind) {
      case 'drawing': return hasTree(c.layers);
      case 'flipbook': {
        if (hasRowMask(c)) return true;
        const f = local + c.offset;
        return c.flip.some((t) => { const i = t.hidden || t.opacity <= 0 ? -1 : flipIndexAt(t, f); return i >= 0 && hasTree(t.frames[i].layers); });
      }
      case 'group': {
        const g = local + c.offset;
        return c.tracks.some((t) => {
          if (t.hidden) return false;
          const m = t.content.find((x) => g >= x.start && g < end(x));
          return !!m && m.opacity > 0 && this.needsCpu(m, animate(m, g - m.start), g - m.start);
        });
      }
      default: return false;
    }
  }

  /** The GPU's result for this frame as a canvas, or null (off, lost, failed): the caller composes on the CPU. */
  private gpuCompose(movie: Movie, frame: number, view: View): OffscreenCanvas | null {
    if (!this.gpuOn || !this.gpu || !this.gpu.ready) return null;
    // a new movie object: textures of deleted contents and pictures go (the live set is cheap next to a frame)
    // (a borrowed compositor holds the owner's textures: never pruned from here)
    if (movie !== this.prunedFor) { this.prunedFor = movie; if (!this.gpuShared) this.gpu.prune(liveSet(movie)); }
    return this.gpu.compose(this.gpuHost(), movie.tracks, frame, view, movie);
  }

  /** `keep`: pictures of a movie being swapped in stay decoded. */
  forget(keep?: Set<string>): void {
    if (!this.gpuShared) this.gpu?.forget(keep);
    for (const [id, b] of [...this.bitmaps]) {
      if (keep?.has(id)) continue;
      b?.close();
      this.bitmaps.delete(id);
    }
    this.pending.clear();
    // decodes already started belong to the old set: they are dropped when they land, unless `keep` names them
    this.forgetGen++;
    this.lastKeep = keep ?? null;
  }

  /** Counts forget() calls; a decode that started before one is stale when it finishes. */
  private forgetGen = 0;
  private lastKeep: Set<string> | null = null;

  /** Stores a finished decode, or closes it when a forget() came in between and did not keep that picture. */
  private settle(id: string, bmp: ImageBitmap | null, gen: number): void {
    if (gen !== this.forgetGen && !this.lastKeep?.has(id)) { bmp?.close(); return; }
    this.keep(id, bmp);
  }

  async preload(blobs: Map<string, Blob>): Promise<void> {
    await Promise.all(Array.from(blobs, async ([id, blob]) => {
      if (this.bitmaps.has(id) || !blob.type.startsWith('image/')) return;
      const gen = this.forgetGen;
      try { this.settle(id, await createImageBitmap(blob), gen); } catch { this.settle(id, null, gen); }
    }));
  }

  bitmap(id: string | null): ImageBitmap | null {
    if (!id) return null;
    const have = this.bitmaps.get(id);
    if (have !== undefined) {
      // most recently used last, so eviction takes the oldest
      this.bitmaps.delete(id);
      this.bitmaps.set(id, have);
      this.used.set(id, this.gen);
      return have;
    }
    if (!this.pending.has(id)) {
      const blob = this.blobOf(id);
      if (!blob) { this.incomplete = true; return null; }
      this.pending.add(id);
      const gen = this.forgetGen;
      createImageBitmap(blob).then((bmp) => { this.settle(id, bmp, gen); }, () => { this.settle(id, null, gen); }).finally(() => { if (gen === this.forgetGen) this.pending.delete(id); this.onReady(); });
    }
    this.incomplete = true;
    return null;
  }

  /** Set when a draw used a picture still decoding or a video frame; such a frame must not be cached. */
  private incomplete = false;

  /** True when the last drawFrame used nothing that may still change (no pending picture, no video block); resets the flag. */
  takeComplete(): boolean {
    const ok = !this.incomplete;
    this.incomplete = false;
    return ok;
  }

  /** Decoded pictures are capped (each 4K layer is about 33 MB); the least recently drawn are closed and decode again on demand. */
  private keep(id: string, bmp: ImageBitmap | null): void {
    this.bitmaps.set(id, bmp);
    this.used.set(id, this.gen);
    let sum = 0;
    for (const b of this.bitmaps.values()) if (b) sum += b.width * b.height * 4;
    if (sum <= BITMAP_CAP_BYTES) return;
    for (const [k, b] of Array.from(this.bitmaps)) {
      if (sum <= BITMAP_CAP_BYTES) break;
      if ((this.used.get(k) ?? 0) >= this.gen - 1) continue;
      if (b) { sum -= b.width * b.height * 4; b.close(); }
      this.bitmaps.delete(k);
      this.used.delete(k);
    }
  }

  /** A cleared scratch surface; `w` x `h` default to the view's size, but a blend onto a flat Warp surface needs that surface's own size. */
  private surface(w = this.pw, h = this.ph): Surface {
    const at = this.pool.findIndex((p) => p.width === w && p.height === h);
    const s = (at >= 0 ? this.pool.splice(at, 1)[0] : this.pool.pop()) ?? new OffscreenCanvas(w, h);
    if (s.width !== w || s.height !== h) { s.width = w; s.height = h; }
    // CPU surfaces are read back by the live filters, masks and the GPU hand-off: keep them in system memory
    const c = s.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, s.width, s.height);
    return s;
  }

  private release(s: Surface): void {
    if (this.pool.length < 12) this.pool.push(s);
  }

  /** `keepAlpha`: export of a transparent movie: nothing is filled behind the content. */
  drawFrame(ctx: Ctx, movie: Movie, frame: number, view: View, opts: { backstage: boolean; background: string; transparentChecker: CanvasPattern | string | null; keepAlpha?: boolean; noCamera?: boolean }): void {
    // `noCamera`: the Stage's Camera mode shows the world as the camera sees it from outside
    let mv = movie;
    if (opts.noCamera && movie.camera) {
      // one camera-less copy per movie object, so the GPU's per-movie bookkeeping and caches see a stable movie
      if (this.noCamFor !== movie) { const { camera: _camera, ...rest } = movie; this.noCamFor = movie; this.noCam = rest as Movie; }
      mv = this.noCam as Movie;
    }
    this.frameNow = frame;
    this.incomplete = false;
    this.nest.length = 0;
    this.flat = null;
    try { this.drawFrameInner(ctx, mv, frame, view, opts); } finally { this.frameNow = -1; }
  }

  /** Movie frame being drawn (parents and the camera follow it), or -1 outside drawFrame (thumbnails draw a content on its own). */
  private frameNow = -1;
  /** Group-local frames of the groups being drawn, innermost last; a group member is placed inside its group only. */
  private readonly nest: number[] = [];
  /** The content being drawn flat for Warp, Distort or bones: no parent or camera applies to that flat picture. */
  private flat: Content | null = null;

  private drawFrameInner(ctx: Ctx, movie: Movie, frame: number, view: View, opts: { backstage: boolean; background: string; transparentChecker: CanvasPattern | string | null; keepAlpha?: boolean }): void {
    this.pw =Math.max(1, Math.round(view.width));
    this.ph = Math.max(1, Math.round(view.height));
    this.gen++;
    const gpu = this.gpuCompose(movie, frame, view);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    if (opts.keepAlpha && movie.transparent) {
      // only the movie frame: letterboxing and content outside the frame stay transparent
      ctx.beginPath();
      ctx.rect(view.ox, view.oy, movie.width * view.scale, movie.height * view.scale);
      ctx.clip();
      if (gpu) ctx.drawImage(gpu, 0, 0);
      else this.composeTracks(ctx as OffscreenCanvasRenderingContext2D, movie.tracks, frame, view, movie);
      ctx.restore();
      return;
    }
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, view.width, view.height);
    const mw = movie.width * view.scale, mh = movie.height * view.scale;
    const layer = gpu ?? this.surface();
    if (!gpu) this.composeTracks(layer.getContext('2d') as OffscreenCanvasRenderingContext2D, movie.tracks, frame, view, movie);
    const back = movie.backstage ?? BACKSTAGE_DEFAULT;
    if (opts.backstage && back > 0) {
      ctx.globalAlpha = back;
      ctx.drawImage(layer, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.ox, view.oy, mw, mh);
    ctx.clip();
    if (movie.transparent && opts.transparentChecker) {
      ctx.fillStyle = opts.transparentChecker;
      ctx.fillRect(view.ox, view.oy, mw, mh);
    } else {
      ctx.fillStyle = movie.background;
      ctx.fillRect(view.ox, view.oy, mw, mh);
    }
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    if (!gpu) this.release(layer);
    ctx.restore();
  }

  private composeTracks(out: OffscreenCanvasRenderingContext2D, tracks: Track[], frame: number, view: View, movie: Movie): void {
    let held: { layer: Surface; c: Content; opacity: number } | null = null;
    const commit = (): void => {
      if (!held) return;
      if (isPixelBlend(held.c.blend)) { blendCanvasOnto(out, held.layer, held.c.blend, held.opacity); this.release(held.layer); held = null; return; }
      out.globalAlpha = held.opacity;
      out.globalCompositeOperation = BLEND_OP[held.c.blend];
      out.drawImage(held.layer, 0, 0);
      out.globalAlpha = 1;
      out.globalCompositeOperation = 'source-over';
      this.release(held.layer);
      held = null;
    };
    for (let i = tracks.length - 1; i >= 0; i--) {
      const t = tracks[i];
      if (t.hidden) continue;
      const c = t.content.find((x) => frame >= x.start && frame < end(x));
      if (!c || c.opacity <= 0) continue;
      const a = animate(c, frame - c.start);
      if (a.opacity <= 0) continue;
      if (this.direct(c, a, tracks, i, frame)) {
        // plain content nothing above masks: drawn straight onto the output, no surface to clear and composite
        commit();
        this.drawContent(out, c, frame - c.start, view, movie, a);
        continue;
      }
      const layer = this.surface();
      const lc = layer.getContext('2d') as OffscreenCanvasRenderingContext2D;
      this.drawContent(lc, c, frame - c.start, view, movie, a);
      this.applyFilters(layer, a, view, movie);
      if ((c.mask === 'alpha' || c.mask === 'luminance') && held) {
        this.applyMask(held.layer, layer, c.mask, c.maskInvert);
        this.release(layer);
        continue;
      }
      if (c.mask === 'clipping' && held) {
        lc.globalCompositeOperation = 'destination-in';
        lc.drawImage(held.layer, 0, 0);
        lc.globalCompositeOperation = 'source-over';
      }
      commit();
      held = { layer, c, opacity: a.opacity };
    }
    commit();
  }

  /** True when content `c` (track `i`) may skip its own surface: opaque, normal blend, no mask or filter, and the next content above does not mask it. */
  private direct(c: Content, a: Animated, tracks: Track[], i: number, frame: number): boolean {
    // a Passthrough group has no surface of its own: its members blend with the tracks beneath
    const through = c.kind === 'group' && c.blend === 'passthrough';
    if (c.mask !== 'none' || (c.blend !== 'normal' && !through) || a.opacity < 1) return false;
    if (a.blur || a.sharpen || a.noise || a.hsb || a.lens || a.boil || a.warp || a.distort || a.bones) return false;
    if (through) {
      for (let j = i - 1; j >= 0; j--) {
        if (tracks[j].hidden) continue;
        const n = tracks[j].content.find((x) => frame >= x.start && frame < end(x));
        if (n && n.opacity > 0 && animate(n, frame - n.start).opacity > 0) return n.mask === 'none';
      }
      return true;
    }
    if (c.kind === 'drawing') { if (c.layers.some((l) => l.blend !== 'normal' || l.opacity < 1)) return false; }
    else if (c.kind !== 'image' && c.kind !== 'text' && c.kind !== 'video') return false;
    for (let j = i - 1; j >= 0; j--) {
      if (tracks[j].hidden) continue;
      const n = tracks[j].content.find((x) => frame >= x.start && frame < end(x));
      // same skip test as composeTracks, keyed opacity included, so the mask above is found exactly when it applies
      if (n && n.opacity > 0 && animate(n, frame - n.start).opacity > 0) return n.mask === 'none';
    }
    return true;
  }

  private applyMask(target: Surface, mask: Surface, mode: 'alpha' | 'luminance', invert: boolean): void {
    const tc = target.getContext('2d') as OffscreenCanvasRenderingContext2D;
    if (mode === 'alpha' && !invert) {
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(mask, 0, 0);
      tc.globalCompositeOperation = 'source-over';
      return;
    }
    const mc = mask.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const img = mc.getImageData(0, 0, mask.width, mask.height);
    const d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      let a = mode === 'luminance' ? ((d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) * d[p + 3]) / 255 : d[p + 3];
      if (invert) a = 255 - a;
      d[p + 3] = a;
    }
    mc.putImageData(img, 0, 0);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(mask, 0, 0);
    tc.globalCompositeOperation = 'source-over';
  }

  drawContent(ctx: OffscreenCanvasRenderingContext2D, c: Content, local: number, view: View, movie: Movie, anim?: Animated): void {
    const t = anim ?? animate(c, local);
    if (t.bones && c.rig) {
      // bones first: drawn flat, skinned to the posed bones; Warp / Distort then bend that result (bones.ts)
      const fs = flatScale(movie, view);
      const fw = Math.max(1, Math.ceil(movie.width * fs)), fh = Math.max(1, Math.ceil(movie.height * fs));
      const fview: View = { ...view, scale: fs, ox: 0, oy: 0 };
      const dview = { scale: view.scale, ox: view.ox, oy: view.oy, srcScale: fs };
      const rect = contentRect(c, movie);
      const take = (): OffscreenCanvasRenderingContext2D => {
        const s = this.warpPool.pop() ?? new OffscreenCanvas(fw, fh);
        if (s.width !== fw || s.height !== fh) { s.width = fw; s.height = fh; }
        const sc = s.getContext('2d') as OffscreenCanvasRenderingContext2D;
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.clearRect(0, 0, fw, fh);
        return sc;
      };
      const fc = take();
      let sk: OffscreenCanvasRenderingContext2D | null = null;
      const was = this.flat;
      try {
        this.flat = c;
        try { this.drawContent(fc, c, local, fview, movie, { ...t, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false, px: 0, py: 0, warp: null, distort: null, bones: null }); } finally { this.flat = was; }
        if (t.warp || t.distort) {
          sk = take();
          drawTriangles(sk, fc.canvas, boneQuads(c.rig, t.bones, rect, movie.width, movie.height, null), { scale: fs, ox: 0, oy: 0 });
          setStagePost(this.postFor(movie, c, local));
          drawWarped(ctx, sk.canvas, t, dview, movie.width, movie.height, rect);
        } else {
          setStagePost(this.postFor(movie, c, local));
          drawTriangles(ctx, fc.canvas, boneQuads(c.rig, t.bones, rect, movie.width, movie.height, t), dview);
        }
      } finally {
        setStagePost(null);
        if (sk) this.warpPool.push(sk.canvas as OffscreenCanvas);
        this.warpPool.push(fc.canvas as OffscreenCanvas);
      }
      return;
    }
    if (t.warp || t.distort) {
      // drawn flat on a surface, then re-projected through the Warp / Distort (warp-draw.ts)
      // sized to the whole movie at this scale, not to the view: a zoomed Stage or a group member's unit view
      // would otherwise crop the content before it is warped; capped (flatScale) and re-projected from that density
      const fs = flatScale(movie, view);
      const fw = Math.max(1, Math.ceil(movie.width * fs)), fh = Math.max(1, Math.ceil(movie.height * fs));
      const flat = this.warpPool.pop() ?? new OffscreenCanvas(fw, fh);
      if (flat.width !== fw || flat.height !== fh) { flat.width = fw; flat.height = fh; }
      const fc = flat.getContext('2d') as OffscreenCanvasRenderingContext2D;
      fc.setTransform(1, 0, 0, 1, 0, 0);
      fc.clearRect(0, 0, fw, fh);
      const was = this.flat;
      try {
        this.flat = c;
        try { this.drawContent(fc, c, local, { ...view, scale: fs, ox: 0, oy: 0 }, movie, { ...t, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false, warp: null, distort: null, bones: null }); } finally { this.flat = was; }
        setStagePost(this.postFor(movie, c, local));
        drawWarped(ctx, flat, t, { scale: view.scale, ox: view.ox, oy: view.oy, srcScale: fs }, movie.width, movie.height, contentRect(c, movie));
      } finally {
        setStagePost(null);
        this.warpPool.push(flat);
      }
      return;
    }
    ctx.save();
    // own move, scale and rotation around the pivot, inside the parents, the group and the camera (engine/transform.ts)
    const live = this.frameNow >= 0 && this.flat !== c;
    const nested = this.nest.length > 0;
    const m = !live
      ? mul(viewMat(view), ownMatrix(t, movie))
      : nested ? memberMatrix(movie, c, this.nest[this.nest.length - 1], t) : topMatrix(movie, c, this.frameNow, t, view);
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    switch (c.kind) {
      case 'image': this.drawImageContent(ctx, c, movie); break;
      case 'video': this.drawVideoContent(ctx, c, local, movie); break;
      case 'drawing': this.drawLayers(ctx, c.layers, movie, canvasOf(c, movie)); break;
      case 'flipbook': this.drawFlipbook(ctx, c, local + c.offset, movie); break;
      case 'text': this.drawText(ctx, c, movie); break;
      case 'group': this.drawGroup(ctx, c, local + c.offset, movie); break;
      default: break;
    }
    ctx.restore();
  }

  /** The parents-and-camera matrix Warp / Distort / bones add after a content's own transform; null when none or outside a frame draw. */
  private postFor(movie: Movie, c: Content, _local: number): Mat | null {
    if (this.frameNow < 0) return null;
    const nested = this.nest.length > 0;
    return postMatrix(movie, c, this.frameNow, nested, nested ? this.nest[this.nest.length - 1] : 0);
  }

  /** Seconds into the video asset shown at a content-local frame. */
  static videoSeconds(c: Content, local: number, movie: Movie): number {
    return Math.max(0, (local + c.offset) / movie.fps);
  }

  private drawVideoContent(ctx: OffscreenCanvasRenderingContext2D, c: Content, local: number, movie: Movie): void {
    const asset = c.asset ? movie.assets[c.asset] : undefined;
    if (!asset || !this.video || !c.asset) return;
    this.incomplete = true;
    const img = this.video.frame(c.asset, Renderer.videoSeconds(c, local, movie), c.id);
    if (!img) return;
    const w = asset.width, h = asset.height;
    ctx.drawImage(img, (movie.width - w) / 2, (movie.height - h) / 2, w, h);
  }

  /** Every video block showing at `frame` (groups included): asset, block id (its decode lane) and asset seconds. */
  static videosAt(movie: Movie, frame: number): { asset: string; lane: string; seconds: number }[] {
    const out: { asset: string; lane: string; seconds: number }[] = [];
    const visit = (tracks: Track[], f: number): void => {
      for (const t of tracks) {
        if (t.hidden) continue;
        const c = t.content.find((x) => f >= x.start && f < end(x));
        if (!c) continue;
        if (c.kind === 'video' && c.asset) out.push({ asset: c.asset, lane: c.id, seconds: Renderer.videoSeconds(c, f - c.start, movie) });
        if (c.kind === 'group') visit(c.tracks, f - c.start + c.offset);
      }
    };
    visit(movie.tracks, frame);
    return out;
  }

  setVideo(v: VideoSource | null): void {
    this.video = v;
  }

  /**
   * Makes the next drawFrame of `frame` exact: every visible picture decoded and every visible video
   * frame decoded for its time (export and still frames use it; on-screen drawing does not wait).
   */
  async prepareFrame(movie: Movie, frame: number): Promise<void> {
    const waits: Promise<void>[] = [];
    const blobs = new Map<string, Blob>();
    const visit = (tracks: Track[], f: number): void => {
      for (const t of tracks) {
        if (t.hidden) continue;
        const c = t.content.find((x) => f >= x.start && f < end(x));
        if (!c) continue;
        const local = f - c.start;
        const want = (id: string | null): void => { if (id && !this.bitmaps.get(id)) { const b = this.blobOf(id); if (b) blobs.set(id, b); } };
        if (c.kind === 'image') want(c.asset);
        if (c.kind === 'drawing') c.layers.forEach((l) => { want(l.pixels); want(l.mask ?? null); });
        if (c.kind === 'flipbook') for (const row of c.flip) { const i = flipIndexAt(row, local + c.offset); if (i >= 0) row.frames[i].layers.forEach((l) => { want(l.pixels); want(l.mask ?? null); }); }
        if (c.kind === 'video' && c.asset && this.video) waits.push(this.video.exact(c.asset, Renderer.videoSeconds(c, local, movie), c.id));
        if (c.kind === 'group') visit(c.tracks, local + c.offset);
      }
    };
    visit(movie.tracks, frame);
    if (blobs.size) {
      for (const id of blobs.keys()) this.bitmaps.delete(id);
      waits.push(this.preload(blobs));
    }
    await Promise.all(waits);
  }

  private drawImageContent(ctx: OffscreenCanvasRenderingContext2D, c: Content, movie: Movie): void {
    const bmp = this.bitmap(c.asset);
    const asset = c.asset ? movie.assets[c.asset] : undefined;
    if (!bmp || !asset) return;
    const w = asset.width, h = asset.height;
    ctx.drawImage(bmp, (movie.width - w) / 2, (movie.height - h) / 2, w, h);
  }

  /** Draws a set of drawing layers in canvas pixels (the Draw & Paint view uses it for onion skins). */
  layersInto(ctx: OffscreenCanvasRenderingContext2D, layers: Content['layers'], movie: Movie, size?: { w: number; h: number }): void {
    this.drawLayers(ctx, layers, movie, size ? { x: 0, y: 0, w: size.w, h: size.h } : undefined);
  }

  /** Layer opacity multiplies the caller's alpha (a Flipbook row, a group member); a normal layer keeps the caller's blend. */
  private drawLayers(ctx: OffscreenCanvasRenderingContext2D, layers: Content['layers'], movie: Movie, rect: CanvasRect = { x: 0, y: 0, w: movie.width, h: movie.height }): void {
    if (hasTree(layers)) {
      ctx.save();
      ctx.translate(rect.x, rect.y);
      drawLayerTree(ctx, layers, rect.w, rect.h, (id) => this.bitmap(id));
      ctx.restore();
      return;
    }
    const baseAlpha = ctx.globalAlpha, baseOp = ctx.globalCompositeOperation;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.opacity <= 0) continue;
      const bmp = this.bitmap(l.pixels);
      if (!bmp) continue;
      if (isPixelBlend(l.blend)) {
        const s = this.surface(ctx.canvas.width, ctx.canvas.height);
        const sc = s.getContext('2d') as OffscreenCanvasRenderingContext2D;
        sc.setTransform(ctx.getTransform());
        sc.drawImage(bmp, rect.x, rect.y, rect.w, rect.h);
        blendCanvasOnto(ctx, s, l.blend, baseAlpha * l.opacity);
        this.release(s);
        continue;
      }
      ctx.globalAlpha = baseAlpha * l.opacity;
      ctx.globalCompositeOperation = l.blend === 'normal' ? baseOp : BLEND_OP[l.blend];
      ctx.drawImage(bmp, rect.x, rect.y, rect.w, rect.h);
    }
    ctx.globalAlpha = baseAlpha;
    ctx.globalCompositeOperation = baseOp;
  }

  private drawFlipbook(ctx: OffscreenCanvasRenderingContext2D, c: Content, local: number, movie: Movie): void {
    const rect = canvasOf(c, movie);
    if (hasRowMask(c)) {
      drawMaskedRows({
        surface: () => this.surface(ctx.canvas.width, ctx.canvas.height), release: (s) => this.release(s), layers: (g, l) => this.drawLayers(g, l, movie, rect),
        mask: (a, b, m, inv) => this.applyMask(a, b, m, inv), blendOp: (b) => BLEND_OP[b],
        blendInto: (g, s, b, alpha) => { if (!isPixelBlend(b)) return false; blendCanvasOnto(g, s, b, alpha); return true; },
      }, ctx, c, local);
      return;
    }
    for (let i = c.flip.length - 1; i >= 0; i--) {
      const t = c.flip[i];
      if (t.hidden || t.opacity <= 0) continue;
      const index = flipIndexAt(t, local);
      if (index < 0) continue;
      if (isPixelBlend(t.blend)) {
        const s = this.surface(ctx.canvas.width, ctx.canvas.height);
        const sc = s.getContext('2d') as OffscreenCanvasRenderingContext2D;
        sc.setTransform(ctx.getTransform());
        this.drawLayers(sc, t.frames[index].layers, movie, rect);
        blendCanvasOnto(ctx, s, t.blend, ctx.globalAlpha * t.opacity);
        this.release(s);
        continue;
      }
      ctx.save();
      ctx.globalAlpha *= t.opacity;
      ctx.globalCompositeOperation = BLEND_OP[t.blend];
      this.drawLayers(ctx, t.frames[index].layers, movie, rect);
      ctx.restore();
    }
  }

  /** Applies the live filters of a content (its keyframed Blur, Sharpen, Noise, HSB and Lens Blur) to its drawn surface. */
  private applyFilters(s: Surface, a: Animated, view: View, movie: Movie): void {
    if (!a.blur && !a.sharpen && !a.noise && !a.hsb && !a.lens && !a.boil) return;
    const sc = s.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const onlyBlur = a.blur > 0 && !a.boil && !a.sharpen && !(a.noise && a.noise.amount > 0) && !a.hsb && !(a.lens && a.lens.radius > 0);
    if (onlyBlur && CANVAS_FILTER) {
      // the browser's own blur runs on the GPU: about 60 ms a frame cheaper than the CPU path at 1080p
      const t = this.surface();
      const tc = t.getContext('2d') as OffscreenCanvasRenderingContext2D;
      tc.filter = `blur(${(a.blur * Math.max(movie.width, movie.height) * 0.05 * view.scale) / 2}px)`;
      tc.drawImage(s, 0, 0);
      tc.filter = 'none';
      sc.clearRect(0, 0, s.width, s.height);
      sc.drawImage(t, 0, 0);
      this.release(t);
      return;
    }
    const img = sc.getImageData(0, 0, s.width, s.height);
    let cur: Raster = { width: s.width, height: s.height, data: img.data };
    if (this.spare.data.length !== cur.data.length) this.spare = { width: s.width, height: s.height, data: new Uint8ClampedArray(cur.data.length) };
    let other: Raster = { width: s.width, height: s.height, data: this.spare.data };
    const step = (fn: (src: Raster, dst: Raster) => void): void => { fn(cur, other); const t = cur; cur = other; other = t; };
    const side = Math.max(movie.width, movie.height) * 0.05 * view.scale;
    if (a.boil) { const b = a.boil; step((src, dst) => { boil(src, dst, { amount: b.amount * view.scale, scale: b.scale * view.scale, seed: b.seed }); }); }
    if (a.hsb) hsb(cur, cur, a.hsb.hue, a.hsb.saturation, a.hsb.brightness);
    if (a.blur > 0) step((src, dst) => gaussianBlur(src, dst, a.blur * side));
    if (a.lens && a.lens.radius > 0) { const l = a.lens; step((src, dst) => lensBlur(src, dst, l.radius * side, l.brightness, l.contrast)); }
    if (a.sharpen > 0) step((src, dst) => sharpen(src, dst, a.sharpen));
    if (a.noise && a.noise.amount > 0) {
      const n = a.noise;
      step((src, dst) => noise(src, dst, { ...n, scale: Math.max(1, n.scale * view.scale), offsetX: n.offsetX * view.scale, offsetY: n.offsetY * view.scale }, 7));
    }
    if (cur.data !== img.data) img.data.set(cur.data);
    sc.putImageData(img, 0, 0);
  }

  private drawText(ctx: OffscreenCanvasRenderingContext2D, c: Content, movie: Movie): void {
    const s = c.text;
    if (!s) return;
    paintText(ctx, s, layoutText(s, movie));
  }

  private drawGroup(ctx: OffscreenCanvasRenderingContext2D, g: Content, local: number, movie: Movie): void {
    const unit: View = { scale: 1, ox: 0, oy: 0, width: movie.width, height: movie.height };
    this.nest.push(local);
    try {
      for (let i = g.tracks.length - 1; i >= 0; i--) {
        const t = g.tracks[i];
        if (t.hidden) continue;
        const c = t.content.find((x) => local >= x.start && local < end(x));
        if (!c || c.opacity <= 0) continue;
        const a = animate(c, local - c.start);
        if (a.opacity <= 0) continue;
        // opacity multiplies down the chain of groups (and keyed opacity counts), a normal member keeps the group's blend
        const alpha = ctx.globalAlpha * a.opacity;
        if (isPixelBlend(c.blend)) {
          const s = this.surface(ctx.canvas.width, ctx.canvas.height);
          const sc = s.getContext('2d') as OffscreenCanvasRenderingContext2D;
          sc.setTransform(ctx.getTransform());
          this.drawContent(sc, c, local - c.start, unit, movie, a);
          blendCanvasOnto(ctx, s, c.blend, alpha);
          this.release(s);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = alpha;
        if (c.blend !== 'normal' && c.blend !== 'passthrough') ctx.globalCompositeOperation = BLEND_OP[c.blend];
        this.drawContent(ctx, c, local - c.start, unit, movie, a);
        ctx.restore();
      }
    } finally {
      this.nest.pop();
    }
  }

  thumb(ctx: CanvasRenderingContext2D, movie: Movie, c: Content, local: number, w: number, h: number, toCanvas = false): void {
    // its own small surface: the shared pool and the view size it is cut to stay as the frame draw left them
    const tw = Math.max(1, Math.round(w)), th = Math.max(1, Math.round(h));
    const s = this.thumbSurf ?? (this.thumbSurf = new OffscreenCanvas(tw, th));
    if (s.width !== tw || s.height !== th) { s.width = tw; s.height = th; }
    const sc = s.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalAlpha = 1;
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, tw, th);
    let view = fitView(movie, w, h, 0);
    if (toCanvas && c.canvas) {
      // frame the Drawing's own canvas instead of the Stage
      const k = canvasOf(c, movie), sk = Math.min(w / k.w, h / k.h);
      view = { scale: sk, ox: (w - k.w * sk) / 2 - k.x * sk, oy: (h - k.h * sk) / 2 - k.y * sk, width: w, height: h };
    }
    this.drawContent(sc, c, local, view, movie);
    ctx.drawImage(s, 0, 0);
  }

  private thumbSurf: OffscreenCanvas | null = null;
}
