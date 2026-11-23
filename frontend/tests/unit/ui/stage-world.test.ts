import { describe, expect, it } from 'vitest';
import type { Mat } from '@src/engine/transform';
import type { Movie } from '@src/engine/types';
import { mapPt, stageMovie, unmapPt } from '@src/ui/stage-world';

const movie = (extra: Record<string, unknown>): Movie => ({ width: 640, height: 360, ...extra }) as unknown as Movie;

describe('stageMovie', () => {
  it('returns the same movie when the camera is kept', () => {
    const m = movie({ camera: { x: 1 } });
    expect(stageMovie(m, false)).toBe(m);
  });

  it('returns the same movie when it has no camera', () => {
    const m = movie({});
    expect(stageMovie(m, true)).toBe(m);
  });

  it('drops the camera and keeps everything else when the camera is shown from outside', () => {
    const m = movie({ camera: { x: 1 } });
    const s = stageMovie(m, true) as unknown as Record<string, unknown>;
    expect('camera' in s).toBe(false);
    expect(s.width).toBe(640);
    expect(s.height).toBe(360);
    expect((m as unknown as Record<string, unknown>).camera).toEqual({ x: 1 });
  });

  it('hands back the same stripped movie for the same movie', () => {
    const m = movie({ camera: { x: 1 } });
    expect(stageMovie(m, true)).toBe(stageMovie(m, true));
  });
});

describe('mapPt and unmapPt', () => {
  const s: Mat = [2, 0.5, -1, 3, 10, 20];

  it('passes points through when nothing is above the content', () => {
    expect(mapPt(null, 3, -4)).toEqual([3, -4]);
    expect(unmapPt(null, 3, -4)).toEqual([3, -4]);
  });

  it('maps a point through the matrix', () => {
    expect(mapPt(s, 1, 1)).toEqual([11, 23.5]);
  });

  it('brings a mapped point back to where it started', () => {
    for (const [x, y] of [[0, 0], [7, -3], [-120.5, 44]]) {
      const [sx, sy] = mapPt(s, x, y);
      const [bx, by] = unmapPt(s, sx, sy);
      expect(bx).toBeCloseTo(x, 9);
      expect(by).toBeCloseTo(y, 9);
    }
  });

  it('leaves the point alone when the matrix cannot be inverted', () => {
    expect(unmapPt([0, 0, 0, 0, 5, 5], 8, 9)).toEqual([8, 9]);
  });
});
