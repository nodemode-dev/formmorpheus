// A probe frame: small scenes drawn by the CPU path and the GPU path, compared pixel by pixel. The GPU path
// is switched on only when it agrees. Pure engine code (OffscreenCanvas only).
import { content, newMovie, track } from '../model';
import type { BlendMode, Content, KeyLane, Movie } from '../types';
import type { GpuCompositor } from './compositor';
import { liveSet, type LiveSet } from './live';

/** The slice of Renderer the probe drives (render.ts passes a constructor so this file does not import it). */
export interface ProbeRenderer {
  useGpu(on: boolean, shared?: GpuCompositor): boolean;
  preload(blobs: Map<string, Blob>): Promise<void>;
  forget(): void;
  drawFrame(ctx: OffscreenCanvasRenderingContext2D, movie: Movie, frame: number, view: { scale: number; ox: number; oy: number; width: number; height: number }, opts: { backstage: boolean; background: string; transparentChecker: null }): void;
}

export interface ProbeScene {
  name: string;
  max: number;
  mean: number;
}

export interface ProbeResult {
  /** The GPU picture matches the CPU picture in every scene. */
  ok: boolean;
  scenes: ProbeScene[];
  /** Milliseconds a heavy frame (24 layers) took on each path, and whether the GPU was not slower (software GL is slower). */
  cpuMs: number;
  gpuMs: number;
  fast: boolean;
}

const W = 96, H = 72;

async function picture(): Promise<Blob> {
  const cv = new OffscreenCanvas(64, 48);
  const c = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const g = c.createLinearGradient(0, 0, 64, 48);
  g.addColorStop(0, '#e03030'); g.addColorStop(0.5, '#30c050'); g.addColorStop(1, '#3050e0');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 48);
  c.fillStyle = '#ffd020';
  c.fillRect(6, 6, 22, 14);
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.fillRect(36, 22, 20, 20);
  c.clearRect(52, 0, 12, 10);
  return cv.convertToBlob({ type: 'image/png' });
}

const BW = 640, BH = 360;

async function bigPicture(): Promise<Blob> {
  const cv = new OffscreenCanvas(BW, BH);
  const c = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const g = c.createLinearGradient(0, 0, BW, BH);
  g.addColorStop(0, '#d04040'); g.addColorStop(0.5, '#40c060'); g.addColorStop(1, '#4060d0');
  c.fillStyle = g;
  c.fillRect(0, 0, BW, BH);
  c.fillStyle = 'rgba(255,255,255,0.4)';
  c.fillRect(120, 80, 300, 160);
  return cv.convertToBlob({ type: 'image/png' });
}

const HW = 4096, HH = 2304, LW = 2048, LH = 1152;

/** A source wider than 4K: a driver that mishandles large textures or surfaces fails here, before the GPU is switched on. */
async function hugePicture(): Promise<Blob> {
  const cv = new OffscreenCanvas(HW, HH);
  const c = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const g = c.createLinearGradient(0, 0, HW, HH);
  g.addColorStop(0, '#c04050'); g.addColorStop(0.5, '#40b070'); g.addColorStop(1, '#4070c0');
  c.fillStyle = g;
  c.fillRect(0, 0, HW, HH);
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.fillRect(HW - 900, HH - 600, 700, 400);
  c.fillStyle = '#ffd020';
  c.fillRect(300, 200, 500, 300);
  return cv.convertToBlob({ type: 'image/png' });
}

function largeScene(): Movie {
  const m = newMovie({ width: LW, height: LH, seconds: 1 });
  m.background = '#808080';
  m.assets.huge = { id: 'huge', kind: 'image', name: 'huge', mime: 'image/png', width: HW, height: HH, frames: 1, size: 0 };
  m.tracks = [
    track('T0', [content('image', 0, 24, { asset: 'huge', blend: 'multiply', opacity: 0.7, transform: tr(30, 20, 0.35, 8) })]),
    track('T1', [content('image', 0, 24, { asset: 'huge', transform: tr(0, 0, 0.5, 0) })]),
  ];
  return m;
}

