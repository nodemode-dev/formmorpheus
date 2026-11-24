import { describe, expect, it, vi } from 'vitest';
import type { Brush } from '@src/paint/types';
import { defaultSlider, engineSize, sliderOf, stepSlider } from '@src/ui/paint-size';

vi.mock('@src/paint/fam-paint-size', () => ({ paintWant: (_b: unknown, want: number): number => want }));

const brush = (over: Partial<Brush>): Brush =>
  ({ name: 'Pen', set: 'Ink', minSize: 1, maxSize: 100, softness: 0, flow: 1, ...over }) as unknown as Brush;

describe('engineSize and sliderOf', () => {
  it('maps the slider through a square curve', () => {
    expect(engineSize(0.5)).toBeCloseTo(0.25, 10);
    expect(engineSize(1)).toBe(1);
    expect(engineSize(0)).toBe(0);
  });

  it('clamps slider positions outside zero to one', () => {
    expect(engineSize(-3)).toBe(0);
    expect(engineSize(7)).toBe(1);
    expect(sliderOf(-1)).toBe(0);
    expect(sliderOf(4)).toBe(1);
  });

  it('round trips every slider position', () => {
    for (let s = 0; s <= 1.0001; s += 0.05) expect(sliderOf(engineSize(s))).toBeCloseTo(Math.min(1, s), 9);
  });

  it('gives fine engine steps at the small end of the travel', () => {
    expect(engineSize(0.1) - engineSize(0)).toBeLessThan(engineSize(1) - engineSize(0.9));
  });
});

describe('stepSlider', () => {
  it('adds five percent above twenty percent', () => {
    expect(stepSlider(0.5, 1)).toBeCloseTo(0.55, 10);
    expect(stepSlider(0.5, -1)).toBeCloseTo(0.45, 10);
    expect(stepSlider(0.2, 1)).toBeCloseTo(0.25, 10);
  });

  it('steps multiplicatively below twenty percent', () => {
    expect(stepSlider(0.1, 1)).toBeCloseTo(0.13, 10);
    expect(stepSlider(0.1, -1)).toBeCloseTo(0.075, 10);
    expect(stepSlider(0.2, -1)).toBeCloseTo(0.155, 10);
  });

  it('never goes above one or below one percent', () => {
    expect(stepSlider(0.98, 1)).toBe(1);
    expect(stepSlider(1, 1)).toBe(1);
    expect(stepSlider(0.01, -1)).toBe(0.01);
    expect(stepSlider(0, -1)).toBe(0.01);
  });

  it('climbs from the bottom to the top and back in strict steps', () => {
    let v = 0.01;
    let n = 0;
    while (v < 1 && n < 200) {
      const next = stepSlider(v, 1);
      expect(next).toBeGreaterThan(v);
      v = next;
      n++;
    }
    expect(v).toBe(1);
    n = 0;
    while (v > 0.01 && n < 200) {
      const next = stepSlider(v, -1);
      expect(next).toBeLessThan(v);
      v = next;
      n++;
    }
    expect(v).toBe(0.01);
  });
});

describe('defaultSlider', () => {
  it('puts a brush with no size range at the top', () => {
    expect(defaultSlider(brush({ minSize: 8, maxSize: 8 }))).toBe(1);
    expect(defaultSlider(brush({ minSize: 9, maxSize: 3 }))).toBe(1);
  });

  it('starts a plain pen at about fourteen pixels', () => {
    expect(defaultSlider(brush({}))).toBe(0.36);
  });

  it('starts at least a little above the brush minimum', () => {
    expect(defaultSlider(brush({ minSize: 20, maxSize: 100 }))).toBe(0.22);
  });

  it('starts a wet brush broad', () => {
    expect(defaultSlider(brush({ wet: true } as Partial<Brush>))).toBe(0.77);
    expect(defaultSlider(brush({ render: 'glaze' } as Partial<Brush>))).toBe(0.77);
  });

  it('starts an imported stamp brush at a readable size', () => {
    expect(defaultSlider(brush({ custom: true, tip: 'sampled' } as Partial<Brush>))).toBe(0.75);
    expect(defaultSlider(brush({ custom: true } as Partial<Brush>))).toBe(0.36);
  });

  it('starts a soft airbrush wide but not a soft hard-flow brush', () => {
    expect(defaultSlider(brush({ set: 'Air', name: 'Soft', softness: 0.5, flow: 0.3 }))).toBe(0.74);
    expect(defaultSlider(brush({ set: 'Air', name: 'Soft', softness: 0.5, flow: 0.9 }))).toBe(0.36);
    expect(defaultSlider(brush({ name: 'Round', softness: 0.5, flow: 0.3 }))).toBe(0.36);
  });

  it('stays inside zero to one', () => {
    const v = defaultSlider(brush({ minSize: 1, maxSize: 3 }));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});
