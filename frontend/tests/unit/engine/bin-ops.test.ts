import { describe, expect, it } from 'vitest';
import { strayPixels, usedAssetIds } from '@src/engine/asset-gc';
import { binEntries, removeAssets, replaceAsset, totalSize, unusedIds } from '@src/engine/bin-ops';
import { content, newMovie, track } from '@src/engine/model';
import type { Asset, Content, Movie } from '@src/engine/types';

function asset(id: string, kind: Asset['kind'], extra: Partial<Asset> = {}): Asset {
  return { id, kind, name: id, mime: 'x/y', width: 100, height: 50, frames: 1, size: 10, ...extra };
}

function movie(assets: Asset[], items: Content[]): Movie {
  const m = newMovie({ fps: 24, seconds: 10 });
  return { ...m, assets: Object.fromEntries(assets.map((a) => [a.id, a])), tracks: [track('A', items)] };
}

function drawing(name: string, pixels: string | null, mask?: string): Content {
  const base = content('drawing', 0, 10, { name });
  return { ...base, layers: [{ ...base.layers[0], pixels, ...(mask ? { mask } : {}) }] };
}

function text(font: string, runFonts: string[] = []): Content {
  const base = content('text', 0, 10);
  return { ...base, text: { ...base.text, font, runs: runFonts.map((f) => ({ font: f })) } as unknown as Content['text'] };
}

function all(m: Movie): Content[] {
  return m.tracks.flatMap((t) => t.content);
}

describe('used assets', () => {
  it('collects content assets, layer pixels and layer masks', () => {
    const m = movie([], [content('image', 0, 5, { asset: 'img' }), drawing('D', 'px', 'mk'), drawing('E', null)]);
    expect([...usedAssetIds([m])].sort()).toEqual(['img', 'mk', 'px']);
  });

  it('walks into group tracks and flipbook frames', () => {
    const inner = content('video', 0, 5, { asset: 'vid' });
    const group = content('group', 0, 5, { tracks: [track('In', [inner])] });
    const flip = content('flipbook', 0, 5, { flip: [{ frames: [{ layers: [{ pixels: 'f1' }, { pixels: null, mask: 'fm' }] }] }] as unknown as Content['flip'] });
    expect([...usedAssetIds([movie([], [group, flip])])].sort()).toEqual(['f1', 'fm', 'vid']);
  });

  it('counts the extra blocks of a clipboard', () => {
    expect([...usedAssetIds([], [content('audio', 0, 5, { asset: 'snd' })])]).toEqual(['snd']);
  });

  it('reports only pixel assets that no state uses', () => {
    const live = movie([asset('p1', 'pixels'), asset('p2', 'pixels'), asset('p3', 'pixels'), asset('p4', 'pixels'), asset('img', 'image')], [drawing('D', 'p1')]);
    const older = movie([], [drawing('D', 'p2')]);
    expect(strayPixels(live, [older], [drawing('Clip', 'p3')])).toEqual(['p4']);
    expect(strayPixels(live, []).sort()).toEqual(['p2', 'p3', 'p4']);
  });
});

describe('media bin', () => {
  it('lists files by kind, then name, and leaves pixel assets out', () => {
    const m = movie(
      [asset('f', 'font', { family: 'Fam' }), asset('s', 'audio', { name: 'b-sound' }), asset('i2', 'image', { name: 'zebra' }), asset('i1', 'image', { name: 'apple' }), asset('v', 'video'), asset('p', 'pixels')],
      [],
    );
    expect(binEntries(m).map((e) => e.key)).toEqual(['v', 'i1', 'i2', 's', 'f']);
  });

  it('names every block that uses a file, nested ones included', () => {
    const inner = content('image', 0, 5, { asset: 'i', name: 'Inner' });
    const outer = content('image', 0, 5, { asset: 'i', name: 'Outer' });
    const group = content('group', 0, 5, { tracks: [track('In', [inner])] });
    const [entry] = binEntries(movie([asset('i', 'image')], [outer, group]));
    expect(entry.uses).toEqual([{ id: outer.id, name: 'Outer' }, { id: inner.id, name: 'Inner' }]);
    expect(entry.count).toBe(1);
  });

  it('matches a font to the text blocks by family, base font and runs alike', () => {
    const a = text('Fam'), b = text('Other', ['Fam', 'Fam']), c = text('Other');
    const [entry] = binEntries(movie([asset('f', 'font', { family: 'Fam' })], [a, b, c]));
    expect(entry.uses.map((u) => u.id)).toEqual([a.id, b.id]);
  });

  it('sums the pictures of a drawing into one entry', () => {
    const d = drawing('Sketch', 'p1', 'p2');
    const m = movie([asset('p1', 'pixels', { size: 30 }), asset('p2', 'pixels', { size: 12 })], [d, drawing('Empty', null), drawing('Lost', 'gone')]);
    const entries = binEntries(m);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ key: `d:${d.id}`, kind: 'drawing', name: 'Sketch', size: 42, count: 2 });
    expect(entries[0].asset.id).toBe('p1');
  });

  it('adds up the bytes of every asset', () => {
    expect(totalSize(movie([asset('a', 'image', { size: 5 }), asset('p', 'pixels', { size: 7 })], []))).toBe(12);
    expect(totalSize(movie([], []))).toBe(0);
  });

  it('finds the files nothing uses and never offers drawing pixels', () => {
    const m = movie(
      [asset('used', 'image'), asset('idle', 'image'), asset('p', 'pixels'), asset('f1', 'font', { family: 'Fam' }), asset('f2', 'font', { family: 'Spare' }), asset('f3', 'font')],
      [content('image', 0, 5, { asset: 'used' }), text('Fam')],
    );
    expect(unusedIds(m)).toEqual(['idle', 'f2', 'f3']);
  });

  it('removes the named assets and returns the same movie for an empty list', () => {
    const m = movie([asset('a', 'image'), asset('b', 'image')], []);
    expect(removeAssets(m, [])).toBe(m);
    const next = removeAssets(m, ['a', 'ghost']);
    expect(Object.keys(next.assets)).toEqual(['b']);
    expect(Object.keys(m.assets)).toEqual(['a', 'b']);
  });
});

