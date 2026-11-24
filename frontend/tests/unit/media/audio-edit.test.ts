import { describe, expect, it } from 'vitest';
import { fadeGain, fadeLimits, isSound, normalize, normalizeLoudness, setMute, setSolo, soundBlocks } from '@src/media/audio-edit';
import { OpError } from '@src/engine/ops';
import type { Content, Movie } from '@src/engine/types';

const block = (over: Record<string, unknown> = {}): Content => ({ id: 'b', kind: 'audio', duration: 100, tracks: [], keys: [], volume: 1, ...over }) as unknown as Content;
const movie = (tracks: unknown[]): Movie => ({ tracks }) as unknown as Movie;

describe('isSound', () => {
  it('is true only for audio blocks', () => {
    expect(isSound(block())).toBe(true);
    expect(isSound(block({ kind: 'image' }))).toBe(false);
  });
});

describe('fadeLimits', () => {
  it('keeps fades that fit as they are', () => {
    expect(fadeLimits(block(), 20, 30, 'in')).toEqual({ fadeIn: 20, fadeOut: 30 });
  });

  it('shortens the fade out when the fade in is preferred', () => {
    expect(fadeLimits(block(), 30, 90, 'in')).toEqual({ fadeIn: 30, fadeOut: 70 });
  });

  it('shortens the fade in when the fade out is preferred', () => {
    expect(fadeLimits(block(), 30, 90, 'out')).toEqual({ fadeIn: 10, fadeOut: 90 });
  });

  it('rounds to whole frames and clamps to the block', () => {
    expect(fadeLimits(block(), 2.6, -5, 'in')).toEqual({ fadeIn: 3, fadeOut: 0 });
    expect(fadeLimits(block(), 500, 0, 'in')).toEqual({ fadeIn: 100, fadeOut: 0 });
  });
});

describe('fadeGain', () => {
  const c = block({ fadeIn: 10, fadeOut: 20 });

  it('ramps up through the fade in', () => {
    expect(fadeGain(c, 0)).toBe(0);
    expect(fadeGain(c, 5)).toBeCloseTo(0.5, 9);
  });

  it('is unity between the fades', () => {
    expect(fadeGain(c, 10)).toBe(1);
    expect(fadeGain(c, 50)).toBe(1);
  });

  it('ramps down through the fade out to zero at the end', () => {
    expect(fadeGain(c, 90)).toBeCloseTo(0.5, 9);
    expect(fadeGain(c, 100)).toBe(0);
    expect(fadeGain(c, 120)).toBe(0);
  });

  it('is unity everywhere without fades', () => {
    expect(fadeGain(block(), 0)).toBe(1);
    expect(fadeGain(block(), 100)).toBe(1);
  });
});

describe('setMute and setSolo', () => {
  const m = movie([{ id: 't1', content: [] }, { id: 't2', content: [], mute: true, solo: true }]);

  it('sets and clears the mute flag on one track only', () => {
    const on = setMute(m, 't1', true);
    expect(on.tracks[0].mute).toBe(true);
    expect(on.tracks[1]).toBe(m.tracks[1]);
    const off = setMute(m, 't2', false);
    expect('mute' in off.tracks[1]).toBe(false);
    expect(m.tracks[1].mute).toBe(true);
  });

  it('sets and clears the solo flag', () => {
    expect(setSolo(m, 't1', true).tracks[0].solo).toBe(true);
    expect('solo' in setSolo(m, 't2', false).tracks[1]).toBe(false);
  });

  it('refuses a track that does not exist', () => {
    expect(() => setMute(m, 'gone', true)).toThrow(OpError);
    expect(() => setSolo(m, 'gone', true)).toThrow(OpError);
  });
});

describe('normalize refusals', () => {
  const m = movie([{ id: 't1', content: [block()] }]);

  it('refuses a silent peak', () => {
    expect(() => normalize(m, 'b', 0)).toThrow(OpError);
    expect(() => normalize(m, 'b', Number.NaN)).toThrow(OpError);
  });

  it('refuses a loudness that cannot be measured', () => {
    expect(() => normalizeLoudness(m, 'b', Number.NEGATIVE_INFINITY, -14)).toThrow(OpError);
  });
});

describe('soundBlocks', () => {
  it('finds sound blocks at the top level and inside groups', () => {
    const inner = block({ id: 'inner' });
    const top = block({ id: 'top' });
    const group = block({ id: 'group', kind: 'group', tracks: [{ id: 'g1', content: [inner] }] });
    const image = block({ id: 'img', kind: 'image' });
    const found = soundBlocks(movie([{ id: 't1', content: [top, image] }, { id: 't2', content: [group] }]));
    expect(found.map((c) => c.id)).toEqual(['top', 'inner']);
  });

  it('is empty for a movie without sound', () => {
    expect(soundBlocks(movie([{ id: 't1', content: [block({ kind: 'image' })] }]))).toEqual([]);
  });
});
