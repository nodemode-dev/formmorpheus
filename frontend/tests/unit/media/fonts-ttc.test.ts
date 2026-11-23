import { describe, expect, it } from 'vitest';
import { isCollection, splitCollection } from '@src/media/fonts-ttc';

interface Table { tag: string; data: number[] }

function ttc(faces: Table[][], damage?: (dv: DataView) => void): Uint8Array {
  const headerLen = 12 + faces.length * 4;
  const faceLens = faces.map((t) => 12 + t.length * 16);
  let dataAt = headerLen + faceLens.reduce((a, b) => a + b, 0);
  const blobs: Array<{ at: number; data: number[] }> = [];
  const offsets: number[][] = faces.map((tables) => tables.map((t) => { const at = dataAt; blobs.push({ at, data: t.data }); dataAt += t.data.length; return at; }));
  const b = new Uint8Array(dataAt);
  const dv = new DataView(b.buffer);
  b.set([0x74, 0x74, 0x63, 0x66], 0);
  dv.setUint32(4, 0x00010000);
  dv.setUint32(8, faces.length);
  let faceAt = headerLen;
  faces.forEach((tables, i) => {
    dv.setUint32(12 + i * 4, faceAt);
    dv.setUint32(faceAt, 0x00010000);
    dv.setUint16(faceAt + 4, tables.length);
    tables.forEach((t, k) => {
      const rec = faceAt + 12 + k * 16;
      for (let j = 0; j < 4; j++) b[rec + j] = t.tag.charCodeAt(j);
      dv.setUint32(rec + 8, offsets[i][k]);
      dv.setUint32(rec + 12, t.data.length);
    });
    faceAt += faceLens[i];
  });
  for (const blob of blobs) b.set(blob.data, blob.at);
  if (damage) damage(dv);
  return b;
}

function tableOf(face: Uint8Array, k: number): { tag: string; data: number[] } {
  const dv = new DataView(face.buffer, face.byteOffset, face.byteLength);
  const rec = 12 + k * 16;
  const tag = String.fromCharCode(face[rec], face[rec + 1], face[rec + 2], face[rec + 3]);
  const off = dv.getUint32(rec + 8), len = dv.getUint32(rec + 12);
  return { tag, data: Array.from(face.subarray(off, off + len)) };
}

describe('isCollection', () => {
  it('recognises the collection tag', () => {
    expect(isCollection(ttc([[{ tag: 'head', data: [1, 2, 3, 4] }]]))).toBe(true);
  });

  it('refuses a plain font header', () => {
    const b = new Uint8Array(32);
    b.set([0, 1, 0, 0]);
    expect(isCollection(b)).toBe(false);
  });

  it('refuses a buffer too short to hold a header', () => {
    expect(isCollection(Uint8Array.from([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0]))).toBe(false);
  });
});

describe('splitCollection', () => {
  it('returns nothing for a buffer that is not a collection', () => {
    expect(splitCollection(new Uint8Array(64))).toEqual([]);
  });

  it('cuts every face into its own font with the tables relocated', () => {
    const faces = [
      [{ tag: 'head', data: [1, 2, 3, 4, 5] }, { tag: 'name', data: [9, 8, 7] }],
      [{ tag: 'head', data: [6, 6, 6, 6] }],
    ];
    const out = splitCollection(ttc(faces));
    expect(out).toHaveLength(2);
    expect(tableOf(out[0], 0)).toEqual({ tag: 'head', data: [1, 2, 3, 4, 5] });
    expect(tableOf(out[0], 1)).toEqual({ tag: 'name', data: [9, 8, 7] });
    expect(tableOf(out[1], 0)).toEqual({ tag: 'head', data: [6, 6, 6, 6] });
    expect(new DataView(out[1].buffer).getUint16(4)).toBe(1);
  });

  it('pads every table to four bytes', () => {
    const out = splitCollection(ttc([[{ tag: 'head', data: [1, 2, 3, 4, 5] }, { tag: 'name', data: [7] }]]));
    expect(out[0].length).toBe(12 + 2 * 16 + 8 + 4);
    const dv = new DataView(out[0].buffer);
    expect(dv.getUint32(12 + 8) % 4).toBe(0);
    expect(dv.getUint32(12 + 16 + 8) % 4).toBe(0);
  });

  it('leaves out a face whose table runs past the end and keeps the others', () => {
    const faces = [[{ tag: 'head', data: [1, 2, 3, 4] }], [{ tag: 'head', data: [5, 6, 7, 8] }]];
    const b = ttc(faces, (dv) => {
      const second = dv.getUint32(16);
      dv.setUint32(second + 12 + 12, 1 << 20);
    });
    const out = splitCollection(b);
    expect(out).toHaveLength(1);
    expect(tableOf(out[0], 0).data).toEqual([1, 2, 3, 4]);
  });

  it('leaves out a face with no tables', () => {
    const out = splitCollection(ttc([[], [{ tag: 'head', data: [1, 2, 3, 4] }]]));
    expect(out).toHaveLength(1);
    expect(tableOf(out[0], 0).data).toEqual([1, 2, 3, 4]);
  });
});
