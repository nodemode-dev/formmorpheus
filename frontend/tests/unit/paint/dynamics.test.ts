import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyPressure, baseAngle, baseDiameter, blendChannel, getPressureCurve, hsvToRgb, lerp, mulberry32,
  needsColourPath, pressureDiameter, pressureFlow, rgbToHsv, setPressureCurve, setPressureGamma, tiltInfo, tiltShape,
} from '@src/paint/dynamics';
import type { Brush } from '@src/paint/types';

const brush = (over: Partial<Brush> = {}): Brush => ({
  name: 'test', tip: 'round', minSize: 2, maxSize: 102, tilt: 0,
  pressureSize: [0.2, 1], pressureFlow: [0.5, 1], ...over,
} as Brush);

describe('pressure curve', () => {
  beforeEach(() => setPressureCurve([{ x: 0, y: 0 }, { x: 1, y: 1 }]));

  it('is the identity for the straight default curve', () => {
    for (const p of [0, 0.1, 0.37, 0.5, 0.9, 1]) expect(applyPressure(p)).toBeCloseTo(p, 4);
  });

  it('clamps pressure outside 0 to 1', () => {
    expect(applyPressure(-3)).toBe(0);
    expect(applyPressure(7)).toBe(1);
  });

  it('passes through its control points', () => {
    setPressureCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }]);
    expect(applyPressure(0.5)).toBeCloseTo(0.8, 4);
    expect(applyPressure(0)).toBe(0);
    expect(applyPressure(1)).toBe(1);
  });

  it('never overshoots or turns back between rising points', () => {
    setPressureCurve([{ x: 0, y: 0 }, { x: 0.1, y: 0.9 }, { x: 0.2, y: 0.91 }, { x: 1, y: 1 }]);
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const y = applyPressure(i / 1000);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-6);
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
  });

  it('adds the missing end points', () => {
    setPressureCurve([{ x: 0.5, y: 0.5 }]);
    expect(getPressureCurve()).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]);
    setPressureCurve([]);
    expect(getPressureCurve()).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it('sorts, clamps and drops points that share an x', () => {
    setPressureCurve([{ x: 2, y: 5 }, { x: 0.4, y: 0.3 }, { x: 0.40001, y: 0.9 }, { x: -1, y: -2 }]);
    expect(getPressureCurve()).toEqual([{ x: 0, y: 0 }, { x: 0.4, y: 0.3 }, { x: 1, y: 1 }]);
  });

  it('hands out copies of the control points', () => {
    const a = getPressureCurve();
    a[0].y = 0.7;
    expect(getPressureCurve()[0].y).toBe(0);
  });

  it('builds a power curve from a gamma', () => {
    setPressureGamma(2);
    expect(applyPressure(0.5)).toBeCloseTo(0.25, 4);
    expect(applyPressure(0.25)).toBeCloseTo(0.0625, 4);
  });

  it('clamps the gamma to 0.25 through 4', () => {
    setPressureGamma(100);
    expect(applyPressure(0.5)).toBeCloseTo(Math.pow(0.5, 4), 4);
    setPressureGamma(0);
    expect(applyPressure(0.5)).toBeCloseTo(Math.pow(0.5, 0.25), 4);
  });
});

