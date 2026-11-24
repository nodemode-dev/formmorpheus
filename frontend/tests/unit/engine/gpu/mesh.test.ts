import { describe, expect, it, vi } from 'vitest';

const area = vi.hoisted(() => ({ value: 48 * 1024 * 1024 }));
vi.mock('@src/platform/ipad-memory', () => ({ memory: { get: () => area.value } }));

import { flatScaleOf, MeshDrawer } from '@src/engine/gpu/mesh';

interface FakeGl { gl: WebGL2RenderingContext; calls: string[]; sent: number[]; count: number }

function fakeGl(): FakeGl {
  const state: FakeGl = { gl: null as unknown as WebGL2RenderingContext, calls: [], sent: [], count: -1 };
  const own: Record<string, unknown> = {
    bufferSubData: (_t: unknown, _o: number, data: Float32Array, from: number, len: number) => {
      state.sent = Array.from(data.subarray(from, from + len));
    },
    drawArrays: (_m: unknown, _first: number, n: number) => { state.count = n; },
  };
  state.gl = new Proxy(own, {
    get: (t, p: string) => {
      if (p in t) return t[p];
      if (/^[A-Z0-9_]+$/.test(p)) return p;
      return (...a: unknown[]): unknown => { state.calls.push(`${p}(${a.filter((x) => typeof x !== 'object').join(',')})`); return { made: p }; };
    },
  }) as unknown as WebGL2RenderingContext;
  return state;
}

const target = { fbo: {} as WebGLFramebuffer, w: 100, h: 100 };
const src = { tex: {} as WebGLTexture, fbo: {} as WebGLFramebuffer, w: 50, h: 50 };
const tri = (s: number[], d: number[]): number[] => [...s, ...d];

describe('flatScaleOf', () => {
  it('keeps the view scale when the surface fits every cap', () => {
    area.value = 48 * 1024 * 1024;
    expect(flatScaleOf(1920, 1080, 1)).toBe(1);
    expect(flatScaleOf(1920, 1080, 2)).toBe(2);
  });

  it('lowers the scale so the longest side stays within 8192 pixels', () => {
    area.value = 1e12;
    expect(flatScaleOf(10000, 100, 1) * 10000).toBeCloseTo(8192);
    expect(flatScaleOf(100, 4096, 4) * 4096).toBeCloseTo(8192);
  });

  it('honours a smaller driver limit and ignores a larger one', () => {
    area.value = 1e12;
    expect(flatScaleOf(4000, 2000, 1, 2000)).toBeCloseTo(0.5);
    expect(flatScaleOf(10000, 100, 1, 100000) * 10000).toBeCloseTo(8192);
  });

  it('lowers the scale so the area stays within the memory budget', () => {
    area.value = 1000 * 1000;
    const k = flatScaleOf(2000, 2000, 1);
    expect(k).toBeCloseTo(0.5);
    expect(2000 * k * 2000 * k).toBeLessThanOrEqual(area.value + 1);
  });

  it('never raises the scale above the view scale', () => {
    area.value = 1e12;
    expect(flatScaleOf(10, 10, 0.25)).toBe(0.25);
  });
});

