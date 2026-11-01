// CPU stroke engine on a plain Raster (straight RGBA8). Dabs are placed along a
// smoothed path at spacing * diameter. Paint and erase accumulate a per-stroke
// coverage buffer (build-up toward 1), then composite coverage * opacity against
// a snapshot of the untouched pixels, so overlapping dabs never exceed the
// stroke opacity. Smudge works on the live layer and carries picked-up colour.
// Undo bytes are snapshotted lazily per 64 px tile on first touch.

import type { PenSample, PixelPatch, Raster, Rect, StrokeLike, StrokeSettings } from './types';
import { baseAngle, baseDiameter, blendChannel, hsvToRgb, mulberry32, needsColourPath, pressureDiameter, pressureFlow, rgbToHsv, tiltInfo, tiltShape } from './dynamics';
import { getTip, grainTable } from './tips';
import { brushGrain } from './grains-lib';
import { grainFit } from './fam-grain-fit';
import { edgeBreak } from './fam-edge';
import { libTipImage } from './tips-lib';
import type { RenderMode, WetMix } from './types';
import { PenResponse, rollAmount, shapeLean } from './curves';
import { WetPaint } from './wet';
import type { WetStamp } from './wet';
import { RENDER_ALGOS, WET_DEFAULT } from './render-modes';
import { bakeShine, hasShine } from './shine';
import { dries, dryWash } from './wet-dry';
import { paperMap } from './paper';
import { migrateBrush } from './brush-migrate';
import { Bristle, smoothCov } from './bristle';
import { liftPressure, leanDia } from './fam-oil';
import { swathCorner, swathGrid } from './fam-dry';
import { wetMark, wetSample } from './wetmap';
import type { BristleStep } from './bristle';

/** Build-up per mode: scale on a dab's alpha, and whether coverage is capped at the strongest dab. */
const MODES: Record<RenderMode, { k: number; uniform: boolean; heavy: boolean; wet?: WetMix }> = {
  'light-glaze': { k: 0.45, uniform: false, heavy: false },
  'uniform-glaze': { k: 1, uniform: true, heavy: false },
  'intense-glaze': { k: 1.8, uniform: false, heavy: false },
  'heavy-glaze': { k: 1.8, uniform: false, heavy: true },
  'uniform-blending': { k: 1, uniform: true, heavy: false, wet: { dilution: 0.1, charge: 0.7, attack: 0.3, pull: 0.45, grade: 0.5 } },
  'intense-blending': { k: 1.8, uniform: false, heavy: false, wet: { dilution: 0.15, charge: 0.55, attack: 0.6, pull: 0.8, grade: 0.4 } },
  'heavy-blending': { k: 2.4, uniform: false, heavy: true, wet: { dilution: 0.2, charge: 0.45, attack: 0.8, pull: 1, grade: 0.35 } },
};
const NORMAL_MODE = { k: 1, uniform: false, heavy: false };

// Per-pixel stroke colour (rgb), reused between strokes; only read where coverage is non-zero.
let poolCol: Uint16Array | null = null;
let poolColBusy = false;
let poolEdge: Uint8Array | null = null;
let poolEdgeBusy = false;

const TILE = 64;
const TILE_BYTES = TILE * TILE * 4;
const CARRY_MAX = 160;

/** The 256 x 256 grain tile stretched by `k` (above 1 is coarser); mirrored at the edges so it stays seamless. */
function scaleGrain(g: ArrayLike<number>, k: number): Float32Array {
  const out = new Float32Array(65536);
  const wrap = (p: number): number => { const m = ((p % 512) + 512) % 512; return m >= 256 ? 511 - m : m; };
  for (let y = 0; y < 256; y++) {
    const fy = y / k, y0 = Math.floor(fy), ty = fy - y0;
    const ya = wrap(y0) << 8, yb = wrap(y0 + 1) << 8;
    for (let x = 0; x < 256; x++) {
      const fx = x / k, x0 = Math.floor(fx), tx = fx - x0;
      const xa = wrap(x0), xb = wrap(x0 + 1);
      const top = g[ya | xa] + (g[ya | xb] - g[ya | xa]) * tx;
      const bot = g[yb | xa] + (g[yb | xb] - g[yb | xa]) * tx;
      out[(y << 8) | x] = top + (bot - top) * ty;
    }
  }
  return k > 1.001 ? seamless(out) : out;
}

/** A 256 x 256 tile made to wrap without a step at its edges: the tile and a copy shifted by half a tile are cross-faded
 *  with a window that is 0 at the edges, so the stretched or turned grain no longer shows a seam every 256 px. */
function seamless(t: Float32Array): Float32Array {
  const out = new Float32Array(65536);
  const w = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const s = Math.sin((Math.PI * (i + 0.5)) / 256); w[i] = s * s; }
  for (let y = 0; y < 256; y++) {
    const ya = y << 8, yb = ((y + 128) & 255) << 8, wy = w[y];
    for (let x = 0; x < 256; x++) {
      const xb = (x + 128) & 255, wx = w[x];
      // four copies (none, shifted in x, in y, in both), each weighted so the tile's own edges carry no weight
      out[ya | x] = wx * wy * t[ya | x] + (1 - wx) * wy * t[ya | xb] + wx * (1 - wy) * t[yb | x] + (1 - wx) * (1 - wy) * t[yb | xb];
    }
  }
  return out;
}

/** The grain tile turned by `rot` radians about its centre, wrapping at the edges. */
function rotateGrain(g: ArrayLike<number>, rot: number): Float32Array {
  const out = new Float32Array(65536);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = x - 128, v = y - 128;
      const sx = ((Math.round(c * u + s * v + 128) % 256) + 256) % 256;
      const sy = ((Math.round(-s * u + c * v + 128) % 256) + 256) % 256;
      out[(y << 8) | x] = g[(sy << 8) | sx];
    }
  }
  return rot % (Math.PI / 2) === 0 ? out : seamless(out);
}

/** Catmull-Rom read of an N x N picture at (fx, fy), pixel centres on whole numbers; outside the picture reads 0. */
function cubicTap(td: ArrayLike<number>, N: number, fx: number, fy: number): number {
  const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
  const tx2 = tx * tx, tx3 = tx2 * tx, ty2 = ty * ty, ty3 = ty2 * ty;
  const wx0 = -0.5 * tx3 + tx2 - 0.5 * tx, wx1 = 1.5 * tx3 - 2.5 * tx2 + 1, wx2 = -1.5 * tx3 + 2 * tx2 + 0.5 * tx, wx3 = 0.5 * tx3 - 0.5 * tx2;
  const wy0 = -0.5 * ty3 + ty2 - 0.5 * ty, wy1 = 1.5 * ty3 - 2.5 * ty2 + 1, wy2 = -1.5 * ty3 + 2 * ty2 + 0.5 * ty, wy3 = 0.5 * ty3 - 0.5 * ty2;
  let sum = 0;
  for (let j = 0; j < 4; j++) {
    const yy = j0 - 1 + j;
    if (yy < 0 || yy >= N) continue;
    const wy = j === 0 ? wy0 : j === 1 ? wy1 : j === 2 ? wy2 : wy3, o = yy * N;
    let row = 0;
    for (let i = 0; i < 4; i++) {
      const xx = i0 - 1 + i;
      if (xx < 0 || xx >= N) continue;
      row += td[o + xx] * (i === 0 ? wx0 : i === 1 ? wx1 : i === 2 ? wx2 : wx3);
    }
    sum += row * wy;
  }
  return sum;
}

interface P { x: number; y: number; p: number; tx: number; ty: number }

// One coverage buffer is reused between strokes and cleared over the dirty rect only.
let poolCov: Uint16Array | null = null;
let poolBusy = false;

function takeCoverage(len: number): { buf: Uint16Array; pooled: boolean } {
  if (!poolBusy) {
    if (!poolCov || poolCov.length !== len) poolCov = new Uint16Array(len);
    poolBusy = true;
    return { buf: poolCov, pooled: true };
  }
  return { buf: new Uint16Array(len), pooled: false };
}

export class Stroke implements StrokeLike {
  private readonly w: number;
  private readonly h: number;
  private readonly data: Uint8ClampedArray;
  private readonly tilesX: number;
  private readonly snap: (Uint8ClampedArray | undefined)[];
  private readonly rng: () => number;
  private cov: Uint16Array | null = null;
  private covPooled = false;
  private readonly baseDia: number;
  private readonly colorR: number;
  private readonly colorG: number;
  private readonly colorB: number;
  private readonly tooth: Float32Array | null;
  private taperLen: number;
  private travel = 0;
  private endLen: number;
  private endScale = 1;
  /** 1 outside the end taper, falling to 0 at its tip (shaped by the brush's taper tip). */
  private endRamp = 1;
  private startRamp = 1;
  private readonly opBase: number;
  private opRamp = 0;
  private pSm = -1;
  private readonly gblend: number;
  /** The grain's blend mode when it is none of the first three (gblend 3). */
  private readonly gmode: string;
  private strokeSec = 0;
  private dabPeak = 1;
  private leanGrain = 0;
  private bleedNow = 0;
  private penKind = false;
  private mouseKind = false;
  private readonly sel: Uint8Array | null;
  private readonly useCoverage: boolean;

  // dirty bounds, exclusive max
  private dx0 = 0; private dy0 = 0; private dx1 = 0; private dy1 = 0;
  private hasDirty = false;
  private cx0 = 0; private cy0 = 0; private cx1 = 0; private cy1 = 0;
  private callDirty = false;
  private done = false;
  private twist = 0;

  // path state
  private count = 0;
  private first: P | null = null;
  private start: P | null = null;
  private prev: P | null = null;
  private acc = 0;
  private lastStep = 1;
  private dabCount = 0;

  // dab alpha scratch
  private abuf = new Float32Array(0);

