import { describe, expect, it } from 'vitest';
import { easeContact, leanDia, liftPressure, outerness } from '@src/paint/fam-oil';

describe('oil family helpers', () => {
  it('holds the contact when the pen has not moved', () => {
    expect(easeContact(0.3, 1, 0, 20, 0.5)).toBe(0.3);
    expect(easeContact(0.3, 1, -4, 20, 0.5)).toBe(0.3);
  });

  it('eases the contact toward its target over the reach', () => {
    const one = easeContact(0, 1, 10, 20, 0.5);
    expect(one).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(easeContact(0, 1, 5, 20, 0.5)).toBeLessThan(one);
    expect(easeContact(0, 1, 1000, 20, 0.5)).toBeCloseTo(1, 6);
    expect(easeContact(1, 0, 10, 20, 0.5)).toBeCloseTo(Math.exp(-1), 10);
  });

  it('never divides by a reach shorter than one pixel', () => {
    expect(easeContact(0, 1, 1, 0, 0)).toBeCloseTo(1 - Math.exp(-1), 10);
  });

  it('keeps the diameter of an upright bundle or one without a body', () => {
    expect(leanDia(40, 3, 0, 1)).toBe(40);
    expect(leanDia(40, 3, 0.5, 0)).toBe(40);
  });

  it('thins a leaning blade down to a floor of one and a half pixels', () => {
    expect(leanDia(40, 2, 0.5, 1)).toBeCloseTo(11);
    expect(leanDia(40, 0.5, 0.5, 1)).toBeCloseTo(22);
    expect(leanDia(4, 4, 1, 1)).toBe(1.5);
  });

  it('measures how far out a hair sits in a leaning bundle', () => {
    expect(outerness(0, 1)).toBe(0);
    expect(outerness(1, 1)).toBe(1);
    expect(outerness(-1, 0.5)).toBe(0.5);
    expect(outerness(0.25, 1)).toBeCloseTo(0.125);
    expect(outerness(0.8, 0)).toBe(0);
  });

  it('never lifts with less than a trace of pressure', () => {
    expect(liftPressure(0)).toBe(0.02);
    expect(liftPressure(-1)).toBe(0.02);
    expect(liftPressure(0.6)).toBe(0.6);
  });
});
