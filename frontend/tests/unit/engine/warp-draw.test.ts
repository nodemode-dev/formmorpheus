import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISTORT_IDS, contentRect, drawTriangles, grab, localToStage, meshOffset, setStagePost, stageToLocal, warpActive,
  warpId, warpPoint, warpQuads,
} from '@src/engine/warp-draw';
import { animate, type Animated } from '@src/engine/keys';
import { content, newMovie } from '@src/engine/model';

function anim(over: Partial<Animated> = {}): Animated {
  return { ...animate(content('solid', 0, 10), 0), ...over };
}

const zeros = (n: number): number[] => new Array<number>(n).fill(0);
const rect = { x: 10, y: 20, w: 200, h: 100 };

afterEach(() => {
  setStagePost(null);
});

describe('ids and activity', () => {
  it('names a node channel by row, column and axis', () => {
    expect(warpId(0, 3, 'x')).toBe('n03x');
    expect(warpId(2, 1, 'y')).toBe('n21y');
  });

  it('has one x and one y channel for each of the four corners', () => {
    expect(DISTORT_IDS).toHaveLength(8);
    expect(new Set(DISTORT_IDS).size).toBe(8);
  });

  it('is active with a warp or a distort and not otherwise', () => {
    expect(warpActive(anim())).toBe(false);
    expect(warpActive(anim({ distort: zeros(8) }))).toBe(true);
    expect(warpActive(anim({ warp: { n: 2, dx: zeros(4), dy: zeros(4) } }))).toBe(true);
  });
});

describe('meshOffset', () => {
  it('is zero everywhere on an untouched mesh', () => {
    const out = [9, 9];
    meshOffset(4, zeros(16), zeros(16), 0.37, 0.81, out);
    expect(out[0]).toBeCloseTo(0, 9);
    expect(out[1]).toBeCloseTo(0, 9);
  });

  it('moves every point the same when every node moves the same', () => {
    const out = [0, 0];
    for (const linear of [false, true]) {
      meshOffset(3, new Array<number>(9).fill(7), new Array<number>(9).fill(-3), 0.23, 0.64, out, linear);
      expect(out[0]).toBeCloseTo(7, 9);
      expect(out[1]).toBeCloseTo(-3, 9);
    }
  });

  it('passes exactly through each node', () => {
    const dx = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const dy = dx.map((v) => -v);
    const out = [0, 0];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      meshOffset(3, dx, dy, c / 2, r / 2, out);
      expect(out[0]).toBeCloseTo(dx[r * 3 + c], 9);
      expect(out[1]).toBeCloseTo(dy[r * 3 + c], 9);
    }
  });

  it('blends straight between nodes when linear', () => {
    const out = [0, 0];
    meshOffset(2, [0, 10, 20, 30], [0, 0, 8, 8], 0.5, 0.5, out, true);
    expect(out[0]).toBeCloseTo(15, 9);
    expect(out[1]).toBeCloseTo(4, 9);
    meshOffset(2, [0, 10, 20, 30], [0, 0, 8, 8], 0.25, 0, out, true);
    expect(out[0]).toBeCloseTo(2.5, 9);
  });

  it('clamps positions outside the content to its edge', () => {
    const dx = [1, 2, 3, 4];
    const inside = [0, 0];
    const outside = [0, 0];
    meshOffset(2, dx, dx, 1, 1, inside);
    meshOffset(2, dx, dx, 5, 9, outside);
    expect(outside).toEqual(inside);
    meshOffset(2, dx, dx, -3, -1, outside);
    expect(outside[0]).toBeCloseTo(1, 9);
  });

  it('reads a mesh with fewer rows than columns', () => {
    const dx = [0, 0, 0, 6, 6, 6];
    const out = [0, 0];
    meshOffset(3, dx, zeros(6), 0.5, 1, out, false, 2);
    expect(out[0]).toBeCloseTo(6, 9);
    meshOffset(3, dx, zeros(6), 0.5, 0.5, out, true, 2);
    expect(out[0]).toBeCloseTo(3, 9);
  });
});

