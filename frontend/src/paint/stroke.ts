// CPU stroke engine on a plain Raster (straight RGBA8). Dabs are placed along a
// smoothed path at spacing * diameter. Paint and erase accumulate a per-stroke
// coverage buffer (build-up toward 1), then composite coverage * opacity against
// a snapshot of the untouched pixels, so overlapping dabs never exceed the
// stroke opacity. Smudge works on the live layer and carries picked-up colour.
// Undo bytes are snapshotted lazily per 64 px tile on first touch.

import type { PenSample, PixelPatch, Raster, Rect, StrokeLike, StrokeSettings } from './types';
import { baseAngle, baseDiameter, hsvToRgb, mulberry32, needsColourPath, pressureDiameter, pressureFlow, rgbToHsv, tiltInfo, tiltShape } from './dynamics';
import { getTip, grainTable } from './tips';
import type { RenderMode, WetMix } from './types';

/** Build-up per mode: scale on a dab's alpha, and whether coverage is capped at the strongest dab. */
const MODES: Record<RenderMode, { k: number; uniform: boolean; heavy: boolean; wet?: WetMix }> = {
  'light-glaze': { k: 0.45, uniform: false, heavy: false },
  'uniform-glaze': { k: 1, uniform: true, heavy: false },
  'intense-glaze': { k: 1.8, uniform: false, heavy: false },
  'heavy-glaze': { k: 1.8, uniform: false, heavy: true },
  'uniform-blending': { k: 1, uniform: true, heavy: false, wet: { dilution: 0.1, charge: 0.7, attack: 0.3, pull: 0.45, grade: 0.5 } },
  'intense-blending': { k: 1.8, uniform: false, heavy: false, wet: { dilution: 0.15, charge: 0.55, attack: 0.6, pull: 0.8, grade: 0.4 } },
};
const NORMAL_MODE = { k: 1, uniform: false, heavy: false };

