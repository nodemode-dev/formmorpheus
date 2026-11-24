import { describe, expect, it } from 'vitest';
import { jsonLegacy, moveLegacy, readSeen, readState, type DockLegacy, type DockStore } from '@src/dock/state';

class MemStore implements DockStore {
  readonly data = new Map<string, string>();
  constructor(init: Record<string, string> = {}) { for (const [k, v] of Object.entries(init)) this.data.set(k, v); }
  getItem(key: string): string | null { return this.data.has(key) ? (this.data.get(key) as string) : null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

const defaults = { h: 240, w: 380 };

describe('readState', () => {
  it('returns closed bottom defaults when nothing is stored', () => {
    expect(readState(new MemStore(), 'dock', undefined, defaults)).toEqual({ open: false, side: 'bottom', h: 240, w: 380, tab: '' });
  });

  it('reads a stored state from its own key', () => {
    const store = new MemStore({ dock: JSON.stringify({ open: true, side: 'right', h: 100, w: 500, tab: 'term' }) });
    expect(readState(store, 'dock', undefined, defaults)).toEqual({ open: true, side: 'right', h: 100, w: 500, tab: 'term' });
  });

  it('replaces fields of the wrong type with safe values', () => {
    const store = new MemStore({ dock: JSON.stringify({ open: 'yes', side: 'left', h: '90', w: null, tab: 7 }) });
    expect(readState(store, 'dock', undefined, defaults)).toEqual({ open: false, side: 'bottom', h: 240, w: 380, tab: '' });
  });

  it('falls back to legacy keys when its own key is malformed', () => {
    const store = new MemStore({ dock: '{not json', old: JSON.stringify({ open: true, tab: 'chat' }) });
    expect(readState(store, 'dock', ['old'], defaults)).toMatchObject({ open: true, tab: 'chat', side: 'bottom' });
  });

  it('prefers its own key over legacy keys', () => {
    const store = new MemStore({ dock: JSON.stringify({ tab: 'mine' }), old: JSON.stringify({ tab: 'theirs' }) });
    expect(readState(store, 'dock', ['old'], defaults).tab).toBe('mine');
  });

  it('ignores stored values that are not objects', () => {
    const store = new MemStore({ dock: '42', old: 'null' });
    expect(readState(store, 'dock', ['old'], defaults)).toEqual({ open: false, side: 'bottom', h: 240, w: 380, tab: '' });
  });

  it('survives a legacy reader that throws', () => {
    const broken: DockLegacy = { keys: ['x'], read: () => { throw new Error('boom'); } };
    expect(readState(new MemStore(), 'dock', broken, defaults).h).toBe(240);
  });
});

describe('jsonLegacy', () => {
  it('returns the first legacy key that parses to an object and tags it with the seen flag', () => {
    const store = new MemStore({ a: 'broken{', b: JSON.stringify({ h: 77 }), c: JSON.stringify({ h: 99 }) });
    expect(jsonLegacy(['a', 'b', 'c'], true).read(store)).toEqual({ h: 77, seen: true });
  });

  it('returns null when no legacy key holds an object', () => {
    expect(jsonLegacy(['a', 'b']).read(new MemStore({ a: '"text"' }))).toBeNull();
  });
});

describe('readSeen', () => {
  it('is true only for a stored seen flag of exactly true', () => {
    expect(readSeen(new MemStore({ k: JSON.stringify({ seen: true }) }), 'k')).toBe(true);
    expect(readSeen(new MemStore({ k: JSON.stringify({ seen: 'true' }) }), 'k')).toBe(false);
    expect(readSeen(new MemStore({ k: JSON.stringify({}) }), 'k')).toBe(false);
  });

  it('is false for a missing or malformed entry', () => {
    expect(readSeen(new MemStore(), 'k')).toBe(false);
    expect(readSeen(new MemStore({ k: '{{' }), 'k')).toBe(false);
  });
});

describe('moveLegacy', () => {
  it('moves legacy state to the new key and removes every legacy key', () => {
    const store = new MemStore({ old1: JSON.stringify({ open: true, side: 'right', tab: 'x' }), old2: '{}' });
    expect(moveLegacy(store, 'dock', ['old1', 'old2'], defaults)).toBe(true);
    expect(store.getItem('old1')).toBeNull();
    expect(store.getItem('old2')).toBeNull();
    expect(JSON.parse(store.getItem('dock') ?? 'null')).toEqual({ open: true, side: 'right', h: 240, w: 380, tab: 'x' });
  });

  it('carries the seen flag when the legacy reader reports it', () => {
    const store = new MemStore({ old: JSON.stringify({ open: false }) });
    expect(moveLegacy(store, 'dock', jsonLegacy(['old'], true), defaults)).toBe(true);
    expect(readSeen(store, 'dock')).toBe(true);
  });

  it('does nothing when the new key already exists', () => {
    const store = new MemStore({ dock: JSON.stringify({ tab: 'new' }), old: JSON.stringify({ tab: 'old' }) });
    expect(moveLegacy(store, 'dock', ['old'], defaults)).toBe(false);
    expect(store.getItem('old')).not.toBeNull();
    expect(JSON.parse(store.getItem('dock') ?? 'null')).toEqual({ tab: 'new' });
  });

  it('does nothing when there is no legacy data or no legacy source', () => {
    const store = new MemStore();
    expect(moveLegacy(store, 'dock', ['old'], defaults)).toBe(false);
    expect(moveLegacy(store, 'dock', undefined, defaults)).toBe(false);
    expect(store.getItem('dock')).toBeNull();
  });

  it('reports false instead of throwing when the store refuses writes', () => {
    const store = new MemStore({ old: JSON.stringify({ open: true }) });
    store.setItem = () => { throw new Error('quota'); };
    expect(moveLegacy(store, 'dock', ['old'], defaults)).toBe(false);
    expect(store.getItem('old')).not.toBeNull();
  });
});
