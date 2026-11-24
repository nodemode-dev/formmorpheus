import { afterEach, describe, expect, it, vi } from 'vitest';
import { chordLabel, contain, isChord, keeps, leaves, onMac, ownsEvent, type DockKeys } from '@src/dock/keys';

const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', { bubbles: true, ...init });
const platform = (name: string): void => { vi.spyOn(navigator, 'platform', 'get').mockReturnValue(name); };

afterEach(() => { document.body.innerHTML = ''; });

describe('isChord', () => {
  it('uses the adapter chord test when one is given', () => {
    const a: DockKeys = { isDockChord: (e) => e.code === 'F2' };
    expect(isChord(a, key({ code: 'F2' }))).toBe(true);
    expect(isChord(a, key({ code: 'KeyJ', ctrlKey: true, metaKey: true }))).toBe(false);
  });

  it('accepts Ctrl+J and refuses Cmd+J off Mac', () => {
    platform('Win32');
    expect(onMac()).toBe(false);
    expect(isChord({}, key({ code: 'KeyJ', ctrlKey: true }))).toBe(true);
    expect(isChord({}, key({ code: 'KeyJ', metaKey: true }))).toBe(false);
    expect(isChord({}, key({ code: 'KeyJ', ctrlKey: true, metaKey: true }))).toBe(false);
  });

  it('accepts Cmd+J and refuses Ctrl+J on Mac', () => {
    platform('MacIntel');
    expect(onMac()).toBe(true);
    expect(isChord({}, key({ code: 'KeyJ', metaKey: true }))).toBe(true);
    expect(isChord({}, key({ code: 'KeyJ', ctrlKey: true }))).toBe(false);
  });

  it('refuses the chord with shift or alt held, another key, or no modifier', () => {
    platform('Linux x86_64');
    expect(isChord({}, key({ code: 'KeyJ', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isChord({}, key({ code: 'KeyJ', ctrlKey: true, altKey: true }))).toBe(false);
    expect(isChord({}, key({ code: 'KeyK', ctrlKey: true }))).toBe(false);
    expect(isChord({}, key({ code: 'KeyJ' }))).toBe(false);
  });
});

describe('chordLabel', () => {
  it('prefers the adapter label', () => {
    expect(chordLabel({ chordLabel: () => 'F2' })).toBe('F2');
  });

  it('names the platform modifier by default', () => {
    platform('MacIntel');
    expect(chordLabel({})).toContain('Cmd');
    vi.restoreAllMocks();
    platform('Win32');
    expect(chordLabel({})).toContain('Ctrl');
  });
});

describe('leaves', () => {
  it('lets the chord and adapter pass keys out of the dock and keeps others', () => {
    platform('Win32');
    const a: DockKeys = { passKey: (e) => e.key === 'F5' };
    expect(leaves(a, key({ code: 'KeyJ', ctrlKey: true }))).toBe(true);
    expect(leaves(a, key({ key: 'F5' }))).toBe(true);
    expect(leaves(a, key({ key: 'a', code: 'KeyA' }))).toBe(false);
  });
});

describe('contain', () => {
  it('stops ordinary keys from reaching the page but lets leaving keys through', () => {
    platform('Win32');
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    outer.append(inner);
    document.body.append(outer);
    contain(inner, { passKey: (e) => e.key === 'Escape' });
    const seen: string[] = [];
    outer.addEventListener('keydown', (e) => seen.push((e as KeyboardEvent).key || (e as KeyboardEvent).code));
    outer.addEventListener('keyup', (e) => seen.push(`up:${(e as KeyboardEvent).key}`));
    inner.dispatchEvent(key({ key: 'a', code: 'KeyA' }));
    inner.dispatchEvent(new KeyboardEvent('keyup', { key: 'b', bubbles: true }));
    inner.dispatchEvent(key({ key: 'Escape' }));
    inner.dispatchEvent(key({ code: 'KeyJ', ctrlKey: true }));
    expect(seen).toEqual(['Escape', 'KeyJ']);
  });
});

describe('ownsEvent and keeps', () => {
  const fire = (target: EventTarget, e: Event): { owns: boolean; kept: boolean } => {
    const out = { owns: false, kept: false };
    target.addEventListener(e.type, (ev) => { out.owns = ownsEvent(ev); out.kept = keeps({ passKey: (k) => k.key === 'Tab' }, ev); }, { once: true });
    target.dispatchEvent(e);
    return out;
  };

  it('claims events whose target sits inside the dock, consent or tour', () => {
    for (const cls of ['ft-dock', 'ft-consent', 'ft-tour']) {
      const host = document.createElement('div');
      host.className = cls;
      const btn = document.createElement('button');
      host.append(btn);
      document.body.append(host);
      expect(fire(btn, new MouseEvent('click', { bubbles: true }))).toEqual({ owns: true, kept: true });
    }
  });

  it('does not claim events from elsewhere on the page or from non elements', () => {
    const btn = document.createElement('button');
    document.body.append(btn);
    expect(fire(btn, new MouseEvent('click', { bubbles: true }))).toEqual({ owns: false, kept: false });
    expect(fire(window, new Event('custom')).owns).toBe(false);
  });

  it('releases owned key events that are meant to leave the dock', () => {
    const host = document.createElement('div');
    host.className = 'ft-dock';
    const input = document.createElement('input');
    host.append(input);
    document.body.append(host);
    expect(fire(input, key({ key: 'Tab' }))).toEqual({ owns: true, kept: false });
    expect(fire(input, key({ key: 'x' }))).toEqual({ owns: true, kept: true });
  });
});
