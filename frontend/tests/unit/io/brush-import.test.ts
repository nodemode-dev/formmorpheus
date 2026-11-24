import { describe, expect, it } from 'vitest';
import { importBrushFile, parsePlist, unarchive } from '@src/io/brush-import';

const xml = (body: string): Uint8Array => new TextEncoder().encode(`<?xml version="1.0"?><plist version="1.0">${body}</plist>`);

describe('property list reading', () => {
  it('reads a text property list into plain values', () => {
    const got = parsePlist(xml('<dict><key>size</key><integer>12</integer><key>flow</key><real>0.5</real><key>on</key><true/><key>off</key><false/><key>name</key><string>Ink</string><key>list</key><array><integer>1</integer><integer>2</integer></array></dict>'));
    expect(got).toEqual({ size: 12, flow: 0.5, on: true, off: false, name: 'Ink', list: [1, 2] });
  });

  it('refuses a text property list with nothing inside', () => {
    expect(() => parsePlist(xml(''))).toThrow();
  });

  it('refuses a binary property list that is cut short', () => {
    expect(() => parsePlist(new TextEncoder().encode('bplist00abc'))).toThrow();
  });

  it('refuses a binary property list whose trailer describes an impossible table', () => {
    const bytes = new Uint8Array(64).fill(0xff);
    bytes.set(new TextEncoder().encode('bplist00'));
    expect(() => parsePlist(bytes)).toThrow();
  });
});

describe('archive unwrapping', () => {
  it('returns a value that is not an archive unchanged', () => {
    const plain = { size: 3 };
    expect(unarchive(plain)).toBe(plain);
    expect(unarchive(null)).toBeNull();
  });

  it('gives nothing for an archive with no root reference', () => {
    expect(unarchive({ $objects: ['$null'], $top: {} })).toBeUndefined();
  });
});

describe('brush file import', () => {
  it('refuses a file that is not a brush file or a picture', async () => {
    await expect(importBrushFile(new File(['hello'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow(/\.abr/);
  });
});
