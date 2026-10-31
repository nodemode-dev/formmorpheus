// The inline Text editor's caret and selection. The textarea keeps the keys and the clipboard; once a block has styled spans its
// own letter positions no longer match the drawn ones, so this layer draws the caret and selection from the shared layout
// (engine/text-layout.ts glyphsOf) and turns pointer presses into offsets. It also reports the selection to the Spans tab.
import { glyphsOf, type TextLayout } from '../engine/text-layout';
import { hasRuns } from '../engine/text-rich';
import type { TextStyle } from '../engine/types';
import { el, setHidden } from './dom';
import { textSel } from './text-sel';

type Pt = [number, number];

export class RichCaret {
  readonly root = el<HTMLElement>('<div class="fm-ted-rich" hidden></div>');
  private readonly caret = el<HTMLElement>('<div class="fm-ted-caret" hidden></div>');
  private readonly pool: HTMLElement[] = [];
  private data: { id: string; s: TextStyle; lay: TextLayout; pts: Pt[] } | null = null;
  private anchor = -1;
  private rich = false;

  constructor(space: HTMLElement, private readonly ta: HTMLTextAreaElement, private readonly onChange: () => void) {
    this.root.appendChild(this.caret);
    space.appendChild(this.root);
    const refresh = (): void => this.refresh();
    for (const ev of ['select', 'keyup', 'input', 'focus', 'mouseup', 'selectionchange']) ta.addEventListener(ev, refresh);
    ta.addEventListener('keydown', () => requestAnimationFrame(refresh));
    ta.addEventListener('blur', () => { setHidden(this.caret, true); });
    ta.addEventListener('pointerdown', (e) => this.down(e));
    ta.addEventListener('pointermove', (e) => this.move(e));
    ta.addEventListener('pointerup', (e) => { this.anchor = -1; try { ta.releasePointerCapture(e.pointerId); } catch { /* not captured */ } });
    ta.addEventListener('dblclick', (e) => this.word(e));
  }

  /** Called on each Stage draw while editing: where the text box sits on screen (corners of the inner block). */
  update(id: string, s: TextStyle, lay: TextLayout, pts: Pt[]): void {
    this.data = { id, s, lay, pts };
    this.rich = hasRuns(s);
    this.ta.classList.toggle('is-rich', this.rich);
    setHidden(this.root, !this.rich);
    if (!this.rich) return;
    const iw = Math.max(1, lay.inner.w), ih = Math.max(1, lay.inner.h);
    const ex = [(pts[1][0] - pts[0][0]) / iw, (pts[1][1] - pts[0][1]) / iw], ey = [(pts[3][0] - pts[0][0]) / ih, (pts[3][1] - pts[0][1]) / ih];
    this.root.style.transform = `matrix(${ex[0]}, ${ex[1]}, ${ey[0]}, ${ey[1]}, ${pts[0][0]}, ${pts[0][1]})`;
    this.draw();
  }

  stop(): void {
    this.data = null;
    setHidden(this.root, true);
    this.ta.classList.remove('is-rich');
  }

  private refresh(): void {
    const d = this.data;
    if (!d) return;
    textSel.set(d.id, this.ta.selectionStart, this.ta.selectionEnd);
    this.draw();
    this.onChange();
  }

  private chars(): ReturnType<typeof glyphsOf> {
    const d = this.data as NonNullable<RichCaret['data']>;
    glyphsOf(d.s, d.lay);
    return d.lay.chars ?? [];
  }

  private draw(): void {
    const d = this.data;
    if (!d || !this.rich) return;
    const { lay } = d, cs = this.chars(), a = this.ta.selectionStart, b = this.ta.selectionEnd, ox = lay.inner.x, oy = lay.inner.y;
    // selection: one rectangle per line it touches
    let used = 0;
    if (b > a) {
      const byLine = new Map<number, { x0: number; x1: number }>();
      for (const c of cs) {
        if (c.i < a || c.i >= b) continue;
        const r = byLine.get(c.line);
        if (r) { r.x0 = Math.min(r.x0, c.x); r.x1 = Math.max(r.x1, c.x + c.w); } else byLine.set(c.line, { x0: c.x, x1: c.x + c.w });
      }
      for (const [li, r] of byLine) {
        const h = lay.heights[li] ?? lay.inner.h, y = (lay.lines[li]?.y ?? 0) - h / 2;
        const node = this.pool[used] ?? this.make();
        used++;
        setHidden(node, false);
        node.style.left = `${r.x0 - ox}px`;
        node.style.top = `${y - oy}px`;
        node.style.width = `${r.x1 - r.x0}px`;
        node.style.height = `${h}px`;
      }
    }
    for (let i = used; i < this.pool.length; i++) setHidden(this.pool[i], true);
    // caret at the end of the selection that moves
    const focus = document.activeElement === this.ta && b === a;
    setHidden(this.caret, !focus);
    if (focus) {
      const at = this.caretAt(a, cs);
      const h = (lay.heights[at.line] ?? 40) / 1.2, y = (lay.lines[at.line]?.y ?? 0) - h / 2;
      this.caret.style.left = `${at.x - ox - 1}px`;
      this.caret.style.top = `${y - oy}px`;
      this.caret.style.height = `${h}px`;
    }
  }

