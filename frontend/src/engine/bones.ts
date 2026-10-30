// Bones: a chain of rest-pose bones on a content, a triangle mesh over its rect skinned to them by distance
// weights, forward kinematics from per-bone rotations, and linear blend skinning to deformed vertices.
// The output triangles use warpQuads's layout (12 numbers each: 3 source corners, 3 destination corners) so
// warp-draw's triangle drawer renders them. Bones run first, then Warp / Distort (render.ts). Pure, no DOM.
import { localToStage, type Rect } from './warp-draw';
import type { Animated } from './keys';
import type { Bone, Content, Rig } from './types';

export const MESH_DEFAULT = 24;
export const MESH_MIN = 8;
export const MESH_MAX = 96;
/** The mesh coarsens itself past this many cells so a 4K picture still draws every frame. */
const MAX_CELLS = 6000;
/** A bone moves vertices within this share of its length, fading out from FADE_FROM of that reach; the joint's bend zone is about this wide. */
const REACH = 0.4;
const FADE_FROM = 0.25;

export function meshSize(rig: Rig): number {
  const n = rig.mesh;
  return n !== undefined && Number.isFinite(n) ? Math.min(MESH_MAX, Math.max(MESH_MIN, n)) : MESH_DEFAULT;
}

export function boneTip(b: Bone): [number, number] {
  const r = (b.angle * Math.PI) / 180;
  return [b.x + Math.cos(r) * b.length, b.y + Math.sin(r) * b.length];
}

/** "Bone 3" for the id "b3". */
export function boneLabel(id: string): string {
  const m = /^b(\d+)$/.exec(id);
  return m ? `Bone ${m[1]}` : id;
}

/** The next free bone id ("b1", "b2", ...). */
export function nextBoneId(rig: Rig | undefined): string {
  let n = 0;
  for (const b of rig?.bones ?? []) {
    const m = /^b(\d+)$/.exec(b.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `b${n + 1}`;
}

// ---- Skin --------------------------------------------------------------------

export interface Skin {
  rect: Rect;
  cols: number;
  rows: number;
  /** Rest position of each vertex, (cols + 1) x (rows + 1), row by row. */
  rx: Float32Array;
  ry: Float32Array;
  /** The two bones that move each vertex (indices into rig.bones) and their weights; weight 0 pads a single bone. */
  bi: Int16Array;
  bw: Float32Array;
}

const skinCache = new WeakMap<Rig, { key: string; skin: Skin }>();

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** The skin mesh over `rect` for this rig (cached per rig object and rect). */
export function skinOf(rig: Rig, rect: Rect): Skin {
  const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
  const have = skinCache.get(rig);
  if (have && have.key === key) return have.skin;
  const skin = buildSkin(rig, rect);
  skinCache.set(rig, { key, skin });
  return skin;
}

export function buildSkin(rig: Rig, rect: Rect): Skin {
  let step = meshSize(rig);
  const cells = Math.ceil(rect.w / step) * Math.ceil(rect.h / step);
  if (cells > MAX_CELLS) step *= Math.sqrt(cells / MAX_CELLS);
  const cols = Math.max(1, Math.ceil(rect.w / step)), rows = Math.max(1, Math.ceil(rect.h / step));
  const nv = (cols + 1) * (rows + 1);
  const rx = new Float32Array(nv), ry = new Float32Array(nv);
  const bi = new Int16Array(nv * 2), bw = new Float32Array(nv * 2);
  const nb = rig.bones.length;
  const ax = new Float64Array(nb), ay = new Float64Array(nb), bx = new Float64Array(nb), by = new Float64Array(nb);
  const reach = new Float64Array(nb);
  let mean = 0;
  for (let i = 0; i < nb; i++) {
    const b = rig.bones[i], t = boneTip(b);
    ax[i] = b.x; ay[i] = b.y; bx[i] = t[0]; by[i] = t[1];
    mean += b.length;
    reach[i] = Math.max(20, b.length * REACH);
  }
  // softening: keeps a vertex on a bone finite and gives joints a short, smooth bend
  const e2 = Math.pow(Math.max(4, 0.06 * (nb ? mean / nb : 0)), 2);
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const v = j * (cols + 1) + i;
      const px = rect.x + (i / cols) * rect.w, py = rect.y + (j / rows) * rect.h;
      rx[v] = px; ry[v] = py;
      let b0 = -1, b1 = -1, w0 = 0, w1 = 0, near = 0, nearD = Infinity;
      for (let k = 0; k < nb; k++) {
        const d = segDist(px, py, ax[k], ay[k], bx[k], by[k]);
        if (d < nearD) { nearD = d; near = k; }
        // inverse square of the distance, faded to nothing at the bone's reach so far parts stay put
        const u = Math.min(1, Math.max(0, (d - reach[k] * FADE_FROM) / (reach[k] * (1 - FADE_FROM))));
        const w = (1 - u * u * (3 - 2 * u)) / (d * d + e2);
        if (w > w0) { b1 = b0; w1 = w0; b0 = k; w0 = w; }
        else if (w > w1) { b1 = k; w1 = w; }
      }
      // beyond every bone's reach the nearest bone alone carries the vertex
      if (b0 < 0 || w0 <= 0) { bi[v * 2] = near; bi[v * 2 + 1] = near; bw[v * 2] = 1; continue; }
      const q = b1 >= 0 && w1 > 0 ? w1 / (w0 + w1) : 0;
      bi[v * 2] = b0;
      bi[v * 2 + 1] = b1 < 0 ? b0 : b1;
      bw[v * 2] = 1 - q;
      bw[v * 2 + 1] = q;
    }
  }
  return { rect, cols, rows, rx, ry, bi, bw };
}

