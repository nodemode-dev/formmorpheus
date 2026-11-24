import { describe, expect, it } from 'vitest';
import { ProgressMeter, clock, planFor } from '@src/export/progress-meter';
import type { ExportFormat } from '@src/export/types';

const GIF = 'gif' as ExportFormat;

describe('planFor', () => {
  it('puts the sound first when there is sound', () => {
    expect(planFor(GIF, { engine: false, audio: true })[0].stage).toBe('audio');
    expect(planFor(GIF, { engine: false, audio: false })[0].stage).toBe('frames');
  });

  it('gives animated pictures and engine jobs an encoding stage', () => {
    expect(planFor(GIF, { engine: false, audio: false }).map((s) => s.stage)).toEqual(['frames', 'encoding', 'finishing']);
    expect(planFor('nothing-special' as ExportFormat, { engine: true, audio: false }).map((s) => s.stage)).toEqual(['frames', 'encoding', 'finishing']);
    expect(planFor('nothing-special' as ExportFormat, { engine: false, audio: false }).map((s) => s.stage)).toEqual(['frames', 'finishing']);
  });

  it('never plans more than the whole job', () => {
    for (const engine of [true, false]) for (const audio of [true, false]) {
      const sum = planFor(GIF, { engine, audio }).reduce((a, s) => a + s.weight, 0);
      expect(sum).toBeLessThanOrEqual(1.0000001);
      expect(sum).toBeGreaterThan(0.9);
    }
  });
});

describe('ProgressMeter', () => {
  const make = (): { m: ProgressMeter; at: (t: number) => void } => {
    let t = 0;
    const m = new ProgressMeter(planFor(GIF, { engine: false, audio: false }), () => t);
    return { m, at: (v) => { t = v; } };
  };

  it('weights progress inside a stage by the share of that stage', () => {
    const { m } = make();
    expect(m.update({ stage: 'frames', done: 5, total: 10 }).frac).toBeCloseTo(0.2, 10);
    expect(m.update({ stage: 'encoding', done: 10, total: 10 }).frac).toBeCloseTo(0.93, 10);
  });

  it('never goes down', () => {
    const { m } = make();
    m.update({ stage: 'frames', done: 8, total: 10 });
    const r = m.update({ stage: 'frames', done: 2, total: 10 });
    expect(r.frac).toBeCloseTo(0.32, 10);
    expect(r.done).toBe(2);
  });

  it('clamps reports outside the stage and ignores a zero total', () => {
    const { m } = make();
    expect(m.update({ stage: 'frames', done: 5, total: 0 }).frac).toBe(0);
    expect(m.update({ stage: 'frames', done: -5, total: 10 }).frac).toBe(0);
    expect(m.update({ stage: 'frames', done: 50, total: 10 }).frac).toBeCloseTo(0.4, 10);
  });

  it('keeps the fraction on a stage that is not in the plan', () => {
    const { m } = make();
    m.update({ stage: 'frames', done: 5, total: 10 });
    const r = m.update({ stage: 'audio', done: 1, total: 1 });
    expect(r.frac).toBeCloseTo(0.2, 10);
    expect(r.stage).toBe('audio');
  });

  it('gives no estimate until there is enough to go on', () => {
    const { m, at } = make();
    expect(m.update({ stage: 'frames', done: 25, total: 100 }).etaMs).toBeNull();
    at(500);
    expect(m.update({ stage: 'frames', done: 50, total: 100 }).etaMs).toBeNull();
  });

  it('estimates the time left from the rate so far and counts it down between reports', () => {
    const { m, at } = make();
    m.update({ stage: 'frames', done: 25, total: 100 });
    at(2000);
    const r = m.update({ stage: 'frames', done: 50, total: 100 });
    expect(r.elapsedMs).toBe(2000);
    expect(r.etaMs).toBeCloseTo(16000, 6);
    at(3000);
    const later = m.read();
    expect(later.elapsedMs).toBe(3000);
    expect(later.etaMs).toBeCloseTo(15000, 6);
    expect(later.frac).toBeCloseTo(0.2, 10);
  });

  it('gives no estimate below five percent', () => {
    const { m, at } = make();
    m.update({ stage: 'frames', done: 1, total: 100 });
    at(5000);
    expect(m.update({ stage: 'frames', done: 5, total: 100 }).etaMs).toBeNull();
  });

  it('gives no estimate while finishing', () => {
    const { m, at } = make();
    m.update({ stage: 'frames', done: 50, total: 100 });
    at(3000);
    m.update({ stage: 'encoding', done: 50, total: 100 });
    at(6000);
    expect(m.update({ stage: 'finishing', done: 0, total: 1 }).etaMs).toBeNull();
  });

  it('starts on the first planned stage with nothing done', () => {
    const { m } = make();
    expect(m.read()).toMatchObject({ stage: 'frames', done: 0, total: 0, frac: 0, etaMs: null });
  });
});

describe('clock', () => {
  it('shows minutes and padded seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65_000)).toBe('1:05');
    expect(clock(59_499)).toBe('0:59');
  });

  it('shows hours from one hour', () => {
    expect(clock(3_661_000)).toBe('1:01:01');
  });

  it('treats a negative time as zero', () => {
    expect(clock(-5000)).toBe('0:00');
  });
});