describe('replacing a file', () => {
  it('returns the same movie when the old file is unknown', () => {
    const m = movie([], []);
    expect(replaceAsset(m, 'ghost', asset('n', 'image'))).toBe(m);
  });

  it('swaps the asset record and repoints every block, nested ones included', () => {
    const inner = content('image', 0, 5, { asset: 'old' });
    const group = content('group', 0, 5, { tracks: [track('In', [inner])] });
    const other = content('image', 0, 5, { asset: 'keep' });
    const m = replaceAsset(movie([asset('old', 'image'), asset('keep', 'image')], [content('image', 0, 5, { asset: 'old' }), group, other]), 'old', asset('new', 'image'));
    expect(Object.keys(m.assets).sort()).toEqual(['keep', 'new']);
    const [a, g, o] = all(m);
    expect(a.asset).toBe('new');
    expect(g.tracks[0].content[0].asset).toBe('new');
    expect(o.asset).toBe('keep');
  });

  it('keeps the size on the Stage when the new picture has other dimensions', () => {
    const c = content('image', 0, 5, { asset: 'old' });
    c.transform = { ...c.transform, scale: 2 };
    const m = replaceAsset(movie([asset('old', 'image', { width: 100 })], [c]), 'old', asset('new', 'image', { width: 400 }));
    expect(all(m)[0].transform.scale).toBeCloseTo(0.5, 10);
  });

  it('cuts a video block to the length of the shorter new file', () => {
    const c = content('video', 0, 100, { asset: 'old', offset: 10 });
    const m = replaceAsset(movie([asset('old', 'video', { seconds: 10 })], [c]), 'old', asset('new', 'video', { seconds: 2 }));
    expect(all(m)[0]).toMatchObject({ offset: 10, duration: 38 });
  });

  it('restarts a block whose offset lies beyond the new file', () => {
    const c = content('audio', 0, 100, { asset: 'old', offset: 60 });
    const m = replaceAsset(movie([asset('old', 'audio', { seconds: 10 })], [c]), 'old', asset('new', 'audio', { seconds: 2 }));
    expect(all(m)[0]).toMatchObject({ offset: 0, duration: 48 });
  });

  it('leaves the length of a retimed or reversed block alone', () => {
    const fast = content('video', 0, 100, { asset: 'old', speed: 2 });
    const back = content('video', 0, 100, { asset: 'old', reverse: true });
    const m = replaceAsset(movie([asset('old', 'video', { seconds: 10 })], [fast, back]), 'old', asset('new', 'video', { seconds: 1 }));
    expect(all(m).map((c) => c.duration)).toEqual([100, 100]);
  });

  it('moves text set in a replaced font to the new family', () => {
    const a = text('Fam', ['Fam', 'Other']), b = text('Other');
    const m = replaceAsset(movie([asset('f', 'font', { family: 'Fam' })], [a, b]), 'f', asset('g', 'font', { family: 'Neu' }));
    const [na, nb] = all(m);
    expect(na.text?.font).toBe('Neu');
    expect(na.text?.runs?.map((r) => r.font)).toEqual(['Neu', 'Other']);
    expect(nb).toBe(b);
    expect(Object.keys(m.assets)).toEqual(['g']);
  });
});
