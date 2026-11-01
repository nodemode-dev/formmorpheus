// WebGL2 compositor on an OffscreenCanvas. It walks the tracks the way Renderer.composeTracks does (held
// layer, clipping, alpha / luminance masks, blends, keyed opacity, live filters, groups) but on the GPU.
// The CPU path in render.ts stays the reference and the fallback. No DOM.
import { end, flipIndexAt } from '../model';
import { animate, type Animated } from '../keys';
import { memberMatrix, topMatrix } from '../transform';
import { canvasOf } from '../canvas';
import { srcFrame } from '../retime';
import type { BlendMode, CanvasRect, Content, DrawingLayer, Movie, Track } from '../types';
import {
  FS_BOIL, FS_BOOST, FS_BOX, FS_COPY, FS_DOWN, FS_GAUSS, FS_HSB, FS_MASK, FS_NOISE_APPLY, FS_NOISE_GRID, FS_PRESENT, FS_SHARPEN,
  FS_SRC_BLEND, FS_SRC_PLAIN, FS_UP, HEAD, VS_BOX, VS_SRC,
} from './shaders';

/** Frame of a registry effect shader (engine/fx/registry.ts): the step supplies `vec4 fx(ivec2 p)` and its own uniforms. */
const FX_HEAD = `${HEAD}uniform sampler2D uSrc;
uniform sampler2D uS0; uniform sampler2D uS1; uniform sampler2D uS2; uniform sampler2D uS3; uniform sampler2D uS4; uniform sampler2D uS5;
uniform float uScale;
uniform vec2 uO;
uniform vec2 uM;
`;
const FX_TAIL = '\nout vec4 o;\nvoid main() { o = fx(ivec2(gl_FragCoord.xy)); }';
import { TextureCache, type TexSource } from './textures';
import '../fx';
import { activeFx, gpuSteps, type Effect, type FxCtx } from '../fx/registry';
import type { FxInst } from '../keys';
import { fontEpoch } from '../text-layout';
import { phaseSig, textPhase } from '../text-phase';
import type { TextPhase } from '../text-anim';
import { hasTree } from '../../paint/layer-tree';
import { hasRowMask } from '../flip-draw';
import { isPixelBlend } from '../blend';
import { ATOP, GpuTree } from './tree';
import { MeshDrawer, flatScaleOf } from './mesh';
import { contentRect, setStagePost, warpActive, warpQuads } from '../warp-draw';
import { boneQuads } from '../bones';
import { postMatrix } from '../transform';
import { FS_ADJUST } from './shaders-shape';
import { hasFilters } from '../shape-adjust';

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
  textBox(c: Content, movie: Movie, density: number, into: OffscreenCanvas, ph?: TextPhase | null): { x: number; y: number; w: number; h: number } | null;
  /** Draws the whole content (transform included) into `into`, which is cleared and identity-transformed. */
  raster(c: Content, local: number, view: ViewLike, movie: Movie, a: Animated, into: OffscreenCanvas): void;
  /** An Adjustment's weight picture (opacity times mask) as alpha on a canvas, or null for the plain opacity; the canvas is valid inside `use`. */
  adjust(c: Content, local: number, view: ViewLike, movie: Movie, a: Animated, op: number, use: (w: OffscreenCanvas | null) => void, grp?: { local: number; m: Mat }): void;
}

export type Mat = [number, number, number, number, number, number];

const MODE: Record<BlendMode, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, 'color-dodge': 6, 'color-burn': 7, 'hard-light': 8,
  'soft-light': 9, difference: 10, exclusion: 11, hue: 12, saturation: 13, color: 14, luminosity: 15, add: 16, passthrough: 0,
  'linear-burn': 17, 'darker-color': 18, 'lighter-color': 19, 'vivid-light': 20, 'linear-light': 21, 'pin-light': 22, 'hard-mix': 23, subtract: 24, divide: 25,
};
const ADD = 16;

