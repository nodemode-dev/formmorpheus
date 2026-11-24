import { beforeEach, describe, expect, it, vi } from 'vitest';
import { warpMode } from '@src/ui/warp-view';

beforeEach(() => {
  warpMode.set(null);
  warpMode.pick(0);
});

describe('warpMode', () => {
  it('starts a warp on a block and tells listeners', () => {
    const fn = vi.fn();
    warpMode.onChange(fn);
    warpMode.set('warp', 'b1');
    expect(warpMode.kind).toBe('warp');
    expect(warpMode.id).toBe('b1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not tell listeners when the same mode is set on the same block again', () => {
    warpMode.set('distort', 'b1');
    const fn = vi.fn();
    warpMode.onChange(fn);
    warpMode.set('distort', 'b1');
    expect(fn).not.toHaveBeenCalled();
  });

  it('follows a change of block within the same mode', () => {
    warpMode.set('warp', 'b1');
    const fn = vi.fn();
    warpMode.onChange(fn);
    warpMode.set('warp', 'b2');
    expect(warpMode.id).toBe('b2');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('switches between warp and distort', () => {
    warpMode.set('warp', 'b1');
    warpMode.set('distort', 'b1');
    expect(warpMode.kind).toBe('distort');
    expect(warpMode.id).toBe('b1');
  });

  it('forgets the block when it is turned off, even if a block is passed', () => {
    warpMode.set('warp', 'b1');
    warpMode.set(null, 'b1');
    expect(warpMode.kind).toBeNull();
    expect(warpMode.id).toBeNull();
  });

  it('records the grabbed handle and tells listeners only when it changes', () => {
    const fn = vi.fn();
    warpMode.onChange(fn);
    warpMode.pick(3);
    warpMode.pick(3);
    expect(warpMode.handle).toBe(3);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
