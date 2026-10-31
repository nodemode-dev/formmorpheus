// Audio effects as plain DSP on planar Float32Array channels (no DOM, no Web Audio nodes). Playback and export
// both run these functions on the same buffers, so what you hear is what is rendered, sample for sample.
// Chain: gate, de-esser, EQ, compressor, reverb. Detectors are linked across channels (one gain for all).
import type { AudioFx, Comp, DeEss, Duck, Eq, Gate, Reverb } from '../engine/audio-fx';

const dbToLin = (db: number): number => Math.pow(10, db / 20);
const linToDb = (v: number): number => 20 * Math.log10(v > 1e-9 ? v : 1e-9);
/** One-pole smoothing coefficient for a time constant in ms. */
const coef = (ms: number, sr: number): number => 1 - Math.exp(-1 / Math.max(1, (ms / 1000) * sr));

// ---- biquads (RBJ cookbook) ----

interface Bq { b0: number; b1: number; b2: number; a1: number; a2: number }

function make(type: 'peak' | 'low' | 'high' | 'hp' | 'lp', sr: number, f: number, gainDb: number, q: number): Bq {
  const fc = Math.max(10, Math.min(sr * 0.49, f));
  const w = (2 * Math.PI * fc) / sr, cw = Math.cos(w), sw = Math.sin(w);
  const A = Math.pow(10, gainDb / 40);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (type === 'peak') {
    const al = sw / (2 * q);
    b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
  } else if (type === 'low' || type === 'high') {
    const al = (sw / 2) * Math.SQRT2, t = 2 * Math.sqrt(A) * al;
    if (type === 'low') {
      b0 = A * ((A + 1) - (A - 1) * cw + t); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - t);
      a0 = (A + 1) + (A - 1) * cw + t; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - t;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cw + t); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - t);
      a0 = (A + 1) - (A - 1) * cw + t; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - t;
    }
  } else {
    const al = sw / (2 * q);
    if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; } else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
    a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function runBq(c: Bq, x: Float32Array): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = c.b0 * v + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    x[i] = y;
  }
}

/** Magnitude in dB of the whole EQ at `hz` (for drawing the curve in the card). */
export function eqResponse(eq: Eq, sr: number, hz: number): number {
  let re = 1, im = 0;
  const w = (2 * Math.PI * hz) / sr;
  const mul = (c: Bq): void => {
    const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = c.b0 + c.b1 * cw + c.b2 * c2, ni = -(c.b1 * sw + c.b2 * s2);
    const dr = 1 + c.a1 * cw + c.a2 * c2, di = -(c.a1 * sw + c.a2 * s2);
    const d = dr * dr + di * di || 1e-12;
    const hr = (nr * dr + ni * di) / d, hi = (ni * dr - nr * di) / d;
    const r = re * hr - im * hi; im = re * hi + im * hr; re = r;
  };
  for (const c of eqBands(eq, sr)) mul(c);
  return 10 * Math.log10(re * re + im * im || 1e-12);
}

function eqBands(eq: Eq, sr: number): Bq[] {
  const out: Bq[] = [];
  if (eq.lowCut) out.push(make('hp', sr, eq.lowCut, 0, Math.SQRT1_2));
  if (eq.highCut) out.push(make('lp', sr, eq.highCut, 0, Math.SQRT1_2));
  if (eq.low.gain) out.push(make('low', sr, eq.low.freq, eq.low.gain, 1));
  if (eq.mid.gain) out.push(make('peak', sr, eq.mid.freq, eq.mid.gain, eq.mid.q));
  if (eq.high.gain) out.push(make('high', sr, eq.high.freq, eq.high.gain, 1));
  return out;
}

function linked(chs: Float32Array[], i: number): number {
  let d = 0;
  for (let c = 0; c < chs.length; c++) { const v = chs[c][i]; const a = v < 0 ? -v : v; if (a > d) d = a; }
  return d;
}

// ---- gate ----

function gate(chs: Float32Array[], sr: number, p: Gate): void {
  const n = chs[0].length;
  const thr = dbToLin(p.threshold), close = thr * 0.7, floor = dbToLin(p.range);
  const att = coef(p.attack, sr), rel = coef(p.release, sr);
  const hold = Math.round((p.hold / 1000) * sr);
  const dec = Math.exp(-1 / (0.005 * sr));
  let env = 0, g = floor, held = 0, open = false;
  for (let i = 0; i < n; i++) {
    const d = linked(chs, i);
    env = d > env ? d : env * dec;
    if (env >= thr) { open = true; held = hold; } else if (open && env < close) { if (held > 0) held--; else open = false; }
    const target = open ? 1 : floor;
    g += (target - g) * (target > g ? att : rel);
    for (let c = 0; c < chs.length; c++) chs[c][i] *= g;
  }
}

// ---- compressor ----

function compress(chs: Float32Array[], sr: number, p: Comp): void {
  const n = chs[0].length;
  const att = coef(p.attack, sr), rel = coef(p.release, sr);
  const T = p.threshold, R = Math.max(1, p.ratio), W = p.knee, mk = p.makeup;
  let sm = 0;
  for (let i = 0; i < n; i++) {
    const lvl = linToDb(linked(chs, i));
    const over = lvl - T;
    let gr = 0;
    if (2 * over < -W) gr = 0;
    else if (W > 0 && 2 * Math.abs(over) <= W) gr = (1 / R - 1) * ((over + W / 2) * (over + W / 2)) / (2 * W);
    else gr = over / R - over;
    sm += (gr - sm) * (gr < sm ? att : rel);
    const g = dbToLin(sm + mk);
    for (let c = 0; c < chs.length; c++) chs[c][i] *= g;
  }
}

// ---- de-esser (split band: only the sibilant band is turned down) ----

