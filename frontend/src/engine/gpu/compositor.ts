// WebGL2 compositor on an OffscreenCanvas. It walks the tracks the way Renderer.composeTracks does (held
// layer, clipping, alpha / luminance masks, blends, keyed opacity, live filters, groups) but on the GPU.
// The CPU path in render.ts stays the reference and the fallback. No DOM.
import { end, flipIndexAt } from '../model';
import { animate, type Animated } from '../keys';
import { memberMatrix, topMatrix } from '../transform';
import type { BlendMode, Content, DrawingLayer, Movie, Track } from '../types';
import {
  FS_BOIL, FS_BOOST, FS_BOX, FS_COPY, FS_DOWN, FS_GAUSS, FS_HSB, FS_MASK, FS_NOISE_APPLY, FS_NOISE_GRID, FS_PRESENT, FS_SHARPEN,
  FS_SRC_BLEND, FS_SRC_PLAIN, FS_UP, VS_BOX, VS_SRC,
} from './shaders';
import { TextureCache, type TexSource } from './textures';

export interface ViewLike {
  scale: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}

/** What the compositor asks of the renderer: pictures, video frames, the CPU rasteriser for text. */
export interface GpuHost {
  bitmap(id: string | null): ImageBitmap | null;
  video(c: Content, local: number, movie: Movie): TexSource | null;
  direct(c: Content, a: Animated, tracks: Track[], i: number, frame: number): boolean;
  /** True for content only the CPU path draws (Warp and Distort, layer groups and masks): it is rasterised there and uploaded. */
  cpu(c: Content, a: Animated, local: number): boolean;
  /** Draws the text of `c` at `density` pixels per movie pixel into `into` (resized to fit); returns its movie-space box. */
  textBox(c: Content, movie: Movie, density: number, into: OffscreenCanvas): { x: number; y: number; w: number; h: number } | null;
  /** Draws the whole content (transform included) into `into`, which is cleared and identity-transformed. */
  raster(c: Content, local: number, view: ViewLike, movie: Movie, a: Animated, into: OffscreenCanvas): void;
}

export type Mat = [number, number, number, number, number, number];

const MODE: Record<BlendMode, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, 'color-dodge': 6, 'color-burn': 7, 'hard-light': 8,
  'soft-light': 9, difference: 10, exclusion: 11, hue: 12, saturation: 13, color: 14, luminosity: 15, add: 16, passthrough: 0,
  'linear-burn': 17, 'darker-color': 18, 'lighter-color': 19, 'vivid-light': 20, 'linear-light': 21, 'pin-light': 22, 'hard-mix': 23, subtract: 24, divide: 25,
};
const ADD = 16;

interface Surf {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  fmt: 'u8' | 'f16';
  idle: number;
}

class Prog {
  private readonly locs = new Map<string, WebGLUniformLocation | null>();
  constructor(readonly p: WebGLProgram, private readonly gl: WebGL2RenderingContext) {}
  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) { l = this.gl.getUniformLocation(this.p, name); this.locs.set(name, l); }
    return l;
  }
}

