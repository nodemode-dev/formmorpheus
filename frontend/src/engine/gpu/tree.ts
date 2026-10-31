// Layer trees (groups, group and layer masks, clipping) and Flipbook row masks on the GPU compositor.
// Same structure as paint/layer-tree.ts (drawTree) and engine/flip-draw.ts (drawMaskedRows): a group renders
// its children on a native-size surface of its own, clipped layers are laid on with source-atop, a mask scales
// by its value, and the result is placed under the content matrix. No DOM.
import { flipIndexAt } from '../model';
import { isClipRow, isMaskRow } from '../flip-draw';
import type { BlendMode, CanvasRect, Content, DrawingLayer } from '../types';
import { FS_COPY, HEAD } from './shaders';
import type { Mat, Surf } from './compositor';
import type { TexSource } from './textures';

/** Quad mode: the source drawn atop what is there (colour times the backdrop's alpha), keeping the backdrop's alpha. */
export const ATOP = -1;

/** Scales the target by a mask value read from a surface or a mask picture (blend ZERO, SRC_COLOR). Kinds: 0 alpha, 1 luminance, 2 a greyscale picture (its red over its alpha). */
export const FS_TMASK = `${HEAD}
uniform sampler2D uMask;
uniform vec2 uSize;
uniform int uKind;
uniform int uInvert;
uniform float uScale;
out vec4 o;
void main() {
  vec4 m = texture(uMask, gl_FragCoord.xy / uSize);
  float v = uKind == 1 ? dot(m.rgb, vec3(0.299, 0.587, 0.114)) : uKind == 2 ? (m.a > 0.0 ? m.r / m.a : 0.0) : m.a;
  v = clamp(v * uScale, 0.0, 1.0);
  if (uInvert == 1) v = 1.0 - v;
  o = vec4(v);
}`;

/** What the compositor lends the tree drawer. */
export interface TreeOps {
  gl: WebGL2RenderingContext;
  /** Size of the surfaces content is composed on (the view). */
  view(): { w: number; h: number };
  /** A cleared surface of this size. */
  acquire(w: number, h: number): Surf;
  release(s: Surf): void;
  quad(target: Surf, tex: WebGLTexture, m: Mat, rx: number, ry: number, rw: number, rh: number, alpha: number, mode: number): void;
  mode(b: BlendMode): number;
  tex(key: string, src: TexSource): WebGLTexture | null;
  /** Draws a plain layer list (or a tree, when it holds one) like content('drawing') does. */
  layers(bitmap: Bitmap, target: Surf, layers: DrawingLayer[], m: Mat, rect: CanvasRect, alpha: number, mode: number): void;
  /** One full-target pass of a program; `multiply` blends ZERO, SRC_COLOR. */
  run(name: string, fs: string, target: Surf, multiply: boolean, setup: (loc: (n: string) => WebGLUniformLocation | null, bind: (unit: number, tex: WebGLTexture) => void) => void): void;
}

type Bitmap = (id: string | null) => ImageBitmap | null;

const IDENT: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const solid = (b: BlendMode): boolean => b === 'normal' || b === 'passthrough';

export class GpuTree {
  constructor(private readonly o: TreeOps) {}

  /** Target colour times a mask: kind 0 alpha, 1 luminance, 2 mask picture; `scale` multiplies the value before an inversion. */
  mask(target: Surf, tex: WebGLTexture, kind: number, invert: boolean, scale: number): void {
    const gl = this.o.gl;
    this.o.run('tmask', FS_TMASK, target, true, (loc, bind) => {
      bind(0, tex);
      gl.uniform1i(loc('uMask'), 0);
      gl.uniform1i(loc('uKind'), kind);
      gl.uniform1i(loc('uInvert'), invert ? 1 : 0);
      gl.uniform1f(loc('uScale'), scale);
    });
  }

  private copy(dst: Surf, src: Surf): void {
    const gl = this.o.gl;
    this.o.run('copy', FS_COPY, dst, false, (loc, bind) => { bind(0, src.tex); gl.uniform1i(loc('uTex'), 0); });
  }

