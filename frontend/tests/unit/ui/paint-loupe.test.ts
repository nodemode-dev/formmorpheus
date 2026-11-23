import { describe, expect, it, vi } from 'vitest';
import type { RGB } from '@src/paint/types';
import { Loupe, type LoupeHost } from '@src/ui/paint-loupe';

vi.mock('@src/paint/viewmath', () => ({ loupePlacement: (x: number, y: number): { x: number; y: number } => ({ x, y }) }));

const setup = (pick: RGB | null, dpr = 2) => {
  const ctx = { imageSmoothingEnabled: true, clearRect: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
  const source = document.createElement('canvas');
  source.getBoundingClientRect = (): DOMRect => ({ left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, x: 10, y: 20, toJSON: () => ({}) }) as DOMRect;
  const sample = vi.fn((): RGB | null => pick);
  const host: LoupeHost = { source, dpr: () => dpr, sample };
  return { loupe: new Loupe(host), ctx, sample, source };
};

const prev: RGB = { r: 1, g: 2, b: 3 };

describe('Loupe', () => {
  it('starts hidden and idle with smoothing off for crisp pixels', () => {
    const { loupe, ctx } = setup({ r: 9, g: 9, b: 9 });
    expect(loupe.active).toBe(false);
    expect(loupe.held).toBe(false);
    expect(loupe.colour).toBeNull();
    expect(loupe.root.hidden).toBe(true);
    expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  it('ignores moves while hidden', () => {
    const { loupe, sample, ctx } = setup({ r: 9, g: 9, b: 9 });
    loupe.move(50, 50);
    expect(sample).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('samples the colour under the pointer when shown', () => {
    const { loupe, sample } = setup({ r: 200, g: 100, b: 50 });
    loupe.show(110, 120, prev, false);
    expect(loupe.active).toBe(true);
    expect(loupe.held).toBe(false);
    expect(loupe.root.hidden).toBe(false);
    expect(sample).toHaveBeenCalledWith(110, 120);
    expect(loupe.colour).toEqual({ r: 200, g: 100, b: 50 });
    expect(loupe.root.style.getPropertyValue('--cur')).toBe('rgb(200, 100, 50)');
    expect(loupe.root.style.getPropertyValue('--prev')).toBe('rgb(1, 2, 3)');
  });

  it('shows a clear ring over an empty spot', () => {
    const { loupe } = setup(null);
    loupe.show(110, 120, prev, false);
    expect(loupe.colour).toBeNull();
    expect(loupe.root.style.getPropertyValue('--cur')).toBe('transparent');
  });

  it('centres itself on the pointer inside the view', () => {
    const { loupe } = setup(null);
    loupe.show(110, 120, prev, false);
    expect(loupe.root.style.transform).toBe('translate(34px, 34px)');
  });

  it('magnifies twelve screen pixels around the pointer at device scale', () => {
    const { loupe, ctx, source } = setup(null, 2);
    loupe.show(110, 120, prev, false);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 96, 96);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(source, 188, 188, 24, 24, 0, 0, 96, 96);
  });

  it('tracks the press and drops it on hide', () => {
    const { loupe, sample } = setup(null);
    loupe.show(110, 120, prev, true);
    expect(loupe.held).toBe(true);
    loupe.hide();
    expect(loupe.active).toBe(false);
    expect(loupe.held).toBe(false);
    expect(loupe.root.hidden).toBe(true);
    loupe.press();
    expect(loupe.held).toBe(true);
    const n = sample.mock.calls.length;
    loupe.move(200, 200);
    expect(sample.mock.calls.length).toBe(n);
  });
});
