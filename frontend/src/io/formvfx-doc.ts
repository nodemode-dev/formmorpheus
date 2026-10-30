// formvfx compositions (.fvxproj, JSON) from a movie and back. A bundle is a ZIP holding the project file and a
// Footage folder, because a formvfx project names its pictures by path and finds them again beside itself.
// Pure: bytes and model types only, no DOM. Key times are layer seconds; eases map exactly for the presets and
// through Bezier handles for custom ones.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { content as makeContent, identity } from '../engine/model';
import { evalChannel } from '../engine/keys';
import { handlesOf, pathNodes } from '../engine/path';
import type { BlendMode, Content, Ease, Key, KeyLane, Movie } from '../engine/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

export const FORMVFX_FORMAT = 'formvfx.project/1';
export const FORMVFX_EXT = 'fvxproj';

export interface VfxPicture { file: string; bytes: Uint8Array; width: number; height: number }

const BLEND_OUT: Record<BlendMode, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten',
  'color-dodge': 'ColorDodge', 'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight', difference: 'Difference',
  exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity', add: 'Add', passthrough: 'Normal',
};
const BLEND_IN = new Map<string, BlendMode>([...Object.entries(BLEND_OUT).filter(([k]) => k !== 'passthrough').map(([k, v]) => [v, k as BlendMode] as [string, BlendMode]), ['LinearDodge', 'add']]);

const EASY = 100 / 3;
const LIN_OUT: [number, number] = [1 / 3, 1 / 3];
const LIN_IN: [number, number] = [2 / 3, 2 / 3];

// ---- writing

let uidCounter = 0;
const nu = (): number => ++uidCounter;

const SLIDER = (min: number, max: number, smin: number, smax: number, decimals: number): J => ({ kind: 'Slider', min, max, slider_min: smin, slider_max: smax, decimals });
const prop = (match: string, name: string, value: J, ui: J, flags: Partial<Record<'spatial' | 'staticOnly' | 'threeDOnly', boolean>> = {}, keys: J[] = []): J => ({
  prop: { uid: nu(), match, name, value, default: value, ...(keys.length ? { keys } : {}), ui, spatial: !!flags.spatial, staticOnly: !!flags.staticOnly, holdOnly: false, threeDOnly: !!flags.threeDOnly, twoDOnly: false },
});
const group = (match: string, name: string, kind: string, children: J[]): J => ({ group: { uid: nu(), match, name, enabled: true, kind: { type: kind }, children } });
const num = (v: number): J => ({ num: v });
const vec3 = (a: number, b: number, c = 0): J => ({ vec3: [a, b, c] });
const popup = (options: string[]): J => ({ kind: 'Popup', options });

function materialGroup(): J {
  const pct = SLIDER(0, 100, 0, 100, 0);
  const shadows = ['Off', 'On', 'Only'];
  return group('materialOptions', 'Material Options', 'Plain', [
    prop('castsShadows', 'Casts Shadows', { enum: 0 }, popup(shadows)),
    prop('lightTransmission', 'Light Transmission', num(0), pct),
    prop('acceptsShadows', 'Accepts Shadows', { enum: 1 }, popup(shadows)),
    prop('acceptsLights', 'Accepts Lights', { bool: true }, { kind: 'Checkbox' }),
    prop('appearsInReflections', 'Appears in Reflections', { bool: true }, { kind: 'Checkbox' }),
    prop('ambient', 'Ambient', num(100), pct),
    prop('diffuse', 'Diffuse', num(50), pct),
    prop('specularIntensity', 'Specular Intensity', num(50), pct),
    prop('specularShininess', 'Specular Shininess', num(5), pct),
    prop('metal', 'Metal', num(100), pct),
    prop('reflectionIntensity', 'Reflection Intensity', num(0), pct),
    prop('reflectionSharpness', 'Reflection Sharpness', num(100), pct),
    prop('reflectionRolloff', 'Reflection Rolloff', num(0), pct),
    prop('transparency', 'Transparency', num(0), pct),
    prop('transparencyRolloff', 'Transparency Rolloff', num(0), pct),
    prop('indexOfRefraction', 'Index of Refraction', num(1), SLIDER(1, 5, 1, 3, 2)),
  ]);
}

