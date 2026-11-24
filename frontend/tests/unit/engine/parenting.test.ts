import { describe, expect, it } from 'vitest';
import { content, newMovie, track } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import { setParent, unparent } from '@src/engine/parenting';
import { findContent, worldMatrix } from '@src/engine/transform';
import type { Content, Movie } from '@src/engine/types';

function scene(): { movie: Movie; a: Content; b: Content; c: Content } {
  const a = content('drawing', 0, 50);
  const b = content('drawing', 0, 50);
  const c = content('drawing', 0, 50);
  a.transform = { ...a.transform, x: 120, y: -40, rotation: 30, scale: 2 };
  b.transform = { ...b.transform, x: -60, y: 75, rotation: 10, scale: 0.5 };
  const movie = { ...newMovie(), duration: 100, tracks: [track('A', [a]), track('B', [b]), track('C', [c])] };
  return { movie, a, b, c };
}

function expectSamePose(before: Movie, after: Movie, id: string, frame: number): void {
  const m1 = worldMatrix(before, findContent(before, id) as Content, frame);
  const m2 = worldMatrix(after, findContent(after, id) as Content, frame);
  m1.forEach((v, i) => expect(m2[i]).toBeCloseTo(v, 1));
}

describe('setParent', () => {
  it('links the child and leaves the input movie alone', () => {
    const { movie, a, b } = scene();
    const out = setParent(movie, b.id, a.id);
    expect(findContent(out, b.id)?.parent).toBe(a.id);
    expect(findContent(movie, b.id)?.parent).toBeUndefined();
    expect(out.tracks[0]).toBe(movie.tracks[0]);
  });

  it('refuses itself, missing content and a loop', () => {
    const { movie, a, b, c } = scene();
    expect(() => setParent(movie, a.id, a.id)).toThrow(OpError);
    expect(() => setParent(movie, a.id, 'nope')).toThrow(OpError);
    const chain = setParent(setParent(movie, b.id, a.id), c.id, b.id);
    expect(() => setParent(chain, a.id, c.id)).toThrow(OpError);
  });

  it('keeps the pose the child shows at the given frame', () => {
    const { movie, a, b } = scene();
    const out = setParent(movie, b.id, a.id, 10);
    expect(findContent(out, b.id)?.parent).toBe(a.id);
    expect(findContent(out, b.id)?.transform.x).not.toBe(b.transform.x);
    expectSamePose(movie, out, b.id, 10);
  });
});

describe('unparent', () => {
  it('returns the same movie for content without a parent and refuses missing content', () => {
    const { movie, a } = scene();
    expect(unparent(movie, a.id, 0)).toBe(movie);
    expect(() => unparent(movie, 'nope', 0)).toThrow(OpError);
  });

  it('removes the link and bakes the pose so the content stays where it showed', () => {
    const { movie, a, b } = scene();
    const linked = setParent(movie, b.id, a.id);
    const out = unparent(linked, b.id, 5);
    expect('parent' in (findContent(out, b.id) as Content)).toBe(false);
    expectSamePose(linked, out, b.id, 5);
  });

  it('returns to the original numbers after a pose-keeping link and unlink', () => {
    const { movie, a, b } = scene();
    const back = unparent(setParent(movie, b.id, a.id, 0), b.id, 0);
    const t = (findContent(back, b.id) as Content).transform;
    expect(t.x).toBeCloseTo(-60, 0);
    expect(t.y).toBeCloseTo(75, 0);
    expect(t.rotation).toBeCloseTo(10, 0);
    expect(t.scale).toBeCloseTo(0.5, 2);
  });
});
