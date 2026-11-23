import { describe, expect, it } from 'vitest';
import { fromCentre, toCentre } from '@src/ui/stage-compose';

const close = (got: [number, number], want: [number, number]): void => {
  expect(got[0]).toBeCloseTo(want[0], 9);
  expect(got[1]).toBeCloseTo(want[1], 9);
};

describe('toCentre', () => {
  it('passes the move through when the pivot is the centre', () => {
    expect(toCentre(12, -7, 33, 2, 0.5, 0, 0)).toEqual([12, -7]);
  });

  it('passes the move through for an identity transform whatever the pivot', () => {
    close(toCentre(4, 5, 0, 1, 1, 30, -20), [4, 5]);
  });

  it('adds the lever of a pure scale about the pivot', () => {
    close(toCentre(1, 1, 0, 2, 2, 5, 5), [-4, -4]);
  });

  it('adds the lever of a half turn about the pivot', () => {
    close(toCentre(0, 0, 180, 1, 1, 10, 0), [20, 0]);
  });

  it('adds the lever of a quarter turn about the pivot', () => {
    close(toCentre(0, 0, 90, 1, 1, 10, 0), [10, -10]);
  });

  it('accounts for a horizontal flip', () => {
    close(toCentre(0, 0, 0, -1, 1, 3, 4), [6, 0]);
  });

  it('keeps the drawn picture identical when seen about the centre', () => {
    const rot = 37, mx = 1.5, my = -0.75, px = 12, py = -9, tx = 3, ty = 8;
    const a = (rot * Math.PI) / 180;
    const m = [Math.cos(a) * mx, Math.sin(a) * mx, -Math.sin(a) * my, Math.cos(a) * my];
    const [t0x, t0y] = toCentre(tx, ty, rot, mx, my, px, py);
    for (const [qx, qy] of [[0, 0], [5, -2], [-40, 17]]) {
      const ax = px + tx + m[0] * (qx - px) + m[2] * (qy - py);
      const ay = py + ty + m[1] * (qx - px) + m[3] * (qy - py);
      const bx = t0x + m[0] * qx + m[2] * qy;
      const by = t0y + m[1] * qx + m[3] * qy;
      expect(bx).toBeCloseTo(ax, 9);
      expect(by).toBeCloseTo(ay, 9);
    }
  });
});

describe('fromCentre', () => {
  it('passes the move through when the pivot is the centre', () => {
    expect(fromCentre(-3, 9, 270, 3, 3, 0, 0)).toEqual([-3, 9]);
  });

  it('subtracts the lever of a pure scale about the pivot', () => {
    close(fromCentre(-4, -4, 0, 2, 2, 5, 5), [1, 1]);
  });

  it('undoes toCentre for any turn, scale and pivot', () => {
    const cases: Array<[number, number, number, number, number, number, number]> = [
      [10, 20, 45, 2, 3, 7, -11],
      [-5, 0, 200, -1, 1, 100, 50],
      [0.25, -8, -90, 0.5, -2, -3, 4],
      [1e4, -1e4, 359, 10, 10, 1, 1],
    ];
    for (const [x, y, rot, mx, my, px, py] of cases) {
      const [cx, cy] = toCentre(x, y, rot, mx, my, px, py);
      const back = fromCentre(cx, cy, rot, mx, my, px, py);
      expect(back[0]).toBeCloseTo(x, 6);
      expect(back[1]).toBeCloseTo(y, 6);
    }
  });

  it('treats a pivot on one axis only as a real pivot', () => {
    close(fromCentre(0, 0, 0, 2, 2, 0, 6), [0, 6]);
  });
});
