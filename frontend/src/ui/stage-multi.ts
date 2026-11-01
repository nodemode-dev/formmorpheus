// The union box for several selected contents (Compose only): one box around all of them, four corner nodes that
// scale every content about the box centre and a node above that turns them together. Moving by dragging a
// content already moves the whole selection (stage-view). Built once, patched in place.
import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import * as ops from '../engine/ops';
import type { View } from '../engine/render';
import type { Content, Movie, Transform } from '../engine/types';
import { el, q } from './dom';

interface Host {
  corners: (c: Content) => [number, number][];
  local: (e: PointerEvent) => [number, number];
}

interface Drag {
  pointer: number;
  tag: string;
  kind: 'scale' | 'rotate';
  /** Box centre in Stage space pixels and in movie pixels. */
  cs: [number, number];
  cm: [number, number];
  d0: number;
  a0: number;
  base: Map<string, { t: Transform; ax: number; ay: number }>;
}

export class MultiBox {
  private readonly svg = el(`<svg class="fm-multi" hidden aria-label="Selection box"><polygon class="fm-multi-line"/><line class="fm-multi-stem"/><circle class="fm-multi-rot" r="6"><title>Turn the selection</title></circle><circle class="fm-multi-h" data-h="0" r="6"/><circle class="fm-multi-h" data-h="1" r="6"/><circle class="fm-multi-h" data-h="2" r="6"/><circle class="fm-multi-h" data-h="3" r="6"/></svg>`) as unknown as SVGSVGElement;
  private drag: Drag | null = null;
  private view: View | null = null;
  private ids: string[] = [];
  private vb = '';

  constructor(space: HTMLElement, private readonly engine: Engine, private readonly host: Host) {
    space.append(this.svg);
    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    this.svg.addEventListener('pointercancel', (e) => this.up(e));
  }

  /** Patch to the selection; `on` is false in Keyframe and Perform, or when fewer than two contents are selected. */
  sync(view: View | null, sel: Content[], on: boolean, size: [number, number]): void {
    const show = on && !!view && sel.length > 1;
    this.view = view;
    this.ids = show ? sel.map((c) => c.id) : [];
    if (this.drag && !show) this.drag = null;
    if (this.svg.hasAttribute('hidden') === !show) { if (!show) return; } else if (show) this.svg.removeAttribute('hidden'); else { this.svg.setAttribute('hidden', ''); return; }
    const vb = `0 0 ${size[0]} ${size[1]}`;
    if (vb !== this.vb) { this.vb = vb; this.svg.setAttribute('viewBox', vb); }
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const c of sel) for (const [x, y] of this.host.corners(c)) { l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y); }
    q(this.svg as unknown as HTMLElement, '.fm-multi-line').setAttribute('points', `${l},${t} ${r},${t} ${r},${b} ${l},${b}`);
    const pts = [[l, t], [r, t], [r, b], [l, b]];
    this.svg.querySelectorAll('.fm-multi-h').forEach((h, i) => { h.setAttribute('cx', String(pts[i][0])); h.setAttribute('cy', String(pts[i][1])); });
    const mx = (l + r) / 2;
    const stem = q(this.svg as unknown as HTMLElement, '.fm-multi-stem');
    stem.setAttribute('x1', String(mx)); stem.setAttribute('y1', String(t)); stem.setAttribute('x2', String(mx)); stem.setAttribute('y2', String(t - 28));
    const rot = q(this.svg as unknown as HTMLElement, '.fm-multi-rot');
    rot.setAttribute('cx', String(mx)); rot.setAttribute('cy', String(t - 28));
  }

  private down(e: PointerEvent): void {
    const m = this.engine.movie, v = this.view, tg = e.target as Element;
    const scaling = tg.classList.contains('fm-multi-h'), turning = tg.classList.contains('fm-multi-rot');
    if (!m || !v || e.button !== 0 || this.drag || (!scaling && !turning) || this.ids.length < 2) return;
    const base = new Map<string, { t: Transform; ax: number; ay: number }>();
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const id of this.ids) {
      const c = locate(m, id)?.content;
      if (!c) continue;
      for (const [x, y] of this.host.corners(c)) { l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y); }
      const tr = c.transform;
      base.set(id, { t: { ...tr }, ax: m.width / 2 + (c.pivot?.x ?? 0) + tr.x, ay: m.height / 2 + (c.pivot?.y ?? 0) + tr.y });
    }
    const cs: [number, number] = [(l + r) / 2, (t + b) / 2];
    const [px, py] = this.host.local(e);
    this.drag = {
      pointer: e.pointerId, tag: `multi-${Date.now()}`, kind: scaling ? 'scale' : 'rotate', cs,
      cm: [(cs[0] - v.ox) / v.scale, (cs[1] - v.oy) / v.scale],
      d0: Math.hypot(px - cs[0], py - cs[1]) || 1, a0: Math.atan2(py - cs[1], px - cs[0]), base,
    };
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    const [px, py] = this.host.local(e);
    let k = 1, th = 0;
    if (d.kind === 'scale') k = Math.max(0.02, Math.hypot(px - d.cs[0], py - d.cs[1]) / d.d0);
    else {
      th = Math.atan2(py - d.cs[1], px - d.cs[0]) - d.a0;
      if (e.shiftKey) th = Math.round(th / (Math.PI / 12)) * (Math.PI / 12);
    }
    const cs = Math.cos(th), sn = Math.sin(th);
    this.engine.run(d.kind === 'scale' ? 'Scale Selection' : 'Rotate Selection', (mv: Movie) => {
      let out = mv;
      for (const [id, b] of d.base) {
        const rx = b.ax - d.cm[0], ry = b.ay - d.cm[1];
        const nx = d.cm[0] + k * (rx * cs - ry * sn), ny = d.cm[1] + k * (rx * sn + ry * cs);
        const rot = d.kind === 'rotate' ? Math.round((b.t.rotation + (th * 180) / Math.PI) * 10) / 10 : b.t.rotation;
        out = ops.patchContent(out, [id], { transform: { ...b.t, x: Math.round(b.t.x + nx - b.ax), y: Math.round(b.t.y + ny - b.ay), scale: Math.round(b.t.scale * k * 10000) / 10000, rotation: rot } });
      }
      return out;
    }, d.tag);
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    this.engine.endGesture();
    try { this.svg.releasePointerCapture(e.pointerId); } catch { /* released */ }
  }
}
