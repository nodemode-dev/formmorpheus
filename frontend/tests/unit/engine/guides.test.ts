import { describe, expect, it } from 'vitest';
import { anyGuide, aspectRect, gridAxis, guideLines, insetRect, tidyGuides, verticalRect, type GuideLine } from '@src/engine/guides';

describe('guide rectangles', () => {
  it('insets a frame by a share of its size on every side', () => {
    const r = insetRect(1000, 500, 0.9);
    expect(r.x0).toBeCloseTo(50);
    expect(r.y0).toBeCloseTo(25);
    expect(r.x1).toBeCloseTo(950);
    expect(r.y1).toBeCloseTo(475);
  });

  it('keeps the whole frame when the share is one', () => {
    expect(insetRect(640, 360, 1)).toEqual({ x0: 0, y0: 0, x1: 640, y1: 360 });
  });

  it('keeps the vertical safe area clear of the four bars', () => {
    const r = verticalRect(1000, 2000);
    expect(r.x0).toBeCloseTo(60);
    expect(r.y0).toBeCloseTo(200);
    expect(r.x1).toBeCloseTo(880);
    expect(r.y1).toBeCloseTo(1600);
  });

  it('centres a square inside a wide frame', () => {
    expect(aspectRect(1920, 1080, 1)).toEqual({ x0: 420, y0: 0, x1: 1500, y1: 1080 });
  });

  it('centres a four by five crop inside a tall frame', () => {
    const r = aspectRect(1080, 1920, 4 / 5);
    expect(r.x0).toBeCloseTo(0);
    expect(r.x1).toBeCloseTo(1080);
    expect(r.y0).toBeCloseTo(285);
    expect(r.y1).toBeCloseTo(1635);
  });
});

describe('gridAxis', () => {
  it('lists a line at every cell including both ends', () => {
    expect(gridAxis(300, 100, 1)).toEqual({ major: [0, 100, 200, 300], minor: [] });
  });

  it('adds the lines between cells and none past the end', () => {
    expect(gridAxis(200, 100, 2)).toEqual({ major: [0, 100, 200], minor: [50, 150] });
  });

  it('never uses a cell smaller than four pixels or fewer than one part', () => {
    expect(gridAxis(8, 1, 0)).toEqual({ major: [0, 4, 8], minor: [] });
  });

  it('draws nothing when the grid would be too dense', () => {
    expect(gridAxis(10000, 4, 1)).toEqual({ major: [], minor: [] });
    expect(gridAxis(1000, 100, 16).major.length).toBeGreaterThan(0);
  });
});

describe('guideLines', () => {
  it('gives no snap lines without guides, when hidden or when snapping is off', () => {
    const lines: GuideLine[] = [{ axis: 'x', at: 10 }];
    expect(guideLines(100, 100, undefined)).toEqual({ xs: [], ys: [] });
    expect(guideLines(100, 100, { lines, hide: true })).toEqual({ xs: [], ys: [] });
    expect(guideLines(100, 100, { lines, snap: false })).toEqual({ xs: [], ys: [] });
  });

  it('sorts dragged lines into their axis', () => {
    const out = guideLines(100, 100, { lines: [{ axis: 'x', at: 10 }, { axis: 'y', at: 20 }, { axis: 'x', at: 30 }] });
    expect(out).toEqual({ xs: [10, 30], ys: [20] });
  });

  it('adds the thirds of the frame', () => {
    const out = guideLines(900, 300, { thirds: true });
    expect(out.xs).toHaveLength(2);
    expect(out.xs[0]).toBeCloseTo(300);
    expect(out.xs[1]).toBeCloseTo(600);
    expect(out.ys[0]).toBeCloseTo(100);
    expect(out.ys[1]).toBeCloseTo(200);
  });

  it('adds both edges of each safe area and crop that is on', () => {
    const out = guideLines(1920, 1080, { titleSafe: true, squareFrame: true });
    expect(out.xs).toHaveLength(4);
    expect(out.xs[0]).toBeCloseTo(96);
    expect(out.xs[1]).toBeCloseTo(1824);
    expect(out.xs.slice(2)).toEqual([420, 1500]);
    expect(out.ys[0]).toBeCloseTo(54);
    expect(out.ys.slice(2)).toEqual([0, 1080]);
  });

  it('uses the default cell size for a grid without one', () => {
    const out = guideLines(250, 100, { grid: true });
    expect(out.xs).toEqual([0, 100, 200]);
    expect(out.ys).toEqual([0, 100]);
  });

  it('uses the stored cell size and parts of a grid', () => {
    const out = guideLines(100, 50, { grid: true, gridSize: 50, gridDiv: 2 });
    expect(out.xs).toEqual([0, 50, 100, 25, 75]);
    expect(out.ys).toEqual([0, 50, 25]);
  });
});

