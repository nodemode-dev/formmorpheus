import { describe, expect, it } from 'vitest';
import { filesOfDrop } from '@src/io/drop-files';

interface Entry { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (f: File) => void, no: (e: unknown) => void) => void; createReader?: () => { readEntries(ok: (a: Entry[]) => void, no: (e: unknown) => void): void } }

const fileEntry = (name: string): Entry => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(new File(['x'], name)) });
const brokenEntry = (name: string): Entry => ({ isFile: true, isDirectory: false, name, file: (_ok, no) => no(new Error('gone')) });
const dirEntry = (name: string, batches: Entry[][]): Entry => ({
  isFile: false, isDirectory: true, name,
  createReader: () => { let n = 0; return { readEntries: (ok) => ok(batches[n++] ?? []) }; },
});
const drop = (files: File[], entries: (Entry | null)[]): DataTransfer => ({
  files,
  items: entries.map((e) => ({ kind: e ? 'file' : 'string', webkitGetAsEntry: () => e })),
} as unknown as DataTransfer);

describe('files of a drop', () => {
  it('gives nothing for a drop without data', async () => {
    expect(await filesOfDrop(null)).toEqual([]);
  });

  it('gives the plain files when no folder was dropped', async () => {
    const f = new File(['a'], 'a.png');
    expect(await filesOfDrop(drop([f], [fileEntry('a.png')]))).toEqual([f]);
  });

  it('gives the plain files when the items list is missing', async () => {
    const f = new File(['a'], 'a.png');
    expect(await filesOfDrop({ files: [f] } as unknown as DataTransfer)).toEqual([f]);
  });

  it('walks a dropped folder through every batch and nested folder, in order', async () => {
    const dir = dirEntry('seq', [[fileEntry('1.png'), dirEntry('sub', [[fileEntry('2.png')]])], [fileEntry('3.png')]]);
    const out = await filesOfDrop(drop([], [dir, fileEntry('top.png')]));
    expect(out.map((f) => f.name)).toEqual(['1.png', '2.png', '3.png', 'top.png']);
  });

  it('drops hidden files and skips unreadable ones from a folder', async () => {
    const dir = dirEntry('seq', [[fileEntry('.DS_Store'), brokenEntry('bad.png'), fileEntry('ok.png')]]);
    const out = await filesOfDrop(drop([], [dir]));
    expect(out.map((f) => f.name)).toEqual(['ok.png']);
  });

  it('falls back to the plain files when the folder walk finds nothing', async () => {
    const f = new File(['a'], 'a.png');
    expect(await filesOfDrop(drop([f], [dirEntry('empty', [])]))).toEqual([f]);
  });

  it('survives a folder whose listing fails', async () => {
    const bad: Entry = { isFile: false, isDirectory: true, name: 'bad', createReader: () => ({ readEntries: (_ok, no) => no(new Error('denied')) }) };
    const out = await filesOfDrop(drop([], [bad, fileEntry('a.png')]));
    expect(out.map((f) => f.name)).toEqual(['a.png']);
  });

  it('stops at two thousand files from one huge folder', async () => {
    const batch = Array.from({ length: 1500 }, (_, i) => fileEntry(`${i}.png`));
    const out = await filesOfDrop(drop([], [dirEntry('big', [batch, batch, batch])]));
    expect(out).toHaveLength(2000);
  });
});
