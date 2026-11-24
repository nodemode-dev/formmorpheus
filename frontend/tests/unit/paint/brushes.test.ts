import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_STARTERS, BRUSHES, CLASSIC_SETS, DEFAULT_ERASE, DEFAULT_PAINT, DEFAULT_SMUDGE, OLD_SET_NAMES, allBrushes, brushById,
  keepCorners, makePresets, registerBrush, starterBrush, stabilizationRope, unregisterBrush,
} from '@src/paint/brushes';
import { BRUSH_VER } from '@src/paint/brush-migrate';
import type { Brush } from '@src/paint/types';

const base = (over: Partial<Brush> = {}): Brush => ({ ...(starterBrush(DEFAULT_PAINT) as Brush), ...over });

describe('makePresets', () => {
  it('gives four rising sizes at full opacity by default', () => {
    const p = makePresets();
    expect(p.map((q) => q.size)).toEqual([0.1, 0.3, 0.55, 0.9]);
    expect(p.slice(0, 3).map((q) => q.opacity)).toEqual([1, 1, 1]);
    expect(p[3].opacity).toBeCloseTo(0.6, 10);
  });

  it('never lets the largest preset drop under 0.35 opacity', () => {
    expect(makePresets(0.4)[3].opacity).toBe(0.35);
    expect(makePresets(0.4)[0].opacity).toBe(0.4);
  });

  it('caps the third preset at full opacity', () => {
    expect(makePresets(1.5)[2].opacity).toBe(1);
  });
});

describe('stabilizationRope', () => {
  it('is zero without a card value', () => {
    expect(stabilizationRope(base({ stabilization: undefined }))).toBe(0);
  });

  it('adds half of the card share', () => {
    expect(stabilizationRope(base({ stabilization: 40 }))).toBeCloseTo(0.2, 10);
    expect(stabilizationRope(base({ stabilization: 100 }))).toBeCloseTo(0.5, 10);
  });

  it('clamps the card value into 0 to 100', () => {
    expect(stabilizationRope(base({ stabilization: -30 }))).toBe(0);
    expect(stabilizationRope(base({ stabilization: 900 }))).toBeCloseTo(0.5, 10);
  });
});

describe('keepCorners', () => {
  it('cuts the smoothing to three tenths', () => {
    expect(keepCorners(base({ smoothing: 0.2, stabilization: undefined })).smoothing).toBeCloseTo(0.06, 10);
  });

  it('caps the smoothing at 0.14', () => {
    expect(keepCorners(base({ smoothing: 1, stabilization: undefined })).smoothing).toBe(0.14);
  });

  it('cuts the card value to a fifth and gives its rope share back', () => {
    const out = keepCorners(base({ smoothing: 0.55, stabilization: 40 }));
    expect(out.stabilization).toBe(8);
    expect(out.smoothing).toBeCloseTo(0.1, 10);
    expect(out.smoothing + stabilizationRope(out)).toBeCloseTo(0.14, 10);
  });

  it('never gives a negative smoothing', () => {
    expect(keepCorners(base({ smoothing: 0.1, stabilization: 100 })).smoothing).toBe(0);
  });

  it('returns a copy and leaves the input alone', () => {
    const b = base({ smoothing: 0.5, stabilization: 50 });
    const out = keepCorners(b);
    expect(out).not.toBe(b);
    expect(b.smoothing).toBe(0.5);
    expect(b.stabilization).toBe(50);
  });
});

describe('the starter library', () => {
  it('has a unique id for every starter brush', () => {
    const ids = ALL_STARTERS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts with the Classic library in order', () => {
    expect(ALL_STARTERS.slice(0, BRUSHES.length)).toEqual(BRUSHES);
    expect(ALL_STARTERS.length).toBeGreaterThan(BRUSHES.length);
  });

  it('places every Classic brush in a named Classic set', () => {
    const names = new Set(CLASSIC_SETS.map((s) => s.name));
    for (const b of BRUSHES) expect(names.has(b.set), b.id).toBe(true);
  });

  it('fills every Classic set with at least one brush', () => {
    const used = new Set(BRUSHES.map((b) => b.set));
    for (const s of CLASSIC_SETS) expect(used.has(s.name), s.id).toBe(true);
  });

  it('maps every old short set name to a real set id', () => {
    const ids = new Set(CLASSIC_SETS.map((s) => s.id));
    for (const id of Object.values(OLD_SET_NAMES)) expect(ids.has(id), id).toBe(true);
    expect(new Set(CLASSIC_SETS.map((s) => s.id)).size).toBe(CLASSIC_SETS.length);
  });

  it('ships every starter in the current brush version with sane numbers', () => {
    for (const b of ALL_STARTERS) {
      expect(b.ver, b.id).toBe(BRUSH_VER);
      expect(b.rotationJitter, b.id).toBe(0);
      expect(b.maxSize, b.id).toBeGreaterThan(0);
      expect(b.minSize, b.id).toBeLessThanOrEqual(b.maxSize);
      expect(b.spacing, b.id).toBeGreaterThan(0);
      expect(b.smoothing, b.id).toBeGreaterThanOrEqual(0);
      expect(b.smoothing, b.id).toBeLessThanOrEqual(0.14);
      expect(b.presets.length, b.id).toBe(4);
    }
  });

  it('has the default paint, smudge and erase brushes', () => {
    for (const id of [DEFAULT_PAINT, DEFAULT_SMUDGE, DEFAULT_ERASE]) {
      expect(starterBrush(id)?.id).toBe(id);
      expect(brushById(id)?.id).toBe(id);
    }
  });
});

describe('the brush registry', () => {
  const custom = 'f23-custom-brush';
  afterEach(() => {
    unregisterBrush(custom);
    registerBrush(starterBrush(DEFAULT_PAINT) as Brush);
  });

  it('finds nothing for an unknown id', () => {
    expect(brushById('no-such-brush')).toBeUndefined();
    expect(starterBrush('no-such-brush')).toBeUndefined();
  });

  it('registers and removes a brush', () => {
    const before = allBrushes().length;
    const b = base({ id: custom, name: 'Mine' });
    registerBrush(b);
    expect(brushById(custom)).toBe(b);
    expect(allBrushes().length).toBe(before + 1);
    unregisterBrush(custom);
    expect(brushById(custom)).toBeUndefined();
    expect(allBrushes().length).toBe(before);
  });

  it('stores an old brush in its migrated form', () => {
    registerBrush(base({ id: custom, ver: undefined, scatter: 0.4, rotationJitter: 0.7 }));
    const got = brushById(custom);
    expect(got?.ver).toBe(BRUSH_VER);
    expect(got?.scatter).toBe(0.7);
    expect(got?.scatterPos).toBe(0.4);
  });

  it('keeps the untouched starter when an edit replaces it in the lookup', () => {
    const original = starterBrush(DEFAULT_PAINT) as Brush;
    const before = allBrushes().length;
    registerBrush({ ...original, maxSize: original.maxSize + 100 });
    expect(brushById(DEFAULT_PAINT)?.maxSize).toBe(original.maxSize + 100);
    expect(starterBrush(DEFAULT_PAINT)).toBe(original);
    expect(starterBrush(DEFAULT_PAINT)?.maxSize).toBe(original.maxSize);
    expect(allBrushes().length).toBe(before);
  });
});
