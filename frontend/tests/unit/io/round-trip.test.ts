import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { sniffRoundTrip } from '@src/io/round-trip';

const sniff = (data: Uint8Array, name: string): Promise<'formvis' | 'formvfx' | null> =>
  sniffRoundTrip(new File([data as Uint8Array<ArrayBuffer>], name), data.subarray(0, 16));

const project = strToU8('{ "format": "formvfx.project/1", "layers": [] }');

describe('sniffRoundTrip', () => {
  it('gives null for a file that is neither an archive nor a known extension', async () => {
    expect(await sniff(strToU8('plain words'), 'notes.txt')).toBeNull();
    expect(await sniff(project, 'project.json')).toBeNull();
  });

  it('knows a composition project by its extension', async () => {
    expect(await sniff(project, 'shot.fvxproj')).toBe('formvfx');
    expect(await sniff(project, 'SHOT.FVXPROJ')).toBe('formvfx');
  });

  it('knows a bundle by the project file inside it', async () => {
    const zip = zipSync({ 'shot/shot.fvxproj': project, 'shot/media/a.png': new Uint8Array(20) });
    expect(await sniff(zip, 'shot.zip')).toBe('formvfx');
  });

  it('gives null for an archive with no project inside', async () => {
    expect(await sniff(zipSync({ 'a.png': new Uint8Array(20), 'readme.txt': strToU8('hi') }), 'pictures.zip')).toBeNull();
  });

  it('never claims a movie file, even one that holds a project entry', async () => {
    expect(await sniff(zipSync({ 'x.fvxproj': project }), 'movie.fmo')).toBeNull();
    expect(await sniff(zipSync({ 'x.fvxproj': project }), 'movie.FMO')).toBeNull();
  });

  it('knows a drawing document by the format in its manifest', async () => {
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'com.nodemode.formvis' })) });
    expect(await sniff(zip, 'drawing.fvd')).toBe('formvis');
    expect(await sniff(zip, 'renamed.zip')).toBe('formvis');
  });

  it('does not take an archive with a foreign manifest for a drawing document', async () => {
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'com.example.other' })) });
    expect(await sniff(zip, 'thing.zip')).toBeNull();
  });

  it('gives null for a broken archive instead of throwing', async () => {
    const broken = new Uint8Array(300).fill(0x41);
    broken.set([0x50, 0x4b, 3, 4]);
    expect(await sniff(broken, 'broken.zip')).toBeNull();
  });

  it('gives null for a drawing extension on a file that is not an archive', async () => {
    expect(await sniff(strToU8('not a document at all'), 'drawing.fvd')).toBeNull();
  });
});