describe('warpPoint', () => {
  it('is the plain place in the rectangle without warp or distort', () => {
    const out = [0, 0];
    warpPoint(anim(), rect, 0.25, 0.5, out);
    expect(out).toEqual([60, 70]);
  });

  it('leaves every point in place with a distort of zero', () => {
    const out = [0, 0];
    for (const bilinear of [false, true]) {
      warpPoint(anim({ distort: zeros(8), bilinear }), rect, 0.3, 0.9, out);
      expect(out[0]).toBeCloseTo(70, 6);
      expect(out[1]).toBeCloseTo(110, 6);
    }
  });

  it('puts each corner exactly where its offset says', () => {
    const d = [5, -5, 12, 3, -20, 30, 8, 14];
    const want: [number, number, number, number][] = [
      [0, 0, 15, 15], [1, 0, 222, 23], [1, 1, 190, 150], [0, 1, 18, 134],
    ];
    const out = [0, 0];
    for (const bilinear of [false, true]) for (const [u, v, x, y] of want) {
      warpPoint(anim({ distort: d, bilinear }), rect, u, v, out);
      expect(out[0]).toBeCloseTo(x, 6);
      expect(out[1]).toBeCloseTo(y, 6);
    }
  });

  it('puts the bilinear middle at the average of the corners', () => {
    const d = [5, -5, 12, 3, -20, 30, 8, 14];
    const out = [0, 0];
    warpPoint(anim({ distort: d, bilinear: true }), rect, 0.5, 0.5, out);
    expect(out[0]).toBeCloseTo((15 + 222 + 190 + 18) / 4, 6);
    expect(out[1]).toBeCloseTo((15 + 23 + 150 + 134) / 4, 6);
  });

  it('keeps straight lines straight under perspective but not evenly spaced', () => {
    const d = [40, 0, -40, 0, 0, 0, 0, 0];
    const top = [0, 0];
    const mid = [0, 0];
    warpPoint(anim({ distort: d }), rect, 0.5, 0, top);
    warpPoint(anim({ distort: d }), rect, 0.5, 0.5, mid);
    expect(top[0]).toBeCloseTo(110, 6);
    expect(mid[0]).toBeCloseTo(110, 6);
    expect(mid[1]).toBeLessThan(70);
    expect(mid[1]).toBeGreaterThan(20);
  });

  it('shifts everything by a distort that moves all corners alike', () => {
    const out = [0, 0];
    warpPoint(anim({ distort: [7, 9, 7, 9, 7, 9, 7, 9] }), rect, 0.4, 0.6, out);
    expect(out[0]).toBeCloseTo(97, 6);
    expect(out[1]).toBeCloseTo(89, 6);
  });

  it('adds the mesh offset to the plain place', () => {
    const out = [0, 0];
    warpPoint(anim({ warp: { n: 2, dx: [4, 4, 4, 4], dy: [0, 0, 10, 10] }, bilinear: true }), rect, 0.5, 0.5, out);
    expect(out[0]).toBeCloseTo(114, 6);
    expect(out[1]).toBeCloseTo(75, 6);
  });

  it('prefers the distort when both are present', () => {
    const out = [0, 0];
    warpPoint(anim({ distort: zeros(8), warp: { n: 2, dx: [50, 50, 50, 50], dy: zeros(4) } }), rect, 0, 0, out);
    expect(out[0]).toBeCloseTo(10, 6);
  });
});

describe('contentRect', () => {
  it('centres a picture by its own size', () => {
    const movie = newMovie({ width: 1000, height: 500 });
    movie.assets.pic = { width: 200, height: 100 } as (typeof movie.assets)[string];
    expect(contentRect(content('image', 0, 10, { asset: 'pic' }), movie)).toEqual({ x: 400, y: 200, w: 200, h: 100 });
  });

  it('covers the whole frame for content without a picture', () => {
    const movie = newMovie({ width: 1000, height: 500 });
    expect(contentRect(content('solid', 0, 10), movie)).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
    expect(contentRect(content('image', 0, 10, { asset: 'missing' }), movie)).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
  });

  it('uses a drawing own canvas and ignores one on other kinds', () => {
    const movie = newMovie({ width: 1000, height: 500 });
    const canvas = { x: -50, y: 10, w: 300, h: 200 };
    expect(contentRect(content('drawing', 0, 10, { canvas }), movie)).toEqual(canvas);
    expect(contentRect(content('solid', 0, 10, { canvas }), movie)).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
  });
});

