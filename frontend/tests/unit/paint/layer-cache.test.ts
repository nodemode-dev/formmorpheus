import { describe, expect, it } from 'vitest';
import { LayerCache, type CacheItem } from '@src/paint/layer-cache';
import { hasTree } from '@src/paint/layer-tree';

function item(id: string, over: Partial<CacheItem> = {}): CacheItem {
  return { id, visible: true, opacity: 1, blend: 'normal', clipping: false, version: 0, ...over };
}

describe('LayerCache.fits', () => {
  it('accepts a plain stack that holds the active layer', () => {
    expect(LayerCache.fits([item('a'), item('b'), item('c')], 'b')).toBe(true);
  });

  it('refuses a list without the active layer', () => {
    expect(LayerCache.fits([item('a'), item('b')], 'zz')).toBe(false);
    expect(LayerCache.fits([], 'a')).toBe(false);
  });

  it('allows a blend mode on the active layer only', () => {
    expect(LayerCache.fits([item('a'), item('b', { blend: 'multiply' })], 'b')).toBe(true);
    expect(LayerCache.fits([item('a', { blend: 'multiply' }), item('b')], 'b')).toBe(false);
  });

  it('refuses groups, children, clipping layers and masks anywhere', () => {
    expect(LayerCache.fits([item('a', { group: true }), item('b')], 'b')).toBe(false);
    expect(LayerCache.fits([item('a', { parent: 'g' }), item('b')], 'b')).toBe(false);
    expect(LayerCache.fits([item('a'), item('b', { clipping: true })], 'b')).toBe(false);
    expect(LayerCache.fits([item('a', { mask: {} }), item('b')], 'b')).toBe(false);
  });
});

describe('hasTree', () => {
  it('is false for an empty list and for plain layers', () => {
    expect(hasTree([])).toBe(false);
    expect(hasTree([{}, { group: false, mask: null }])).toBe(false);
  });

  it('is true when the list holds a group', () => {
    expect(hasTree([{}, { group: true }])).toBe(true);
  });

  it('counts a mask unless it is switched off', () => {
    expect(hasTree([{ mask: {} }])).toBe(true);
    expect(hasTree([{ mask: {}, maskOn: true }])).toBe(true);
    expect(hasTree([{ mask: {}, maskOn: false }])).toBe(false);
  });
});
