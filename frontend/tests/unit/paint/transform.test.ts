import { describe, expect, it } from 'vitest';
import {
  autoTangents, bendFor, bendHandles, homography, makeGrid, nudgePoints, refineGrid, refineGridBent, resampleGrid,
  sampleRaster, transformAffine, transformMesh, transformQuad, zeroBends,
} from '@src/paint/transform';
import type { Point, Raster } from '@src/paint/types';

function raster(w: number, h: number, px: number[][] = []): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  px.forEach((p, i) => data.set(p, i * 4));
  return { width: w, height: h, data };
}
const at = (r: Raster, x: number, y: number): number[] => Array.from(r.data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4));
const RED = [255, 0, 0, 255], GREEN = [0, 255, 0, 255], BLUE = [0, 0, 255, 255], WHITE = [255, 255, 255, 255];
const four = (): Raster => raster(2, 2, [RED, GREEN, BLUE, WHITE]);
const apply = (h: number[], p: Point): Point => {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
};

describe('sampling', () => {
  it('reads the covering pixel with nearest sampling and clear outside', () => {
    const out = new Uint8ClampedArray(8);
    sampleRaster(four(), 1.9, 0.1, 'nearest', out, 4);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, ...GREEN]);
    out.fill(9);
    sampleRaster(four(), -0.1, 0.5, 'nearest', out, 0);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 0]);
    sampleRaster(four(), 0.5, 2, 'nearest', out, 4);
    expect(Array.from(out.slice(4))).toEqual([0, 0, 0, 0]);
  });

  it('returns the exact pixel at a pixel centre for the smooth samplers', () => {
    const out = new Uint8ClampedArray(4);
    sampleRaster(four(), 1.5, 0.5, 'bilinear', out, 0);
    expect(Array.from(out)).toEqual(GREEN);
    sampleRaster(four(), 0.5, 1.5, 'bicubic', out, 0);
    expect(Array.from(out)).toEqual(BLUE);
  });

  it('averages two opaque neighbours halfway between them', () => {
    const out = new Uint8ClampedArray(4);
    sampleRaster(raster(2, 1, [[200, 0, 100, 255], [100, 50, 0, 255]]), 1, 0.5, 'bilinear', out, 0);
    expect(Array.from(out)).toEqual([150, 25, 50, 255]);
  });

  it('does not darken a soft edge next to a clear pixel', () => {
    const out = new Uint8ClampedArray(4);
    sampleRaster(raster(2, 1, [RED, [0, 0, 0, 0]]), 1, 0.5, 'bilinear', out, 0);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
    expect(out[3]).toBeGreaterThanOrEqual(127);
    expect(out[3]).toBeLessThanOrEqual(128);
  });

  it('fades to clear past the edge of the raster', () => {
    const out = new Uint8ClampedArray(4).fill(7);
    sampleRaster(four(), -3, -3, 'bilinear', out, 0);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
    out.fill(7);
    sampleRaster(four(), 9, 9, 'bicubic', out, 0);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });
});

