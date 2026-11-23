import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { mediaKind, sniffProject, SNIFF_FILE_MAX } from '@src/io/project-sniff';

const bytes = (head: number[] | string, size = 16): Uint8Array => {
  const b = new Uint8Array(size);
  if (typeof head === 'string') b.set(strToU8(head));
  else b.set(head);
  return b;
};
const png = (): Uint8Array => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpg = (): Uint8Array => bytes([0xff, 0xd8, 0xff, 0xe0]);
const ftyp = (brand: string): Uint8Array => { const b = bytes([0, 0, 0, 0x18]); b.set(strToU8(`ftyp${brand}`), 4); return b; };
const wav = (): Uint8Array => { const b = bytes('RIFF'); b.set(strToU8('WAVE'), 8); return b; };
const fileOf = (data: Uint8Array, name: string): File => new File([data as Uint8Array<ArrayBuffer>], name);

describe('mediaKind', () => {
  it('tells pictures by their first bytes', () => {
    expect(mediaKind(png())).toEqual({ kind: 'picture', ext: 'png', mime: 'image/png' });
    expect(mediaKind(jpg())).toEqual({ kind: 'picture', ext: 'jpg', mime: 'image/jpeg' });
    expect(mediaKind(ftyp('heic'))?.ext).toBe('heic');
    expect(mediaKind(ftyp('mif1'))?.kind).toBe('picture');
  });

  it('tells sounds by their first bytes', () => {
    expect(mediaKind(wav())).toEqual({ kind: 'sound', ext: 'wav', mime: 'audio/wav' });
    expect(mediaKind(ftyp('M4A '))).toEqual({ kind: 'sound', ext: 'm4a', mime: 'audio/mp4' });
    expect(mediaKind(bytes('ID3'))?.ext).toBe('mp3');
    expect(mediaKind(bytes([0xff, 0xfb, 0x90, 0x00]))?.mime).toBe('audio/mpeg');
  });

  it('tells videos by their container brand', () => {
    expect(mediaKind(ftyp('qt  '))).toEqual({ kind: 'video', ext: 'mov', mime: 'video/quicktime' });
    expect(mediaKind(ftyp('isom'))).toEqual({ kind: 'video', ext: 'mp4', mime: 'video/mp4' });
  });

  it('gives null for anything shorter than twelve bytes', () => {
    expect(mediaKind(png().subarray(0, 11))).toBeNull();
    expect(mediaKind(new Uint8Array(0))).toBeNull();
  });

  it('gives null for bytes that are no plain media file', () => {
    expect(mediaKind(bytes('bplist00'))).toBeNull();
    expect(mediaKind(bytes('<?xml version="1'))).toBeNull();
    expect(mediaKind(bytes('RIFF'))).toBeNull();
    expect(mediaKind(bytes([0xff, 0xe0, 0, 0]))).toBeNull();
    expect(mediaKind(new Uint8Array(64))).toBeNull();
  });
});

describe('sniffProject', () => {
  it('reports a binary property list without reading further', async () => {
    const got = await sniffProject(fileOf(bytes('bplist00', 64), 'doc.bin'));
    expect(got).toEqual({ container: 'bplist', entries: [], media: [], extra: 0 });
  });

  it('reports unknown for text, for an empty file and for a bare picture', async () => {
    for (const data of [strToU8('just some words here'), new Uint8Array(0), png()]) {
      expect(await sniffProject(fileOf(data, 'thing'))).toEqual({ container: 'unknown', entries: [], media: [], extra: 0 });
    }
  });

  it('reports unknown for a file that starts like an archive and is not one', async () => {
    const fake = new Uint8Array(200).fill(0x41);
    fake.set([0x50, 0x4b, 3, 4]);
    expect((await sniffProject(fileOf(fake, 'fake.zip'))).container).toBe('unknown');
  });

  it('lists every entry and lifts out only the plain media', async () => {
    const zip = zipSync({ 'doc.plist': bytes('bplist00', 40), 'media/': new Uint8Array(0), 'media/shot.png': png(), 'media/take.wav': wav(), 'notes.txt': strToU8('a long enough note') });
    const got = await sniffProject(fileOf(zip, 'movie.proj'));
    expect(got.container).toBe('zip');
    expect(got.entries).toEqual(['doc.plist', 'media/', 'media/shot.png', 'media/take.wav', 'notes.txt']);
    expect(got.media.map((m) => [m.entry, m.kind, m.file.name, m.file.type])).toEqual([
      ['media/shot.png', 'picture', 'shot.png', 'image/png'],
      ['media/take.wav', 'sound', 'take.wav', 'audio/wav'],
    ]);
    expect(got.extra).toBe(0);
  });

  it('hands over the bytes of a lifted entry unchanged', async () => {
    const data = png();
    data[15] = 99;
    const got = await sniffProject(fileOf(zipSync({ 'p.png': data }), 'a.zip'));
    expect(Array.from(new Uint8Array(await got.media[0].file.arrayBuffer()))).toEqual(Array.from(data));
  });

  it('keeps only the leaf of an entry path, so a traversal path never reaches the file name', async () => {
    const got = await sniffProject(fileOf(zipSync({ '../../etc/evil.png': png(), 'a\\b:c?.png': png() }), 'a.zip'));
    const names = got.media.map((m) => m.file.name);
    expect(names).toHaveLength(2);
    for (const n of names) expect(n).not.toMatch(/[\\/:*?"<>|]/);
    expect(names).toContain('evil.png');
    expect(names).toContain('a_b_c_.png');
  });

  it('adds the extension the bytes call for when an entry has none', async () => {
    const got = await sniffProject(fileOf(zipSync({ 'blobs/0A1B': jpg(), 'blobs/clip': ftyp('qt  ') }), 'a.zip'));
    expect(got.media.map((m) => m.file.name)).toEqual(['0A1B.jpg', 'clip.mov']);
  });

  it('gives entries with the same leaf name different file names, whatever the case', async () => {
    const got = await sniffProject(fileOf(zipSync({ 'a/x.png': png(), 'b/X.PNG': png(), 'c/x.png': png() }), 'a.zip'));
    const names = got.media.map((m) => m.file.name);
    expect(names[0]).toBe('x.png');
    expect(names[1]).toBe('X-2.PNG');
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3);
    for (const n of names) expect(n).toMatch(/\.png$/i);
  });

  it('does not unpack entries too short to be media', async () => {
    const got = await sniffProject(fileOf(zipSync({ 'tiny.png': png().subarray(0, 8), 'ok.png': png() }), 'a.zip'));
    expect(got.entries).toEqual(['tiny.png', 'ok.png']);
    expect(got.media.map((m) => m.entry)).toEqual(['ok.png']);
  });

  it('counts the media past the cap instead of returning it', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 205; i++) files[`f${i}.png`] = png();
    const got = await sniffProject(fileOf(zipSync(files, { level: 0 }), 'many.zip'));
    expect(got.media).toHaveLength(200);
    expect(got.extra).toBe(5);
    expect(got.entries).toHaveLength(205);
  });

  it('refuses to read an archive larger than the file cap', async () => {
    const zip = zipSync({ 'p.png': png() });
    const file = fileOf(zip, 'giant.zip');
    Object.defineProperty(file, 'size', { value: SNIFF_FILE_MAX + 1 });
    await expect(sniffProject(file)).rejects.toThrow('giant.zip is too large to look inside.');
  });
});
