import { beforeEach, describe, expect, it } from 'vitest';
import { wetForget, wetIngest, wetMark, wetSample, wetTake } from '@src/paint/wetmap';

let seq = 0;
const fresh = (): string => `f27-layer-${seq++}`;
const W = 128;

function maskWith(pts: Array<[number, number]>, value = 255): Uint8Array {
  const m = new Uint8Array(W * W);
  for (const [x, y] of pts) m[y * W + x] = value;
  return m;
}

beforeEach(() => { wetTake(); });

describe('wet map', () => {
  it('reports nothing wet for a layer that was never washed', () => {
    expect(wetSample(fresh(), W, 0, 0, W, W, 0)).toBeNull();
  });

  it('is fully wet right after a mark and only where the mask was set', () => {
    const id = fresh();
    wetMark(id, W, 0, 0, W, W, maskWith([[5, 7], [100, 90]]), 128, 1000, 2);
    const s = wetSample(id, W, 0, 0, W, W, 1000)!;
    expect(s.length).toBe(W * W);
    expect(s[7 * W + 5]).toBe(1);
    expect(s[90 * W + 100]).toBe(1);
    expect(s.reduce((a, v) => a + v, 0)).toBe(2);
  });

  it('fades linearly over the last four seconds and then is dry', () => {
    const id = fresh();
    wetMark(id, W, 0, 0, W, W, maskWith([[5, 7]]), 128, 1000, 2);
    expect(wetSample(id, W, 0, 0, W, W, 3000)![7 * W + 5]).toBe(1);
    expect(wetSample(id, W, 0, 0, W, W, 5000)![7 * W + 5]).toBeCloseTo(0.5, 6);
    expect(wetSample(id, W, 0, 0, W, W, 6000)![7 * W + 5]).toBeCloseTo(0.25, 6);
    expect(wetSample(id, W, 0, 0, W, W, 7000)).toBeNull();
    expect(wetSample(id, W, 0, 0, W, W, 99000)).toBeNull();
  });

  it('ignores mask values below the minimum', () => {
    const id = fresh();
    wetMark(id, W, 0, 0, W, W, maskWith([[5, 7]], 100), 128, 0, 2);
    expect(wetSample(id, W, 0, 0, W, W, 0)).toBeNull();
  });

  it('indexes the sample relative to the requested rectangle across tiles', () => {
    const id = fresh();
    wetMark(id, W, 0, 0, W, W, maskWith([[65, 62], [61, 66]]), 1, 0, 1);
    const s = wetSample(id, W, 60, 60, 70, 70, 0)!;
    expect(s.length).toBe(100);
    expect(s[2 * 10 + 5]).toBe(1);
    expect(s[6 * 10 + 1]).toBe(1);
    expect(s.reduce((a, v) => a + v, 0)).toBe(2);
    expect(wetSample(id, W, 0, 0, 20, 20, 0)).toBeNull();
  });

  it('never shortens the drying time with a later shorter mark', () => {
    const id = fresh();
    const m = maskWith([[5, 7]]);
    wetMark(id, W, 0, 0, W, W, m, 128, 0, 5);
    wetMark(id, W, 0, 0, W, W, m, 128, 0, 1);
    expect(wetSample(id, W, 0, 0, W, W, 7000)![7 * W + 5]).toBeCloseTo(0.5, 6);
  });

  it('extends the drying time with a later longer mark', () => {
    const id = fresh();
    const m = maskWith([[5, 7]]);
    wetMark(id, W, 0, 0, W, W, m, 128, 0, 1);
    wetMark(id, W, 0, 0, W, W, m, 128, 4000, 1);
    expect(wetSample(id, W, 0, 0, W, W, 5000)![7 * W + 5]).toBe(1);
  });

  it('marks only the rows each column reached when column spans are given', () => {
    const id = fresh();
    const m = new Uint8Array(W * W).fill(255);
    const top = new Int32Array([10, 0]), bot = new Int32Array([20, 0]);
    wetMark(id, W, 0, 0, W, W, m, 128, 0, 1, { top, bot });
    const s = wetSample(id, W, 0, 0, W, W, 0)!;
    expect(s[9 * W + 3]).toBe(0);
    expect(s[10 * W + 3]).toBe(1);
    expect(s[19 * W + 63]).toBe(1);
    expect(s[20 * W + 3]).toBe(0);
    expect(s[15 * W + 64]).toBe(0);
    expect(s.reduce((a, v) => a + v, 0)).toBe(640);
  });

  it('forgets a layer on request', () => {
    const id = fresh();
    wetMark(id, W, 0, 0, W, W, maskWith([[1, 1]]), 128, 0, 5);
    wetForget(id);
    expect(wetSample(id, W, 0, 0, W, W, 0)).toBeNull();
  });

  it('drops the map when the layer width changes', () => {
    const id = fresh();
    wetMark(id, W, 0, 0, W, W, maskWith([[1, 1]]), 128, 0, 5);
    expect(wetSample(id, 512, 0, 0, 64, 64, 0)).toBeNull();
    expect(wetSample(id, W, 0, 0, W, W, 0)).toBeNull();
  });

  it('keeps maps for only the most recent layers', () => {
    const first = fresh();
    const m = maskWith([[1, 1]]);
    wetMark(first, W, 0, 0, W, W, m, 128, 0, 5);
    let last = first;
    for (let i = 0; i < 24; i++) { last = fresh(); wetMark(last, W, 0, 0, W, W, m, 128, 0, 5); }
    expect(wetSample(first, W, 0, 0, W, W, 0)).toBeNull();
    expect(wetSample(last, W, 0, 0, W, W, 0)).not.toBeNull();
  });
});

describe('wet records between threads', () => {
  it('hands over each mark once as packed bits', () => {
    const id = fresh();
    wetMark(id, W, 0, 0, 16, 2, maskWith([[0, 0], [9, 0], [3, 1]]), 128, 250, 3);
    const recs = wetTake();
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ id, w: W, x0: 0, y0: 0, x1: 16, y1: 2, tMs: 250, seconds: 3 });
    expect(Array.from(recs[0].bits)).toEqual([1, 2, 8, 0]);
    expect(wetTake()).toEqual([]);
  });

  it('keeps only the eight newest unsent marks', () => {
    const id = fresh();
    const m = maskWith([[1, 1]]);
    for (let i = 0; i < 11; i++) wetMark(id, W, 0, 0, 8, 8, m, 128, i * 100, 1);
    const recs = wetTake();
    expect(recs).toHaveLength(8);
    expect(recs.map((r) => r.tMs)).toEqual([300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it('replays a record into the same wetness as the original mark', () => {
    const a = fresh(), b = fresh();
    const m = maskWith([[70, 3], [5, 66], [20, 20]]);
    wetMark(a, W, 2, 1, 100, 90, m, 128, 1234, 2.5);
    const recs = wetTake().map((r) => ({ ...r, id: b }));
    wetIngest(recs);
    for (const t of [1234, 5000, 6500]) {
      const sa = wetSample(a, W, 0, 0, W, W, t)!, sb = wetSample(b, W, 0, 0, W, W, t)!;
      expect(sa).not.toBeNull();
      expect(Array.from(sb)).toEqual(Array.from(sa));
    }
  });

  it('does not send replayed marks back', () => {
    const a = fresh();
    wetMark(a, W, 0, 0, 8, 8, maskWith([[1, 1]]), 128, 0, 1);
    wetIngest(wetTake());
    expect(wetTake()).toEqual([]);
  });
});
