import { describe, expect, it } from 'vitest';
import { boxOf, frameLines, snapAngle, snapBox } from '@src/ui/stage-snap';

describe('snapBox', () => {
  it('shifts the left edge onto a near line and reports the guide', () => {
    const s = snapBox({ l: 10, t: 200, r: 30, b: 220 }, [0, 100], [], 15);
    expect(s.dx).toBe(-10);
    expect(s.gx).toBe(0);
  });

  it('snaps the centre when the centre is the closest point to a line', () => {
    const s = snapBox({ l: 8, t: 0, r: 50, b: 10 }, [0, 30], [], 5);
    expect(s.dx).toBe(1);
    expect(s.gx).toBe(30);
  });

  it('snaps the right edge onto a line', () => {
    const s = snapBox({ l: 0, t: 0, r: 97, b: 10 }, [100], [], 5);
    expect(s.dx).toBe(3);
    expect(s.gx).toBe(100);
  });

  it('prefers the nearest of several candidate lines', () => {
    const s = snapBox({ l: 50, t: 0, r: 60, b: 10 }, [46, 52], [], 10);
    expect(s.dx).toBe(2);
    expect(s.gx).toBe(52);
  });

  it('snaps when the distance equals the tolerance exactly', () => {
    const s = snapBox({ l: 10, t: 0, r: 20, b: 10 }, [5], [], 5);
    expect(s.dx).toBe(-5);
    expect(s.gx).toBe(5);
  });

  it('leaves the box alone with null guides when no line is within tolerance', () => {
    const s = snapBox({ l: 40, t: 40, r: 60, b: 60 }, [0, 100], [0, 100], 5);
    expect(s).toEqual({ dx: 0, dy: 0, gx: null, gy: null });
  });

  it('leaves the box alone when there are no lines at all', () => {
    expect(snapBox({ l: 1, t: 2, r: 3, b: 4 }, [], [], 100)).toEqual({ dx: 0, dy: 0, gx: null, gy: null });
  });

  it('snaps the vertical axis independently of the horizontal one', () => {
    const s = snapBox({ l: 40, t: 48, r: 60, b: 68 }, [0], [50, 100], 4);
    expect(s.dx).toBe(0);
    expect(s.gx).toBeNull();
    expect(s.dy).toBe(2);
    expect(s.gy).toBe(50);
  });

  it('snaps the bottom edge with a positive shift', () => {
    const s = snapBox({ l: 0, t: 0, r: 10, b: 97 }, [], [100], 4);
    expect(s.dy).toBe(3);
    expect(s.gy).toBe(100);
  });

  it('never snaps with a zero tolerance unless a point lies exactly on a line', () => {
    expect(snapBox({ l: 1, t: 0, r: 9, b: 10 }, [0], [], 0).gx).toBeNull();
    expect(snapBox({ l: 0, t: 0, r: 9, b: 10 }, [0], [0], 0)).toEqual({ dx: 0, dy: 0, gx: 0, gy: 0 });
  });
});

describe('frameLines', () => {
  it('gives the edges, quadrants and centre of the movie frame', () => {
    expect(frameLines(200, 100)).toEqual({ xs: [0, 50, 100, 150, 200], ys: [0, 25, 50, 75, 100] });
  });

  it('gives fractional quadrant lines for odd sizes', () => {
    expect(frameLines(10, 6).xs).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(frameLines(10, 6).ys).toEqual([0, 1.5, 3, 4.5, 6]);
  });

  it('lets a box centred on the frame snap to the centre lines', () => {
    const { xs, ys } = frameLines(1920, 1080);
    const s = snapBox({ l: 900, t: 480, r: 1022, b: 602 }, xs, ys, 4);
    expect(s.gx).toBe(960);
    expect(s.gy).toBe(540);
    expect(s.dx).toBe(-1);
    expect(s.dy).toBe(-1);
  });
});

describe('boxOf', () => {
  it('bounds a set of points', () => {
    expect(boxOf([[1, 5], [-3, 2], [4, -1]])).toEqual({ l: -3, t: -1, r: 4, b: 5 });
  });

  it('collapses to a point for a single point', () => {
    expect(boxOf([[7, 8]])).toEqual({ l: 7, t: 8, r: 7, b: 8 });
  });

  it('gives an inverted infinite box for no points', () => {
    expect(boxOf([])).toEqual({ l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });
  });
});

describe('snapAngle', () => {
  it('rounds to the nearest 15 degree step', () => {
    expect(snapAngle(22, 15)).toBe(15);
    expect(snapAngle(23, 15)).toBe(30);
  });

  it('rounds to the nearest 30 degree step', () => {
    expect(snapAngle(100, 30)).toBe(90);
    expect(snapAngle(106, 30)).toBe(120);
  });

  it('rounds negative angles to the nearest step', () => {
    expect(snapAngle(-50, 30)).toBe(-60);
    expect(snapAngle(-40, 30)).toBe(-30);
  });

  it('keeps an angle already on a step', () => {
    expect(snapAngle(345, 15)).toBe(345);
    expect(snapAngle(0, 30)).toBe(0);
  });
});
