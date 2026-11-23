import { describe, expect, it } from 'vitest';
import { TIP_LIST, TIP_SIDE, hasTip, libTipImage, tipName } from '@src/paint/tips-lib';

describe('tip library', () => {
  it('lists tips with unique ids and a name and group each', () => {
    expect(TIP_LIST.length).toBeGreaterThan(10);
    expect(new Set(TIP_LIST.map((t) => t.id)).size).toBe(TIP_LIST.length);
    for (const t of TIP_LIST) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.group.length).toBeGreaterThan(0);
    }
  });

  it('knows every listed id and refuses an unknown one', () => {
    for (const t of TIP_LIST) expect(hasTip(t.id)).toBe(true);
    expect(hasTip('no-such-tip')).toBe(false);
    expect(hasTip('')).toBe(false);
  });

  it('names a known tip and falls back to the id for an unknown one', () => {
    const t = TIP_LIST[0];
    expect(tipName(t.id)).toBe(t.name);
    expect(tipName('no-such-tip')).toBe('no-such-tip');
  });

  it('returns undefined for the picture of an unknown id', () => {
    expect(libTipImage('no-such-tip')).toBeUndefined();
  });

  it('renders a square coverage picture keyed by the tip id', () => {
    const img = libTipImage('stamp-snow');
    expect(img).toBeDefined();
    expect(img!.w).toBe(TIP_SIDE);
    expect(img!.h).toBe(TIP_SIDE);
    expect(img!.data.length).toBe(TIP_SIDE * TIP_SIDE);
    expect(img!.key).toBe('lib:stamp-snow');
  });

  it('returns the same picture object on the second request', () => {
    expect(libTipImage('stamp-snow')).toBe(libTipImage('stamp-snow'));
  });

  it('draws ink inside and pins the whole border to zero', () => {
    const S = TIP_SIDE;
    for (const t of TIP_LIST.slice(0, 12).concat(TIP_LIST.slice(-4))) {
      const img = libTipImage(t.id)!;
      let max = 0;
      for (let i = 0; i < img.data.length; i++) if (img.data[i] > max) max = img.data[i];
      expect(max, t.id).toBeGreaterThan(100);
      let border = 0;
      for (let k = 0; k < S; k++) border += img.data[k] + img.data[(S - 1) * S + k] + img.data[k * S] + img.data[k * S + S - 1];
      expect(border, t.id).toBe(0);
    }
  });

  it('gives different tips different pictures and keys', () => {
    const a = libTipImage('stamp-snow')!;
    const b = libTipImage('stamp-rain')!;
    expect(a.key).not.toBe(b.key);
    let differ = 0;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) differ++;
    expect(differ).toBeGreaterThan(100);
  });
});