function deess(chs: Float32Array[], sr: number, p: DeEss): void {
  // forward and backward through the same filter: zero phase, so the band lines up with the original when it is subtracted
  const hp = make('hp', sr, p.freq, 0, Math.SQRT1_2);
  const band = chs.map((c) => { const b = Float32Array.from(c); runBq(hp, b); b.reverse(); runBq(hp, b); b.reverse(); return b; });
  const n = chs[0].length;
  const att = coef(0.5, sr), rel = coef(40, sr), dec = Math.exp(-1 / (0.002 * sr));
  let env = 0, sm = 0;
  for (let i = 0; i < n; i++) {
    const d = linked(band, i);
    env = d > env ? d : env * dec;
    const over = linToDb(env) - p.threshold;
    const gr = over > 0 ? -Math.min(p.amount, over * 0.75) : 0;
    sm += (gr - sm) * (gr < sm ? att : rel);
    const cut = dbToLin(sm) - 1;
    for (let c = 0; c < chs.length; c++) chs[c][i] += band[c][i] * cut;
  }
}

// ---- reverb: eight damped comb filters into four all-passes per side (Schroeder / Moorer layout), own tuning ----

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS = [556, 441, 341, 225];
const SPREAD = 23;

function reverbChannel(input: Float32Array, sr: number, p: Reverb, side: 0 | 1, wet: Float32Array): void {
  const k = sr / 44100, grow = 0.45 + 1.5 * p.size;
  const damp = p.damping * 0.85;
  const lens = COMBS.map((c) => Math.max(8, Math.round((c + side * SPREAD) * k * grow)));
  const fb = lens.map((L) => Math.pow(10, (-3 * (L / sr)) / Math.max(0.05, p.decay)));
  let power = 0;
  for (const g of fb) power += 1 / (1 - g * g);
  const gain = 1 / Math.sqrt(power);
  const bufs = lens.map((L) => new Float32Array(L));
  const idx = new Int32Array(8);
  const store = new Float64Array(8);
  const apLens = ALLPASS.map((a) => Math.max(8, Math.round((a + side * SPREAD) * k * (0.6 + 0.8 * p.size))));
  const apBufs = apLens.map((L) => new Float32Array(L));
  const apIdx = new Int32Array(4);
  const n = input.length;
  const pre = Math.round((p.preDelay / 1000) * sr);
  for (let i = 0; i < n; i++) {
    const x = (i >= pre ? input[i - pre] : 0) * gain;
    let sum = 0;
    for (let c = 0; c < 8; c++) {
      const b = bufs[c], at = idx[c];
      const o = b[at];
      store[c] = o * (1 - damp) + store[c] * damp;
      b[at] = x + store[c] * fb[c];
      idx[c] = at + 1 === b.length ? 0 : at + 1;
      sum += o;
    }
    for (let a = 0; a < 4; a++) {
      const b = apBufs[a], at = apIdx[a];
      const o = b[at];
      const v = sum + o * 0.5;
      b[at] = v;
      sum = o - sum;
      apIdx[a] = at + 1 === b.length ? 0 : at + 1;
    }
    wet[i] = sum;
  }
}

function reverb(chs: Float32Array[], sr: number, p: Reverb): void {
  const n = chs[0].length;
  const mono = new Float32Array(n);
  for (let c = 0; c < chs.length; c++) for (let i = 0; i < n; i++) mono[i] += chs[c][i] / chs.length;
  for (let c = 0; c < chs.length; c++) {
    const wet = new Float32Array(n);
    reverbChannel(mono, sr, p, (c & 1) as 0 | 1, wet);
    const d = chs[c];
    for (let i = 0; i < n; i++) d[i] = d[i] * (1 - p.mix) + wet[i] * p.mix;
  }
}

/** Seconds the chain keeps sounding after its input ends (the reverb's decay, capped); 0 without a reverb. */
export function fxTail(fx: AudioFx): number {
  return fx.reverb && fx.reverb.mix > 0 ? Math.min(6, Math.max(0, fx.reverb.decay) + fx.reverb.preDelay / 1000) : 0;
}

/** The chain applied to copies of `chs`; the inputs stay untouched. `fx` must come from activeFx(). */
export function applyFx(chs: Float32Array[], sr: number, fx: AudioFx): Float32Array[] {
  const out = chs.map((c) => Float32Array.from(c));
  if (!out.length || !out[0].length) return out;
  if (fx.gate) gate(out, sr, fx.gate);
  if (fx.deess) deess(out, sr, fx.deess);
  if (fx.eq) for (const b of eqBands(fx.eq, sr)) for (const c of out) runBq(b, c);
  if (fx.comp) compress(out, sr, fx.comp);
  if (fx.reverb && fx.reverb.mix > 0) reverb(out, sr, fx.reverb);
  return out;
}

/** Linear gain per sample that pulls a track down while the side-chain sound is above the threshold. */
export function duckGain(side: Float32Array[], sr: number, d: Duck): Float32Array {
  const n = side.length ? side[0].length : 0;
  const g = new Float32Array(n);
  const att = coef(d.attack, sr), rel = coef(d.release, sr), dec = Math.exp(-1 / (0.01 * sr));
  let env = 0, sm = 0;
  for (let i = 0; i < n; i++) {
    const v = linked(side, i);
    env = v > env ? v : env * dec;
    const target = linToDb(env) > d.threshold ? -d.amount : 0;
    sm += (target - sm) * (target < sm ? att : rel);
    g[i] = dbToLin(sm);
  }
  return g;
}

export function applyGainCurve(chs: Float32Array[], g: Float32Array): Float32Array[] {
  return chs.map((c) => { const o = new Float32Array(c.length); for (let i = 0; i < o.length; i++) o[i] = c[i] * (i < g.length ? g[i] : 1); return o; });
}
