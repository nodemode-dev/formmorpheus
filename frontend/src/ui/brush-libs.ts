// The Libraries screen of the brush panel: every library as a miniature card (its name, how many sets and brushes,
// and a stroke from its first brush). Opened by pinching in on the panel, Ctrl + wheel, or "All libraries" in the
// library menu. Cards are made once per library and patched in place; a tap picks the library.

import { renderBrushPreview } from '../paint/preview';
import { el, setClass, setHidden, setText } from './dom';
import { t, tn } from './i18n';
import { brushStore } from './brush-store';

const W = 168;
const H = 44;

interface Card { root: HTMLButtonElement; name: HTMLElement; meta: HTMLElement; cv: HTMLCanvasElement; drawn: string }

export class LibraryScreen {
  readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly cards = new Map<string, Card>();
  private shown = false;

  constructor(private readonly onPick: (libId: string) => void) {
    this.root = el<HTMLElement>(`<div class="fm-bp-libscreen fm-pp-glass" hidden><div class="fm-bp-libscreen-head"></div><div class="fm-bp-libscreen-grid"></div></div>`);
    this.grid = this.root.querySelector('.fm-bp-libscreen-grid') as HTMLElement;
    setText(this.root.querySelector('.fm-bp-libscreen-head'), t('Libraries'));
    this.grid.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-lib]');
      if (!c) return;
      this.close();
      this.onPick(c.dataset.lib as string);
    });
  }

  get isOpen(): boolean { return this.shown; }

  open(): void {
    this.sync();
    this.shown = true;
    setHidden(this.root, false);
  }

  close(): void {
    if (!this.shown) return;
    this.shown = false;
    setHidden(this.root, true);
  }

  /** Patches the cards in place: one per library, added or removed as libraries come and go. */
  private sync(): void {
    const libs = brushStore.libs();
    const active = brushStore.activeLib();
    const seen = new Set<string>();
    let prev: HTMLElement | null = null;
    for (const l of libs) {
      seen.add(l.id);
      let c = this.cards.get(l.id);
      if (!c) {
        const root = el<HTMLButtonElement>(`<button type="button" class="fm-bp-libcard" data-lib="${l.id}"><canvas width="${W * 2}" height="${H * 2}"></canvas><span class="fm-bp-libcard-name"></span><span class="fm-bp-libcard-meta"></span></button>`);
        c = { root, name: root.querySelector('.fm-bp-libcard-name') as HTMLElement, meta: root.querySelector('.fm-bp-libcard-meta') as HTMLElement, cv: root.querySelector('canvas') as HTMLCanvasElement, drawn: '' };
        this.cards.set(l.id, c);
      }
      const sets = brushStore.setsOf(l.id);
      const brushes = sets.reduce((n, s) => n + s.ids.length, 0);
      setText(c.name, l.name);
      setText(c.meta, `${tn(sets.length, '{n} set', '{n} sets')} · ${tn(brushes, '{n} brush', '{n} brushes')}`);
      setClass(c.root, 'is-active', l.id === active);
      this.sample(c, sets[0]?.id);
      // keep the cards in library order without rebuilding any of them
      const at: ChildNode | null = prev ? prev.nextSibling : this.grid.firstChild;
      if (at !== c.root) this.grid.insertBefore(c.root, at);
      prev = c.root;
    }
    for (const [id, c] of this.cards) if (!seen.has(id)) { c.root.remove(); this.cards.delete(id); }
  }

  /** A stroke from the first brush of the first set, drawn once per brush and revision. */
  private sample(c: Card, setId: string | undefined): void {
    const b = setId ? brushStore.brushesOf(setId)[0] : undefined;
    const key = b ? `${b.id}:${brushStore.rev(b.id)}` : '';
    if (c.drawn === key) return;
    c.drawn = key;
    const g = c.cv.getContext('2d') as CanvasRenderingContext2D;
    g.clearRect(0, 0, c.cv.width, c.cv.height);
    if (!b) return;
    try {
      const r = renderBrushPreview(b, c.cv.width, c.cv.height, { r: 235, g: 235, b: 240 });
      g.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
    } catch { /* a brush that cannot draw leaves an empty card picture */ }
  }
}

/** Two fingers closing on the panel, or Ctrl + wheel toward the screen, ask for the Libraries screen. */
export function wirePinchIn(node: HTMLElement, run: () => void): void {
  const pts = new Map<number, { x: number; y: number }>();
  let d0 = 0;
  const dist = (): number => { const a = [...pts.values()]; return a.length === 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0; };
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    d0 = dist();
  });
  node.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    const d = dist();
    if (d0 > 0 && d > 0 && d < d0 * 0.7) { pts.clear(); d0 = 0; run(); }
  });
  const up = (e: PointerEvent): void => { pts.delete(e.pointerId); d0 = 0; };
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  // a trackpad pinch arrives as a Ctrl + wheel; a pinch inward has a positive delta
  node.addEventListener('wheel', (e) => { if (e.ctrlKey && e.deltaY > 0) { e.preventDefault(); run(); } }, { passive: false });
}
