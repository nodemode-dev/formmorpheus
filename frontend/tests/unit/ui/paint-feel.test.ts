import { beforeEach, describe, expect, it } from 'vitest';
import { FeelStore, drawBrushCursor, type CursorShape } from '@src/ui/paint-feel';
import type { Brush } from '@src/paint/types';

const KEY = 'formmorpheus.paint.feel';

describe('FeelStore', () => {
  beforeEach(() => { localStorage.clear(); });

  it('gives an empty override for a brush it has never seen', () => {
    expect(new FeelStore().get('ink')).toEqual({});
  });

  it('merges patches for one brush and keeps brushes apart', () => {
    const s = new FeelStore();
    s.set('ink', { smoothing: 0.4 } as never);
    s.set('ink', { gamma: 1.8 } as never);
    s.set('chalk', { smoothing: 0.1 } as never);
    expect(s.get('ink')).toEqual({ smoothing: 0.4, gamma: 1.8 });
    expect(s.get('chalk')).toEqual({ smoothing: 0.1 });
  });

  it('keeps overrides across a new store in the same browser', () => {
    new FeelStore().set('ink', { smoothing: 0.25 } as never);
    expect(new FeelStore().get('ink')).toEqual({ smoothing: 0.25 });
  });

  it('forgets a cleared brush, also for a later store', () => {
    const s = new FeelStore();
    s.set('ink', { smoothing: 0.25 } as never);
    s.set('chalk', { smoothing: 0.5 } as never);
    s.clear('ink');
    expect(s.get('ink')).toEqual({});
    const again = new FeelStore();
    expect(again.get('ink')).toEqual({});
    expect(again.get('chalk')).toEqual({ smoothing: 0.5 });
  });

  it('starts empty when the saved text is corrupt', () => {
    localStorage.setItem(KEY, '{not json');
    expect(new FeelStore().get('ink')).toEqual({});
  });
});

interface Call { name: string; args: unknown[]; strokeStyle: unknown; fillStyle: unknown; lineWidth: unknown }

const recorder = (): { ctx: CanvasRenderingContext2D; calls: Call[] } => {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { strokeStyle: '', fillStyle: '', lineWidth: 1, lineJoin: 'miter' };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => { calls.push({ name: prop, args, strokeStyle: target.strokeStyle, fillStyle: target.fillStyle, lineWidth: target.lineWidth }); };
    },
    set(target, prop: string, value: unknown) { target[prop] = value; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
};

const brush = (cursor: string): Brush => ({ id: 'b', cursor, tip: 'round', roundness: 1, softness: 0 }) as unknown as Brush;

const shape = (over: Partial<CursorShape>): CursorShape => ({
  x: 50, y: 60, r: 12, style: 'contrast', colour: { r: 20, g: 30, b: 40 }, brush: brush('auto'),
  tiltX: 0, tiltY: 0, roll: 0, stroking: false, ...over,
}) as CursorShape;

const named = (calls: Call[], name: string): Call[] => calls.filter((c) => c.name === name);

describe('drawBrushCursor', () => {
  it('draws nothing for a brush whose cursor is off', () => {
    const { ctx, calls } = recorder();
    drawBrushCursor(ctx, shape({ brush: brush('none') }));
    expect(calls).toEqual([]);
  });

  it('draws a round outline of the radius at the pointer with a faint fill', () => {
    const { ctx, calls } = recorder();
    drawBrushCursor(ctx, shape({}));
    const ell = named(calls, 'ellipse');
    expect(ell).toHaveLength(1);
    expect(ell[0].args.slice(0, 5)).toEqual([50, 60, 12, 12, 0]);
    expect(named(calls, 'fill')).toHaveLength(1);
    expect(String(named(calls, 'fill')[0].fillStyle)).toContain('20, 30, 40');
    expect(named(calls, 'stroke')).toHaveLength(2);
    expect(named(calls, 'save')).toHaveLength(named(calls, 'restore').length);
  });

  it('leaves out the fill while stroking or when the fill is off', () => {
    const a = recorder();
    drawBrushCursor(a.ctx, shape({ stroking: true }));
    expect(named(a.calls, 'fill')).toHaveLength(0);
    const b = recorder();
    drawBrushCursor(b.ctx, shape({ fill: false }));
    expect(named(b.calls, 'fill')).toHaveLength(0);
  });

  it('rings a light colour with a dark edge and a dark colour with a light edge', () => {
    const light = recorder();
    drawBrushCursor(light.ctx, shape({ style: 'colour', colour: { r: 250, g: 250, b: 250 } }));
    const ls = named(light.calls, 'stroke');
    expect(String(ls[0].strokeStyle)).toContain('0,0,0');
    expect(String(ls[1].strokeStyle)).toBe('rgb(250, 250, 250)');
    const dark = recorder();
    drawBrushCursor(dark.ctx, shape({ style: 'colour', colour: { r: 5, g: 5, b: 5 } }));
    const ds = named(dark.calls, 'stroke');
    expect(String(ds[0].strokeStyle)).toContain('255,255,255');
    expect(String(ds[1].strokeStyle)).toBe('rgb(5, 5, 5)');
  });

  it('draws a circle cursor as a plain round outline even in brush style', () => {
    const { ctx, calls } = recorder();
    drawBrushCursor(ctx, shape({ style: 'brush', brush: brush('circle') }));
    const ell = named(calls, 'ellipse');
    expect(ell).toHaveLength(1);
    expect(ell[0].args.slice(0, 5)).toEqual([50, 60, 12, 12, 0]);
    expect(named(calls, 'moveTo')).toHaveLength(0);
  });
});