  private make(): HTMLElement {
    const n = el<HTMLElement>('<div class="fm-ted-sel"></div>');
    this.root.insertBefore(n, this.caret);
    this.pool.push(n);
    return n;
  }

  private caretAt(p: number, cs: ReturnType<typeof glyphsOf>): { x: number; line: number } {
    const d = this.data as NonNullable<RichCaret['data']>;
    const exact = cs.find((c) => c.i === p);
    if (exact) return { x: exact.x, line: exact.line };
    const text = d.s.text;
    if (p > 0 && text[p - 1] === '\n') {
      const li = Math.min(d.lay.lines.length - 1, (text.slice(0, p).match(/\n/g) ?? []).length);
      return { x: d.lay.lines[li]?.x0 ?? d.lay.inner.x, line: li };
    }
    let prev: (typeof cs)[number] | undefined;
    for (const c of cs) if (c.i < p) prev = c;
    if (prev) return { x: prev.x + prev.w, line: prev.line };
    return { x: d.lay.lines[0]?.x0 ?? d.lay.inner.x, line: 0 };
  }

  // ---- pointer ----

  /** The text offset under a pointer. */
  private indexAt(e: PointerEvent | MouseEvent): number {
    const d = this.data as NonNullable<RichCaret['data']>;
    const { pts, lay } = d, iw = Math.max(1, lay.inner.w), ih = Math.max(1, lay.inner.h);
    const ex: Pt = [(pts[1][0] - pts[0][0]) / iw, (pts[1][1] - pts[0][1]) / iw], ey: Pt = [(pts[3][0] - pts[0][0]) / ih, (pts[3][1] - pts[0][1]) / ih];
    const dx = e.clientX - pts[0][0], dy = e.clientY - pts[0][1], det = ex[0] * ey[1] - ex[1] * ey[0] || 1;
    const lx = (dx * ey[1] - dy * ey[0]) / det + lay.inner.x, ly = (ex[0] * dy - ex[1] * dx) / det + lay.inner.y;
    let li = 0, best = Infinity;
    lay.lines.forEach((l, i) => { const dd = Math.abs(l.y - ly); if (dd < best) { best = dd; li = i; } });
    const cs = this.chars().filter((c) => c.line === li);
    if (!cs.length) {
      // an empty line: just after the line breaks before it
      let off = 0;
      for (let k = 0, n = 0; k < d.s.text.length && n < li; k++) if (d.s.text[k] === '\n') { n++; off = k + 1; }
      return Math.min(d.s.text.length, li === 0 ? 0 : off);
    }
    for (const c of cs) if (lx < c.x + c.w / 2) return c.i;
    const last = cs[cs.length - 1];
    return last.i + last.t.length;
  }

  private down(e: PointerEvent): void {
    if (!this.data || !this.rich || e.button !== 0) return;
    e.preventDefault();
    this.ta.focus({ preventScroll: true });
    const i = this.indexAt(e);
    if (e.shiftKey) {
      const a = this.ta.selectionDirection === 'backward' ? this.ta.selectionEnd : this.ta.selectionStart;
      this.anchor = a;
      this.set(a, i);
    } else {
      this.anchor = i;
      this.set(i, i);
    }
    try { this.ta.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  }

  private move(e: PointerEvent): void {
    if (!this.data || !this.rich || this.anchor < 0 || !(e.buttons & 1)) return;
    this.set(this.anchor, this.indexAt(e));
  }

  private set(a: number, b: number): void {
    this.ta.setSelectionRange(Math.min(a, b), Math.max(a, b), b < a ? 'backward' : 'forward');
    this.refresh();
  }

  private word(e: MouseEvent): void {
    if (!this.data || !this.rich) return;
    const t = this.data.s.text, i = Math.min(t.length - 1, this.indexAt(e));
    if (i < 0) return;
    let a = i, b = i;
    while (a > 0 && /\S/.test(t[a - 1])) a--;
    while (b < t.length && /\S/.test(t[b])) b++;
    this.set(a, b);
  }
}
