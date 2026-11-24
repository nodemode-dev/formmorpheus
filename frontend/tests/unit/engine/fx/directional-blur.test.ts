import { describe, expect, it } from 'vitest';
import '@src/engine/fx/directional-blur';
import { ctx, defaults, fx, run, uniformsOf } from '../../_support/F20';

const e = fx('dirblur');

describe('the directional blur effect', () => {
  it('is active only while the distance is above zero', () => {
    expect(e.active(defaults(e), {})).toBe(true);
    expect(e.active(defaults(e, { distance: 0 }), {})).toBe(false);
  });

  it('offers centered, trailing and leading sides with centered as the default', () => {
    const sides = (e.options ?? []).find((o) => o.id === 'sides');
    expect(sides?.choices).toEqual(['centered', 'trailing', 'leading']);
    expect(sides?.def).toBe('centered');
  });

  it('pads half the distance when centered and all of it when one sided', () => {
    const p = defaults(e, { distance: 40 });
    expect(e.pad(p, {}, ctx(8, 8))).toBe(21);
    expect(e.pad(p, { sides: 'centered' }, ctx(8, 8))).toBe(21);
    expect(e.pad(p, { sides: 'trailing' }, ctx(8, 8))).toBe(41);
    expect(e.pad(p, { sides: 'leading' }, ctx(8, 8, 2))).toBe(81);
  });

  it('copies the picture at distance zero', () => {
    const px = [255, 0, 255, 255, 0, 255, 0, 255];
    expect(run(e, px, 2, 1, defaults(e, { distance: 0 }))).toEqual(px);
  });

  it('smears to opposite sides for trailing and leading', () => {
    const px = new Array<number>(20).fill(0);
    px.splice(8, 4, 255, 255, 255, 255);
    const p = defaults(e, { angle: 0, distance: 2, quality: 2 });
    const trailing = run(e, px, 5, 1, p, { sides: 'trailing' });
    const leading = run(e, px, 5, 1, p, { sides: 'leading' });
    expect(trailing[7]).toBeGreaterThan(0);
    expect(trailing[15]).toBe(0);
    expect(leading[15]).toBeGreaterThan(0);
    expect(leading[7]).toBe(0);
  });

  it('scales the blur vector with the surface and turns it with the angle', () => {
    const u = uniformsOf(e, defaults(e, { angle: 90, distance: 10, quality: 0.2 }), { sides: 'leading' }, ctx(8, 8, 2));
    const v = u.uVec as number[];
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[1]).toBeCloseTo(-20, 9);
    expect(u.uTaps).toBe(1);
    expect(u.uShift).toBe(-0.5);
  });
});