describe('content space and Stage space', () => {
  it('maps the pivot to itself plus the move', () => {
    const out = [0, 0];
    localToStage(anim({ x: 30, y: -10, rotation: 77, scaleX: 3, scaleY: 2 }), 1000, 500, 500, 250, out);
    expect(out[0]).toBeCloseTo(530, 6);
    expect(out[1]).toBeCloseTo(240, 6);
  });

  it('scales, flips and turns around the pivot', () => {
    const out = [0, 0];
    localToStage(anim({ scaleX: 2, scaleY: 2, rotation: 90 }), 1000, 500, 510, 250, out);
    expect(out[0]).toBeCloseTo(500, 6);
    expect(out[1]).toBeCloseTo(270, 6);
    localToStage(anim({ flipH: true }), 1000, 500, 510, 255, out);
    expect(out[0]).toBeCloseTo(490, 6);
    expect(out[1]).toBeCloseTo(255, 6);
  });

  it('comes back to the same point through the inverse', () => {
    const a = anim({ x: 33, y: -12, rotation: 41, scaleX: 1.7, scaleY: 0.4, flipV: true, px: 25, py: -60 });
    const s = [0, 0];
    const back = [0, 0];
    localToStage(a, 1000, 500, 123, 456, s);
    stageToLocal(a, 1000, 500, s[0], s[1], back);
    expect(back[0]).toBeCloseTo(123, 6);
    expect(back[1]).toBeCloseTo(456, 6);
  });

  it('applies the stage post matrix after the own transform and undoes it on the way back', () => {
    const a = anim({ x: 10, rotation: 15 });
    const plain = [0, 0];
    localToStage(a, 1000, 500, 300, 100, plain);
    setStagePost([2, 0, 0, 2, 100, -50]);
    const posted = [0, 0];
    localToStage(a, 1000, 500, 300, 100, posted);
    expect(posted[0]).toBeCloseTo(plain[0] * 2 + 100, 6);
    expect(posted[1]).toBeCloseTo(plain[1] * 2 - 50, 6);
    const back = [0, 0];
    stageToLocal(a, 1000, 500, posted[0], posted[1], back);
    expect(back[0]).toBeCloseTo(300, 6);
    expect(back[1]).toBeCloseTo(100, 6);
  });

  it('stops applying the post matrix once it is cleared', () => {
    setStagePost([1, 0, 0, 1, 500, 500]);
    setStagePost(null);
    const out = [0, 0];
    localToStage(anim(), 1000, 500, 1, 2, out);
    expect(out).toEqual([1, 2]);
  });

  it('gives finite numbers back from a content scaled to nothing', () => {
    const out = [0, 0];
    stageToLocal(anim({ scaleX: 0, scaleY: 0 }), 1000, 500, 600, 300, out);
    expect(Number.isFinite(out[0])).toBe(true);
    expect(Number.isFinite(out[1])).toBe(true);
  });
});

describe('scratch buffers', () => {
  it('hands out a view of exactly the asked length', () => {
    expect(grab('F19-a', 10)).toHaveLength(10);
    expect(grab('F19-a', 0)).toHaveLength(0);
  });

  it('reuses the memory of a slot and keeps slots apart', () => {
    const first = grab('F19-b', 8);
    first[0] = 42;
    expect(grab('F19-b', 4)[0]).toBe(42);
    expect(grab('F19-b', 4).buffer).toBe(first.buffer);
    expect(grab('F19-c', 4).buffer).not.toBe(first.buffer);
  });

  it('grows when more is asked than it holds', () => {
    const small = grab('F19-d', 16);
    const big = grab('F19-d', 5000);
    expect(big).toHaveLength(5000);
    expect(big.buffer).not.toBe(small.buffer);
  });
});

