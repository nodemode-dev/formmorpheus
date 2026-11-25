import { characterInfoOf, characterOf, partContent, updateDeep } from '../character-ops';
import { restingChart } from '../lipsync-ops';
import { content as makeContent, drawingLayer, flipTrack, track as makeTrack, uid } from '../model';
import { setParent } from '../parenting';
import { bounds, outline, shapeBase } from '../shape';
import { paintShape } from '../shape-draw';
import { refitPath } from '../shape-ops';
import type { BezNode, ShapeDef, ShapePaint, ShapeStroke } from '../shape-types';
import { mergeFromSource, type SourceMerge } from '../source-merge';
import { apply, IDENT, mul, type Mat } from '../transform';
import type { Asset, CanvasRect, Content, FlipbookFrame, Movie, Track } from '../types';
import type { ImportResult } from '../../media/import';
import { VISEMES, VISEME_NAMES } from '../../media/lipsync';
import { build } from './build';
import type { CastPrim, CastRig, CastSpec, CastSlot } from './spec';
import { visemes } from './visemes';

/** The 1080 character space of the SVG starters: feet on y 1012, centred on x 540. */
export const CAST_SPACE = 1080;
export const CAST_FLOOR = 1012;
/** Character-space pixels per rig unit: an adult at body h 1 (about 400 rig units) stands about 900 tall. */
export const CAST_UNIT = 2.25;

const PART: Record<string, string> = {
  shadow: 'shadow', pelvis: 'hip', skirt: 'skirt', tail: 'tail',
  thigh_R: 'leg-l', thigh_L: 'leg-r', shin_R: 'shin-l', shin_L: 'shin-r', foot_R: 'foot-l', foot_L: 'foot-r',
  torso: 'body', neck: 'neck', cape: 'cape', hoodBack: 'hood-back',
  arm_R_upper: 'arm-l', arm_L_upper: 'arm-r', arm_R_fore: 'forearm-l', arm_L_fore: 'forearm-r', hand_R: 'hand-l', hand_L: 'hand-r',
  head: 'head', headBehind: 'head-behind', hairBack: 'hair-back', hairFront: 'hair-front', headAcc: 'head-acc',
  hairSway: 'hair-sway', eyes: 'eyes', brows: 'brows', mouth: 'mouth',
};

const FOLLOWS: Record<string, string> = {
  skirt: 'hip', tail: 'hip', 'leg-l': 'hip', 'leg-r': 'hip', 'shin-l': 'leg-l', 'shin-r': 'leg-r', 'foot-l': 'shin-l', 'foot-r': 'shin-r',
  body: 'hip', neck: 'body', cape: 'body', 'hood-back': 'body',
  'arm-l': 'body', 'arm-r': 'body', 'forearm-l': 'arm-l', 'forearm-r': 'arm-r', 'hand-l': 'forearm-l', 'hand-r': 'forearm-r',
  head: 'body', 'head-behind': 'head', 'hair-back': 'head', 'hair-front': 'head', 'head-acc': 'head',
  'hair-sway': 'head', eyes: 'head', brows: 'head', mouth: 'head',
};

const OPEN_SLOT = 'mouthOpen';

/** The part a studio slot becomes; null for one that is not a part of its own. */
export function castPartName(slot: string): string | null {
  return PART[slot] ?? null;
}

interface Fit { m: Mat; k: number; W: number; H: number }

/** Rig units to movie pixels from the movie centre, through the 1080 character space fitted as an SVG import fits it. */
function fitOf(movie: Movie): Fit {
  const W = movie.width, H = movie.height;
  const k = Math.min(1, W / CAST_SPACE, H / CAST_SPACE);
  const ox = Math.round((W - CAST_SPACE * k) / 2), oy = Math.round((H - CAST_SPACE * k) / 2);
  const s = CAST_UNIT * k;
  return { m: [s, 0, 0, s, ox + (CAST_SPACE / 2) * k - W / 2, oy + CAST_FLOOR * k - H / 2], k, W, H };
}

