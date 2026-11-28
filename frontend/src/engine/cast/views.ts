import type { CastBone, CastPrim, CastRig, CastSlot, CastSpec, CastView } from './spec';
import { blob, hex2rgb, n, P, rgb2hex, shade, type Pt } from './prims';
import { HAIRS } from './hair';

/** The four ways a built character can face, in the order the controls list them. */
export const VIEWS: readonly CastView[] = ['front', 'three', 'side', 'back'];

export function viewOf(c: Pick<CastSpec, 'view'>): CastView {
  return VIEWS.includes(c.view as CastView) ? (c.view as CastView) : 'front';
}

export const isTurned = (v: CastView): boolean => v === 'three' || v === 'side';

const RAD = Math.PI / 180;
/** How far the body turns (degrees), and how far the face turns round the head for the same view. */
const BODY_TURN: Record<CastView, number> = { front: 0, three: 40, side: 90, back: 0 };
const FACE_TURN: Record<CastView, number> = { front: 0, three: 36, side: 58, back: 0 };
/** The torso's drawn width against the front view's. */
const BODY_WIDTH: Record<CastView, number> = { front: 1, three: .9, side: .62, back: 1 };

/** The sideways spread of limbs at a view: the cosine of the body's turn. */
export const viewSpread = (v: CastView): number => Math.cos(BODY_TURN[v] * RAD);

/** Draw orders by slot name. Turned views are built facing the Stage's right: the L limbs near, the R limbs far. */
const LIMB = (x: 'L' | 'R', legs: boolean): string[] => legs ? [`thigh_${x}`, `shin_${x}`, `foot_${x}`] : [`arm_${x}_upper`, `arm_${x}_fore`, `hand_${x}`];
const HEAD_FRONT = ['headBehind', 'head', 'eyes', 'brows', 'mouth', 'mouthOpen', 'hairFront', 'headAcc'];
const ORDER: Record<'turned' | 'back', string[]> = {
  turned: ['shadow', 'cape', 'tail', 'hairSway', 'hairBack', 'hoodBack', ...LIMB('R', false), ...LIMB('R', true), ...LIMB('L', true), 'pelvis', 'neck', 'torso', 'skirt', ...LIMB('L', false), ...HEAD_FRONT],
  back: ['shadow', ...LIMB('L', true), ...LIMB('R', true), 'pelvis', 'neck', 'torso', 'skirt', ...LIMB('L', false), ...LIMB('R', false), 'tail', 'hoodBack', 'cape',
    'headBehind', 'head', 'eyes', 'brows', 'mouth', 'mouthOpen', 'headAcc', 'hairBack', 'hairSway', 'hairFront'],
};
const FAR = new Set([...LIMB('R', false), ...LIMB('R', true)]);
const FACE = new Set(['eyes', 'brows', 'mouth', 'mouthOpen', 'headAcc']);
const OWN_HAIR = new Set(['fox', 'dino', 'sprout']);

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Every x, y pair of a path's data through `f`; the data is absolute M L C Q Z, so every number pair is a point. */
function mapPath(d: string, f: (x: number, y: number) => [number, number]): string {
  const tk = d.match(/[MLCQZ]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  let out = '', i = 0;
  while (i < tk.length) {
    const s = tk[i];
    if (/^[a-z]$/i.test(s)) { out += s.toUpperCase(); i++; continue; }
    const x = parseFloat(s), y = parseFloat(tk[i + 1] ?? '0');
    const [a, b] = f(x, y);
    out += `${out && !/[A-Z]$/.test(out) ? ' ' : ''}${n(a)} ${n(b)}`;
    i += 2;
  }
  return out;
}

function points(p: CastPrim): Pt[] {
  if (p.t === 'e') {
    const out: Pt[] = [], a = (p.rot ?? 0) * RAD, c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < 24; i++) { const t = (i / 24) * Math.PI * 2, u = Math.cos(t) * p.rx, v = Math.sin(t) * p.ry; out.push([p.cx + u * c - v * s, p.cy + u * s + v * c]); }
    return out;
  }
  if (p.t === 'r') return [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h], [p.x, p.y + p.h / 2], [p.x + p.w, p.y + p.h / 2]];
  const tk = p.d.match(/[MLCQZ]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  const out: Pt[] = [];
  let cmd = '', i = 0, x = 0, y = 0;
  const num = (): number => parseFloat(tk[i++] ?? '0');
  while (i < tk.length) {
    if (/^[a-z]$/i.test(tk[i])) { cmd = tk[i++].toUpperCase(); if (cmd === 'Z') continue; }
    if (cmd === 'M' || cmd === 'L') { const nx = num(), ny = num(); for (let k = 1; k <= 4; k++) out.push([x + (nx - x) * k / 4, y + (ny - y) * k / 4]); x = nx; y = ny; if (cmd === 'M') out.push([x, y]); }
    else if (cmd === 'C' || cmd === 'Q') {
      const q = cmd === 'Q', a = num(), b = num(), c2 = q ? a : num(), d2 = q ? b : num(), ex = num(), ey = num();
      for (let k = 1; k <= 12; k++) {
        const t = k / 12, m = 1 - t;
        out.push(q ? [m * m * x + 2 * m * t * a + t * t * ex, m * m * y + 2 * m * t * b + t * t * ey]
          : [m * m * m * x + 3 * m * m * t * a + 3 * m * t * t * c2 + t * t * t * ex, m * m * m * y + 3 * m * m * t * b + 3 * m * t * t * d2 + t * t * t * ey]);
      }
      x = ex; y = ey;
    } else i++;
  }
  return out;
}

