// Compose turns and scales a content about its own centre whatever its anchor (pivot) is; the anchor only
// matters in Keyframe and Perform. A picture turns about its pivot P as F(q) = P + t + M (q - P). Seen about the
// centre (pivot 0) the same picture has t0 = t + (I - M) P, so the Stage edits t0 and stores t = t0 - (I - M') P.
// Pure maths, no DOM.

function matrix(rot: number, mx: number, my: number): [number, number, number, number] {
  const a = (rot * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  return [cs * mx, sn * mx, -sn * my, cs * my];
}

/** (I - M) P for a transform turned `rot` degrees and scaled `mx`, `my` (signed totals, flips included) about pivot (px, py). */
function lever(rot: number, mx: number, my: number, px: number, py: number): [number, number] {
  const [m0, m1, m2, m3] = matrix(rot, mx, my);
  return [px - (m0 * px + m2 * py), py - (m1 * px + m3 * py)];
}

/** The move a Compose edit sees: the stored move seen about the content centre. */
export function toCentre(x: number, y: number, rot: number, mx: number, my: number, px: number, py: number): [number, number] {
  if (!px && !py) return [x, y];
  const [lx, ly] = lever(rot, mx, my, px, py);
  return [x + lx, y + ly];
}

/** The stored move for a Compose edit made about the content centre. */
export function fromCentre(x0: number, y0: number, rot: number, mx: number, my: number, px: number, py: number): [number, number] {
  if (!px && !py) return [x0, y0];
  const [lx, ly] = lever(rot, mx, my, px, py);
  return [x0 - lx, y0 - ly];
}
