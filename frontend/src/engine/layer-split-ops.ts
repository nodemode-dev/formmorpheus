// Convert Layers to Tracks: each visible top-level layer (a group with its members, a clipping layer with its base)
// of a Drawing becomes its own Drawing on a new track. Pure model code: no DOM.
import { content as makeContent, track as makeTrack, uid } from './model';
import { OpError, deleteContent } from './ops';
import type { Content, DrawingLayer, Movie } from './types';

/** Visible bundles, bottom first: a layer plus what hangs on it (group members, layers clipped to it). */
function bundles(layers: DrawingLayer[]): DrawingLayer[][] {
  const out: DrawingLayer[][] = [];
  let i = 0;
  while (i < layers.length) {
    const head = layers[i];
    const bundle = [head];
    i++;
    if (head.group) {
      const inGroup = new Set([head.id]);
      while (i < layers.length && layers[i].parent && inGroup.has(layers[i].parent as string)) {
        inGroup.add(layers[i].id);
        bundle.push(layers[i++]);
      }
    }
    while (i < layers.length && layers[i].clipping && !layers[i].parent && !head.parent) bundle.push(layers[i++]);
    if (head.visible) out.push(bundle);
  }
  return out;
}

/** Whether a Drawing holds at least two separable layers. */
export function canSplitLayers(c: Content): boolean {
  return c.kind === 'drawing' && bundles(c.layers).length >= 2;
}

function fresh(bundle: DrawingLayer[]): DrawingLayer[] {
  const ids = new Map(bundle.map((l) => [l.id, uid('l')]));
  return bundle.map((l, k) => {
    const next: DrawingLayer = { ...l, id: ids.get(l.id)!, visible: true };
    if (l.parent) next.parent = ids.get(l.parent) ?? null;
    if (k === 0) { next.opacity = 1; next.blend = 'normal'; next.clipping = false; }
    return next;
  });
}

/** The Drawing is replaced by one new track per layer (the first track of a movie is its bottom one, as the first layer is), same span, canvas, transform, keys and mask. */
export function layersToTracks(movie: Movie, id: string): { movie: Movie; ids: string[] } {
  const host = movie.tracks.findIndex((t) => t.content.some((c) => c.id === id));
  if (host < 0) throw new OpError('That content no longer exists.');
  const src = movie.tracks[host].content.find((c) => c.id === id) as Content;
  if (src.kind !== 'drawing') throw new OpError('That content is not a drawing.');
  const list = bundles(src.layers);
  if (list.length < 2) throw new OpError('This drawing has only one layer.');
  const ids: string[] = [];
  const made = list.map((bundle) => {
    const head = bundle[0];
    const extra: Partial<Content> = {
      name: head.name, layers: fresh(bundle), offset: src.offset, transform: { ...src.transform },
      opacity: src.opacity * head.opacity, blend: head.blend !== 'normal' ? head.blend : src.blend,
      mask: src.mask, maskInvert: src.maskInvert, highlight: src.highlight,
      keys: JSON.parse(JSON.stringify(src.keys)) as Content['keys'],
    };
    if (src.canvas) extra.canvas = { ...src.canvas };
    if (src.pivot) extra.pivot = { ...src.pivot };
    const d = makeContent('drawing', src.start, src.duration, extra);
    ids.push(d.id);
    return makeTrack(head.name, [d]);
  });
  const stripped = deleteContent(movie, [id]);
  const tracks = [...stripped.tracks];
  const emptyHost = tracks[host] && tracks[host].content.length === 0;
  tracks.splice(host, emptyHost ? 1 : 0, ...made);
  return { movie: { ...stripped, tracks }, ids };
}