describe('size and flow', () => {
  it('interpolates linearly', () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it('maps the size slider between the brush limits and clamps it', () => {
    const b = brush();
    expect(baseDiameter(b, 0.5)).toBe(52);
    expect(baseDiameter(b, -1)).toBe(2);
    expect(baseDiameter(b, 9)).toBe(102);
  });

  it('scales the diameter with the canvas long side unless the brush is fixed', () => {
    expect(baseDiameter(brush(), 0.5, 3840)).toBe(104);
    expect(baseDiameter(brush({ sizeAbs: true }), 0.5, 3840)).toBe(52);
  });

  it('maps pressure into the size and flow ranges', () => {
    const b = brush();
    expect(pressureDiameter(100, b, 0)).toBeCloseTo(20);
    expect(pressureDiameter(100, b, 1)).toBeCloseTo(100);
    expect(pressureDiameter(100, b, 0.5)).toBeCloseTo(60);
    expect(pressureFlow(b, 0.5)).toBeCloseTo(0.75);
  });

  it('applies the brush gamma before the range', () => {
    const b = brush({ pressureGamma: 2 });
    expect(pressureDiameter(100, b, 0.5)).toBeCloseTo(40);
    expect(pressureFlow(b, 0.5)).toBeCloseTo(0.625);
  });
});

describe('tilt', () => {
  it('reports an upright pen as altitude 90 with no lean', () => {
    const t = tiltInfo(0, 0);
    expect(t.altitude).toBeCloseTo(90);
    expect(t.lean).toBeCloseTo(0);
  });

  it('converts a single axis tilt to altitude, azimuth and lean', () => {
    const x = tiltInfo(45, 0);
    expect(x.altitude).toBeCloseTo(45);
    expect(x.azimuth).toBeCloseTo(0);
    expect(x.lean).toBeCloseTo(0.5);
    expect(tiltInfo(0, 45).azimuth).toBeCloseTo(Math.PI / 2);
    expect(tiltInfo(-30, 0).azimuth).toBeCloseTo(Math.PI);
  });

  it('clamps tilt beyond 90 degrees to a flat pen', () => {
    const t = tiltInfo(400, 0);
    expect(t.altitude).toBeCloseTo(0, 3);
    expect(t.lean).toBeCloseTo(1, 3);
  });

  it('leaves the dab alone for a brush without tilt or an upright pen', () => {
    const none = tiltShape(brush({ tilt: 0 }), 40, 10);
    expect(none.angle).toBeNull();
    expect(none.sizeMul).toBe(1);
    expect(none.opacityMul).toBe(1);
    expect(tiltShape(brush({ tilt: 1 }), 0, 0).angle).toBeNull();
  });

  it('widens, flattens and lightens a side-on dry tip', () => {
    const s = tiltShape(brush({ tilt: 1, maxSize: 20 }), 45, 0);
    expect(s.lean).toBeCloseTo(0.5);
    expect(s.angle).toBeCloseTo(0);
    expect(s.sizeMul).toBeCloseTo(7.29);
    expect(s.roundnessMul).toBeCloseTo(5.2772 / 7.29);
    expect(s.opacityMul).toBeCloseTo(0.643);
    expect(s.gradation).toBeCloseTo(0.225);
    expect(s.bleed).toBeCloseTo(0.25);
  });

  it('grows a scattered brush less than a plain one', () => {
    const plain = tiltShape(brush({ tilt: 1 }), 45, 0);
    const scattered = tiltShape(brush({ tilt: 1, shapeCount: 4 }), 45, 0);
    expect(scattered.sizeMul).toBe(1);
    expect(plain.sizeMul).toBeGreaterThan(1);
  });

  it('ignores lean below the brush tilt angle', () => {
    const s = tiltShape(brush({ tilt: 1, tiltAngle: 60 }), 45, 0);
    expect(s.lean).toBe(0);
    expect(s.angle).toBeNull();
  });

  it('gives a fixed chisel its slant only when it does not follow the stroke', () => {
    expect(baseAngle(brush({ tip: 'chisel' } as Partial<Brush>))).toBeCloseTo((-40 * Math.PI) / 180);
    expect(baseAngle(brush({ tip: 'chisel', followStroke: true } as Partial<Brush>))).toBe(0);
    expect(baseAngle(brush())).toBe(0);
  });
});

describe('colour', () => {
  it('converts primaries to hue, saturation and value', () => {
    const o: number[] = [];
    rgbToHsv(255, 0, 0, o);
    expect(o).toEqual([0, 1, 1]);
    rgbToHsv(0, 255, 0, o);
    expect(o[0]).toBeCloseTo(1 / 3);
    rgbToHsv(0, 0, 255, o);
    expect(o[0]).toBeCloseTo(2 / 3);
  });

  it('gives grey and black no saturation', () => {
    const o: number[] = [];
    rgbToHsv(128, 128, 128, o);
    expect(o[1]).toBe(0);
    expect(o[2]).toBeCloseTo(128 / 255);
    rgbToHsv(0, 0, 0, o);
    expect(o).toEqual([0, 0, 0]);
  });

  it('round trips colours through hsv', () => {
    const hsv: number[] = [], rgb: number[] = [];
    for (const c of [[12, 200, 77], [255, 255, 255], [90, 10, 250], [250, 10, 90], [1, 2, 3]]) {
      rgbToHsv(c[0], c[1], c[2], hsv);
      hsvToRgb(hsv[0], hsv[1], hsv[2], rgb);
      expect(rgb[0]).toBeCloseTo(c[0], 6);
      expect(rgb[1]).toBeCloseTo(c[1], 6);
      expect(rgb[2]).toBeCloseTo(c[2], 6);
    }
  });

  it('wraps the hue and clamps saturation and value', () => {
    const a: number[] = [], b: number[] = [];
    hsvToRgb(1.5, 1, 1, a);
    hsvToRgb(0.5, 1, 1, b);
    expect(a).toEqual(b);
    expect(b[0]).toBeCloseTo(0);
    expect(b[1]).toBeCloseTo(255);
    expect(b[2]).toBeCloseTo(255);
    hsvToRgb(-0.25, 4, 9, a);
    hsvToRgb(0.75, 1, 1, b);
    expect(a).toEqual(b);
  });

  it('needs the colour path only for brushes with colour features', () => {
    expect(needsColourPath(brush())).toBe(false);
    expect(needsColourPath(brush({ blend: 'normal' } as Partial<Brush>))).toBe(false);
    expect(needsColourPath(brush({ blend: 'multiply' } as Partial<Brush>))).toBe(true);
    expect(needsColourPath(brush({ wetEdges: 0.2 }))).toBe(true);
    expect(needsColourPath(brush({ bump: 0 }))).toBe(false);
  });
});

describe('blendChannel', () => {
  it('multiplies and screens', () => {
    expect(blendChannel('multiply', 255, 128)).toBeCloseTo(128);
    expect(blendChannel('multiply', 0, 200)).toBe(0);
    expect(blendChannel('screen', 0, 77)).toBeCloseTo(77);
    expect(blendChannel('screen', 255, 77)).toBeCloseTo(255);
  });

  it('treats an unknown mode as normal', () => {
    expect(blendChannel('no-such-mode', 10, 99)).toBeCloseTo(99);
    expect(blendChannel('normal', 10, 99)).toBeCloseTo(99);
  });

  it('keeps darken, lighten and difference symmetric', () => {
    expect(blendChannel('darken', 40, 200)).toBeCloseTo(40);
    expect(blendChannel('lighten', 40, 200)).toBeCloseTo(200);
    expect(blendChannel('difference', 40, 200)).toBeCloseTo(160);
    expect(blendChannel('difference', 200, 40)).toBeCloseTo(160);
  });

  it('guards the divisions at the ends of the range', () => {
    expect(blendChannel('color-dodge', 10, 255)).toBe(255);
    expect(blendChannel('color-burn', 250, 0)).toBe(0);
    expect(blendChannel('divide', 10, 0)).toBe(255);
    expect(blendChannel('vivid-light', 100, 0)).toBe(0);
    expect(blendChannel('vivid-light', 100, 255)).toBe(255);
  });

  it('clamps add, subtract and the linear modes', () => {
    expect(blendChannel('add', 200, 200)).toBe(255);
    expect(blendChannel('subtract', 50, 200)).toBe(0);
    expect(blendChannel('linear-burn', 100, 100)).toBe(0);
    expect(blendChannel('linear-light', 255, 255)).toBe(255);
    expect(blendChannel('add', 20, 30)).toBeCloseTo(50);
  });

  it('thresholds hard mix at a full sum', () => {
    expect(blendChannel('hard-mix', 128, 127)).toBe(255);
    expect(blendChannel('hard-mix', 100, 100)).toBe(0);
  });

  it('leaves the base alone under a mid grey overlay source pair', () => {
    expect(blendChannel('hard-light', 80, 0)).toBe(0);
    expect(blendChannel('overlay', 0, 80)).toBe(0);
    expect(blendChannel('overlay', 255, 80)).toBeCloseTo(255);
    expect(blendChannel('exclusion', 255, 255)).toBeCloseTo(0);
    expect(blendChannel('pin-light', 200, 0)).toBe(0);
  });
});

describe('mulberry32', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });

  it('differs between seeds and stays inside 0 to 1', () => {
    const a = mulberry32(1), b = mulberry32(2);
    let same = 0, sum = 0;
    for (let i = 0; i < 2000; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      if (v === b()) same++;
    }
    expect(same).toBe(0);
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });
});