/** 24 picture-sized layers, a quarter of them blended or translucent: what a busy Stage costs. */
function heavyScene(): Movie {
  const m = newMovie({ width: BW, height: BH, seconds: 1 });
  m.assets.big = { id: 'big', kind: 'image', name: 'big', mime: 'image/png', width: BW, height: BH, frames: 1, size: 0 };
  m.tracks = Array.from({ length: 24 }, (_, i) => track(`T${i}`, [
    content('image', 0, 24, {
      asset: 'big', blend: i % 8 === 3 ? 'multiply' : 'normal', opacity: i % 6 === 5 ? 0.5 : 1,
      transform: tr((i * 11) % 60 - 30, (i * 7) % 40 - 20, 1, i % 4 === 0 ? 5 : 0),
    }),
  ]));
  return m;
}

const lane = (kind: KeyLane['kind'], channels: Record<string, number>, options: KeyLane['options'] = {}): KeyLane => ({
  kind, expanded: false, options,
  channels: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, [{ frame: 0, value: v, ease: 'linear' as const }]])),
});

function img(extra: Partial<Content>): Content {
  return content('image', 0, 24, { asset: 'probe', ...extra });
}

function scene(tracks: Content[]): Movie {
  const m = newMovie({ width: W, height: H, seconds: 1 });
  m.background = '#808080';
  m.assets.probe = { id: 'probe', kind: 'image', name: 'probe', mime: 'image/png', width: 64, height: 48, frames: 1, size: 0 };
  m.tracks = tracks.map((c, i) => track(`T${i}`, [c]));
  return m;
}

const tr = (x: number, y: number, scale: number, rotation: number) => ({ x, y, scale, rotation, flipH: false, flipV: false });

function scenes(): { name: string; movie: Movie }[] {
  const modes: BlendMode[] = ['multiply', 'screen', 'overlay', 'color-dodge', 'soft-light', 'difference', 'hue', 'luminosity'];
  return [
    { name: 'transform + blends', movie: scene([
      ...modes.slice(0, 4).map((b, i) => img({ blend: b, opacity: 0.85, transform: tr(i * 9 - 14, i * 5 - 8, 0.6 + i * 0.1, 18 * i - 20) })).reverse(),
      img({ transform: tr(4, -3, 1.4, 12) }),
    ]) },
    { name: 'more blends', movie: scene([
      ...modes.slice(4).map((b, i) => img({ blend: b, transform: tr(i * 7 - 10, i * 6 - 9, 0.9, 7 * i) })).reverse(),
      img({ transform: tr(-4, 2, 1.5, -9) }),
    ]) },
    { name: 'masks + clip + keyed opacity', movie: scene([
      img({ mask: 'luminance', maskInvert: true, transform: tr(10, 6, 0.7, 30) }),
      img({ mask: 'clipping', transform: tr(-6, 0, 0.8, 0) }),
      img({ opacity: 0.8, keys: [lane('opacity', { amount: 0.5 })], mask: 'alpha', maskInvert: true, transform: tr(0, 6, 0.6, -15) }),
      img({ transform: tr(2, 0, 1.3, 5) }),
    ]) },
    { name: 'filters', movie: scene([
      img({ keys: [lane('hsb', { hue: 40, saturation: 0.3, brightness: 0.1 }), lane('blur', { amount: 0.25 }), lane('sharpen', { amount: 0.6 }), lane('noise', { amount: 0.3, scale: 24, octaves: 2, turbulence: 0.3 }, { style: 'clouds' })], transform: tr(0, 0, 1.4, 0) }),
    ]) },
  ];
}

/**
 * Draws every probe scene on the CPU and on the GPU and compares them. Passes when no scene differs by
 * more than `maxLimit` at any pixel on average over `meanLimit` levels (a wrong orientation, matrix or blend fails by far more).
 */
