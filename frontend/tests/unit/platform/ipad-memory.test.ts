import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BudgetKey, TierName } from '@src/platform/ipad-memory';

type Mem = (typeof import('@src/platform/ipad-memory'))['memory'];
interface Host { __FM_PLATFORM__?: unknown }

const KEYS: BudgetKey[] = [
  'gpuTexture', 'gpuPoolIdle', 'bitmaps', 'preload', 'frameStore', 'videoFrames', 'videoThumbs', 'videoLanes',
  'paintHistory', 'paintDense', 'paintMirror', 'tipCache', 'audioBus', 'audioFx', 'undoDepth', 'undoFloor',
  'paintUndoDepth', 'onionFrames', 'onionGhosts', 'exportAhead', 'flatArea', 'gifMemory', 'decodeBytes',
];

async function loadWith(forced: string | null, platform?: unknown): Promise<Mem> {
  if (forced === null) localStorage.removeItem('fm-memory-tier');
  else localStorage.setItem('fm-memory-tier', forced);
  if (platform === undefined) delete (window as unknown as Host).__FM_PLATFORM__;
  else (window as unknown as Host).__FM_PLATFORM__ = platform;
  vi.resetModules();
  return (await import('@src/platform/ipad-memory')).memory;
}

afterEach(() => {
  localStorage.removeItem('fm-memory-tier');
  delete (window as unknown as Host).__FM_PLATFORM__;
});

describe('memory tiers', () => {
  it('stays on desktop limits with no shell and no forced tier', async () => {
    const m = await loadWith(null);
    expect(m.kind).toBe('desktop');
    expect(m.tier).toBe('desktop');
    expect(m.get('undoDepth')).toBe(Infinity);
    for (const k of KEYS) expect(m.lower(k)).toBe(m.get(k));
  });

  it('uses a forced tier and treats the app as the iPad', async () => {
    const m = await loadWith('mid');
    expect(m.kind).toBe('ipad');
    expect(m.tier).toBe('mid');
  });

  it('ignores an unknown forced tier', async () => {
    const m = await loadWith('huge');
    expect(m.kind).toBe('desktop');
    expect(m.tier).toBe('desktop');
  });

  it('keeps desktop limits when desktop is forced on the iPad', async () => {
    const m = await loadWith('desktop', { kind: 'ipad' });
    expect(m.kind).toBe('desktop');
    expect(m.get('undoDepth')).toBe(Infinity);
  });

  it('never raises a limit from one tier to the next lower one', async () => {
    const order: TierName[] = ['desktop', 'high', 'mid', 'low', 'floor'];
    const tables: Array<Record<string, number>> = [];
    for (const t of order) {
      const m = await loadWith(t === 'desktop' ? null : t);
      expect(m.tier).toBe(t);
      tables.push(Object.fromEntries(KEYS.map((k) => [k, m.get(k)])));
    }
    for (let i = 1; i < tables.length; i++) {
      for (const k of KEYS) {
        expect(tables[i][k]).toBeGreaterThan(0);
        expect(tables[i][k]).toBeLessThanOrEqual(tables[i - 1][k]);
        expect(Number.isFinite(tables[i][k])).toBe(true);
      }
    }
  });

  it('gives the next tier down as the lower limit and holds at the floor', async () => {
    const low = await loadWith('low');
    const lowValues = KEYS.map((k) => low.lower(k));
    const floor = await loadWith('floor');
    expect(lowValues).toEqual(KEYS.map((k) => floor.get(k)));
    for (const k of KEYS) expect(floor.lower(k)).toBe(floor.get(k));
  });
});
