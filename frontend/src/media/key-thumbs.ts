// Filmstrip thumbnails need no exactness, so in a long GOP a tile is taken from the nearest key frame (one packet to
// decode) instead of decoding up to hundreds of frames to reach the exact time. A tile that is close behind a key
// frame keeps its exact time (a few frames of decode), so short-GOP clips look as before.
import type { EncodedPacketSink } from 'mediabunny';

/** Version tag in every cached thumbnail key; entries without it (older, some black for alpha clips) are purged. */
export const THUMB_VERSION = 'k2';
/** A tile this close behind a key frame is decoded at its exact time. */
export const EXACT_NEAR = 0.2;
/** Parallel decoders for one filmstrip pass. */
export const THUMB_LANES = 3;

/** Timestamp to decode for each requested time (same order as `times`). */
export async function planThumbTimes(ps: EncodedPacketSink, times: number[], firstTs: number, last: number): Promise<number[]> {
  const out: number[] = new Array(times.length);
  // the GOP [lo, hi) the previous tile fell in; consecutive tiles in one GOP share the key lookup
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Math.min(Math.max(times[i], firstTs), last);
    out[i] = t;
    try {
      if (!(t >= lo && t < hi)) {
        const kp = await ps.getKeyPacket(t);
        const nx = kp ? await ps.getNextKeyPacket(kp) : await ps.getFirstKeyPacket();
        lo = kp ? kp.timestamp : -Infinity;
        hi = nx ? nx.timestamp : Infinity;
      }
      const d = t - lo;
      if (d <= EXACT_NEAR) continue;
      const toNext = hi - t;
      out[i] = Math.min(Math.max(toNext < d ? hi : lo, firstTs), last);
    } catch { lo = Infinity; hi = -Infinity; }
  }
  return out;
}
