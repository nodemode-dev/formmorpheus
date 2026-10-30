// Text on the Stage: the inline editor (double-click) and the wrap-width drag on the box's side nodes.
import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import * as ops from '../engine/ops';
import type { View } from '../engine/render';
import { fontCss, layoutText } from '../engine/text-layout';
import type { Content } from '../engine/types';
import { setClass } from './dom';

/** What the Stage lends the text tools. */
export interface TextStageHooks {
  view(): View | null;
  /** Screen corners (top-left, top-right, bottom-right, bottom-left) of the text block's box. */
  corners(c: Content): Array<[number, number]>;
  /** The pointer in the content's parent space, in screen pixels. */
  point(e: { clientX: number; clientY: number }, id: string): [number, number];
  /** Where the content sits (animated in keyed modes). */
  pose(c: Content): { x: number; y: number; sx: number; sy: number; px?: number; py?: number; kx: number; ky: number; fx: 1 | -1; rot: number };
  /** Opens the style card near a screen point. */
  editStyle(id: string, x: number, y: number): void;
  focus(): void;
}

export class TextStage {
  private readonly ta = document.createElement('textarea');
  private id = '';
  private drag: { id: string; sign: 1 | -1; pointer: number; tag: string } | null = null;
  private readonly onMove = (e: PointerEvent): void => this.moveWrap(e);
  private readonly onUp = (e: PointerEvent): void => this.endWrap(e);

