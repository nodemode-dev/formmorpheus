import { describe, expect, it } from 'vitest';
import { TextureCache, type TexSource } from '@src/engine/gpu/textures';

interface FakeGl {
  gl: WebGL2RenderingContext;
  made: object[];
  deleted: object[];
  uploads: number;
  storages: number;
  error: number;
  throwOnUpload: boolean;
  failCreate: boolean;
}

function fakeGl(): FakeGl {
  const state: FakeGl = { gl: null as unknown as WebGL2RenderingContext, made: [], deleted: [], uploads: 0, storages: 0, error: 0, throwOnUpload: false, failCreate: false };
  const own: Record<string, unknown> = {
    NO_ERROR: 0,
    createTexture: () => {
      if (state.failCreate) return null;
      const t = { n: state.made.length };
      state.made.push(t);
      return t;
    },
    deleteTexture: (t: object) => { state.deleted.push(t); },
    texStorage2D: () => { state.storages++; },
    texSubImage2D: () => {
      if (state.throwOnUpload) throw new Error('upload');
      state.uploads++;
    },
    getError: () => state.error,
  };
  state.gl = new Proxy(own, {
    get: (t, p: string) => (p in t ? t[p] : /^[A-Z0-9_]+$/.test(p) ? p : () => undefined),
  }) as unknown as WebGL2RenderingContext;
  return state;
}

const pic = (w: number, h: number): TexSource => ({ width: w, height: h } as unknown as TexSource);

describe('TextureCache', () => {
  it('uploads a source once and reuses the texture for the same object', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1e9);
    const src = pic(10, 20);
    const t = c.get('a', src);
    expect(t).not.toBeNull();
    expect(c.get('a', src)).toBe(t);
    expect(f.uploads).toBe(1);
    expect(c.size).toBe(10 * 20 * 4);
    expect(c.has('a')).toBe(true);
  });

  it('updates in place when a new source of the same size arrives', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1e9);
    const t = c.get('a', pic(8, 8));
    expect(c.get('a', pic(8, 8))).toBe(t);
    expect(f.uploads).toBe(2);
    expect(f.storages).toBe(1);
    expect(f.made).toHaveLength(1);
    expect(c.size).toBe(256);
  });

  it('replaces the texture when the size changes and keeps the byte count right', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1e9);
    const t = c.get('a', pic(8, 8));
    const u = c.get('a', pic(4, 2));
    expect(u).not.toBe(t);
    expect(f.deleted).toEqual([t]);
    expect(c.size).toBe(32);
  });

  it('returns null for an empty or closed source without uploading', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1e9);
    expect(c.get('a', pic(0, 10))).toBeNull();
    expect(c.put('a', pic(10, 0))).toBeNull();
    expect(f.made).toHaveLength(0);
    expect(c.takeRefused()).toBe(false);
  });

  it('refuses a source over the largest side and reports it once', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1e9, 100);
    expect(c.get('a', pic(101, 10))).toBeNull();
    expect(c.get('b', pic(100, 100))).not.toBeNull();
    expect(c.has('a')).toBe(false);
    expect(c.takeRefused()).toBe(true);
    expect(c.takeRefused()).toBe(false);
  });

  it('refuses and frees the texture when the driver reports an error', () => {
    const f = fakeGl();
    f.error = 1285;
    const c = new TextureCache(f.gl, 1e9);
    expect(c.get('a', pic(4, 4))).toBeNull();
    expect(f.deleted).toHaveLength(1);
    expect(c.size).toBe(0);
    expect(c.has('a')).toBe(false);
    expect(c.takeRefused()).toBe(true);
  });

  it('refuses and frees the texture when the upload throws', () => {
    const f = fakeGl();
    f.throwOnUpload = true;
    const c = new TextureCache(f.gl, 1e9);
    expect(c.get('a', pic(4, 4))).toBeNull();
    expect(f.deleted).toHaveLength(1);
    expect(c.takeRefused()).toBe(true);
    expect(c.size).toBe(0);
  });

  it('returns null when no texture can be created', () => {
    const f = fakeGl();
    f.failCreate = true;
    const c = new TextureCache(f.gl, 1e9);
    expect(c.get('a', pic(4, 4))).toBeNull();
    expect(c.size).toBe(0);
  });

  it('peeks a held texture and gives null for an unknown key', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1e9);
    const t = c.get('a', pic(2, 2));
    expect(c.peek('a')).toBe(t);
    expect(c.peek('zz')).toBeNull();
  });

  it('forgets only the keys the filter rejects', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1e9);
    c.get('keep', pic(2, 2));
    const gone = c.get('drop', pic(3, 3));
    c.forget((k) => k === 'keep');
    expect(c.has('keep')).toBe(true);
    expect(c.has('drop')).toBe(false);
    expect(f.deleted).toEqual([gone]);
    expect(c.size).toBe(16);
  });

  it('forgets everything without a filter', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1e9);
    c.get('a', pic(2, 2));
    c.get('b', pic(2, 2));
    c.forget();
    expect(c.size).toBe(0);
    expect(f.deleted).toHaveLength(2);
  });

  it('keeps everything while under the cap', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1000);
    c.get('a', pic(10, 10));
    for (let i = 0; i < 5; i++) { c.beginFrame(); c.endFrame(); }
    expect(c.has('a')).toBe(true);
  });

  it('drops the least recently drawn first when over the cap', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 800);
    const a = pic(10, 10), b = pic(10, 10), d = pic(10, 10);
    c.beginFrame();
    c.get('a', a);
    c.beginFrame();
    c.get('b', b);
    c.beginFrame();
    c.beginFrame();
    c.get('d', d);
    c.endFrame();
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.has('d')).toBe(true);
    expect(c.size).toBe(800);
  });

  it('never drops textures drawn in this or the previous frame even over the cap', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 100);
    c.beginFrame();
    c.get('a', pic(10, 10));
    c.beginFrame();
    c.get('b', pic(10, 10));
    c.endFrame();
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(true);
    expect(f.deleted).toHaveLength(0);
  });

  it('counts a peek as a draw', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 400);
    c.beginFrame();
    c.get('a', pic(10, 10));
    c.get('b', pic(10, 10));
    c.beginFrame();
    c.beginFrame();
    c.peek('a');
    c.endFrame();
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
  });

  it('applies a lower cap at once', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1e9);
    c.get('a', pic(10, 10));
    c.beginFrame();
    c.beginFrame();
    c.setCap(100);
    expect(c.has('a')).toBe(false);
    expect(c.size).toBe(0);
  });

  it('reset empties the cache without deleting textures of a lost context', () => {
    const f = fakeGl();
    const c = new TextureCache(f.gl, 1e9);
    c.get('a', pic(10, 10));
    c.reset();
    expect(c.size).toBe(0);
    expect(c.has('a')).toBe(false);
    expect(f.deleted).toHaveLength(0);
  });
});