describe('tidyGuides', () => {
  it('stores nothing for no guides or guides that are all off', () => {
    expect(tidyGuides(null)).toBeNull();
    expect(tidyGuides(undefined)).toBeNull();
    expect(tidyGuides({})).toBeNull();
    expect(tidyGuides({ grid: false, snap: true, gridSize: 100, gridDiv: 1, lines: [] })).toBeNull();
  });

  it('keeps the switches that are on', () => {
    expect(tidyGuides({ rulers: true, grid: true, thirds: true, titleSafe: true, actionSafe: true, verticalSafe: true, hide: true }))
      .toEqual({ rulers: true, grid: true, thirds: true, titleSafe: true, actionSafe: true, verticalSafe: true, hide: true });
  });

  it('keeps snapping only when it is turned off', () => {
    expect(tidyGuides({ snap: false })).toEqual({ snap: false });
    expect(tidyGuides({ snap: true, grid: true })).toEqual({ grid: true });
  });

  it('clamps and rounds the grid cell size', () => {
    expect(tidyGuides({ gridSize: 5000 })).toEqual({ gridSize: 2000 });
    expect(tidyGuides({ gridSize: 1 })).toEqual({ gridSize: 4 });
    expect(tidyGuides({ gridSize: 32.4 })).toEqual({ gridSize: 32 });
  });

  it('clamps the grid parts to sixteen', () => {
    expect(tidyGuides({ gridDiv: 40 })).toEqual({ gridDiv: 16 });
    expect(tidyGuides({ gridDiv: 4 })).toEqual({ gridDiv: 4 });
  });

  it('drops malformed lines and keeps at most two hundred', () => {
    const bad = [{ axis: 'z', at: 5 }, { axis: 'x', at: Number.NaN }, { axis: 'y', at: Number.POSITIVE_INFINITY }] as unknown as GuideLine[];
    expect(tidyGuides({ lines: bad })).toBeNull();
    expect(tidyGuides({ lines: [...bad, { axis: 'y', at: -12.5 }] })).toEqual({ lines: [{ axis: 'y', at: -12.5 }] });
    const many: GuideLine[] = Array.from({ length: 260 }, (_, i) => ({ axis: 'x', at: i }));
    const kept = tidyGuides({ lines: many })?.lines ?? [];
    expect(kept).toHaveLength(200);
    expect(kept[199]).toEqual({ axis: 'x', at: 199 });
  });
});

describe('anyGuide', () => {
  it('is false for nothing, for rulers alone and for an empty list of lines', () => {
    expect(anyGuide(undefined)).toBe(false);
    expect(anyGuide({ rulers: true, snap: false })).toBe(false);
    expect(anyGuide({ lines: [] })).toBe(false);
  });

  it('is true for any drawn guide and false again when hidden', () => {
    expect(anyGuide({ grid: true })).toBe(true);
    expect(anyGuide({ portraitFrame: true })).toBe(true);
    expect(anyGuide({ lines: [{ axis: 'y', at: 4 }] })).toBe(true);
    expect(anyGuide({ grid: true, hide: true })).toBe(false);
  });
});
