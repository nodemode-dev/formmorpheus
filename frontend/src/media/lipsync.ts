// Lip-sync analysis: from a sound's samples, one mouth shape per movie frame. Pure (no DOM, no Web Audio).
// Per frame: RMS energy, zero-crossing rate and a smoothed power spectrum (radix-2 FFT, Hann windows centred on the
// frame). Energy is judged against the clip's own range; the vowel colour comes from the first two spectral peaks.

export type Viseme = 'rest' | 'MBP' | 'AI' | 'E' | 'O' | 'U' | 'FV' | 'L';

/** The mouth set, in the order a Mouth Chart lists it. */
export const VISEMES: readonly Viseme[] = ['rest', 'MBP', 'AI', 'E', 'O', 'U', 'FV', 'L'];

/** Names written on chart frames; the same text is how a frame is recognised as a shape later. */
export const VISEME_NAMES: Record<Viseme, string> = { rest: 'Rest', MBP: 'MBP', AI: 'AI', E: 'E', O: 'O', U: 'U', FV: 'FV', L: 'L / th' };

export interface LipsyncOptions {
  /** 0 to 1; higher opens the mouth for quieter sound. Default 0.5. */
  sensitivity?: number;
  /** Shortest run of one shape, in frames (at least 1). Default 2. */
  minHold?: number;
}

export interface FrameFeatures {
  /** RMS of the frame, 0..1 of full scale. */
  rms: number;
  /** Zero crossings per second. */
  zcr: number;
  /** Strongest and second spectral peaks, Hz (0 when silent). */
  f1: number;
  f2: number;
  /** Share of the power above 3.5 kHz. */
  high: number;
  /** Energy within the clip's own range, 0 (floor) to 1 (peak). */
  level: number;
}

// ---- FFT ----

const trig = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function plan(n: number): { cos: Float64Array; sin: Float64Array; rev: Uint32Array } {
  let p = trig.get(n);
  if (p) return p;
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), rev = new Uint32Array(n);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  p = { cos, sin, rev };
  trig.set(n, p);
  return p;
}

/** In-place radix-2 FFT of `re` and `im` (length a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length, { cos, sin, rev } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const a = s + k, b = a + half;
        const xr = re[b] * cos[t] - im[b] * sin[t], xi = re[b] * sin[t] + im[b] * cos[t];
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

// ---- features ----

function windowSize(sampleRate: number): number {
  return sampleRate > 24000 ? 1024 : 512;
}

/** Mixes channels to mono. */
export function mono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length;
  return out;
}

interface Scratch { re: Float64Array; im: Float64Array; win: Float64Array; power: Float64Array; smooth: Float64Array }

function scratch(n: number): Scratch {
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return { re: new Float64Array(n), im: new Float64Array(n), win, power: new Float64Array(n / 2), smooth: new Float64Array(n / 2) };
}

/** Adds the Hann-windowed power spectrum of the `n` samples centred on `centre` to `sc.power`. */
function addSpectrum(x: Float32Array, centre: number, sc: Scratch): void {
  const n = sc.re.length, from = Math.round(centre - n / 2);
  for (let i = 0; i < n; i++) { const k = from + i; sc.re[i] = k >= 0 && k < x.length ? x[k] * sc.win[i] : 0; sc.im[i] = 0; }
  fft(sc.re, sc.im);
  for (let b = 0; b < n / 2; b++) sc.power[b] += sc.re[b] * sc.re[b] + sc.im[b] * sc.im[b];
}

