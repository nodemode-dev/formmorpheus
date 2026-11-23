import { describe, expect, it, vi } from 'vitest';
import { loadWatermark, placeView } from '@src/export/reframe';
import type { Watermark } from '@src/export/types';

describe('placeView', () => {
  it('fits a wide movie into a tall output with equal bars', () => {
    const v = placeView({ width: 1080, height: 1920 }, 1920, 1080);
    expect(v.scale).toBeCloseTo(0.5625, 10);
    expect(v.ox).toBeCloseTo(0, 10);
    expect(v.oy).toBeCloseTo((1920 - 1080 * 0.5625) / 2, 10);
    expect(v.width).toBe(1080);
    expect(v.height).toBe(1920);
  });

  it('is the identity when the shapes match', () => {
    expect(placeView({ width: 640, height: 360, fit: 'cover' }, 640, 360)).toEqual({ scale: 1, ox: 0, oy: 0, width: 640, height: 360 });
  });

  it('covers the output and centres the crop by default', () => {
    const v = placeView({ width: 1080, height: 1920, fit: 'cover' }, 1920, 1080);
    const k = 1920 / 1080;
    expect(v.scale).toBeCloseTo(k, 10);
    expect(v.oy).toBeCloseTo(0, 10);
    expect(v.ox).toBeCloseTo((1080 - 1920 * k) / 2, 8);
  });

  it('moves the crop toward the focus point and stops at the picture edge', () => {
    const fw = 1920 * (1920 / 1080);
    const left = placeView({ width: 1080, height: 1920, fit: 'cover', focus: { x: 0, y: 0.5 } }, 1920, 1080);
    const right = placeView({ width: 1080, height: 1920, fit: 'cover', focus: { x: 1, y: 0.5 } }, 1920, 1080);
    const mid = placeView({ width: 1080, height: 1920, fit: 'cover', focus: { x: 0.4, y: 0.5 } }, 1920, 1080);
    expect(left.ox).toBeCloseTo(0, 10);
    expect(right.ox).toBeCloseTo(1080 - fw, 8);
    expect(mid.ox).toBeCloseTo(540 - 0.4 * fw, 8);
  });

  it('clamps a focus point outside the movie', () => {
    const a = placeView({ width: 1080, height: 1920, fit: 'cover', focus: { x: -3, y: 9 } }, 1920, 1080);
    const b = placeView({ width: 1080, height: 1920, fit: 'cover', focus: { x: 0, y: 1 } }, 1920, 1080);
    expect(a).toEqual(b);
  });

  it('applies the vertical focus when the crop is vertical', () => {
    const v = placeView({ width: 1920, height: 1080, fit: 'cover', focus: { x: 0.5, y: 1 } }, 1080, 1920);
    const fh = 1920 * (1920 / 1080);
    expect(v.ox).toBeCloseTo(0, 10);
    expect(v.oy).toBeCloseTo(1080 - fh, 8);
  });

  it('ignores the focus point when fitting', () => {
    const a = placeView({ width: 500, height: 500, fit: 'contain', focus: { x: 0, y: 0 } }, 1000, 500);
    expect(a).toEqual({ scale: 0.5, ox: 0, oy: 125, width: 500, height: 500 });
  });

  it('treats blur as fit unless a mode is forced', () => {
    const o = { width: 500, height: 500, fit: 'blur' as const };
    expect(placeView(o, 1000, 500).scale).toBe(0.5);
    expect(placeView(o, 1000, 500, 'cover').scale).toBe(1);
    expect(placeView({ width: 500, height: 500, fit: 'cover' }, 1000, 500, 'contain').scale).toBe(0.5);
  });
});

function fakeCtx(textWidth: number) {
  return {
    save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: textWidth })),
    globalAlpha: 1, globalCompositeOperation: '', font: '', textBaseline: '', shadowColor: '', shadowBlur: 0, fillStyle: '',
  };
}
type Fake = ReturnType<typeof fakeCtx>;
const asCtx = (c: Fake): OffscreenCanvasRenderingContext2D => c as unknown as OffscreenCanvasRenderingContext2D;
const text = (over: Partial<Watermark>): Watermark => ({ kind: 'text', text: 'mark', opacity: 0.5, size: 10, pos: 'br', color: '#ff0000', ...over } as Watermark);

describe('loadWatermark', () => {
  it('gives nothing when there is no watermark or it is invisible', async () => {
    expect(await loadWatermark(undefined)).toBeNull();
    expect(await loadWatermark(text({ opacity: 0 }))).toBeNull();
    expect(await loadWatermark(text({ opacity: -1 }))).toBeNull();
  });

  it('gives nothing for blank text or a picture mark without a picture', async () => {
    expect(await loadWatermark(text({ text: '   ' }))).toBeNull();
    expect(await loadWatermark(text({ kind: 'image', image: '' } as Partial<Watermark>))).toBeNull();
  });

  it('draws text in the bottom right corner inside a four percent margin', async () => {
    const wm = await loadWatermark(text({}));
    const ctx = fakeCtx(100);
    wm?.draw(asCtx(ctx), 1000, 500);
    expect(ctx.font).toContain('50px');
    expect(ctx.fillText).toHaveBeenCalledWith('mark', 1000 - 20 - 100, 500 - 20 - 50);
    expect(ctx.globalAlpha).toBe(0.5);
    expect(ctx.fillStyle).toBe('#ff0000');
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('places text at the top left and at the centre', async () => {
    const tl = fakeCtx(100);
    (await loadWatermark(text({ pos: 'tl' } as Partial<Watermark>)))?.draw(asCtx(tl), 1000, 500);
    expect(tl.fillText).toHaveBeenCalledWith('mark', 20, 20);
    const c = fakeCtx(100);
    (await loadWatermark(text({ pos: 'c' } as Partial<Watermark>)))?.draw(asCtx(c), 1000, 500);
    expect(c.fillText).toHaveBeenCalledWith('mark', 450, 225);
  });

  it('clamps opacity to one and the size to its limits', async () => {
    const big = fakeCtx(10);
    (await loadWatermark(text({ opacity: 7, size: 900 })))?.draw(asCtx(big), 400, 200);
    expect(big.globalAlpha).toBe(1);
    expect(big.font).toContain(' 200px');
    const small = fakeCtx(10);
    (await loadWatermark(text({ size: 0 })))?.draw(asCtx(small), 400, 200);
    expect(small.font).toContain(' 8px');
  });

  it('falls back to white when no colour is set', async () => {
    const ctx = fakeCtx(10);
    (await loadWatermark(text({ color: '' })))?.draw(asCtx(ctx), 400, 200);
    expect(ctx.fillStyle).toBe('#ffffff');
  });
});
