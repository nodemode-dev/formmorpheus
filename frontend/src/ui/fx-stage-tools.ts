// Stage tools of the Key and Radial Blur effects: an eyedropper that reads the colour of the selected content's
// own picture (no effects on it, so a keyed pixel can still be picked), and a draggable centre handle for a Radial
// Blur lane. Both write lane keys at the Playhead like the Action menu does (one undo step per gesture).
import type { Engine } from '../engine/engine';
import type { Renderer, View } from '../engine/render';
import { laneOf } from '../engine/keys';
import * as keyOps from '../engine/key-ops';
import * as ops from '../engine/ops';
import type { Content, KeyKind, Movie } from '../engine/types';
import { ensureLane, newKeyState } from './action-menu';
import type { StageNav } from './stage-nav';
import { el, setClass } from './dom';
import '../styles/fx-stage.css';

const RADIAL: KeyKind = 'fx:radblur';
const KEY: KeyKind = 'fx:chromakey';

/** The one tools instance of the Stage (the Action menu's eyedropper button reaches it through here). */
export const fxStageTools: { current: FxStageTools | null } = { current: null };

export class FxStageTools {
  private readonly svg: SVGSVGElement;
  private readonly dot: SVGElement;
  private view: View | null = null;
  private box = '';
  private pointer = -1;
  private tag = '';
  private picking: ((rgb: [number, number, number]) => void) | null = null;
  private readonly onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') this.cancel(); };

  constructor(private readonly root: HTMLElement, space: HTMLElement, private readonly engine: Engine, private readonly renderer: Renderer, private readonly nav: StageNav) {
    this.svg = el('<svg class="fm-fx-ov" hidden aria-label="Radial blur center"><line class="fm-fx-h"/><line class="fm-fx-v"/><circle class="fm-fx-ring" r="11"/><circle class="fm-fx-dot" r="4"/></svg>') as unknown as SVGSVGElement;
    this.dot = this.svg.querySelector('.fm-fx-ring') as SVGElement;
    space.appendChild(this.svg);
    this.dot.addEventListener('pointerdown', (e) => this.down(e as PointerEvent));
    this.dot.addEventListener('pointermove', (e) => this.move(e as PointerEvent));
    this.dot.addEventListener('pointerup', (e) => this.up(e as PointerEvent));
    this.dot.addEventListener('pointercancel', (e) => this.up(e as PointerEvent));
    root.addEventListener('pointerdown', (e) => this.pickDown(e), true);
    fxStageTools.current = this;
  }

  get isPicking(): boolean { return this.picking !== null; }

  /** The next click on the Stage reads the selected content's colour there; `done` gets it as 0..1 channels. */
  pick(done: (rgb: [number, number, number]) => void): void {
    this.picking = done;
    setClass(this.root, 'fm-fx-picking', true);
    window.addEventListener('keydown', this.onKey);
  }

  cancel(): void {
    if (!this.picking) return;
    this.picking = null;
    setClass(this.root, 'fm-fx-picking', false);
    window.removeEventListener('keydown', this.onKey);
  }

  /** Places the centre handle for this Stage draw (null view: hidden). */
  sync(view: View | null, sel: Content[]): void {
    const m = this.engine.movie, c = sel.length === 1 ? sel[0] : null;
    const lane = c ? laneOf(c, RADIAL) : null;
    if (!m || !view || !c || !lane || !this.engine.isOver(c)) { if (!this.svg.hasAttribute('hidden')) this.svg.setAttribute('hidden', ''); this.view = null; return; }
    this.view = view;
    this.svg.removeAttribute('hidden');
    const box = `0 0 ${view.width} ${view.height}`;
    if (box !== this.box) { this.svg.setAttribute('viewBox', box); this.box = box; }
    const v = valuesAt(c, this.engine.frame - c.start);
    const x = view.ox + (m.width / 2 + v.centerX) * view.scale, y = view.oy + (m.height / 2 + v.centerY) * view.scale;
    const set = (n: string, a: Record<string, string>): void => { const t = this.svg.querySelector(n) as SVGElement; for (const k in a) t.setAttribute(k, a[k]); };
    const f = (n: number): string => n.toFixed(1);
    set('.fm-fx-ring', { cx: f(x), cy: f(y) });
    set('.fm-fx-dot', { cx: f(x), cy: f(y) });
    set('.fm-fx-h', { x1: f(x - 18), x2: f(x + 18), y1: f(y), y2: f(y) });
    set('.fm-fx-v', { y1: f(y - 18), y2: f(y + 18), x1: f(x), x2: f(x) });
  }

