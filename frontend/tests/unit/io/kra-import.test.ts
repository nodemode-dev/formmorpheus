import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { isKra, readKra } from '@src/io/kra-import';

const PLANE = 64 * 64;

const join = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

const rawPlanes = (values: number[]): Uint8Array => {
  const out = new Uint8Array(1 + PLANE * values.length);
  values.forEach((v, i) => out.fill(v, 1 + i * PLANE, 1 + (i + 1) * PLANE));
  return out;
};

const packedPlanes = (values: number[]): Uint8Array => {
  const out: number[] = [1];
  for (const v of values) {
    out.push(0, v);
    for (let i = 0; i < 15; i++) out.push(0xe0, 255, 0);
    out.push(0xe0, 126, 0);
  }
  return new Uint8Array(out);
};

const tileFile = (pixelSize: number, tiles: { x: number; y: number; body: Uint8Array }[]): Uint8Array =>
  join([
    strToU8(`VERSION 2\nTILEWIDTH 64\nTILEHEIGHT 64\nPIXELSIZE ${pixelSize}\nDATA ${tiles.length}\n`),
    ...tiles.flatMap((t) => [strToU8(`${t.x},${t.y},LZF,${t.body.length}\n`), t.body]),
  ]);

const doc = (inner: string, attrs = 'width="100" height="80" colorspacename="RGBA"'): string =>
  `<?xml version="1.0" encoding="UTF-8"?><DOC><IMAGE name="img" ${attrs}><layers>${inner}</layers></IMAGE></DOC>`;

const kra = (xml: string, files: Record<string, Uint8Array> = {}, name = 'art.kra'): File => {
  const layers: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) layers[`img/layers/${k}`] = v;
  return new File([zipSync({ 'maindoc.xml': strToU8(xml), ...layers }) as Uint8Array<ArrayBuffer>], name);
};

const paint = (name: string, file: string, more = ''): string => `<layer nodetype="paintlayer" name="${name}" filename="${file}" colorspacename="RGBA" ${more}/>`;
const solid = tileFile(4, [{ x: 0, y: 0, body: rawPlanes([10, 20, 30, 255]) }]);

