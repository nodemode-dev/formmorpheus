import { describe, expect, it } from 'vitest';
import {
  altAzToTilt, barrelBits, cleanCurve, CURVE_PRESETS, PressureCurve, PressureSmoother, readPointer, sourceOf, tiltToAltAz,
  type PointerLike, type ReadOptions,
} from '@src/paint/pen-sample';

const HALF_PI = Math.PI / 2;

function ptr(over: Partial<PointerLike> = {}): PointerLike {
  return { pointerType: 'pen', pressure: 0.5, button: 0, buttons: 1, timeStamp: 100, ...over };
}

function opts(over: Partial<ReadOptions> = {}): ReadOptions {
  return {
    tiltAngle: true, curve: new PressureCurve([[0, 0], [1, 1]]), smoother: new PressureSmoother(), smoothing: 0,
    advance: true, after: (p) => p, fallback: -1, ...over,
  };
}

describe('tilt and altitude conversion', () => {
  it('reads an upright pen as altitude of a quarter turn', () => {
    expect(tiltToAltAz(0, 0)).toEqual({ altitude: HALF_PI, azimuth: 0 });
  });

  it('points the azimuth along the tilt direction', () => {
    expect(tiltToAltAz(45, 0).azimuth).toBeCloseTo(0, 10);
    expect(tiltToAltAz(45, 0).altitude).toBeCloseTo(Math.PI / 4, 10);
    expect(tiltToAltAz(0, 45).azimuth).toBeCloseTo(HALF_PI, 10);
    expect(tiltToAltAz(-45, 0).azimuth).toBeCloseTo(Math.PI, 10);
    expect(tiltToAltAz(0, -30).azimuth).toBeCloseTo(Math.PI * 1.5, 10);
    expect(tiltToAltAz(0, -30).altitude).toBeCloseTo(Math.PI / 3, 10);
  });

  it('round trips tilt through altitude and azimuth', () => {
    for (const [tx, ty] of [[30, -20], [-60, 10], [5, 70], [-12, -44]]) {
      const { altitude, azimuth } = tiltToAltAz(tx, ty);
      const back = altAzToTilt(altitude, azimuth);
      expect(back.tiltX).toBeCloseTo(tx, 6);
      expect(back.tiltY).toBeCloseTo(ty, 6);
    }
  });

  it('gives no tilt for an upright altitude', () => {
    expect(altAzToTilt(HALF_PI, 1.2)).toEqual({ tiltX: 0, tiltY: 0 });
  });

  it('keeps the tilt of a flat pen finite', () => {
    const t = altAzToTilt(0, 0);
    expect(t.tiltX).toBeGreaterThan(89.9);
    expect(t.tiltX).toBeLessThanOrEqual(90);
    expect(t.tiltY).toBeCloseTo(0, 6);
  });
});

describe('cleanCurve', () => {
  it('sorts by x and clamps both coordinates into 0..1', () => {
    expect(cleanCurve([[1, 2], [0.5, -1], [-3, 0.25]])).toEqual([[0, 0.25], [0.5, 0], [1, 1]]);
  });

  it('pins missing ends at the origin and at full pressure', () => {
    expect(cleanCurve([[0.4, 0.7]])).toEqual([[0, 0], [0.4, 0.7], [1, 1]]);
    expect(cleanCurve([])).toEqual([[0, 0], [1, 1]]);
  });

  it('drops points that are not finite', () => {
    expect(cleanCurve([[0, 0], [NaN, 0.5], [0.5, Infinity], [1, 1]])).toEqual([[0, 0], [1, 1]]);
  });

  it('drops a point that nearly repeats the x of the one before', () => {
    expect(cleanCurve([[0, 0], [0.5, 0.2], [0.5004, 0.9], [1, 1]])).toEqual([[0, 0], [0.5, 0.2], [1, 1]]);
  });
});

