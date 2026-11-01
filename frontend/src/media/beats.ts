// Beat detection: onsets of a sound by spectral flux. The sound is cut into 1024 sample windows every 512 samples,
// each window's energy is taken in three bands (low, mid, high) on a log scale, and the rise of each band from one
// window to the next is summed. A rise that tops the local average by a margin, and is the highest within
// 120 ms, is an onset. Pure maths: no DOM, works on any planar channel data.

export interface OnsetOptions {
  /** Higher: fewer, stronger onsets. About 1.2 to 2.5 (default 1.5). */
  sensitivity?: number;
  /** Onsets closer than this many seconds are merged into the stronger one (default 0.2). */
  minGap?: number;
}

const WIN = 1024;
const HOP = 512;

/** One-pole band split: returns [low, mid, high] energies of the window starting at `at`. */
function bands(x: Float32Array, at: number, fs: number): [number, number, number] {
  const lo = 1 - Math.exp((-2 * Math.PI * 200) / fs), hi = 1 - Math.exp((-2 * Math.PI * 2500) / fs);
  let l = 0, m = 0, e0 = 0, e1 = 0, e2 = 0;
  for (let i = 0; i < WIN; i++) {
    const v = x[at + i] ?? 0;
    l += (v - l) * lo;
    m += (v - m) * hi;
    const low = l, mid = m - l, high = v - m;
    e0 += low * low; e1 += mid * mid; e2 += high * high;
  }
  return [e0, e1, e2];
}

/** Onset times in seconds of channel data `chs` between `from` and `to` seconds (relative to the data's start). */
export function detectOnsets(chs: Float32Array[], fs: number, from: number, to: number, o: OnsetOptions = {}): number[] {
  const sens = o.sensitivity ?? 1.5, gap = o.minGap ?? 0.2;
  const a = Math.max(0, Math.floor(from * fs)), b = Math.min(chs[0]?.length ?? 0, Math.ceil(to * fs));
  if (b - a < WIN * 4) return [];
  // mono mix of the stretch
  const mono = new Float32Array(b - a);
  for (const c of chs) for (let i = 0; i < mono.length; i++) mono[i] += c[a + i] / chs.length;
  const n = Math.floor((mono.length - WIN) / HOP);
  const flux = new Float32Array(n);
  let prev = bands(mono, 0, fs).map((e) => Math.log10(1e-9 + e));
  for (let k = 1; k < n; k++) {
    const cur = bands(mono, k * HOP, fs).map((e) => Math.log10(1e-9 + e));
    let f = 0;
    for (let j = 0; j < 3; j++) f += Math.max(0, cur[j] - prev[j]);
    flux[k] = f;
    prev = cur;
  }
  const span = Math.max(2, Math.round((0.5 * fs) / HOP)), near = Math.max(1, Math.round((0.12 * fs) / HOP));
  const out: number[] = [];
  let lastAt = -Infinity, lastVal = 0;
  for (let k = 1; k < n; k++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, k - span); j <= Math.min(n - 1, k + span); j++) { sum += flux[j]; cnt++; }
    const mean = sum / cnt;
    let top = true;
    for (let j = Math.max(0, k - near); j <= Math.min(n - 1, k + near); j++) if (flux[j] > flux[k]) { top = false; break; }
    if (!top || flux[k] < mean * sens + 0.35) continue;
    const t = from + (k * HOP + WIN / 2) / fs;
    if (t - lastAt < gap) {
      if (flux[k] > lastVal) { out[out.length - 1] = t; lastAt = t; lastVal = flux[k]; }
      continue;
    }
    out.push(t); lastAt = t; lastVal = flux[k];
  }
  return out;
}