/** Weight of bone index `bone` at vertex `v` (0..1). */
export function weightAt(skin: Skin, bone: number, v: number): number {
  let w = 0;
  if (skin.bi[v * 2] === bone) w += skin.bw[v * 2];
  if (skin.bi[v * 2 + 1] === bone) w += skin.bw[v * 2 + 1];
  return w;
}

// ---- Forward kinematics ---------------------------------------------------------

/** Per bone an affine [a, b, c, d, e, f] (x' = a x + c y + e, y' = b x + d y + f) taking rest space to posed space. */
export function boneMatrices(rig: Rig, rot: Record<string, number> | null): Float64Array {
  const bones = rig.bones, n = bones.length;
  const out = new Float64Array(n * 6);
  const done = new Uint8Array(n);
  const index = new Map<string, number>();
  bones.forEach((b, i) => index.set(b.id, i));
  const visit = (i: number, depth: number): void => {
    if (done[i]) return;
    done[i] = 1;
    const b = bones[i];
    const p = b.parent !== undefined && depth < n ? index.get(b.parent) : undefined;
    if (p !== undefined && p !== i) visit(p, depth + 1);
    const r = ((rot?.[b.id] ?? 0) * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    // rotation about the bone's rest head
    const ra = cs, rb = sn, rc = -sn, rd = cs, re = b.x - cs * b.x + sn * b.y, rf = b.y - sn * b.x - cs * b.y;
    const o = i * 6;
    if (p === undefined || p === i) {
      out[o] = ra; out[o + 1] = rb; out[o + 2] = rc; out[o + 3] = rd; out[o + 4] = re; out[o + 5] = rf;
      return;
    }
    const q = p * 6;
    const ma = out[q], mb = out[q + 1], mc = out[q + 2], md = out[q + 3], me = out[q + 4], mf = out[q + 5];
    out[o] = ma * ra + mc * rb;
    out[o + 1] = mb * ra + md * rb;
    out[o + 2] = ma * rc + mc * rd;
    out[o + 3] = mb * rc + md * rd;
    out[o + 4] = ma * re + mc * rf + me;
    out[o + 5] = mb * re + md * rf + mf;
  };
  for (let i = 0; i < n; i++) visit(i, 0);
  return out;
}

export interface PosedBone { head: [number, number]; tip: [number, number]; angle: number }

/** Where each bone's head and tip sit once posed (content space), and its angle in degrees. */
export function posedBones(rig: Rig, rot: Record<string, number> | null): PosedBone[] {
  const m = boneMatrices(rig, rot);
  const idx = new Map<string, number>();
  rig.bones.forEach((b, i) => idx.set(b.id, i));
  return rig.bones.map((b, i) => {
    const o = i * 6, t = boneTip(b);
    return {
      head: [m[o] * b.x + m[o + 2] * b.y + m[o + 4], m[o + 1] * b.x + m[o + 3] * b.y + m[o + 5]],
      tip: [m[o] * t[0] + m[o + 2] * t[1] + m[o + 4], m[o + 1] * t[0] + m[o + 3] * t[1] + m[o + 5]],
      angle: b.angle + chainRotation(rig, idx, rot, i),
    };
  });
}

/** Sum of the rotations of a bone and its ancestors, degrees. */
function chainRotation(rig: Rig, idx: Map<string, number>, rot: Record<string, number> | null, i: number): number {
  let sum = 0;
  let cur: number | undefined = i;
  for (let guard = 0; cur !== undefined && guard <= rig.bones.length; guard++) {
    const b: Bone = rig.bones[cur];
    sum += rot?.[b.id] ?? 0;
    cur = b.parent !== undefined ? idx.get(b.parent) : undefined;
  }
  return sum;
}

/** The rotation of bone `id` that points it at world angle `target` (degrees), given the others' rotations. */
export function rotationToward(rig: Rig, rot: Record<string, number> | null, id: string, target: number): number {
  const idx = new Map<string, number>();
  rig.bones.forEach((b, i) => idx.set(b.id, i));
  const i = idx.get(id);
  if (i === undefined) return 0;
  const b = rig.bones[i];
  const own = rot?.[id] ?? 0;
  const ancestors = chainRotation(rig, idx, rot, i) - own;
  let r = target - b.angle - ancestors;
  r = ((((r + 180) % 360) + 360) % 360) - 180;
  return r;
}

/** True when the content has a rig and any bone is turned at this moment. */
export function bonesActive(c: Content, a: Animated): boolean {
  return !!c.rig && c.rig.bones.length > 0 && !!a.bones;
}

// ---- Skinning --------------------------------------------------------------------

/** Deformed positions of every skin vertex (x, y pairs, content space). */
export function skinPoints(skin: Skin, mats: Float64Array, out?: Float32Array): Float32Array {
  const nv = skin.rx.length;
  const pts = out && out.length >= nv * 2 ? out : new Float32Array(nv * 2);
  for (let v = 0; v < nv; v++) {
    const x = skin.rx[v], y = skin.ry[v];
    let ox = 0, oy = 0;
    for (let s = 0; s < 2; s++) {
      const w = skin.bw[v * 2 + s];
      if (w === 0) continue;
      const o = skin.bi[v * 2 + s] * 6;
      ox += w * (mats[o] * x + mats[o + 2] * y + mats[o + 4]);
      oy += w * (mats[o + 1] * x + mats[o + 3] * y + mats[o + 5]);
    }
    pts[v * 2] = ox;
    pts[v * 2 + 1] = oy;
  }
  return pts;
}

/**
 * The skinned content as triangles in warpQuads's layout: source corners in content space, destination corners
 * in Stage space (movie pixels, the content's move / scale / rotation applied) when `stage` is given, else in
 * content space (so Warp / Distort can take the result as its picture).
 */
export function boneQuads(rig: Rig, rot: Record<string, number> | null, rect: Rect, w: number, h: number, stage: Animated | null): Float32Array {
  const skin = skinOf(rig, rect);
  const pts = skinPoints(skin, boneMatrices(rig, rot));
  const nv = skin.rx.length;
  if (stage) {
    const s = [0, 0];
    for (let v = 0; v < nv; v++) {
      localToStage(stage, w, h, pts[v * 2], pts[v * 2 + 1], s);
      pts[v * 2] = s[0];
      pts[v * 2 + 1] = s[1];
    }
  }
  const { cols, rows } = skin;
  const out = new Float32Array(cols * rows * 24);
  let p = 0;
  const tri = (a: number, b: number, c: number): void => {
    out[p++] = skin.rx[a]; out[p++] = skin.ry[a];
    out[p++] = skin.rx[b]; out[p++] = skin.ry[b];
    out[p++] = skin.rx[c]; out[p++] = skin.ry[c];
    out[p++] = pts[a * 2]; out[p++] = pts[a * 2 + 1];
    out[p++] = pts[b * 2]; out[p++] = pts[b * 2 + 1];
    out[p++] = pts[c * 2]; out[p++] = pts[c * 2 + 1];
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      tri(a, b, c);
      tri(b, d, c);
    }
  }
  return out;
}