// Per-pixel stroke colour (rgb), reused between strokes; only read where coverage is non-zero.
let poolCol: Uint8Array | null = null;
let poolColBusy = false;

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
  return out;
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
  private readonly taperLen: number;
  private travel = 0;
  private readonly endLen: number;
  private endScale = 1;
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
  private colBuf: Uint8Array | null = null;
  private colPooled = false;
  private readonly mode: { k: number; uniform: boolean; heavy: boolean };
  private readonly wet: WetMix | null;
  private readonly hsv0 = [0, 0, 0];
  private readonly strokeD = [0, 0, 0];
  private readonly tmp = [0, 0, 0];
  private curR = 0; private curG = 0; private curB = 0;
  private wetR = 0; private wetG = 0; private wetB = 0;
  private load = 1;
  private readonly sm = new Float32Array(4);
  private speed = 0;
  private lastT = -1; private lastX = 0; private lastY = 0;
  private readonly wigA: number;
  private readonly wigB: number;

  // smudge carry: premultiplied rgb (0..255) and alpha (0..1), a g x g grid
  private carry: Float32Array | null = null;
  private carryScratch: Float32Array | null = null;
  private carryG = 0;

  constructor(private readonly target: Raster, private readonly layerId: string, private readonly s: StrokeSettings) {
    this.w = target.width;
    this.h = target.height;
    this.data = target.data;
    this.tilesX = Math.ceil(this.w / TILE);
    this.snap = new Array(this.tilesX * Math.ceil(this.h / TILE));
    this.rng = mulberry32(s.seed);
    const zoomK = s.dynamicScaling && s.zoom > 0 ? 1 / s.zoom : 1;
    this.baseDia = baseDiameter(s.brush, s.size) * zoomK;
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
    this.colour = s.tool === 'paint' && needsColourPath(br);
    const md = br.render ? MODES[br.render] : NORMAL_MODE;
    this.mode = md;
    this.wet = s.tool === 'paint' ? (br.wet ?? (br.render ? MODES[br.render].wet ?? null : null)) : null;
    this.wetR = this.colorR; this.wetG = this.colorG; this.wetB = this.colorB;
    this.wigA = (br.wiggle ?? 0) > 0 ? this.rng() * 6.28 : 0;
    this.wigB = (br.wiggle ?? 0) > 0 ? this.rng() * 6.28 : 0;
    if (this.colour) {
      if (!poolColBusy) {
        if (!poolCol || poolCol.length !== this.w * this.h * 3) poolCol = new Uint8Array(this.w * this.h * 3);
        poolColBusy = true;
        this.colBuf = poolCol;
        this.colPooled = true;
      } else this.colBuf = new Uint8Array(this.w * this.h * 3);
      rgbToHsv(this.colorR, this.colorG, this.colorB, this.hsv0);
      const cd = br.colorDyn;
      if (cd) {
        this.strokeD[0] = (this.rng() - 0.5) * (cd.strokeHue ?? 0);
        this.strokeD[1] = (this.rng() - 0.5) * (cd.strokeSat ?? 0);
        this.strokeD[2] = (this.rng() - 0.5) * (cd.strokeBri ?? 0);
      }
    }
    if (s.brush.grain > 0) {
      let g: ArrayLike<number> = grainTable(s.seed);
      const gi = s.brush.grainImage;
      if (gi && gi.length === 65536) g = Float32Array.from(gi, (v) => v / 255);
      const gs = s.brush.grainScale ?? 1;
      if (gs !== 1) g = scaleGrain(g, gs);
      const t = new Float32Array(g.length);
      for (let i = 0; i < g.length; i++) {
        const x = Math.min(1, Math.max(0, (g[i] - 0.3) / 0.4));
        t[i] = x * x * (3 - 2 * x);
      }
      this.tooth = t;
    } else this.tooth = null;
    this.taperLen = (s.brush.taper ?? 0) > 0 ? (s.brush.taper ?? 0) * Math.max(24, this.baseDia * 5) : 0;
    const te = s.brush.taperEnd ?? s.brush.taper ?? 0;
    this.endLen = te > 0 ? te * Math.max(24, this.baseDia * 5) * 0.6 : 0;
  }

  /** The thinning tail past the last point: dabs continue along the last direction, shrinking to a point. */
  private tailOut(): void {
    const a = this.start, b = this.prev;
    if (this.endLen <= 0 || !a || !b || this.travel < 4) return;
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
      this.endScale = Math.max(0.1, k * k * (3 - 2 * k));
      this.dab(b.x + ux * pos, b.y + uy * pos, b.p, b.tx, b.ty, dir);
    }
    this.endScale = 1;
  }

  // ---- StrokeLike ----------------------------------------------------------

  add(sample: PenSample): Rect | null {
    if (this.done || sample.predicted) return null;
    this.twist = sample.twist;
    if (this.lastT >= 0 && sample.time - this.lastT > 0.5) {
      const v = Math.hypot(sample.x - this.lastX, sample.y - this.lastY) / (sample.time - this.lastT);
      this.speed += (Math.min(1, v / 3) - this.speed) * 0.25;
    }
    this.lastT = sample.time; this.lastX = sample.x; this.lastY = sample.y;
    const p: P = { x: sample.x, y: sample.y, p: Math.min(1, Math.max(0, sample.pressure)), tx: sample.tiltX, ty: sample.tiltY };
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
    }
    this.done = true;
    let patch: PixelPatch | null = null;
    if (this.hasDirty) {
      const rect: Rect = { x: this.dx0, y: this.dy0, w: this.dx1 - this.dx0, h: this.dy1 - this.dy0 };
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
    let dia = Math.max(0.6, pressureDiameter(this.baseDia, brush, pressure) * tilt.sizeMul);
    if (brush.speedSize) dia = Math.max(0.6, dia * Math.min(3, Math.max(0.25, 1 + brush.speedSize * (this.speed - 0.3) * 1.6)));
    if (brush.jitterSize) dia = Math.max(0.6, dia * (1 - brush.jitterSize * 0.7 * this.rng()));
    if (brush.fallOff) dia = Math.max(0.6, dia * (1 - brush.fallOff * 0.85 * Math.min(1, this.travel / (200 + 900 * (1 - brush.fallOff)))));
    if (this.taperLen > 0) dia = Math.max(0.6, dia * (0.12 + 0.88 * Math.min(1, this.travel / this.taperLen)));
    if (this.endScale < 1) dia = Math.max(0.6, dia * this.endScale);
    this.lastStep = Math.max(0.5, brush.spacing * dia);
    this.travel += this.lastStep;
    let flow = Math.min(1, Math.max(0, brush.flow * pressureFlow(brush, pressure)));
    if (brush.speedOpacity) flow *= Math.min(1.5, Math.max(0.05, 1 + brush.speedOpacity * (this.speed - 0.3) * 1.6));
    if (brush.jitterOpacity) flow *= 1 - brush.jitterOpacity * this.rng();
    if (brush.burnout) flow *= Math.max(0.03, 1 - brush.burnout * Math.min(1, this.travel / (150 + 1400 * (1 - brush.burnout))));
    if (flow <= 0.0005) return;
    if (brush.wiggle && dir !== null) {
      const amp = brush.wiggle * Math.max(3, dia * 0.7), tr = this.travel;
      const off = (Math.sin(tr * 0.045 + this.wigA) * 0.6 + Math.sin(tr * 0.113 + this.wigB) * 0.4) * amp;
      x += -Math.sin(dir) * off; y += Math.cos(dir) * off;
    }
    if (this.colour) {
      this.dabColour(x, y, dia, pressure, tiltX, tiltY);
      flow *= this.alphaMul;
    }
    const n = Math.max(1, Math.min(16, Math.round(brush.shapeCount ?? 1)));
    if (n === 1) { this.stamp(x, y, dia, flow, dir, tilt.angle, tilt.roundnessMul, tiltX, tiltY, 0); return; }
    const sub = Math.max(0.6, dia * Math.max(0.3, 1 / Math.sqrt(n)));
    for (let k = 0; k < n; k++) {
      const r = dia * 0.5 * Math.sqrt(this.rng()), th = this.rng() * 6.2832;
      this.stamp(x + Math.cos(th) * r, y + Math.sin(th) * r, sub, flow, dir, tilt.angle, tilt.roundnessMul, tiltX, tiltY, k);
    }
  }

  private alphaMul = 1;

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
    }
    let mul = 1;
    const w = this.wet;
    if (w) {
      const sm = this.sm;
      this.sampleCanvas(x, y, dia * 0.35);
      const stepF = Math.min(1, brush.spacing);
      if (sm[3] > 0.03) {
        const k = Math.min(1, w.pull * 0.5 * Math.min(1, stepF * 3) * sm[3]);
        this.wetR += (sm[0] / sm[3] - this.wetR) * k;
        this.wetG += (sm[1] / sm[3] - this.wetG) * k;
        this.wetB += (sm[2] / sm[3] - this.wetB) * k;
      }
      this.load = Math.max(0, this.load - (1 - w.charge) * 0.12 * stepF);
      const atk = w.attack * Math.max(0, 1 - this.travel / (dia * 3)) * 0.8 * sm[3];
      let m = Math.min(1, w.dilution * 0.5 + (1 - this.load) * 0.6 + atk + w.pull * 0.45 * sm[3]);
      m = Math.pow(m, 0.5 + w.grade);
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
    const { brush, tool, opacity } = this.s;
    let cx = x, cy = y;
    if (brush.scatter > 0) {
      cx += (this.rng() - 0.5) * 2 * brush.scatter * dia;
      cy += (this.rng() - 0.5) * 2 * brush.scatter * dia;
    }
    let angle = baseAngle(brush) + (brush.baseRot ?? 0);
    if (brush.followStroke && dir !== null) angle = dir + Math.PI / 2 + (brush.baseRot ?? 0);
    if (brush.azimuth && (tiltX || tiltY)) angle = tiltInfo(tiltX, tiltY).azimuth;
    if (tiltAngle !== null) angle = tiltAngle;
    if (this.s.roll && this.twist) angle = (this.twist * Math.PI) / 180;
    if (brush.rotationJitter > 0) angle += (this.rng() - 0.5) * Math.PI * 2 * brush.rotationJitter;
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
    const tip = getTip(brush.tip, dia, brush.softness, rn, angle, brush.tipImage);
    const scale = dia / tip.diameter;
    const inv = 1 / scale;
    const N = tip.size, td = tip.data;
    const off = N / 2 - 0.5;
    const tooth = this.tooth;
    let gk = brush.grain;
    if (brush.grainJitter) gk = Math.max(0, gk * (1 - brush.grainJitter * this.rng()));
    // Moving grain is anchored to the stamp, texturized grain to the canvas.
    const moving = brush.grainMode === 'moving';
    const gy = moving ? ((this.rng() * 256) | 0) - y0 : 0, gx = moving ? ((this.rng() * 256) | 0) - x0 : 0;
    const f255 = flow / 255;
    for (let py = y0; py < y1; py++) {
      const fy = (py + 0.5 - cy) * inv + off;
      const j0 = Math.floor(fy), wy = fy - j0;
      const rowO = (py - y0) * bw;
      const gRow = ((py + gy) & 255) << 8;
      const fxa = (x0 + 0.5 - cx) * inv + off, fxb = (x1 - 0.5 - cx) * inv + off;
      if (j0 >= 0 && j0 + 1 < N && fxa >= 0 && fxb < N - 1) {
        // Interior row: every tap is inside the map.
        const r0 = j0 * N, r1 = r0 + N;
        for (let px = x0; px < x1; px++) {
          const fx = (px + 0.5 - cx) * inv + off;
          const i0 = fx | 0, wx = fx - i0;
          const top = td[r0 + i0] + (td[r0 + i0 + 1] - td[r0 + i0]) * wx;
          const bot = td[r1 + i0] + (td[r1 + i0 + 1] - td[r1 + i0]) * wx;
          let v = (top + (bot - top) * wy) * f255;
          if (v > 0 && tooth) v *= 1 - gk + gk * tooth[gRow | ((px + gx) & 255)];
          ab[rowO + px - x0] = v;
        }
        continue;
      }
      for (let px = x0; px < x1; px++) {
        const fx = (px + 0.5 - cx) * inv + off;
        const i0 = Math.floor(fx), wx = fx - i0;
        let v = 0;
        if (i0 >= -1 && i0 < N && j0 >= -1 && j0 < N) {
          const ia = i0 >= 0, ib = i0 + 1 < N, ja = j0 >= 0, jb = j0 + 1 < N;
          const v00 = ia && ja ? td[j0 * N + i0] : 0;
          const v10 = ib && ja ? td[j0 * N + i0 + 1] : 0;
          const v01 = ia && jb ? td[(j0 + 1) * N + i0] : 0;
          const v11 = ib && jb ? td[(j0 + 1) * N + i0 + 1] : 0;
          const top = v00 + (v10 - v00) * wx, bot = v01 + (v11 - v01) * wx;
          v = (top + (bot - top) * wy) * f255;
          if (v > 0 && tooth) v *= 1 - gk + gk * tooth[gRow | ((px + gx) & 255)];
        }
        ab[rowO + px - x0] = v;
      }
    }

    if (tool === 'paint') {
      if (this.colour) this.applyPaintDyn(x0, y0, x1, y1, ab, bw, opacity);
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
    for (let py = y0; py < y1; py++) {
      const rowO = (py - y0) * bw - x0;
      const trow = (py >> 6) * tilesX;
      const yo = (py & 63) << 6;
      for (let px = x0; px < x1; px++) {
        const a = ab[rowO + px];
        if (a < 0.0004) continue;
        const idx = py * w + px;
        const cq = cv[idx];
        if (cq >= 65500) continue; // saturated: pixel already holds its final value
        const c0 = cq / 65535;
        const c = c0 + (1 - c0) * a;
        cv[idx] = (c * 65535 + 0.5) | 0;
        let f = c * opacity;
        if (sel) f *= sel[idx] / 255;
        const t = snap[trow + (px >> 6)]!;
        const o = (yo | (px & 63)) << 2;
        const ao = t[o + 3] / 255;
        const di = idx << 2;
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

  /** Paint with a per-pixel stroke colour: colour dynamics, wet mix, build-up modes, pooled edges and relief. */
  private applyPaintDyn(x0: number, y0: number, x1: number, y1: number, ab: Float32Array, bw: number, opacity: number): void {
    const { w, data, cov, sel, tilesX, snap, mode } = this;
    const cv = cov!, col = this.colBuf!;
    const cr = this.curR, cg = this.curG, cb = this.curB;
    const lock = this.s.alphaLock;
    const we = this.s.brush.wetEdges ?? 0;
    const bump = (this.s.brush.bump ?? 0) * 70;
    const tooth = bump > 0 ? this.tooth : null;
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
        cv[idx] = (c * 65535 + 0.5) | 0;
        const ci = idx * 3;
        if (c0 <= 0.0004) { col[ci] = cr; col[ci + 1] = cg; col[ci + 2] = cb; }
        else {
          const wt = a > 1 ? 1 : a;
          let tr = cr, tg = cg, tb = cb;
          if (mode.heavy) {
            const k = c0 * 0.6;
            tr += (cr * col[ci] / 255 - cr) * k; tg += (cg * col[ci + 1] / 255 - cg) * k; tb += (cb * col[ci + 2] / 255 - cb) * k;
          }
          col[ci] = col[ci] + (tr - col[ci]) * wt + 0.5;
          col[ci + 1] = col[ci + 1] + (tg - col[ci + 1]) * wt + 0.5;
          col[ci + 2] = col[ci + 2] + (tb - col[ci + 2]) * wt + 0.5;
        }
        let cc = c;
        if (we > 0) { const c2 = c * c; cc = c * (1 - we * 0.5 * c2 * c2 * c2); }
        let f = cc * opacity;
        if (sel) f *= sel[idx] / 255;
        let pr = col[ci], pg = col[ci + 1], pb = col[ci + 2];
        if (tooth) {
          const d = (tooth[((py & 255) << 8) | (px & 255)] - 0.5) * bump;
          pr += d; pg += d; pb += d;
        }
        const t = snap[trow + (px >> 6)]!;
        const o = (yo | (px & 63)) << 2;
        const ao = t[o + 3] / 255;
        const di = idx << 2;
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