describe('PressureCurve', () => {
  it('is the identity for the default two points', () => {
    const c = new PressureCurve();
    for (const x of [0, 0.1, 0.37, 0.5, 0.99, 1]) expect(c.at(x)).toBeCloseTo(x, 5);
  });

  it('clamps the input outside 0..1', () => {
    const c = new PressureCurve();
    expect(c.at(-2)).toBe(0);
    expect(c.at(5)).toBe(1);
  });

  it('passes through its control points', () => {
    const c = new PressureCurve([[0, 0.1], [0.25, 0.6], [0.75, 0.7], [1, 0.9]]);
    expect(c.at(0)).toBeCloseTo(0.1, 3);
    expect(c.at(0.25)).toBeCloseTo(0.6, 3);
    expect(c.at(0.75)).toBeCloseTo(0.7, 3);
    expect(c.at(1)).toBeCloseTo(0.9, 3);
  });

  it('never overshoots between rising control points', () => {
    const c = new PressureCurve([[0, 0], [0.1, 0.9], [0.9, 0.95], [1, 1]]);
    for (let k = 1; k < c.lut.length; k++) expect(c.lut[k]).toBeGreaterThanOrEqual(c.lut[k - 1]);
  });

  it('keeps every preset rising from 0 to 1', () => {
    for (const preset of CURVE_PRESETS) {
      const c = new PressureCurve(preset.points);
      expect(c.at(0)).toBe(0);
      expect(c.at(1)).toBeCloseTo(1, 5);
      for (let k = 1; k < c.lut.length; k++) expect(c.lut[k]).toBeGreaterThanOrEqual(c.lut[k - 1]);
    }
  });

  it('lifts light pressure with the soft preset and lowers it with the firm one', () => {
    const find = (id: string) => new PressureCurve(CURVE_PRESETS.find((p) => p.id === id)!.points);
    expect(find('soft').at(0.3)).toBeGreaterThan(0.4);
    expect(find('firm').at(0.3)).toBeLessThan(0.2);
    expect(find('linear').at(0.3)).toBeCloseTo(0.3, 5);
  });

  it('maps the range between min and max onto the whole curve', () => {
    const c = new PressureCurve([[0, 0], [1, 1]], 0.2, 0.8);
    expect(c.apply(0.1)).toBe(0);
    expect(c.apply(0.2)).toBe(0);
    expect(c.apply(0.5)).toBeCloseTo(0.5, 5);
    expect(c.apply(0.8)).toBeCloseTo(1, 5);
    expect(c.apply(1)).toBe(1);
  });

  it('clamps min to 0.9 and keeps max above min', () => {
    const c = new PressureCurve(undefined, 5, 0.1);
    expect(c.min).toBe(0.9);
    expect(c.max).toBeCloseTo(0.95, 10);
    const low = new PressureCurve(undefined, -1, 9);
    expect(low.min).toBe(0);
    expect(low.max).toBe(1);
  });

  it('keeps min and max when only the points are set again', () => {
    const c = new PressureCurve(undefined, 0.3, 0.7);
    c.set([[0, 0], [0.5, 1], [1, 1]]);
    expect(c.min).toBe(0.3);
    expect(c.max).toBe(0.7);
    expect(c.apply(0.5)).toBeCloseTo(1, 3);
  });
});

