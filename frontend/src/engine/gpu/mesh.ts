// Textured triangle meshes on the GPU: Warp, Distort and Bones. The compositor draws the content flat into a
// surface, then this re-projects it through the same triangle list the CPU raster uses (warp-draw.ts drawTriangles):
// every shared edge pushed out 0.75 px (so neighbours overlap, no seams), outline edges antialiased, later
// triangles overwriting earlier ones (never blending twice on a translucent picture). One draw per mesh.
// No DOM.
import { memory } from '../../platform/ipad-memory';
import { HEAD } from './shaders';

type Mat = [number, number, number, number, number, number];

/** Largest side and area (pixels) of the flat surface; the same caps as render.ts flatScale. */
const FLAT_SIDE = 8192;

/** Pixels per movie pixel of the flat surface for a view scale (lowered only when the surface would pass the caps). */
export function flatScaleOf(movieW: number, movieH: number, scale: number, maxSide = FLAT_SIDE): number {
  const w = Math.max(1, movieW * scale), h = Math.max(1, movieH * scale);
  // the surface also has to fit the driver's own texture limit
  const k = Math.min(1, Math.min(FLAT_SIDE, maxSide) / Math.max(w, h), Math.sqrt(memory.get('flatArea') / (w * h)));
  return scale * k;
}

const GROW = 0.75;
const FLOATS = 10;

const VS = `${HEAD}
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec3 aDist;
layout(location = 3) in vec3 aGrow;
uniform vec2 uSize;
out vec2 vUv;
out vec3 vDist;
flat out vec3 vGrow;
void main() {
  vUv = aUv;
  vDist = aDist;
  vGrow = aGrow;
  gl_Position = vec4(aPos / uSize * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `${HEAD}
