import { afterEach, describe, expect, it, vi } from 'vitest';
import { runFx } from '@src/media/audio-dsp-client';
import type { AudioFx } from '@src/engine/audio-fx';

const fx: AudioFx = { comp: { threshold: -30, ratio: 1, attack: 1, release: 50, makeup: 6, knee: 0 } };
const boost = Math.pow(10, 6 / 20);

describe('runFx without a worker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('runs the chain inline and leaves the input untouched', async () => {
    vi.stubGlobal('Worker', undefined);
    const input = [Float32Array.from([0.25, 0.25])];
    const out = await runFx(input, 48000, fx);
    expect(out?.[0][1]).toBeCloseTo(0.25 * boost, 5);
    expect(input[0][1]).toBe(0.25);
  });

  it('sends the first request of a tag at once', async () => {
    vi.stubGlobal('Worker', undefined);
    const out = await runFx([Float32Array.from([0.5])], 48000, fx, 'first-tag');
    expect(out?.[0][0]).toBeCloseTo(0.5 * boost, 5);
  });

  it('supersedes a waiting request of the same tag with the newer one', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.useFakeTimers();
    await runFx([Float32Array.from([0.1])], 48000, fx, 'drag');
    const older = runFx([Float32Array.from([0.2])], 48000, fx, 'drag');
    const newer = runFx([Float32Array.from([0.3])], 48000, fx, 'drag');
    await expect(older).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    const out = await newer;
    expect(out?.[0][0]).toBeCloseTo(0.3 * boost, 5);
  });
});