/** World matrix of every bone in rest pose; `open` reads a bone folded to scale 0 (the open mouth) as unfolded. */
function solve(rig: CastRig, root: Mat, open = false): Record<string, Mat> {
  const W: Record<string, Mat> = {};
  for (const b of rig.bones) {
    const a = (b.rot * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
    const sx = open && !b.sx ? 1 : b.sx, sy = open && !b.sy ? 1 : b.sy;
    W[b.name] = mul((b.parent && W[b.parent]) || root, [cs * sx, sn * sx, -sn * sy, cs * sy, b.x, b.y]);
  }
  return W;
}

function slotMatrix(s: CastSlot, W: Record<string, Mat>): Mat {
  const m = W[s.bone] ?? IDENT;
  return s.oy ? mul(m, [1, 0, 0, 1, s.ox, s.oy]) : m;
}

function paint(color: string | null | undefined, alpha: number): ShapePaint | null {
  if (!color || color === 'none') return null;
  const s = color.trim().toLowerCase();
  let hex = '#000000', a = 1;
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) { hex = `#${h.slice(0, 3).split('').map((c) => c + c).join('')}`; if (h.length === 4) a = parseInt(h[3] + h[3], 16) / 255; }
    else { hex = `#${h.slice(0, 6)}`; if (h.length === 8) a = parseInt(h.slice(6), 16) / 255; }
  } else if ((m = /^rgba?\(([^)]*)\)$/.exec(s))) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    hex = `#${[p[0], p[1], p[2]].map((v) => Math.round(Math.min(255, Math.max(0, v || 0))).toString(16).padStart(2, '0')).join('')}`;
    if (p[3] !== undefined && Number.isFinite(p[3])) a = Math.min(1, Math.max(0, p[3]));
  }
  a *= alpha;
  return { kind: 'solid', color: hex, ...(a < 1 ? { alpha: a } : {}) };
}

type Seg = [number, number, number, number, number, number];
interface Run { x0: number; y0: number; segs: Seg[]; closed: boolean }