in vec2 vUv;
in vec3 vDist;
flat in vec3 vGrow;
uniform sampler2D uTex;
uniform vec2 uTexSize;
out vec4 o;
void main() {
  float cov = 1.0;
  for (int i = 0; i < 3; i++) {
    float d = vDist[i];
    if (vGrow[i] > 0.0) { if (d + vGrow[i] < 0.0) discard; }
    else cov = min(cov, clamp(d + 0.5, 0.0, 1.0));
  }
  if (cov <= 0.0) discard;
  // nothing is drawn past the flat picture (the CPU raster samples only inside it), so a pushed-out corner does not smear the edge texel
  vec2 t = vUv * uTexSize;
  vec2 inside = clamp(t + 0.5, 0.0, 1.0) * clamp(uTexSize - t + 0.5, 0.0, 1.0);
  o = texture(uTex, vUv) * (cov * inside.x * inside.y);
}`;

export interface MeshTarget { fbo: WebGLFramebuffer; w: number; h: number }
export interface MeshSource { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }

const edgeUse = new Map<number, number>();
const vq = (x: number, y: number): number => (Math.imul(Math.round(x * 16), 73856093) ^ Math.imul(Math.round(y * 16), 19349663)) >>> 6;
const edgeKey = (ax: number, ay: number, bx: number, by: number): number => {
  const a = vq(ax, ay), b = vq(bx, by);
  return a < b ? a * 67108864 + b : b * 67108864 + a;
};

export class MeshDrawer {
  private prog: WebGLProgram | null = null;
  private locSize: WebGLUniformLocation | null = null;
  private locTex: WebGLUniformLocation | null = null;
  private locTexSize: WebGLUniformLocation | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buf: WebGLBuffer | null = null;
  private cap = 0;
  private data = new Float32Array(0);
  private readonly samplers: Record<'nearest' | 'linear' | 'high', WebGLSampler | null> = { nearest: null, linear: null, high: null };
  private mip: { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number; levels: number } | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  private setup(): void {
    const gl = this.gl;
    const mk = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`mesh shader: ${gl.getShaderInfoLog(s) ?? ''}`);
      return s;
    };
    const p = gl.createProgram() as WebGLProgram;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`mesh program: ${gl.getProgramInfoLog(p) ?? ''}`);
    this.prog = p;
    this.locSize = gl.getUniformLocation(p, 'uSize');
    this.locTex = gl.getUniformLocation(p, 'uTex');
    this.locTexSize = gl.getUniformLocation(p, 'uTexSize');
    this.vao = gl.createVertexArray();
    this.buf = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = FLOATS * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 28);
    const sm = (min: number, mag: number): WebGLSampler => {
      const s = gl.createSampler() as WebGLSampler;
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, min);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, mag);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return s;
    };
    this.samplers.nearest = sm(gl.NEAREST, gl.NEAREST);
    this.samplers.linear = sm(gl.LINEAR, gl.LINEAR);
    this.samplers.high = sm(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
  }

  /** Mipmapped copy of `src` for the High quality sampler (the surfaces themselves have one level). */
  private mipOf(src: MeshSource): WebGLTexture {
    const gl = this.gl;
    const levels = Math.floor(Math.log2(Math.max(src.w, src.h))) + 1;
    let m = this.mip;
    if (!m || m.w !== src.w || m.h !== src.h) {
      if (m) { gl.deleteFramebuffer(m.fbo); gl.deleteTexture(m.tex); }
      const tex = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, src.w, src.h);
      const fbo = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      m = this.mip = { tex, fbo, w: src.w, h: src.h, levels };
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, m.fbo);
    gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, src.w, src.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, m.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    return m.tex;
  }

  dispose(): void {
    // the context is going away or was lost: everything made here goes with it
    this.prog = null; this.vao = null; this.buf = null; this.cap = 0; this.mip = null;
    this.samplers.nearest = this.samplers.linear = this.samplers.high = null;
  }

  /**
   * Draws the triangle list `t` (warpQuads layout: source corners in content px, destination corners in Stage px)
   * from `src` onto `target`. `ks`: source pixels per content pixel. `m`: Stage px to target px.
   * `target` must be cleared by the caller (the triangles overwrite, they do not blend).
   */
  draw(target: MeshTarget, src: MeshSource, t: Float32Array, ks: number, m: Mat, resample: 'nearest' | 'high' | undefined): void {
    const n = Math.floor(t.length / 12);
    if (n <= 0) return;
    const gl = this.gl;
    if (!this.prog) this.setup();
    if (this.cap < n * 3 * FLOATS) {
      this.cap = Math.max(n * 3 * FLOATS, this.cap * 2);
      this.data = new Float32Array(this.cap);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    }
    const out = this.data;
    const tw = src.w, th = src.h;
    // destination corners in target pixels, and how many triangles share each edge
    edgeUse.clear();
    const mapped = new Float64Array(n * 6);
    for (let i = 0; i < n; i++) {
      const p = i * 12;
      for (let k = 0; k < 3; k++) {
        const x = t[p + 6 + k * 2], y = t[p + 7 + k * 2];
        mapped[i * 6 + k * 2] = m[0] * x + m[2] * y + m[4];
        mapped[i * 6 + k * 2 + 1] = m[1] * x + m[3] * y + m[5];
      }
      for (let k = 0; k < 3; k++) {
        const j = (k + 1) % 3;
        const key = edgeKey(mapped[i * 6 + k * 2], mapped[i * 6 + k * 2 + 1], mapped[i * 6 + j * 2], mapped[i * 6 + j * 2 + 1]);
        edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
      }
    }
    let used = 0;
    for (let i = 0; i < n; i++) {
      const p = i * 12, q = i * 6;
      const d0x = mapped[q], d0y = mapped[q + 1], d1x = mapped[q + 2], d1y = mapped[q + 3], d2x = mapped[q + 4], d2y = mapped[q + 5];
      const s0x = t[p] * ks, s0y = t[p + 1] * ks, s1x = t[p + 2] * ks, s1y = t[p + 3] * ks, s2x = t[p + 4] * ks, s2y = t[p + 5] * ks;
      const det = (d1x - d0x) * (d2y - d0y) - (d2x - d0x) * (d1y - d0y);
      if (!(Math.abs(det) > 1e-9)) continue;
      const sdet = (s1x - s0x) * (s2y - s0y) - (s2x - s0x) * (s1y - s0y);
      if (!(Math.abs(sdet) > 1e-9)) continue;
      const sg = det < 0 ? -1 : 1;
      const e01 = Math.hypot(d1x - d0x, d1y - d0y) || 1, e12 = Math.hypot(d2x - d1x, d2y - d1y) || 1, e20 = Math.hypot(d0x - d2x, d0y - d2y) || 1;
      // outward unit normals of the edges 0-1, 1-2, 2-0
      const n01x = sg * (d1y - d0y) / e01, n01y = -sg * (d1x - d0x) / e01;
      const n12x = sg * (d2y - d1y) / e12, n12y = -sg * (d2x - d1x) / e12;
      const n20x = sg * (d0y - d2y) / e20, n20y = -sg * (d0x - d2x) / e20;
      const sh = (ax: number, ay: number, bx: number, by: number): number => ((edgeUse.get(edgeKey(ax, ay, bx, by)) ?? 2) > 1 ? GROW : 0);
      const g01 = sh(d0x, d0y, d1x, d1y), g12 = sh(d1x, d1y, d2x, d2y), g20 = sh(d2x, d2y, d0x, d0y);
      const miter = (ax: number, ay: number, ga: number, bx: number, by: number, gb: number): [number, number] => {
        const c = ax * bx + ay * by;
        if (ga === gb) {
          const qq = Math.max(0.25, 1 + c);
          return [((ax + bx) * ga) / qq, ((ay + by) * ga) / qq];
        }
        const s = Math.max(0.1, 1 - c * c), u = ga - c * gb, v = gb - c * ga;
        return [(ax * u + bx * v) / s, (ay * u + by * v) / s];
      };
      const m0 = miter(n20x, n20y, g20, n01x, n01y, g01), m1 = miter(n01x, n01y, g01, n12x, n12y, g12), m2 = miter(n12x, n12y, g12, n20x, n20y, g20);
      // signed distances inside the original triangle: edge i runs from corner i to corner i+1, positive inside
      const h0 = sg * ((d1x - d0x) * (d2y - d0y) - (d1y - d0y) * (d2x - d0x)) / e01; // corner 2 to edge 0
      const h1 = sg * ((d2x - d1x) * (d0y - d1y) - (d2y - d1y) * (d0x - d1x)) / e12; // corner 0 to edge 1
      const h2 = sg * ((d0x - d2x) * (d1y - d2y) - (d0y - d2y) * (d1x - d2x)) / e20; // corner 1 to edge 2
      for (let v = 0; v < 3; v++) {
        const mv = v === 0 ? m0 : v === 1 ? m1 : m2;
        const px = (v === 0 ? d0x : v === 1 ? d1x : d2x) + mv[0], py = (v === 0 ? d0y : v === 1 ? d1y : d2y) + mv[1];
        const a0 = sg * ((d1x - d0x) * (py - d0y) - (d1y - d0y) * (px - d0x)) / e01;
        const a1 = sg * ((d2x - d1x) * (py - d1y) - (d2y - d1y) * (px - d1x)) / e12;
        const a2 = sg * ((d0x - d2x) * (py - d2y) - (d0y - d2y) * (px - d2x)) / e20;
        // barycentrics: corner 2 from edge 0, corner 0 from edge 1, corner 1 from edge 2
        const l2 = a0 / h0, l0 = a1 / h1, l1 = a2 / h2;
        const o = (used * 3 + v) * FLOATS;
        out[o] = px; out[o + 1] = py;
        out[o + 2] = (l0 * s0x + l1 * s1x + l2 * s2x) / tw;
        out[o + 3] = (l0 * s0y + l1 * s1y + l2 * s2y) / th;
        out[o + 4] = a0; out[o + 5] = a1; out[o + 6] = a2;
        out[o + 7] = g01; out[o + 8] = g12; out[o + 9] = g20;
      }
      used++;
    }
    if (used === 0) return;
    const mode = resample === 'nearest' ? 'nearest' : resample === 'high' ? 'high' : 'linear';
    const tex = mode === 'high' ? this.mipOf(src) : src.tex;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, out, 0, used * 3 * FLOATS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.uniform2f(this.locSize, target.w, target.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindSampler(0, this.samplers[mode]);
    gl.uniform1i(this.locTex, 0);
    gl.uniform2f(this.locTexSize, tw, th);
    gl.drawArrays(gl.TRIANGLES, 0, used * 3);
    gl.bindSampler(0, null);
    gl.bindVertexArray(null);
  }
}
