// Source pictures on the GPU: one texture per decoded picture, keyed like the renderer's bitmap cache,
// byte-capped (least recently drawn first, the last two frames always stay) and released on forget.

export type TexSource = ImageBitmap | OffscreenCanvas | HTMLCanvasElement;

interface Entry {
  tex: WebGLTexture;
  src: TexSource;
  w: number;
  h: number;
  used: number;
}

export class TextureCache {
  private readonly map = new Map<string, Entry>();
  private bytes = 0;
  private gen = 0;

  /** Set when a source could not be held (over the driver's size limit, or the upload raised a GL error): the frame is drawn by the CPU. */
  private refused = false;

  constructor(private readonly gl: WebGL2RenderingContext, private capBytes: number, private readonly maxSide = 16384) {}

  /** A new byte cap (a lower memory tier); textures drawn in the last two frames stay, the rest go at the next frame's end. */
  setCap(bytes: number): void {
    this.capBytes = bytes;
    this.endFrame();
  }

  get size(): number {
    return this.bytes;
  }

  /** Whether a source was refused since the last call; clears the flag. */
  takeRefused(): boolean {
    const r = this.refused;
    this.refused = false;
    return r;
  }

  beginFrame(): void {
    this.gen++;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** The texture already held for `key`, or null. */
  peek(key: string): WebGLTexture | null {
    const e = this.map.get(key);
    if (!e) return null;
    e.used = this.gen;
    return e.tex;
  }

  /** The texture for `key`, uploading when `src` is a different object or size than last time. Null for a closed or empty source. */
  get(key: string, src: TexSource): WebGLTexture | null {
    const w = src.width, h = src.height;
    if (w <= 0 || h <= 0) return null;
    const e = this.map.get(key);
    if (e && e.src === src && e.w === w && e.h === h) {
      e.used = this.gen;
      return e.tex;
    }
    return this.put(key, src);
  }

  /** Uploads `src` now (a canvas that was drawn into again). */
  put(key: string, src: TexSource): WebGLTexture | null {
    const gl = this.gl;
    const w = src.width, h = src.height;
    if (w <= 0 || h <= 0) return null;
    if (w > this.maxSide || h > this.maxSide) { this.refused = true; return null; }
    let e = this.map.get(key);
    const same = !!e && e.w === w && e.h === h;
    if (e && !same) { this.drop(key); e = undefined; }
    const tex = e ? e.tex : gl.createTexture();
    if (!tex) return null;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      if (e) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
      } else {
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // a failed allocation raises no exception: read the error once per new texture (an update of an old one costs no extra call)
        if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(tex); this.refused = true; return null; }
      }
    } catch {
      if (!e) gl.deleteTexture(tex);
      this.refused = true;
      return null;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (e) { e.src = src; e.used = this.gen; return tex; }
    this.map.set(key, { tex, src, w, h, used: this.gen });
    this.bytes += w * h * 4;
    return tex;
  }

  private drop(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.gl.deleteTexture(e.tex);
    this.bytes -= e.w * e.h * 4;
    this.map.delete(key);
  }

  /** Releases textures whose key `keep` rejects (all of them without it). */
  forget(keep?: (key: string) => boolean): void {
    for (const key of [...this.map.keys()]) if (!keep || !keep(key)) this.drop(key);
  }

  /** After a frame: over the cap, the least recently drawn go first; this and the previous frame's stay. */
  endFrame(): void {
    if (this.bytes <= this.capBytes) return;
    const order = [...this.map.entries()].sort((p, q) => p[1].used - q[1].used);
    for (const [key, e] of order) {
      if (this.bytes <= this.capBytes) break;
      if (e.used >= this.gen - 1) continue;
      this.drop(key);
    }
  }

  /** The context went away: the textures are already gone. */
  reset(): void {
    this.map.clear();
    this.bytes = 0;
  }
}
