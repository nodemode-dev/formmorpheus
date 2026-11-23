import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Content, KeyKind } from '@src/engine/types';
import { laneFocus, stepLaneFocus } from '@src/ui/lane-focus';

function block(id: string, kinds: string[]): Content {
  return { id, keys: kinds.map((kind) => ({ kind, channels: {} })) } as unknown as Content;
}

const k = (s: string): KeyKind => s as KeyKind;

beforeEach(() => {
  laneFocus.id = null;
  laneFocus.kind = null;
  laneFocus.onChange = null;
});

describe('stepLaneFocus', () => {
  it('lands on the first lane when stepping down without a focus', () => {
    expect(stepLaneFocus(block('a', ['move', 'opacity', 'blur']), 1)).toBe(true);
    expect(laneFocus).toMatchObject({ id: 'a', kind: 'move' });
  });

  it('lands on the last lane when stepping up without a focus', () => {
    expect(stepLaneFocus(block('a', ['move', 'opacity', 'blur']), -1)).toBe(true);
    expect(laneFocus).toMatchObject({ id: 'a', kind: 'blur' });
  });

  it('walks the lanes in order in both directions', () => {
    const c = block('a', ['move', 'opacity', 'blur']);
    stepLaneFocus(c, 1);
    stepLaneFocus(c, 1);
    expect(laneFocus.kind).toBe('opacity');
    stepLaneFocus(c, 1);
    expect(laneFocus.kind).toBe('blur');
    stepLaneFocus(c, -1);
    expect(laneFocus.kind).toBe('opacity');
  });

  it('clears the focus and returns false when stepping past the last lane', () => {
    const c = block('a', ['move', 'opacity']);
    laneFocus.id = 'a';
    laneFocus.kind = k('opacity');
    expect(stepLaneFocus(c, 1)).toBe(false);
    expect(laneFocus.id).toBeNull();
    expect(laneFocus.kind).toBeNull();
  });

  it('clears the focus and returns false when stepping above the first lane', () => {
    const c = block('a', ['move', 'opacity']);
    laneFocus.id = 'a';
    laneFocus.kind = k('move');
    expect(stepLaneFocus(c, -1)).toBe(false);
    expect(laneFocus.id).toBeNull();
  });

  it('returns false for a block without lanes and leaves the focus alone', () => {
    const onChange = vi.fn();
    laneFocus.id = 'other';
    laneFocus.kind = k('move');
    laneFocus.onChange = onChange;
    expect(stepLaneFocus(block('a', []), 1)).toBe(false);
    expect(laneFocus).toMatchObject({ id: 'other', kind: 'move' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('starts from the end of the block when the focus is on another block', () => {
    laneFocus.id = 'other';
    laneFocus.kind = k('opacity');
    expect(stepLaneFocus(block('a', ['move', 'opacity', 'blur']), 1)).toBe(true);
    expect(laneFocus).toMatchObject({ id: 'a', kind: 'move' });
  });

  it('starts fresh when the focused kind is not a lane of the block', () => {
    laneFocus.id = 'a';
    laneFocus.kind = k('volume');
    expect(stepLaneFocus(block('a', ['move', 'opacity']), -1)).toBe(true);
    expect(laneFocus.kind).toBe('opacity');
  });

  it('tells the listener about every change, including the clearing step', () => {
    const onChange = vi.fn();
    laneFocus.onChange = onChange;
    const c = block('a', ['move']);
    stepLaneFocus(c, 1);
    stepLaneFocus(c, 1);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(laneFocus.id).toBeNull();
  });
});
