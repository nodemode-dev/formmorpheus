// A hand-off between the audio engine and the ducking meter: the engine keeps the gain curve each ducked track was
// rendered with, and anything that draws a meter asks here how far the track is turned down at a moment.
export const duckProbe: { read: ((trackId: string, seconds: number) => number | null) | null } = { read: null };

/** Gain reduction in dB (0 or below) of a gain curve of linear factors at `samples`, or null past the curve. */
export function reductionAt(g: Float32Array, from: number, samples: number): number | null {
  const i = Math.round(samples - from);
  if (i < 0 || i >= g.length) return null;
  const v = g[i];
  return v > 0.00001 ? 20 * Math.log10(Math.min(1, v)) : -60;
}
