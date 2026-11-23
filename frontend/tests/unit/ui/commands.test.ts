import { describe, expect, it, vi } from 'vitest';
import { Commands, canonCombo, comboOf, formatKeys, type Command } from '@src/ui/commands';
import { isMac } from '@src/ui/dom';

function cmd(id: string, extra: Partial<Command> = {}): Command {
  return { id, label: id, run: vi.fn(), ...extra };
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('canonCombo', () => {
  it('orders modifiers as Alt, Shift, Mod whatever order they were written in', () => {
    expect(canonCombo('Mod+Shift+G')).toBe('Shift+Mod+G');
    expect(canonCombo('Shift+Mod+G')).toBe('Shift+Mod+G');
    expect(canonCombo('Mod+Alt+Shift+X')).toBe('Alt+Shift+Mod+X');
  });

  it('upper-cases a single letter key', () => {
    expect(canonCombo('Mod+s')).toBe('Mod+S');
    expect(canonCombo('z')).toBe('Z');
  });

  it('keeps a trailing plus key as the plus key itself', () => {
    expect(canonCombo('Mod++')).toBe('Mod++');
    expect(canonCombo('Shift+Mod++')).toBe('Shift+Mod++');
  });

  it('leaves named keys as they are', () => {
    expect(canonCombo('Shift+Backspace')).toBe('Shift+Backspace');
    expect(canonCombo('[')).toBe('[');
  });
});

describe('comboOf', () => {
  it('reads letters from the physical key code, not the typed character', () => {
    expect(comboOf(key({ code: 'KeyS', key: 'ß', altKey: true }))).toBe('Alt+S');
  });

  it('names digits and numpad digits by their number', () => {
    expect(comboOf(key({ code: 'Digit5', key: '%', shiftKey: true }))).toBe('Shift+5');
    expect(comboOf(key({ code: 'Numpad3', key: '3' }))).toBe('3');
  });

  it('maps bracket, numpad plus and arrow codes to their combo names', () => {
    expect(comboOf(key({ code: 'BracketLeft', key: '[' }))).toBe('[');
    expect(comboOf(key({ code: 'NumpadAdd', key: '+' }))).toBe('=');
    expect(comboOf(key({ code: 'ArrowUp', key: 'ArrowUp' }))).toBe('Up');
  });

  it('falls back to the key name for codes it does not know', () => {
    expect(comboOf(key({ code: 'F5', key: 'F5' }))).toBe('F5');
  });

  it('adds Mod for the platform command key and puts modifiers in canonical order', () => {
    const e = key({ code: 'KeyZ', key: 'z', ctrlKey: true, metaKey: true, shiftKey: true, altKey: true });
    expect(comboOf(e)).toBe('Alt+Shift+Mod+Z');
    expect(comboOf(key({ code: 'KeyZ', key: 'z' }))).toBe('Z');
  });
});

describe('formatKeys', () => {
  it('renders a combo for the platform menu style', () => {
    if (isMac) {
      expect(formatKeys('Shift+Mod+S')).toBe('⇧⌘S');
      expect(formatKeys('Mod++')).toBe('⌘+');
    } else {
      expect(formatKeys('Shift+Mod+S')).toBe('Shift+Ctrl+S');
      expect(formatKeys('Mod++')).toBe('Ctrl++');
    }
  });
});

describe('Commands', () => {
  it('refuses two commands with the same id', () => {
    const c = new Commands();
    c.add(cmd('a'));
    expect(() => c.add(cmd('a'))).toThrow(/duplicate/);
  });

  it('stores keys in canonical form without repeats and finds a command by any spelling', () => {
    const c = new Commands();
    c.add(cmd('group', { keys: ['Mod+Shift+g', 'Shift+Mod+G'] }));
    expect(c.get('group')?.keys).toEqual(['Shift+Mod+G']);
    expect(c.forCombo('Mod+Shift+G')?.id).toBe('group');
    expect(c.forCombo('Mod+G')).toBeUndefined();
  });

  it('keeps scoped keys apart from the global keys', () => {
    const c = new Commands();
    c.add(cmd('global-b', { keys: ['B'] }), cmd('paint-b', { keys: ['B'], scope: 'paint' }));
    expect(c.forCombo('B')?.id).toBe('global-b');
    expect(c.forScoped('paint', 'b')?.id).toBe('paint-b');
    expect(c.forScoped('other', 'B')).toBeUndefined();
  });

  it('warns when two global commands share a default key and the later one wins', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = new Commands();
    c.add(cmd('first', { keys: ['K'] }), cmd('second', { keys: ['K'] }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(c.forCombo('K')?.id).toBe('second');
  });

  it('rebinding takes a key away from the command that had it', () => {
    const c = new Commands();
    c.add(cmd('a', { keys: ['Mod+K', 'Mod+J'] }), cmd('b', { keys: ['Mod+L'] }));
    c.setKeys('b', ['Mod+k']);
    expect(c.forCombo('Mod+K')?.id).toBe('b');
    expect(c.get('a')?.keys).toEqual(['Mod+J']);
    expect(c.forCombo('Mod+L')).toBeUndefined();
  });

  it('rebinding a scoped command only touches that scope', () => {
    const c = new Commands();
    c.add(cmd('g', { keys: ['E'] }), cmd('p1', { keys: ['E'], scope: 'paint' }), cmd('p2', { keys: ['R'], scope: 'paint' }));
    c.setKeys('p2', ['E']);
    expect(c.forScoped('paint', 'E')?.id).toBe('p2');
    expect(c.get('p1')?.keys).toEqual([]);
    expect(c.forScoped('paint', 'R')).toBeUndefined();
    expect(c.forCombo('E')?.id).toBe('g');
  });

  it('ignores a rebinding for an unknown command', () => {
    const c = new Commands();
    c.add(cmd('a', { keys: ['A'] }));
    c.setKeys('missing', ['A']);
    expect(c.forCombo('A')?.id).toBe('a');
  });

  it('reports only the commands whose keys differ from their defaults', () => {
    const c = new Commands();
    c.add(cmd('a', { keys: ['A'] }), cmd('b', { keys: ['B'] }), cmd('c'));
    expect(c.overrides()).toEqual({});
    c.setKeys('b', ['Mod+B', 'B']);
    expect(c.overrides()).toEqual({ b: ['Mod+B', 'B'] });
    expect(c.defaultKeys('b')).toEqual(['B']);
  });

  it('reset puts every key back, including keys taken by a rebinding', () => {
    const c = new Commands();
    c.add(cmd('a', { keys: ['A'] }), cmd('b', { keys: ['B'] }), cmd('s', { keys: ['S'], scope: 'paint' }));
    c.setKeys('b', ['A']);
    c.setKeys('s', ['T']);
    c.resetKeys();
    expect(c.forCombo('A')?.id).toBe('a');
    expect(c.forCombo('B')?.id).toBe('b');
    expect(c.forScoped('paint', 'S')?.id).toBe('s');
    expect(c.forScoped('paint', 'T')).toBeUndefined();
    expect(c.overrides()).toEqual({});
  });

  it('removing a command frees its keys and tells the listener', () => {
    const c = new Commands();
    const changed = vi.fn();
    c.add(cmd('a', { keys: ['A'] }));
    c.onChange = changed;
    c.remove('a');
    expect(c.get('a')).toBeUndefined();
    expect(c.forCombo('A')).toBeUndefined();
    expect(c.all()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
    c.remove('a');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('runs a command with its params and records the label as it read before running', () => {
    const c = new Commands();
    let on = false;
    const run = vi.fn(() => { on = true; });
    c.add(cmd('toggle', { label: () => (on ? 'Hide' : 'Show'), run }));
    const seen: string[] = [];
    c.onRun = (_cmd, label) => { seen.push(label); };
    expect(c.run('toggle', { x: 1 })).toBe(true);
    expect(run).toHaveBeenCalledWith({ x: 1 });
    expect(seen).toEqual(['Show']);
  });

  it('does not run an unknown, disabled, gated or blocked command', () => {
    const c = new Commands();
    const off = vi.fn();
    const gated = vi.fn();
    const blocked = vi.fn();
    c.add(cmd('off', { run: off, enabled: () => false }), cmd('gated', { run: gated }), cmd('blocked', { run: blocked }));
    c.gate = (x) => x.id !== 'gated';
    c.blocked = (x) => (x.id === 'blocked' ? 'needs the engine' : '');
    expect(c.run('missing')).toBe(false);
    expect(c.run('off')).toBe(false);
    expect(c.run('gated')).toBe(false);
    expect(c.run('blocked')).toBe(false);
    expect(c.why(c.get('blocked') as Command)).toBe('needs the engine');
    expect(off).not.toHaveBeenCalled();
    expect(gated).not.toHaveBeenCalled();
    expect(blocked).not.toHaveBeenCalled();
  });

  it('call waits for a background command and hands back its result', async () => {
    const c = new Commands();
    c.add(cmd('load', { run: async () => 42 }), cmd('never', { enabled: () => false }));
    await expect(c.call('load')).resolves.toEqual({ ran: true, result: 42 });
    await expect(c.call('never')).resolves.toEqual({ ran: false });
  });

  it('finds the command for a key event and labels its first key', () => {
    const c = new Commands();
    c.add(cmd('save', { keys: ['Mod+S', 'Mod+Shift+S'] }), cmd('bare'));
    const e = key({ code: 'KeyS', key: 's', ctrlKey: true, metaKey: true });
    expect(c.forEvent(e)?.id).toBe('save');
    expect(c.keyLabel(c.get('save') as Command)).toBe(formatKeys('Mod+S'));
    expect(c.keyLabel(c.get('bare') as Command)).toBe('');
  });
});