const IDENT: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// perm table of paint/filters.ts noise (same seed, same shuffle)
function mix32(z: number): number {
  z = (z + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

function permTable(seed: number): Uint8Array {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = mix32(seed | 0);
  for (let i = 255; i > 0; i--) {
    s = mix32(s);
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const out = new Uint8Array(512);
  for (let i = 0; i < 512; i++) out[i] = p[i & 255];
  return out;
}

const NOISE_SEED = 7;
const TEXTURE_CAP = 1024 * 1024 * 1024;

export class GpuCompositor {
  readonly canvas: OffscreenCanvas;
  private gl!: WebGL2RenderingContext;
  private cache!: TextureCache;
  private readonly progs = new Map<string, Prog>();
  private readonly pool = new Map<string, Surf[]>();
  private scratch: Surf | null = null;
  private perm: WebGLTexture | null = null;
  private floatOk = false;
  private lost = false;
  private w = 0;
  private h = 0;
  private tick = 0;
  private rasterCanvas: OffscreenCanvas | null = null;
  private readonly textSig = new Map<string, { sig: string; box: { x: number; y: number; w: number; h: number } }>();
  private textCanvas: OffscreenCanvas | null = null;
  /** Called when a lost context has come back, so the renderer draws again. */
  onRestore: (() => void) | null = null;

  private constructor() {
    this.canvas = new OffscreenCanvas(2, 2);
  }

  /** Null when WebGL2 is not available. */
  static create(): GpuCompositor | null {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const g = new GpuCompositor();
    return g.init() ? g : null;
  }

  private init(): boolean {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) return false;
    this.gl = gl;
    this.floatOk = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.cache = new TextureCache(gl, TEXTURE_CAP);
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.dropAll(true); });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.floatOk = !!(this.gl.getExtension('EXT_color_buffer_float') || this.gl.getExtension('EXT_color_buffer_half_float'));
      this.lost = false;
      this.onRestore?.();
    });
    return true;
  }

  /** True while drawing is possible. */
  get ready(): boolean {
    return !this.failed && !this.lost && !this.gl.isContextLost();
  }

  /** Set after a compose failed for a reason other than a lost context; never cleared (no restore is asked for). */
  private failed = false;

  private dropAll(lost: boolean): void {
    this.lost = lost;
    this.progs.clear();
    this.pool.clear();
    this.scratch = null;
    this.perm = null;
    this.textSig.clear();
    this.cache.reset();
  }

  /** Textures of pictures the renderer no longer holds (its forget). */
  forget(keep?: Set<string>): void {
    if (!this.ready) return;
    this.cache.forget(keep ? (k) => k.startsWith('b:') && keep.has(k.slice(2)) : undefined);
    this.textSig.clear();
  }

  forgetOne(id: string): void {
    if (!this.ready) return;
    this.cache.forget((k) => k !== 'b:' + id);
  }

  dispose(): void {
    if (!this.lost && !this.gl.isContextLost()) {
      this.cache.forget();
      this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.dropAll(true);
  }

  get textureBytes(): number {
    return this.cache.size;
  }

  // ---------------------------------------------------------------- gl plumbing

  private prog(name: string, fs: string, vs = VS_BOX): Prog {
    let p = this.progs.get(name);
    if (p) return p;
    const gl = this.gl;
    const mk = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader ${name}: ${gl.getShaderInfoLog(s) ?? ''}`);
      return s;
    };
    const pr = gl.createProgram() as WebGLProgram;
    gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(`program ${name}: ${gl.getProgramInfoLog(pr) ?? ''}`);
    p = new Prog(pr, gl);
    this.progs.set(name, p);
    return p;
  }

  private makeSurf(w: number, h: number, fmt: 'u8' | 'f16'): Surf {
    const gl = this.gl;
    const tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt === 'u8' ? gl.RGBA8 : gl.RGBA16F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer() as WebGLFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h, fmt, idle: this.tick };
  }

  private acquire(w: number, h: number, fmt: 'u8' | 'f16', clear: boolean): Surf {
    const key = `${w}x${h}${fmt}`;
    const s = this.pool.get(key)?.pop() ?? this.makeSurf(w, h, fmt);
    if (clear) this.clear(s);
    return s;
  }

  private release(s: Surf): void {
    s.idle = this.tick;
    const key = `${s.w}x${s.h}${s.fmt}`;
    let list = this.pool.get(key);
    if (!list) { list = []; this.pool.set(key, list); }
    if (list.length < 10) list.push(s);
    else this.free(s);
  }

  private free(s: Surf): void {
    this.gl.deleteFramebuffer(s.fbo);
    this.gl.deleteTexture(s.tex);
  }

  private clear(s: Surf): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Surfaces of sizes that have not been asked for in a while (a resized Stage) are released. */
  private trim(): void {
    for (const [key, list] of this.pool) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (this.tick - list[i].idle > 90) { this.free(list[i]); list.splice(i, 1); }
      }
      if (!list.length) this.pool.delete(key);
    }
    if (this.scratch && (this.scratch.w !== this.w || this.scratch.h !== this.h)) { this.free(this.scratch); this.scratch = null; }
  }

  private bindTex(unit: number, tex: WebGLTexture | null): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  /** Draws a box of the target with the current program; the target is bound here. */
  private box(p: Prog, target: Surf | null, x0: number, y0: number, x1: number, y1: number, w = target ? target.w : this.w, h = target ? target.h : this.h): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.p);
    gl.uniform4f(p.loc('uBox'), x0, y0, x1, y1);
    gl.uniform2f(p.loc('uSize'), w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private full(p: Prog, t: Surf): void {
    this.gl.disable(this.gl.BLEND);
    this.box(p, t, 0, 0, t.w, t.h);
  }

  // ---------------------------------------------------------------- composition

  /** Composes `tracks` at `frame`; returns the canvas holding the result (valid until the next call), or null to use the CPU path. */
  compose(host: GpuHost, tracks: Track[], frame: number, view: ViewLike, movie: Movie): OffscreenCanvas | null {
    if (!this.ready) return null;
    const w = Math.max(1, Math.round(view.width)), h = Math.max(1, Math.round(view.height));
    if (!this.floatOk && this.needsFloat(tracks, frame)) return null;
    try {
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.w = w; this.h = h;
      this.tick++;
      this.cache.beginFrame();
      const gl = this.gl;
      gl.disable(gl.SCISSOR_TEST);
      const out = this.acquire(w, h, 'u8', true);
      this.walk(host, out, tracks, frame, view, movie);
      this.present(out);
      this.release(out);
      this.cache.endFrame();
      if ((this.tick & 31) === 0) this.trim();
      return this.canvas;
    } catch (e) {
      console.warn('GPU compositor failed, using the CPU path', e);
      if (!this.gl.isContextLost()) {
        // a failure that is not a lost context (a shader that will not compile, say) repeats every frame: give the
        // GPU memory back at once by losing the context on purpose, and stay on the CPU path for this session
        this.failed = true;
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      this.dropAll(true);
      return null;
    }
  }

  private needsFloat(tracks: Track[], frame: number): boolean {
    for (const t of tracks) {
      if (t.hidden) continue;
      const c = t.content.find((x) => frame >= x.start && frame < end(x));
      if (!c || c.opacity <= 0) continue;
      const a = animate(c, frame - c.start);
      if (a.blur > 0 || a.sharpen > 0 || a.lens || a.hsb || a.noise) return true;
    }
    return false;
  }

  private walk(host: GpuHost, out: Surf, tracks: Track[], frame: number, view: ViewLike, movie: Movie): void {
    let held: { layer: Surf; c: Content; opacity: number } | null = null;
    const commit = (): void => {
      if (!held) return;
      this.quad(out, held.layer.tex, IDENT, 0, 0, this.w, this.h, held.opacity, MODE[held.c.blend]);
      this.release(held.layer);
      held = null;
    };
    for (let i = tracks.length - 1; i >= 0; i--) {
      const t = tracks[i];
      if (t.hidden) continue;
      const c = t.content.find((x) => frame >= x.start && frame < end(x));
      if (!c || c.opacity <= 0) continue;
      const a = animate(c, frame - c.start);
      if (a.opacity <= 0) continue;
      if (host.direct(c, a, tracks, i, frame)) {
        commit();
        this.content(host, out, c, frame - c.start, view, movie, a, IDENT, 1, 0);
        continue;
      }
      let layer = this.acquire(this.w, this.h, 'u8', true);
      this.content(host, layer, c, frame - c.start, view, movie, a, IDENT, 1, 0);
      layer = this.filters(layer, a, view, movie);
      if ((c.mask === 'alpha' || c.mask === 'luminance') && held) {
        this.scaleBy(held.layer, layer, c.mask === 'luminance' ? 1 : 0, c.maskInvert);
        this.release(layer);
        continue;
      }
      if (c.mask === 'clipping' && held) this.scaleBy(layer, held.layer, 0, false);
      commit();
      held = { layer, c, opacity: a.opacity };
    }
    commit();
  }

  /** Target colour times the mask value read from `mask` (destination-in). */
  private scaleBy(target: Surf, mask: Surf, kind: number, invert: boolean): void {
    const gl = this.gl;
    const p = this.prog('mask', FS_MASK);
    gl.useProgram(p.p);
    this.bindTex(0, mask.tex);
    gl.uniform1i(p.loc('uMask'), 0);
    gl.uniform1i(p.loc('uKind'), kind);
    gl.uniform1i(p.loc('uInvert'), invert ? 1 : 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    this.box(p, target, 0, 0, target.w, target.h);
    gl.disable(gl.BLEND);
  }

  private present(out: Surf): void {
    const gl = this.gl;
    const p = this.prog('present', FS_PRESENT);
    gl.useProgram(p.p);
    this.bindTex(0, out.tex);
    gl.uniform1i(p.loc('uTex'), 0);
    gl.uniform1f(p.loc('uH'), this.h);
    gl.disable(gl.BLEND);
    this.box(p, null, 0, 0, this.w, this.h, this.w, this.h);
  }

  // ---------------------------------------------------------------- drawing content

  private content(host: GpuHost, target: Surf, c: Content, local: number, view: ViewLike, movie: Movie, a: Animated, parent: Mat, alpha: number, mode: number): void {
    if (parent === IDENT && host.cpu(c, a, local)) { this.raster(host, target, c, local, view, movie, a, alpha, mode); return; }
    // top level: view, camera, parents and own (engine/transform.ts); a group member: own and same-group parents, inside the group's matrix
    const m = parent === IDENT ? topMatrix(movie, c, local + c.start, a, view) : mul(parent, memberMatrix(movie, c, local + c.start, a));
    const mw = movie.width, mh = movie.height;
    switch (c.kind) {
      case 'image': {
        const bmp = host.bitmap(c.asset);
        const asset = c.asset ? movie.assets[c.asset] : undefined;
        if (!bmp || !asset) return;
        const tex = this.cache.get('b:' + c.asset, bmp);
        if (tex) this.quad(target, tex, m, (mw - asset.width) / 2, (mh - asset.height) / 2, asset.width, asset.height, alpha, mode);
        return;
      }
      case 'video': {
        const asset = c.asset ? movie.assets[c.asset] : undefined;
        const img = host.video(c, local, movie);
        if (!img || !asset) return;
        const tex = this.cache.get('v:' + c.id, img);
        if (tex) this.quad(target, tex, m, (mw - asset.width) / 2, (mh - asset.height) / 2, asset.width, asset.height, alpha, mode);
        return;
      }
      case 'drawing': this.layers(host, target, c.layers, m, movie, alpha, mode); return;
      case 'flipbook': {
        const f = local + c.offset;
        for (let i = c.flip.length - 1; i >= 0; i--) {
          const t = c.flip[i];
          if (t.hidden || t.opacity <= 0) continue;
          const index = flipIndexAt(t, f);
          if (index < 0) continue;
          this.layers(host, target, t.frames[index].layers, m, movie, alpha * t.opacity, MODE[t.blend]);
        }
        return;
      }
      case 'text': this.text(host, target, c, m, movie, alpha, mode); return;
      case 'group': {
        const unit: ViewLike = { scale: 1, ox: 0, oy: 0, width: mw, height: mh };
        const g = local + c.offset;
        for (let i = c.tracks.length - 1; i >= 0; i--) {
          const t = c.tracks[i];
          if (t.hidden) continue;
          const mc = t.content.find((x) => g >= x.start && g < end(x));
          if (!mc || mc.opacity <= 0) continue;
          this.content(host, target, mc, g - mc.start, unit, movie, animate(mc, g - mc.start), m, mc.opacity, MODE[mc.blend]);
        }
        return;
      }
      default: return;
    }
  }

  /** Content the CPU draws (Warp and Distort, layer groups and masks): rasterised at the target's size and drawn as one picture. */
  private raster(host: GpuHost, target: Surf, c: Content, local: number, view: ViewLike, movie: Movie, a: Animated, alpha: number, mode: number): void {
    if (!this.rasterCanvas) this.rasterCanvas = new OffscreenCanvas(this.w, this.h);
    const rc = this.rasterCanvas;
    if (rc.width !== this.w || rc.height !== this.h) { rc.width = this.w; rc.height = this.h; }
    const cx = rc.getContext('2d') as OffscreenCanvasRenderingContext2D;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = 'source-over';
    cx.clearRect(0, 0, rc.width, rc.height);
    host.raster(c, local, view, movie, a, rc);
    const tex = this.cache.put('r:' + c.id, rc);
    if (tex) this.quad(target, tex, IDENT, 0, 0, this.w, this.h, alpha, mode);
  }

  /** Text is drawn once into a tight picture at the density it shows at, then placed like any picture; kept while unchanged. */
  private text(host: GpuHost, target: Surf, c: Content, m: Mat, movie: Movie, alpha: number, mode: number): void {
    if (!c.text) return;
    const d = Math.min(8, Math.max(0.05, Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]))));
    const key = 't:' + c.id;
    const sig = `${JSON.stringify(c.text)}|${d.toFixed(3)}|${movie.width}x${movie.height}`;
    let tex = this.textSig.get(key)?.sig === sig ? this.cache.peek(key) : null;
    let box = this.textSig.get(key)?.box;
    if (!tex) {
      if (!this.textCanvas) this.textCanvas = new OffscreenCanvas(8, 8);
      box = host.textBox(c, movie, d, this.textCanvas) ?? undefined;
      tex = box ? this.cache.put(key, this.textCanvas) : null;
      if (tex && box) this.textSig.set(key, { sig, box }); else this.textSig.delete(key);
    }
    if (tex && box) this.quad(target, tex, m, box.x, box.y, box.w, box.h, alpha, mode);
  }

  private layers(host: GpuHost, target: Surf, layers: DrawingLayer[], m: Mat, movie: Movie, alpha: number, mode: number): void {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.opacity <= 0) continue;
      const bmp = host.bitmap(l.pixels);
      if (!bmp) continue;
      const tex = this.cache.get('b:' + l.pixels, bmp);
      if (tex) this.quad(target, tex, m, 0, 0, movie.width, movie.height, alpha * l.opacity, l.blend === 'normal' ? mode : MODE[l.blend]);
    }
  }

  /** One textured rectangle (local rect rx ry rw rh under matrix m) onto `target`, edge-antialiased, with a blend mode. */
  private quad(target: Surf, tex: WebGLTexture, m: Mat, rx: number, ry: number, rw: number, rh: number, alpha: number, mode: number): void {
    const det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12 || alpha <= 0 || rw <= 0 || rh <= 0) return;
    const xs: number[] = [], ys: number[] = [];
    for (const [x, y] of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]]) {
      xs.push(m[0] * x + m[2] * y + m[4]);
      ys.push(m[1] * x + m[3] * y + m[5]);
    }
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
    const x1 = Math.min(target.w, Math.ceil(Math.max(...xs)) + 1), y1 = Math.min(target.h, Math.ceil(Math.max(...ys)) + 1);
    if (x1 <= x0 || y1 <= y0) return;
    const gl = this.gl;
    const plain = mode === 0 || mode === ADD;
    // made before any binding below (creating a surface binds a texture); a backdrop of another size (the probe,
    // a resized Stage, an export at its own size) is replaced here, not at the next periodic trim
    if (!plain && this.scratch && (this.scratch.w !== this.w || this.scratch.h !== this.h)) { this.free(this.scratch); this.scratch = null; }
    const sc = plain ? null : this.scratch ?? (this.scratch = this.makeSurf(this.w, this.h, 'u8'));
    const p = plain ? this.prog('plain', FS_SRC_PLAIN, VS_SRC) : this.prog('blend', FS_SRC_BLEND, VS_SRC);
    gl.useProgram(p.p);
    this.bindTex(0, tex);
    gl.uniform1i(p.loc('uTex'), 0);
    gl.uniform4f(p.loc('uInv'), m[3] / det, -m[1] / det, -m[2] / det, m[0] / det);
    gl.uniform2f(p.loc('uInvE'), (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det);
    gl.uniform2f(p.loc('uEdge'), 1 / Math.max(Math.hypot(m[3], m[2]) / Math.abs(det), 1e-6), 1 / Math.max(Math.hypot(m[1], m[0]) / Math.abs(det), 1e-6));
    gl.uniform4f(p.loc('uRect'), rx, ry, rw, rh);
    gl.uniform1f(p.loc('uAlpha'), alpha);
    if (plain || !sc) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, mode === ADD ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    } else {
      // the backdrop under the box, copied aside so the shader can read it
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sc.fbo);
      gl.blitFramebuffer(x0, y0, x1, y1, x0, y0, x1, y1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      this.bindTex(1, sc.tex);
      gl.uniform1i(p.loc('uBack'), 1);
      gl.uniform1i(p.loc('uMode'), mode);
      gl.disable(gl.BLEND);
    }
    this.box(p, target, x0, y0, x1, y1);
    gl.disable(gl.BLEND);
  }

  // ---------------------------------------------------------------- live filters

  /** Runs the content's filters in the CPU order (HSB, blur, lens, sharpen, noise); returns the surface holding the result. */
  private filters(layer: Surf, a: Animated, view: ViewLike, movie: Movie): Surf {
    if (!a.blur && !a.sharpen && !a.noise && !a.hsb && !a.lens && !a.boil) return layer;
    const side = Math.max(movie.width, movie.height) * 0.05 * view.scale;
    const stages: ((src: Surf, fmt: 'u8' | 'f16') => Surf)[] = [];
    const bo = a.boil;
    if (bo) stages.push((s, f) => this.boilPass(s, f, bo.amount * view.scale, bo.scale * view.scale, bo.seed));
    const hsb = a.hsb;
    if (hsb && (hsb.hue !== 0 || hsb.saturation !== 0 || hsb.brightness !== 0)) stages.push((s, f) => this.hsbPass(s, f, hsb.hue, hsb.saturation, hsb.brightness));
    if (a.blur > 0) { const r = a.blur * side; stages.push((s, f) => this.blur(s, f, r / 2)); }
    const lens = a.lens;
    if (lens && lens.radius > 0) { const r = lens.radius * side; stages.push((s, f) => this.lensBlur(s, f, r, lens.brightness, lens.contrast)); }
    if (a.sharpen > 0) { const k = a.sharpen; stages.push((s, f) => this.sharpen(s, f, k)); }
    const nz = a.noise;
    if (nz && nz.amount > 0) stages.push((s, f) => this.noise(s, f, nz, view));
    let cur = layer;
    const last = stages.length - 1;
    stages.forEach((st, k) => {
      const next = st(cur, k === last || !this.floatOk ? 'u8' : 'f16');
      if (cur !== layer || k === 0) this.release(cur);
      cur = next;
    });
    return cur;
  }

  private setTex(p: Prog, name: string, unit: number, tex: WebGLTexture): void {
    this.bindTex(unit, tex);
    this.gl.uniform1i(p.loc(name), unit);
  }

  private hsbPass(src: Surf, fmt: 'u8' | 'f16', hue: number, saturation: number, brightness: number): Surf {
    const gl = this.gl;
    const t = (hue * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
    const H = [
      0.213 + c * 0.787 - sn * 0.213, 0.715 - c * 0.715 - sn * 0.715, 0.072 - c * 0.072 + sn * 0.928,
      0.213 - c * 0.213 + sn * 0.143, 0.715 + c * 0.285 + sn * 0.140, 0.072 - c * 0.072 - sn * 0.283,
      0.213 - c * 0.213 - sn * 0.787, 0.715 - c * 0.715 + sn * 0.715, 0.072 + c * 0.928 + sn * 0.072,
    ];
    const sat = saturation < 0 ? 1 + saturation : 1 + 2 * saturation;
    const L = [0.2126, 0.7152, 0.0722];
    const S: number[] = [];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) S.push((r === k ? sat : 0) + (1 - sat) * L[k]);
    const M: number[] = [];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) M.push(H[r * 3] * S[k] + H[r * 3 + 1] * S[3 + k] + H[r * 3 + 2] * S[6 + k]);
    const gain = brightness > 0 ? 1 - brightness : 1 + brightness;
    for (let i = 0; i < 9; i++) M[i] *= gain;
    const cm = new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]);
    const out = this.acquire(src.w, src.h, fmt, false);
    const p = this.prog('hsb', FS_HSB);
    gl.useProgram(p.p);
    this.setTex(p, 'uTex', 0, src.tex);
    gl.uniformMatrix3fv(p.loc('uM'), false, cm);
    gl.uniform1f(p.loc('uOff'), brightness > 0 ? brightness : 0);
    this.full(p, out);
    return out;
  }

  private boilPass(src: Surf, fmt: 'u8' | 'f16', amount: number, scale: number, seed: number): Surf {
    const out = this.acquire(src.w, src.h, fmt, false);
    const p = this.prog('boil', FS_BOIL);
    this.gl.useProgram(p.p);
    this.setTex(p, 'uTex', 0, src.tex);
    this.gl.uniform1f(p.loc('uAmount'), amount);
    this.gl.uniform1f(p.loc('uSpacing'), Math.max(2, scale));
    this.gl.uniform1i(p.loc('uSeed'), seed);
    this.full(p, out);
    return out;
  }

  private copyPass(src: Surf, fmt: 'u8' | 'f16'): Surf {
    const out = this.acquire(src.w, src.h, fmt, false);
    const p = this.prog('copy', FS_COPY);
    this.gl.useProgram(p.p);
    this.setTex(p, 'uTex', 0, src.tex);
    this.full(p, out);
    return out;
  }

  private gauss(src: Surf, out: Surf, dx: number, dy: number, sigma: number): void {
    const gl = this.gl;
    const r = Math.max(1, Math.ceil(sigma * 3));
    let norm = 0;
    for (let i = -r; i <= r; i++) norm += Math.exp((-i * i) / (2 * sigma * sigma));
    const p = this.prog('gauss', FS_GAUSS);
    gl.useProgram(p.p);
    this.setTex(p, 'uTex', 0, src.tex);
    gl.uniform2i(p.loc('uDir'), dx, dy);
    gl.uniform1i(p.loc('uR'), r);
    gl.uniform1f(p.loc('uSigma'), sigma);
    gl.uniform1f(p.loc('uNorm'), 1 / norm);
    this.full(p, out);
  }

  private down(src: Surf, f: number, fmt: 'u8' | 'f16'): Surf {
    const out = this.acquire(Math.ceil(src.w / f), Math.ceil(src.h / f), fmt, false);
    const p = this.prog('down', FS_DOWN);
    this.gl.useProgram(p.p);
    this.setTex(p, 'uTex', 0, src.tex);
    this.gl.uniform1i(p.loc('uF'), f);
    this.full(p, out);
    return out;
  }

  /** Enlarges `small` by f into a surface of the full size (centres aligned, edges clamped). */
  private up(small: Surf, f: number, w: number, h: number, fmt: 'u8' | 'f16', finish: boolean): Surf {
    const out = this.acquire(w, h, fmt, false);
    const p = this.prog('up', FS_UP);
    this.gl.useProgram(p.p);
    this.setTex(p, 'uTex', 0, small.tex);
    this.gl.uniform2f(p.loc('uInvSize'), 1 / (small.w * f), 1 / (small.h * f));
    this.gl.uniform1i(p.loc('uFinish'), finish ? 1 : 0);
    this.full(p, out);
    return out;
  }

  /** Gaussian blur of standard deviation `sigma` pixels, zero padded; big blurs run on a reduced copy. */
  private blur(src: Surf, fmt: 'u8' | 'f16', sigma: number): Surf {
    if (sigma < 0.3) return this.copyPass(src, fmt);
    const f = sigma >= 96 ? 16 : sigma >= 48 ? 8 : sigma >= 24 ? 4 : sigma >= 6 ? 2 : 1;
    const mid: 'u8' | 'f16' = this.floatOk ? 'f16' : 'u8';
    if (f === 1) {
      const t = this.acquire(src.w, src.h, mid, false);
      this.gauss(src, t, 1, 0, sigma);
      const out = this.acquire(src.w, src.h, fmt, false);
      this.gauss(t, out, 0, 1, sigma);
      this.release(t);
      return out;
    }
    const s = this.down(src, f, mid);
    const t = this.acquire(s.w, s.h, mid, false);
    this.gauss(s, t, 1, 0, sigma / f);
    this.gauss(t, s, 0, 1, sigma / f);
    const out = this.up(s, f, src.w, src.h, fmt, false);
    this.release(s);
    this.release(t);
    return out;
  }

  private sharpen(src: Surf, fmt: 'u8' | 'f16', amount: number): Surf {
    const gl = this.gl;
    const b = this.blur(src, this.floatOk ? 'f16' : 'u8', 0.75);
    const out = this.acquire(src.w, src.h, fmt, false);
    const p = this.prog('sharpen', FS_SHARPEN);
    gl.useProgram(p.p);
    this.setTex(p, 'uTex', 0, src.tex);
    this.setTex(p, 'uBlur', 1, b.tex);
    gl.uniform1f(p.loc('uK'), Math.min(1, amount) * 3);
    this.full(p, out);
    this.release(b);
    return out;
  }

  private box1(src: Surf, out: Surf, dx: number, dy: number, r: number): void {
    const gl = this.gl;
    const p = this.prog('box', FS_BOX);
    gl.useProgram(p.p);
    this.setTex(p, 'uTex', 0, src.tex);
    gl.uniform2i(p.loc('uDir'), dx, dy);
    gl.uniform1i(p.loc('uR'), r);
    this.full(p, out);
  }

  /** Highlights bloom into discs: boosted bright pixels, an octagon of four line boxes, then straight colour again. */
  private lensBlur(src: Surf, fmt: 'u8' | 'f16', radius: number, brightness: number, contrast: number): Surf {
    if (radius < 0.5) return this.copyPass(src, fmt);
    const gl = this.gl;
    const boosted = this.acquire(src.w, src.h, 'f16', false);
    const bp = this.prog('boost', FS_BOOST);
    gl.useProgram(bp.p);
    this.setTex(bp, 'uTex', 0, src.tex);
    gl.uniform1f(bp.loc('uBoost'), Math.max(0, Math.min(1, brightness)) * 6);
    gl.uniform1f(bp.loc('uPow'), 3 + Math.max(0, Math.min(1, contrast)) * 9);
    this.full(bp, boosted);
    const f = radius >= 40 ? 4 : radius >= 6 ? 2 : 1;
    const a = f > 1 ? this.down(boosted, f, 'f16') : boosted;
    if (f > 1) this.release(boosted);
    const b = this.acquire(a.w, a.h, 'f16', false);
    const R = radius / f;
    const ax = Math.max(0, Math.round((R * 1.25) / 2.414));
    const dg = Math.max(0, Math.round(ax / 1.414));
    this.box1(a, b, 1, 0, ax);
    this.box1(b, a, 0, 1, ax);
    this.box1(a, b, 1, 1, dg);
    this.box1(b, a, 1, -1, dg);
    const out = this.up(a, f, src.w, src.h, fmt, true);
    this.release(a);
    this.release(b);
    return out;
  }

  private noise(src: Surf, fmt: 'u8' | 'f16', n: NonNullable<Animated['noise']>, view: ViewLike): Surf {
    const gl = this.gl;
    const scale = Math.max(1, Math.max(1, n.scale * view.scale));
    const maxOct = Math.max(1, Math.floor(Math.log2(scale / 4)) + 1);
    const oct = Math.max(1, Math.min(8, Math.round(n.octaves), maxOct));
    let total = 0, amp = 1;
    for (let o = 0; o < oct; o++) { total += amp; amp *= 0.5; }
    const finest = scale / (1 << (oct - 1));
    const g = Math.max(1, Math.min(8, Math.floor(finest / 2)));
    const gw = Math.ceil(src.w / g) + 1, gh = Math.ceil(src.h / g) + 1;
    if (!this.perm) {
      const t = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, 512, 1);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 1, gl.RED, gl.UNSIGNED_BYTE, permTable(NOISE_SEED));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.perm = t;
    }
    const grid = this.acquire(gw, gh, 'u8', false);
    const gp = this.prog('ngrid', FS_NOISE_GRID);
    gl.useProgram(gp.p);
    this.setTex(gp, 'uPerm', 2, this.perm);
    gl.uniform1f(gp.loc('uInvScale'), 1 / scale);
    gl.uniform1f(gp.loc('uWarp'), Math.max(0, Math.min(1, n.turbulence)) * 1.5);
    gl.uniform1f(gp.loc('uZ'), n.travel);
    gl.uniform2f(gp.loc('uOffset'), n.offsetX * view.scale, n.offsetY * view.scale);
    gl.uniform1i(gp.loc('uG'), g);
    gl.uniform1i(gp.loc('uOct'), oct);
    gl.uniform1i(gp.loc('uStyle'), n.style === 'clouds' ? 0 : n.style === 'billows' ? 1 : 2);
    gl.uniform1f(gp.loc('uNorm'), 1 / total);
    gl.uniform1i(gp.loc('uChans'), n.multichannel ? 3 : 1);
    this.full(gp, grid);
    const out = this.acquire(src.w, src.h, fmt, false);
    const ap = this.prog('napply', FS_NOISE_APPLY);
    gl.useProgram(ap.p);
    this.setTex(ap, 'uTex', 0, src.tex);
    this.setTex(ap, 'uGrid', 1, grid.tex);
    gl.uniform1i(ap.loc('uG'), g);
    gl.uniform1f(ap.loc('uAmount'), Math.min(1, n.amount));
    gl.uniform1i(ap.loc('uAdd'), n.additive ? 1 : 0);
    this.full(ap, out);
    this.release(grid);
    return out;
  }
}
