import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ can: vi.fn(), caps: vi.fn(), engine: vi.fn(), auto: vi.fn() }));
vi.mock('mediabunny', () => ({ canEncodeVideo: m.can, QUALITY_LOW: 'low', QUALITY_MEDIUM: 'medium', QUALITY_HIGH: 'high', QUALITY_VERY_HIGH: 'very-high' }));
vi.mock('@src/export/engine-jobs', () => ({ jobCapabilities: m.caps, startEngineExport: m.engine }));
vi.mock('@src/export/worker-host', () => ({ startExportAuto: m.auto }));

import { browserEncodesVideo, engineVideoBlocker, startExportRouted } from '@src/export/route';
import type { ExportJob, ExportOptions, ExportProgress, ExportResult } from '@src/export/types';

type Deps = Parameters<typeof startExportRouted>[0];
const deps = { movie: { fps: 30, width: 640, height: 360 } } as unknown as Deps;
const opts = (format: string, over: Record<string, unknown> = {}): ExportOptions => ({ format, width: 640, height: 360, quality: 'high', ...over } as unknown as ExportOptions);
const able = { ffmpeg: true, targets: { h264: { available: true } } };

function fakeJob(warnings: string[] = []): ExportJob & { emit: (p: ExportProgress) => void; cancel: ReturnType<typeof vi.fn> } {
  const cbs: ((p: ExportProgress) => void)[] = [];
  return {
    onProgress: (cb: (p: ExportProgress) => void) => { cbs.push(cb); },
    cancel: vi.fn(),
    result: Promise.resolve({ warnings } as unknown as ExportResult),
    emit: (p: ExportProgress) => { for (const cb of cbs) cb(p); },
  } as ExportJob & { emit: (p: ExportProgress) => void; cancel: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.can.mockResolvedValue(false);
  m.caps.mockResolvedValue(able);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('browserEncodesVideo', () => {
  it('is false without asking when the window has no video encoder', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    expect(await browserEncodesVideo('mp4', opts('mp4'), 30)).toBe(false);
    expect(m.can).not.toHaveBeenCalled();
  });

  it('tries the codecs of the container in order and stops at the first that works', async () => {
    vi.stubGlobal('VideoEncoder', class {});
    m.can.mockImplementation((codec: string) => Promise.resolve(codec === 'av1'));
    expect(await browserEncodesVideo('webm', opts('webm'), 25)).toBe(true);
    expect(m.can.mock.calls.map((c) => c[0])).toEqual(['vp9', 'av1']);
    expect(m.can.mock.calls[0][1]).toEqual({ width: 640, height: 360, quality: 'high', frameRate: 25 });
    m.can.mockClear();
    m.can.mockResolvedValue(false);
    expect(await browserEncodesVideo('mov', opts('mov'), 25)).toBe(false);
    expect(m.can.mock.calls.map((c) => c[0])).toEqual(['avc', 'hevc', 'av1', 'vp9']);
  });

  it('moves on to the next codec when a check throws', async () => {
    vi.stubGlobal('VideoEncoder', class {});
    m.can.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true);
    expect(await browserEncodesVideo('mp4', opts('mp4'), 30)).toBe(true);
    expect(m.can).toHaveBeenCalledTimes(2);
  });
});

describe('engineVideoBlocker', () => {
  it('is empty when the engine has an H.264 encoder', async () => {
    expect(await engineVideoBlocker()).toBe('');
  });

  it('gives a different reason for a silent engine, no ffmpeg and no H.264', async () => {
    m.caps.mockResolvedValueOnce(null);
    const silent = await engineVideoBlocker();
    m.caps.mockResolvedValueOnce({ ffmpeg: false, targets: {} });
    const none = await engineVideoBlocker();
    m.caps.mockResolvedValueOnce({ ffmpeg: true, targets: { h264: { available: false } } });
    const noCodec = await engineVideoBlocker();
    m.caps.mockResolvedValueOnce({ ffmpeg: true, targets: {} });
    const missing = await engineVideoBlocker();
    expect(new Set([silent, none, noCodec]).size).toBe(3);
    expect([silent, none, noCodec].every((s) => s.length > 0)).toBe(true);
    expect(missing).toBe(noCodec);
  });
});