/** One key's span ease in the shape formvfx stores: a side that is not Bezier is the straight line. */
interface SideEase { interp: 'linear' | 'bezier' | 'hold'; ease: { speed: number; influence: number }[] }

function sidesOf(k: Key, d: number[], dt: number): { out: SideEase; inn: SideEase } {
  const dims = d.length;
  const same = (s: number, i: number): { speed: number; influence: number }[] => Array.from({ length: dims }, () => ({ speed: s, influence: i }));
  const lin: SideEase = { interp: 'linear', ease: [] };
  const eased: SideEase = { interp: 'bezier', ease: same(0, EASY) };
  switch (k.ease) {
    case 'hold': return { out: { interp: 'hold', ease: [] }, inn: lin };
    case 'in': return { out: lin, inn: eased };
    case 'out': return { out: eased, inn: lin };
    case 'inout': return { out: eased, inn: eased };
    case 'custom': {
      const o = k.out ?? LIN_OUT, i = k.in ?? LIN_IN;
      const x1 = Math.min(1, Math.max(0.001, o[0])), inf = Math.min(1, Math.max(0.001, 1 - i[0]));
      return {
        out: { interp: 'bezier', ease: d.map((v) => ({ speed: dt > 0 ? (v * o[1]) / (x1 * dt) : 0, influence: x1 * 100 })) },
        inn: { interp: 'bezier', ease: d.map((v) => ({ speed: dt > 0 ? (v * (1 - i[1])) / (inf * dt) : 0, influence: inf * 100 })) },
      };
    }
    default: return { out: lin, inn: lin };
  }
}

interface KeyedValue { frame: number; value: number[]; ease: Key; tangents?: { auto: boolean; in: number[]; out: number[] } | null }

/** formvfx keys for a list of frames; `ease` supplies the span ease that leaves each frame. */
function buildKeys(frames: KeyedValue[], fps: number, vecOf: (v: number[]) => J, spatial: boolean): J[] {
  const out: J[] = frames.map((f) => ({ time: f.frame / fps, value: vecOf(f.value), inInterp: 'linear', outInterp: 'linear', inEase: [], outEase: [], autoBezier: false, continuous: false, spatialIn: [0, 0, 0], spatialOut: [0, 0, 0], spatialAuto: spatial, roving: false, label: 0 }));
  frames.forEach((f, i) => {
    if (f.tangents) { out[i].spatialAuto = f.tangents.auto; out[i].spatialIn = [...f.tangents.in, 0].slice(0, 3); out[i].spatialOut = [...f.tangents.out, 0].slice(0, 3); }
    const next = frames[i + 1];
    if (!next) return;
    const dt = (next.frame - f.frame) / fps;
    let d = next.value.map((v, n) => v - f.value[n]);
    if (spatial) d = [Math.hypot(...d)];
    else if (d.length === 3) d = d.slice(0, 2).concat(0);
    const s = sidesOf(f.ease, d, dt);
    out[i].outInterp = s.out.interp;
    out[i].outEase = s.out.ease;
    out[i + 1].inInterp = s.inn.interp;
    out[i + 1].inEase = s.inn.ease;
  });
  return out;
}

const keyAt = (keys: Key[] | undefined, frame: number): Key | undefined => keys?.find((k) => k.frame === frame);
const sortedFrames = (...lists: (Key[] | undefined)[]): number[] => [...new Set(lists.flatMap((l) => (l ?? []).map((k) => k.frame)))].sort((a, b) => a - b);

export interface VfxExport {
  /** The bundle: Name.fvxproj and Footage/*. */
  zip: Uint8Array;
  json: string;
  /** Short sentences for what was left out. */
  dropped: string[];
  layers: number;
}