  // colour path: stroke colour buffer, colour dynamics, wet mix, pen speed
  private readonly colour: boolean;
  private colBuf: Uint16Array | null = null;
  private colPooled = false;
  private readonly mode: { k: number; uniform: boolean; heavy: boolean };
  private readonly wet: WetMix | null;
  /** The real wet/glaze paint model (paint/wet.ts) when the brush has a wet mix or a rendering mode. */
  private wp: WetPaint | null = null;
  /** Per-channel pressure curves, when the brush has them. */
  private pen: PenResponse | null = null;
  /** The bristle bundle (paint/bristle.ts) when the brush has one; it replaces the stamp. */
  private bristle: Bristle | null = null;
  private bTravel = 0;
  private bdx = 1; private bdy = 0;
  private bstep: BristleStep = { cx: 0, cy: 0, dia: 1, dx: 1, dy: 0, pressure: 0, speed: 0, flow: 1, opacity: 1, travel: 0, ds: 0, grain: 0, moving: false, movement: 1, wobble: 0 };
  private rollNow = 0;
  private curDir: number | null = null;
  private readonly hsv0 = [0, 0, 0];
  private readonly strokeD = [0, 0, 0];
  private readonly tmp = [0, 0, 0];
  private curR = 0; private curG = 0; private curB = 0;
  private wetR = 0; private wetG = 0; private wetB = 0;
  private load = 1;
  private loadTravel = 0;
  private readonly sm = new Float32Array(4);
  private speed = 0;
  private lastT = -1; private lastX = 0; private lastY = 0;
  /** Time of the first sample, for the wet map. */
  private t0 = -1;
  /** Where the pen rested mid-stroke, and how long (a bead of pigment forms there). */
  private readonly pools: { x: number; y: number; t: number }[] = [];
  /** Where and since when the pen has sat still with events still arriving (a held pen), and whether that rest already left its bead. */
  private restX = 0; private restY = 0; private restT = -1; private restDone = false;
  /** Rows each 64 px column of the stroke reached, for brushes whose wash is reworked when the pen lifts. */
  private cols: { top: Int32Array; bot: Int32Array } | null = null;
  private readonly wigA: number;
  private readonly wigB: number;

  // smudge carry: premultiplied rgb (0..255) and alpha (0..1), a g x g grid
  private carry: Float32Array | null = null;
  private carryScratch: Float32Array | null = null;
  private carryG = 0;

  private readonly s: StrokeSettings;

  constructor(private readonly target: Raster, private readonly layerId: string, settings: StrokeSettings) {
    // a brush from before Scatter became a turn is read in the new meaning (same object when it already is)
    const mb = migrateBrush(settings.brush);
    const s: StrokeSettings = mb === settings.brush ? settings : { ...settings, brush: mb };
    this.s = s;
    this.w = target.width;
    this.h = target.height;
    this.data = target.data;
    this.tilesX = Math.ceil(this.w / TILE);
    this.snap = new Array(this.tilesX * Math.ceil(this.h / TILE));
    this.rng = mulberry32(s.seed);
    const zoomK = s.dynamicScaling && s.zoom > 0 ? 1 / s.zoom : 1;
    this.baseDia = baseDiameter(s.brush, s.size, s.sizeRef ?? Math.max(this.w, this.h)) * zoomK;
    this.colorR = s.color.r;
    this.colorG = s.color.g;
    this.colorB = s.color.b;
    this.sel = s.selection && s.selection.width === this.w && s.selection.height === this.h ? s.selection.data : null;
    this.useCoverage = s.tool !== 'smudge';
    if (this.useCoverage) {
      const c = takeCoverage(this.w * this.h);
      this.cov = c.buf;
      this.covPooled = c.pooled;
    }
    const br = s.brush;
    this.colour = s.tool === 'paint' && (needsColourPath(br) || !!br.bristle);
    const md = br.render ? MODES[br.render] : NORMAL_MODE;
    this.mode = md;
    this.wet = s.tool === 'paint' ? (br.wet ?? (br.render ? MODES[br.render].wet ?? null : null)) : null;
    this.wetR = this.colorR; this.wetG = this.colorG; this.wetB = this.colorB;
    this.wigA = (br.wiggle ?? 0) > 0 ? this.rng() * 6.28 : 0;
    this.wigB = (br.wiggle ?? 0) > 0 ? this.rng() * 6.28 : 0;
    if (this.colour && (br.wet || br.render) && !br.bristle) {
      this.wp = new WetPaint(this.w, this.h, this.data, {
        algo: br.render ? RENDER_ALGOS[br.render] : WET_DEFAULT, wet: br.wet ?? null, wetEdges: br.wetEdges ?? 0, baseDia: this.baseDia, rng: this.rng,
      });
      this.wp.setSource(this.snap, this.tilesX);
      // the paper the wash settles into is made now (once per page or worker), not when the pen lifts
      if (dries(br)) {
        paperMap();
        this.cols = { top: new Int32Array(this.tilesX).fill(1 << 30), bot: new Int32Array(this.tilesX).fill(-1) };
      }
      if ((br.wetEdges ?? 0) > 0) {
        if (!poolEdgeBusy) {
          if (!poolEdge || poolEdge.length !== this.w * this.h) poolEdge = new Uint8Array(this.w * this.h);
          poolEdgeBusy = true; this.edgePooled = true; this.edge = poolEdge;
        } else this.edge = new Uint8Array(this.w * this.h);
      }
    }
    if (PenResponse.wanted(br)) this.pen = new PenResponse(br);
    if (this.colour) {
      if (this.wp || br.bristle) { /* the wet model and the bristle bundle keep their own paint, no per-pixel stroke colour */ } else if (!poolColBusy) {
        if (!poolCol || poolCol.length !== this.w * this.h * 3) poolCol = new Uint16Array(this.w * this.h * 3);
        poolColBusy = true;
        this.colBuf = poolCol;
        this.colPooled = true;
      } else this.colBuf = new Uint16Array(this.w * this.h * 3);
      rgbToHsv(this.colorR, this.colorG, this.colorB, this.hsv0);
      const cd = br.colorDyn;
      if (cd) {
        this.strokeD[0] = (this.rng() - 0.5) * (cd.strokeHue ?? 0);
        this.strokeD[1] = (this.rng() - 0.5) * (cd.strokeSat ?? 0);
        this.strokeD[2] = (this.rng() - 0.5) * (cd.strokeBri ?? 0);
        if (cd.strokeSecondary) this.strokeSec = this.rng() * cd.strokeSecondary;
      }
    }
    this.opBase = br.minOpacity !== undefined || br.maxOpacity !== undefined
      ? (br.minOpacity ?? 0) + (Math.max(br.minOpacity ?? 0, br.maxOpacity ?? 1) - (br.minOpacity ?? 0)) * s.opacity
      : s.opacity;
    this.gblend = br.grainBlend === 'subtract' ? 1 : br.grainBlend === 'screen' ? 2 : br.grainBlend && br.grainBlend !== 'multiply' && br.grainBlend !== 'normal' ? 3 : 0;
    this.gmode = this.gblend === 3 ? (br.grainBlend as string) : '';
    if (s.brush.grain > 0 || (s.brush.tiltGradation ?? 0) > 0 || (s.brush.bump ?? 0) > 0) {
      let g: ArrayLike<number> = brushGrain(s.brush) ?? grainTable(s.seed);
      const dmin = s.brush.grainDepthMin ?? 0;
      let gs = (s.brush.grainScale ?? 1) * (s.brush.grainZoom ? Math.pow(Math.max(0.1, this.baseDia / 40), s.brush.grainZoom) : 1);
      // a feature wider than the dab reads as pale cells along a hairline: shrink coarse grain to the dab
      if (s.brush.grain > 0 && !s.brush.grainZoom) gs *= grainFit(g, this.baseDia, gs);
      if (Math.abs(gs - 1) > 0.001) g = scaleGrain(g, Math.min(8, Math.max(0.1, gs)));
      if (s.brush.grainRot) g = rotateGrain(g, s.brush.grainRot);
      const gb = s.brush.grainBright ?? 0, gc = s.brush.grainContrast ?? 0;
      const cm = gc >= 0 ? 1 + gc * 3 : 1 + gc * 0.8;
      const t = new Float32Array(g.length);
      for (let i = 0; i < g.length; i++) {
        let x = (g[i] - 0.3) / 0.4;
        if (gb !== 0 || gc !== 0) x = (x - 0.5) * cm + 0.5 + gb * 0.5;
        x = Math.min(1, Math.max(0, x));
        t[i] = dmin + (1 - dmin) * (x * x * (3 - 2 * x));
      }
      this.tooth = t;
      if (br.grain > 0.2 && this.gblend === 0 && br.grainMode !== 'moving' && !br.grainOffsetJitter && !br.wet && !br.render && (br.grainMovement ?? 1) >= 1) this.capK = Math.min(0.85, br.grain * 0.85);
    } else this.tooth = null;
    if (br.bristle && this.cov && s.tool === 'paint') {
      const wm = br.wet ?? (br.render ? RENDER_ALGOS[br.render].wet : null) ?? { dilution: 0, charge: 1, attack: 0.2, pull: 0.5, grade: 0.5 };
      this.bristle = new Bristle(br.bristle, this.baseDia, wm, {
        w: this.w, h: this.h, data: this.data, cov: this.cov, snap: this.snap, tilesX: this.tilesX, sel: this.sel, lock: s.alphaLock,
        tooth: this.tooth, bump: br.bump ?? 0, burnt: br.burntEdges ?? 0, touch: (a, b, c, d) => this.touch(a, b, c, d),
      }, this.rng);
    }
    this.taperLen = 0;
    this.endLen = 0;
    this.setTaper(false);
  }

  /** Taper lengths: a pen uses the pressure taper when the brush has one, other input the touch taper. */
  private setTaper(pen: boolean): void {
    const b = this.s.brush;
    const usePen = pen && (b.pTaper !== undefined || b.pTaperEnd !== undefined);
    const ts = usePen ? (b.pTaper ?? 0) : (b.taper ?? 0);
    const te = usePen ? (b.pTaperEnd ?? b.pTaper ?? 0) : (b.taperEnd ?? b.taper ?? 0);
    this.taperLen = ts > 0 ? ts * Math.max(24, this.baseDia * 5) : 0;
    this.endLen = te > 0 ? te * Math.max(24, this.baseDia * 5) * 0.6 : 0;
  }