/** Absolute M L C Q Z path data as cubic runs. */
function runsOf(d: string): Run[] {
  const tk = d.match(/[MLCQZ]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  const runs: Run[] = [];
  let run: Run | null = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0;
  const num = (): number => parseFloat(tk[i++] ?? '0');
  const open = (): Run => { if (!run) { run = { x0: x, y0: y, segs: [], closed: false }; runs.push(run); } return run; };
  while (i < tk.length) {
    if (/^[a-z]$/i.test(tk[i])) cmd = tk[i++].toUpperCase();
    else if (cmd === 'M') cmd = 'L';
    else if (!cmd || cmd === 'Z') { i++; continue; }
    if (cmd === 'M') { x = num(); y = num(); sx = x; sy = y; run = null; open(); }
    else if (cmd === 'L') { const nx = num(), ny = num(); open().segs.push([x, y, nx, ny, nx, ny]); x = nx; y = ny; }
    else if (cmd === 'C') { const s: Seg = [num(), num(), num(), num(), num(), num()]; open().segs.push(s); x = s[4]; y = s[5]; }
    else if (cmd === 'Q') {
      const qx = num(), qy = num(), nx = num(), ny = num();
      open().segs.push([x + ((qx - x) * 2) / 3, y + ((qy - y) * 2) / 3, nx + ((qx - nx) * 2) / 3, ny + ((qy - ny) * 2) / 3, nx, ny]);
      x = nx; y = ny;
    } else if (cmd === 'Z') { if (run) (run as Run).closed = true; x = sx; y = sy; run = null; }
  }
  return runs.filter((r) => r.segs.length > 0);
}

const K = (4 / 3) * (Math.SQRT2 - 1);

function ellipseRun(cx: number, cy: number, rx: number, ry: number, rot: number): Run {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const p = (u: number, v: number): [number, number] => [cx + u * c - v * s, cy + u * s + v * c];
  const q = [[rx, 0], [0, ry], [-rx, 0], [0, -ry]];
  const segs: Seg[] = [];
  for (let i = 0; i < 4; i++) {
    const [ux, uy] = q[i], [vx, vy] = q[(i + 1) % 4];
    const c1 = p(ux + vx * K, uy + vy * K), c2 = p(vx + ux * K, vy + uy * K), e = p(vx, vy);
    segs.push([c1[0], c1[1], c2[0], c2[1], e[0], e[1]]);
  }
  const s0 = p(rx, 0);
  return { x0: s0[0], y0: s0[1], segs, closed: true };
}

function rectRun(x: number, y: number, w: number, h: number, r0: number): Run {
  const r = Math.max(0, Math.min(r0, w / 2, h / 2));
  const L = (ax: number, ay: number, bx: number, by: number): Seg => [ax, ay, bx, by, bx, by];
  if (r <= 0) return { x0: x, y0: y, segs: [L(x, y, x + w, y), L(x + w, y, x + w, y + h), L(x + w, y + h, x, y + h), L(x, y + h, x, y)], closed: true };
  const k = r * K, R = x + w, B = y + h;
  return {
    x0: x + r, y0: y, closed: true,
    segs: [
      L(x + r, y, R - r, y), [R - r + k, y, R, y + r - k, R, y + r],
      L(R, y + r, R, B - r), [R, B - r + k, R - r + k, B, R - r, B],
      L(R - r, B, x + r, B), [x + r - k, B, x, B - r + k, x, B - r],
      L(x, B - r, x, y + r), [x, y + r - k, x + r - k, y, x + r, y],
    ],
  };
}

/** A run under `m` as pen nodes (anchors absolute, handles relative); a closed run ending on its start folds into it. */
function nodesOf(r: Run, m: Mat): BezNode[] {
  const p0 = apply(m, r.x0, r.y0);
  const nodes: BezNode[] = [{ x: p0[0], y: p0[1], ix: 0, iy: 0, ox: 0, oy: 0 }];
  for (const s of r.segs) {
    const a = nodes[nodes.length - 1];
    const c1 = apply(m, s[0], s[1]), c2 = apply(m, s[2], s[3]), p = apply(m, s[4], s[5]);
    a.ox = c1[0] - a.x; a.oy = c1[1] - a.y;
    nodes.push({ x: p[0], y: p[1], ix: c2[0] - p[0], iy: c2[1] - p[1], ox: 0, oy: 0 });
  }
  if (r.closed && nodes.length > 2) {
    const f = nodes[0], l = nodes[nodes.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-6 * Math.max(1, Math.abs(f.x) + Math.abs(f.y))) { f.ix = l.ix; f.iy = l.iy; nodes.pop(); }
  }
  return nodes;
}

/** One prim placed by `m` (rig units to movie pixels from the centre) as shape definitions, bottom first. */
function primDefs(p: CastPrim, m: Mat): { name: string; def: ShapeDef }[] {
  const runs = p.t === 'p' ? runsOf(p.d) : p.t === 'e' ? [ellipseRun(p.cx, p.cy, p.rx, p.ry, p.rot ?? 0)] : [rectRun(p.x, p.y, p.w, p.h, p.r)];
  const op = p.op ?? 1;
  const fill = paint(p.fill, op);
  const sp = p.stroke ? paint(p.stroke, op) : null;
  const sw = (p.sw ?? 1) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const cap = p.t === 'p' && (p.cap === 'butt' || p.cap === 'square') ? p.cap : 'round';
  const stroke: ShapeStroke | null = sp && sw > 0 ? { color: sp.color, width: sw, ...(sp.alpha !== undefined ? { alpha: sp.alpha } : {}), cap, join: 'round' } : null;
  if (!fill && !stroke) return [];
  const name = p.t === 'p' ? 'path' : p.t === 'e' ? 'ellipse' : 'rect';
  const out: { name: string; def: ShapeDef }[] = [];
  const def = (nodes: BezNode[], f: ShapePaint | null, s: ShapeStroke | null, closed: boolean): ShapeDef => refitPath({ type: 'path', w: 0, h: 0, fill: f, stroke: s, nodes, closed });
  for (const r of runs) {
    const nodes = nodesOf(r, m);
    if (nodes.length < 2) continue;
    if (fill && stroke && !r.closed) {
      out.push({ name, def: def(nodes.map((n) => ({ ...n })), fill, null, true) });
      out.push({ name, def: def(nodes, null, stroke, false) });
    } else out.push({ name, def: def(nodes, fill, stroke, r.closed || !!fill) });
  }
  return out;
}

function boxOfDefs(defs: ShapeDef[]): [number, number, number, number] | null {
  let b: [number, number, number, number] | null = null;
  for (const d of defs) {
    const o = bounds(outline(d, shapeBase(d)));
    if (!o) continue;
    const pad = d.stroke ? d.stroke.width / 2 + 1 : 1;
    b = b ? [Math.min(b[0], o[0] - pad), Math.min(b[1], o[1] - pad), Math.max(b[2], o[2] + pad), Math.max(b[3], o[3] + pad)] : [o[0] - pad, o[1] - pad, o[2] + pad, o[3] + pad];
  }
  return b;
}

function pivotAt(m: Mat): { x: number; y: number } {
  return { x: +m[4].toFixed(2), y: +m[5].toFixed(2) };
}

/** A slot's shapes as one part: a Shape when it has one, else a Group of Shapes (top first on the Timeline). */
function partOf(name: string, defs: { name: string; def: ShapeDef }[], dur: number): Content {
  if (defs.length === 1) return makeContent('shape', 0, dur, { name, shape: defs[0].def });
  const tracks: Track[] = defs.map((d) => makeTrack(d.name, [makeContent('shape', 0, dur, { name: d.name, shape: d.def })])).reverse();
  return makeContent('group', 0, dur, { name, tracks });
}

function pixelsAsset(name: string, blob: Blob, w: number, h: number): Asset {
  return { id: uid('a'), kind: 'pixels', name, mime: 'image/png', width: w, height: h, frames: 0, size: blob.size };
}

/** The eight mouths as one chart Flipbook named mouth, resting on Rest; each drawing painted at the movie's scale. */
async function mouthBook(shapes: ShapeDef[][], movie: Movie, dur: number, assets: ImportResult['assets']): Promise<Content | null> {
  const b = boxOfDefs(shapes.flat());
  if (!b) return null;
  const x0 = Math.floor(b[0] + movie.width / 2), y0 = Math.floor(b[1] + movie.height / 2);
  const rect: CanvasRect = { x: x0, y: y0, w: Math.max(1, Math.ceil(b[2] + movie.width / 2) - x0), h: Math.max(1, Math.ceil(b[3] + movie.height / 2) - y0) };
  const canPaint = typeof OffscreenCanvas !== 'undefined';
  const frames: FlipbookFrame[] = [];
  for (let i = 0; i < VISEMES.length; i++) {
    const name = VISEME_NAMES[VISEMES[i]];
    const layer = drawingLayer(name);
    const list = shapes[i] ?? [];
    if (canPaint && list.length) {
      const cv = new OffscreenCanvas(rect.w, rect.h);
      const ctx = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
      ctx.translate(-rect.x, -rect.y);
      for (const d of list) paintShape(ctx, d, shapeBase(d), movie);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      const asset = pixelsAsset(name, blob, rect.w, rect.h);
      assets.push({ asset, blob });
      layer.pixels = asset.id;
    }
    frames.push({ id: uid('f'), hold: 1, layers: [layer], name });
  }
  const row = restingChart({ ...flipTrack('Mouth', 1), frames }, dur);
  return makeContent('flipbook', 0, dur, { name: 'mouth', flip: [row], canvas: rect });
}

/**
 * A built rig as a new character Group at frame `at`, the shape the SVG importer gives: one part per drawn slot on its
 * own inner track (the first slot at the bottom), each pivoted on its bone and following its parent part, and the mouth
 * a chart Flipbook of `mouthShapes` (eight prim lists in the mouth bone's space, in lip-sync order). Without them the
 * mouth and open mouth slots are Rest and AI, and Rest stands in for the others.
 */
export async function rigToCharacterGroup(rig: CastRig, spec: CastSpec, mouthShapes: CastPrim[][] | null, movie: Movie, at = 0): Promise<ImportResult> {
  const f = fitOf(movie);
  const W = solve(rig, f.m), Wopen = solve(rig, f.m, true);
  const dur = Math.max(1, movie.duration - at);
  const assets: ImportResult['assets'] = [];
  const made: { name: string; c: Content }[] = [];
  const slots = rig.slots.filter((s) => s.prims.length);
  const mouthSlot = slots.find((s) => s.name === 'mouth'), openSlot = slots.find((s) => s.name === OPEN_SLOT);
  const mouthBone = rig.bones.some((b) => b.name === 'mouth') ? 'mouth' : mouthSlot?.bone ?? null;
  const chartAt = mouthSlot ?? openSlot ?? slots.find((s) => s.name === 'hairFront' || s.name === 'headAcc') ?? null;
  let chartDone = false;
  const placeChart = async (): Promise<void> => {
    chartDone = true;
    let frames: ShapeDef[][];
    if (mouthShapes && mouthBone) {
      const m = Wopen[mouthBone] ?? IDENT;
      frames = VISEMES.map((_, i) => (mouthShapes[i] ?? []).flatMap((p) => primDefs(p, m).map((d) => d.def)));
    } else {
      const of = (s: CastSlot | undefined): ShapeDef[] => (s ? s.prims.flatMap((p) => primDefs(p, slotMatrix(s, Wopen)).map((d) => d.def)) : []);
      const rest = of(mouthSlot), open = openSlot ? of(openSlot) : rest;
      frames = VISEMES.map((v) => (v === 'AI' ? open : rest));
    }
    const book = await mouthBook(frames, movie, dur, assets);
    if (!book) return;
    book.pivot = pivotAt(W[mouthBone ?? 'head'] ?? IDENT);
    made.push({ name: 'mouth', c: book });
  };
  for (const s of slots) {
    if (s.name === 'mouth' || s.name === OPEN_SLOT) { if (!chartDone) await placeChart(); continue; }
    if (s === chartAt && !chartDone && mouthShapes) await placeChart();
    const name = castPartName(s.name);
    if (!name || made.some((p) => p.name === name)) continue;
    const m = slotMatrix(s, W);
    const defs = s.prims.flatMap((p) => primDefs(p, m));
    if (!defs.length) continue;
    const c = partOf(name, defs, dur);
    c.pivot = pivotAt(W[s.bone] ?? IDENT);
    made.push({ name, c });
  }
  if (!chartDone && mouthShapes) await placeChart();

  const tracks = made.map(({ c }) => makeTrack(c.name, [c])).reverse();
  let group = makeContent('group', at, dur, { name: spec.name, tracks });
  const all = boxOfDefs(made.flatMap(({ c }) => shapesIn(c)));
  const book = made.find((p) => p.c.kind === 'flipbook')?.c.canvas;
  const box = all && book ? [Math.min(all[0], book.x - f.W / 2), Math.min(all[1], book.y - f.H / 2), Math.max(all[2], book.x + book.w - f.W / 2), Math.max(all[3], book.y + book.h - f.H / 2)] : all;
  if (box) group.pivot = { x: +((box[0] + box[2]) / 2).toFixed(2), y: +((box[1] + box[3]) / 2).toFixed(2) };
  const byName = new Map(made.map((p) => [p.name, p.c.id]));
  const parentOf = (name: string): string | null => {
    for (let p = FOLLOWS[name]; p; p = FOLLOWS[p]) if (byName.has(p)) return byName.get(p) as string;
    return null;
  };
  let tmp: Movie = { ...movie, tracks: [makeTrack('cast', [group])] };
  for (const { name, c } of made) { const p = parentOf(name); if (p) tmp = setParent(tmp, c.id, p); }
  group = tmp.tracks[0].content[0];
  group = { ...group, character: { ...characterInfoOf(group, spec.name), build: spec } };
  return { assets, contents: [group], ownTrack: [true] };
}

function shapesIn(c: Content): ShapeDef[] {
  if (c.shape) return [c.shape];
  return c.tracks.flatMap((t) => t.content.flatMap(shapesIn));
}

/** A rebuild: `missing` holds only parts the person added; `hidden` the cast parts this build does not draw. */
export interface CastRebuild extends SourceMerge { hidden: string[]; assets: ImportResult['assets'] }

/**
 * Builds the character afresh from its rig and lays it over `charId` by part name: matched parts take the new art and
 * keep their keys, actions and parents. Mouth drawings lip-sync wrote keep their timing and take the new art by shape
 * name. The recipe is written as the character's build. `assets` carries the pictures of the new mouth to store.
 */
export async function rebuildCharacter(movie: Movie, charId: string, rig: CastRig, spec: CastSpec, mouthShapes: CastPrim[][] | null): Promise<CastRebuild> {
  const fresh = await rigToCharacterGroup(rig, spec, mouthShapes, movie, 0);
  const table: Record<string, Asset> = {};
  for (const a of fresh.assets) table[a.asset.id] = a.asset;
  const g = fresh.contents[0];
  const oldMouth = partContent(movie, charId, 'mouth');
  const old = characterOf(movie, charId);
  const highlight = new Map(old ? old.tracks.flatMap((t) => t.content).map((x) => [x.id, x.highlight]) : []);
  const before = old?.character?.build ? builtParts(old.character.build) : null;
  const r = mergeFromSource(movie, charId, g, table);
  const hidden = r.missing.filter(isCastPart);
  const back = Object.keys(g.character?.parts ?? {}).filter((n) => isCastPart(n) && before && !before.has(n));
  const freshMouth = g.character?.parts.mouth ? g.tracks.flatMap((t) => t.content).find((c) => c.id === g.character?.parts.mouth) : undefined;
  const next = updateDeep(r.movie, charId, (c) => {
    const ch0 = c.character;
    if (!ch0) return c;
    const hideIds = new Set(hidden.map((n) => ch0.parts[n]));
    const showIds = new Set(back.map((n) => ch0.parts[n]));
    let tracks = c.tracks.map((t) => (t.content.some((x) => hideIds.has(x.id) || showIds.has(x.id)) ? { ...t, content: t.content.map((x) => {
      if (hideIds.has(x.id)) return { ...x, hidden: true as const, highlight: highlight.get(x.id) ?? x.highlight };
      if (showIds.has(x.id) && x.hidden) { const { hidden: _h, ...rest } = x; return rest as Content; }
      return x;
    }) } : t));
    const { missing: m0, missingWas: w0, ...base } = ch0;
    const missing = (m0 ?? []).filter((n) => !hidden.includes(n));
    const was = Object.fromEntries(Object.entries(w0 ?? {}).filter(([n]) => !hidden.includes(n)));
    const ch = { ...base, ...(missing.length ? { missing } : {}), ...(missing.length && Object.keys(was).length ? { missingWas: was } : {}) };
    const mouthId = ch.parts.mouth;
    if (oldMouth?.kind === 'flipbook' && freshMouth?.kind === 'flipbook' && mouthId === oldMouth.id) {
      const art = new Map<string, FlipbookFrame>();
      for (const fr of freshMouth.flip[0]?.frames ?? []) if (fr.name) art.set(fr.name, fr);
      const flip = oldMouth.flip.map((row) => ({ ...row, frames: row.frames.map((fr) => {
        const a = fr.name ? art.get(fr.name) : undefined;
        return a ? { ...fr, layers: a.layers.map((l) => ({ ...l, id: uid('l') })) } : fr;
      }) }));
      if (oldMouth.flip.some((row) => row.frames.some((fr) => fr.name && art.has(fr.name)))) {
        tracks = tracks.map((t) => (t.content.some((x) => x.id === mouthId) ? { ...t, content: t.content.map((x) => (x.id === mouthId ? { ...x, flip } : x)) } : t));
      }
    }
    const mouthC = mouthId ? tracks.flatMap((t) => t.content).find((x) => x.id === mouthId) : undefined;
    return { ...c, tracks, character: { ...ch, build: spec, ...(mouthC?.kind === 'flipbook' ? { mouth: mouthId } : {}) } };
  });
  return { ...r, movie: next, missing: r.missing.filter((n) => !isCastPart(n)), hidden, assets: fresh.assets };
}

const CAST_PARTS = new Set(Object.values(PART));
const isCastPart = (name: string): boolean => CAST_PARTS.has(name);

/** The part names a recipe's build draws; null when it cannot be built. */
function builtParts(spec: CastSpec): Set<string> | null {
  try {
    const out = new Set<string>();
    for (const s of build(spec).slots) {
      if (!s.prims.length) continue;
      const n = s.name === OPEN_SLOT ? 'mouth' : castPartName(s.name);
      if (n) out.add(n);
    }
    out.add('mouth');
    return out;
  } catch { return null; }
}

/** A recipe built and made a character at frame `at`, its mouth chart from the recipe's own mouth shapes. */
export function castToCharacterGroup(spec: CastSpec, movie: Movie, at = 0): Promise<ImportResult> {
  const rig = build(spec);
  return rigToCharacterGroup(rig, spec, visemes(spec, rig), movie, at);
}

/** Rebuilds the character `charId` from a recipe (see rebuildCharacter). */
export function rebuildFromSpec(movie: Movie, charId: string, spec: CastSpec): Promise<CastRebuild> {
  const rig = build(spec);
  return rebuildCharacter(movie, charId, rig, spec, visemes(spec, rig));
}
