// Loudness in LUFS (ITU-R BS.1770 / EBU R128): K-weighting, gated integrated loudness, short-term (3 s) loudness and
// the gain that brings a sound to a target. Plain typed arrays and maths, so it runs on the main thread or in a worker.

export const LUFS_PRESETS = [-14, -16, -23] as const;

interface Bq { b0: number; b1: number; b2: number; a1: number; a2: number }

/** The two K-weighting stages for a sample rate: a high shelf near 1.7 kHz and a high pass near 38 Hz. */
function stages(fs: number): Bq[] {
  const f1 = 1681.974450955533, g = 3.999843853973347, q1 = 0.7071752369554196;
  let k = Math.tan((Math.PI * f1) / fs);
  const vh = Math.pow(10, g / 20), vb = Math.pow(vh, 0.4996667741545416);
  let a0 = 1 + k / q1 + k * k;
  const shelf: Bq = {
    b0: (vh + (vb * k) / q1 + k * k) / a0, b1: (2 * (k * k - vh)) / a0, b2: (vh - (vb * k) / q1 + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q1 + k * k) / a0,
  };
  const f2 = 38.13547087602444, q2 = 0.5003270373238773;
  k = Math.tan((Math.PI * f2) / fs);
  a0 = 1 + k / q2 + k * k;
  const high: Bq = { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q2 + k * k) / a0 };
  return [shelf, high];
}

/** K-weighted copy of one channel. */
export function kWeigh(x: Float32Array, fs: number): Float32Array {
  const out = new Float32Array(x.length);
  out.set(x);
  for (const s of stages(fs)) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      const y = s.b0 * v + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      out[i] = y;
    }
  }
  return out;
}

const lu = (energy: number): number => (energy > 0 ? -0.691 + 10 * Math.log10(energy) : -Infinity);

/** Energy of each 400 ms block, hopping 100 ms, summed over channels. */
function blocks(chs: Float32Array[], fs: number): number[] {
  const win = Math.round(fs * 0.4), hop = Math.round(fs * 0.1);
  const n = chs[0]?.length ?? 0;
  const out: number[] = [];
  if (n < win) return out;
  const pre = chs.map((c) => {
    const w = kWeigh(c, fs), p = new Float64Array(w.length + 1);
    for (let i = 0; i < w.length; i++) p[i + 1] = p[i] + w[i] * w[i];
    return p;
  });
  for (let at = 0; at + win <= n; at += hop) {
    let e = 0;
    for (const p of pre) e += (p[at + win] - p[at]) / win;
    out.push(e);
  }
  return out;
}

/** Gated integrated loudness (absolute gate -70 LUFS, relative gate -10 LU); -Infinity for silence. */
export function gatedLufs(energies: number[]): number {
  const loud = energies.filter((e) => lu(e) > -70);
  if (!loud.length) return -Infinity;
  const rel = lu(loud.reduce((a, b) => a + b, 0) / loud.length) - 10;
  const kept = loud.filter((e) => lu(e) > rel);
  return kept.length ? lu(kept.reduce((a, b) => a + b, 0) / kept.length) : -Infinity;
}

export function integratedLufs(chs: Float32Array[], fs: number): number {
  return gatedLufs(blocks(chs, fs));
}

/** Loudest 3 s window, the "short-term maximum" of the sound. */
export function shortTermMax(chs: Float32Array[], fs: number): number {
  const e = blocks(chs, fs);
  let best = -Infinity;
  for (let i = 0; i + 30 <= e.length; i += 10) {
    let s = 0;
    for (let k = 0; k < 30; k++) s += e[i + k];
    best = Math.max(best, lu(s / 30));
  }
  return best;
}

export function samplePeak(chs: Float32Array[]): number {
  let p = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) { const v = c[i] < 0 ? -c[i] : c[i]; if (v > p) p = v; }
  return p;
}

/** Linear gain that brings `measured` LUFS to `target`, held back so the peak stays under -1 dBFS; `limited` says it was. */
export function normalizeGain(chs: Float32Array[], fs: number, target: number): { gain: number; limited: boolean; measured: number } {
  const measured = integratedLufs(chs, fs);
  if (!Number.isFinite(measured)) return { gain: 1, limited: false, measured };
  const want = Math.pow(10, (target - measured) / 20);
  const peak = samplePeak(chs);
  const room = peak > 0 ? 0.891 / peak : want;
  return want <= room ? { gain: want, limited: false, measured } : { gain: room, limited: true, measured };
}

/** Scales the channels in place to the target loudness; returns the gain applied, the first measure and whether the peak held it back. */
export function normalizeInPlace(chs: Float32Array[], fs: number, target: number): { gain: number; limited: boolean; measured: number } {
  const r = normalizeGain(chs, fs, target);
  if (r.gain !== 1) for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= r.gain;
  return r;
}

/** Live loudness from the master meter: feed each tick's window, read short-term and integrated. */
export class LiveLoudness {
  private cur = 0;
  private curN = 0;
  private curT = 0;
  private recent: number[] = [];
  private all: number[] = [];

  reset(): void { this.cur = 0; this.curN = 0; this.curT = 0; this.recent = []; this.all = []; }

  /** `chs` is the latest window of each channel, `now` is seconds on any steady clock. */
  push(chs: Float32Array[], fs: number, now: number): void {
    let e = 0;
    for (const c of chs) {
      const w = kWeigh(c, fs);
      let s = 0;
      for (let i = w.length >> 1; i < w.length; i++) s += w[i] * w[i];
      e += s / (w.length - (w.length >> 1));
    }
    if (this.curN === 0) this.curT = now;
    this.cur += e; this.curN++;
    if (now - this.curT >= 0.1) {
      const v = this.cur / this.curN;
      this.recent.push(v); this.all.push(v);
      if (this.recent.length > 30) this.recent.shift();
      this.cur = 0; this.curN = 0;
    }
  }

  shortTerm(): number {
    if (this.recent.length < 4) return -Infinity;
    return lu(this.recent.reduce((a, b) => a + b, 0) / this.recent.length);
  }

  integrated(): number {
    // 400 ms blocks of four 100 ms buckets
    const out: number[] = [];
    for (let i = 0; i + 4 <= this.all.length; i++) out.push((this.all[i] + this.all[i + 1] + this.all[i + 2] + this.all[i + 3]) / 4);
    return gatedLufs(out);
  }
}

export function lufsText(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : '-inf LUFS';
}
