import { describe, expect, it } from 'vitest';
import { isPsd, readPsd } from '@src/io/psd-import';

interface Head { version?: number; channels?: number; width?: number; height?: number; depth?: number; mode?: number }

function psd(h: Head, planes: number[][] = []): File {
  const body = planes.flat();
  const d = new Uint8Array(48 + body.length);
  const v = new DataView(d.buffer);
  d.set([0x38, 0x42, 0x50, 0x53]);
  v.setUint16(4, h.version ?? 1);
  v.setUint16(12, h.channels ?? 3);
  v.setUint32(14, h.height ?? 1);
  v.setUint32(18, h.width ?? 2);
  v.setUint16(22, h.depth ?? 8);
  v.setUint16(24, h.mode ?? 3);
  v.setUint32(34, 8);
  d.set(body, 48);
  return new File([d], 'art.psd');
}

describe('isPsd', () => {
  it('knows the signature and nothing else', () => {
    expect(isPsd(new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 1]))).toBe(true);
    expect(isPsd(new Uint8Array([0x38, 0x42, 0x50, 0x54]))).toBe(false);
    expect(isPsd(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isPsd(new Uint8Array(0))).toBe(false);
  });
});

describe('readPsd refusals', () => {
  it('refuses a file without the signature', async () => {
    await expect(readPsd(new File([new Uint8Array(64)], 'fake.psd'))).rejects.toThrow('fake.psd is not a PSD file.');
  });

  it('refuses a version that is neither 1 nor 2', async () => {
    await expect(readPsd(psd({ version: 3 }))).rejects.toThrow(/not a PSD or PSB file/);
    await expect(readPsd(psd({ version: 0 }))).rejects.toThrow(/not a PSD or PSB file/);
  });

  it('refuses a canvas with a zero side', async () => {
    await expect(readPsd(psd({ width: 0 }))).rejects.toThrow(/size cannot be opened/);
    await expect(readPsd(psd({ height: 0 }))).rejects.toThrow(/size cannot be opened/);
  });

  it('refuses a canvas past the side limit or the pixel limit before reading any pixels', async () => {
    await expect(readPsd(psd({ width: 30001, height: 1 }))).rejects.toThrow(/size cannot be opened/);
    await expect(readPsd(psd({ width: 0xffffffff, height: 0xffffffff }))).rejects.toThrow(/size cannot be opened/);
    await expect(readPsd(psd({ width: 20000, height: 20000 }))).rejects.toThrow(/size cannot be opened/);
  });

  it('refuses bit depths other than 8 and 16', async () => {
    await expect(readPsd(psd({ depth: 32 }))).rejects.toThrow(/32-bit/);
    await expect(readPsd(psd({ depth: 1 }))).rejects.toThrow(/only 8 and 16 bit open/);
  });

  it('refuses color modes other than RGB and grayscale, naming the mode', async () => {
    await expect(readPsd(psd({ mode: 4 }))).rejects.toThrow(/CMYK/);
    await expect(readPsd(psd({ mode: 2 }))).rejects.toThrow(/indexed color/);
    await expect(readPsd(psd({ mode: 0 }))).rejects.toThrow(/bitmap/);
    await expect(readPsd(psd({ mode: 9 }))).rejects.toThrow(/only RGB and grayscale open/);
  });
});

describe('readPsd on a document without layers', () => {
  it('opens the merged RGB picture as one opaque layer', async () => {
    const doc = await readPsd(psd({ width: 2, height: 1, channels: 3 }, [[10, 20], [30, 40], [50, 60]]));
    expect(doc.name).toBe('art');
    expect([doc.width, doc.height]).toEqual([2, 1]);
    const drawn = doc.layers.filter((l) => l.pixels);
    expect(drawn).toHaveLength(1);
    expect(Array.from(drawn[0].pixels?.rgba ?? [])).toEqual([10, 30, 50, 255, 20, 40, 60, 255]);
    expect(doc.notes.length).toBeGreaterThan(0);
  });

  it('takes the fourth channel of the merged picture as its transparency', async () => {
    const doc = await readPsd(psd({ width: 1, height: 2, channels: 4 }, [[1, 2], [3, 4], [5, 6], [0, 128]]));
    expect(Array.from(doc.layers[0].pixels?.rgba ?? [])).toEqual([1, 3, 5, 0, 2, 4, 6, 128]);
  });

  it('refuses a document with no layers and too few channels for a picture', async () => {
    await expect(readPsd(psd({ width: 2, height: 1, channels: 2 }, [[1, 2], [3, 4]]))).rejects.toThrow(/no layers and no readable merged picture/);
  });

  it('opens a merged grayscale picture with equal red, green and blue', async () => {
    const doc = await readPsd(psd({ width: 2, height: 1, channels: 1, mode: 1 }, [[7, 200]]));
    const drawn = doc.layers.filter((l) => l.pixels);
    expect(Array.from(drawn[0].pixels?.rgba ?? [])).toEqual([7, 7, 7, 255, 200, 200, 200, 255]);
  });
});
