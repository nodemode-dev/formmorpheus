import { describe, expect, it, vi } from 'vitest';
import { keyboardSlider } from '@src/ui/a11y';

function setup(start: number): { node: HTMLElement; set: ReturnType<typeof vi.fn>; done: ReturnType<typeof vi.fn>; value: () => number } {
  let v = start;
  const node = document.createElement('div');
  node.title = 'Opacity';
  document.body.appendChild(node);
  const set = vi.fn((x: number) => { v = x; });
  const done = vi.fn();
  keyboardSlider(node, { value: () => v, set, done });
  return { node, set, done, value: () => v };
}

function key(node: HTMLElement, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  node.dispatchEvent(e);
  return e;
}

describe('keyboardSlider', () => {
  it('makes the node a focusable slider from 0 to 100 named by its title', () => {
    const { node } = setup(0.42);
    expect(node.tabIndex).toBe(0);
    expect(node.getAttribute('role')).toBe('slider');
    expect(node.getAttribute('aria-valuemin')).toBe('0');
    expect(node.getAttribute('aria-valuemax')).toBe('100');
    expect(node.getAttribute('aria-valuenow')).toBe('42');
    expect(node.getAttribute('aria-valuetext')).toBe('42%');
    expect(node.getAttribute('aria-label')).toBe('Opacity');
  });

  it('steps one percent with the arrow keys', () => {
    const { node, set } = setup(0.5);
    key(node, 'ArrowUp');
    expect(set.mock.calls[0][0]).toBeCloseTo(0.51, 9);
    key(node, 'ArrowLeft');
    expect(set.mock.calls[1][0]).toBeCloseTo(0.5, 9);
    key(node, 'ArrowRight');
    key(node, 'ArrowDown');
    expect(set.mock.calls[3][0]).toBeCloseTo(0.5, 9);
  });

  it('steps ten percent with shift or the page keys', () => {
    const { node, set } = setup(0.5);
    key(node, 'ArrowUp', { shiftKey: true });
    expect(set.mock.calls[0][0]).toBeCloseTo(0.6, 9);
    key(node, 'PageDown');
    expect(set.mock.calls[1][0]).toBeCloseTo(0.5, 9);
    key(node, 'PageUp');
    expect(set.mock.calls[2][0]).toBeCloseTo(0.6, 9);
  });

  it('jumps to the ends with Home and End', () => {
    const { node, set } = setup(0.5);
    key(node, 'End');
    expect(set).toHaveBeenLastCalledWith(1);
    key(node, 'Home');
    expect(set).toHaveBeenLastCalledWith(0);
  });

  it('clamps steps at both ends', () => {
    const top = setup(0.995);
    key(top.node, 'PageUp');
    expect(top.set).toHaveBeenLastCalledWith(1);
    const bottom = setup(0.003);
    key(bottom.node, 'ArrowDown', { shiftKey: true });
    expect(bottom.set).toHaveBeenLastCalledWith(0);
  });

  it('updates the reported value after a key', () => {
    const { node } = setup(0.2);
    key(node, 'End');
    expect(node.getAttribute('aria-valuenow')).toBe('100');
    expect(node.getAttribute('aria-valuetext')).toBe('100%');
  });

  it('consumes the keys it handles', () => {
    const { node } = setup(0.5);
    const outer = vi.fn();
    document.body.addEventListener('keydown', outer);
    const e = key(node, 'ArrowUp');
    expect(e.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', outer);
  });

  it('ignores other keys and modified keys', () => {
    const { node, set } = setup(0.5);
    const a = key(node, 'a');
    key(node, 'ArrowUp', { ctrlKey: true });
    key(node, 'ArrowUp', { metaKey: true });
    key(node, 'ArrowUp', { altKey: true });
    expect(set).not.toHaveBeenCalled();
    expect(a.defaultPrevented).toBe(false);
  });

  it('reports the end of an edit when a stepping key is released', () => {
    const { node, done } = setup(0.5);
    for (const k of ['ArrowUp', 'PageDown', 'Home', 'End']) node.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
    expect(done).toHaveBeenCalledTimes(4);
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
    expect(done).toHaveBeenCalledTimes(4);
  });
});