describe('PressureSmoother', () => {
  it('passes the first value through', () => {
    const s = new PressureSmoother();
    expect(s.last).toBe(-1);
    expect(s.push(0.7, 10, 1)).toBe(0.7);
    expect(s.last).toBe(0.7);
  });

  it('passes everything through when the amount is zero', () => {
    const s = new PressureSmoother();
    s.push(0.1, 0, 0);
    expect(s.push(0.9, 1, 0)).toBe(0.9);
  });

  it('closes 63 percent of the gap after one time constant', () => {
    const s = new PressureSmoother();
    s.push(0, 0, 1);
    expect(s.push(1, 40, 1)).toBeCloseTo(1 - Math.exp(-1), 10);
  });

  it('gives the same result at any sample rate', () => {
    const slow = new PressureSmoother(), fast = new PressureSmoother();
    slow.push(0, 0, 0.5);
    fast.push(0, 0, 0.5);
    const a = slow.push(1, 32, 0.5);
    let b = 0;
    for (let t = 4; t <= 32; t += 4) b = fast.push(1, t, 0.5);
    expect(b).toBeCloseTo(a, 10);
  });

  it('treats a long pause as 100 ms at most', () => {
    const s = new PressureSmoother();
    s.push(0, 0, 1);
    expect(s.push(1, 60000, 1)).toBeCloseTo(1 - Math.exp(-2.5), 10);
  });

  it('starts over after a reset', () => {
    const s = new PressureSmoother();
    s.push(0, 0, 1);
    s.reset();
    expect(s.push(1, 1, 1)).toBe(1);
  });
});

describe('sourceOf and barrelBits', () => {
  it('names the source of a pointer', () => {
    expect(sourceOf(ptr())).toBe('pen');
    expect(sourceOf(ptr({ isTrusted: true }))).toBe('pen');
    expect(sourceOf(ptr({ isTrusted: false }))).toBe('link');
    expect(sourceOf(ptr({ pointerType: 'touch', isTrusted: false }))).toBe('touch');
    expect(sourceOf(ptr({ pointerType: 'mouse' }))).toBe('mouse');
    expect(sourceOf(ptr({ pointerType: '' }))).toBe('mouse');
  });

  it('reads eraser and barrel bits from a pen', () => {
    expect(barrelBits({ pointerType: 'pen', button: 0, buttons: 1 })).toEqual({ eraser: false, barrel: 0 });
    expect(barrelBits({ pointerType: 'pen', button: 5, buttons: 0 })).toEqual({ eraser: true, barrel: 0 });
    expect(barrelBits({ pointerType: 'pen', button: 0, buttons: 32 | 2 | 4 })).toEqual({ eraser: true, barrel: 3 });
    expect(barrelBits({ pointerType: 'pen', button: 2, buttons: 0 })).toEqual({ eraser: false, barrel: 1 });
    expect(barrelBits({ pointerType: 'pen', button: 1, buttons: 0 })).toEqual({ eraser: false, barrel: 2 });
  });

  it('reads no bits from a mouse', () => {
    expect(barrelBits({ pointerType: 'mouse', button: 2, buttons: 38 })).toEqual({ eraser: false, barrel: 0 });
  });
});