describe('isKra', () => {
  it('needs both the file ending and the archive signature', () => {
    const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
    expect(isKra('a.kra', zip)).toBe(true);
    expect(isKra('A.KRZ', zip)).toBe(true);
    expect(isKra('a.zip', zip)).toBe(false);
    expect(isKra('a.kra', new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });
});

describe('readKra', () => {
  it('reads a paint layer with its pixels in red green blue order, its place, opacity and blend mode', async () => {
    const d = await readKra(kra(doc(paint('Top', 'layer1', 'opacity="51" visible="0" compositeop="multiply" x="5" y="6"')), { layer1: solid }, 'my art.kra'));
    expect(d.name).toBe('my art');
    expect([d.width, d.height]).toEqual([100, 80]);
    expect(d.layers).toHaveLength(1);
    const l = d.layers[0];
    expect(l).toMatchObject({ name: 'Top', visible: false, blend: 'multiply', group: false, parent: null, mask: null });
    expect(l.opacity).toBeCloseTo(0.2, 6);
    expect(l.pixels).toMatchObject({ w: 64, h: 64, x: 5, y: 6 });
    expect(Array.from(l.pixels!.rgba.subarray(0, 4))).toEqual([30, 20, 10, 255]);
    expect(Array.from(l.pixels!.rgba.subarray(l.pixels!.rgba.length - 4))).toEqual([30, 20, 10, 255]);
    expect(d.notes).toEqual([]);
  });

  it('unpacks compressed tiles to the same pixels as stored ones', async () => {
    const packed = tileFile(4, [{ x: 0, y: 0, body: packedPlanes([10, 20, 30, 255]) }]);
    const a = await readKra(kra(doc(paint('A', 'layer1')), { layer1: packed }));
    const b = await readKra(kra(doc(paint('A', 'layer1')), { layer1: solid }));
    expect(Array.from(a.layers[0].pixels!.rgba)).toEqual(Array.from(b.layers[0].pixels!.rgba));
  });

  it('places tiles side by side and offsets the layer by its first tile', async () => {
    const two = tileFile(4, [{ x: 64, y: 0, body: rawPlanes([1, 2, 3, 4]) }, { x: 128, y: 0, body: rawPlanes([5, 6, 7, 8]) }]);
    const d = await readKra(kra(doc(paint('A', 'layer1', 'x="10"')), { layer1: two }));
    const px = d.layers[0].pixels!;
    expect([px.w, px.h, px.x, px.y]).toEqual([128, 64, 74, 0]);
    expect(Array.from(px.rgba.subarray(0, 4))).toEqual([3, 2, 1, 4]);
    expect(Array.from(px.rgba.subarray(64 * 4, 64 * 4 + 4))).toEqual([7, 6, 5, 8]);
  });

  it('keeps groups with their members after them', async () => {
    const xml = doc(`<layer nodetype="grouplayer" name="Set" opacity="255"><layers>${paint('In', 'layer1')}</layers></layer>${paint('Out', 'layer1')}`);
    const d = await readKra(kra(xml, { layer1: solid }));
    expect(d.layers.map((l) => [l.name, l.group])).toEqual([['Set', true], ['In', false], ['Out', false]]);
    expect(d.layers[1].parent).toBe(d.layers[0].id);
    expect(d.layers[2].parent).toBeNull();
    expect(d.layers[0].pixels).toBeNull();
  });

  it('leaves out special layers and missing pixel files and says so', async () => {
    const xml = doc(`<layer nodetype="filllayer" name="Fill"/>${paint('Gone', 'layer9')}${paint('Here', 'layer1', 'compositeop="sparkle"')}`);
    const d = await readKra(kra(xml, { layer1: solid }));
    expect(d.layers.map((l) => l.name)).toEqual(['Here']);
    expect(d.layers[0].blend).toBe('normal');
    expect(d.notes).toHaveLength(3);
    expect(d.notes.some((n) => n.includes('Fill'))).toBe(true);
    expect(d.notes.some((n) => n.includes('sparkle'))).toBe(true);
  });

  it('clamps opacity above the range', async () => {
    const d = await readKra(kra(doc(paint('A', 'layer1', 'opacity="900"')), { layer1: solid }));
    expect(d.layers[0].opacity).toBe(1);
  });

  it('reads a transparency mask over the level stored for the rest of the canvas', async () => {
    const mask = tileFile(1, [{ x: 0, y: 0, body: rawPlanes([200]) }]);
    const xml = doc(`<layer nodetype="paintlayer" name="A" filename="layer1" colorspacename="RGBA"><masks><mask nodetype="transparencymask" filename="mask1" visible="0"/></masks></layer>`);
    const d = await readKra(kra(xml, { layer1: solid, mask1: mask, 'mask1.defaultpixel': new Uint8Array([7]) }));
    const m = d.layers[0].mask!;
    expect(m.outside).toBe(7);
    expect(m.enabled).toBe(false);
    expect([m.raster.w, m.raster.h]).toEqual([100, 80]);
    expect(Array.from(m.raster.rgba.subarray(0, 4))).toEqual([200, 0, 0, 255]);
    expect(m.raster.rgba[99 * 4]).toBe(7);
  });

  it('leaves out a mask whose file is missing and says so', async () => {
    const xml = doc(`<layer nodetype="paintlayer" name="A" filename="layer1" colorspacename="RGBA"><masks><mask nodetype="transparencymask" filename="nope"/></masks></layer>`);
    const d = await readKra(kra(xml, { layer1: solid }));
    expect(d.layers[0].mask).toBeNull();
    expect(d.notes).toHaveLength(1);
  });

  it('refuses bytes that are not an archive and names the file', async () => {
    await expect(readKra(new File([strToU8('not an archive')], 'bad.kra'))).rejects.toThrow(/bad\.kra/);
  });

  it('refuses an archive with no document description', async () => {
    const f = new File([zipSync({ 'other.txt': strToU8('x') }) as Uint8Array<ArrayBuffer>], 'a.kra');
    await expect(readKra(f)).rejects.toThrow(/maindoc/);
  });

  it('refuses a canvas of zero, negative, non numeric or huge size', async () => {
    for (const attrs of ['width="0" height="10"', 'width="10" height="-3"', 'width="wide" height="10"', 'width="30001" height="10"', 'height="10"']) {
      await expect(readKra(kra(doc(paint('A', 'layer1'), attrs), { layer1: solid }))).rejects.toThrow(/size/);
    }
  });

  it('refuses a file with no readable layers and no merged picture', async () => {
    await expect(readKra(kra(doc('')))).rejects.toThrow(/merged/);
    const odd = tileFile(16, []);
    await expect(readKra(kra(doc(paint('A', 'layer1')), { layer1: odd }))).rejects.toThrow(/merged/);
  });

  it('refuses a tile that claims more bytes than the file holds', async () => {
    const lying = join([strToU8('VERSION 2\nTILEWIDTH 64\nTILEHEIGHT 64\nPIXELSIZE 4\nDATA 1\n0,0,LZF,999999\n'), new Uint8Array(10)]);
    await expect(readKra(kra(doc(paint('A', 'layer1')), { layer1: lying }))).rejects.toThrow();
  });

  it('refuses a compressed tile whose back reference points before the tile', async () => {
    const bad = tileFile(4, [{ x: 0, y: 0, body: new Uint8Array([1, 0xe0, 255, 9]) }]);
    await expect(readKra(kra(doc(paint('A', 'layer1')), { layer1: bad }))).rejects.toThrow();
  });
});