describe('affine draw', () => {
  it('copies the source at a whole pixel offset', () => {
    const dst = raster(5, 5);
    const box = transformAffine(four(), [1, 0, 0, 1, 1, 2], dst, 'nearest')!;
    expect(at(dst, 1, 2)).toEqual(RED);
    expect(at(dst, 2, 2)).toEqual(GREEN);
    expect(at(dst, 1, 3)).toEqual(BLUE);
    expect(at(dst, 2, 3)).toEqual(WHITE);
    expect(dst.data.filter((v, i) => i % 4 === 3 && v > 0)).toHaveLength(4);
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.y).toBeLessThanOrEqual(2);
    expect(box.x + box.w).toBeGreaterThanOrEqual(3);
    expect(box.y + box.h).toBeGreaterThanOrEqual(4);
  });

  it('gives the same exact copy with bilinear sampling at a whole pixel offset', () => {
    const dst = raster(5, 5);
    transformAffine(four(), [1, 0, 0, 1, 2, 1], dst, 'bilinear');
    expect(at(dst, 2, 1)).toEqual(RED);
    expect(at(dst, 3, 2)).toEqual(WHITE);
    expect(at(dst, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('doubles each pixel into a block when scaled by two', () => {
    const dst = raster(4, 4);
    transformAffine(four(), [2, 0, 0, 2, 0, 0], dst, 'nearest');
    expect(at(dst, 0, 0)).toEqual(RED);
    expect(at(dst, 1, 1)).toEqual(RED);
    expect(at(dst, 2, 1)).toEqual(GREEN);
    expect(at(dst, 1, 2)).toEqual(BLUE);
    expect(at(dst, 3, 3)).toEqual(WHITE);
  });

  it('mirrors the source with a negative scale', () => {
    const dst = raster(2, 2);
    transformAffine(four(), [-1, 0, 0, 1, 2, 0], dst, 'nearest');
    expect(at(dst, 0, 0)).toEqual(GREEN);
    expect(at(dst, 1, 0)).toEqual(RED);
    expect(at(dst, 0, 1)).toEqual(WHITE);
  });

  it('averages the source when shrinking heavily', () => {
    const src = raster(4, 4, Array.from({ length: 16 }, (_, i) => ((i % 4) + Math.floor(i / 4)) % 2 ? [0, 0, 0, 255] : WHITE));
    const dst = raster(1, 1);
    transformAffine(src, [0.25, 0, 0, 0.25, 0, 0], dst, 'bilinear');
    const p = at(dst, 0, 0);
    expect(p[3]).toBe(255);
    expect(p[0]).toBeGreaterThanOrEqual(127);
    expect(p[0]).toBeLessThanOrEqual(128);
  });

  it('blends a half clear sample over what is already there', () => {
    const dst = raster(1, 1, [BLUE]);
    transformAffine(raster(1, 1, [[255, 0, 0, 128]]), [1, 0, 0, 1, 0, 0], dst, 'nearest');
    expect(at(dst, 0, 0)).toEqual([128, 0, 127, 255]);
  });

  it('leaves the destination alone under a clear source', () => {
    const dst = raster(2, 2, [BLUE, BLUE, BLUE, BLUE]);
    transformAffine(raster(2, 2), [1, 0, 0, 1, 0, 0], dst, 'bilinear');
    expect(at(dst, 1, 1)).toEqual(BLUE);
  });

  it('draws only inside the limiting rectangle', () => {
    const dst = raster(4, 4);
    const box = transformAffine(four(), [2, 0, 0, 2, 0, 0], dst, 'nearest', { x: 2, y: 0, w: 2, h: 2 });
    expect(box).toEqual({ x: 2, y: 0, w: 2, h: 2 });
    expect(at(dst, 2, 1)).toEqual(GREEN);
    expect(at(dst, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(at(dst, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('refuses a collapsed matrix, an empty source and a piece that misses the destination', () => {
    const dst = raster(4, 4);
    expect(transformAffine(four(), [1, 2, 2, 4, 0, 0], dst, 'bilinear')).toBeNull();
    expect(transformAffine(raster(0, 3), [1, 0, 0, 1, 0, 0], dst, 'bilinear')).toBeNull();
    expect(transformAffine(four(), [1, 0, 0, 1, 50, 50], dst, 'nearest')).toBeNull();
    expect(Array.from(dst.data).every((v) => v === 0)).toBe(true);
  });
});

describe('perspective', () => {
  const unit: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

  it('solves the identity for matching points', () => {
    const h = homography(unit, unit)!;
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(h[i]).toBeCloseTo(v, 9));
  });

  it('maps each of the four points onto its target', () => {
    const to: Point[] = [{ x: 10, y: 12 }, { x: 90, y: 4 }, { x: 110, y: 95 }, { x: -5, y: 70 }];
    const h = homography(unit, to)!;
    expect(h).toHaveLength(9);
    unit.forEach((p, i) => {
      const q = apply(h, p);
      expect(q.x).toBeCloseTo(to[i].x, 7);
      expect(q.y).toBeCloseTo(to[i].y, 7);
    });
  });

  it('is undone by the homography in the other direction', () => {
    const to: Point[] = [{ x: 10, y: 12 }, { x: 90, y: 4 }, { x: 110, y: 95 }, { x: -5, y: 70 }];
    const f = homography(unit, to)!, b = homography(to, unit)!;
    const q = apply(b, apply(f, { x: 0.3, y: 0.8 }));
    expect(q.x).toBeCloseTo(0.3, 7);
    expect(q.y).toBeCloseTo(0.8, 7);
  });

  it('refuses too few points and points on one line', () => {
    expect(homography(unit.slice(0, 3), unit)).toBeNull();
    const line: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    expect(homography(line, unit)).toBeNull();
  });

  it('copies the source into a quad of the same size', () => {
    const dst = raster(5, 5);
    const box = transformQuad(four(), [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }], dst, 'nearest');
    expect(box).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(at(dst, 1, 1)).toEqual(RED);
    expect(at(dst, 2, 1)).toEqual(GREEN);
    expect(at(dst, 1, 2)).toEqual(BLUE);
    expect(at(dst, 2, 2)).toEqual(WHITE);
    expect(at(dst, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(dst, 3, 3)).toEqual([0, 0, 0, 0]);
  });

  it('refuses an empty source and a quad outside the destination', () => {
    const q: [Point, Point, Point, Point] = [{ x: 40, y: 40 }, { x: 50, y: 40 }, { x: 50, y: 50 }, { x: 40, y: 50 }];
    expect(transformQuad(raster(0, 0), q, raster(4, 4), 'bilinear')).toBeNull();
    expect(transformQuad(four(), q, raster(4, 4), 'bilinear')).toBeNull();
  });
});

describe('mesh warp', () => {
  it('copies the source through an undistorted grid', () => {
    const dst = raster(5, 5);
    const grid = [[{ x: 1, y: 1 }, { x: 3, y: 1 }], [{ x: 1, y: 3 }, { x: 3, y: 3 }]];
    expect(transformMesh(four(), grid, dst, 'nearest')).not.toBeNull();
    expect(at(dst, 1, 1)).toEqual(RED);
    expect(at(dst, 2, 1)).toEqual(GREEN);
    expect(at(dst, 1, 2)).toEqual(BLUE);
    expect(at(dst, 2, 2)).toEqual(WHITE);
    expect(dst.data.filter((v, i) => i % 4 === 3 && v > 0)).toHaveLength(4);
  });

  it('refuses a grid with fewer than two rows or columns', () => {
    expect(transformMesh(four(), [[{ x: 0, y: 0 }, { x: 1, y: 0 }]], raster(4, 4), 'bilinear')).toBeNull();
    expect(transformMesh(four(), [[{ x: 0, y: 0 }], [{ x: 0, y: 1 }]], raster(4, 4), 'bilinear')).toBeNull();
    expect(transformMesh(four(), [], raster(4, 4), 'bilinear')).toBeNull();
  });
});

describe('control grids', () => {
  const quad: Point[] = [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 60 }, { x: 0, y: 60 }];

  it('lays an even grid over a quad', () => {
    const g = makeGrid(quad, 4);
    expect(g).toHaveLength(4);
    expect(g[0]).toHaveLength(4);
    expect(g[0][0]).toEqual({ x: 0, y: 0 });
    expect(g[0][3]).toEqual({ x: 90, y: 0 });
    expect(g[3][3]).toEqual({ x: 90, y: 60 });
    expect(g[3][0]).toEqual({ x: 0, y: 60 });
    expect(g[1][2].x).toBeCloseTo(60, 9);
    expect(g[1][2].y).toBeCloseTo(20, 9);
  });

  it('makes independent zero bends', () => {
    const b = zeroBends(3, 5);
    expect(b).toHaveLength(3);
    expect(b[0]).toHaveLength(5);
    b[0][0].u.x = 9;
    expect(b[0][1].u.x).toBe(0);
    expect(b[1][0].u.x).toBe(0);
    expect(b[2][4]).toEqual({ u: { x: 0, y: 0 }, v: { x: 0, y: 0 } });
  });

  it('copies the grid when refining by one', () => {
    const g = makeGrid(quad, 4);
    const r = refineGrid(g, 1);
    expect(r).toEqual(g);
    expect(r[0][0]).not.toBe(g[0][0]);
  });

  it('subdivides each cell and keeps the original nodes', () => {
    const g = makeGrid(quad, 4);
    g[1][1] = { x: 40, y: 31 };
    g[2][2] = { x: 55, y: 35 };
    const r = refineGrid(g, 3);
    expect(r).toHaveLength(10);
    expect(r[0]).toHaveLength(10);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      expect(r[i * 3][j * 3].x).toBeCloseTo(g[i][j].x, 9);
      expect(r[i * 3][j * 3].y).toBeCloseTo(g[i][j].y, 9);
    }
  });

  it('keeps an even grid even in its inner cells', () => {
    const r = refineGrid(makeGrid(quad, 4), 2);
    expect(r[3][3].x).toBeCloseTo(45, 9);
    expect(r[3][3].y).toBeCloseTo(30, 9);
  });

  it('matches the plain refinement when every bend is zero or absent', () => {
    const g = makeGrid(quad, 4);
    g[1][2] = { x: 70, y: 12 };
    const plain = refineGrid(g, 4);
    expect(refineGridBent(g, null, 4)).toEqual(plain);
    const bent = refineGridBent(g, zeroBends(4, 4), 4);
    expect(bent).toHaveLength(plain.length);
    bent.forEach((row, i) => row.forEach((p, j) => {
      expect(p.x).toBeCloseTo(plain[i][j].x, 9);
      expect(p.y).toBeCloseTo(plain[i][j].y, 9);
    }));
  });

  it('bends the surface between nodes without moving the nodes', () => {
    const g = makeGrid(quad, 4);
    const bend = zeroBends(4, 4);
    bend[1][1].u = { x: 0, y: 30 };
    const plain = refineGrid(g, 4), bent = refineGridBent(g, bend, 4);
    expect(bent[4][4].x).toBeCloseTo(plain[4][4].x, 9);
    expect(bent[4][4].y).toBeCloseTo(plain[4][4].y, 9);
    expect(Math.abs(bent[4][6].y - plain[4][6].y)).toBeGreaterThan(1);
  });

  it('copies the grid when resampling to the same density', () => {
    const g = makeGrid(quad, 4);
    const r = resampleGrid(g, 4);
    expect(r).toEqual(g);
    expect(r[2][2]).not.toBe(g[2][2]);
  });

  it('keeps the corners when the density changes', () => {
    const g = makeGrid(quad, 4);
    g[1][1] = { x: 35, y: 28 };
    const r = resampleGrid(g, 6);
    expect(r).toHaveLength(6);
    expect(r[0]).toHaveLength(6);
    expect(r[0][0].x).toBeCloseTo(0, 9);
    expect(r[0][5].x).toBeCloseTo(90, 9);
    expect(r[5][5].y).toBeCloseTo(60, 9);
    expect(r[5][0].y).toBeCloseTo(60, 9);
  });

  it('takes half the neighbour distance as the automatic tangent', () => {
    const g = makeGrid(quad, 4);
    const mid = autoTangents(g, 1, 1);
    expect(mid.u.x).toBeCloseTo(30, 9);
    expect(mid.u.y).toBeCloseTo(0, 9);
    expect(mid.v.x).toBeCloseTo(0, 9);
    expect(mid.v.y).toBeCloseTo(20, 9);
    const corner = autoTangents(g, 0, 0);
    expect(corner.u.x).toBeCloseTo(15, 9);
    expect(corner.v.y).toBeCloseTo(10, 9);
  });

  it('places handles one tangent out from the node plus its bend', () => {
    const g = makeGrid(quad, 4);
    const bend = zeroBends(4, 4);
    bend[1][1].u = { x: 3, y: -4 };
    const plain = bendHandles(g, null, 1, 1), bent = bendHandles(g, bend, 1, 1);
    expect(plain.u.x).toBeCloseTo(60, 9);
    expect(plain.u.y).toBeCloseTo(20, 9);
    expect(plain.v.x).toBeCloseTo(30, 9);
    expect(plain.v.y).toBeCloseTo(40, 9);
    expect(bent.u.x).toBeCloseTo(63, 9);
    expect(bent.u.y).toBeCloseTo(16, 9);
    expect(bent.v).toEqual(plain.v);
  });

  it('finds the bend that puts a handle at a given place', () => {
    const g = makeGrid(quad, 4);
    g[2][1] = { x: 33, y: 44 };
    const target = { x: 71, y: 52 };
    const bend = zeroBends(4, 4);
    bend[2][1].v = bendFor(g, 2, 1, 'v', target);
    const h = bendHandles(g, bend, 2, 1);
    expect(h.v.x).toBeCloseTo(71, 9);
    expect(h.v.y).toBeCloseTo(52, 9);
  });

  it('nudges points without changing the originals', () => {
    const pts = [{ x: 1, y: 2 }, { x: -3, y: 0 }];
    expect(nudgePoints(pts, 2, -1)).toEqual([{ x: 3, y: 1 }, { x: -1, y: -1 }]);
    expect(pts[0]).toEqual({ x: 1, y: 2 });
  });
});