/** Two strongest peaks of the smoothed spectrum: F1 in 200 to 1100 Hz, F2 in 700 to 3200 Hz and at least 300 Hz above F1. */
function formants(sc: Scratch, sampleRate: number): { f1: number; f2: number; high: number } {
  const n = sc.re.length, hz = sampleRate / n, nb = n / 2;
  // smooth over about 260 Hz so the harmonics of the voice fuse into the vocal tract's humps
  const w = Math.max(1, Math.round(130 / hz));
  let total = 0, high = 0;
  for (let b = 2; b < nb; b++) { total += sc.power[b]; if (b * hz >= 3500) high += sc.power[b]; }
  for (let b = 0; b < nb; b++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, b - w); k <= Math.min(nb - 1, b + w); k++) { s += sc.power[k]; c++; }
    sc.smooth[b] = s / c;
  }
  // the voice falls about 12 dB per octave, so a weak second hump hides under the first one's skirt: lift the highs,
  // and take a true local maximum (the range's edge only when there is none)
  for (let b = 0; b < nb; b++) sc.smooth[b] *= Math.max(1, (b * hz) / 400);
  const peak = (lo: number, hi: number): number => {
    const a = Math.max(2, Math.floor(lo / hz)), z = Math.min(nb - 2, Math.ceil(hi / hz));
    let best = -1, at = -1, edge = a, edgeBest = -1;
    for (let b = a; b <= z; b++) {
      const v = sc.smooth[b];
      if (v > edgeBest) { edgeBest = v; edge = b; }
      if (v > best && v > sc.smooth[b - 1] && v >= sc.smooth[b + 1]) { best = v; at = b; }
    }
    return (at >= 0 ? at : edge) * hz;
  };
  const f1 = peak(200, 1100);
  const f2 = peak(Math.max(700, f1 + 300), 3200);
  return { f1, f2, high: total > 0 ? high / total : 0 };
}

/** The raw per-frame features of `frames` movie frames starting at `startSec` of `x`. */
export function analyseFrames(x: Float32Array, sampleRate: number, startSec: number, frames: number, fps: number): FrameFeatures[] {
  const n = windowSize(sampleRate), sc = scratch(n), out: FrameFeatures[] = [];
  const frameLen = sampleRate / fps;
  const span = Math.max(frameLen, 0.02 * sampleRate);
  for (let f = 0; f < frames; f++) {
    const centre = (startSec + (f + 0.5) / fps) * sampleRate;
    const a = Math.max(0, Math.round(centre - span / 2)), b = Math.min(x.length, Math.round(centre + span / 2));
    let sum = 0, cross = 0, prev = 0;
    for (let i = a; i < b; i++) {
      const v = x[i];
      sum += v * v;
      if (i > a && (v >= 0) !== (prev >= 0)) cross++;
      prev = v;
    }
    const len = Math.max(1, b - a);
    const rms = Math.sqrt(sum / len);
    let f1 = 0, f2 = 0, high = 0;
    if (rms > 1e-5) {
      sc.power.fill(0);
      for (const d of [-frameLen / 3, 0, frameLen / 3]) addSpectrum(x, centre + d, sc);
      ({ f1, f2, high } = formants(sc, sampleRate));
    }
    out.push({ rms, zcr: (cross * sampleRate) / len, f1, f2, high, level: 0 });
  }
  return out;
}

const db = (v: number): number => 20 * Math.log10(Math.max(v, 1e-7));

/** Fills `level` from the clip's own range of loudness; returns the absolute-silence flag per frame. */
function normalise(feat: FrameFeatures[]): void {
  const dbs = feat.map((f) => db(f.rms)).sort((a, b) => a - b);
  const pick = (p: number): number => dbs[Math.min(dbs.length - 1, Math.max(0, Math.floor(p * (dbs.length - 1))))];
  const peak = pick(0.95);
  let floor = pick(0.05);
  // a clip with no quiet part (steady noise, music) has no floor of its own: give it a 40 dB range
  if (peak - floor < 15) floor = peak - 40;
  for (const f of feat) f.level = Math.min(1, Math.max(0, (db(f.rms) - floor) / Math.max(6, peak - floor)));
}

// ---- classification ----

function vowel(f: FrameFeatures, open: number): Viseme {
  const { f1, f2 } = f;
  if (f.high > 0.45 && f.zcr > 3500) return 'FV';
  if (f1 >= 620 && f2 < 1900) return 'AI';
  if (f2 >= 1900) return f1 >= 560 ? 'AI' : 'E';
  // rounded vowels: a low second peak; U is the tighter, quieter of the two
  if (f2 < 1250 || f1 < 450) return open > 0.62 && f1 >= 420 ? 'O' : f1 < 380 ? 'U' : 'O';
  return f1 >= 520 ? 'AI' : 'E';
}