describe('startExportRouted', () => {
  it('hands anything that is not a movie container straight to the window export', () => {
    const j = fakeJob();
    m.auto.mockReturnValue(j);
    const o = opts('gif');
    expect(startExportRouted(deps, o)).toBe(j);
    expect(m.auto).toHaveBeenCalledWith(deps, o);
    expect(m.can).not.toHaveBeenCalled();
  });

  it('uses the window encoder when it can make the video and passes progress on', async () => {
    vi.stubGlobal('VideoEncoder', class {});
    m.can.mockResolvedValue(true);
    const j = fakeJob(['w']);
    m.auto.mockReturnValue(j);
    const job = startExportRouted(deps, opts('mp4'));
    const seen: ExportProgress[] = [];
    job.onProgress((p) => { seen.push(p); });
    const res = await job.result;
    const p = { done: 1 } as unknown as ExportProgress;
    j.emit(p);
    expect(seen).toEqual([p]);
    expect(res.warnings).toEqual(['w']);
    expect(m.engine).not.toHaveBeenCalled();
    expect(m.can.mock.calls[0][1].frameRate).toBe(30);
  });

  it('asks about the requested frame rate when one is given', async () => {
    vi.stubGlobal('VideoEncoder', class {});
    m.can.mockResolvedValue(true);
    m.auto.mockReturnValue(fakeJob());
    await startExportRouted(deps, opts('mp4', { fps: 12 })).result;
    expect(m.can.mock.calls[0][1].frameRate).toBe(12);
  });

  it('sends MP4 the window cannot encode to the engine as H.264 and says so first', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    m.engine.mockReturnValue(fakeJob(['engine note']));
    const res = await startExportRouted(deps, opts('mp4')).result;
    expect(m.engine.mock.calls[0][1]).toMatchObject({ format: 'h264-mp4', target: 'h264', width: 640, height: 360 });
    expect(res.warnings.length).toBe(2);
    expect(res.warnings[1]).toBe('engine note');
    expect(res.warnings[0]).toContain('MP4');
    expect(m.auto).not.toHaveBeenCalled();
  });

  it('sends MOV to the engine as an H.264 MOV', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    m.engine.mockReturnValue(fakeJob());
    await startExportRouted(deps, opts('mov')).result;
    expect(m.engine.mock.calls[0][1]).toMatchObject({ format: 'h264-mov', target: 'h264' });
  });

  it('refuses WebM the window cannot encode without asking the engine', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    await expect(startExportRouted(deps, opts('webm')).result).rejects.toThrow(/WebM/);
    expect(m.caps).not.toHaveBeenCalled();
    expect(m.engine).not.toHaveBeenCalled();
  });

  it('refuses with the size and the reason when the engine cannot encode either', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    m.caps.mockResolvedValue({ ffmpeg: false, targets: {} });
    const why = await engineVideoBlocker();
    const err = await startExportRouted(deps, opts('mp4')).result.then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain(why);
    expect(err?.message).toContain('640');
    expect(err?.message).toContain('360');
    expect(m.engine).not.toHaveBeenCalled();
  });

  it('aborts when cancelled before the route is chosen', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    const job = startExportRouted(deps, opts('mp4'));
    job.cancel();
    await expect(job.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.engine).not.toHaveBeenCalled();
  });

  it('passes a later cancel on to the job that is running', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    const j = fakeJob();
    m.engine.mockReturnValue(j);
    const job = startExportRouted(deps, opts('mp4'));
    await job.result;
    job.cancel();
    expect(j.cancel).toHaveBeenCalledTimes(1);
  });
});
