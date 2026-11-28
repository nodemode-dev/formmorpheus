// Starter props shipped in public/starters/props: the manifest, and a prop's SVG made into one Group of vector Shapes
// placed in the open movie at the Playhead on a new top track. The starter files are only read.
import type { Engine } from '../engine/engine';
import { floorOf } from '../engine/guides';
import { content as makeContent, track as makeTrack } from '../engine/model';
import * as ops from '../engine/ops';
import { bounds, outline, shapeBase } from '../engine/shape';
import { refitPath } from '../engine/shape-ops';
import type { ShapeDef } from '../engine/shape-types';
import type { Content, Movie } from '../engine/types';
import { tf } from '../ui/i18n-fill';
import { parseSvgParts, type SvgShape } from './svg-import';

export const PROPS = '/starters/props/';

export type PropStyle = 'flat' | 'outline' | 'stick';
export const PROP_STYLES: ReadonlyArray<{ id: PropStyle; label: string; tip: string }> = [
  { id: 'flat', label: 'Flat', tip: 'Flat color shapes' },
  { id: 'outline', label: 'Outline', tip: 'A hand-drawn outline' },
  { id: 'stick', label: 'Stick', tip: 'Thick simple lines' },
];
export const PROP_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'furniture', label: 'Furniture' },
  { id: 'nature', label: 'Nature' },
  { id: 'city', label: 'City' },
  { id: 'office', label: 'Office' },
  { id: 'food', label: 'Food' },
  { id: 'history', label: 'Historical' },
  { id: 'future', label: 'Future' },
  { id: 'signs', label: 'Signs' },
];

export interface PropEntry {
  id: string;
  name: string;
  file: string;
  category: string;
  style: PropStyle;
  /** Where it stands, in the SVG's own pixels from the top; absent for a prop that flies or is held. */
  base?: number;
  tags?: string[];
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isPropEntry(v: unknown): v is PropEntry {
  const e = v as PropEntry;
  return !!e && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.file === 'string' && /^[\w.-]+\.svg$/i.test(e.file)
    && typeof e.category === 'string' && PROP_STYLES.some((s) => s.id === e.style)
    && (e.base === undefined || fin(e.base)) && (e.tags === undefined || (Array.isArray(e.tags) && e.tags.every((x) => typeof x === 'string')));
}

export function propFileUrl(entry: PropEntry): string { return PROPS + encodeURIComponent(entry.file); }

let manifest: Promise<PropEntry[]> | null = null;

/** The props the manifest lists, read once; an empty list when it cannot be read (read again next time). */
export function readPropManifest(): Promise<PropEntry[]> {
  manifest ??= (async () => {
    try {
      const res = await fetch(`${PROPS}manifest.json`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { props?: unknown[] };
      return (body.props ?? []).filter(isPropEntry);
    } catch { manifest = null; return []; }
  })();
  return manifest;
}

const texts = new Map<string, Promise<string>>();

function propText(entry: PropEntry): Promise<string> {
  let p = texts.get(entry.file);
  if (!p) {
    p = fetch(propFileUrl(entry)).then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.text(); });
    p.catch(() => texts.delete(entry.file));
    texts.set(entry.file, p);
  }
  return p;
}

/** The SVG prop as one Group of Shapes at frame `at` in `movie`, sized as a starter scene's props are, standing on the
 *  floor guide when it has a base and the movie a floor, else in the middle of the frame. Nodes are written where they
 *  are drawn, so the Group's own transform starts at rest; its pivot is where it stands. */
export function propContent(text: string, entry: PropEntry, movie: Movie, at: number): Content {
  const doc = parseSvgParts(text, entry.name);
  const shapes: SvgShape[] = [];
  const order = doc.parts.map((p, i) => ({ p, z: p.z ?? i })).sort((a, b) => a.z - b.z);
  for (const { p } of order) {
    if (p.raster) throw new Error(tf('{name} could not be loaded.', { name: entry.name }));
    if (!p.hidden) shapes.push(...p.shapes.filter((s) => !s.hidden));
  }
  if (!shapes.length) throw new Error(tf('{name} could not be loaded.', { name: entry.name }));
  const W = movie.width, H = movie.height;
  const k = Math.min(Math.max(W / 1920, H / 1080), (0.9 * W) / doc.width, (0.9 * H) / doc.height);
  const floor = floorOf(movie.guides);
  const stands = floor !== null && fin(entry.base);
  const ox = W / 2 - (doc.width * k) / 2;
  const oy = stands ? (floor as number) - (entry.base as number) * k : H / 2 - (doc.height * k) / 2;
  const dur = Math.max(1, movie.duration - at);
  const mx = (x: number): number => ox + x * k - W / 2, my = (y: number): number => oy + y * k - H / 2;
  const made = shapes.map((s) => {
    const nodes = s.nodes.map((n) => ({ x: mx(n.x), y: my(n.y), ix: n.ix * k, iy: n.iy * k, ox: n.ox * k, oy: n.oy * k }));
    const stroke = s.stroke ? { ...s.stroke, width: s.stroke.width * k, ...(s.stroke.dash ? { dash: s.stroke.dash * k, gap: (s.stroke.gap ?? 0) * k } : {}), ...(s.stroke.dashOffset ? { dashOffset: s.stroke.dashOffset * k } : {}) } : null;
    const def: ShapeDef = refitPath({ type: 'path', w: 0, h: 0, fill: s.fill, stroke, nodes, closed: s.closed });
    return makeContent('shape', 0, dur, { name: s.name, shape: def });
  });
  let box: [number, number, number, number] | null = null;
  for (const c of made) {
    const b = c.shape ? bounds(outline(c.shape, shapeBase(c.shape))) : null;
    if (b) box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
  }
  const tracks = made.map((c) => makeTrack(c.name, [c])).reverse();
  const group = makeContent('group', at, dur, { name: entry.name, tracks });
  const cx = box ? (box[0] + box[2]) / 2 : 0, cy = box ? (box[1] + box[3]) / 2 : 0;
  group.pivot = { x: +cx.toFixed(2), y: +(stands ? (floor as number) - H / 2 : cy).toFixed(2) };
  return group;
}

/** Adds a starter prop to the open movie at the Playhead on a new track above the others, selected, as one undo step
 *  'Add Prop'. Answers whether it was added; a prop that cannot be read throws and the movie is left as it was. */
export async function addPropToMovie(engine: Engine, entry: PropEntry, name: string = entry.name): Promise<boolean> {
  if (!engine.movie) return false;
  const text = await propText(entry);
  let id = '';
  const ok = engine.run('Add Prop', (m) => {
    const at = Math.max(0, Math.min(engine.frame, m.duration - 1));
    const c = { ...propContent(text, entry, m, at), name };
    id = c.id;
    const added = ops.addTrack(m, 0, name);
    return { movie: ops.placeContent(added.movie, added.track.id, c).movie, select: [id] };
  });
  return ok && !!id;
}

/** Warms the file of a prop the pointer rests on, so its click lands at once. */
export function prefetchProp(entry: PropEntry): void { void propText(entry).catch(() => undefined); }