  /** Shapes a 0..1 ramp (1 = full size) by the brush's taper tip: 0 blunt, 1 needle. */
  private shapeRamp(k: number): number {
    const tip = this.s.brush.taperTip;
    return tip === undefined ? k : Math.pow(k, 0.4 + tip * 2.2);
  }

  /** The thinning tail past the last point: dabs continue along the last direction, shrinking to a point. */
  private tailOut(): void {
    const a = this.start, b = this.prev;
    // a mouse click-drag does not grow a ghost tail past the point where the button came up
    if (this.endLen <= 0 || this.mouseKind || !a || !b || this.travel < 4) return;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len, uy = dy / len, dir = Math.atan2(dy, dx);
    // short strokes get a short tail
    const L = Math.min(this.endLen, this.travel * 0.6);
    let pos = 0;
    for (let guard = 0; guard < 4000; guard++) {
      pos += Math.max(0.05, this.lastStep - this.acc);
      this.acc = 0;
      if (pos >= L) break;
      const k = 1 - pos / L;
      this.endRamp = this.shapeRamp(k * k * (3 - 2 * k));
      this.endScale = this.s.brush.taperSize === undefined && this.s.brush.taperTip === undefined ? Math.max(0.1, this.endRamp) : (this.s.brush.taperSize ?? 0.1) + (1 - (this.s.brush.taperSize ?? 0.1)) * this.endRamp;
      this.dab(b.x + ux * pos, b.y + uy * pos, b.p, b.tx, b.ty, dir);
    }
    this.endScale = 1;
    this.endRamp = 1;
  }