// ---- Rig edits (pure; each returns a new Content) -------------------------------------

export function addBone(c: Content, bone: Bone): Content {
  const rig: Rig = { ...(c.rig ?? { bones: [] }), bones: [...(c.rig?.bones ?? []), bone] };
  return { ...c, rig };
}

/** Remove a bone, its descendants and their keys. */
export function deleteBone(c: Content, id: string): Content {
  const rig = c.rig;
  if (!rig || !rig.bones.some((b) => b.id === id)) return c;
  const gone = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const b of rig.bones) if (b.parent !== undefined && gone.has(b.parent) && !gone.has(b.id)) { gone.add(b.id); grew = true; }
  }
  const bones = rig.bones.filter((b) => !gone.has(b.id));
  const keys = c.keys.flatMap((lane) => {
    if (lane.kind !== 'bones') return [lane];
    const channels: typeof lane.channels = {};
    for (const ch in lane.channels) if (!gone.has(ch) && lane.channels[ch].length) channels[ch] = lane.channels[ch];
    return Object.keys(channels).length ? [{ ...lane, channels }] : [];
  });
  const next: Content = { ...c, keys };
  if (bones.length) next.rig = { ...rig, bones };
  else delete next.rig;
  return next;
}

export function setMesh(c: Content, px: number): Content {
  if (!c.rig) return c;
  const mesh = Math.min(MESH_MAX, Math.max(MESH_MIN, Math.round(px)));
  return c.rig.mesh === mesh ? c : { ...c, rig: { ...c.rig, mesh } };
}