  private movieXY(e: { clientX: number; clientY: number }): [number, number] | null {
    const m = this.engine.movie;
    if (!m) return null;
    const v = this.nav.view(m, 1), [lx, ly] = this.nav.local(e);
    return [(lx - v.ox) / v.scale, (ly - v.oy) / v.scale];
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 || !this.view) return;
    this.tag = `fx-center-${Date.now()}`;
    this.engine.stop();
    this.dot.setPointerCapture(e.pointerId);
    this.pointer = e.pointerId;
    e.preventDefault();
    e.stopPropagation();
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointer) return;
    const m = this.engine.movie, c = this.engine.selected[0], p = this.movieXY(e);
    if (!m || !c || !p) return;
    const vals = { centerX: Math.round(p[0] - m.width / 2), centerY: Math.round(p[1] - m.height / 2) };
    const local = this.engine.frame - c.start, ease = newKeyState().lastEase;
    this.engine.run('Radial Blur keyframe', (mv) => ops.updateContent(mv, c.id, (cc) => keyOps.setKeys(laneOf(cc, RADIAL) ? cc : ensureLane(cc, RADIAL, local, mv.addKeyAtStart, ease), RADIAL, local, vals)), this.tag);
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.pointer) return;
    this.pointer = -1;
    this.engine.endGesture();
    try { this.dot.releasePointerCapture(e.pointerId); } catch { /* released */ }
  }

  private pickDown(e: PointerEvent): void {
    const done = this.picking;
    if (!done) return;
    e.preventDefault();
    e.stopPropagation();
    const c = this.engine.selected.length === 1 ? this.engine.selected[0] : null;
    const p = this.movieXY(e);
    this.cancel();
    const m = this.engine.movie;
    if (!c || !p || !m) return;
    const rgb = this.sample(m, c, p[0], p[1]);
    if (rgb) done(rgb);
  }

  /** The colour of the content's own picture at a movie position: the content alone (its transform, parents and camera, none of its effects), a 5 by 5 average. */
  private sample(m: Movie, c: Content, mx: number, my: number): [number, number, number] | null {
    if (!m.tracks.some((t) => t.content.some((x) => x.id === c.id))) return null;
    const clean: Content = { ...c, keys: (c.keys ?? []).filter((l) => !l.kind.startsWith('fx:')), mask: 'none', blend: 'normal', opacity: 1 };
    const solo: Movie = { ...m, transparent: true, tracks: m.tracks.map((t) => (t.content.some((x) => x.id === c.id) ? { ...t, hidden: false, content: t.content.map((x) => (x.id === c.id ? clean : x)) } : { ...t, hidden: true })) };
    const k = Math.min(1, 1600 / Math.max(m.width, m.height));
    const w = Math.max(1, Math.round(m.width * k)), h = Math.max(1, Math.round(m.height * k));
    const cv = new OffscreenCanvas(w, h), cx = cv.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    this.renderer.drawFrame(cx, solo, Math.min(this.engine.frame, m.duration - 1), { scale: k, ox: 0, oy: 0, width: w, height: h }, { backstage: false, background: '#000', transparentChecker: null, keepAlpha: true, exact: true });
    const px = Math.round(mx * k), py = Math.round(my * k);
    if (px < 0 || py < 0 || px >= w || py >= h) return null;
    const x0 = Math.max(0, px - 2), y0 = Math.max(0, py - 2), x1 = Math.min(w, px + 3), y1 = Math.min(h, py + 3);
    const d = cx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { const al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; }
    return a > 0 ? [r / a / 255, g / a / 255, b / a / 255] : null;
  }
}

function valuesAt(c: Content, local: number): { centerX: number; centerY: number } {
  const lane = laneOf(c, RADIAL);
  const at = (id: string): number => {
    const ks = lane?.channels[id];
    if (!ks || !ks.length) return 0;
    let v = ks[0].value;
    for (const k of ks) if (k.frame <= local) v = k.value;
    return v;
  };
  return { centerX: at('centerX'), centerY: at('centerY') };
}

/** The eyedropper button beside the key colour swatch: click it, then click the Stage (Escape cancels). */
export function eyedropButton(engine: Engine, label: string): HTMLButtonElement {
  const b = el<HTMLButtonElement>('<button class="fm-kc-pickbtn" type="button"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5l4 4M16 4a2.1 2.1 0 0 1 3 3l-2 2-3-3zM13.5 8l-8 8L4.5 19.5 8 18.5l8-8"/></svg></button>');
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', () => {
    const t = fxStageTools.current;
    if (!t) return;
    if (t.isPicking) { t.cancel(); setClass(b, 'is-on', false); return; }
    setClass(b, 'is-on', true);
    t.pick((rgb) => { setClass(b, 'is-on', false); writeKeyColor(engine, rgb); });
    window.addEventListener('pointerdown', () => setClass(b, 'is-on', false), { once: true, capture: false });
  });
  return b;
}

/** Writes a picked key colour to the chroma lane of the selected content at the Playhead. */
export function writeKeyColor(engine: Engine, rgb: [number, number, number]): void {
  const c = engine.selected.length === 1 ? engine.selected[0] : null;
  if (!c) return;
  const local = engine.frame - c.start, ease = newKeyState().lastEase;
  const vals = { keyR: rgb[0], keyG: rgb[1], keyB: rgb[2] };
  engine.run('Chroma Key keyframe', (mv) => ops.updateContent(mv, c.id, (cc) => keyOps.setKeys(laneOf(cc, KEY) ? cc : ensureLane(cc, KEY, local, mv.addKeyAtStart, ease), KEY, local, vals)));
}