function box(p: CastPrim): [number, number, number, number] {
  const pts = points(p);
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return pts.length ? [a, b, c, d] : [0, 0, 0, 0];
}

/** A prim moved by `dx` and squeezed sideways by `kx` about its centre `cx` (a negative `kx` also mirrors it). */
function shift(p: CastPrim, cx: number, dx: number, kx: number): CastPrim {
  const X = (x: number): number => cx + (x - cx) * kx + dx, k = Math.abs(kx), sg = Math.sign(kx) || 1;
  if (p.t === 'e') return { ...p, cx: n(X(p.cx)), rx: n(p.rx * k), ...(p.rot ? { rot: n(p.rot * sg * (k < 1 ? .5 + k * .5 : 1)) } : {}) };
  if (p.t === 'r') { const w = p.w * k, x = kx < 0 ? X(p.x + p.w) : X(p.x); return { ...p, x: n(x), w: n(w), r: n(Math.min(p.r, w / 2)) }; }
  return { ...p, d: mapPath(p.d, (x, y) => [X(x), y]) };
}

const mirrorPrim = (p: CastPrim): CastPrim => shift(p, 0, 0, -1);

const KAPPA = .5523;

/** An ellipse or a rounded rectangle as path data, so it can be bent point by point. */
function asPath(p: CastPrim): string {
  if (p.t === 'p') return p.d;
  const pts: number[][] = [];
  if (p.t === 'e') {
    const a = (p.rot ?? 0) * RAD, c = Math.cos(a), s = Math.sin(a), at = (u: number, v: number): number[] => [p.cx + u * c - v * s, p.cy + u * s + v * c];
    const q = [[p.rx, 0], [0, p.ry], [-p.rx, 0], [0, -p.ry]];
    let d = `M${at(p.rx, 0).map(n).join(' ')}`;
    for (let i = 0; i < 4; i++) {
      const [ux, uy] = q[i], [vx, vy] = q[(i + 1) % 4];
      d += `C${[...at(ux + vx * KAPPA, uy + vy * KAPPA), ...at(vx + ux * KAPPA, vy + uy * KAPPA), ...at(vx, vy)].map(n).join(' ')}`;
    }
    return d + 'Z';
  }
  const r = Math.max(0, Math.min(p.r, p.w / 2, p.h / 2)), k = r * KAPPA, x = p.x, y = p.y, R = x + p.w, B = y + p.h;
  pts.push([x + r, y], [R - r, y], [R - r + k, y, R, y + r - k, R, y + r], [R, B - r], [R, B - r + k, R - r + k, B, R - r, B], [x + r, B], [x + r - k, B, x, B - r + k, x, B - r], [x, y + r], [x, y + r - k, x + r - k, y, x + r, y]);
  return pts.map((v, i) => (i === 0 ? 'M' : v.length > 2 ? 'C' : 'L') + v.map(n).join(' ')).join('') + 'Z';
}

function asPathPrim(p: CastPrim): Extract<CastPrim, { t: 'p' }> {
  if (p.t === 'p') return p;
  const { t: _t, ...rest } = p as CastPrim & Record<string, unknown>;
  const keep: Record<string, unknown> = {};
  for (const k of ['fill', 'stroke', 'sw', 'op', 'z']) if (rest[k] !== undefined) keep[k] = rest[k];
  return { t: 'p', d: asPath(p), fill: p.fill, ...keep } as Extract<CastPrim, { t: 'p' }>;
}

function mirrorRig(rig: CastRig): CastRig {
  const bones = rig.bones.map((b): CastBone => ({ ...b, x: n(-b.x), rot: -b.rot || 0, tx: n(-b.tx) }));
  const slots = rig.slots.map((s): CastSlot => ({ ...s, ox: -s.ox || 0, prims: s.prims.map(mirrorPrim) }));
  return { ...rig, bones, slots };
}

