import { describe, expect, it } from 'vitest';
import { EXACT_NEAR, planThumbTimes } from '@src/media/key-thumbs';

type Sink = Parameters<typeof planThumbTimes>[0];
type Pkt = { timestamp: number };

function sink(keys: number[], fail = false): { s: Sink; calls: { key: number } } {
  const calls = { key: 0 };
  const s = {
    async getKeyPacket(t: number): Promise<Pkt | null> {
      calls.key++;
      if (fail) throw new Error('broken file');
      let best: Pkt | null = null;
      for (const k of keys) if (k <= t) best = { timestamp: k };
      return best;
    },
    async getNextKeyPacket(p: Pkt): Promise<Pkt | null> {
      const k = keys.find((x) => x > p.timestamp);
      return k === undefined ? null : { timestamp: k };
    },
    async getFirstKeyPacket(): Promise<Pkt | null> {
      return keys.length ? { timestamp: keys[0] } : null;
    },
  };
  return { s: s as unknown as Sink, calls };
}

describe('planThumbTimes', () => {
  it('keeps the exact time close behind a key frame and snaps others to the nearer key', async () => {
    const { s } = sink([0, 2, 4]);
    await expect(planThumbTimes(s, [0.1, 0.9, 1.5, 3.0, 5.5], 0, 5.9)).resolves.toEqual([0.1, 0, 2, 2, 4]);
  });

  it('keeps a time exactly EXACT_NEAR behind a key', async () => {
    const { s } = sink([0, 2]);
    await expect(planThumbTimes(s, [EXACT_NEAR, EXACT_NEAR + 0.05], 0, 3)).resolves.toEqual([EXACT_NEAR, 0]);
  });

  it('clamps requested times into the stream and keeps the snapped time inside it', async () => {
    const { s } = sink([0, 2, 4]);
    await expect(planThumbTimes(s, [-1, 99], 0.5, 5)).resolves.toEqual([0.5, 4]);
  });

  it('snaps a time before the first key to that key', async () => {
    const { s } = sink([1, 3]);
    await expect(planThumbTimes(s, [0.3], 0, 4)).resolves.toEqual([1]);
  });

  it('looks up the keys once for tiles in the same group of pictures', async () => {
    const { s, calls } = sink([0, 10]);
    await planThumbTimes(s, [0.5, 1, 2, 3, 9], 0, 12);
    expect(calls.key).toBe(1);
  });

  it('looks up again when a tile falls in another group of pictures', async () => {
    const { s, calls } = sink([0, 2, 4]);
    await planThumbTimes(s, [0.5, 2.5, 4.5], 0, 6);
    expect(calls.key).toBe(3);
  });

  it('keeps the clamped time of every tile when the key lookup fails', async () => {
    const { s, calls } = sink([0, 2], true);
    await expect(planThumbTimes(s, [0.7, 1.4, 9], 0, 3)).resolves.toEqual([0.7, 1.4, 3]);
    expect(calls.key).toBe(3);
  });

  it('returns an empty plan for no times', async () => {
    const { s, calls } = sink([0]);
    await expect(planThumbTimes(s, [], 0, 1)).resolves.toEqual([]);
    expect(calls.key).toBe(0);
  });
});