export function writeFormvfx(movie: Movie, pictures: Map<string, VfxPicture>, name: string): VfxExport {
  uidCounter = 0;
  let nextId = 0;
  const id = (): number => ++nextId;
  const fps = movie.fps, W = movie.width, H = movie.height;
  const compId = id(), folderId = id();
  const items: J[] = [];
  const layers: J[] = [];
  const files: Zippable = {};
  const itemOf = new Map<string, number>();
  const dropped = new Map<string, number>();
  const drop = (why: string): void => { dropped.set(why, (dropped.get(why) ?? 0) + 1); };
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(movie.background);
  const bg = rgb ? [parseInt(rgb[1], 16) / 255, parseInt(rgb[2], 16) / 255, parseInt(rgb[3], 16) / 255] : [0, 0, 0];

  const seq: { c: Content; hidden: boolean }[] = [];
  for (const t of movie.tracks) for (const c of t.content.slice().sort((a, b) => a.start - b.start)) seq.push({ c, hidden: t.hidden });
  for (const { c, hidden } of seq) {
    const pic = pictures.get(c.id);
    if (!pic) { drop(`${c.kind} content`); continue; }
    let item = itemOf.get(pic.file);
    if (!item) {
      item = id();
      itemOf.set(pic.file, item);
      files[`Footage/${pic.file}`] = [pic.bytes, { level: 0 }];
      items.push({ id: item, name: pic.file, parent: folderId, label: 0, comment: '', kind: { type: 'Footage', path: `Footage/${pic.file}`, kind: 'Image', width: pic.width, height: pic.height, duration: 0, frameRate: 0, hasVideo: true, hasAudio: false, codec: '', pixelAspect: 1, alpha: 'Straight', missing: false, loops: 1, sequence: [] } });
    }
    if (c.mask !== 'none') drop('track mattes (content masks)');
    const move = c.keys.find((l) => l.kind === 'move');
    const opLane = c.keys.find((l) => l.kind === 'opacity');
    for (const l of c.keys) if (l.kind !== 'move' && l.kind !== 'opacity') drop(`${l.kind} keys`);
    if (c.rig) drop('bones');
    const layer = buildLayer(c, hidden, pic, move, opLane, id(), item, fps, W, H, drop);
    layers.push(layer);
  }
  const dur = Math.max(1 / fps, movie.duration / fps);
  const comp = {
    id: compId, name: name || movie.name, parent: null, label: 15, comment: '',
    kind: { type: 'Comp', width: W, height: H, pixelAspect: 1, frameRate: fps, duration: dur, displayStart: 0, background: bg, workArea: [0, dur], layers },
  };
  const folder = { id: folderId, name: 'Footage', parent: null, label: 0, comment: '', kind: { type: 'Folder' } };
  const project = { format: FORMVFX_FORMAT, settings: {}, items: [comp, folder, ...items], nextId: nextId + 1, nextUid: uidCounter + 1, renderQueue: [], savedBy: 'formmorpheus', uid: `fm-${Date.now().toString(16)}` };
  const json = JSON.stringify(project, null, 2);
  const base = (name || movie.name).replace(/[\\/:*?"<>|]/g, '-') || 'movie';
  files[`${base}.${FORMVFX_EXT}`] = [strToU8(json), { level: 6 }];
  const notes = [...dropped].map(([why, n]) => `${n} × ${why}`);
  return { zip: zipSync(files), json, dropped: notes, layers: layers.length };
}

function buildLayer(c: Content, hidden: boolean, pic: VfxPicture, move: KeyLane | undefined, opLane: KeyLane | undefined, layerId: number, itemId: number, fps: number, W: number, H: number, drop: (w: string) => void): J {
  const t = c.transform;
  const pv = c.pivot ?? { x: 0, y: 0 };
  const ch = (id: string): Key[] | undefined => (move?.channels[id]?.length ? move.channels[id] : undefined);
  const val = (id: string, frame: number, base: number): number => { const k = ch(id); return k ? (evalChannel(k, frame) ?? base) : base; };
  const smooth = move?.options.path === true;
  const flipX = t.flipH ? -1 : 1, flipY = t.flipV ? -1 : 1;

  // position: x, y, pivot x and y all land in formvfx's one Position (and Anchor for the pivot)
  const posFrames = sortedFrames(ch('x'), ch('y'), ch('px'), ch('py'));
  const xs = ch('x'), ys = ch('y');
  const nodes = xs && ys ? pathNodes(xs, ys) : [];
  const pos = (f: number): number[] => [W / 2 + val('x', f, t.x) + val('px', f, pv.x), H / 2 + val('y', f, t.y) + val('py', f, pv.y), 0];
  const anchorFrames = sortedFrames(ch('px'), ch('py'));
  const anchor = (f: number): number[] => [pic.width / 2 + val('px', f, pv.x), pic.height / 2 + val('py', f, pv.y), 0];
  const easeOf = (f: number, ...ids: string[]): Key => { for (const i of ids) { const k = keyAt(ch(i), f); if (k) return k; } return { frame: f, value: 0, ease: 'linear' }; };

  const posKeys = posFrames.length
    ? buildKeys(posFrames.map((f) => {
        // the handles the motion path really uses (automatic ones included), so the curve is the same
        let tg: KeyedValue['tangents'] = { auto: false, in: [0, 0], out: [0, 0] };
        const ni = nodes.findIndex((n) => n.frame === f);
        if (ni >= 0) { const h = handlesOf(nodes, ni, smooth); tg = { auto: false, in: h.in, out: h.out }; }
        return { frame: f, value: pos(f), ease: easeOf(f, 'x', 'y', 'px', 'py'), tangents: tg };
      }), fps, (v) => ({ vec3: v }), true)
    : [];
  // formvfx gives Position one ease per key; x's is used, so say so when y's differs
  if (posFrames.some((f) => { const a = keyAt(ch('x'), f), b = keyAt(ch('y'), f); return a && b && (a.ease !== b.ease || (a.ease === 'custom' && (a.out?.join() !== b.out?.join() || a.in?.join() !== b.in?.join()))); })) drop('Move keys whose x and y ease differently (the x ease is used for both)');
  const anchorKeys = anchorFrames.length ? buildKeys(anchorFrames.map((f) => ({ frame: f, value: anchor(f), ease: easeOf(f, 'px', 'py') })), fps, (v) => ({ vec3: v }), true) : [];

  const sFrames = sortedFrames(ch('scaleX'), ch('scaleY'));
  const sc = (f: number): number[] => [val('scaleX', f, t.scale) * 100 * flipX, val('scaleY', f, t.scale) * 100 * flipY, 100];
  const scaleKeys = sFrames.length ? buildKeys(sFrames.map((f) => ({ frame: f, value: sc(f), ease: easeOf(f, 'scaleX', 'scaleY') })), fps, (v) => ({ vec3: v }), false) : [];

  const rFrames = sortedFrames(ch('rotation'));
  const rotKeys = rFrames.length ? buildKeys(rFrames.map((f) => ({ frame: f, value: [val('rotation', f, t.rotation)], ease: easeOf(f, 'rotation') })), fps, (v) => ({ num: v[0] }), false) : [];

  const oKeysIn = opLane?.channels.amount?.length ? opLane.channels.amount : undefined;
  const oFrames = sortedFrames(oKeysIn);
  const opKeys = oFrames.length ? buildKeys(oFrames.map((f) => ({ frame: f, value: [c.opacity * (evalChannel(oKeysIn as Key[], f) ?? 1) * 100], ease: keyAt(oKeysIn, f) as Key })), fps, (v) => ({ num: v[0] }), false) : [];

  const transform = group('transform', 'Transform', 'Plain', [
    withKeys(prop('anchor', 'Anchor Point', vec3(...(anchor(0).slice(0, 2) as [number, number])), { kind: 'Point' }, { spatial: true }), anchorKeys),
    withKeys(prop('position', 'Position', vec3(...(pos(0).slice(0, 2) as [number, number])), { kind: 'Point' }, { spatial: true }), posKeys),
    withKeys(prop('scale', 'Scale', vec3(...(sc(0).slice(0, 2) as [number, number]), 100), { kind: 'Percent' }), scaleKeys),
    prop('orientation', 'Orientation', vec3(0, 0, 0), { kind: 'Point3' }, { threeDOnly: true }),
    prop('rotationX', 'X Rotation', num(0), { kind: 'Angle' }, { threeDOnly: true }),
    prop('rotationY', 'Y Rotation', num(0), { kind: 'Angle' }, { threeDOnly: true }),
    withKeys(prop('rotation', 'Rotation', num(val('rotation', 0, t.rotation)), { kind: 'Angle' }), rotKeys),
    withKeys(prop('opacity', 'Opacity', num(c.opacity * (oKeysIn ? (evalChannel(oKeysIn, 0) ?? 1) : 1) * 100), SLIDER(0, 100, 0, 100, 0)), opKeys),
  ]);
  const root = group('root', 'Layer', 'Plain', [
    group('masks', 'Masks', 'Indexed', []), group('effects', 'Effects', 'Indexed', []), transform, materialGroup(),
    group('audio', 'Audio', 'Plain', [prop('levels', 'Audio Levels', { vec2: [0, 0] }, { kind: 'Plain' })]),
  ]);
  const start = c.start / fps, end = (c.start + c.duration) / fps;
  return {
    id: layerId, name: c.name, kind: 'Footage', source: itemId, inPoint: start, outPoint: end, startTime: start, stretch: 100, parent: null,
    switches: { video: !hidden, audio: false }, blend: BLEND_OUT[c.blend] ?? 'Normal', preserveTransparency: false, trackMatte: null, label: 3, comment: '',
    props: root.group, markers: [], autoOrient: 'Off', environment: false, envBackground: null,
  };
}

function withKeys(p: J, keys: J[]): J {
  if (keys.length) p.prop.keys = keys;
  return p;
}

// ---- reading

export interface VfxClip {
  content: Content;
  /** A picture to take from the bundle (path as the project names it), or a solid colour as 0 to 255 rgb. */
  source: { file: string } | { solid: [number, number, number]; width: number; height: number };
}

export interface VfxRead {
  name: string;
  /** Bottom layer first. */
  clips: VfxClip[];
  files: Map<string, Uint8Array>;
  notes: string[];
  compWidth: number;
  compHeight: number;
  durationFrames: number;
}

const isImageExt = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;

function findProp(g: J, match: string): J | null {
  for (const n of g?.children ?? []) if (n.prop && n.prop.match === match) return n.prop;
  return null;
}
function findGroup(g: J, match: string): J | null {
  for (const n of g?.children ?? []) if (n.group && n.group.match === match) return n.group;
  return null;
}

function handles(a: J, b: J, d: number, dt: number, dim: number): { o: [number, number]; i: [number, number] } {
  const out = a.outInterp === 'bezier' ? (a.outEase?.[dim] ?? a.outEase?.[0] ?? { speed: 0, influence: 100 / 6 }) : null;
  const inn = b.inInterp === 'bezier' ? (b.inEase?.[dim] ?? b.inEase?.[0] ?? { speed: 0, influence: 100 / 6 }) : null;
  const o: [number, number] = out ? [Math.min(1, Math.max(0, out.influence / 100)), Math.abs(d) > 1e-9 && dt > 0 ? (out.speed * (out.influence / 100) * dt) / d : 0] : LIN_OUT;
  const x2 = inn ? 1 - Math.min(1, Math.max(0, inn.influence / 100)) : 2 / 3;
  const i: [number, number] = inn ? [x2, Math.abs(d) > 1e-9 && dt > 0 ? 1 - (inn.speed * (inn.influence / 100) * dt) / d : 1] : LIN_IN;
  return { o, i };
}

const near = (a: [number, number], b: [number, number]): boolean => Math.abs(a[0] - b[0]) < 2e-3 && Math.abs(a[1] - b[1]) < 2e-3;

/** Turns a run of formvfx keys into Key[] (values mapped by `pick`), one span ease per key. */
function toKeys(ks: J[], frameOf: (t: number) => number, pick: (k: J) => number, dim: number, spatial: boolean): Key[] {
  const out: Key[] = [];
  ks.forEach((k, n) => {
    const frame = frameOf(k.time);
    const value = pick(k);
    const nx = ks[n + 1];
    let ease: Ease = 'linear';
    let ex: Partial<Key> = {};
    if (nx) {
      if (k.outInterp === 'hold') ease = 'hold';
      else if (k.outInterp !== 'bezier' && nx.inInterp !== 'bezier') ease = 'linear';
      else {
        const dt = nx.time - k.time;
        let d = pick(nx) - value;
        if (spatial) d = Math.hypot(nx.value.vec3[0] - k.value.vec3[0], nx.value.vec3[1] - k.value.vec3[1]);
        const { o, i } = handles(k, nx, d, dt, spatial ? 0 : dim);
        const isOut = near(o, [1 / 3, 0]), isLinO = near(o, LIN_OUT), isIn = near(i, [2 / 3, 1]), isLinI = near(i, LIN_IN);
        if (isLinO && isLinI) ease = 'linear';
        else if (isOut && isLinI) ease = 'out';
        else if (isLinO && isIn) ease = 'in';
        else if (isOut && isIn) ease = 'inout';
        else { ease = 'custom'; ex = { out: o, in: i }; }
      }
    }
    out.push({ frame, value, ease, ...ex });
  });
  // keys that land on one frame collapse to the last
  return out.filter((k, n) => !out[n + 1] || out[n + 1].frame !== k.frame);
}

export function looksLikeFormvfx(head: string): boolean {
  return /"format"\s*:\s*"formvfx\.project\//.test(head);
}

export function parseFormvfx(data: Uint8Array, fileName: string, movie: { fps: number; width: number; height: number }): VfxRead {
  let text: string | null = null;
  const files = new Map<string, Uint8Array>();
  if (data[0] === 0x50 && data[1] === 0x4b) {
    let entries: Record<string, Uint8Array>;
    try { entries = unzipSync(data); } catch { throw new Error(`${fileName} is not a readable bundle.`); }
    for (const [path, bytes] of Object.entries(entries)) {
      const p = path.replace(/\\/g, '/');
      if (p.includes('__MACOSX')) continue;
      if (/\.fvxproj$/i.test(p) && text === null) text = strFromU8(bytes);
      else if (isImageExt.test(p)) files.set(p, bytes);
    }
    if (text === null) throw new Error(`${fileName} holds no .fvxproj project.`);
  } else text = strFromU8(data);
  let project: J;
  try { project = JSON.parse(text); } catch { throw new Error(`${fileName} is not a formvfx project (not JSON).`); }
  if (typeof project?.format !== 'string' || !project.format.startsWith('formvfx.project/')) throw new Error(`${fileName} is not a formvfx project.`);
  const items: J[] = Array.isArray(project.items) ? project.items : [];
  const comps = items.filter((i) => i.kind?.type === 'Comp');
  if (!comps.length) throw new Error(`${fileName} has no composition.`);
  // the composition no other composition uses is the main one
  const used = new Set<number>();
  for (const c of comps) for (const l of c.kind.layers ?? []) if (l.kind === 'Precomp' && l.source) used.add(l.source);
  const main = comps.find((c) => !used.has(c.id) && (c.kind.layers ?? []).length) ?? comps.find((c) => (c.kind.layers ?? []).length) ?? comps[0];
  const comp = main.kind;
  const byId = new Map<number, J>(items.map((i) => [i.id, i]));
  const fps = movie.fps;
  const notes: string[] = [];
  const skipped = new Map<string, number>();
  const skip = (why: string): void => { skipped.set(why, (skipped.get(why) ?? 0) + 1); };
  const clips: VfxClip[] = [];
  const baseName = (p: string): string => p.replace(/\\/g, '/').split('/').pop() ?? p;
  const lookup = (path: string): string | null => {
    const norm = path.replace(/\\/g, '/');
    for (const k of files.keys()) if (k === norm || k.endsWith(`/${norm}`) || baseName(k) === baseName(norm)) return k;
    return null;
  };
  const layersIn: J[] = Array.isArray(comp.layers) ? comp.layers : [];
  for (const layer of layersIn.slice().reverse()) {
    const it = layer.source != null ? byId.get(layer.source) : null;
    let source: VfxClip['source'] | null = null;
    let sw = comp.width, sh = comp.height;
    if (layer.kind === 'Footage' && it?.kind?.type === 'Footage') {
      const f = it.kind;
      if (!['Image', 'Vector'].includes(f.kind) || (f.kind === 'Image' && f.duration > 0 && f.hasVideo === false)) { skip(`${f.kind === 'Audio' ? 'sound' : 'video or sequence'} layers`); continue; }
      const found = lookup(String(f.path ?? ''));
      if (!found) { skip('layers whose picture is not in the bundle'); continue; }
      source = { file: found };
      sw = f.width || comp.width; sh = f.height || comp.height;
    } else if (layer.kind === 'Solid' && it?.kind?.type === 'Solid') {
      const s = it.kind;
      source = { solid: [0, 1, 2].map((n) => Math.round(Math.min(1, Math.max(0, s.color?.[n] ?? 0)) * 255)) as [number, number, number], width: Math.max(1, s.width), height: Math.max(1, s.height) };
      sw = s.width; sh = s.height;
    } else { skip(`${String(layer.kind).toLowerCase()} layers`); continue; }

    const root = layer.props;
    const tr = findGroup(root, 'transform');
    if (!tr) { skip('layers without a transform'); continue; }
    const stretch = layer.stretch && Math.abs(layer.stretch) > 1e-6 ? layer.stretch : 100;
    const start = Math.max(0, Math.round(layer.inPoint * fps));
    const end = Math.max(start + 1, Math.round(layer.outPoint * fps));
    const frameOf = (kt: number): number => Math.round((kt * stretch / 100 + layer.startTime - layer.inPoint) * fps);

    const pAnchor = findProp(tr, 'anchor'), pPos = findProp(tr, 'position'), pScale = findProp(tr, 'scale'), pRot = findProp(tr, 'rotation'), pOp = findProp(tr, 'opacity');
    const v3 = (p: J, k?: J): number[] => (k ? k.value.vec3 : p.keys?.[0]?.value?.vec3 ?? p.value?.vec3 ?? [0, 0, 0]);
    const an = pAnchor ? v3(pAnchor) : [sw / 2, sh / 2, 0];
    if (pAnchor?.keys?.length > 1) notes.push(`${layer.name}: an animated anchor point is held at its first value.`);
    const P = { x: an[0] - sw / 2, y: an[1] - sh / 2 };
    const cx = comp.width / 2, cy = comp.height / 2;
    const c = makeContent(source && 'solid' in source ? 'drawing' : 'image', start, end - start, { name: layer.name || 'Layer' });
    c.transform = identity();
    if (Math.abs(P.x) > 0.5 || Math.abs(P.y) > 0.5) c.pivot = { x: Math.round(P.x * 100) / 100, y: Math.round(P.y * 100) / 100 };
    c.blend = BLEND_IN.get(layer.blend) ?? 'normal';
    if (!BLEND_IN.has(layer.blend) && layer.blend !== 'Normal') notes.push(`${layer.name}: blend mode ${layer.blend} shows as Normal.`);
    if (layer.trackMatte) skip('track mattes');
    if (findGroup(root, 'masks')?.children?.length) skip('layers with masks');
    if (findGroup(root, 'effects')?.children?.length) skip('effect stacks');
    const lanes: KeyLane = { kind: 'move', expanded: true, channels: {}, options: { path: false } };
    const pk = pPos?.keys?.length ? pPos.keys : null;
    if (pk) {
      const xs = toKeys(pk, frameOf, (k) => k.value.vec3[0] - P.x - cx, 0, true);
      const ys = toKeys(pk, frameOf, (k) => k.value.vec3[1] - P.y - cy, 0, true);
      const auto = pk.some((k: J) => k.spatialAuto) && pk.length > 2;
      // a handle that lies along the chord to its neighbour (or is zero) bends nothing
      const along = (h: number[] | undefined, a: number[], b: number[] | null): boolean => {
        if (!h || !b) return true;
        const hl = Math.hypot(h[0], h[1]), dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy);
        return hl < 1e-6 || dl < 1e-9 || Math.abs(h[0] * dy - h[1] * dx) / (hl * dl) < 1e-3;
      };
      const straightKey = (k: J, n: number): boolean => !k.spatialAuto && along(k.spatialIn, k.value.vec3, pk[n - 1]?.value.vec3 ?? null) && along(k.spatialOut, k.value.vec3, pk[n + 1]?.value.vec3 ?? null);
      const curved = pk.some((k: J, n: number) => !k.spatialAuto && !straightKey(k, n));
      if (auto || curved) {
        lanes.options.path = true;
        pk.forEach((k: J, n: number) => {
          if (k.spatialAuto) return;
          const key = xs.find((q) => q.frame === frameOf(k.time));
          if (!key) return;
          key.sp = straightKey(k, n) ? { in: [0, 0], out: [0, 0], linear: true } : { in: [k.spatialIn[0], k.spatialIn[1]], out: [k.spatialOut[0], k.spatialOut[1]], corner: true };
        });
      }
      lanes.channels.x = xs; lanes.channels.y = ys;
    } else {
      const p = v3(pPos ?? { value: { vec3: [cx, cy, 0] } });
      c.transform.x = Math.round((p[0] - P.x - cx) * 100) / 100;
      c.transform.y = Math.round((p[1] - P.y - cy) * 100) / 100;
    }
    const sk = pScale?.keys?.length ? pScale.keys : null;
    const s0 = pScale ? v3(pScale) : [100, 100, 100];
    if (sk) {
      lanes.channels.scaleX = toKeys(sk, frameOf, (k) => Math.abs(k.value.vec3[0]) / 100, 0, false);
      lanes.channels.scaleY = toKeys(sk, frameOf, (k) => Math.abs(k.value.vec3[1]) / 100, 1, false);
    } else if (Math.abs(Math.abs(s0[0]) - Math.abs(s0[1])) < 1e-6) c.transform.scale = Math.abs(s0[0]) / 100;
    else { c.transform.scale = 1; lanes.channels.scaleX = [{ frame: 0, value: Math.abs(s0[0]) / 100, ease: 'linear' }]; lanes.channels.scaleY = [{ frame: 0, value: Math.abs(s0[1]) / 100, ease: 'linear' }]; }
    if (s0[0] < 0) c.transform.flipH = true;
    if (s0[1] < 0) c.transform.flipV = true;
    if (pRot?.keys?.length) lanes.channels.rotation = toKeys(pRot.keys, frameOf, (k) => k.value.num, 0, false);
    else c.transform.rotation = pRot ? (pRot.value?.num ?? 0) : 0;
    const keyedMove = Object.keys(lanes.channels).length > 0;
    if (keyedMove) c.keys.push(lanes);
    if (pOp?.keys?.length) {
      c.opacity = 1;
      c.keys.push({ kind: 'opacity', expanded: true, channels: { amount: toKeys(pOp.keys, frameOf, (k) => Math.min(1, Math.max(0, k.value.num / 100)), 0, false) }, options: {} });
    } else c.opacity = Math.min(1, Math.max(0, (pOp?.value?.num ?? 100) / 100));
    if (layer.switches && layer.switches.video === false) notes.push(`${layer.name} was hidden in formvfx and is shown here.`);
    if (stretch !== 100) notes.push(`${layer.name}: time stretch is applied to its keys only.`);
    clips.push({ content: c, source });
  }
  for (const [why, n] of skipped) notes.push(`${n} ${why} left out.`);
  const durationFrames = Math.round(comp.duration * fps);
  if (Math.round(comp.frameRate) !== Math.round(fps)) notes.push(`The composition runs at ${comp.frameRate} fps; times were re-read at the movie's ${fps} fps.`);
  if (comp.width !== movie.width || comp.height !== movie.height) notes.push(`The composition is ${comp.width} by ${comp.height}; the movie is ${movie.width} by ${movie.height}.`);
  return { name: String(main.name || fileName.replace(/\.[^.]+$/, '')), clips, files, notes, compWidth: comp.width, compHeight: comp.height, durationFrames };
}