  /** A Drawing's layer list with groups, masks or clipping: `m` places the canvas rect on `target`; alpha and mode are the base, as for the plain loop. */
  draw(bitmap: Bitmap, target: Surf, layers: DrawingLayer[], m: Mat, rect: CanvasRect, alpha: number, mode: number): void {
    const o = this.o;
    const W = Math.max(1, Math.round(rect.w)), H = Math.max(1, Math.round(rect.h));
    const mT = mul(m, [1, 0, 0, 1, rect.x, rect.y]);
    const ids = new Set<string>();
    for (const l of layers) ids.add(l.id);
    const kids = new Map<string | null, DrawingLayer[]>();
    for (const l of layers) {
      const p = l.parent && ids.has(l.parent) && l.parent !== l.id ? l.parent : null;
      const list = kids.get(p);
      if (list) list.push(l); else kids.set(p, [l]);
    }
    const ready = (l: DrawingLayer): boolean => !l.mask || l.maskOn === false || !!bitmap(l.mask);
    const maskTex = (l: DrawingLayer): WebGLTexture | null => {
      if (!l.mask || l.maskOn === false) return null;
      const b = bitmap(l.mask);
      return b ? o.tex('b:' + l.mask, b) : null;
    };
    const imgTex = (l: DrawingLayer): WebGLTexture | null => {
      if (l.group) return null;
      const b = bitmap(l.pixels);
      return b ? o.tex('b:' + l.pixels, b) : null;
    };
    const modeOf = (l: DrawingLayer, base: number): number => (solid(l.blend) ? base : o.mode(l.blend));

    const clipOnto = (s: Surf, c: DrawingLayer): void => {
      const t = imgTex(c);
      if (!t || !ready(c)) return;
      let src = t;
      let tmp: Surf | null = null;
      const mk = maskTex(c);
      if (mk) {
        tmp = o.acquire(W, H);
        o.quad(tmp, t, IDENT, 0, 0, W, H, 1, 0);
        this.mask(tmp, mk, 2, false, 1);
        src = tmp.tex;
      }
      if (solid(c.blend)) o.quad(s, src, IDENT, 0, 0, W, H, c.opacity, ATOP);
      else {
        // blended into a copy, then laid over the base only where the base has alpha
        const s2 = o.acquire(W, H);
        this.copy(s2, s);
        o.quad(s2, src, IDENT, 0, 0, W, H, c.opacity, o.mode(c.blend));
        o.quad(s, s2.tex, IDENT, 0, 0, W, H, 1, ATOP);
        o.release(s2);
      }
      if (tmp) o.release(tmp);
    };

    const finish = (tg: Surf, mt: Mat, s: Surf, clipped: DrawingLayer[], mk: WebGLTexture | null, a: number, bmode: number): void => {
      for (const c of clipped) clipOnto(s, c);
      if (mk) this.mask(s, mk, 2, false, 1);
      o.quad(tg, s.tex, mt, 0, 0, W, H, a, bmode);
      o.release(s);
    };

    const level = (tg: Surf, mt: Mat, parent: string | null, alpha1: number, base: number): void => {
      const L = kids.get(parent);
      if (!L) return;
      let i = L.length - 1;
      while (i >= 0) {
        const b = L[i];
        let j = i - 1;
        while (j >= 0 && L[j].clipping && !L[j].group) j--;
        const next = j;
        if (b.visible && (b.opacity > 0 || b.group)) {
          const clipped: DrawingLayer[] = [];
          for (let k = i - 1; k > j; k--) if (L[k].visible && !L[k].group) clipped.push(L[k]);
          const ok = ready(b);
          const mk = ok ? maskTex(b) : null;
          const a = alpha1 * b.opacity;
          const bmode = modeOf(b, base);
          if (b.group) {
            if (b.blend === 'passthrough' && b.opacity >= 0.999 && !mk && !clipped.length) level(tg, mt, b.id, alpha1, base);
            else if (ok && a > 0) {
              const s = o.acquire(W, H);
              level(s, IDENT, b.id, 1, 0);
              finish(tg, mt, s, clipped, mk, a, bmode);
            }
          } else if (b.opacity > 0 && ok) {
            const t = imgTex(b);
            if (t) {
              if (!clipped.length && !mk) o.quad(tg, t, mt, 0, 0, W, H, a, bmode);
              else if (a > 0) {
                const s = o.acquire(W, H);
                o.quad(s, t, IDENT, 0, 0, W, H, 1, 0);
                finish(tg, mt, s, clipped, mk, a, bmode);
              }
            }
          }
        }
        i = next;
      }
    };
    level(target, mT, null, alpha, mode);
  }

  /** Flipbook rows as drawMaskedRows draws them: each row on a view-size surface, a mask row cuts the row held below it, a clipping row keeps only where it has pixels. */
  rows(bitmap: Bitmap, target: Surf, c: Content, f: number, m: Mat, rect: CanvasRect, alpha: number, mode: number): void {
    const o = this.o;
    const { w, h } = o.view();
    let held: { s: Surf; opacity: number; blend: BlendMode } | null = null;
    const commit = (): void => {
      if (!held) return;
      o.quad(target, held.s.tex, IDENT, 0, 0, w, h, alpha * held.opacity, solid(held.blend) ? mode : o.mode(held.blend));
      o.release(held.s);
      held = null;
    };
    for (let i = c.flip.length - 1; i >= 0; i--) {
      const t = c.flip[i];
      if (t.hidden) continue;
      const fi = flipIndexAt(t, f);
      if (fi < 0) {
        // a mask row with nothing to show is an empty mask: it hides the row below (inverted, it leaves it whole)
        if (isMaskRow(t) && held && !t.maskInvert) { o.release((held as { s: Surf }).s); held = null; }
        continue;
      }
      const s = o.acquire(w, h);
      o.layers(bitmap, s, t.frames[fi].layers, m, rect, 1, 0);
      if (isMaskRow(t) && held) {
        this.mask((held as { s: Surf }).s, s.tex, t.mask === 'luminance' ? 1 : 0, !!t.maskInvert, Math.max(0, Math.min(1, t.opacity)));
        o.release(s);
        continue;
      }
      if (t.opacity <= 0) { o.release(s); continue; }
      if (isClipRow(t) && held) this.mask(s, (held as { s: Surf }).s.tex, 0, false, 1);
      commit();
      held = { s, opacity: t.opacity, blend: t.blend };
    }
    commit();
  }
}
