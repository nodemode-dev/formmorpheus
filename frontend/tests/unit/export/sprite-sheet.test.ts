import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const open = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@src/export/worker-host', () => ({ openPngFrames: open.fn }));

import { copyFrameToClipboard, exportSpriteSheet } from '@src/export/sprite-sheet';

type Deps = Parameters<typeof exportSpriteSheet>[0];
interface Asked { width: number; height: number; frames: number[]; keepAlpha: boolean }

const draws: number[][] = [];
const sheets: { width: number; height: number }[] = [];
const closeSrc = vi.fn();
const closeBmp = vi.fn();

class FakeCanvas {
  constructor(public width: number, public height: number) { sheets.push(this); }
  getContext(): unknown { return { drawImage: (_b: unknown, ...r: number[]) => { draws.push(r); } }; }
  convertToBlob(o: { type: string }): Promise<Blob> { return Promise.resolve(new Blob(['png'], { type: o.type })); }
}

const deps = (width: number, height: number, name = 'clip'): Deps => ({ movie: { width, height, name, fps: 24 }, renderer: {}, audio: null } as unknown as Deps);
const asked = (): Asked => open.fn.mock.calls[0][1] as Asked;

beforeEach(() => {
  draws.length = 0;
  sheets.length = 0;
  closeSrc.mockReset();
  closeBmp.mockReset();
  open.fn.mockReset();
  open.fn.mockResolvedValue({ blob: () => Promise.resolve(new Blob(['f'])), close: closeSrc });
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({ close: closeBmp }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('exportSpriteSheet', () => {
  it('lays ten frames out in a roughly square grid of full-size cells', async () => {
    const r = await exportSpriteSheet(deps(100, 50), { from: 0, to: 10, alpha: true });
    expect([r.cols, r.rows, r.frames]).toEqual([2, 5, 10]);
    expect(r.cell).toEqual([100, 50]);
    expect(asked()).toEqual({ width: 100, height: 50, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], keepAlpha: true });
    expect(sheets[0]).toMatchObject({ width: 200, height: 250 });
    expect(draws[3]).toEqual([100, 50, 100, 50]);
    expect(draws[9]).toEqual([100, 200, 100, 50]);
  });

  it('writes a JSON that names the picture and every frame rectangle', async () => {
    const r = await exportSpriteSheet(deps(100, 50), { from: 5, to: 8, alpha: false });
    const j = JSON.parse(await r.json.text()) as { image: string; size: { w: number; h: number }; cell: { w: number; h: number }; cols: number; rows: number; fps: number; frames: { frame: number; x: number; y: number; w: number; h: number }[] };
    expect(j.image).toBe('clip sprites.png');
    expect(j.fps).toBe(24);
    expect(j.size).toEqual({ w: j.cols * 100, h: j.rows * 50 });
    expect(j.frames.map((f) => f.frame)).toEqual([5, 6, 7]);
    expect(j.frames.every((f) => f.w === 100 && f.h === 50 && f.x + f.w <= j.size.w && f.y + f.h <= j.size.h)).toBe(true);
    expect(new Set(j.frames.map((f) => `${f.x},${f.y}`)).size).toBe(3);
    expect(r.png.type).toBe('image/png');
    expect(r.json.type).toBe('application/json');
    expect(asked().keepAlpha).toBe(false);
  });

  it('samples a long range evenly down to 256 cells inside the range', async () => {
    const r = await exportSpriteSheet(deps(64, 64), { from: 10, to: 310, alpha: true, cellLong: 16 });
    const f = asked().frames;
    expect(r.frames).toBe(256);
    expect(f.length).toBe(256);
    expect(f[0]).toBe(10);
    expect(f[255]).toBe(10 + 298);
    expect(f.every((v, i) => i === 0 || v > f[i - 1])).toBe(true);
  });

  it('exports one frame for an empty or reversed range', async () => {
    const r = await exportSpriteSheet(deps(100, 50), { from: 7, to: 3, alpha: true });
    expect([r.cols, r.rows, r.frames]).toEqual([1, 1, 1]);
    expect(asked().frames).toEqual([7]);
  });

  it('clamps the cell size between 16 and 1024 on the long side and never enlarges', async () => {
    const small = await exportSpriteSheet(deps(1000, 500), { from: 0, to: 2, alpha: true, cellLong: 4 });
    expect(small.cell).toEqual([16, 8]);
    const big = await exportSpriteSheet(deps(4000, 2000), { from: 0, to: 2, alpha: true, cellLong: 5000 });
    expect(big.cell).toEqual([1024, 512]);
    const tiny = await exportSpriteSheet(deps(40, 20), { from: 0, to: 2, alpha: true, cellLong: 512 });
    expect(tiny.cell).toEqual([40, 20]);
  });

  it('shrinks the cells until the sheet fits 8192 pixels a side', async () => {
    const r = await exportSpriteSheet(deps(2048, 1024), { from: 0, to: 256, alpha: true, cellLong: 1024 });
    expect(r.cols * r.cell[0]).toBeLessThanOrEqual(8192);
    expect(r.rows * r.cell[1]).toBeLessThanOrEqual(8192);
    expect(r.cols * r.rows).toBeGreaterThanOrEqual(256);
    expect(r.cell[0]).toBeLessThan(1024);
    expect(r.cell[0] / r.cell[1]).toBeCloseTo(2, 1);
  });

  it('reports progress once a frame and releases every bitmap and the source', async () => {
    const seen: number[][] = [];
    await exportSpriteSheet(deps(100, 50), { from: 0, to: 4, alpha: true }, (d, t) => { seen.push([d, t]); });
    expect(seen).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    expect(closeBmp).toHaveBeenCalledTimes(4);
    expect(closeSrc).toHaveBeenCalledTimes(1);
  });

  it('closes the frame source when a frame fails', async () => {
    open.fn.mockResolvedValue({ blob: () => Promise.reject(new Error('lost')), close: closeSrc });
    await expect(exportSpriteSheet(deps(100, 50), { from: 0, to: 4, alpha: true })).rejects.toThrow('lost');
    expect(closeSrc).toHaveBeenCalledTimes(1);
  });

  it('makes a file-safe name and falls back when the movie has none', async () => {
    expect((await exportSpriteSheet(deps(10, 10, 'a/b:c*d'), { from: 0, to: 1, alpha: true })).name).toBe('a_b_c_d');
    expect((await exportSpriteSheet(deps(10, 10, ''), { from: 0, to: 1, alpha: true })).name).toBe('movie');
  });
});

describe('copyFrameToClipboard', () => {
  it('answers false without asking for a frame when there is no image clipboard', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    expect(await copyFrameToClipboard(deps(100, 50), 3, true)).toBe(false);
    expect(open.fn).not.toHaveBeenCalled();
  });

  it('writes the frame at movie size and closes the source', async () => {
    const write = vi.fn(() => Promise.resolve());
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} });
    vi.stubGlobal('navigator', { clipboard: { write } });
    expect(await copyFrameToClipboard(deps(100, 50), 3, false)).toBe(true);
    expect(asked()).toEqual({ width: 100, height: 50, frames: [3], keepAlpha: false });
    expect(write).toHaveBeenCalledTimes(1);
    expect(closeSrc).toHaveBeenCalledTimes(1);
  });

  it('answers false and still closes the source when the browser refuses', async () => {
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} });
    vi.stubGlobal('navigator', { clipboard: { write: () => Promise.reject(new Error('denied')) } });
    expect(await copyFrameToClipboard(deps(100, 50), 3, true)).toBe(false);
    expect(closeSrc).toHaveBeenCalledTimes(1);
  });
});
