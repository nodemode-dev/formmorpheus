import { describe, expect, it } from 'vitest';
import { normalizeMovie } from '@src/engine/normalize';
import { FORMAT_VERSION } from '@src/engine/types';

describe('normalizeMovie', () => {
  it('builds a usable movie from nothing', () => {
    for (const raw of [null, undefined, 7, 'x', []]) {
      const m = normalizeMovie(raw);
      expect(m.format).toBe(FORMAT_VERSION);
      expect(m.width).toBe(1920);
      expect(m.height).toBe(1080);
      expect(m.fps).toBe(24);
      expect(m.duration).toBe(24);
      expect(m.tracks).toEqual([]);
      expect(m.assets).toEqual({});
      expect(m.onion.enabled).toBe(true);
      expect(typeof m.id).toBe('string');
      expect(m.id.length).toBeGreaterThan(0);
    }
  });

  it('keeps what is already there', () => {
    const m = normalizeMovie({ id: 'm1', format: 2, name: 'Mine', width: 640, height: 360, fps: 12, duration: 99, background: '#000000', transparent: true, onion: { backFrames: 5 } });
    expect(m).toMatchObject({ id: 'm1', format: 2, name: 'Mine', width: 640, height: 360, fps: 12, duration: 99, background: '#000000', transparent: true });
    expect(m.onion.backFrames).toBe(5);
    expect(m.onion.foreFrames).toBe(1);
  });

  it('replaces values of the wrong type and floors sizes at one', () => {
    const m = normalizeMovie({ name: 5, width: -10, height: 'tall', fps: 0, duration: Number.NaN, transparent: 'yes', assets: [] });
    expect(m.name).toBe('Untitled Movie');
    expect(m.width).toBe(1);
    expect(m.height).toBe(1080);
    expect(m.fps).toBe(1);
    expect(m.duration).toBe(1);
    expect(m.transparent).toBe(false);
    expect(m.assets).toEqual({});
  });

  it('takes a missing duration from the last content, inside groups too', () => {
    const m = normalizeMovie({ fps: 10, tracks: [{ content: [{ kind: 'group', start: 0, duration: 20, tracks: [{ content: [{ kind: 'image', start: 70, duration: 30 }] }] }] }] });
    expect(m.duration).toBe(100);
  });

  it('fills a bare content and drops entries that are not objects', () => {
    const m = normalizeMovie({ tracks: [null, 'x', { content: [null, 3, { start: -5, duration: 0 }] }] });
    expect(m.tracks).toHaveLength(1);
    expect(m.tracks[0].name).toBe('Track 3');
    expect(m.tracks[0].hidden).toBe(false);
    const c = m.tracks[0].content[0];
    expect(m.tracks[0].content).toHaveLength(1);
    expect(c.kind).toBe('drawing');
    expect(c.start).toBe(0);
    expect(c.duration).toBe(1);
    expect(c.opacity).toBe(1);
    expect(c.transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false });
    expect(c.asset).toBeNull();
    expect(c.keys).toEqual([]);
    expect(c.text).toBeNull();
    expect(c.onion).toBeNull();
    expect(c.volume).toBe(1);
    expect(c.id.length).toBeGreaterThan(0);
  });

  it('gives different ids to things that had none', () => {
    const m = normalizeMovie({ tracks: [{ content: [{}, {}] }, { content: [{}] }] });
    const ids = [m.id, ...m.tracks.map((t) => t.id), ...m.tracks.flatMap((t) => t.content.map((c) => c.id))];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('turns the frames of an old flipbook into one row', () => {
    const m = normalizeMovie({ tracks: [{ content: [{ kind: 'flipbook', frames: [{ hold: 0, layers: [{}] }, { hold: 3 }] }] }] });
    const c = m.tracks[0].content[0];
    expect('frames' in c).toBe(false);
    expect(c.flip).toHaveLength(1);
    expect(c.flip[0].frames.map((f) => f.hold)).toEqual([1, 3]);
    expect(c.flip[0].frames[0].layers[0]).toMatchObject({ name: 'Layer 1', visible: true, opacity: 1, pixels: null });
    expect(c.flip[0].frames[1].layers).toEqual([]);
  });

  it('gives a flipbook without rows one row with one frame', () => {
    const c = normalizeMovie({ tracks: [{ content: [{ kind: 'flipbook' }] }] }).tracks[0].content[0];
    expect(c.flip).toHaveLength(1);
    expect(c.flip[0].frames).toHaveLength(1);
    expect(c.flip[0].frames[0].layers).toHaveLength(1);
  });

  it('gives a text its style and leaves other kinds without one', () => {
    const m = normalizeMovie({ tracks: [{ content: [{ kind: 'text' }, { kind: 'image', start: 5 }] }] });
    expect(m.tracks[0].content[0].text).toMatchObject({ text: 'Text', align: 'center' });
    expect(m.tracks[0].content[1].text).toBeNull();
  });

  it('keeps lanes of an unknown kind aside and repairs the keys of known ones', () => {
    const m = normalizeMovie({ tracks: [{ content: [{ kind: 'image', keys: [
      { kind: 'move', channels: { x: [{ frame: 4, value: 'bad' }, 'junk', { value: 2, ease: 'hold' }] } },
      { kind: 'from-a-newer-build', channels: {} },
      { channels: {} },
      null,
    ] }] }] });
    const c = m.tracks[0].content[0] as unknown as { keys: { kind: string; expanded: boolean; options: object; channels: Record<string, unknown[]> }[]; unknownLanes?: { kind: string }[] };
    expect(c.keys.map((l) => l.kind)).toEqual(['move']);
    expect(c.keys[0].expanded).toBe(false);
    expect(c.keys[0].options).toEqual({});
    expect(c.keys[0].channels.x).toEqual([{ frame: 4, value: 0, ease: 'linear' }, { frame: 0, value: 2, ease: 'hold' }]);
    expect(c.unknownLanes?.map((l) => l.kind)).toEqual(['from-a-newer-build']);
  });

  it('brings an unknown lane back once and does not duplicate it on a second pass', () => {
    const raw = { tracks: [{ content: [{ kind: 'image', keys: [{ kind: 'from-a-newer-build' }] }] }] };
    const first = normalizeMovie(raw);
    const again = normalizeMovie(JSON.parse(JSON.stringify(first)));
    const c = again.tracks[0].content[0] as unknown as { keys: unknown[]; unknownLanes?: unknown[] };
    expect(c.keys).toEqual([]);
    expect(c.unknownLanes).toHaveLength(1);
  });

  it('gives a shape and a solid an outline, and removes a stray one from other kinds', () => {
    const m = normalizeMovie({ tracks: [{ content: [
      { kind: 'shape' },
      { kind: 'solid', start: 5 },
      { kind: 'adjust', start: 10 },
      { kind: 'image', start: 15, shape: { type: 'rect' } },
      { kind: 'shape', start: 20, shape: { type: 'blob', w: 'x', nodes: [{ x: 1 }, 7] } },
    ] }] });
    const [shape, solid, adjust, image, odd] = m.tracks[0].content as unknown as { shape?: { type: string; w: number; h: number; fill: unknown; stroke: unknown; nodes?: unknown[] } }[];
    expect(shape.shape).toMatchObject({ type: 'rect', w: 400, h: 300 });
    expect(solid.shape).toMatchObject({ type: 'rect', w: 0, h: 0 });
    expect('shape' in adjust).toBe(false);
    expect('shape' in image).toBe(false);
    expect(odd.shape).toMatchObject({ type: 'rect', w: 400, h: 300, fill: null, stroke: null });
    expect(odd.shape?.nodes).toEqual([{ x: 1, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 }]);
  });

  it('drops a camera that is not an object and tidies the lanes of a real one', () => {
    expect('camera' in normalizeMovie({ camera: 5 })).toBe(false);
    const m = normalizeMovie({ camera: { keys: [{ kind: 'from-a-newer-build' }] } }) as unknown as { camera: { keys: unknown[]; unknownLanes: unknown[] } };
    expect(m.camera.keys).toEqual([]);
    expect(m.camera.unknownLanes).toHaveLength(1);
  });

  it('gives the same result when run twice on the same movie', () => {
    const raw = { tracks: [{ content: [{ kind: 'flipbook', frames: [{}] }, { kind: 'text', start: 9 }] }] };
    const once = JSON.parse(JSON.stringify(normalizeMovie(raw)));
    const twice = JSON.parse(JSON.stringify(normalizeMovie(JSON.parse(JSON.stringify(once)))));
    expect(twice).toEqual(once);
  });
});
