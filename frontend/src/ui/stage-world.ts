// Stage helpers for parenting and the camera. A content's handles are drawn and dragged in its own local
// space (the space its Move and Scale values live in); the matrix here carries that space to the screen,
// so a drag under a rotated parent still follows the pointer. No DOM.
import { hasWorldFx, invert, mul, parentWorld, type Mat } from '../engine/transform';
import type { Content, Movie } from '../engine/types';

interface ViewLike { scale: number; ox: number; oy: number }

const stripped = new WeakMap<Movie, Movie>();

/** The movie as the Stage draws it: without its camera while Camera mode shows the world from outside. */
export function stageMovie(m: Movie, noCamera: boolean): Movie {
  if (!noCamera || !m.camera) return m;
  let s = stripped.get(m);
  if (!s) {
    const { camera: _camera, ...rest } = m;
    s = rest as Movie;
    stripped.set(m, s);
  }
  return s;
}

/** Screen pixels as the content's parent space shows them, to real screen pixels; null when nothing is above the content. */
export function screenMat(m: Movie, c: Content, frame: number, v: ViewLike): Mat | null {
  if (!hasWorldFx(m)) return null;
  const pw = parentWorld(m, c, frame);
  const vm: Mat = [v.scale, 0, 0, v.scale, v.ox, v.oy];
  const vi = invert(vm);
  return vi ? mul(vm, mul(pw, vi)) : null;
}

export function mapPt(s: Mat | null, x: number, y: number): [number, number] {
  return s ? [s[0] * x + s[2] * y + s[4], s[1] * x + s[3] * y + s[5]] : [x, y];
}

/** Real screen pixels back into the content's parent space (screen scale). */
export function unmapPt(s: Mat | null, x: number, y: number): [number, number] {
  if (!s) return [x, y];
  const i = invert(s);
  return i ? [i[0] * x + i[2] * y + i[4], i[1] * x + i[3] * y + i[5]] : [x, y];
}