describe('MeshDrawer.draw', () => {
  it('draws nothing for an empty list or a partial triangle', () => {
    const f = fakeGl();
    const d = new MeshDrawer(f.gl);
    d.draw(target, src, new Float32Array(0), 1, [1, 0, 0, 1, 0, 0], undefined);
    d.draw(target, src, new Float32Array(11), 1, [1, 0, 0, 1, 0, 0], undefined);
    expect(f.count).toBe(-1);
    expect(f.calls).toHaveLength(0);
  });

  it('drops triangles that are flat on the destination or on the source', () => {
    const f = fakeGl();
    const d = new MeshDrawer(f.gl);
    const flatDest = tri([0, 0, 10, 0, 0, 10], [0, 0, 5, 5, 10, 10]);
    const flatSrc = tri([0, 0, 5, 5, 10, 10], [0, 0, 10, 0, 0, 10]);
    d.draw(target, src, new Float32Array([...flatDest, ...flatSrc]), 1, [1, 0, 0, 1, 0, 0], undefined);
    expect(f.count).toBe(-1);
  });

  it('sends a lone triangle unchanged with its texture coordinates and no growth', () => {
    const f = fakeGl();
    const d = new MeshDrawer(f.gl);
    d.draw(target, src, new Float32Array(tri([0, 0, 50, 0, 0, 50], [10, 10, 30, 10, 10, 30])), 1, [1, 0, 0, 1, 0, 0], undefined);
    expect(f.count).toBe(3);
    expect(f.sent).toHaveLength(30);
    const v = [0, 1, 2].map((i) => f.sent.slice(i * 10, i * 10 + 10));
    expect(v.map((x) => [x[0], x[1]])).toEqual([[10, 10], [30, 10], [10, 30]]);
    const uv = v.map((x) => [x[2], x[3]]);
    [[0, 0], [1, 0], [0, 1]].forEach((want, i) => {
      expect(uv[i][0]).toBeCloseTo(want[0]);
      expect(uv[i][1]).toBeCloseTo(want[1]);
    });
    for (const x of v) expect(x.slice(7)).toEqual([0, 0, 0]);
    expect(v[0][4]).toBeCloseTo(0);
    expect(v[2][4]).toBeCloseTo(20);
  });

  it('applies the stage matrix to the destination corners and the source scale to the texture coordinates', () => {
    const f = fakeGl();
    const d = new MeshDrawer(f.gl);
    d.draw(target, src, new Float32Array(tri([0, 0, 25, 0, 0, 25], [1, 1, 3, 1, 1, 3])), 2, [10, 0, 0, 10, 5, -5], undefined);
    expect([f.sent[0], f.sent[1]]).toEqual([15, 5]);
    expect([f.sent[10], f.sent[11]]).toEqual([35, 5]);
    expect(f.sent[12]).toBeCloseTo(1);
    expect(f.sent[23]).toBeCloseTo(1);
  });

  it('pushes out only the edge two triangles share', () => {
    const f = fakeGl();
    const d = new MeshDrawer(f.gl);
    const a = tri([0, 0, 50, 0, 0, 50], [0, 0, 40, 0, 0, 40]);
    const b = tri([50, 0, 50, 50, 0, 50], [40, 0, 40, 40, 0, 40]);
    d.draw(target, src, new Float32Array([...a, ...b]), 1, [1, 0, 0, 1, 0, 0], undefined);
    expect(f.count).toBe(6);
    expect(f.sent.slice(7, 10)).toEqual([0, 0.75, 0]);
    expect(f.sent.slice(37, 40)).toEqual([0, 0, 0.75]);
    expect(f.sent[0]).toBeCloseTo(0);
    expect(f.sent[1]).toBeCloseTo(0);
    expect(f.sent[10]).toBeGreaterThan(40);
  });

  it('gives the same result for a triangle wound the other way', () => {
    const f = fakeGl();
    const d = new MeshDrawer(f.gl);
    d.draw(target, src, new Float32Array(tri([0, 0, 0, 50, 50, 0], [10, 10, 10, 30, 30, 10])), 1, [1, 0, 0, 1, 0, 0], undefined);
    expect(f.count).toBe(3);
    expect(f.sent[24]).toBeCloseTo(20);
    expect(f.sent[22]).toBeCloseTo(1);
    expect(f.sent.slice(4, 7).every((x) => x >= -1e-6)).toBe(true);
  });

  it('builds a mipmapped copy only for high quality resampling', () => {
    const lin = fakeGl();
    new MeshDrawer(lin.gl).draw(target, src, new Float32Array(tri([0, 0, 50, 0, 0, 50], [10, 10, 30, 10, 10, 30])), 1, [1, 0, 0, 1, 0, 0], 'nearest');
    expect(lin.calls.some((c) => c.startsWith('generateMipmap'))).toBe(false);
    const high = fakeGl();
    new MeshDrawer(high.gl).draw(target, src, new Float32Array(tri([0, 0, 50, 0, 0, 50], [10, 10, 30, 10, 10, 30])), 1, [1, 0, 0, 1, 0, 0], 'high');
    expect(high.calls.some((c) => c.startsWith('generateMipmap'))).toBe(true);
    expect(high.calls).toContain('texStorage2D(TEXTURE_2D,6,RGBA8,50,50)');
  });
});
