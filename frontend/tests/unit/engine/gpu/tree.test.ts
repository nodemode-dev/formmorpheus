import { describe, expect, it } from 'vitest';
import { ATOP, GpuTree, type TreeOps } from '@src/engine/gpu/tree';
import type { Mat, Surf } from '@src/engine/gpu/compositor';
import type { BlendMode, CanvasRect, Content, DrawingLayer } from '@src/engine/types';

interface Quad { target: string; tex: string; m: number[]; w: number; h: number; alpha: number; mode: number }
interface MaskRun { target: string; tex: string; kind: number; invert: number; scale: number }

interface Rig {
  tree: GpuTree;
  quads: Quad[];
  masks: MaskRun[];
  copies: { dst: string; src: string }[];
  layerCalls: { target: string; ids: string[]; alpha: number; mode: number }[];
  log: string[];
  open: Set<string>;
  target: Surf;
}

const surf = (name: string, w: number, h: number): Surf => ({ tex: `tex:${name}`, name, w, h } as unknown as Surf);
const nameOf = (s: Surf): string => (s as unknown as { name: string }).name;

function rig(view = { w: 200, h: 100 }): Rig {
  const quads: Quad[] = [];
  const masks: MaskRun[] = [];
  const copies: { dst: string; src: string }[] = [];
  const layerCalls: Rig['layerCalls'] = [];
  const log: string[] = [];
  const open = new Set<string>();
  let n = 0;
  const gl = { uniform1i: (): void => undefined, uniform1f: (): void => undefined };
  const ops: TreeOps = {
    gl: gl as unknown as WebGL2RenderingContext,
    view: () => view,
    acquire: (w, h) => {
      const s = surf(`s${++n}:${w}x${h}`, w, h);
      open.add(nameOf(s));
      return s;
    },
    release: (s) => {
      if (!open.delete(nameOf(s))) throw new Error('released twice');
    },
    quad: (target, tex, m, _rx, _ry, rw, rh, alpha, mode) => {
      quads.push({ target: nameOf(target), tex: tex as unknown as string, m: [...m], w: rw, h: rh, alpha, mode });
      log.push(`quad ${tex as unknown as string} -> ${nameOf(target)}`);
    },
    mode: (b: BlendMode) => 100 + b.length,
    tex: (key) => key as unknown as WebGLTexture,
    layers: (_bitmap, target, layers, _m, _rect, alpha, mode) => {
      layerCalls.push({ target: nameOf(target), ids: layers.map((l) => l.id), alpha, mode });
    },
    run: (name, _fs, target, multiply, setup) => {
      const u: Record<string, number> = {};
      let bound = '';
      const real = { uniform1i: gl.uniform1i, uniform1f: gl.uniform1f };
      gl.uniform1i = (...a: unknown[]): void => { u[a[0] as string] = a[1] as number; };
      gl.uniform1f = gl.uniform1i;
      setup((nm) => nm as unknown as WebGLUniformLocation, (_unit, tex) => { bound = tex as unknown as string; });
      gl.uniform1i = real.uniform1i;
      gl.uniform1f = real.uniform1f;
      if (name === 'tmask') {
        if (!multiply) throw new Error('mask must multiply');
        masks.push({ target: nameOf(target), tex: bound, kind: u.uKind, invert: u.uInvert, scale: u.uScale });
        log.push(`mask ${bound} -> ${nameOf(target)}`);
      } else {
        copies.push({ dst: nameOf(target), src: bound });
        log.push(`copy ${bound} -> ${nameOf(target)}`);
      }
    },
  };
  return { tree: new GpuTree(ops), quads, masks, copies, layerCalls, log, open, target: surf('out', view.w, view.h) };
}

const layer = (id: string, extra: Partial<DrawingLayer> = {}): DrawingLayer => ({
  id, pixels: `px-${id}`, visible: true, opacity: 1, blend: 'normal', ...extra,
} as unknown as DrawingLayer);