export async function probeGpu(make: () => ProbeRenderer, gpu: GpuCompositor, meanLimit = 3, maxLimit = 90): Promise<ProbeResult> {
  const blob = await picture();
  const r = make();
  const res: ProbeResult = { ok: true, scenes: [], cpuMs: 0, gpuMs: 0, fast: false };
  const list = scenes();
  const heavy = heavyScene();
  try {
    await r.preload(new Map([['probe', blob], ['big', await bigPicture()]]));
    const cpu = new OffscreenCanvas(W, H), dev = new OffscreenCanvas(W, H);
    const cc = cpu.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    const dc = dev.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    const view = { scale: 1, ox: 0, oy: 0, width: W, height: H };
    const opts = { backstage: false, background: '#202020', transparentChecker: null };
    for (const s of list) {
      r.useGpu(false);
      r.drawFrame(cc, s.movie, 0, view, opts);
      if (!r.useGpu(true, gpu)) { res.ok = false; break; }
      r.drawFrame(dc, s.movie, 0, view, opts);
      r.useGpu(false);
      const a = cc.getImageData(0, 0, W, H).data, b = dc.getImageData(0, 0, W, H).data;
      let max = 0, sum = 0;
      for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > max) max = d; sum += d; }
      const mean = sum / a.length;
      res.scenes.push({ name: s.name, max, mean });
      if (mean > meanLimit || max > maxLimit) res.ok = false;
    }
    if (res.ok) {
      await r.preload(new Map([['huge', await hugePicture()]]));
      const big = largeScene();
      const lv = { scale: 1, ox: 0, oy: 0, width: LW, height: LH };
      const lc = new OffscreenCanvas(LW, LH), dl = new OffscreenCanvas(LW, LH);
      const lcx = lc.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      const dlx = dl.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      r.useGpu(false);
      r.drawFrame(lcx, big, 0, lv, opts);
      if (!r.useGpu(true, gpu)) res.ok = false;
      else {
        r.drawFrame(dlx, big, 0, lv, opts);
        r.useGpu(false);
        const a = lcx.getImageData(0, 0, LW, LH).data, b = dlx.getImageData(0, 0, LW, LH).data;
        let max = 0, sum = 0;
        for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > max) max = d; sum += d; }
        const mean = sum / a.length;
        res.scenes.push({ name: 'large surface', max, mean });
        if (mean > meanLimit || max > maxLimit) res.ok = false;
      }
    }
    if (res.ok) {
      const bc = new OffscreenCanvas(BW, BH), bx = bc.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      const bview = { scale: 1, ox: 0, oy: 0, width: BW, height: BH };
      const time = (on: boolean): number => {
        r.useGpu(on, on ? gpu : undefined);
        r.drawFrame(bx, heavy, 0, bview, opts);
        bx.getImageData(0, 0, 1, 1);
        let best = Infinity;
        for (let i = 0; i < 3; i++) {
          const t0 = performance.now();
          r.drawFrame(bx, heavy, 0, bview, opts);
          bx.getImageData(0, 0, 1, 1);
          best = Math.min(best, performance.now() - t0);
        }
        r.useGpu(false);
        return best;
      };
      res.cpuMs = time(false);
      res.gpuMs = time(true);
      res.fast = res.gpuMs <= res.cpuMs;
    }
  } catch {
    res.ok = false;
  }
  r.forget();
  // only the probe's own textures go: the compositor may already hold the open movie's
  const mine: LiveSet = { contents: new Set(), assets: new Set(['probe', 'big', 'huge']) };
  for (const m of [...list.map((s) => s.movie), heavy, largeScene()]) {
    const l = liveSet(m);
    l.contents.forEach((id) => mine.contents.add(id));
  }
  gpu.dropLive(mine);
  return res;
}