  /** A bundle that is lifted leaves hair by hair: the stiff ones go first and each trails off into a streak, so the stroke
   *  does not end in a cut-off square. A brush with its own end taper (tailOut) already thins out. */
  private bristleLift(): void {
    const bs = this.bstep;
    if (!this.bristle || (this.endLen > 0 && !this.mouseKind) || this.travel < 6 || this.s.tool !== 'paint') return;
    const dia = bs.dia, ds = Math.max(1.2, dia * 0.04);
    // each hair lifts at its own place along this run (bristle.ts, lift), so the end frays; a leaning bundle trails longer
    const L = Math.min(dia * (2 + 1.6 * this.speed) * (1 + 0.8 * (bs.lean ?? 0)), this.travel * 0.8);
    const n = Math.min(180, Math.ceil(L / ds));
    if (n < 2) return;
    const p0 = liftPressure(bs.pressure), dx = this.bdx, dy = this.bdy;
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      bs.cx += dx * ds; bs.cy += dy * ds;
      bs.pressure = p0 * (1 - 0.6 * u);
      bs.lift = u;
      bs.travel += ds; bs.ds = ds;
      this.bristle.step(bs);
    }
    bs.lift = 0;
  }

  // ---- StrokeLike ----------------------------------------------------------

  add(sample: PenSample): Rect | null {
    if (this.done || sample.predicted) return null;
    this.twist = sample.twist;
    const prevT = this.lastT;
    if (this.lastT >= 0 && sample.time - this.lastT > 0.5) {
      const dt = sample.time - this.lastT, v = Math.hypot(sample.x - this.lastX, sample.y - this.lastY) / dt;
      // a time constant (28 ms), not a share per event: a pen that reports at 240 Hz gives the same speed as one at 60 Hz
      this.speed += (Math.min(1, v / 3) - this.speed) * (1 - Math.exp(-Math.min(100, dt) / 28));
    }
    if (this.t0 < 0) this.t0 = sample.time;
    // a pen that rests lets the wash pool there: the longer it rests, the thicker the bead
    if (this.lastT >= 0 && this.count > 0 && sample.time - this.lastT > 320 && Math.hypot(sample.x - this.lastX, sample.y - this.lastY) < 4 &&this.pools.length < 64) {
      this.pools.push({ x: sample.x, y: sample.y, t: Math.min(1.8, 1.3 * Math.sqrt((sample.time - this.lastT) / 1000)) });
      this.restT = -1;
      // the resting wash also spreads: a puddle that grows with the rest (three stamps, each wider), then the rim and the bead settle it
      if ((this.s.brush.wetEdges ?? 0) > 0 && this.s.tool === 'paint') {
        const grow = 0.5 * Math.min(1.4, Math.sqrt((sample.time - this.lastT) / 1000)), fl = Math.min(1, this.s.brush.flow);
        for (let k = 1; k <= 3; k++) this.stamp(sample.x, sample.y, this.baseDia * (1 + grow * k / 3), fl, null, null, 1, sample.tiltX, sample.tiltY, 0);
      }
    }
    // a pen held still but still reporting: after 320 ms in a 1.5 px spot the wash pools once, the longer the thicker
    if (this.restT < 0 || Math.hypot(sample.x - this.restX, sample.y - this.restY) > 1.5) { this.restX = sample.x; this.restY = sample.y; this.restT = sample.time; this.restDone = false; }
    else if (!this.restDone && this.count > 1 && sample.time - this.restT > 320 && this.pools.length < 64) {
      this.restDone = true;
      this.pools.push({ x: this.restX, y: this.restY, t: Math.min(1.8, 1.3 * Math.sqrt((sample.time - this.restT) / 1000)) });
    }
    this.lastT = sample.time; this.lastX = sample.x; this.lastY = sample.y;
    if (this.count === 0 && sample.kind === 'pen') { this.penKind = true; this.setTaper(true); }
    if (this.count === 0) this.mouseKind = sample.kind === 'mouse';
    let pr = Math.min(1, Math.max(0, sample.pressure));
    const psm = this.s.brush.pressureSmooth;
    if (psm) {
      // time constant: the share kept per 8 ms event was 0.92 * psm, now held for any report rate
      const dtp = prevT >= 0 ? Math.min(100, Math.max(0.5, sample.time - prevT)) : 8;
      const keep = Math.pow(Math.min(0.995, 0.92 * psm), dtp / 8);
      this.pSm = this.pSm < 0 ? pr : this.pSm + (pr - this.pSm) * (1 - keep);
      pr = this.pSm;
    }
    const p: P = { x: sample.x, y: sample.y, p: pr, tx: sample.tiltX, ty: sample.tiltY };
    this.callDirty = false;
    if (this.count === 0) {
      this.first = p;
      this.prev = p;
      this.count = 1;
      return null;
    }
    const prev = this.prev!;
    if (Math.abs(p.x - prev.x) < 0.01 && Math.abs(p.y - prev.y) < 0.01) {
      // Same spot: only let a harder press replace the pending attributes.
      if (this.count === 1 && p.p > prev.p) { this.first = p; this.prev = p; }
      return null;
    }
    if (this.count === 1) {
      const f = this.first!;
      this.dab(f.x, f.y, f.p, f.tx, f.ty, Math.atan2(p.y - f.y, p.x - f.x));
      this.acc = 0;
      const m = mid(f, p);
      this.walk(f, m);
      this.start = m;
    } else {
      const m2 = mid(prev, p);
      this.curve(this.start!, prev, m2);
      this.start = m2;
    }
    this.prev = p;
    this.count++;
    return this.callRect();
  }

  finish(): PixelPatch | null {
    if (this.done) return null;
    this.callDirty = false;
    if (this.count === 1) {
      const f = this.first!;
      this.dab(f.x, f.y, f.p, f.tx, f.ty, null);
    } else if (this.count > 1) {
      this.walk(this.start!, this.prev!);
      if (this.s.tool !== 'smudge') this.tailOut();
      this.bristleLift();
    }
    this.done = true;
    let patch: PixelPatch | null = null;
    if (this.hasDirty) {
      let rect: Rect = { x: this.dx0, y: this.dy0, w: this.dx1 - this.dx0, h: this.dy1 - this.dy0 };
      const sh = this.s.brush.shine;
      if (this.s.tool === 'paint' && this.wp && this.cov) {
        // the wash dries: the rim pools and the pigment settles into the paper tooth
        const br = this.s.brush, pool = br.wetEdges ?? 0, glaze = !!br.render && RENDER_ALGOS[br.render].glaze;
        // granulation: pigment settles into the paper's valleys, for washes with grain
        const gran = this.tooth && (pool > 0 || (glaze && br.grain >= 0.3)) ? 0.3 + br.grain * 0.7 : 0;
        if (pool > 0 || gran > 0) {
          const last = this.prev;
          // a wash laid over one that is still wet bleeds into it
          // (the bleed reaches past the stroke, so the work rectangle grows by its reach and the undo patch with it)
          let wetw: Float32Array | null = null;
          if (pool > 0 && this.t0 >= 0) {
            const reach = Math.ceil(this.baseDia * 1.3);
            const ex0 = Math.max(0, this.dx0 - reach), ey0 = Math.max(0, this.dy0 - reach), ex1 = Math.min(this.w, this.dx1 + reach), ey1 = Math.min(this.h, this.dy1 + reach);
            wetw = wetSample(this.layerId, this.w, ex0, ey0, ex1, ey1, this.t0);
            if (wetw) { this.touch(ex0, ey0, ex1, ey1); rect = { x: this.dx0, y: this.dy0, w: this.dx1 - this.dx0, h: this.dy1 - this.dy0 }; wetw = wetSample(this.layerId, this.w, this.dx0, this.dy0, this.dx1, this.dy1, this.t0); }
          }
          dryWash({
            wetw,
            ends: pool > 0 ? this.pools.map((q) => ({ x: q.x, y: q.y, r: this.baseDia * (0.4 + 0.12 * q.t), t: q.t * pool })) : undefined,
            data: this.data, w: this.w, x0: this.dx0, y0: this.dy0, x1: this.dx1, y1: this.dy1, cov: this.cov, snap: this.snap, tilesX: this.tilesX,
            pool, gran, radius: Math.min(30, Math.max(2.5, this.baseDia * 0.2)), tooth: this.tooth, lock: this.s.alphaLock, sel: this.sel, edge: this.edge,
            cols: this.cols ?? undefined,
            end: pool > 0 && last && this.count > 1 ? { x: last.x, y: last.y, r: this.baseDia * 0.6, t: 0.12 * pool * this.wp.loadNow } : undefined,
          });
          if (pool > 0 && this.edge && this.lastT >= 0) wetMark(this.layerId, this.w, this.dx0, this.dy0, this.dx1, this.dy1, this.edge, 90, this.lastT, 10 + 14 * (br.wet?.dilution ?? 0.3), this.cols ?? undefined);
        }
      }
      if (this.s.tool === 'paint' && this.cov && hasShine(sh)) {
        if (this.bristle) for (let k = 0; k < 4; k++) smoothCov(this.cov, this.w, this.dx0, this.dy0, this.dx1, this.dy1);
        bakeShine(this.data, this.w, this.h, this.cov, { x0: this.dx0, y0: this.dy0, x1: this.dx1, y1: this.dy1 }, sh, {
          baseDia: this.baseDia, tooth: this.tooth, bump: this.s.brush.bump ?? 0, sel: this.sel, lock: this.s.alphaLock,
        });
      }
      const after = this.copyRect(rect, false);
      const before = this.copyRect(rect, true);
      patch = { layer: this.layerId, rect, before, after };
    }
    this.release();
    return patch;
  }

  cancel(): Rect | null {
    if (this.done) return null;
    this.done = true;
    let rect: Rect | null = null;
    if (this.hasDirty) {
      const w = this.w, h = this.h;
      for (let ti = 0; ti < this.snap.length; ti++) {
        const t = this.snap[ti];
        if (!t) continue;
        const tx = (ti % this.tilesX) * TILE, ty = Math.floor(ti / this.tilesX) * TILE;
        const rw = Math.min(TILE, w - tx), rh = Math.min(TILE, h - ty);
        for (let row = 0; row < rh; row++) {
          const src = row * TILE * 4;
          this.data.set(t.subarray(src, src + rw * 4), ((ty + row) * w + tx) * 4);
        }
      }
      rect = { x: this.dx0, y: this.dy0, w: this.dx1 - this.dx0, h: this.dy1 - this.dy0 };
    }
    this.release();
    return rect;
  }

  // ---- path ----------------------------------------------------------------

  private curve(a: P, c: P, e: P): void {
    const approx = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(e.x - c.x, e.y - c.y);
    const k = Math.min(48, Math.max(1, Math.ceil(approx / 3)));
    let q = a;
    for (let i = 1; i <= k; i++) {
      const t = i / k, u = 1 - t;
      const n: P = {
        x: u * u * a.x + 2 * u * t * c.x + t * t * e.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * e.y,
        p: a.p + (e.p - a.p) * t,
        tx: a.tx + (e.tx - a.tx) * t,
        ty: a.ty + (e.ty - a.ty) * t,
      };
      this.walk(q, n);
      q = n;
    }
  }

  private walk(a: P, b: P): void {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const dir = Math.atan2(dy, dx);
    let pos = 0;
    for (;;) {
      const need = Math.max(0.05, this.lastStep - this.acc);
      if (pos + need > len) { this.acc += len - pos; return; }
      pos += need;
      const t = pos / len;
      this.dab(a.x + dx * t, a.y + dy * t, a.p + (b.p - a.p) * t, a.tx + (b.tx - a.tx) * t, a.ty + (b.ty - a.ty) * t, dir);
      this.acc = 0;
    }
  }

  // ---- dab -----------------------------------------------------------------

  private dab(x: number, y: number, pressure: number, tiltX: number, tiltY: number, dir: number | null): void {
    const { brush, tool, opacity } = this.s;
    const tilt = tiltShape(brush, tiltX, tiltY);
    const pn = this.pen;
    if (pn) pn.update(pressure, this.lastStep, this.baseDia);
    // barrel roll scales size, opacity and edge softness (only when the pen reports a twist)
    let rollK = 1, rollOp = 1, rollBl = 0;
    if (this.twist && (brush.rollSize || brush.rollOpacity || brush.rollBleed)) {
      const ra = rollAmount(this.twist, dir, !!brush.rollRelative) - 0.5;
      rollK = Math.max(0.2, 1 + (brush.rollSize ?? 0) * ra * 1.6);
      rollOp = Math.max(0.05, 1 + (brush.rollOpacity ?? 0) * ra * 2);
      rollBl = Math.max(0, (brush.rollBleed ?? 0) * (ra + 0.5));
    }
    let dia = Math.max(0.6, pressureDiameter(this.baseDia, brush, pn ? pn.size : pressure) * tilt.sizeMul * rollK);
    if (brush.speedSize) dia = Math.max(0.6, dia * Math.min(3, Math.max(0.25, 1 + brush.speedSize * (this.speed - 0.3) * 1.6)));
    if (brush.jitterSize) dia = Math.max(0.6, dia * (1 - brush.jitterSize * 0.7 * this.rng()));
    if (this.taperLen > 0) {
      this.startRamp = this.shapeRamp(Math.min(1, this.travel / this.taperLen));
      const ts = brush.taperSize ?? 0.12;
      dia = Math.max(0.6, dia * (ts + (1 - ts) * this.startRamp));
    }
    if (this.endScale < 1) dia = Math.max(0.6, dia * this.endScale);
    // a bundle lays continuous hair lines, so it steps a little at a time whatever the spacing says
    this.lastStep = Math.max(this.bristle ? Math.min(2.5, Math.max(1.2, dia * 0.04)) : 0.5, brush.spacing * dia);
    if (brush.spacingJitter) this.lastStep *= Math.max(0.2, 1 + (this.rng() - 0.5) * 2 * brush.spacingJitter);
    if (brush.speedSpacing) this.lastStep *= Math.max(0.25, 1 + brush.speedSpacing * (this.speed - 0.3) * 2.2);
    this.travel += this.lastStep;
    let flow = Math.min(1, Math.max(0, brush.flow * pressureFlow(brush, pn ? pn.flow : pressure) * rollOp));
    if (brush.speedOpacity) flow *= Math.min(1.5, Math.max(0.05, 1 + brush.speedOpacity * (this.speed - 0.3) * 1.6));
    if (brush.jitterOpacity) flow *= 1 - brush.jitterOpacity * this.rng();
    // burnout and fall off fade the opacity per distance in brush diameters, so a small brush does not run dry in 600 px
    if (brush.burnout) flow *= Math.max(0.03, 1 - brush.burnout * Math.min(1, this.travel / (this.baseDia * (7 + 70 * (1 - brush.burnout)))));
    if (brush.fallOff) flow *= Math.max(0.03, 1 - brush.fallOff * Math.min(1, this.travel / (this.baseDia * (6 + 50 * (1 - brush.fallOff)))));
    if (brush.taperOpacity) flow *= 1 - brush.taperOpacity * (1 - Math.min(this.startRamp, this.endRamp));
    if (tilt.opacityMul !== 1) flow *= tilt.opacityMul;
    const po = brush.pressureOpacity ?? (brush.curves?.opacity ? 1 : 0);
    if (po) this.opRamp = Math.max(this.opRamp, 1 - po * (1 - (pn ? pn.opacity : pressure)));
    this.bleedNow = (brush.pressureBleed ?? 0) * (pn ? pn.bleed : pressure) + tilt.bleed + rollBl;
    this.leanGrain = tilt.gradation;
    if (flow <= 0.0005) return;
    if (brush.pathJitter && dir !== null) {
      const off = (this.rng() - 0.5) * brush.pathJitter * dia;
      x += -Math.sin(dir) * off; y += Math.cos(dir) * off;
    }
    if (brush.wiggle && dir !== null) {
      // a thin boil line still has to read as wobbling: the amplitude has a floor of 4.5 px, then follows the width
      const amp = brush.wiggle * Math.max(4.5, dia * 0.8), tr = this.travel;
      const off = (Math.sin(tr * 0.045 + this.wigA) * 0.6 + Math.sin(tr * 0.113 + this.wigB) * 0.4) * amp;
      x += -Math.sin(dir) * off; y += Math.cos(dir) * off;
    }
    if (this.colour) {
      this.dabColour(x, y, dia, pressure, tiltX, tiltY);
      flow *= this.alphaMul;
    }
    if (brush.jitterLinear && dir !== null) {
      const off = (this.rng() - 0.5) * 2 * brush.jitterLinear * dia;
      x += Math.cos(dir) * off; y += Math.sin(dir) * off;
    }
    // shape dynamics: count jitter, roundness by pressure and tilt, horizontal / vertical squash jitter
    let n = Math.max(1, Math.min(16, Math.round(brush.shapeCount ?? 1)));
    if (brush.countJitter && n > 1) n = Math.max(1, Math.round(n * (1 - brush.countJitter * this.rng())));
    let rm = tilt.roundnessMul;
    this.roundAng = 0;
    if (brush.pressureRoundness) {
      const v = pn ? pn.round : pressure, k = brush.pressureRoundness;
      rm *= k > 0 ? 1 - k * (1 - v) * 0.9 : 1 + k * v * 0.9;
    }
    if (brush.tiltRoundness) rm *= Math.max(0.05, 1 - brush.tiltRoundness * shapeLean(brush, tiltInfo(tiltX, tiltY).lean) * 0.9);
    if (brush.roundJitterH || brush.roundJitterV) {
      const h = brush.roundJitterH ?? 0, v = brush.roundJitterV ?? 0;
      const useV = v > 0 && (h <= 0 || this.rng() < 0.5);
      rm *= 1 - (useV ? v : h) * 0.9 * this.rng();
      if (useV) this.roundAng = Math.PI / 2;
    }
    if (this.bristle && tool === 'paint') {
      const bs = this.bstep;
      if (dir !== null) {
        this.bdx += (Math.cos(dir) - this.bdx) * 0.35; this.bdy += (Math.sin(dir) - this.bdy) * 0.35;
        const l = Math.hypot(this.bdx, this.bdy) || 1; this.bdx /= l; this.bdy /= l;
      }
      bs.lean = tilt.lean;
      bs.cx = x; bs.cy = y; bs.dia = leanDia(dia, tilt.sizeMul, tilt.lean, brush.bristle?.body ?? 0); bs.dx = this.bdx; bs.dy = this.bdy;
      bs.pressure = pn ? pn.size : pressure; bs.speed = this.speed;
      bs.flow = flow; bs.opacity = brush.pressureOpacity || brush.curves?.opacity ? this.opBase * this.opRamp : this.opBase;
      bs.travel = this.travel; bs.ds = Math.max(0, this.travel - this.bTravel); this.bTravel = this.travel;
      bs.grain = brush.grain; bs.moving = brush.grainMode === 'moving'; bs.movement = brush.grainMovement ?? 1;
      bs.wobble = (brush.pathJitter ?? 0) * 0.5;
      this.bristle.step(bs);
      this.dabCount++;
      return;
    }
    if (brush.tiltCompress && tilt.angle !== null && tilt.sizeMul > 1.3 && n === 1) {
      // size compression: the wide oval is made of stamps at the tip's own size, laid side by side along and across
      // the lean, so the texture inside each stamp keeps its scale (the stamp is not blown up)
      const longK = tilt.sizeMul, shortK = Math.max(1, tilt.sizeMul * tilt.roundnessMul), d0 = Math.max(0.6, dia / longK);
      const rmFlat = rm / Math.max(0.05, tilt.roundnessMul), ca = Math.cos(tilt.angle), sa = Math.sin(tilt.angle);
      const spanA = (longK - 1) * d0, spanB = (shortK - 1) * d0;
      const grid = swathGrid(spanA, spanB, d0 * Math.max(0.15, Math.min(1, brush.roundness * rmFlat))), nA = grid.nA, nB = grid.nB;
      flow *= grid.flowK;
      let k = 0;
      for (let i = 0; i < nA; i++) {
        const u = nA > 1 ? (i / (nA - 1) - 0.5) * spanA : 0;
        for (let j = 0; j < nB; j++) {
          const v = nB > 1 ? (j / (nB - 1) - 0.5) * spanB : 0;
          if (nB > 1 && swathCorner(u, v, spanA, spanB)) continue;
          this.stamp(x + ca * u - sa * v, y + sa * u + ca * v, d0, flow, dir, null, rmFlat, tiltX, tiltY, k++);
        }
      }
      return;
    }
    if (n === 1) { this.stamp(x, y, dia, flow, dir, tilt.angle, rm, tiltX, tiltY, 0); return; }
    // Count: n copies of the same stamp at its full size, side by side across the stamp's width (like the hairs of a
    // bristle bundle), each in its own stratum with a little chance in where it falls
    const pd = dir ?? 0, px = -Math.sin(pd), py = Math.cos(pd);
    for (let k = 0; k < n; k++) {
      const off = ((k + this.rng()) / n - 0.5) * dia * 0.8;
      this.stamp(x + px * off, y + py * off, dia, flow, dir, tilt.angle, rm, tiltX, tiltY, k);
    }
  }

  /** The stamp's alpha (as a share of the flow) blended with the grain by any blend mode, mixed in by the grain's depth. */
  private grainOther(v: number, tv: number, gk: number, flow: number): number {
    const vn = flow > 0 ? v / flow : 0;
    return flow * (vn + (blendChannel(this.gmode, vn * 255, tv * 255) / 255 - vn) * gk);
  }

  private alphaMul = 1;
  /** Paper tooth as a ceiling on a pixel's coverage (canvas-anchored grain), so dry media never go solid however many dabs overlap. */
  private capK = 0;
  private capNow = 0;
  private roundAng = 0;
  private dabX = 0;
  private dabY = 0;
  private readonly wst: WetStamp = { x0: 0, y0: 0, x1: 0, y1: 0, ab: new Float32Array(0), bw: 0, cov: new Uint16Array(0), w: 0, sel: null, lock: false, opacity: 1, cx: 0, cy: 0, tooth: null, bump: 0, burnt: 0, peak: 1, snap: [], tilesX: 0, edge: null, blend: null, lum: 0 };
  /** The wash's shape (paint/wet-dry.ts): coverage per dab-flow, for brushes with wet edges. */
  private edge: Uint8Array | null = null;
  private edgePooled = false;

  /** Composite one stamp with the wet / glaze paint model (paint/wet.ts). */
  private applyWet(x0: number, y0: number, x1: number, y1: number, ab: Float32Array, bw: number, opacity: number): void {
    const st = this.wst, br = this.s.brush;
    st.x0 = x0; st.y0 = y0; st.x1 = x1; st.y1 = y1; st.ab = ab; st.bw = bw;
    st.cov = this.cov!; st.w = this.w; st.sel = this.sel; st.lock = this.s.alphaLock; st.opacity = opacity;
    st.cx = this.dabX; st.cy = this.dabY;
    st.tooth = this.tooth; st.bump = br.bump ?? 0; st.burnt = br.burntEdges ?? 0; st.peak = this.dabPeak;
    st.snap = this.snap; st.tilesX = this.tilesX; st.edge = this.edge;
    st.blend = br.blend && br.blend !== 'normal' ? br.blend : null; st.lum = br.lumBlend ?? 0;
    this.wp!.paint(st);
  }

  /** Colour of the next dab: colour dynamics first, then the wet mix on top. */
  private dabColour(x: number, y: number, dia: number, pressure: number, tiltX: number, tiltY: number): void {
    const { brush } = this.s;
    let r = this.colorR, g = this.colorG, b = this.colorB;
    const cd = brush.colorDyn;
    if (cd) {
      const hsv = this.hsv0, d = this.strokeD, rg = this.rng;
      const pc = pressure - 0.5;
      const lean = cd.tiltHue || cd.tiltSat || cd.tiltBri ? tiltInfo(tiltX, tiltY).lean : 0;
      const h = hsv[0] + d[0] + (cd.stampHue ? (rg() - 0.5) * cd.stampHue : 0) + (cd.pressureHue ?? 0) * pc * 0.5 + (cd.tiltHue ?? 0) * lean * 0.5;
      const sa = hsv[1] + d[1] + (cd.stampSat ? (rg() - 0.5) * cd.stampSat : 0) + (cd.pressureSat ?? 0) * pc + (cd.tiltSat ?? 0) * lean;
      const br = hsv[2] + d[2] + (cd.stampBri ? (rg() - 0.5) * cd.stampBri : 0) + (cd.pressureBri ?? 0) * pc + (cd.tiltBri ?? 0) * lean;
      hsvToRgb(h, sa, br, this.tmp);
      r = this.tmp[0]; g = this.tmp[1]; b = this.tmp[2];
      const c2 = this.s.color2;
      if (c2 && (cd.stampSecondary || cd.strokeSecondary)) {
        const k = Math.min(1, this.strokeSec + (cd.stampSecondary ? this.rng() * cd.stampSecondary : 0));
        r += (c2.r - r) * k; g += (c2.g - g) * k; b += (c2.b - b) * k;
      }
    }
    if (this.bristle) {
      this.bristle.setColour(r, g, b);
      this.alphaMul = 1;
      return;
    }
    if (this.wp) {
      // the wet model takes the dab colour and does its own mixing and dilution
      this.dabX = x; this.dabY = y;
      this.wp.setColour(r, g, b);
      this.wp.prepare(x, y, dia, this.travel, brush.spacing);
      this.alphaMul = 1;
      return;
    }
    let mul = 1;
    const w = this.wet;
    if (w) {
      const sm = this.sm;
      let rad = dia * 0.35;
      if (w.blur) rad *= 1 + w.blur * 4 * (w.blurJitter ? 1 - w.blurJitter * 0.9 * this.rng() : 1);
      else if (w.blurJitter) rad *= 1 - w.blurJitter * 0.9 * this.rng();
      this.sampleCanvas(x, y, rad);
      const stepF = Math.min(1, brush.spacing);
      if (sm[3] > 0.03) {
        const k = Math.min(1, w.pull * 0.5 * Math.min(1, stepF * 3) * sm[3]);
        this.wetR += (sm[0] / sm[3] - this.wetR) * k;
        this.wetG += (sm[1] / sm[3] - this.wetG) * k;
        this.wetB += (sm[2] / sm[3] - this.wetB) * k;
      }
      // per distance in brush diameters (not per dab), so it runs dry after the same stretch at any size
      this.load = Math.max(0, this.load - (1 - w.charge) * Math.max(0, this.travel - this.loadTravel) / (Math.max(1, dia) * 24));
      this.loadTravel = this.travel;
      const atk = w.attack * Math.max(0, 1 - this.travel / (dia * 3)) * 0.8 * sm[3];
      let m = Math.min(1, w.dilution * 0.5 + (1 - this.load) * 0.6 + atk + w.pull * 0.45 * sm[3]);
      m = Math.pow(m, 0.5 + w.grade);
      if (w.wetJitter) m *= 1 - w.wetJitter * this.rng();
      r += (this.wetR - r) * m; g += (this.wetG - g) * m; b += (this.wetB - b) * m;
      mul = (1 - w.dilution * 0.5) * (0.4 + 0.6 * this.load);
    }
    this.curR = r; this.curG = g; this.curB = b;
    this.alphaMul = mul;
  }

  /** Premultiplied average of the layer around a point, into this.sm. */
  private sampleCanvas(cx: number, cy: number, r: number): void {
    const { w, h, data, sm } = this;
    sm[0] = sm[1] = sm[2] = sm[3] = 0;
    for (let i = 0; i < 5; i++) {
      const px = Math.min(w - 1, Math.max(0, Math.round(i === 0 ? cx : cx + (i === 1 ? r : i === 2 ? -r : 0))));
      const py = Math.min(h - 1, Math.max(0, Math.round(i === 0 ? cy : cy + (i === 3 ? r : i === 4 ? -r : 0))));
      const o = (py * w + px) << 2, a = data[o + 3] / 255;
      sm[0] += data[o] * a * 0.2; sm[1] += data[o + 1] * a * 0.2; sm[2] += data[o + 2] * a * 0.2; sm[3] += a * 0.2;
    }
  }

  private stamp(x: number, y: number, dia: number, flow: number, dir: number | null, tiltAngle: number | null, tiltRound: number, tiltX: number, tiltY: number, _k: number): void {
    const { brush, tool } = this.s;
    const opacity = brush.pressureOpacity || brush.curves?.opacity ? this.opBase * this.opRamp : this.opBase;
    this.dabPeak = flow;
    this.capNow = this.capK > 0 ? Math.min(0.97, this.capK * 1.25 * (1 - 0.4 * Math.min(1, flow)) * (1 + this.leanGrain * 0.5)) : 0;
    let cx = x, cy = y;
    if (brush.scatterPos) {
      cx += (this.rng() - 0.5) * 2 * brush.scatterPos * dia;
      cy += (this.rng() - 0.5) * 2 * brush.scatterPos * dia;
    }
    // pixel perfect: a whole-pixel size, centred on the pixel grid, thresholded below (no anti-alias)
    const px1 = !!brush.pixelPerfect;
    if (px1) {
      dia = Math.max(1, Math.round(dia));
      const odd = dia % 2 === 1;
      cx = odd ? Math.floor(cx) + 0.5 : Math.round(cx);
      cy = odd ? Math.floor(cy) + 0.5 : Math.round(cy);
    }
    let angle = baseAngle(brush) + (brush.baseRot ?? 0) - (brush.orientScreen && this.s.viewRot ? this.s.viewRot : 0);
    // Rotation: 1 turns with the stroke, 0 holds, -1 turns against it (the plain flag is 1)
    const rf = brush.rotFollow ?? (brush.followStroke ? 1 : 0);
    if (rf !== 0 && dir !== null) angle = (brush.baseRot ?? 0) + rf * (dir + Math.PI / 2);
    if (brush.azimuth && (tiltX || tiltY)) angle = tiltInfo(tiltX, tiltY).azimuth;
    if (tiltAngle !== null) angle = tiltAngle;
    if (this.s.roll && this.twist) angle = (this.twist * Math.PI) / 180;
    // Scatter: a random turn per stamp (rotationJitter is its older name; the larger of the two counts)
    const sc = brush.scatter > brush.rotationJitter ? brush.scatter : brush.rotationJitter;
    if (sc > 0) angle += (this.rng() - 0.5) * Math.PI * 2 * sc;
    angle += this.roundAng;
    const rn = Math.min(1, Math.max(0.05, brush.roundness * tiltRound));

    const a = dia / 2, b = Math.max(0.4, a * rn);
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const ex = Math.hypot(a * ca, b * sa) + 2, ey = Math.hypot(a * sa, b * ca) + 2;
    const x0 = Math.max(0, Math.floor(cx - ex)), x1 = Math.min(this.w, Math.ceil(cx + ex));
    const y0 = Math.max(0, Math.floor(cy - ey)), y1 = Math.min(this.h, Math.ceil(cy + ey));
    if (x1 <= x0 || y1 <= y0) return;

    this.touch(x0, y0, x1, y1);
    this.dabCount++;
    const bw = x1 - x0, bh = y1 - y0;
    if (this.abuf.length < bw * bh) this.abuf = new Float32Array(Math.max(bw * bh, this.abuf.length * 2));
    const ab = this.abuf;

    // Stage 1: tip alpha * flow * grain into the scratch buffer.
    const libTip = brush.tipId ? libTipImage(brush.tipId) : undefined;
    // Blur (wet mix) also softens the edge of what is laid down, not only the colour it picks up
    const tip = getTip(libTip ? 'sampled' : brush.tip, dia, px1 ? 0 : Math.min(1, brush.softness + this.bleedNow + (brush.wet?.blur ?? 0) * 0.6), rn, angle, libTip ?? brush.tipImage);
    const scale = dia / tip.diameter;
    const inv = 1 / scale;
    const N = tip.size, td = tip.data;
    const off = N / 2 - 0.5;
    const tooth = this.tooth;
    let gk = brush.grain;
    if (brush.grainJitter) gk = Math.max(0, gk * (1 - brush.grainJitter * this.rng()));
    if (this.leanGrain > 0) gk = Math.min(1, gk + this.leanGrain * (1 - gk));
    // Moving grain is anchored to the stamp, texturized grain to the canvas.
    const moving = brush.grainMode === 'moving';
    const jit = brush.grainOffsetJitter ? brush.grainOffsetJitter * 256 : 0;
    // Grain movement: 1 renews the grain at every stamp (roller), lower keeps most of it so it drags and smears.
    const gm = brush.grainMovement ?? 1, g0 = gm < 1 ? this.s.seed & 255 : 0;
    const gy = moving ? ((g0 + this.rng() * 256 * gm) | 0) - y0 : jit ? ((this.rng() * jit) | 0) : 0;
    const gx = moving ? ((((g0 * 7) & 255) + this.rng() * 256 * gm) | 0) - x0 : jit ? ((this.rng() * jit) | 0) : 0;
    const gb = this.gblend;
    // moving grain that turns with the stroke: tile coordinates are the stamp-relative position turned by dir * grainRotFollow
    const rotG = moving && !!brush.grainRotFollow && dir !== null && !!tooth;
    const grot = rotG ? dir! * brush.grainRotFollow! : 0, cgr = Math.cos(grot), sgr = Math.sin(grot);
    const gcx = cx + gx, gcy = cy + gy;
    const f255 = flow / 255;
    const filt = brush.tipFilter ?? (brush.tipSharp ? 'none' : 'classic');
    const fX = !!brush.flipX, fY = !!brush.flipY, nn = filt === 'none', bic = filt === 'improved';
    const special = fX || fY || nn || bic;
    for (let py = y0; py < y1; py++) {
      let fy = (py + 0.5 - cy) * inv + off;
      if (fY) fy = 2 * off - fy;
      if (nn) fy = Math.round(fy);
      const j0 = Math.floor(fy), wy = fy - j0;
      const rowO = (py - y0) * bw;
      const gRow = ((py + gy) & 255) << 8;
      const fxa = (x0 + 0.5 - cx) * inv + off, fxb = (x1 - 0.5 - cx) * inv + off;
      if (!special && j0 >= 0 && j0 + 1 < N && fxa >= 0 && fxb < N - 1) {
        // Interior row: every tap is inside the map.
        const r0 = j0 * N, r1 = r0 + N;
        for (let px = x0; px < x1; px++) {
          const fx = (px + 0.5 - cx) * inv + off;
          const i0 = fx | 0, wx = fx - i0;
          const top = td[r0 + i0] + (td[r0 + i0 + 1] - td[r0 + i0]) * wx;
          const bot = td[r1 + i0] + (td[r1 + i0 + 1] - td[r1 + i0]) * wx;
          let v = (top + (bot - top) * wy) * f255;
          if (v > 0 && tooth) {
            const tv = rotG ? tooth[((((sgr * (px + 0.5 - cx) + cgr * (py + 0.5 - cy) + gcy) | 0) & 255) << 8) | (((cgr * (px + 0.5 - cx) - sgr * (py + 0.5 - cy) + gcx) | 0) & 255)] : tooth[gRow | ((px + gx) & 255)];
            v = gb === 0 ? v * (1 - gk + gk * tv) : gb === 1 ? v * Math.max(0, 1 - 2 * gk * (1 - tv)) : gb === 2 ? v + (flow - v) * gk * tv : this.grainOther(v, tv, gk, flow);
          }
          ab[rowO + px - x0] = v;
        }
        continue;
      }
      for (let px = x0; px < x1; px++) {
        let fx = (px + 0.5 - cx) * inv + off;
        if (fX) fx = 2 * off - fx;
        if (nn) fx = Math.round(fx);
        const i0 = Math.floor(fx), wx = fx - i0;
        let v = 0;
        if (bic) {
          // improved filtering: a bicubic (Catmull-Rom) read of the picture, sharper than the bilinear one and without its jaggies
          v = cubicTap(td, N, fx, fy) * f255;
          if (v < 0) v = 0; else if (v > flow) v = flow;
          if (v > 0 && tooth) {
            const tv = rotG ? tooth[((((sgr * (px + 0.5 - cx) + cgr * (py + 0.5 - cy) + gcy) | 0) & 255) << 8) | (((cgr * (px + 0.5 - cx) - sgr * (py + 0.5 - cy) + gcx) | 0) & 255)] : tooth[gRow | ((px + gx) & 255)];
            v = gb === 0 ? v * (1 - gk + gk * tv) : gb === 1 ? v * Math.max(0, 1 - 2 * gk * (1 - tv)) : gb === 2 ? v + (flow - v) * gk * tv : this.grainOther(v, tv, gk, flow);
          }
        } else if (i0 >= -1 && i0 < N && j0 >= -1 && j0 < N) {
          const ia = i0 >= 0, ib = i0 + 1 < N, ja = j0 >= 0, jb = j0 + 1 < N;
          const v00 = ia && ja ? td[j0 * N + i0] : 0;
          const v10 = ib && ja ? td[j0 * N + i0 + 1] : 0;
          const v01 = ia && jb ? td[(j0 + 1) * N + i0] : 0;
          const v11 = ib && jb ? td[(j0 + 1) * N + i0 + 1] : 0;
          const top = v00 + (v10 - v00) * wx, bot = v01 + (v11 - v01) * wx;
          v = (top + (bot - top) * wy) * f255;
          if (v > 0 && tooth) {
            const tv = rotG ? tooth[((((sgr * (px + 0.5 - cx) + cgr * (py + 0.5 - cy) + gcy) | 0) & 255) << 8) | (((cgr * (px + 0.5 - cx) - sgr * (py + 0.5 - cy) + gcx) | 0) & 255)] : tooth[gRow | ((px + gx) & 255)];
            v = gb === 0 ? v * (1 - gk + gk * tv) : gb === 1 ? v * Math.max(0, 1 - 2 * gk * (1 - tv)) : gb === 2 ? v + (flow - v) * gk * tv : this.grainOther(v, tv, gk, flow);
          }
        }
        ab[rowO + px - x0] = v;
      }
    }
    if (brush.edgeBreak) edgeBreak(ab, bw, bh, x0, y0, cx, cy, a, flow, brush.edgeBreak, tooth);
    if (px1 || brush.alphaThreshold !== undefined) {
      // hard edge: a pixel is all in or all out (past the brush's Alpha Threshold; half for pixel art)
      const hard = flow, n = bw * bh, thr = hard * (px1 ? 0.5 : Math.max(0.01, Math.min(1, brush.alphaThreshold!)));
      for (let i = 0; i < n; i++) ab[i] = ab[i] >= thr ? hard : 0;
    }

    if (tool === 'paint') {
      if (this.wp) this.applyWet(x0, y0, x1, y1, ab, bw, opacity);
      else if (this.colour) this.applyPaintDyn(x0, y0, x1, y1, ab, bw, opacity);
      else this.applyPaint(x0, y0, x1, y1, ab, bw, opacity);
    }
    else if (tool === 'erase') this.applyErase(x0, y0, x1, y1, ab, bw, opacity);
    else this.applySmudge(x0, y0, x1, y1, ab, bw, opacity, cx, cy, 2 * Math.max(ex, ey));
  }

  private applyPaint(x0: number, y0: number, x1: number, y1: number, ab: Float32Array, bw: number, opacity: number): void {
    const { w, data, cov, sel, tilesX, snap } = this;
    const cv = cov!;
    const cr = this.colorR, cg = this.colorG, cb = this.colorB;
    const lock = this.s.alphaLock;
    const capNow = this.capNow, tooth = this.tooth;
    // the far end of the paper for this colour (white under a dark chalk, black under a light one) and 1 over its distance to the colour
    const lumC = 0.3 * cr + 0.59 * cg + 0.11 * cb, capE = lumC < 128 ? 255 : 0, capD = 1 / Math.max(40, Math.abs(capE - lumC));
    for (let py = y0; py < y1; py++) {
      const rowO = (py - y0) * bw - x0;
      const trow = (py >> 6) * tilesX;
      const yo = (py & 63) << 6;
      // one 64 px tile of the undo snapshot at a time: no tile lookup per pixel
      for (let px = x0; px < x1;) {
        const t = snap[trow + (px >> 6)]!;
        const tEnd = Math.min(x1, (px | 63) + 1);
        for (; px < tEnd; px++) {
          const a = ab[rowO + px];
          if (a < 0.0004) continue;
          const idx = py * w + px;
          const cq = cv[idx];
          if (cq >= 65500) continue; // saturated: pixel already holds its final value
          const c0 = cq / 65535;
          let c = c0 + (1 - c0) * a;
          if (capNow > 0) { const cap = 1 - capNow * (1 - tooth![((py & 255) << 8) | (px & 255)]); if (c > cap) c = cap > c0 ? cap : c0; }
          cv[idx] = (c * 65535 + 0.5) | 0;
          let f = c * opacity;
          if (sel) f *= sel[idx] / 255;
          const o = (yo | (px & 63)) << 2;
          const ao = t[o + 3] / 255;
          const di = idx << 2;
          if (capNow > 0 && ao > 0) {
            // dry media keep their tooth over repeated passes too: what an earlier pass left in a valley of the paper
            // (how near the pixel already is to this colour, against the paper's far end) counts toward the same ceiling
            const lumT = 0.3 * t[o] + 0.59 * t[o + 1] + 0.11 * t[o + 2];
            let pre = (capE - lumT) * capD;
            pre = ao * (pre < 0 ? 0 : pre > 1 ? 1 : pre);
            if (pre > 0.02) {
              const ceil = 1 - capNow * 0.9 * (1 - tooth![((py & 255) << 8) | (px & 255)]);
              const tot = pre + (1 - pre) * f;
              if (tot > ceil) { const fl = pre >= 1 ? 0 : (ceil - pre) / (1 - pre); f = fl > 0 ? Math.max(f * 0.2, Math.min(f, fl)) : f * 0.2; }
            }
          }
          if (lock) {
            if (ao === 0) continue;
            data[di] = t[o] + (cr - t[o]) * f;
            data[di + 1] = t[o + 1] + (cg - t[o + 1]) * f;
            data[di + 2] = t[o + 2] + (cb - t[o + 2]) * f;
          } else {
            const oa = ao * (1 - f);
            const outA = f + oa;
            if (outA <= 0) continue;
            const k = 1 / outA;
            data[di] = (cr * f + t[o] * oa) * k;
            data[di + 1] = (cg * f + t[o + 1] * oa) * k;
            data[di + 2] = (cb * f + t[o + 2] * oa) * k;
            data[di + 3] = outA * 255;
          }
        }
      }
    }
  }

  /** Paint with a per-pixel stroke colour: colour dynamics, wet mix, build-up modes, pooled edges and relief. */
  private applyPaintDyn(x0: number, y0: number, x1: number, y1: number, ab: Float32Array, bw: number, opacity: number): void {
    const { w, data, cov, sel, tilesX, snap, mode } = this;
    const cv = cov!, col = this.colBuf!;
    const cr = this.curR, cg = this.curG, cb = this.curB;
    const lock = this.s.alphaLock;
    const we = this.s.brush.wetEdges ?? 0;
    const bump = (this.s.brush.bump ?? 0) * 70;
    const tooth = bump > 0 ? this.tooth : null;
    const burnt = this.s.brush.burntEdges ?? 0, lumB = this.s.brush.lumBlend ?? 0;
    const burntMode = this.s.brush.burntMode && this.s.brush.burntMode !== 'normal' ? this.s.brush.burntMode : null;
    const bmode = this.s.brush.blend && this.s.brush.blend !== 'normal' ? this.s.brush.blend : null;
    const peak = Math.max(0.001, this.dabPeak / 1);
    for (let py = y0; py < y1; py++) {
      const rowO = (py - y0) * bw - x0;
      const trow = (py >> 6) * tilesX;
      const yo = (py & 63) << 6;
      for (let px = x0; px < x1; px++) {
        const a = ab[rowO + px];
        if (a < 0.0004) continue;
        const idx = py * w + px;
        const c0 = cv[idx] / 65535;
        let c: number;
        if (mode.uniform) c = a > c0 ? (a > 1 ? 1 : a) : c0;
        else { const aa = a * mode.k; c = c0 + (1 - c0) * (aa > 1 ? 1 : aa); }
        if (this.capNow > 0 && this.tooth) { const cap = 1 - this.capNow * (1 - this.tooth[((py & 255) << 8) | (px & 255)]); if (c > cap) c = cap > c0 ? cap : c0; }
        cv[idx] = (c * 65535 + 0.5) | 0;
        const ci = idx * 3;
        // the stroke colour buffer is 8.8 fixed point (16 bit): a faint glaze step smaller than one level
        // used to round away and the colour stalled in bands
        if (c0 <= 0.0004) { col[ci] = cr * 256 + 0.5; col[ci + 1] = cg * 256 + 0.5; col[ci + 2] = cb * 256 + 0.5; }
        else {
          const wt = a > 1 ? 1 : a;
          let tr = cr, tg = cg, tb = cb;
          if (mode.heavy) {
            const k = c0 * 0.6;
            tr += (cr * col[ci] / 65280 - cr) * k; tg += (cg * col[ci + 1] / 65280 - cg) * k; tb += (cb * col[ci + 2] / 65280 - cb) * k;
          }
          col[ci] = col[ci] + (tr * 256 - col[ci]) * wt + 0.5;
          col[ci + 1] = col[ci + 1] + (tg * 256 - col[ci + 1]) * wt + 0.5;
          col[ci + 2] = col[ci + 2] + (tb * 256 - col[ci + 2]) * wt + 0.5;
        }
        let cc = c;
        if (we > 0) { const c2 = c * c; cc = c * (1 - we * 0.5 * c2 * c2 * c2); }
        let f = cc * opacity;
        if (sel) f *= sel[idx] / 255;
        let pr = col[ci] / 256, pg = col[ci + 1] / 256, pb = col[ci + 2] / 256;
        if (tooth) {
          const d = (tooth[((py & 255) << 8) | (px & 255)] - 0.5) * bump;
          pr += d; pg += d; pb += d;
        }
        const t = snap[trow + (px >> 6)]!;
        const o = (yo | (px & 63)) << 2;
        const ao = t[o + 3] / 255;
        const di = idx << 2;
        if (burnt > 0) {
          const edge = Math.max(1 - (a > peak ? 1 : a / peak), 1 - c);
          if (burntMode) {
            // the edge colour (the stroke's own, darkened) laid over it by the brush's Burnt Edges mode, as much as the edge asks for
            const e = burnt * 0.85 * Math.pow(edge, 0.6), dk = 0.35;
            pr += (blendChannel(burntMode, pr, pr * dk) - pr) * e; pg += (blendChannel(burntMode, pg, pg * dk) - pg) * e; pb += (blendChannel(burntMode, pb, pb * dk) - pb) * e;
          } else {
            const kb = 1 - burnt * 0.85 * Math.pow(edge, 0.6);
            pr *= kb; pg *= kb; pb *= kb;
          }
        }
        if (ao > 0 && (bmode || lumB > 0)) {
          if (bmode) {
            pr += (blendChannel(bmode, t[o], pr) - pr) * ao;
            pg += (blendChannel(bmode, t[o + 1], pg) - pg) * ao;
            pb += (blendChannel(bmode, t[o + 2], pb) - pb) * ao;
          }
          if (lumB > 0) {
            const kk = lumB * ((0.3 * pr + 0.59 * pg + 0.11 * pb) / 255) * ao;
            pr += (blendChannel('screen', t[o], pr) - pr) * kk;
            pg += (blendChannel('screen', t[o + 1], pg) - pg) * kk;
            pb += (blendChannel('screen', t[o + 2], pb) - pb) * kk;
          }
        }
        if (lock) {
          if (ao === 0) continue;
          data[di] = t[o] + (pr - t[o]) * f;
          data[di + 1] = t[o + 1] + (pg - t[o + 1]) * f;
          data[di + 2] = t[o + 2] + (pb - t[o + 2]) * f;
        } else {
          const oa = ao * (1 - f);
          const outA = f + oa;
          if (outA <= 0) continue;
          const k = 1 / outA;
          data[di] = (pr * f + t[o] * oa) * k;
          data[di + 1] = (pg * f + t[o + 1] * oa) * k;
          data[di + 2] = (pb * f + t[o + 2] * oa) * k;
          data[di + 3] = outA * 255;
        }
      }
    }
  }

  private applyErase(x0: number, y0: number, x1: number, y1: number, ab: Float32Array, bw: number, opacity: number): void {
    const { w, data, cov, sel, tilesX, snap } = this;
    const cv = cov!;
    for (let py = y0; py < y1; py++) {
      const rowO = (py - y0) * bw - x0;
      const trow = (py >> 6) * tilesX;
      const yo = (py & 63) << 6;
      for (let px = x0; px < x1; px++) {
        const a = ab[rowO + px];
        if (a < 0.0004) continue;
        const idx = py * w + px;
        const cq = cv[idx];
        if (cq >= 65500) continue;
        const c0 = cq / 65535;
        const c = c0 + (1 - c0) * a;
        cv[idx] = (c * 65535 + 0.5) | 0;
        let f = c * opacity;
        if (sel) f *= sel[idx] / 255;
        const t = snap[trow + (px >> 6)]!;
        data[(idx << 2) + 3] = t[(((yo | (px & 63)) << 2)) + 3] * (1 - f);
      }
    }
  }

  private applySmudge(x0: number, y0: number, x1: number, y1: number, ab: Float32Array, bw: number, opacity: number, cx: number, cy: number, span: number): void {
    const { w, h, data, sel } = this;
    // Pickup is per diameter travelled, so it is scaled by spacing: the carry fades over
    // about 0.45 / pickup diameters whatever the dab spacing.
    const pickup = Math.min(1, this.s.brush.pickup * Math.min(1, this.s.brush.spacing * 2.2));
    const G = Math.max(4, Math.min(CARRY_MAX, Math.ceil(span)));
    const need = G * G * 4;
    if (!this.carryScratch || this.carryScratch.length < need) this.carryScratch = new Float32Array(need);
    const sm = this.carryScratch;
    // Sample the layer under the dab before changing it.
    for (let j = 0; j < G; j++) {
      const sy = Math.min(h - 1, Math.max(0, Math.floor(cy + ((j + 0.5) / G - 0.5) * span)));
      for (let i = 0; i < G; i++) {
        const sx = Math.min(w - 1, Math.max(0, Math.floor(cx + ((i + 0.5) / G - 0.5) * span)));
        const di = (sy * w + sx) << 2;
        const al = data[di + 3] / 255;
        const o = (j * G + i) << 2;
        sm[o] = data[di] * al;
        sm[o + 1] = data[di + 1] * al;
        sm[o + 2] = data[di + 2] * al;
        sm[o + 3] = al;
      }
    }
    const old = this.carry;
    const Gp = this.carryG;
    if (!old) {
      this.carry = sm.slice(0, need);
      this.carryG = G;
      return;
    }
    // Drag the carried paint onto the layer, colour and alpha together in premultiplied space, so paint
    // smears out past its edge and dragging from empty canvas thins it. Alpha lock keeps each alpha.
    const lock = this.s.alphaLock;
    const inSpan = 1 / span;
    for (let py = y0; py < y1; py++) {
      const rowO = (py - y0) * bw - x0;
      const cj = Math.min(Gp - 1, Math.max(0, Math.floor(((py + 0.5 - cy) * inSpan + 0.5) * Gp)));
      for (let px = x0; px < x1; px++) {
        const a = ab[rowO + px];
        if (a < 0.0004) continue;
        const idx = py * w + px;
        const di = idx << 2;
        const ci = Math.min(Gp - 1, Math.max(0, Math.floor(((px + 0.5 - cx) * inSpan + 0.5) * Gp)));
        const co = (cj * Gp + ci) << 2;
        const ca = old[co + 3];
        let c = a * opacity;
        if (sel) c *= sel[idx] / 255;
        const pa = data[di + 3] / 255;
        if (lock) {
          if (pa === 0 || ca <= 0.001) continue;
          const wgt = c * ca, inv = 1 / ca;
          data[di] += (old[co] * inv - data[di]) * wgt;
          data[di + 1] += (old[co + 1] * inv - data[di + 1]) * wgt;
          data[di + 2] += (old[co + 2] * inv - data[di + 2]) * wgt;
          continue;
        }
        const na = pa + (ca - pa) * c;
        if (na <= 0.0005) { data[di + 3] = 0; continue; }
        const r = data[di] * pa + (old[co] - data[di] * pa) * c;
        const g = data[di + 1] * pa + (old[co + 1] - data[di + 1] * pa) * c;
        const b = data[di + 2] * pa + (old[co + 2] - data[di + 2] * pa) * c;
        data[di] = r / na; data[di + 1] = g / na; data[di + 2] = b / na; data[di + 3] = na * 255;
      }
    }
    // Reload the carry: keep (1 - pickup) of what is carried, take pickup of what was under the dab.
    const next = new Float32Array(need);
    for (let j = 0; j < G; j++) {
      const oj = Math.min(Gp - 1, Math.floor(((j + 0.5) / G) * Gp));
      for (let i = 0; i < G; i++) {
        const oi = Math.min(Gp - 1, Math.floor(((i + 0.5) / G) * Gp));
        const o = (j * G + i) << 2, q = (oj * Gp + oi) << 2;
        for (let k = 0; k < 4; k++) next[o + k] = old[q + k] * (1 - pickup) + sm[o + k] * pickup;
      }
    }
    this.carry = next;
    this.carryG = G;
  }

  // ---- bookkeeping ---------------------------------------------------------

  private touch(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.hasDirty) { this.dx0 = x0; this.dy0 = y0; this.dx1 = x1; this.dy1 = y1; this.hasDirty = true; }
    else {
      if (x0 < this.dx0) this.dx0 = x0;
      if (y0 < this.dy0) this.dy0 = y0;
      if (x1 > this.dx1) this.dx1 = x1;
      if (y1 > this.dy1) this.dy1 = y1;
    }
    if (!this.callDirty) { this.cx0 = x0; this.cy0 = y0; this.cx1 = x1; this.cy1 = y1; this.callDirty = true; }
    else {
      if (x0 < this.cx0) this.cx0 = x0;
      if (y0 < this.cy0) this.cy0 = y0;
      if (x1 > this.cx1) this.cx1 = x1;
      if (y1 > this.cy1) this.cy1 = y1;
    }
    const cols = this.cols;
    if (cols) for (let tx = x0 >> 6; tx <= (x1 - 1) >> 6; tx++) { if (y0 < cols.top[tx]) cols.top[tx] = y0; if (y1 > cols.bot[tx]) cols.bot[tx] = y1; }
    const w = this.w, h = this.h;
    for (let ty = y0 >> 6; ty <= (y1 - 1) >> 6; ty++) {
      for (let tx = x0 >> 6; tx <= (x1 - 1) >> 6; tx++) {
        const ti = ty * this.tilesX + tx;
        if (this.snap[ti]) continue;
        const t = new Uint8ClampedArray(TILE_BYTES);
        const sx = tx * TILE, sy = ty * TILE;
        const rw = Math.min(TILE, w - sx), rh = Math.min(TILE, h - sy);
        for (let row = 0; row < rh; row++) {
          const src = ((sy + row) * w + sx) * 4;
          t.set(this.data.subarray(src, src + rw * 4), row * TILE * 4);
        }
        this.snap[ti] = t;
      }
    }
  }

  /** The rectangle the latest add() or finish() changed (the paint Worker sends just that back). */
  lastCallRect(): Rect | null { return this.callRect(); }

  private callRect(): Rect | null {
    if (!this.callDirty) return null;
    return { x: this.cx0, y: this.cy0, w: this.cx1 - this.cx0, h: this.cy1 - this.cy0 };
  }

  /** Bytes of `rect`, current (before = false) or as they were before the stroke (before = true). */
  private copyRect(rect: Rect, before: boolean): Uint8ClampedArray {
    const { w } = this;
    const out = new Uint8ClampedArray(rect.w * rect.h * 4);
    for (let row = 0; row < rect.h; row++) {
      const y = rect.y + row;
      const src = (y * w + rect.x) * 4;
      out.set(this.data.subarray(src, src + rect.w * 4), row * rect.w * 4);
      if (!before) continue;
      const trow = (y >> 6) * this.tilesX;
      for (let tx = rect.x >> 6; tx <= (rect.x + rect.w - 1) >> 6; tx++) {
        const t = this.snap[trow + tx];
        if (!t) continue;
        const xa = Math.max(rect.x, tx * TILE), xb = Math.min(rect.x + rect.w, tx * TILE + TILE);
        const so = ((y & 63) * TILE + (xa - tx * TILE)) * 4;
        out.set(t.subarray(so, so + (xb - xa) * 4), (row * rect.w + (xa - rect.x)) * 4);
      }
    }
    return out;
  }

  private release(): void {
    const cv = this.cov;
    if (cv && this.hasDirty) {
      for (let y = this.dy0; y < this.dy1; y++) cv.fill(0, y * this.w + this.dx0, y * this.w + this.dx1);
    }
    if (this.edge && this.hasDirty) {
      for (let y = this.dy0; y < this.dy1; y++) this.edge.fill(0, y * this.w + this.dx0, y * this.w + this.dx1);
    }
    if (this.edgePooled) { poolEdgeBusy = false; this.edgePooled = false; }
    this.edge = null;
    if (cv && this.covPooled) poolBusy = false;
    if (this.colPooled) { poolColBusy = false; this.colPooled = false; }
    this.colBuf = null;
    this.cov = null;
    this.carry = null;
    this.carryScratch = null;
    this.abuf = new Float32Array(0);
    for (let i = 0; i < this.snap.length; i++) this.snap[i] = undefined;
  }
}

function mid(a: P, b: P): P {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2, tx: (a.tx + b.tx) / 2, ty: (a.ty + b.ty) / 2 };
}

/** Write a patch's before or after bytes back into a raster; returns the rect changed. */
export function applyPatch(r: Raster, p: PixelPatch, dir: 'undo' | 'redo'): Rect {
  const src = dir === 'undo' ? p.before : p.after;
  const rc = p.rect;
  const x0 = Math.max(0, rc.x), y0 = Math.max(0, rc.y);
  const x1 = Math.min(r.width, rc.x + rc.w), y1 = Math.min(r.height, rc.y + rc.h);
  if (x1 <= x0 || y1 <= y0) return { x: x0, y: y0, w: 0, h: 0 };
  const rowBytes = (x1 - x0) * 4;
  for (let y = y0; y < y1; y++) {
    const so = ((y - rc.y) * rc.w + (x0 - rc.x)) * 4;
    r.data.set(src.subarray(so, so + rowBytes), (y * r.width + x0) * 4);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
