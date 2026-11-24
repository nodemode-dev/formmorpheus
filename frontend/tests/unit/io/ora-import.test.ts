import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { isOra, readOra } from '@src/io/ora-import';

const ora = (files: Record<string, Uint8Array>, name = 'art.ora'): File => new File([zipSync(files) as Uint8Array<ArrayBuffer>], name);
const stack = (attrs: string, inner = ''): Uint8Array => strToU8(`<?xml version="1.0" encoding="UTF-8"?><image ${attrs}><stack>${inner}</stack></image>`);

describe('isOra', () => {
  it('needs both the file ending and the archive signature', () => {
    const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
    expect(isOra('a.ora', zip)).toBe(true);
    expect(isOra('A.ORA', zip)).toBe(true);
    expect(isOra('a.ora.zip', zip)).toBe(false);
    expect(isOra('a.ora', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe('readOra refusals', () => {
  it('refuses bytes that are not an archive and names the file', async () => {
    await expect(readOra(new File([strToU8('plain words')], 'bad.ora'))).rejects.toThrow(/bad\.ora/);
  });

  it('refuses an archive with no stack description', async () => {
    await expect(readOra(ora({ 'mergedimage.png': new Uint8Array(8) }))).rejects.toThrow(/stack\.xml/);
  });

  it('refuses a canvas of zero, negative, non numeric or huge size', async () => {
    for (const attrs of ['w="0" h="10"', 'w="10" h="-2"', 'w="big" h="10"', 'w="10" h="30001"', 'w="10"']) {
      await expect(readOra(ora({ 'stack.xml': stack(attrs) }))).rejects.toThrow(/size/);
    }
  });

  it('refuses a file whose layers name missing pictures when there is no merged picture', async () => {
    const xml = stack('w="10" h="10"', '<layer name="A" src="data/a.png"/><stack name="G"><layer name="B" src="../../outside.png"/></stack>');
    await expect(readOra(ora({ 'stack.xml': xml }))).rejects.toThrow(/merged/);
  });
});