export interface Surf {
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
const TEXTURE_CAP = 512 * 1024 * 1024;
/** Idle pooled surfaces kept per size, in bytes (a 3840 px surface is 33 to 118 MB, a 1080p one 8 MB). */
const POOL_IDLE_BYTES = 64 * 1024 * 1024;
/** Below this the driver cannot hold even a small movie; the GL minimum is 2048. */
const MIN_SIDE = 2048;

/** A surface or source the driver cannot hold: the frame is drawn by the CPU, the GPU stays on. */
class GpuLimit extends Error {}

export class GpuCompositor {
  readonly canvas: OffscreenCanvas;
  private gl!: WebGL2RenderingContext;
  private cache!: TextureCache;
  private readonly progs = new Map<string, Prog>();
  private readonly pool = new Map<string, Surf[]>();
  private scratch: Surf | null = null;
  private scratchTree: Surf | null = null;
  private tree!: GpuTree;
  private perm: WebGLTexture | null = null;
  private floatOk = false;
  private lost = false;
  /** Smallest of the driver's texture, renderbuffer and viewport limits: no view or source above it is drawn here. */
  maxSide = 0;
  /** How many times the context has been lost or switched off after an error; an export compares it before and after. */
  resets = 0;
  private errStrikes = 0;
  private w = 0;
  private h = 0;
  private tick = 0;
  private readonly rasterPool: OffscreenCanvas[] = [];
  private rasterUsed = 0;
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
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number> | null;
    this.maxSide = Math.min(
      Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0, Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 0,
      vp ? Number(vp[0]) || 0 : 0, vp ? Number(vp[1]) || 0 : 0,
    );
    if (this.maxSide < MIN_SIDE) return false;
    while (gl.getError() !== gl.NO_ERROR) { /* drain what the context start left */ }
    this.cache = new TextureCache(gl, TEXTURE_CAP, this.maxSide);
    this.checkFloat();
    this.tree = new GpuTree({
      gl,
      view: () => ({ w: this.w, h: this.h }),
      acquire: (w, h) => this.acquire(w, h, 'u8', true),
      release: (s) => { this.release(s); },
      quad: (t, tex, m, rx, ry, rw, rh, a, mode) => { this.quad(t, tex, m, rx, ry, rw, rh, a, mode); },
      mode: (b) => MODE[b],
      tex: (key, src) => this.cache.get(key, src),
      layers: (bm, t, ls, m, rect, a, mode) => { this.layers({ bitmap: bm } as GpuHost, t, ls, m, rect, a, mode); },
      run: (name, fs, target, multiply, setup) => {
        const p = this.prog(name, fs);
        gl.useProgram(p.p);
        setup((n) => p.loc(n), (unit, tex) => { this.bindTex(unit, tex); });
        if (multiply) { gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.SRC_COLOR); } else gl.disable(gl.BLEND);
        this.box(p, target, 0, 0, target.w, target.h);
        gl.disable(gl.BLEND);
      },
    });
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.dropAll(true); });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.errStrikes = 0;
      this.checkFloat();
      this.onRestore?.();
    });
    return true;
  }

  /** Half-float targets are used only when a surface of that format is really complete (the extension alone does not prove it). */
  private checkFloat(): void {
    const gl = this.gl;
    this.floatOk = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    if (!this.floatOk) return;
    try {
      const s = this.makeSurf(4, 4, 'f16');
      if (s.fmt !== 'f16') this.floatOk = false;
      this.free(s);
    } catch { this.floatOk = false; }
  }

  /** True while drawing is possible. */
  get ready(): boolean {
    if (!this.lost && !this.failed && this.gl.isContextLost()) this.dropAll(true);
    return !this.failed && !this.lost && !this.gl.isContextLost();
  }

  /** Set after a compose failed for a reason other than a lost context; never cleared (no restore is asked for). */
  private failed = false;

  private dropAll(lost: boolean): void {
    if (lost && !this.lost) this.resets++;
    this.lost = lost;
    this.progs.clear();
    this.pool.clear();
    this.scratch = null;
    this.scratchTree = null;
    this.perm = null;
    this.fxTable = null;
    this.meshDrawer?.dispose();
    this.meshDrawer = null;
    this.textSig.clear();
    this.cache.reset();
  }

  /** Warp / Distort / Bones triangle meshes (gpu/mesh.ts), and the flat-draw matrix the next content() takes instead of its own. */
  private meshDrawer: MeshDrawer | null = null;
  private flatMat: Mat | null = null;

  /** Textures of pictures the renderer no longer holds (its forget). */
  forget(keep?: Set<string>): void {
    if (!this.ready) return;
    this.cache.forget(keep ? (k) => k.startsWith('b:') && keep.has(k.slice(2)) : undefined);
    this.textSig.clear();
  }

  /** Releases the textures of pictures and contents the movie no longer holds (called when the movie changes). */
  prune(live: { contents: Set<string>; assets: Set<string> }): void {
    if (!this.ready) return;
    this.cache.forget((k) => {
      const id = k.slice(2);
      if (k.startsWith('b:')) return live.assets.has(id);
      if (k.startsWith('v:') || k.startsWith('t:') || k.startsWith('r:')) return live.contents.has(id);
      return true;
    });
    for (const key of [...this.textSig.keys()]) if (!live.contents.has(key.slice(2))) this.textSig.delete(key);
  }

  /** Releases only the textures of the given pictures and contents (the probe's scenes), leaving everything else cached. */
  dropLive(live: { contents: Set<string>; assets: Set<string> }): void {
    if (!this.ready) return;
    this.cache.forget((k) => {
      const id = k.slice(2);
      if (k.startsWith('b:')) return !live.assets.has(id);
      if (k.startsWith('v:') || k.startsWith('t:') || k.startsWith('r:')) return !live.contents.has(id);
      return true;
    });
    for (const key of [...this.textSig.keys()]) if (live.contents.has(key.slice(2))) this.textSig.delete(key);
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
    if (w > this.maxSide || h > this.maxSide) throw new GpuLimit(`surface ${w}x${h} is over the limit ${this.maxSide}`);
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
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      if (this.gl.isContextLost()) throw new Error('context lost');
      // half float did not work as a target: 8-bit surfaces from now on, and float effects go to the CPU
      if (fmt === 'f16') { this.floatOk = false; return this.makeSurf(w, h, 'u8'); }
      throw new Error(`incomplete framebuffer ${w}x${h}`);
    }
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
    // about 64 MB idle per size: ten at 1080p, two at 3840 px
    const room = Math.min(10, Math.max(2, Math.floor(POOL_IDLE_BYTES / (s.w * s.h * (s.fmt === 'f16' ? 8 : 4)))));
    if (list.length < room) list.push(s);
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
        // big surfaces go sooner: they are the ones that run a small card out of memory
        const idleMax = Math.max(list[i].w, list[i].h) > 2560 ? 30 : 90;
        if (this.tick - list[i].idle > idleMax) { this.free(list[i]); list.splice(i, 1); }
      }
      if (!list.length) this.pool.delete(key);
    }
    if (this.scratch && (this.scratch.w !== this.w || this.scratch.h !== this.h)) { this.free(this.scratch); this.scratch = null; }
    if (this.scratchTree) { this.free(this.scratchTree); this.scratchTree = null; }
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
    // a view the driver cannot hold: this frame is drawn by the CPU
    if (w > this.maxSide || h > this.maxSide) return null;
    if (!this.floatOk && this.needsFloat(tracks, frame)) return null;
    try {
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.w = w; this.h = h;
      this.tick++;
      this.cache.beginFrame();
      this.cache.takeRefused();
      this.rasterUsed = 0;
      const gl = this.gl;
      gl.disable(gl.SCISSOR_TEST);
      const out = this.acquire(w, h, 'u8', true);
      this.walk(host, out, tracks, frame, view, movie);
      // a layer's picture the driver would not hold would draw as nothing: give the whole frame to the CPU
      const refused = this.cache.takeRefused();
      if (!refused) this.present(out);
      this.release(out);
      this.cache.endFrame();
      if ((this.tick & 31) === 0) this.trim();
      // GL errors raise no exception: read them on the first frame and every 32nd; two in a row are persistent
      if ((this.tick & 31) === 1) {
        const err = gl.getError();
        if (err === gl.OUT_OF_MEMORY || (err !== gl.NO_ERROR && ++this.errStrikes >= 2)) throw new Error(`GL error ${err}`);
        if (err === gl.NO_ERROR) this.errStrikes = 0;
      }
      return refused ? null : this.canvas;
    } catch (e) {
      if (e instanceof GpuLimit) {
        // one surface too big for the driver: this frame is the CPU's, the GPU stays on; what was in flight is left to the collector
        for (const list of this.pool.values()) list.forEach((s) => { this.free(s); });
        this.pool.clear();
        this.gl.disable(this.gl.BLEND);
        if (this.scratch) { this.free(this.scratch); this.scratch = null; }
        if (this.scratchTree) { this.free(this.scratchTree); this.scratchTree = null; }
        return null;
      }
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
      if (a.blur > 0 || a.sharpen > 0 || a.lens || a.hsb || a.noise || a.fx) return true;
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
      if (c.kind === 'adjust') { commit(); this.adjust(host, out, c, frame - c.start, a, view, movie); continue; }
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

  /** Adjustment block: filters a copy of everything drawn so far and mixes it back through the block's weight (shape-adjust.ts). */
  private adjust(host: GpuHost, out: Surf, c: Content, local: number, a: Animated, view: ViewLike, movie: Movie, grp?: { local: number; m: Mat }): void {
    if (!hasFilters(a)) return;
    const op = Math.min(1, Math.max(0, a.opacity));
    if (op <= 0) return;
    const gl = this.gl;
    const f = this.filters(this.copyPass(out, 'u8'), a, view, movie);
    host.adjust(c, local, view, movie, a, op, (w) => {
      const wt = w ? this.cache.put('r:' + c.id, w) : null;
      const p = this.prog('adjust', FS_ADJUST);
      gl.useProgram(p.p);
      this.setTex(p, 'uF', 0, f.tex);
      if (wt) this.setTex(p, 'uW', 1, wt);
      gl.uniform1i(p.loc('uHasW'), wt ? 1 : 0);
      gl.uniform1f(p.loc('uOp'), op);
      gl.enable(gl.BLEND);
      gl.uniform1i(p.loc('uPass'), 0);
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      this.box(p, out, 0, 0, out.w, out.h);
      gl.uniform1i(p.loc('uPass'), 1);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.box(p, out, 0, 0, out.w, out.h);
      gl.disable(gl.BLEND);
    }, grp);
    this.release(f);
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
    if (a.warp || a.distort || (a.bones && c.rig)) { this.meshContent(host, target, c, local, view, movie, a, parent, alpha, mode); return; }
    // top level: view, camera, parents and own (engine/transform.ts); a group member: own and same-group parents, inside the group's matrix
    const fm = this.flatMat;
    this.flatMat = null;
    const m = fm ?? (parent === IDENT ? topMatrix(movie, c, local + c.start, a, view) : mul(parent, memberMatrix(movie, c, local + c.start, a)));
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
      case 'drawing': this.layers(host, target, c.layers, m, canvasOf(c, movie), alpha, mode); return;
      case 'flipbook': {
        const f = srcFrame(c, local);
        // row masks, clipping rows and pixel-maths row blends compose each row on a surface first (gpu/tree.ts)
        if (hasRowMask(c) || c.flip.some((t) => !t.hidden && t.opacity > 0 && isPixelBlend(t.blend) && flipIndexAt(t, f) >= 0)) {
          this.tree.rows((id) => host.bitmap(id), target, c, f, m, canvasOf(c, movie), alpha, mode);
          return;
        }
        for (let i = c.flip.length - 1; i >= 0; i--) {
          const t = c.flip[i];
          if (t.hidden || t.opacity <= 0) continue;
          const index = flipIndexAt(t, f);
          if (index < 0) continue;
          this.layers(host, target, t.frames[index].layers, m, canvasOf(c, movie), alpha * t.opacity, MODE[t.blend]);
        }
        return;
      }
      case 'text': this.text(host, target, c, m, movie, alpha, mode, textPhase(c, local, a, movie)); return;
      case 'group': {
        const unit: ViewLike = { scale: 1, ox: 0, oy: 0, width: mw, height: mh };
        const g = srcFrame(c, local);
        // an Adjustment member filters only what its own group drew: the group gets a surface of its own (as on the CPU path)
        const iso = c.tracks.some((t) => !t.hidden && t.content.some((x) => x.kind === 'adjust' && x.opacity > 0 && g >= x.start && g < end(x)));
        const dst = iso ? this.acquire(target.w, target.h, 'u8', true) : target;
        const gview: ViewLike = { scale: Math.hypot(m[0], m[1]), ox: m[4], oy: m[5], width: dst.w, height: dst.h };
        try {
          for (let i = c.tracks.length - 1; i >= 0; i--) {
            const t = c.tracks[i];
            if (t.hidden) continue;
            const mc = t.content.find((x) => g >= x.start && g < end(x));
            if (!mc || mc.opacity <= 0) continue;
            const ma = animate(mc, g - mc.start);
            // keyed opacity counts, as in the CPU group draw
            if (ma.opacity <= 0) continue;
            if (mc.kind === 'adjust') { this.adjust(host, dst, mc, g - mc.start, ma, gview, movie, { local: g, m }); continue; }
            this.content(host, dst, mc, g - mc.start, unit, movie, ma, m, ma.opacity, MODE[mc.blend]);
          }
          if (iso) this.quad(target, dst.tex, IDENT, 0, 0, target.w, target.h, alpha, mode);
        } finally {
          if (iso) this.release(dst);
        }
        return;
      }
      default: return;
    }
  }

  /** Content the CPU draws (Warp and Distort, layer groups and masks): rasterised at the target's size and drawn as one picture. */
  private raster(host: GpuHost, target: Surf, c: Content, local: number, view: ViewLike, movie: Movie, a: Animated, alpha: number, mode: number): void {
    // one canvas per raster in a frame: reusing a canvas for a second raster before the frame ends shows the first one's
    // picture missing (a solid under a shape vanished); the pool is capped, and past the cap canvases are shared again
    const slot = this.rasterUsed++ % 6;
    const rc = this.rasterPool[slot] ?? (this.rasterPool[slot] = new OffscreenCanvas(this.w, this.h));
    if (rc.width !== this.w || rc.height !== this.h) { rc.width = this.w; rc.height = this.h; }
    // a software canvas, like the CPU path's own, so antialiased edges (clips, strokes) come out the same pixels
    const cx = rc.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = 'source-over';
    cx.clearRect(0, 0, rc.width, rc.height);
    host.raster(c, local, view, movie, a, rc);
    const tex = this.cache.put('r:' + c.id, rc);
    if (tex) { this.quad(target, tex, IDENT, 0, 0, this.w, this.h, alpha, mode); }
  }

  /**
   * Warp, Distort and Bones: the content is drawn flat (movie size at the view's density, transform removed) on a
   * surface, re-projected through the triangle list onto a clear layer, and the layer is blended like any picture.
   * Bones skin first, then a Warp / Distort bends that result, as the CPU raster does (render.ts drawContent).
   */
  private meshContent(host: GpuHost, target: Surf, c: Content, local: number, view: ViewLike, movie: Movie, a: Animated, parent: Mat, alpha: number, mode: number): void {
    const nested = parent !== IDENT;
    const P: Mat = nested ? parent : [view.scale, 0, 0, view.scale, view.ox, view.oy];
    const mw = movie.width, mh = movie.height;
    const fs = flatScaleOf(mw, mh, view.scale, this.maxSide);
    const fw = Math.max(1, Math.ceil(mw * fs)), fh = Math.max(1, Math.ceil(mh * fs));
    const rect = contentRect(c, movie);
    const md = this.meshDrawer ?? (this.meshDrawer = new MeshDrawer(this.gl));
    const flatM: Mat = [fs, 0, 0, fs, 0, 0];
    const fa: Animated = { ...a, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false, px: 0, py: 0, warp: null, distort: null, bones: null };
    let flat: Surf | null = null, sk: Surf | null = null, layer: Surf | null = null;
    try {
      flat = this.acquire(fw, fh, 'u8', true);
      this.flatMat = flatM;
      try { this.content(host, flat, c, local, { scale: fs, ox: 0, oy: 0, width: fw, height: fh }, movie, fa, flatM, 1, 0); } finally { this.flatMat = null; }
      layer = this.acquire(target.w, target.h, 'u8', true);
      const warped = warpActive(a);
      const skinned = !!a.bones && !!c.rig;
      let src = flat;
      if (skinned && warped) {
        sk = this.acquire(fw, fh, 'u8', true);
        md.draw(sk, flat, boneQuads(c.rig as NonNullable<Content['rig']>, a.bones, rect, mw, mh, null), fs, flatM, undefined);
        src = sk;
      }
      setStagePost(postMatrix(movie, c, local + c.start, nested, local + c.start));
      const tris = warped ? warpQuads(a, mw, mh, rect) : boneQuads(c.rig as NonNullable<Content['rig']>, a.bones, rect, mw, mh, a);
      md.draw(layer, src, tris, fs, P, warped ? a.resample : undefined);
      this.quad(target, layer.tex, IDENT, 0, 0, target.w, target.h, alpha, mode);
    } finally {
      setStagePost(null);
      if (layer) this.release(layer);
      if (sk) this.release(sk);
      if (flat) this.release(flat);
    }
  }

  /** Text is drawn once into a tight picture at the density it shows at, then placed like any picture; kept while unchanged. */
  private text(host: GpuHost, target: Surf, c: Content, m: Mat, movie: Movie, alpha: number, mode: number, ph: TextPhase | null): void {
    if (!c.text) return;
    const d = Math.min(8, Math.max(0.05, Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]))));
    const key = 't:' + c.id;
    const sig = `${JSON.stringify(c.text)}|${d.toFixed(3)}|${movie.width}x${movie.height}|${fontEpoch()}|${phaseSig(c, movie, ph)}`;
    let tex = this.textSig.get(key)?.sig === sig ? this.cache.peek(key) : null;
    let box = this.textSig.get(key)?.box;
    if (!tex) {
      if (!this.textCanvas) this.textCanvas = new OffscreenCanvas(8, 8);
      box = host.textBox(c, movie, d, this.textCanvas, ph) ?? undefined;
      tex = box ? this.cache.put(key, this.textCanvas) : null;
      if (tex && box) this.textSig.set(key, { sig, box }); else this.textSig.delete(key);
    }
    if (tex && box) this.quad(target, tex, m, box.x, box.y, box.w, box.h, alpha, mode);
  }

  private layers(host: GpuHost, target: Surf, layers: DrawingLayer[], m: Mat, rect: CanvasRect, alpha: number, mode: number): void {
    if (hasTree(layers)) { this.tree.draw((id) => host.bitmap(id), target, layers, m, rect, alpha, mode); return; }
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.opacity <= 0) continue;
      const bmp = host.bitmap(l.pixels);
      if (!bmp) continue;
      const tex = this.cache.get('b:' + l.pixels, bmp);
      if (tex) this.quad(target, tex, m, rect.x, rect.y, rect.w, rect.h, alpha * l.opacity, l.blend === 'normal' ? mode : MODE[l.blend]);
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
    const plain = mode === 0 || mode === ADD || mode === ATOP;
    // made before any binding below (creating a surface binds a texture); a backdrop of another size (the probe,
    // a resized Stage, an export at its own size) is replaced here, not at the next periodic trim
    let sc: Surf | null = null;
    if (!plain) {
      // a layer tree composes on surfaces of the picture's own size: its backdrop copy has its own slot
      const own = target.w === this.w && target.h === this.h;
      const cur = own ? this.scratch : this.scratchTree;
      if (cur && (cur.w !== target.w || cur.h !== target.h)) this.free(cur);
      sc = cur && cur.w === target.w && cur.h === target.h ? cur : this.makeSurf(target.w, target.h, 'u8');
      if (own) this.scratch = sc; else this.scratchTree = sc;
    }
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
      if (mode === ATOP) gl.blendFunc(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, mode === ADD ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
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
    if (!a.blur && !a.sharpen && !a.noise && !a.hsb && !a.lens && !a.boil && !a.fx) return layer;
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
    const fctx: FxCtx = { scale: view.scale, ox: view.ox, oy: view.oy, mw: movie.width, mh: movie.height };
    for (const { e, inst } of activeFx(a.fx)) stages.push((s, f) => this.fxPass(s, f, e, inst, fctx));
    if (!stages.length) return layer;
    let cur = layer;
    const last = stages.length - 1;
    stages.forEach((st, k) => {
      const next = st(cur, k === last || !this.floatOk ? 'u8' : 'f16');
      if (cur !== layer || k === 0) this.release(cur);
      cur = next;
    });
    return cur;
  }

  /** 1024 x 1 float table an effect step reads as `uTable` (a color correction's levels and curves). */
  private fxTable: WebGLTexture | null = null;

  /** Runs a registry effect (engine/fx): its steps in order, intermediate results kept for the later steps that read them. */
  private fxPass(src: Surf, fmt: 'u8' | 'f16', e: Effect, inst: FxInst, ctx: FxCtx): Surf {
    const gl = this.gl;
    const steps = gpuSteps(e, inst.p, inst.o);
    const mid: 'u8' | 'f16' = this.floatOk ? 'f16' : 'u8';
    const res: Surf[] = [];
    const last = steps.length - 1;
    for (let i = 0; i <= last; i++) {
      const st = steps[i];
      const f = i === last ? fmt : mid;
      if (st.kind === 'blur') {
        res.push(this.blur(st.from < 0 ? src : res[st.from], f, st.sigma(inst.p, inst.o, ctx)));
        continue;
      }
      const out = this.acquire(src.w, src.h, f, false);
      const p = this.prog('fx|' + st.glsl, FX_HEAD + st.glsl + FX_TAIL);
      gl.useProgram(p.p);
      if (st.table) {
        const t = st.table(inst.p, inst.o);
        if (!this.fxTable) {
          const tex = gl.createTexture() as WebGLTexture;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, t.length / 4, 1);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          this.fxTable = tex;
        }
        this.bindTex(6, this.fxTable);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, t.length / 4, 1, gl.RGBA, gl.FLOAT, t);
        gl.uniform1i(p.loc('uTable'), 6);
      }
      // bound after the table: creating a texture binds it on the active unit
      this.setTex(p, 'uSrc', 0, src.tex);
      (st.reads ?? []).forEach((k, n) => this.setTex(p, 'uS' + k, 1 + n, res[k].tex));
      gl.uniform1f(p.loc('uScale'), ctx.scale);
      gl.uniform2f(p.loc('uO'), ctx.ox, ctx.oy);
      gl.uniform2f(p.loc('uM'), ctx.mw, ctx.mh);
      const u = st.uniforms ? st.uniforms(inst.p, inst.o, ctx) : {};
      for (const name in u) {
        const v = u[name], loc = p.loc(name);
        if (typeof v === 'number') gl.uniform1f(loc, v);
        else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
        else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
      }
      this.full(p, out);
      res.push(out);
    }
    for (let i = 0; i < last; i++) this.release(res[i]);
    return res[last];
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