const all = (id: string | null): ImageBitmap | null => (id ? ({ id } as unknown as ImageBitmap) : null);
const rect: CanvasRect = { x: 10, y: 20, w: 64, h: 48 } as CanvasRect;
const M: Mat = [2, 0, 0, 2, 5, 7];

describe('GpuTree.draw', () => {
  it('draws plain layers from the last to the first under the rect offset', () => {
    const r = rig();
    r.tree.draw(all, r.target, [layer('top', { opacity: 0.5 }), layer('bottom')], M, rect, 0.8, 3);
    expect(r.quads.map((q) => q.tex)).toEqual(['b:px-bottom', 'b:px-top']);
    expect(r.quads[0]).toMatchObject({ target: 'out', w: 64, h: 48, alpha: 0.8, mode: 3 });
    expect(r.quads[0].m).toEqual([2, 0, 0, 2, 25, 47]);
    expect(r.quads[1].alpha).toBeCloseTo(0.4);
    expect(r.open.size).toBe(0);
  });

  it('skips hidden layers, zero opacity layers and layers whose picture is not loaded', () => {
    const r = rig();
    const some = (id: string | null): ImageBitmap | null => (id === 'px-missing' ? null : all(id));
    r.tree.draw(some, r.target, [layer('hidden', { visible: false }), layer('clear', { opacity: 0 }), layer('missing'), layer('ok')], M, rect, 1, 0);
    expect(r.quads.map((q) => q.tex)).toEqual(['b:px-ok']);
  });

  it('uses the mode of a blended layer and the base mode for a normal one', () => {
    const r = rig();
    r.tree.draw(all, r.target, [layer('a', { blend: 'multiply' }), layer('b')], M, rect, 1, 9);
    expect(r.quads.map((q) => q.mode)).toEqual([9, 108]);
  });

  it('rounds the surface size and never goes below one pixel', () => {
    const r = rig();
    r.tree.draw(all, r.target, [layer('a')], M, { x: 0, y: 0, w: 0.2, h: 10.6 } as CanvasRect, 1, 0);
    expect(r.quads[0]).toMatchObject({ w: 1, h: 11 });
  });

  it('draws a masked layer on its own surface, scales it by the mask and places it once', () => {
    const r = rig();
    r.tree.draw(all, r.target, [layer('a', { mask: 'mk', opacity: 0.5 })], M, rect, 1, 4);
    expect(r.log).toEqual(['quad b:px-a -> s1:64x48', 'mask b:mk -> s1:64x48', 'quad tex:s1:64x48 -> out']);
    expect(r.quads[0]).toMatchObject({ alpha: 1, mode: 0, m: [1, 0, 0, 1, 0, 0] });
    expect(r.masks[0]).toMatchObject({ kind: 2, invert: 0, scale: 1 });
    expect(r.quads[1]).toMatchObject({ alpha: 0.5, mode: 4 });
    expect(r.open.size).toBe(0);
  });

  it('draws nothing for a layer whose mask picture is not loaded yet', () => {
    const r = rig();
    const some = (id: string | null): ImageBitmap | null => (id === 'mk' ? null : all(id));
    r.tree.draw(some, r.target, [layer('a', { mask: 'mk' })], M, rect, 1, 0);
    expect(r.quads).toHaveLength(0);
    expect(r.open.size).toBe(0);
  });

  it('ignores a mask that is switched off', () => {
    const r = rig();
    r.tree.draw(all, r.target, [layer('a', { mask: 'mk', maskOn: false })], M, rect, 1, 0);
    expect(r.log).toEqual(['quad b:px-a -> out']);
  });

  it('lays clipped layers atop their base at their own opacity', () => {
    const r = rig();
    r.tree.draw(all, r.target, [layer('clip2', { clipping: true, opacity: 0.25 }), layer('clip1', { clipping: true }), layer('base')], M, rect, 1, 0);
    expect(r.log).toEqual([
      'quad b:px-base -> s1:64x48',
      'quad b:px-clip1 -> s1:64x48',
      'quad b:px-clip2 -> s1:64x48',
      'quad tex:s1:64x48 -> out',
    ]);
    expect(r.quads[1]).toMatchObject({ mode: ATOP, alpha: 1 });
    expect(r.quads[2]).toMatchObject({ mode: ATOP, alpha: 0.25 });
    expect(r.open.size).toBe(0);
  });

  it('does not draw clipped layers when their base is hidden', () => {
    const r = rig();
    r.tree.draw(all, r.target, [layer('clip', { clipping: true }), layer('base', { visible: false }), layer('under')], M, rect, 1, 0);
    expect(r.quads.map((q) => q.tex)).toEqual(['b:px-under']);
  });

  it('blends a clipped layer into a copy before laying it atop', () => {
    const r = rig();
    r.tree.draw(all, r.target, [layer('clip', { clipping: true, blend: 'screen', opacity: 0.5 }), layer('base')], M, rect, 1, 0);
    expect(r.copies).toEqual([{ dst: 's2:64x48', src: 'tex:s1:64x48' }]);
    expect(r.quads[1]).toMatchObject({ target: 's2:64x48', tex: 'b:px-clip', alpha: 0.5, mode: 106 });
    expect(r.quads[2]).toMatchObject({ target: 's1:64x48', tex: 'tex:s2:64x48', alpha: 1, mode: ATOP });
    expect(r.open.size).toBe(0);
  });

  it('draws the children of a full passthrough group straight onto the target', () => {
    const r = rig();
    r.tree.draw(all, r.target, [
      layer('g', { group: true, blend: 'passthrough', pixels: null }),
      layer('kid', { parent: 'g', opacity: 0.5 }),
    ], M, rect, 0.5, 2);
    expect(r.log).toEqual(['quad b:px-kid -> out']);
    expect(r.quads[0]).toMatchObject({ alpha: 0.25, mode: 2, m: [2, 0, 0, 2, 25, 47] });
  });

  it('renders a normal group on a surface of its own and places it with the group opacity', () => {
    const r = rig();
    r.tree.draw(all, r.target, [
      layer('g', { group: true, opacity: 0.5, pixels: null }),
      layer('k1', { parent: 'g' }),
      layer('k2', { parent: 'g' }),
    ], M, rect, 1, 0);
    expect(r.log).toEqual(['quad b:px-k2 -> s1:64x48', 'quad b:px-k1 -> s1:64x48', 'quad tex:s1:64x48 -> out']);
    expect(r.quads[0]).toMatchObject({ alpha: 1, mode: 0, m: [1, 0, 0, 1, 0, 0] });
    expect(r.quads[2].alpha).toBe(0.5);
    expect(r.open.size).toBe(0);
  });

  it('draws nothing for a hidden group and its children', () => {
    const r = rig();
    r.tree.draw(all, r.target, [layer('g', { group: true, visible: false, pixels: null }), layer('k', { parent: 'g' })], M, rect, 1, 0);
    expect(r.quads).toHaveLength(0);
  });

  it('treats a layer with an unknown parent or itself as parent as a root layer', () => {
    const r = rig();
    r.tree.draw(all, r.target, [layer('a', { parent: 'gone' }), layer('b', { parent: 'b' })], M, rect, 1, 0);
    expect(r.quads.map((q) => q.tex)).toEqual(['b:px-b', 'b:px-a']);
  });

  it('draws nothing for an empty layer list', () => {
    const r = rig();
    r.tree.draw(all, r.target, [], M, rect, 1, 0);
    expect(r.log).toEqual([]);
  });
});

