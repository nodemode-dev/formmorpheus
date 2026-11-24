import { describe, expect, it, vi } from 'vitest';
import { buildCurvePanel, type CurvePanel } from '@src/ui/brush-studio-curves';
import type { Brush, PenCurves } from '@src/paint/types';

interface Rig {
  panel: CurvePanel;
  brush: Brush;
  edit: ReturnType<typeof vi.fn>;
}

function rig(curves?: PenCurves, only?: keyof PenCurves): Rig {
  const brush = {} as Brush;
  if (curves) brush.curves = curves;
  const edit = vi.fn();
  let panel: CurvePanel | null = null;
  const apply = (id: string, fn: (b: Brush) => void): void => {
    edit(id);
    fn(brush);
    panel?.sync(brush);
  };
  panel = buildCurvePanel(apply, only);
  panel.sync(brush);
  return { panel, brush, edit };
}

function card(r: Rig, key: string): HTMLElement {
  const c = r.panel.root.querySelector<HTMLElement>(`.fm-bc-card[data-key="${key}"]`);
  if (!c) throw new Error(`no card ${key}`);
  return c;
}

function nodes(r: Rig, key: string): SVGCircleElement[] {
  return [...card(r, key).querySelectorAll<SVGCircleElement>('circle.fm-bc-node')];
}

function press(target: Element, keyName: string, shiftKey = false): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, shiftKey, bubbles: true, cancelable: true }));
}

describe('buildCurvePanel', () => {
  it('builds a card for every pen channel, and one card when asked for a single channel', () => {
    const all = rig();
    const keys = [...all.panel.root.querySelectorAll<HTMLElement>('.fm-bc-card')].map((c) => c.dataset.key);
    expect(keys).toEqual(['size', 'opacity', 'flow', 'bleed', 'roundness', 'tilt']);
    const one = rig(undefined, 'tilt');
    expect(one.panel.root.querySelectorAll('.fm-bc-card').length).toBe(1);
    expect(one.panel.root.classList.contains('is-single')).toBe(true);
    expect(card(one, 'tilt').querySelector('input[type="range"]')).toBeNull();
  });

  it('shows only the two end nodes of a straight line and hides the reset button', () => {
    const r = rig();
    const n = nodes(r, 'size');
    expect(n.filter((c) => c.getAttribute('display') !== 'none').length).toBe(2);
    expect(card(r, 'size').querySelector<HTMLButtonElement>('.fm-bc-reset')?.hidden).toBe(true);
    expect(card(r, 'size').classList.contains('is-set')).toBe(false);
  });

  it('places the nodes of a stored curve and reports their values', () => {
    const r = rig({ opacity: { pts: [0, 0.1, 0.5, 0.8, 1, 1] } });
    const n = nodes(r, 'opacity');
    expect(n.filter((c) => c.getAttribute('display') !== 'none').length).toBe(3);
    expect(n[1].getAttribute('cx')).toBe('50.0');
    expect(n[1].getAttribute('cy')).toBe('20.0');
    expect(n[1].getAttribute('aria-valuenow')).toBe('80');
    expect(n[0].classList.contains('is-end')).toBe(true);
    expect(n[1].classList.contains('is-end')).toBe(false);
    expect(card(r, 'opacity').classList.contains('is-set')).toBe(true);
  });

  it('arrow up raises a focused node by a small step, or a large step with shift', () => {
    const r = rig();
    press(nodes(r, 'size')[0], 'ArrowUp');
    expect(r.edit).toHaveBeenCalledWith('curve.size');
    expect(r.brush.curves?.size?.pts[1]).toBeCloseTo(0.02, 6);
    press(nodes(r, 'size')[0], 'ArrowUp', true);
    expect(r.brush.curves?.size?.pts[1]).toBeCloseTo(0.12, 6);
  });

  it('a node cannot be pushed below zero, and the straight line again drops the stored curve', () => {
    const r = rig({ flow: { pts: [0, 0.01, 1, 1] } });
    press(nodes(r, 'flow')[0], 'ArrowDown');
    expect(r.brush.curves).toBeUndefined();
  });

  it('a node cannot be pushed above one', () => {
    const r = rig({ size: { pts: [0, 0, 0.5, 0.95, 1, 1] } });
    press(nodes(r, 'size')[1], 'ArrowUp', true);
    expect(r.brush.curves?.size?.pts[3]).toBe(1);
  });

  it('moving a middle node sideways stops short of its neighbour', () => {
    const r = rig({ size: { pts: [0, 0, 0.9, 0.5, 1, 1] } });
    press(nodes(r, 'size')[1], 'ArrowRight', true);
    expect(r.brush.curves?.size?.pts[2]).toBeCloseTo(0.98, 6);
    press(nodes(r, 'size')[1], 'ArrowLeft');
    expect(r.brush.curves?.size?.pts[2]).toBeCloseTo(0.96, 6);
  });

  it('the end nodes do not move sideways and cannot be deleted', () => {
    const r = rig();
    press(nodes(r, 'size')[0], 'ArrowLeft');
    press(nodes(r, 'size')[1], 'ArrowRight');
    press(nodes(r, 'size')[1], 'Delete');
    expect(r.edit).not.toHaveBeenCalled();
    expect(r.brush.curves).toBeUndefined();
  });

  it('delete removes a middle node from a focused node', () => {
    const r = rig({ bleed: { pts: [0, 0, 0.3, 0.6, 0.7, 0.2, 1, 1] } });
    press(nodes(r, 'bleed')[1], 'Backspace');
    expect(r.brush.curves?.bleed?.pts).toEqual([0, 0, 0.7, 0.2, 1, 1]);
  });

  it('a double click removes a middle node but not an end node', () => {
    const r = rig({ roundness: { pts: [0, 0, 0.4, 0.9, 1, 1] } });
    nodes(r, 'roundness')[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(r.edit).not.toHaveBeenCalled();
    nodes(r, 'roundness')[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(r.brush.curves).toBeUndefined();
  });

  it('keys other than the nudges are left alone', () => {
    const r = rig();
    press(nodes(r, 'size')[0], 'a');
    expect(r.edit).not.toHaveBeenCalled();
  });

  it('reset clears one channel and keeps the others', () => {
    const r = rig({ size: { pts: [0, 0.2, 1, 1] }, tilt: { pts: [0, 0, 1, 0.5] } });
    const reset = card(r, 'size').querySelector<HTMLButtonElement>('.fm-bc-reset');
    expect(reset?.hidden).toBe(false);
    reset?.click();
    expect(r.edit).toHaveBeenCalledWith('curve.size');
    expect(r.brush.curves).toEqual({ tilt: { pts: [0, 0, 1, 0.5] } });
    expect(reset?.hidden).toBe(true);
  });

  it('a slower response speed is stored even on a straight line', () => {
    const r = rig();
    const speed = card(r, 'opacity').querySelector<HTMLInputElement>('.fm-bc-speed input');
    if (!speed) throw new Error('no speed input');
    speed.value = '0.4';
    speed.dispatchEvent(new Event('input', { bubbles: true }));
    expect(r.brush.curves?.opacity).toEqual({ pts: [0, 0, 1, 1], speed: 0.4 });
  });
});