/** Raw shape per frame before smoothing. */
function classify(feat: FrameFeatures[], sens: number): Viseme[] {
  const sil = 0.3 - 0.22 * sens;
  const quiet = feat.map((f) => f.level < sil || f.rms < 0.0015);
  const shapes: Viseme[] = [];
  for (let i = 0; i < feat.length; i++) {
    const f = feat[i];
    if (quiet[i]) { shapes.push('rest'); continue; }
    const open = Math.min(1, (f.level - sil) / Math.max(0.2, 0.75 - sil));
    // quiet voiced sound, or a weak vowel, keeps the lips nearly neutral
    let s: Viseme = vowel(f, open);
    if (s !== 'FV' && open < 0.3) s = f.high > 0.3 ? 'L' : s === 'AI' ? 'E' : s;
    else if (s === 'AI' && open < 0.45) s = 'E';
    shapes.push(s);
  }
  // closed lips: a gap of one or two frames between sounds is a plosive closure, and a burst after a pause starts closed
  let i = 0;
  while (i < shapes.length) {
    if (shapes[i] !== 'rest') { i++; continue; }
    let j = i;
    while (j < shapes.length && shapes[j] === 'rest') j++;
    const before = i > 0, after = j < shapes.length;
    if (before && after && j - i <= 2) for (let k = i; k < j; k++) shapes[k] = 'MBP';
    else if (after && j - i >= 3) {
      const f = feat[j];
      // the sound arriving out of silence: low crossing rate, no hiss, and a jump in loudness
      if (f.zcr < 2500 && f.high < 0.4 && shapes[j] !== 'FV' && f.level - (feat[j - 1]?.level ?? 0) > 0.25) shapes[j] = 'MBP';
    }
    i = j;
  }
  return shapes;
}

interface Run { shape: Viseme; len: number }

function toRuns(s: Viseme[]): Run[] {
  const out: Run[] = [];
  for (const v of s) { const last = out[out.length - 1]; if (last && last.shape === v) last.len++; else out.push({ shape: v, len: 1 }); }
  return out;
}

/** No run shorter than `min` frames: a short MBP takes frames from the sound after it, other short runs join the longer neighbour. */
function smooth(shapes: Viseme[], min: number): Viseme[] {
  if (min <= 1 || shapes.length < 2) return shapes;
  let runs = toRuns(shapes);
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      if (run.len >= min) continue;
      const prev = runs[r - 1], next = runs[r + 1];
      if (run.shape === 'MBP' && next && next.len - (min - run.len) >= 1) {
        const take = min - run.len;
        run.len += take; next.len -= take;
      } else if (prev && (!next || prev.len >= next.len)) prev.len += run.len, run.len = 0;
      else if (next) next.len += run.len, run.len = 0;
      else continue;
      changed = true;
    }
    runs = runs.filter((x) => x.len > 0);
    // adjacent runs of one shape fuse
    const fused: Run[] = [];
    for (const x of runs) { const l = fused[fused.length - 1]; if (l && l.shape === x.shape) l.len += x.len; else fused.push({ ...x }); }
    runs = fused;
    if (!changed) break;
  }
  const out: Viseme[] = [];
  for (const r of runs) for (let k = 0; k < r.len; k++) out.push(r.shape);
  return out;
}

/** One mouth shape per movie frame for `frames` frames of `x` starting at `startSec` (seconds into the samples). */
export function lipsync(x: Float32Array, sampleRate: number, startSec: number, frames: number, fps: number, opts: LipsyncOptions = {}): Viseme[] {
  if (frames <= 0) return [];
  const sens = Math.min(1, Math.max(0, opts.sensitivity ?? 0.5));
  const feat = analyseFrames(x, sampleRate, startSec, frames, fps);
  normalise(feat);
  return smooth(classify(feat, sens), Math.max(1, Math.round(opts.minHold ?? 2)));
}

/** The same analysis with the features beside the shapes (for checking against the waveform). */
export function lipsyncDetail(x: Float32Array, sampleRate: number, startSec: number, frames: number, fps: number, opts: LipsyncOptions = {}): { shapes: Viseme[]; features: FrameFeatures[] } {
  const sens = Math.min(1, Math.max(0, opts.sensitivity ?? 0.5));
  const features = analyseFrames(x, sampleRate, startSec, frames, fps);
  normalise(features);
  return { shapes: smooth(classify(features, sens), Math.max(1, Math.round(opts.minHold ?? 2))), features };
}

/** Consecutive equal shapes as runs: the holds of a mouth track. */
export function shapeRuns(shapes: Viseme[]): { shape: Viseme; frames: number }[] {
  return toRuns(shapes).map((r) => ({ shape: r.shape, frames: r.len }));
}