describe('warpQuads', () => {
  it('is empty for content that is neither warped nor distorted', () => {
    expect(warpQuads(anim(), 1000, 500)).toHaveLength(0);
  });

  it('makes two triangles for each cell of a twelve step grid for a distort', () => {
    expect(warpQuads(anim({ distort: zeros(8) }), 1000, 500)).toHaveLength(12 * 12 * 2 * 12);
  });

  it('uses more steps for a finer warp mesh', () => {
    const coarse = warpQuads(anim({ warp: { n: 2, dx: zeros(4), dy: zeros(4) } }), 1000, 500).length;
    const fine = warpQuads(anim({ warp: { n: 4, dx: zeros(16), dy: zeros(16) } }), 1000, 500).length;
    expect(coarse).toBe(16 * 16 * 24);
    expect(fine).toBe(15 * 15 * 24);
  });

  it('puts every destination on its source when nothing is moved', () => {
    const t = warpQuads(anim({ distort: zeros(8) }), 1200, 600);
    for (let p = 0; p < t.length; p += 12) for (let i = 0; i < 6; i++) expect(t[p + 6 + i]).toBeCloseTo(t[p + i], 2);
  });

  it('starts at the top left cell of the given rectangle', () => {
    const t = warpQuads(anim({ distort: zeros(8) }), 1000, 500, { x: 100, y: 50, w: 240, h: 120 });
    expect(Array.from(t.subarray(0, 6))).toEqual([100, 50, 120, 50, 100, 60]);
    expect(Array.from(t.subarray(12, 18))).toEqual([120, 50, 120, 60, 100, 60]);
  });

  it('carries the content move into the destinations only', () => {
    const t = warpQuads(anim({ distort: zeros(8), x: 30, y: -20 }), 1200, 600);
    expect(t[0]).toBe(0);
    expect(t[1]).toBe(0);
    expect(t[6]).toBeCloseTo(30, 3);
    expect(t[7]).toBeCloseTo(-20, 3);
  });

  it('covers the moved corner of a distort', () => {
    const t = warpQuads(anim({ distort: [0, 0, 0, 0, 60, 40, 0, 0] }), 1200, 600);
    const last = t.length - 12;
    expect(t[last + 2]).toBe(1200);
    expect(t[last + 3]).toBe(600);
    expect(t[last + 8]).toBeCloseTo(1260, 2);
    expect(t[last + 9]).toBeCloseTo(640, 2);
  });
});

describe('drawTriangles', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  interface FakeCtx {
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: string;
    draws: { smooth: boolean; quality: string; matrix: number[] }[];
    depth: number;
  }

  function fake(): FakeCtx & Record<string, unknown> {
    const ctx: FakeCtx & Record<string, unknown> = {
      imageSmoothingEnabled: true, imageSmoothingQuality: 'low', draws: [], depth: 0,
    };
    let last: number[] = [];
    ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    ctx.save = () => { ctx.depth++; };
    ctx.restore = () => { ctx.depth--; };
    ctx.setTransform = () => undefined;
    ctx.beginPath = () => undefined;
    ctx.moveTo = () => undefined;
    ctx.lineTo = () => undefined;
    ctx.closePath = () => undefined;
    ctx.clip = () => undefined;
    ctx.transform = (...m: number[]) => { last = m; };
    ctx.drawImage = () => { ctx.draws.push({ smooth: ctx.imageSmoothingEnabled, quality: ctx.imageSmoothingQuality, matrix: last }); };
    return ctx;
  }

  const src = {} as CanvasImageSource;
  const tri = (dx: number, dy: number): number[] => [0, 0, 10, 0, 0, 10, dx, dy, 10 + dx, dy, dx, 10 + dy];
  const asCtx = (c: unknown): CanvasRenderingContext2D => c as CanvasRenderingContext2D;

  it('draws one picture for each triangle with the map from source to destination', () => {
    const ctx = fake();
    drawTriangles(asCtx(ctx), src, new Float32Array([...tri(5, 7), ...tri(40, 0)]), { scale: 2, ox: 3, oy: 4 });
    expect(ctx.draws).toHaveLength(2);
    const m = ctx.draws[0].matrix;
    expect(m[0]).toBeCloseTo(1, 6);
    expect(m[1]).toBeCloseTo(0, 6);
    expect(m[2]).toBeCloseTo(0, 6);
    expect(m[3]).toBeCloseTo(1, 6);
    expect(m[4]).toBeCloseTo(13, 6);
    expect(m[5]).toBeCloseTo(18, 6);
    expect(ctx.depth).toBe(0);
  });

  it('draws nothing for an empty list or a triangle with no source area', () => {
    const ctx = fake();
    drawTriangles(asCtx(ctx), src, new Float32Array(0), { scale: 1, ox: 0, oy: 0 });
    drawTriangles(asCtx(ctx), src, new Float32Array([0, 0, 5, 5, 10, 10, 0, 0, 10, 0, 0, 10]), { scale: 1, ox: 0, oy: 0 });
    expect(ctx.draws).toHaveLength(0);
  });

  it('switches smoothing for the draw and puts it back after', () => {
    const ctx = fake();
    drawTriangles(asCtx(ctx), src, new Float32Array(tri(0, 0)), { scale: 1, ox: 0, oy: 0, resample: 'nearest' });
    drawTriangles(asCtx(ctx), src, new Float32Array(tri(0, 0)), { scale: 1, ox: 0, oy: 0, resample: 'high' });
    expect(ctx.draws.map((d) => d.smooth)).toEqual([false, true]);
    expect(ctx.draws[1].quality).toBe('high');
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe('low');
  });
});
