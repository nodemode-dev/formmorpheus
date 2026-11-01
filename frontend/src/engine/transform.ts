// Transform maths shared by the CPU renderer, the GPU compositor, the Stage and export: a content's own
// move / scale / rotation / flip around its pivot, the parent chain (Content.parent), the group a member
// sits in, and the movie camera (Movie.camera). Matrices are [a, b, c, d, e, f] like a canvas transform:
// x' = a x + c y + e, y' = b x + d y + f. Stage space is movie pixels. Pure, no DOM.
import { animate, evalChannel, type Animated } from './keys';
import { srcFrame } from './retime';
import { shakeAt } from './camera-shake';
import type { Content, KeyLane, Movie, Track } from './types';

export type Mat = [number, number, number, number, number, number];

export const IDENT: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function isIdentity(m: Mat): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** Stage space (movie pixels) to target pixels. */
export function viewMat(view: { scale: number; ox: number; oy: number }): Mat {
  return [view.scale, 0, 0, view.scale, view.ox, view.oy];
}

/** A content's own matrix: its coordinates (the picture's pixels) to its parent's space, turning around the pivot. */
export function ownMatrix(a: Animated, movie: Movie): Mat {
  const cx = movie.width / 2 + (a.px ?? 0), cy = movie.height / 2 + (a.py ?? 0);
  const r = (a.rotation * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  const sx = a.scaleX * (a.flipH ? -1 : 1), sy = a.scaleY * (a.flipV ? -1 : 1);
  // T(pivot + move) R S T(-pivot), multiplied out
  const m0 = cs * sx, m1 = sn * sx, m2 = -sn * sy, m3 = cs * sy;
  return [m0, m1, m2, m3, cx + a.x - (m0 * cx + m2 * cy), cy + a.y - (m1 * cx + m3 * cy)];
}

/** The pivot's place in the parent's space, where a content's handles centre: pivot plus move. */
export function anchorOf(a: Animated, movie: Movie): [number, number] {
  return [movie.width / 2 + (a.px ?? 0) + a.x, movie.height / 2 + (a.py ?? 0) + a.y];
}

// ---- Camera ----------------------------------------------------------------------------------------------

export interface CameraPose { panX: number; panY: number; zoom: number; rotation: number }

export const CAMERA_REST: CameraPose = { panX: 0, panY: 0, zoom: 1, rotation: 0 };

export function cameraLane(movie: Movie): KeyLane | null {
  const keys = movie.camera?.keys;
  if (!keys) return null;
  for (let i = 0; i < keys.length; i++) if (keys[i].kind === 'camera') return keys[i];
  return null;
}

/** The camera at a movie frame; null when the movie has no camera keys. */
export function cameraPose(movie: Movie, frame: number, withShake = true): CameraPose | null {
  const lane = cameraLane(movie);
  const shake = withShake ? movie.camera?.shake : undefined;
  // like the shake, the follow is left out when keys are being edited, so it is never baked into them
  const follow = withShake ? followAt(movie, frame) : null;
  if (!lane && !shake && !follow) return null;
  const ch = lane ? lane.channels : {};
  const sh = shake ? shakeAt(shake, frame, movie.fps) : null;
  const v = (id: string, def: number): number => {
    const k = ch[id];
    const r = k && k.length ? evalChannel(k, frame) : null;
    return r === null || !Number.isFinite(r) ? def : r;
  };
  const zoom = v('zoom', 1);
  return { panX: v('panX', 0) + (sh?.dx ?? 0) + (follow?.x ?? 0), panY: v('panY', 0) + (sh?.dy ?? 0) + (follow?.y ?? 0), zoom: zoom > 0.01 ? zoom : 0.01, rotation: v('rotation', 0) + (sh?.rot ?? 0) };
}

/** How far the camera pans to follow its target at a movie frame (movie px), null when it follows nothing usable. */
function followAt(movie: Movie, frame: number): { x: number; y: number } | null {
  const f = movie.camera?.follow;
  if (!f || !(f.amount > 0)) return null;
  const e = indexOf(movie).byId.get(f.id);
  if (!e) return null;
  const a = animate(e.c, Math.max(0, Math.min(e.c.duration - 1, frame - e.c.start)));
  return { x: a.x * f.amount, y: a.y * f.amount };
}

/** The camera a track with parallax depth sees: pan and zoom change by `depth` times as much (rotation stays). */
export function depthPose(p: CameraPose, depth: number): CameraPose {
  return { panX: p.panX * depth, panY: p.panY * depth, zoom: Math.max(0.01, 1 + (p.zoom - 1) * depth), rotation: p.rotation };
}

/** Stage to Stage: what the camera does to the world (pan, zoom and rotate around the frame centre). */
export function cameraMat(movie: Movie, p: CameraPose): Mat {
  const cx = movie.width / 2, cy = movie.height / 2;
  const r = (-p.rotation * Math.PI) / 180, cs = Math.cos(r) * p.zoom, sn = Math.sin(r) * p.zoom;
  const m0 = cs, m1 = sn, m2 = -sn, m3 = cs;
  const ox = cx + p.panX, oy = cy + p.panY;
  return [m0, m1, m2, m3, cx - (m0 * ox + m2 * oy), cy - (m1 * ox + m3 * oy)];
}

export function cameraMatrix(movie: Movie, frame: number): Mat | null {
  const p = cameraPose(movie, frame);
  return p ? cameraMat(movie, p) : null;
}

// ---- Parent chains ---------------------------------------------------------------------------------------

interface Entry { c: Content; container: Entry | null; root: Track }
interface Index { byId: Map<string, Entry>; fx: boolean }

const indexes = new WeakMap<Movie, Index>();

function indexOf(movie: Movie): Index {
  const have = indexes.get(movie);
  if (have) return have;
  const byId = new Map<string, Entry>();
  let fx = !!cameraLane(movie) || !!movie.camera?.shake || !!movie.camera?.follow;
  const walk = (tracks: Track[], container: Entry | null, root: Track | null): void => {
    for (const t of tracks) for (const c of t.content) {
      const e: Entry = { c, container, root: root ?? t };
      byId.set(c.id, e);
      if (c.parent) fx = true;
      if (c.kind === 'group') walk(c.tracks, e, root ?? t);
    }
  };
  walk(movie.tracks, null, null);
  const idx = { byId, fx };
  indexes.set(movie, idx);
  return idx;
}

/** Whether the movie has a camera or any parented content (otherwise every matrix is the content's own). */
export function hasWorldFx(movie: Movie): boolean {
  return indexOf(movie).fx;
}

/** The container-aware parent of an entry: same group for a member; any content outside its own subtree for a top-level one. */
function parentOf(idx: Index, e: Entry): Entry | null {
  const id = e.c.parent;
  if (!id) return null;
  const p = idx.byId.get(id);
  if (!p || p === e) return null;
  if (e.container) return p.container === e.container ? p : null;
  for (let q = p.container; q; q = q.container) if (q === e) return null;
  return p;
}

const MAX_DEPTH = 64;

function levelFrame(e: Entry, frame: number): number {
  return e.container ? srcFrame(e.container.c, levelFrame(e.container, frame) - e.container.c.start) : frame;
}

/** The frame a content's own `start` is counted against: the movie frame for a top-level content, the group-local frame inside groups. */
export function levelFrameOf(movie: Movie, c: Content, frame: number): number {
  const e = indexOf(movie).byId.get(c.id);
  return e ? levelFrame(e, frame) : frame;
}

/** Matrix of an entry from its own picture space to the space of the movie (camera not included). */
function chainTop(movie: Movie, idx: Index, e: Entry, frame: number, a: Animated | undefined, depth: number): Mat {
  const own = ownMatrix(a ?? animate(e.c, levelFrame(e, frame) - e.c.start), movie);
  if (depth > MAX_DEPTH) return own;
  return mul(baseTop(movie, idx, e, frame, depth), own);
}

/** Everything above an entry's own transform: its parent chain, else the group it sits in, else nothing. */
function baseTop(movie: Movie, idx: Index, e: Entry, frame: number, depth: number): Mat {
  const p = parentOf(idx, e);
  if (p) return chainTop(movie, idx, p, frame, undefined, depth + 1);
  if (e.container) return chainTop(movie, idx, e.container, frame, undefined, depth + 1);
  return IDENT;
}

function chainRel(movie: Movie, idx: Index, e: Entry, f: number, a: Animated | undefined, depth: number): Mat {
  const own = ownMatrix(a ?? animate(e.c, f - e.c.start), movie);
  if (depth > MAX_DEPTH) return own;
  const p = parentOf(idx, e);
  return p ? mul(chainRel(movie, idx, p, f, undefined, depth + 1), own) : own;
}

function cameraFor(movie: Movie, e: Entry, frame: number): Mat | null {
  if (e.root.screen) return null;
  const d = e.root.depth;
  if (d === undefined || d === 1) return cameraMatrix(movie, frame);
  const p = cameraPose(movie, frame);
  return p ? cameraMat(movie, depthPose(p, d)) : null;
}

/**
 * Content space (the picture's pixels) to Stage space (movie pixels) for a top-level content or any content
 * of the movie by id: its own transform and pivot, each parent's, the groups it sits in, then the camera
 * unless its track is fixed to the screen. `a` stands in for the content's own animated values.
 */
export function worldMatrix(movie: Movie, c: Content, frame: number, a?: Animated): Mat {
  const idx = indexOf(movie);
  const e = idx.byId.get(c.id);
  if (!e) return ownMatrix(a ?? animate(c, frame - c.start), movie);
  const own = chainTop(movie, idx, e, frame, a, 0);
  const cam = cameraFor(movie, e, frame);
  return cam ? mul(cam, own) : own;
}

/** Stage space of the content's parent: the camera, the parents and the groups, but not the content's own move. */
export function parentWorld(movie: Movie, c: Content, frame: number): Mat {
  const idx = indexOf(movie);
  const e = idx.byId.get(c.id);
  if (!e) return IDENT;
  const base = baseTop(movie, idx, e, frame, 0);
  const cam = cameraFor(movie, e, frame);
  return cam ? mul(cam, base) : base;
}

/** The content a content follows, if the link is usable (found, no cycle). */
export function parentContent(movie: Movie, c: Content): Content | null {
  const idx = indexOf(movie);
  const e = idx.byId.get(c.id);
  const p = e ? parentOf(idx, e) : null;
  return p ? p.c : null;
}

/** Content to target pixels for content drawn at the top of a view: view, camera, parents, own. Plain content skips the lookups. */
export function topMatrix(movie: Movie, c: Content, frame: number, a: Animated, view: { scale: number; ox: number; oy: number }): Mat {
  const v = viewMat(view);
  if (!indexOf(movie).fx) return mul(v, ownMatrix(a, movie));
  return mul(v, worldMatrix(movie, c, frame, a));
}

/** Content to its group's space for a member drawn inside a group at group-local frame `f`: own and same-group parents. */
export function memberMatrix(movie: Movie, c: Content, f: number, a: Animated): Mat {
  const idx = indexOf(movie);
  if (!idx.fx) return ownMatrix(a, movie);
  const e = idx.byId.get(c.id);
  return e ? chainRel(movie, idx, e, f, a, 0) : ownMatrix(a, movie);
}

/** What localToStage applies after a content's own transform when it draws Warp / Distort or bones: the parents and the camera. Null when nothing. */
export function postMatrix(movie: Movie, c: Content, frame: number, nested: boolean, f: number): Mat | null {
  const idx = indexOf(movie);
  if (!idx.fx) return null;
  const e = idx.byId.get(c.id);
  if (!e) return null;
  let m: Mat;
  if (nested) {
    const p = parentOf(idx, e);
    m = p ? chainRel(movie, idx, p, f, undefined, 0) : IDENT;
  } else {
    m = baseTop(movie, idx, e, frame, 0);
    const cam = cameraFor(movie, e, frame);
    if (cam) m = mul(cam, m);
  }
  return isIdentity(m) ? null : m;
}

/** Whether a content's track ignores the camera. */
export function isScreen(movie: Movie, c: Content): boolean {
  return !!indexOf(movie).byId.get(c.id)?.root.screen;
}

/** The content that holds `id` in its subtree, found anywhere in the movie. */
export function findContent(movie: Movie, id: string): Content | null {
  return indexOf(movie).byId.get(id)?.c ?? null;
}

/** Every content of the movie with the groups it sits in (outermost first), for pickers. */
export function allContents(movie: Movie): { c: Content; depth: number }[] {
  const out: { c: Content; depth: number }[] = [];
  const walk = (tracks: Track[], depth: number): void => {
    for (const t of tracks) for (const c of t.content) {
      out.push({ c, depth });
      if (c.kind === 'group') walk(c.tracks, depth + 1);
    }
  };
  walk(movie.tracks, 0);
  return out;
}

/**
 * Why `parentId` cannot become the parent of `childId`, or null when it can: not found, itself, inside the
 * child's own subtree, a loop through the parent chain, or (for a content inside a group) outside that group.
 */
export function parentProblem(movie: Movie, childId: string, parentId: string): string | null {
  const idx = indexOf(movie);
  const child = idx.byId.get(childId);
  const parent = idx.byId.get(parentId);
  if (!child || !parent) return 'That content no longer exists.';
  if (child === parent) return 'A content cannot follow itself.';
  for (let q = parent.container; q; q = q.container) if (q === child) return 'A content cannot follow one inside itself.';
  for (let q: Entry | null = child.container; q; q = q.container) if (q === parent) return 'A content cannot follow the group it sits in.';
  if (child.container && parent.container !== child.container) return 'Content in a group can only follow content in the same group.';
  const seen = new Set<Entry>([child]);
  for (let q: Entry | undefined = parent; q; q = q.c.parent ? idx.byId.get(q.c.parent) : undefined) {
    if (seen.has(q)) return 'That would make a loop: the parent already follows this content.';
    seen.add(q);
  }
  return null;
}

/** Splits a matrix into the Move and Scale values that rebuild it around the pivot (any shear is dropped). */
export function decompose(m: Mat, movie: Movie, px: number, py: number): { x: number; y: number; scaleX: number; scaleY: number; rotation: number; flipH: boolean } {
  const sx = Math.hypot(m[0], m[1]);
  const det = m[0] * m[3] - m[1] * m[2];
  const flip = det < 0;
  const sy = Math.hypot(m[2], m[3]);
  // a mirrored matrix is read as flipH: the second column then still points along the rotated y axis
  const rot = flip ? Math.atan2(-m[2], m[3]) : Math.atan2(m[1], m[0]);
  const cx = movie.width / 2 + px, cy = movie.height / 2 + py;
  const lx = m[0] * cx + m[2] * cy, ly = m[1] * cx + m[3] * cy;
  return { x: m[4] + lx - cx, y: m[5] + ly - cy, scaleX: sx, scaleY: sy, rotation: (rot * 180) / Math.PI, flipH: flip };
}
