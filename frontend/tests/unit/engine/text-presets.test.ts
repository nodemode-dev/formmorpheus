import { describe, expect, it } from 'vitest';
import { TITLE_PRESETS } from '@src/engine/text-presets';
import type { TextStyle } from '@src/engine/types';

const worn = (): TextStyle => ({
  text: 'Hello there', font: 'Display', size: 33, weight: 400, color: '#123456', align: 'right',
  runs: [{ from: 0, to: 2, color: '#f00' }], shadow: { color: '#000', angle: 0, distance: 1, blur: 1 }, italic: true, tracking: 15,
}) as unknown as TextStyle;

const preset = (id: string) => {
  const p = TITLE_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
};

describe('title presets', () => {
  it('have unique ids, a label and a hint', () => {
    expect(new Set(TITLE_PRESETS.map((p) => p.id)).size).toBe(TITLE_PRESETS.length);
    for (const p of TITLE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
    }
  });

  it('keep the words and the font family a person chose', () => {
    for (const p of TITLE_PRESETS) {
      const out = p.apply(worn(), 1920, 1080);
      expect(out.text).toBe('Hello there');
      expect(out.font).toBe('Display');
    }
  });

  it('take the old styled runs off and leave no undefined fields', () => {
    for (const p of TITLE_PRESETS) {
      const out = p.apply(worn(), 1920, 1080) as unknown as Record<string, unknown>;
      expect('runs' in out).toBe(false);
      for (const k of Object.keys(out)) expect(out[k]).not.toBeUndefined();
    }
  });

  it('do not change the style they were given', () => {
    const src = worn();
    const before = JSON.stringify(src);
    for (const p of TITLE_PRESETS) p.apply(src, 1920, 1080);
    expect(JSON.stringify(src)).toBe(before);
  });

  it('size the text from the movie height, not its width', () => {
    for (const p of TITLE_PRESETS.filter((x) => x.id !== 'plain')) {
      const small = p.apply(worn(), 1920, 1000).size;
      const big = p.apply(worn(), 1920, 2000).size;
      const wide = p.apply(worn(), 4000, 1000).size;
      expect(big).toBe(small * 2);
      expect(wide).toBe(small);
      expect(Number.isInteger(small)).toBe(true);
    }
  });

  it('strip every effect with the plain preset and keep size and color', () => {
    const out = preset('plain').apply(worn(), 1920, 1080) as unknown as Record<string, unknown>;
    expect(out).toEqual({ text: 'Hello there', font: 'Display', size: 33, weight: 400, color: '#123456', align: 'right' });
  });

  it('build the lower third on from the left on a bar', () => {
    const out = preset('lower-third').apply(worn(), 1920, 1000);
    expect(out.align).toBe('left');
    expect(out.box).toMatchObject({ mode: 'block', padding: 22 });
    expect(out.anim?.in).toMatchObject({ unit: 'line', slide: { dir: 'left', dist: 80 } });
    expect(out.anim?.out?.ease).toBe('in');
  });

  it('give the subtitle a box per line and no motion', () => {
    const out = preset('subtitle').apply(worn(), 1920, 1000);
    expect(out.box).toMatchObject({ mode: 'line' });
    expect(out.anim).toBeUndefined();
    expect(out.shadow).toBeUndefined();
  });

  it('type the typewriter out with a cursor and erase it', () => {
    const out = preset('typewriter').apply(worn(), 1920, 1000);
    expect(out.anim?.type).toMatchObject({ cursor: true, erase: true });
    expect(out.anim?.in).toBeUndefined();
  });

  it('never thin the outline below two pixels', () => {
    expect(preset('outline').apply(worn(), 320, 100).stroke?.width).toBe(2);
    expect(preset('outline').apply(worn(), 1920, 1000).stroke?.width).toBe(8);
  });
});
