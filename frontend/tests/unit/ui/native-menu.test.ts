import { afterEach, describe, expect, it } from 'vitest';
import { MENUS_IN_WINDOW_KEY, accelerator, menusInWindow, textFieldFocused } from '@src/ui/native-menu';

describe('accelerator', () => {
  it('returns null when there is no key combination', () => {
    expect(accelerator(undefined)).toBeNull();
    expect(accelerator('')).toBeNull();
  });

  it('maps Mod to the command or control key and upper-cases letters', () => {
    expect(accelerator('Mod+S')).toBe('CmdOrCtrl+S');
    expect(accelerator('Mod+Shift+z')).toBe('CmdOrCtrl+Shift+Z');
    expect(accelerator('Alt+Space')).toBe('Alt+Space');
    expect(accelerator('Ctrl+Tab')).toBe('Ctrl+Tab');
  });

  it('reads a trailing plus as the Plus key', () => {
    expect(accelerator('Mod++')).toBe('CmdOrCtrl+Plus');
    expect(accelerator('Mod+Shift++')).toBe('CmdOrCtrl+Shift+Plus');
  });

  it('keeps digits, brackets, equals and minus', () => {
    expect(accelerator('Mod+1')).toBe('CmdOrCtrl+1');
    expect(accelerator('Mod+=')).toBe('CmdOrCtrl+=');
    expect(accelerator('Mod+-')).toBe('CmdOrCtrl+-');
    expect(accelerator('Mod+[')).toBe('CmdOrCtrl+[');
    expect(accelerator('Mod+]')).toBe('CmdOrCtrl+]');
  });

  it('accepts function keys F1 to F12 only', () => {
    expect(accelerator('F1')).toBe('F1');
    expect(accelerator('Shift+F12')).toBe('Shift+F12');
    expect(accelerator('F13')).toBeNull();
    expect(accelerator('F0')).toBeNull();
  });

  it('refuses a combination with a key the menu cannot show', () => {
    expect(accelerator('Mod+ArrowLeft')).toBeNull();
    expect(accelerator('Mod+/')).toBeNull();
    expect(accelerator('Mod+ab')).toBeNull();
  });
});

describe('menusInWindow', () => {
  afterEach(() => { localStorage.clear(); });

  it('is on only when the saved flag is 1', () => {
    expect(menusInWindow()).toBe(false);
    localStorage.setItem(MENUS_IN_WINDOW_KEY, '1');
    expect(menusInWindow()).toBe(true);
    localStorage.setItem(MENUS_IN_WINDOW_KEY, '0');
    expect(menusInWindow()).toBe(false);
  });
});

describe('textFieldFocused', () => {
  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.innerHTML = '';
  });

  const focus = <T extends HTMLElement>(node: T): T => {
    document.body.appendChild(node);
    node.focus();
    return node;
  };

  it('is true for a focused text input and a focused text area', () => {
    focus(document.createElement('input'));
    expect(textFieldFocused()).toBe(true);
    focus(document.createElement('textarea'));
    expect(textFieldFocused()).toBe(true);
  });

  it('is false for a read-only or disabled field', () => {
    const a = document.createElement('input');
    a.readOnly = true;
    focus(a);
    expect(textFieldFocused()).toBe(false);
    const b = document.createElement('textarea');
    b.readOnly = true;
    focus(b);
    expect(textFieldFocused()).toBe(false);
  });

  it('is false for inputs that take no text', () => {
    const c = document.createElement('input');
    c.type = 'checkbox';
    focus(c);
    expect(textFieldFocused()).toBe(false);
    const r = document.createElement('input');
    r.type = 'range';
    focus(r);
    expect(textFieldFocused()).toBe(false);
  });

  it('is false when nothing editable has focus', () => {
    focus(document.createElement('button'));
    expect(textFieldFocused()).toBe(false);
  });
});
