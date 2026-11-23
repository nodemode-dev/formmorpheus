import { describe, expect, it } from 'vitest';
import { fitBase, isScaleChannel } from '@src/engine/fit-base';
import { canSize, scaleFor, sizeContent, sizedTransform } from '@src/engine/fit-ops';
import { content, newMovie, track } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import type { Asset, Content, Movie } from '@src/engine/types';

function setup(w: number, h: number, items: Content[]): Movie {
  const a: Asset = { id: 'pic', kind: 'image', name: 'pic', mime: 'image/png', width: w, height: h, frames: 1, size: 1 };
  return { ...newMovie({ width: 1000, height: 500 }), assets: { pic: a }, tracks: [track('A', items)] };
}

describe('scaleFor', () => {
  it('fits inside the movie by the tighter side', () => {
    expect(scaleFor('fit', 1000, 500, 500, 500)).toBe(1);
    expect(scaleFor('fit', 1000, 500, 2000, 500)).toBe(0.5);
  });

  it('fills the movie by the looser side', () => {
    expect(scaleFor('fill', 1000, 500, 500, 500)).toBe(2);
    expect(scaleFor('fill', 1000, 500, 2000, 500)).toBe(1);
  });

  it('keeps the original size at scale one', () => {
    expect(scaleFor('original', 1000, 500, 37, 91)).toBe(1);
  });

  it('rounds to four decimals', () => {
    expect(scaleFor('fit', 1000, 1000, 3000, 3000)).toBe(0.3333);
  });

  it('answers one for a picture without a size', () => {
    expect(scaleFor('fit', 1000, 500, 0, 100)).toBe(1);
    expect(scaleFor('fill', 1000, 500, 100, -1)).toBe(1);
    expect(scaleFor('fit', 1000, 500, Number.NaN, 100)).toBe(1);
  });
});

describe('sizing content', () => {
  it('allows only pictures and video', () => {
    expect(canSize(content('image', 0, 1))).toBe(true);
    expect(canSize(content('video', 0, 1))).toBe(true);
    expect(canSize(content('text', 0, 1))).toBe(false);
    expect(canSize(content('audio', 0, 1))).toBe(false);
  });

  it('centres the picture, drops the stretch and keeps rotation and flips', () => {
    const c = content('image', 0, 5, { asset: 'pic' });
    c.transform = { ...c.transform, x: 40, y: -9, scale: 7, rotation: 30, flipH: true, stretchX: 2, stretchY: 3 } as Content['transform'];
    const t = sizedTransform('fill', setup(250, 250, [c]), c);
    expect(t).toMatchObject({ x: 0, y: 0, scale: 4, rotation: 30, flipH: true });
    expect('stretchX' in t).toBe(false);
    expect('stretchY' in t).toBe(false);
    expect(c.transform.x).toBe(40);
  });

  it('sizes the pictures among the ids and leaves other blocks alone', () => {
    const pic = content('image', 0, 5, { asset: 'pic' });
    const txt = content('text', 0, 5);
    const m = sizeContent(setup(250, 250, [pic, txt]), [pic.id, txt.id, 'ghost'], 'fit');
    expect(m.tracks[0].content[0].transform.scale).toBe(2);
    expect(m.tracks[0].content[1]).toBe(txt);
  });

  it('refuses when none of the ids is a picture or video', () => {
    const txt = content('text', 0, 5);
    const m = setup(250, 250, [txt]);
    expect(() => sizeContent(m, [txt.id], 'fit')).toThrow(OpError);
    expect(() => sizeContent(m, [], 'fill')).toThrow(OpError);
  });
});

describe('fitBase', () => {
  it('is the fit scale of a picture and one for other kinds', () => {
    const pic = content('image', 0, 5, { asset: 'pic' });
    const m = setup(250, 500, [pic]);
    expect(fitBase(m, pic)).toBe(1);
    expect(fitBase(setup(4000, 500, [pic]), pic)).toBe(0.25);
    expect(fitBase(m, content('text', 0, 5, { asset: 'pic' }))).toBe(1);
  });

  it('is one when the asset is missing or has no size', () => {
    const m = setup(0, 500, []);
    expect(fitBase(m, content('image', 0, 5, { asset: 'pic' }))).toBe(1);
    expect(fitBase(m, content('video', 0, 5, { asset: 'gone' }))).toBe(1);
    expect(fitBase(m, content('image', 0, 5))).toBe(1);
  });

  it('recognises the two scale channels only', () => {
    expect(isScaleChannel('scaleX')).toBe(true);
    expect(isScaleChannel('scaleY')).toBe(true);
    expect(isScaleChannel('scale')).toBe(false);
    expect(isScaleChannel('x')).toBe(false);
  });
});