const row = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, hidden: false, opacity: 1, blend: 'normal', frames: [{ hold: 1, layers: [layer(id)] }], ...extra,
});
const flip = (rows: Record<string, unknown>[]): Content => ({ flip: rows } as unknown as Content);

describe('GpuTree.rows', () => {
  it('draws each visible row on a view size surface from the last to the first', () => {
    const r = rig();
    r.tree.rows(all, r.target, flip([row('top', { opacity: 0.5, blend: 'multiply' }), row('hid', { hidden: true }), row('bottom')]), 0, M, rect, 0.5, 6);
    expect(r.layerCalls.map((c) => c.ids[0])).toEqual(['bottom', 'top']);
    expect(r.layerCalls.every((c) => c.alpha === 1 && c.mode === 0)).toBe(true);
    expect(r.quads).toHaveLength(2);
    expect(r.quads[0]).toMatchObject({ target: 'out', w: 200, h: 100, alpha: 0.5, mode: 6 });
    expect(r.quads[1]).toMatchObject({ alpha: 0.25, mode: 108 });
    expect(r.open.size).toBe(0);
  });

  it('skips a row with zero opacity and a row without frames', () => {
    const r = rig();
    r.tree.rows(all, r.target, flip([row('clear', { opacity: 0 }), row('empty', { frames: [] }), row('ok')]), 0, M, rect, 1, 0);
    expect(r.quads).toHaveLength(1);
    expect(r.open.size).toBe(0);
  });

  it('cuts the row below with a luminance mask row and does not draw the mask row itself', () => {
    const r = rig();
    r.tree.rows(all, r.target, flip([row('mk', { mask: 'luminance', maskInvert: true, opacity: 3 }), row('base')]), 0, M, rect, 1, 0);
    expect(r.masks).toEqual([{ target: 's1:200x100', tex: 'tex:s2:200x100', kind: 1, invert: 1, scale: 1 }]);
    expect(r.quads.map((q) => q.tex)).toEqual(['tex:s1:200x100']);
    expect(r.open.size).toBe(0);
  });

  it('uses the alpha kind and the row opacity as the scale for an alpha mask row', () => {
    const r = rig();
    r.tree.rows(all, r.target, flip([row('mk', { mask: 'alpha', opacity: 0.4 }), row('base')]), 0, M, rect, 1, 0);
    expect(r.masks[0]).toMatchObject({ kind: 0, invert: 0, scale: 0.4 });
  });

  it('hides the row below an empty mask row and leaves it whole when the mask is inverted', () => {
    const hid = rig();
    hid.tree.rows(all, hid.target, flip([row('mk', { mask: 'alpha', frames: [] }), row('base')]), 0, M, rect, 1, 0);
    expect(hid.quads).toHaveLength(0);
    expect(hid.open.size).toBe(0);
    const kept = rig();
    kept.tree.rows(all, kept.target, flip([row('mk', { mask: 'alpha', maskInvert: true, frames: [] }), row('base')]), 0, M, rect, 1, 0);
    expect(kept.quads).toHaveLength(1);
  });

  it('keeps a clipping row only where the row below has pixels and still draws both', () => {
    const r = rig();
    r.tree.rows(all, r.target, flip([row('clip', { mask: 'clipping' }), row('base')]), 0, M, rect, 1, 0);
    expect(r.masks).toEqual([{ target: 's2:200x100', tex: 'tex:s1:200x100', kind: 0, invert: 0, scale: 1 }]);
    expect(r.quads.map((q) => q.tex)).toEqual(['tex:s1:200x100', 'tex:s2:200x100']);
    expect(r.open.size).toBe(0);
  });

  it('picks the frame held at the given time', () => {
    const r = rig();
    const frames = [{ hold: 2, layers: [layer('f0')] }, { hold: 1, layers: [layer('f1')] }];
    r.tree.rows(all, r.target, flip([row('a', { frames })]), 2, M, rect, 1, 0);
    expect(r.layerCalls[0].ids).toEqual(['f1']);
  });
});
