import { describe, expect, it, vi } from 'vitest';
import type { Command, Commands } from '@src/ui/commands';
import { paintCommandDefs, paintCommandFor, type PaintKeyHost } from '@src/ui/paint-keys';

interface KeyOpts { alt?: boolean; shift?: boolean; mod?: boolean }

const key = (code: string, k: string, o: KeyOpts = {}): KeyboardEvent =>
  ({ code, key: k, altKey: !!o.alt, shiftKey: !!o.shift, ctrlKey: !!o.mod, metaKey: !!o.mod }) as unknown as KeyboardEvent;

const table = (over: { scoped?: string; combo?: string; keysOf?: Record<string, string[]> }): Commands =>
  ({
    forScoped: (): Command | undefined => (over.scoped ? ({ id: over.scoped } as Command) : undefined),
    forCombo: (): Command | undefined => (over.combo ? ({ id: over.combo } as Command) : undefined),
    get: (id: string): Command | undefined => (over.keysOf?.[id] ? ({ id, keys: over.keysOf[id] } as Command) : undefined),
  }) as unknown as Commands;

const host = (open: boolean): PaintKeyHost & { run: ReturnType<typeof vi.fn> } => ({ isOpen: () => open, run: vi.fn() });

describe('paintCommandDefs', () => {
  it('registers every command once in the Draw & Paint group', () => {
    const defs = paintCommandDefs(host(true));
    const ids = defs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('paint-'))).toBe(true);
    expect(defs.every((d) => d.group === 'Draw & Paint')).toBe(true);
  });

  it('is enabled only while the paint view is open', () => {
    expect(paintCommandDefs(host(true)).every((d) => d.enabled?.() === true)).toBe(true);
    expect(paintCommandDefs(host(false)).every((d) => d.enabled?.() === false)).toBe(true);
  });

  it('runs the host with its own id', () => {
    const h = host(true);
    const fill = paintCommandDefs(h).find((d) => d.id === 'paint-fill');
    fill?.run();
    expect(h.run).toHaveBeenCalledWith('paint-fill');
  });

  it('scopes only the keys other modes also use', () => {
    const scoped = paintCommandDefs(host(true)).filter((d) => d.scope === 'paint').map((d) => d.id).sort();
    expect(scoped).toEqual(['paint-play', 'paint-tool-erase']);
  });

  it('leaves the keys Compose already holds unbound in the table', () => {
    const defs = paintCommandDefs(host(true));
    for (const id of ['paint-cut', 'paint-copy', 'paint-duplicate', 'paint-merge-down', 'paint-clear']) {
      expect(defs.find((d) => d.id === id)?.keys).toEqual([]);
    }
  });

  it('hands out fresh key lists so a caller cannot change the defaults', () => {
    const first = paintCommandDefs(host(true)).find((d) => d.id === 'paint-tool-paint');
    first?.keys?.push('K');
    expect(paintCommandDefs(host(true)).find((d) => d.id === 'paint-tool-paint')?.keys).toEqual(['B']);
  });
});

describe('paintCommandFor without a command table', () => {
  it('resolves the default letter keys', () => {
    expect(paintCommandFor(key('KeyB', 'b'), null)).toEqual({ id: 'paint-tool-paint', repeat: false });
    expect(paintCommandFor(key('KeyQ', 'q'), null)).toEqual({ id: 'paint-last-tool', repeat: false });
  });

  it('marks the size and opacity nudges as repeating', () => {
    expect(paintCommandFor(key('BracketRight', ']'), null)).toEqual({ id: 'paint-size-up', repeat: true });
    expect(paintCommandFor(key('BracketLeft', '[', { shift: true }), null)).toEqual({ id: 'paint-opacity-down', repeat: true });
  });

  it('does not repeat the memory point jumps', () => {
    expect(paintCommandFor(key('BracketLeft', '[', { alt: true }), null)).toEqual({ id: 'paint-size-prev', repeat: false });
    expect(paintCommandFor(key('BracketRight', ']', { alt: true, shift: true }), null)).toEqual({ id: 'paint-opacity-next', repeat: false });
  });

  it('resolves the local editing combos', () => {
    expect(paintCommandFor(key('KeyX', 'x', { mod: true }), null)).toEqual({ id: 'paint-cut', repeat: false });
    expect(paintCommandFor(key('KeyJ', 'j', { shift: true, mod: true }), null)).toEqual({ id: 'paint-cut-paste', repeat: false });
    expect(paintCommandFor(key('Delete', 'Delete'), null)).toEqual({ id: 'paint-clear', repeat: false });
  });

  it('returns null for a key with no paint command', () => {
    expect(paintCommandFor(key('KeyZ', 'z'), null)).toBeNull();
    expect(paintCommandFor(key('KeyB', 'b', { alt: true }), null)).toBeNull();
  });
});

describe('paintCommandFor with a command table', () => {
  it('prefers the paint scoped binding', () => {
    expect(paintCommandFor(key('KeyP', 'p'), table({ scoped: 'paint-play', combo: 'pen-tool' }))).toEqual({ id: 'paint-play', repeat: false });
  });

  it('follows a person remapping a paint command', () => {
    expect(paintCommandFor(key('KeyK', 'k'), table({ combo: 'paint-size-up' }))).toEqual({ id: 'paint-size-up', repeat: true });
  });

  it('ignores a combo the table gives to another mode', () => {
    expect(paintCommandFor(key('KeyZ', 'z'), table({ combo: 'compose-undo' }))).toBeNull();
  });

  it('does not fall back to default keys the person has unbound', () => {
    expect(paintCommandFor(key('KeyB', 'b'), table({}))).toBeNull();
  });

  it('keeps a local default while its command has no binding of its own', () => {
    expect(paintCommandFor(key('KeyX', 'x', { mod: true }), table({ combo: 'compose-cut' }))).toEqual({ id: 'paint-cut', repeat: false });
  });

  it('drops a local default once the person binds that command elsewhere', () => {
    expect(paintCommandFor(key('KeyX', 'x', { mod: true }), table({ keysOf: { 'paint-cut': ['Alt+K'] } }))).toBeNull();
  });
});
