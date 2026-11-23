import { describe, expect, it } from 'vitest';
import { canSplitLayers, layersToTracks } from '@src/engine/layer-split-ops';
import { content, drawingLayer, newMovie, track } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import type { Content, Movie } from '@src/engine/types';

function drawing(): Content {
  const base = { ...drawingLayer('Ink'), opacity: 0.5 };
  const top = { ...drawingLayer('Shade'), visible: false, blend: 'multiply' as const };
  const clip = { ...drawingLayer('Glow'), clipping: true };
  const d = content('drawing', 12, 30, { id: 'd1', layers: [base, top, clip], opacity: 0.8, offset: 3 });
  d.transform = { ...d.transform, x: 40, rotation: 15 };
  return d;
}

function movie(extra: Content[] = []): Movie {
  const m = newMovie();
  m.tracks = [track('Below', [content('image', 0, 5, { id: 'img' })]), track('Host', [drawing(), ...extra])];
  return m;
}

describe('convert layers to tracks', () => {
  it('needs a drawing with at least two separable layers', () => {
    expect(canSplitLayers(drawing())).toBe(true);
    expect(canSplitLayers(content('drawing', 0, 5))).toBe(false);
    expect(canSplitLayers(content('image', 0, 5, { layers: drawing().layers }))).toBe(false);
    const a = drawingLayer('A');
    const clipped = { ...drawingLayer('B'), clipping: true };
    expect(canSplitLayers(content('drawing', 0, 5, { layers: [a, clipped] }))).toBe(false);
  });

  it('refuses missing content, other kinds and a single layer', () => {
    const m = movie([content('drawing', 60, 5, { id: 'single' })]);
    expect(() => layersToTracks(m, 'gone')).toThrow(OpError);
    expect(() => layersToTracks(m, 'img')).toThrow(OpError);
    expect(() => layersToTracks(m, 'single')).toThrow(OpError);
  });

  it('replaces an emptied host track with one track per layer, bottom first', () => {
    const m = movie();
    const out = layersToTracks(m, 'd1');
    expect(out.ids).toHaveLength(2);
    expect(out.movie.tracks.map((t) => t.name)).toEqual(['Below', 'Ink', 'Shade']);
    expect(out.movie.tracks[1].content[0].id).toBe(out.ids[0]);
    expect(out.movie.tracks[2].content[0].id).toBe(out.ids[1]);
    expect(m.tracks).toHaveLength(2);
    expect(m.tracks[1].content[0].id).toBe('d1');
  });

  it('keeps the span, offset and transform on every piece', () => {
    const out = layersToTracks(movie(), 'd1');
    for (const t of out.movie.tracks.slice(1)) {
      const c = t.content[0];
      expect(c.kind).toBe('drawing');
      expect([c.start, c.duration, c.offset]).toEqual([12, 30, 3]);
      expect(c.transform).toMatchObject({ x: 40, rotation: 15 });
    }
  });

  it('moves the layer opacity, blend and visibility up to the content and its track', () => {
    const out = layersToTracks(movie(), 'd1');
    const [ink, shade] = out.movie.tracks.slice(1);
    expect(ink.content[0].opacity).toBeCloseTo(0.4, 10);
    expect(ink.content[0].layers[0].opacity).toBe(1);
    expect(ink.hidden).toBe(false);
    expect(shade.hidden).toBe(true);
    expect(shade.content[0].blend).toBe('multiply');
    expect(shade.content[0].layers[0]).toMatchObject({ visible: true, blend: 'normal' });
  });

  it('keeps a clipped layer with its base and gives every layer a new id', () => {
    const src = drawing();
    const out = layersToTracks(movie(), 'd1');
    const shade = out.movie.tracks[2].content[0];
    expect(shade.layers.map((l) => l.name)).toEqual(['Shade', 'Glow']);
    expect(shade.layers[1].clipping).toBe(true);
    const made = out.movie.tracks.slice(1).flatMap((t) => t.content[0].layers.map((l) => l.id));
    expect(new Set(made).size).toBe(3);
    for (const l of src.layers) expect(made).not.toContain(l.id);
  });

  it('keeps a host track that still holds other content and adds the new tracks above it', () => {
    const out = layersToTracks(movie([content('image', 60, 5, { id: 'other' })]), 'd1');
    expect(out.movie.tracks.map((t) => t.name)).toEqual(['Below', 'Host', 'Ink', 'Shade']);
    expect(out.movie.tracks[1].content.map((c) => c.id)).toEqual(['other']);
  });

  it('hides every new track when the host track was hidden', () => {
    const m = movie();
    m.tracks[1].hidden = true;
    const out = layersToTracks(m, 'd1');
    expect(out.movie.tracks.slice(1).every((t) => t.hidden)).toBe(true);
  });

  it('points followers of the drawing at its bottom piece, inside groups too', () => {
    const m = movie();
    const inner = content('image', 0, 5, { id: 'inner', parent: 'd1' });
    m.tracks[0].content.push(content('image', 20, 5, { id: 'child', parent: 'd1' }));
    m.tracks[0].content.push(content('group', 40, 5, { id: 'grp', tracks: [track('In', [inner])] }));
    const out = layersToTracks(m, 'd1');
    const below = out.movie.tracks[0].content;
    expect(below.find((c) => c.id === 'child')?.parent).toBe(out.ids[0]);
    expect(below.find((c) => c.id === 'grp')?.tracks[0].content[0].parent).toBe(out.ids[0]);
    expect(below.find((c) => c.id === 'img')?.parent).toBeUndefined();
  });

  it('copies the keys so the pieces do not share them', () => {
    const m = movie();
    m.tracks[1].content[0].keys = [{ kind: 'move', expanded: false, options: {}, channels: { x: [{ frame: 0, value: 1, ease: 'linear' }] } }];
    const out = layersToTracks(m, 'd1');
    const [p, q] = out.movie.tracks.slice(1).map((t) => t.content[0]);
    expect(p.keys).toEqual(m.tracks[1].content[0].keys);
    expect(p.keys).not.toBe(q.keys);
    expect(p.keys[0].channels.x).not.toBe(m.tracks[1].content[0].keys[0].channels.x);
  });
});