  constructor(space: HTMLElement, private readonly engine: Engine, private readonly hooks: TextStageHooks) {
    const ta = this.ta;
    ta.className = 'fm-ted';
    ta.hidden = true;
    ta.spellcheck = false;
    ta.setAttribute('aria-label', 'Edit text');
    ta.wrap = 'off';
    space.appendChild(ta);
    ta.addEventListener('input', () => this.push());
    ta.addEventListener('blur', () => this.stop());
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape' || (mod && e.key === 'Enter')) { e.preventDefault(); this.stop(); this.hooks.focus(); return; }
      if (mod && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.engine.endGesture(); if (e.shiftKey) this.engine.redo(); else this.engine.undo(); return; }
      if (mod && !e.altKey && e.key.toLowerCase() === 'y') { e.preventDefault(); this.engine.endGesture(); this.engine.redo(); }
    });
    ta.addEventListener('contextmenu', (e) => {
      if (e.shiftKey || !this.id) return;
      e.preventDefault();
      this.hooks.editStyle(this.id, e.clientX, e.clientY);
    });
    engine.on('movie', () => this.pull());
  }

  get editing(): string { return this.id; }

  /** Starts editing; the whole text is selected so typing replaces it. */
  start(id: string, selectAll = true): void {
    const at = this.engine.movie ? locate(this.engine.movie, id) : null;
    if (!at || at.content.kind !== 'text' || !at.content.text) return;
    this.id = id;
    this.ta.hidden = false;
    this.ta.value = at.content.text.text;
    this.place();
    this.ta.focus({ preventScroll: true });
    if (selectAll) this.ta.select(); else this.ta.setSelectionRange(this.ta.value.length, this.ta.value.length);
  }

  stop(): void {
    if (!this.id) return;
    this.id = '';
    this.engine.endGesture();
    this.ta.hidden = true;
  }

  /** The typed text goes into the movie as one merged undo step. */
  private push(): void {
    const id = this.id;
    if (!id) return;
    const value = this.ta.value;
    this.engine.run('Edit Text', (m) => ops.updateContent(m, id, (c) => {
      if (!c.text) return c;
      return { ...c, name: value.split('\n')[0].slice(0, 40) || c.name, text: { ...c.text, text: value } };
    }), `text-${id}-text`);
  }

  /** An undo, redo or the style card changed the movie: the editor follows. */
  private pull(): void {
    if (!this.id) return;
    const at = this.engine.movie ? locate(this.engine.movie, this.id) : null;
    if (!at || !at.content.text) { this.stop(); return; }
    if (this.ta.value !== at.content.text.text) this.ta.value = at.content.text.text;
  }

  /** Called on each Stage draw: keeps the editor over the text, or closes it when the content is no longer the only one selected. */
  sync(): void {
    if (!this.id) return;
    const sel = this.engine.selected;
    if (sel.length !== 1 || sel[0].id !== this.id) { this.stop(); return; }
    this.place();
  }

  private place(): void {
    const m = this.engine.movie, v = this.hooks.view();
    const at = m ? locate(m, this.id) : null;
    const s = at?.content.text;
    if (!m || !v || !at || !s) return;
    const lay = layoutText(s, m);
    const pts = this.hooks.corners(at.content);
    const iw = Math.max(1, lay.inner.w), ih = Math.max(1, lay.inner.h);
    const ex = [(pts[1][0] - pts[0][0]) / iw, (pts[1][1] - pts[0][1]) / iw], ey = [(pts[3][0] - pts[0][0]) / ih, (pts[3][1] - pts[0][1]) / ih];
    const slack = s.size;
    const st = this.ta.style;
    const vert = !!s.vertical;
    const css = fontCss(s);
    st.fontFamily = css.slice(css.indexOf('px ') + 3);
    st.fontSize = `${s.size}px`;
    st.fontWeight = String(s.weight);
    st.fontStyle = s.italic ? 'italic' : 'normal';
    st.lineHeight = `${s.size * (s.leading ?? 1.2)}px`;
    st.letterSpacing = `${((s.tracking ?? 0) / 1000) * s.size}px`;
    st.textTransform = s.caps === 'upper' ? 'uppercase' : s.caps === 'lower' ? 'lowercase' : 'none';
    st.fontVariantCaps = s.caps === 'small' ? 'all-small-caps' : 'normal';
    st.fontKerning = s.kerning ? 'none' : 'auto';
    st.textAlign = s.align === 'justify' ? 'left' : s.align;
    st.writingMode = vert ? 'vertical-rl' : 'horizontal-tb';
    st.textOrientation = vert ? 'upright' : 'mixed';
    st.whiteSpace = s.boxW && !vert ? 'pre-wrap' : 'pre';
    st.caretColor = s.color;
    st.padding = vert ? `${slack}px 0` : `0 ${slack}px`;
    st.width = `${vert ? iw : iw + slack * 2}px`;
    st.height = `${vert ? ih + slack * 2 : ih}px`;
    const ox = vert ? 0 : slack, oy = vert ? slack : 0;
    const tx = pts[0][0] - ex[0] * ox - ey[0] * oy, ty = pts[0][1] - ex[1] * ox - ey[1] * oy;
    st.transform = `matrix(${ex[0]}, ${ex[1]}, ${ey[0]}, ${ey[1]}, ${tx}, ${ty})`;
    setClass(this.ta, 'is-vertical', vert);
  }

  // ---- wrap width ----

  /** True when a side node of this content sets the wrap width: Text, left or right node, outside Keyframe and Perform. */
  static wrapSide(c: Content, side: number, keyed: boolean): boolean {
    return c.kind === 'text' && !!c.text && !c.text.vertical && !keyed && (side === 1 || side === 3);
  }

  beginWrap(e: PointerEvent, id: string, side: number, target: Element): void {
    this.drag = { id, sign: side === 1 ? 1 : -1, pointer: e.pointerId, tag: `wrap-${Date.now()}` };
    try { target.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  private moveWrap(e: PointerEvent): void {
    const d = this.drag, m = this.engine.movie, v = this.hooks.view();
    if (!d || !m || !v || e.pointerId !== d.pointer) return;
    const at = locate(m, d.id);
    if (!at || !at.content.text) return;
    const p = this.hooks.pose(at.content);
    const [x, y] = this.hooks.point(e, d.id);
    const cx = v.ox + (m.width / 2 + (p.px ?? 0) + p.x) * v.scale, cy = v.oy + (m.height / 2 + (p.py ?? 0) + p.y) * v.scale;
    const th = (p.rot * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
    const dx = (x - cx) / v.scale, dy = (y - cy) / v.scale;
    const u = dx * cs + dy * sn;
    const local = u / (p.sx * p.kx * p.fx) + (p.px ?? 0);
    const w = Math.round(Math.max(Math.max(20, at.content.text.size * 0.6), 2 * d.sign * local));
    const id = d.id;
    this.engine.run('Resize Text Box', (mv) => ops.updateContent(mv, id, (c) => (c.text ? { ...c, text: { ...c.text, boxW: w } } : c)), d.tag);
  }

  private endWrap(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointer) return;
    this.drag = null;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.engine.endGesture();
  }
}