describe('readPointer', () => {
  it('gives a mouse full pressure and no pen extras', () => {
    const s = readPointer(ptr({ pointerType: 'mouse', pressure: 0.5, tiltX: 30, twist: 90, tangentialPressure: 0.4 }), 12, 34, opts());
    expect(s).toMatchObject({ x: 12, y: 34, pressure: 1, rawPressure: 1, kind: 'mouse', source: 'mouse', tiltX: 0, tiltY: 0, twist: 0, tangential: 0, hover: false, time: 100, t: 100 });
    expect(s.altitude).toBe(HALF_PI);
  });

  it('shapes pen pressure with the curve and then the after step', () => {
    const curve = new PressureCurve([[0, 0], [1, 1]], 0, 0.5);
    const s = readPointer(ptr({ pressure: 0.25 }), 0, 0, opts({ curve, after: (p) => p / 2 }));
    expect(s.rawPressure).toBe(0.25);
    expect(s.pressure).toBeCloseTo(0.25, 5);
  });

  it('reads a hovering pen as zero pressure', () => {
    const s = readPointer(ptr({ buttons: 0, pressure: 0.6 }), 0, 0, opts());
    expect(s.hover).toBe(true);
    expect(s.pressure).toBe(0);
    expect(s.rawPressure).toBe(0);
  });

  it('marks a pen in contact with no pressure as missing', () => {
    const s = readPointer(ptr({ pressure: 0 }), 0, 0, opts());
    expect(s.rawPressure).toBe(-1);
    expect(s.pressure).toBe(-1);
  });

  it('uses the fallback pressure for a pen that reports none', () => {
    const s = readPointer(ptr({ pressure: 0 }), 0, 0, opts({ fallback: 0.5 }));
    expect(s.rawPressure).toBe(-1);
    expect(s.pressure).toBeCloseTo(0.5, 5);
  });

  it('does not move the smoother for a predicted point', () => {
    const smoother = new PressureSmoother();
    const s = readPointer(ptr({ pressure: 0.8 }), 0, 0, opts({ smoother, smoothing: 1, advance: false }));
    expect(smoother.last).toBe(-1);
    expect(s.pressure).toBeCloseTo(0.8, 5);
  });

  it('smooths pen pressure across samples', () => {
    const o = opts({ smoothing: 1 });
    readPointer(ptr({ pressure: 0.2, timeStamp: 0 }), 0, 0, o);
    const s = readPointer(ptr({ pressure: 1, timeStamp: 40 }), 0, 0, o);
    expect(s.rawPressure).toBe(1);
    expect(s.pressure).toBeCloseTo(0.2 + 0.8 * (1 - Math.exp(-1)), 3);
  });

  it('gives a touch without pressure a middle pressure and skips the curve', () => {
    const curve = new PressureCurve([[0, 0], [1, 1]], 0.6, 1);
    const s = readPointer(ptr({ pointerType: 'touch', pressure: 0 }), 0, 0, opts({ curve }));
    expect(s.kind).toBe('touch');
    expect(s.rawPressure).toBe(0.5);
    expect(s.pressure).toBe(0.5);
    expect(readPointer(ptr({ pointerType: 'touch', pressure: 0.3 }), 0, 0, opts({ curve })).pressure).toBe(0.3);
  });

  it('reads a mouse that carries pressure like a pen only when asked', () => {
    const e = ptr({ pointerType: 'mouse', pressure: 0.4 });
    const on = readPointer(e, 0, 0, opts({ mousePressure: true }));
    expect(on.rawPressure).toBe(0.4);
    expect(on.pressure).toBeCloseTo(0.4, 5);
    expect(on.kind).toBe('mouse');
    const released = readPointer(ptr({ pointerType: 'mouse', pressure: 0.4, buttons: 0 }), 0, 0, opts({ mousePressure: true }));
    expect(released.pressure).toBe(1);
  });

  it('carries tilt, twist, contact size and device id of a pen', () => {
    const s = readPointer(ptr({ tiltX: 45, tiltY: 0, twist: 120, tangentialPressure: -0.5, width: 3, height: 4, persistentDeviceId: 77, buttons: 33 }), 0, 0, opts());
    expect(s).toMatchObject({ tiltX: 45, tiltY: 0, twist: 120, tangential: -0.5, width: 3, height: 4, deviceId: 77, eraser: true, barrel: 0 });
    expect(s.altitude).toBeCloseTo(Math.PI / 4, 10);
  });

  it('reports a flat upright pen when tilt is switched off', () => {
    const s = readPointer(ptr({ tiltX: 45, tiltY: 20, altitudeAngle: 0.5, azimuthAngle: 1 }), 0, 0, opts({ tiltAngle: false }));
    expect(s.tiltX).toBe(0);
    expect(s.tiltY).toBe(0);
    expect(s.altitude).toBe(HALF_PI);
  });

  it('derives tilt from altitude and azimuth when the device sends no tilt', () => {
    const s = readPointer(ptr({ altitudeAngle: Math.PI / 4, azimuthAngle: HALF_PI }), 0, 0, opts());
    expect(s.altitude).toBeCloseTo(Math.PI / 4, 10);
    expect(s.azimuth).toBeCloseTo(HALF_PI, 10);
    expect(s.tiltX).toBeCloseTo(0, 6);
    expect(s.tiltY).toBeCloseTo(45, 6);
  });
});
