// Stage snapping maths (pure). The snap modifier on a desktop is Shift, standing for the second finger held on a
// touch screen: moving snaps a content's edges and centre to the movie's edges, centre and quadrants and to other
// contents' edges and centres; rotating snaps to 15 degree steps in Compose and 30 in Keyframe and Perform.

export interface Box { l: number; t: number; r: number; b: number }

export interface Snap { dx: number; dy: number; gx: number | null; gy: number | null }

function best(points: number[], lines: number[], tol: number): { d: number; line: number } | null {
  let out: { d: number; line: number } | null = null;
  for (const p of points) for (const ln of lines) {
    const d = ln - p;
    if (Math.abs(d) <= tol && (!out || Math.abs(d) < Math.abs(out.d))) out = { d, line: ln };
  }
  return out;
}

/** The shift that lands the box's left, centre or right (top, centre, bottom) on the nearest line; null guides when none is near. */
export function snapBox(box: Box, xs: number[], ys: number[], tol: number): Snap {
  const sx = best([box.l, (box.l + box.r) / 2, box.r], xs, tol);
  const sy = best([box.t, (box.t + box.b) / 2, box.b], ys, tol);
  return { dx: sx?.d ?? 0, dy: sy?.d ?? 0, gx: sx?.line ?? null, gy: sy?.line ?? null };
}

/** Lines of the movie frame: edges, quadrants and centre. */
export function frameLines(w: number, h: number): { xs: number[]; ys: number[] } {
  return { xs: [0, w / 4, w / 2, (3 * w) / 4, w], ys: [0, h / 4, h / 2, (3 * h) / 4, h] };
}

export function boxOf(points: ReadonlyArray<readonly [number, number]>): Box {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const [x, y] of points) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
  return { l, t, r, b };
}

export function snapAngle(deg: number, step: number): number {
  return Math.round(deg / step) * step;
}
