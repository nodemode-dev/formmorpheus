import { describe, expect, it, vi } from 'vitest';
import { anchorMode } from '@src/ui/anchor-mode';

describe('anchorMode', () => {
  it('turns on for one content and tells its listeners', () => {
    anchorMode.stop();
    const fn = vi.fn();
    anchorMode.onChange(fn);
    anchorMode.start('box-1');
    expect(anchorMode.on).toBe(true);
    expect(anchorMode.id).toBe('box-1');
    expect(fn).toHaveBeenCalledTimes(1);
    anchorMode.stop();
  });

  it('turns off, forgets the content and tells its listeners once', () => {
    anchorMode.start('box-2');
    const fn = vi.fn();
    anchorMode.onChange(fn);
    anchorMode.stop();
    expect(anchorMode.on).toBe(false);
    expect(anchorMode.id).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not notify when stopped while already off', () => {
    anchorMode.stop();
    const fn = vi.fn();
    anchorMode.onChange(fn);
    anchorMode.stop();
    expect(fn).not.toHaveBeenCalled();
  });

  it('moves to another content when started again', () => {
    anchorMode.start('a');
    anchorMode.start('b');
    expect(anchorMode.id).toBe('b');
    expect(anchorMode.on).toBe(true);
    anchorMode.stop();
  });

  it('sees the new state inside the listener', () => {
    anchorMode.stop();
    const seen: Array<[boolean, string | null]> = [];
    anchorMode.onChange(() => seen.push([anchorMode.on, anchorMode.id]));
    anchorMode.start('c');
    anchorMode.stop();
    expect(seen.slice(-2)).toEqual([[true, 'c'], [false, null]]);
  });
});
