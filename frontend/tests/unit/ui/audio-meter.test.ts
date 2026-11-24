import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/media/loudness', () => ({ lufsText: (v: number) => `${v} LUFS` }));

import { dbText, drawTrackMeter, meterPos } from '@src/ui/audio-meter';

interface Rect { fill: string; x: number; y: number; w: number; h: number }

function fakeContext(): { c: CanvasRenderingContext2D; rects: Rect[]; saves: number; restores: number } {
  const rects: Rect[] = [];
  const state = { fillStyle: '', globalAlpha: 1, saves: 0, restores: 0 };
  const c = {
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v: string) { state.fillStyle = v; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v: number) { state.globalAlpha = v; },
    save() { state.saves++; },
    restore() { state.restores++; },
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ fill: state.fillStyle, x, y, w, h }); },
  } as unknown as CanvasRenderingContext2D;
  return { c, rects, get saves() { return state.saves; }, get restores() { return state.restores; } };
}

describe('meterPos', () => {
  it('puts full scale at the top of the meter', () => {
    expect(meterPos(1)).toBe(1);
  });

  it('puts minus thirty decibels halfway up', () => {
    expect(meterPos(10 ** (-30 / 20))).toBeCloseTo(0.5, 9);
  });

  it('puts the minus sixty decibel floor at the bottom', () => {
    expect(meterPos(0.001)).toBeCloseTo(0, 9);
  });

  it('clamps levels below the floor to zero', () => {
    expect(meterPos(0.0001)).toBe(0);
  });

  it('clamps levels above full scale to one', () => {
    expect(meterPos(4)).toBe(1);
  });

  it('treats silence, negative and missing levels as zero', () => {
    expect(meterPos(0)).toBe(0);
    expect(meterPos(-0.5)).toBe(0);
    expect(meterPos(Number.NaN)).toBe(0);
  });

  it('rises with the level', () => {
    expect(meterPos(0.1)).toBeLessThan(meterPos(0.5));
    expect(meterPos(0.5)).toBeLessThan(meterPos(0.9));
  });
});

describe('dbText', () => {
  it('shows full scale as zero decibels with one decimal', () => {
    expect(dbText(1)).toBe('0.0 dB');
  });

  it('shows half amplitude as about minus six decibels', () => {
    expect(dbText(0.5)).toBe('-6.0 dB');
  });

  it('shows a tenth as minus twenty decibels', () => {
    expect(dbText(0.1)).toBe('-20.0 dB');
  });

  it('shows silence and negative levels as minus infinity', () => {
    expect(dbText(0)).toBe('-inf dB');
    expect(dbText(-1)).toBe('-inf dB');
  });
});

describe('drawTrackMeter', () => {
  it('draws nothing for a silent track without a clip', () => {
    const f = fakeContext();
    drawTrackMeter(f.c, { peak: 0, rms: 0, clip: false } as never, 0, 0, 4, 100, '#888');
    expect(f.rects).toHaveLength(0);
    expect(f.saves).toBe(0);
  });

  it('draws the body from the bottom up to the rms height and a peak tick', () => {
    const f = fakeContext();
    drawTrackMeter(f.c, { peak: 1, rms: 10 ** (-30 / 20), clip: false } as never, 10, 20, 4, 100, '#888');
    expect(f.rects).toHaveLength(2);
    const [body, tick] = f.rects;
    expect(body.fill).toBe('#888');
    expect(body.x).toBe(10);
    expect(body.h).toBeCloseTo(50, 6);
    expect(body.y + body.h).toBeCloseTo(120, 6);
    expect(tick.h).toBe(2);
    expect(tick.y).toBeCloseTo(19, 6);
    expect(tick.fill).not.toBe('#888');
    expect(f.saves).toBe(1);
    expect(f.restores).toBe(1);
  });

  it('draws a quiet peak tick in the body colour', () => {
    const f = fakeContext();
    drawTrackMeter(f.c, { peak: 0.1, rms: 0.05, clip: false } as never, 0, 0, 4, 60, '#123456');
    expect(f.rects).toHaveLength(2);
    expect(f.rects[1].fill).toBe('#123456');
    expect(f.rects[1].y).toBeCloseTo(60 - 60 * meterPos(0.1) - 1, 6);
  });

  it('adds a clip light on top when the track clipped, even when silent now', () => {
    const f = fakeContext();
    drawTrackMeter(f.c, { peak: 0, rms: 0, clip: true } as never, 5, 7, 4, 60, '#888');
    const top = f.rects[f.rects.length - 1];
    expect(top).toMatchObject({ x: 5, y: 7, w: 4, h: 3 });
    expect(top.fill).not.toBe('#888');
    expect(f.restores).toBe(1);
  });
});
