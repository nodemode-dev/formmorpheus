// Stage guides drawn over the Stage: grid, rule of thirds, title / action / vertical safe areas and guide lines,
// plus the rulers a guide line is dragged from. Drawing aids only: nothing here reaches an exported picture.
// Built once; every update sets attributes on pooled elements (no subtree is rebuilt).
import type { Engine } from '../engine/engine';
import { GRID_DEFAULT, SAFE_ACTION, SAFE_TITLE, anyGuide, gridAxis, insetRect, verticalRect, type GuideLine, type Guides, type Inset } from '../engine/guides';
import * as ops from '../engine/ops';
import type { View } from '../engine/render';
import { el, setHidden } from './dom';
import '../styles/stage-guides.css';

const NS = 'http://www.w3.org/2000/svg';
const RULER = 18;
const FAR = 6000;

interface Hooks {
  /** Pointer position in Stage space. */
  local(e: { clientX: number; clientY: number }): [number, number];
  /** The Stage view is turned: the rulers (which follow the window edges) rest. */
  turned(): boolean;
}

interface Pooled { g: SVGGElement; vis: SVGLineElement; hit: SVGLineElement }

function svgEl<T extends SVGElement>(tag: string, cls: string): T {
  const n = document.createElementNS(NS, tag) as T;
  n.setAttribute('class', cls);
  return n;
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

export class StageGuides {
  readonly root: SVGSVGElement;
  private readonly major = svgEl<SVGPathElement>('path', 'fm-gd-grid');
  private readonly minor = svgEl<SVGPathElement>('path', 'fm-gd-grid is-minor');
  private readonly thirds = svgEl<SVGPathElement>('path', 'fm-gd-thirds');
  private readonly rects = { title: svgEl<SVGRectElement>('rect', 'fm-gd-safe is-title'), action: svgEl<SVGRectElement>('rect', 'fm-gd-safe is-action'), vertical: svgEl<SVGRectElement>('rect', 'fm-gd-safe is-vertical') };
  private readonly lineLayer = svgEl<SVGGElement>('g', 'fm-gd-lines');
  private readonly pool: Pooled[] = [];
  private readonly rulerTop = el<HTMLCanvasElement>('<canvas class="fm-gd-ruler is-top" hidden></canvas>');
  private readonly rulerLeft = el<HTMLCanvasElement>('<canvas class="fm-gd-ruler is-left" hidden></canvas>');
  private view: View | null = null;
  private key = '';
  private rulerKey = '';
  private drag: { index: number; axis: 'x' | 'y'; tag: string; out: boolean } | null = null;
  private ink = '#999';

  constructor(space: HTMLElement, stageRoot: HTMLElement, private readonly engine: Engine, private readonly hooks: Hooks) {
    this.root = document.createElementNS(NS, 'svg') as SVGSVGElement;
    this.root.setAttribute('class', 'fm-gd');
    this.root.setAttribute('hidden', '');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.append(this.major, this.minor, this.thirds, this.rects.title, this.rects.action, this.rects.vertical, this.lineLayer);
    space.appendChild(this.root);
    stageRoot.append(this.rulerTop, this.rulerLeft);
    this.rulerTop.addEventListener('pointerdown', (e) => this.createFrom(e, 'y', this.rulerTop));
    this.rulerLeft.addEventListener('pointerdown', (e) => this.createFrom(e, 'x', this.rulerLeft));
    for (const r of [this.rulerTop, this.rulerLeft]) {
      r.addEventListener('pointermove', (e) => this.dragTo(e));
      r.addEventListener('pointerup', (e) => this.finish(e));
      r.addEventListener('pointercancel', (e) => this.finish(e));
    }
  }

  private get guides(): Guides | undefined { return this.engine.movie?.guides; }

  /** Updates what is drawn for the Stage view (null or `preview`: nothing). */
  sync(view: View | null, preview: boolean): void {
    this.view = view;
    const m = this.engine.movie, g = m?.guides;
    const draw = !!m && !!view && !preview && anyGuide(g);
    this.root.toggleAttribute('hidden', !draw);
    const rulers = !!m && !!view && !preview && !!g?.rulers && !this.hooks.turned();
    setHidden(this.rulerTop, !rulers);
    setHidden(this.rulerLeft, !rulers);
    if (!m || !view) return;
    if (draw && g) this.paint(m.width, m.height, view, g);
    if (rulers) this.paintRulers(m.width, m.height, view);
  }

  private paint(w: number, h: number, v: View, g: Guides): void {
    const key = JSON.stringify([w, h, v.ox, v.oy, v.scale, g]);
    if (key === this.key) return;
    this.key = key;
    const s = v.scale, x0 = v.ox, y0 = v.oy, x1 = v.ox + w * s, y1 = v.oy + h * s;
    const lines = (xs: number[], ys: number[]): string => xs.map((x) => `M${(x0 + x * s).toFixed(1)} ${y0.toFixed(1)}V${y1.toFixed(1)}`).join('') + ys.map((y) => `M${x0.toFixed(1)} ${(y0 + y * s).toFixed(1)}H${x1.toFixed(1)}`).join('');
    const size = g.gridSize ?? GRID_DEFAULT, div = g.gridDiv ?? 1;
    const gx = g.grid ? gridAxis(w, size, div) : { major: [], minor: [] }, gy = g.grid ? gridAxis(h, size, div) : { major: [], minor: [] };
    this.major.setAttribute('d', lines(gx.major, gy.major));
    this.minor.setAttribute('d', lines(gx.minor, gy.minor));
    this.thirds.setAttribute('d', g.thirds ? lines([w / 3, (2 * w) / 3], [h / 3, (2 * h) / 3]) : '');
    const rect = (n: SVGRectElement, on: boolean | undefined, r: Inset): void => {
      n.toggleAttribute('hidden', !on);
      if (!on) return;
      n.setAttribute('x', (x0 + r.x0 * s).toFixed(1)); n.setAttribute('y', (y0 + r.y0 * s).toFixed(1));
      n.setAttribute('width', ((r.x1 - r.x0) * s).toFixed(1)); n.setAttribute('height', ((r.y1 - r.y0) * s).toFixed(1));
    };
    rect(this.rects.title, g.titleSafe, insetRect(w, h, SAFE_TITLE));
    rect(this.rects.action, g.actionSafe, insetRect(w, h, SAFE_ACTION));
    rect(this.rects.vertical, g.verticalSafe, verticalRect(w, h));
    const list = g.lines ?? [];
    while (this.pool.length < list.length) this.pool.push(this.makeLine(this.pool.length));
    this.pool.forEach((p, i) => {
      const l = list[i];
      p.g.toggleAttribute('hidden', !l);
      if (!l) return;
      p.g.dataset.axis = l.axis;
      const v1 = l.axis === 'x' ? x0 + l.at * s : y0 + l.at * s;
      for (const n of [p.vis, p.hit]) {
        if (l.axis === 'x') { n.setAttribute('x1', v1.toFixed(1)); n.setAttribute('x2', v1.toFixed(1)); n.setAttribute('y1', String(-FAR)); n.setAttribute('y2', String(FAR)); }
        else { n.setAttribute('y1', v1.toFixed(1)); n.setAttribute('y2', v1.toFixed(1)); n.setAttribute('x1', String(-FAR)); n.setAttribute('x2', String(FAR)); }
      }
    });
  }

  private makeLine(index: number): Pooled {
    const g = svgEl<SVGGElement>('g', 'fm-gd-line');
    const vis = svgEl<SVGLineElement>('line', 'fm-gd-vis');
    const hit = svgEl<SVGLineElement>('line', 'fm-gd-hit');
    g.append(vis, hit);
    this.lineLayer.appendChild(g);
    hit.addEventListener('pointerdown', (e) => this.grab(e, index, hit));
    hit.addEventListener('pointermove', (e) => this.dragTo(e));
    hit.addEventListener('pointerup', (e) => this.finish(e));
    hit.addEventListener('pointercancel', (e) => this.finish(e));
    hit.addEventListener('dblclick', (e) => { e.stopPropagation(); this.remove(index, `guide-del-${Date.now()}`); this.engine.endGesture(); });
    return { g, vis, hit };
  }

  // ---- editing -----------------------------------------------------------------------------

  private write(label: string, fn: (g: Guides) => Guides, tag: string): void {
    this.engine.run(label, (m) => ops.patchMovie(m, { guides: fn({ ...(m.guides ?? {}), hide: false }) }), tag);
  }

  private remove(index: number, tag: string): void {
    this.write('Remove guide', (g) => ({ ...g, lines: (g.lines ?? []).filter((_, i) => i !== index) }), tag);
  }

  private grab(e: PointerEvent, index: number, hit: SVGLineElement): void {
    const l = this.guides?.lines?.[index];
    if (!l || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    hit.setPointerCapture(e.pointerId);
    this.drag = { index, axis: l.axis, tag: `guide-${Date.now()}`, out: false };
  }

  /** A press on a ruler makes a new guide line under the pointer and carries on as a drag. */
  private createFrom(e: PointerEvent, axis: 'x' | 'y', ruler: HTMLElement): void {
    if (e.button !== 0 || !this.view) return;
    e.stopPropagation();
    e.preventDefault();
    ruler.setPointerCapture(e.pointerId);
    const at = this.atOf(e, axis);
    const tag = `guide-${Date.now()}`;
    let index = 0;
    this.write('Add guide', (g) => { const lines = [...(g.lines ?? []), { axis, at } as GuideLine]; index = lines.length - 1; return { ...g, lines }; }, tag);
    this.drag = { index, axis, tag, out: false };
  }

  private atOf(e: { clientX: number; clientY: number }, axis: 'x' | 'y'): number {
    const v = this.view as View, [lx, ly] = this.hooks.local(e);
    return Math.round(axis === 'x' ? (lx - v.ox) / v.scale : (ly - v.oy) / v.scale);
  }

  private dragTo(e: PointerEvent): void {
    const d = this.drag, m = this.engine.movie;
    if (!d || !m || !this.view) return;
    const at = this.atOf(e, d.axis), len = d.axis === 'x' ? m.width : m.height;
    // pulled well outside the frame (or back onto a ruler): the guide goes when released
    d.out = at < -len * 0.02 || at > len * 1.02;
    if (d.out) return;
    this.write('Move guide', (g) => ({ ...g, lines: (g.lines ?? []).map((l, i) => (i === d.index ? { ...l, at } : l)) }), d.tag);
  }

  private finish(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const el0 = e.currentTarget as Element | null;
    try { el0?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (d.out) this.remove(d.index, d.tag);
    this.engine.endGesture();
  }

  // ---- rulers ------------------------------------------------------------------------------

  private paintRulers(w: number, h: number, v: View): void {
    const host = this.rulerTop.parentElement;
    if (!host) return;
    const hr = host.getBoundingClientRect();
    const sp = this.root.parentElement?.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const offX = (sp ? sp.left - hr.left : 0) + v.ox, offY = (sp ? sp.top - hr.top : 0) + v.oy;
    const W = Math.max(1, Math.round(hr.width)), H = Math.max(1, Math.round(hr.height));
    const key = `${W}x${H}:${offX.toFixed(1)}:${offY.toFixed(1)}:${v.scale.toFixed(5)}:${w}:${h}:${dpr}`;
    if (key === this.rulerKey) return;
    this.rulerKey = key;
    this.ink = getComputedStyle(host).getPropertyValue('--text-secondary').trim() || '#999';
    const step = STEPS.find((n) => n * v.scale >= 60) ?? 5000;
    const draw = (cv: HTMLCanvasElement, len: number, off: number, extent: number, across: boolean): void => {
      const cw = across ? len : RULER, ch = across ? RULER : len;
      if (cv.width !== Math.round(cw * dpr)) cv.width = Math.round(cw * dpr);
      if (cv.height !== Math.round(ch * dpr)) cv.height = Math.round(ch * dpr);
      cv.style.width = `${cw}px`; cv.style.height = `${ch}px`;
      const c = cv.getContext('2d') as CanvasRenderingContext2D;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, cw, ch);
      c.fillStyle = 'rgba(20,20,24,0.86)';
      c.fillRect(0, 0, cw, ch);
      c.strokeStyle = this.ink; c.fillStyle = this.ink; c.lineWidth = 1; c.font = '9px system-ui, sans-serif';
      c.beginPath();
      const first = Math.floor(-off / v.scale / step) * step;
      for (let p = first; p <= extent + step; p += step) {
        const pos = Math.round(off + p * v.scale) + 0.5;
        if (pos < 0 || pos > len) continue;
        for (let i = 0; i < 5; i++) {
          const q2 = Math.round(off + (p + (step * i) / 5) * v.scale) + 0.5;
          if (q2 < 0 || q2 > len) continue;
          const tick = i === 0 ? RULER - 1 : i === 2 || i === 3 ? 4 : 3;
          if (across) { c.moveTo(q2, ch); c.lineTo(q2, ch - tick); } else { c.moveTo(cw, q2); c.lineTo(cw - tick, q2); }
        }
        if (across) c.fillText(String(p), pos + 3, 9); else { c.save(); c.translate(9, pos + 3); c.rotate(-Math.PI / 2); c.fillText(String(p), -(String(p).length * 5), 0); c.restore(); }
      }
      c.stroke();
    };
    draw(this.rulerTop, W, offX, w, true);
    draw(this.rulerLeft, H, offY, h, false);
  }

  /** The rulers and lines go when the Stage is rebuilt. */
  clearKey(): void { this.key = ''; this.rulerKey = ''; }
}