function opaque(p: CastPrim, under: string): CastPrim {
  if (p.op == null || p.op >= 1 || !p.fill || !p.fill.startsWith('#')) return p;
  const a = hex2rgb(p.fill), b = hex2rgb(under), k = p.op;
  const { op: _op, ...rest } = p;
  return { ...rest, fill: rgb2hex(a[0] * k + b[0] * (1 - k), a[1] * k + b[1] * (1 - k), a[2] * k + b[2] * (1 - k)) } as CastPrim;
}

/** The head's half width at a height, read off its outline prims; used as the radius features turn round. */
function widthOf(outline: CastPrim[], W: number, H: number): (y: number) => number {
  const pts = outline.flatMap(points), band = H * .05, cache = new Map<number, number>();
  return (y0: number) => {
    const y = clamp(y0, -H * .9, -H * .12), key = Math.round(y);
    let r = cache.get(key);
    if (r === undefined) {
      r = 0;
      for (const [px, py] of pts) if (Math.abs(py - y) <= band) r = Math.max(r, Math.abs(px));
      if (r < W * .2) r = W / 2;
      cache.set(key, r);
    }
    return r;
  };
}

interface Turn { x: number; k: number; a: number }

/** A point on a round surface of half width `r` turned by `deg`: where it lands, how much it narrows, and its new angle. */
function turnAt(x: number, r: number, deg: number): Turn {
  const f = Math.asin(clamp(x / r, -1, 1)), a = f + deg * RAD;
  const ac = clamp(a, -Math.PI / 2, Math.PI / 2);
  return { x: r * Math.sin(ac), k: clamp(Math.cos(a) / Math.max(Math.cos(f), .3), .3, 1.15), a: a / RAD };
}

function cover(view: 'three' | 'side' | 'back'): readonly Pt[] {
  if (view === 'back') return [[-1.07, .3], [-1.1, .8], [-.72, 1.08], [0, 1.14], [.72, 1.08], [1.1, .8], [1.07, .3], [.6, .22], [0, .2], [-.6, .22]];
  if (view === 'side') return [[.25, 1.12], [-.45, 1.11], [-.94, .88], [-1.09, .58], [-1.03, .32], [-.86, .25], [-.74, .32], [-.7, .52], [-.5, .66], [-.15, .8], [.12, .94]];
  return [[.15, 1.13], [-.6, 1.09], [-1.04, .84], [-1.1, .55], [-1.05, .36], [-.96, .38], [-.92, .58], [-.74, .8], [-.4, .97], [-.05, 1.05]];
}

/**
 * The front rig redrawn for the recipe's view: the face turned round the head, the hair covering the back of it, the
 * clothes' front details moved round or left off from behind, the far limbs a shade darker, and the whole mirrored for
 * the back (the right arm on the Stage's right) and for a flip. Every slot stays: one the view cannot show is hidden.
 */
export function viewRig(rig: CastRig, c: CastSpec): CastRig {
  const view = viewOf(c);
  let out = rig;
  if (view !== 'front') out = turnRig(rig, c, view);
  if (view === 'back') out = mirrorRig(out);
  if (c.flip === true) out = mirrorRig(out);
  return out;
}

