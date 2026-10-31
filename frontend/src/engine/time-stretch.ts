// Offline time stretch for sound: WSOLA keeps the pitch while the speed changes; plain resampling lets the pitch follow.
// Pure typed-array maths. `rate` is the speed: 2 plays twice as fast (the output is half as long).

/** Reverses a channel into a new array. */
export function reversed(ch: Float32Array): Float32Array {
  const out = new Float32Array(ch.length);
  for (let i = 0, j = ch.length - 1; j >= 0; i++, j--) out[i] = ch[j];
  return out;
}

/** Resamples by `rate` with linear interpolation: faster and higher, or slower and lower. */
export function resample(ch: Float32Array, rate: number): Float32Array {
  const n = Math.max(1, Math.floor(ch.length / rate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * rate, a = Math.floor(p), f = p - a;
    const x0 = ch[a] ?? 0, x1 = ch[a + 1] ?? x0;
    out[i] = x0 + (x1 - x0) * f;
  }
  return out;
}

/** WSOLA: the same pitch at `rate` times the speed. All channels share the cut points found on their mono mix. */
export function stretch(chs: Float32Array[], rate: number, sampleRate: number): Float32Array[] {
  const len = chs[0]?.length ?? 0;
  const outLen = Math.max(1, Math.floor(len / rate));
  const outs = chs.map(() => new Float32Array(outLen + 1));
  if (!len || Math.abs(rate - 1) < 1e-6) return chs.map((c) => c.slice());
  let N = 1 << Math.round(Math.log2(Math.max(256, sampleRate * 0.04)));
  if (N > len) N = Math.max(64, 1 << Math.floor(Math.log2(len)));
  const H = N >> 1;          // synthesis hop
  const D = 4;               // decimation for the search
  const tol = H >> 1;        // search reach in samples
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const mono = new Float32Array(len);
  for (const c of chs) for (let i = 0; i < len; i++) mono[i] += c[i] / chs.length;
  const at = (i: number): number => (i >= 0 && i < len ? mono[i] : 0);
  let prev = 0;               // where the last segment was read from
  for (let k = 0, o = 0; o < outLen; k++, o += H) {
    const target = Math.round(k * H * rate);
    let pos = target;
    if (k > 0) {
      // the continuation of the previous segment is what the next one should line up with
      const ref = prev + H;
      let best = -Infinity;
      for (let d = -tol; d <= tol; d += D) {
        const cand = target + d;
        if (cand < 0 || cand >= len) continue;
        let s = 0;
        for (let i = 0; i < H; i += D) s += at(ref + i) * at(cand + i);
        if (s > best) { best = s; pos = cand; }
      }
    }
    for (let c = 0; c < chs.length; c++) {
      const src = chs[c], dst = outs[c];
      const lim = Math.min(N, outLen + 1 - o);
      for (let i = 0; i < lim; i++) {
        const p = pos + i;
        if (p >= 0 && p < len) dst[o + i] += src[p] * win[i];
      }
    }
    prev = pos;
  }
  return outs.map((c) => c.subarray(0, outLen));
}
