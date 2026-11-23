import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/export/worker-host', () => ({ openPngFrames: vi.fn() }));

import { encodeWav, jobCapabilities } from '@src/export/engine-jobs';

function buffer(channels: number[][], sampleRate: number): AudioBuffer {
  const data = channels.map((c) => Float32Array.from(c));
  return {
    numberOfChannels: data.length, sampleRate, length: data[0].length,
    getChannelData: (c: number) => data[c],
  } as unknown as AudioBuffer;
}

async function view(b: Blob): Promise<DataView> {
  return new DataView(await b.arrayBuffer());
}

const tag = (dv: DataView, o: number): string => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

describe('encodeWav', () => {
  it('writes a 16 bit PCM header that matches the data', async () => {
    const blob = encodeWav(buffer([[0, 0, 0], [0, 0, 0]], 48000), 3);
    expect(blob.type).toBe('audio/wav');
    const dv = await view(blob);
    expect(dv.byteLength).toBe(44 + 12);
    expect([tag(dv, 0), tag(dv, 8), tag(dv, 12), tag(dv, 36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(dv.getUint32(4, true)).toBe(36 + 12);
    expect([dv.getUint32(16, true), dv.getUint16(20, true), dv.getUint16(22, true)]).toEqual([16, 1, 2]);
    expect([dv.getUint32(24, true), dv.getUint32(28, true), dv.getUint16(32, true), dv.getUint16(34, true)]).toEqual([48000, 192000, 4, 16]);
    expect(dv.getUint32(40, true)).toBe(12);
  });

  it('interleaves the channels and clamps samples to full scale', async () => {
    const dv = await view(encodeWav(buffer([[1, -1, 2], [0, 0.5, -3]], 44100), 0));
    const got = Array.from({ length: 6 }, (_, i) => dv.getInt16(44 + i * 2, true));
    expect(got).toEqual([32767, 0, -32768, 16383, 32767, -32768]);
  });

  it('pads with silence up to the asked length', async () => {
    const dv = await view(encodeWav(buffer([[1, 1]], 8000), 5));
    expect(dv.getUint32(40, true)).toBe(10);
    expect(Array.from({ length: 5 }, (_, i) => dv.getInt16(44 + i * 2, true))).toEqual([32767, 32767, 0, 0, 0]);
  });

  it('never cuts the sound when the asked length is shorter', async () => {
    const dv = await view(encodeWav(buffer([[1, 1, 1, 1]], 8000), 2));
    expect(dv.getUint32(40, true)).toBe(8);
  });
});

describe('jobCapabilities', () => {
  it('returns null when the engine does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await jobCapabilities()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns null on a refusal and the body on success', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({}) }).mockResolvedValueOnce({ ok: true, json: async () => ({ ffmpeg: true }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await jobCapabilities()).toBeNull();
    expect(await jobCapabilities()).toEqual({ ffmpeg: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs/capabilities');
    vi.unstubAllGlobals();
  });
});