function turnRig(rig: CastRig, c: CastSpec, view: CastView): CastRig {
  const M = rig.M, W = M.headW, H = M.headH, back = view === 'back', face = FACE_TURN[view], body = BODY_TURN[view], K = BODY_WIDTH[view];
  const bones = rig.bones.map((b) => ({ ...b }));
  const bone = (name: string): CastBone | undefined => bones.find((b) => b.name === name);
  const headSlot = rig.slots.find((s) => s.name === 'head');
  const width = widthOf((headSlot?.prims ?? []).filter((p) => p.z === 's'), W, H);
  const offOf = (s: CastSlot): [number, number] => {
    if (s.bone === 'head') return [s.ox, s.oy];
    const b = bones.find((x) => x.name === s.bone);
    return b && b.parent === 'head' ? [b.x + s.ox, b.y + s.oy] : [s.ox, s.oy];
  };
  const own = OWN_HAIR.has(c.species), styled = !own && c.hair.style >= 0 && !!HAIRS[c.hair.style];
  const R0 = W / 2;

  const featureTurn = (p: CastPrim, o: [number, number], drop: number, kMin = .3): CastPrim | null => {
    const b = box(p), cx = (b[0] + b[2]) / 2 + o[0], cy = (b[1] + b[3]) / 2 + o[1];
    const t = turnAt(cx, width(cy), face);
    if (Math.abs(t.a) > drop) return null;
    if (b[2] - b[0] > W * .34 && drop < 900) {
      const q = asPathPrim(p);
      return { ...q, d: mapPath(q.d, (x, y) => [turnAt(x + o[0], width(y + o[1]) * 1.01, face).x - o[0], y]) };
    }
    return shift(p, cx - o[0], t.x - cx, Math.max(kMin, t.k));
  };

  const slots: CastSlot[] = rig.slots.map((s) => {
    const o = offOf(s);
    let prims = s.prims;
    if (s.name === 'head') {
      if (back) prims = prims.filter((p) => p.z === 's' || p.z === 'e');
      else {
        const under: CastPrim[] = [], top: CastPrim[] = [], over: CastPrim[] = [];
        let seen = false;
        for (const p of prims) {
          if (p.z === 's') { seen = true; top.push(p); continue; }
          const q = featureTurn(p, o, p.z === 'e' ? 92 : 80);
          if (!q) continue;
          const b = box(p), at = turnAt((b[0] + b[2]) / 2, width((b[1] + b[3]) / 2), face);
          if (!seen && !(p.z === 'e' && Math.abs(at.a) < 80)) under.push(q); else over.push(q);
        }
        prims = [...under, ...top, ...over];
      }
    } else if (FACE.has(s.name) && s.name !== 'mouth' && s.name !== 'mouthOpen') {
      if (!back) prims = prims.flatMap((p) => featureTurn(p, o, 80) ?? []);
    } else if (s.name === 'headBehind' || (own && (s.name === 'hairFront' || s.name === 'hairBack' || s.name === 'hairSway'))) {
      if (!back) prims = prims.map((p) => featureTurn(p, o, 999, .5) as CastPrim);
    } else if (s.name === 'hairFront' && styled) {
      const col = c.hair.color, cap = prims.map((p) => opaque(p, c.skin));
      const lid = P(blob(cover(back ? 'back' : view as 'three' | 'side').map(([u, v]): Pt => [u * R0, -v * H])), cap.find((p) => p.fill)?.fill ?? col);
      if (back) prims = [lid, ...cap];
      else {
        const half = face * .55;
        prims = [lid, ...cap.map((p) => {
          if (p.t !== 'p') return featureTurn(p, o, 999, .5) as CastPrim;
          return { ...p, d: mapPath(p.d, (x, y) => [turnAt(x, Math.max(width(y), R0 * .9), half).x, y]) };
        })];
      }
    } else if ((s.name === 'hairBack' || s.name === 'hairSway') && styled && !back) {
      const sn = Math.sin(face * RAD);
      prims = prims.map((p) => {
        const b = box(p), cx = (b[0] + b[2]) / 2;
        const q = view === 'side' && cx > R0 * .3 ? mirrorPrim(p) : p, qb = box(q), qc = (qb[0] + qb[2]) / 2;
        return shift(q, qc, -R0 * sn * .32, 1 - sn * .22);
      });
    } else if (s.name === 'torso' || s.name === 'pelvis' || s.name === 'skirt') {
      const ref = s.name === 'torso' ? M.shoulderW : M.hipW, rb = ref / 2;
      prims = prims.flatMap((p) => {
        const b = box(p), wide = b[2] - b[0] >= ref * .62;
        if (wide) return back ? [p] : [shift(p, 0, 0, K)];
        if (back) return [];
        const cx = (b[0] + b[2]) / 2, t = turnAt(cx, rb, Math.min(body, 75));
        if (Math.abs(t.a) > 84) return [];
        return [shift(p, cx, t.x * K - cx, Math.max(.3, t.k))];
      });
    } else if ((s.name === 'cape' || s.name === 'hoodBack') && !back) {
      prims = prims.map((p) => shift(p, 0, -M.shoulderW * .28 * Math.sin(body * RAD), K));
    } else if (s.name === 'tail' && !back) {
      prims = prims.map(mirrorPrim);
    }
    if (!back && FAR.has(s.name)) prims = prims.map((p) => darker(p));
    if (!prims.length && s.prims.length) return { ...s, hide: true };
    return { ...s, prims, ...(back && FACE.has(s.name) ? { hide: true } : {}) };
  });

  if (!back) for (const name of ['mouth', 'mouthO']) {
    const b = bone(name);
    if (!b) continue;
    const t = turnAt(0, width(b.y), face);
    b.x = n(t.x);
    b.sx = n(Math.max(.4, t.k));
  }
  const order = ORDER[back ? 'back' : 'turned'];
  const rank = (s: CastSlot): number => { const i = order.indexOf(s.name); return i < 0 ? order.length : i; };
  slots.sort((a, b) => rank(a) - rank(b));
  return { ...rig, bones, slots };
}

function darker(p: CastPrim): CastPrim {
  const dk = (h: string | null | undefined): string | null | undefined => (h && /^#[0-9a-f]{6}$/i.test(h) ? shade(h, -.12) : h);
  return { ...p, fill: dk(p.fill) ?? null, ...(p.stroke ? { stroke: dk(p.stroke) as string } : {}) } as CastPrim;
}
