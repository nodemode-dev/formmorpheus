// Camera mode on the Stage. The Stage then shows the world as it is, without the camera, and this overlay
// draws the camera frame over it with guides and handles: drag the frame to pan, a corner to zoom, the
// round handle to rotate. Each drag writes camera keys at the Playhead (one undo step per drag).
import type { Engine } from '../engine/engine';
import { poseAt, setCameraKeys } from '../engine/camera';
import { apply, cameraMat, invert } from '../engine/transform';
import type { View } from '../engine/render';
import { el } from './dom';
import { newKeyState } from './action-menu';
import '../styles/camera.css';
import { stageLocal } from './stage-nav';

type Listener = () => void;

/** Whether the Stage is in Camera mode (set by the button in the Timeline bar). */
class CameraMode {
  on = false;
  private readonly subs = new Set<Listener>();

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    for (const fn of this.subs) fn();
  }

  toggle(): void { this.set(!this.on); }

  onChange(fn: Listener): void { this.subs.add(fn); }
}

export const cameraMode = new CameraMode();

function setHidden(node: Element, hidden: boolean): void {
  if (node.hasAttribute('hidden') !== hidden) node.toggleAttribute('hidden', hidden);
}

type Drag =
  | { kind: 'pan'; x0: number; y0: number; panX: number; panY: number; tag: string }
  | { kind: 'zoom'; d0: number; zoom: number; cx: number; cy: number; tag: string }
  | { kind: 'rotate'; a0: number; rot: number; cx: number; cy: number; tag: string };

export class CameraOverlay {
  readonly root: SVGSVGElement;
  private readonly dim: SVGElement;
  private readonly frame: SVGElement;
  private readonly guides: SVGElement[];
  private readonly stem: SVGElement;
  private readonly handles: SVGElement[];
  private readonly rot: SVGElement;
  private view: View | null = null;
  private drag: Drag | null = null;
  private pointer = -1;
  private box = '';

  constructor(host: HTMLElement, private readonly engine: Engine) {
    this.root = el(`<svg class="fm-cam-ov" hidden aria-label="Camera frame"><rect class="fm-cam-hit" x="-4000" y="-4000" width="8000" height="8000"/><path class="fm-cam-dim"/><polyline class="fm-cam-guide"/><polyline class="fm-cam-guide"/><polyline class="fm-cam-guide"/><polyline class="fm-cam-guide"/><polygon class="fm-cam-frame"/><line class="fm-cam-stem"/><circle class="fm-cam-h" data-h="0" r="6"/><circle class="fm-cam-h" data-h="1" r="6"/><circle class="fm-cam-h" data-h="2" r="6"/><circle class="fm-cam-h" data-h="3" r="6"/><circle class="fm-cam-rot" r="6"/></svg>`) as unknown as SVGSVGElement;
    host.appendChild(this.root);
    const q1 = (s: string): SVGElement => this.root.querySelector(s) as SVGElement;
    this.dim = q1('.fm-cam-dim');
    this.frame = q1('.fm-cam-frame');
    this.guides = Array.from(this.root.querySelectorAll<SVGElement>('.fm-cam-guide'));
    this.stem = q1('.fm-cam-stem');
    this.handles = Array.from(this.root.querySelectorAll<SVGElement>('.fm-cam-h'));
    this.rot = q1('.fm-cam-rot');
    this.root.addEventListener('pointerdown', (e) => this.down(e));
    this.root.addEventListener('pointermove', (e) => this.move(e));
    this.root.addEventListener('pointerup', (e) => this.up(e));
    this.root.addEventListener('pointercancel', (e) => this.up(e));
    this.root.addEventListener('lostpointercapture', (e) => this.up(e));
  }

  /** The frame's corners on the screen (clockwise from the top left) for the current camera. */
  private corners(): [number, number][] | null {
    const m = this.engine.movie, v = this.view;
    if (!m || !v) return null;
    const inv = invert(cameraMat(m, poseAt(m, this.engine.frame)));
    if (!inv) return null;
    return ([[0, 0], [m.width, 0], [m.width, m.height], [0, m.height]] as [number, number][]).map(([x, y]) => {
      const [wx, wy] = apply(inv, x, y);
      return [v.ox + wx * v.scale, v.oy + wy * v.scale];
    });
  }

  /** Places the overlay for this Stage draw. */
  sync(view: View | null): void {
    const m = this.engine.movie;
    if (!cameraMode.on || !m || !view) {
      setHidden(this.root, true);
      this.view = null;
      return;
    }
    this.view = view;
    const pts = this.corners();
    if (!pts) { setHidden(this.root, true); return; }
    setHidden(this.root, false);
    const box = `0 0 ${view.width} ${view.height}`;
    if (box !== this.box) { this.root.setAttribute('viewBox', box); this.box = box; }
    const f = (p: [number, number]): string => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const str = pts.map(f).join(' ');
    this.frame.setAttribute('points', str);
    const big = 6000;
    this.dim.setAttribute('d', `M${-big} ${-big}H${big}V${big}H${-big}Z M${pts.map(f).join(' L')} Z`);
    const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    // thirds, drawn as lines across the frame
    const lines: [[number, number], [number, number]][] = [
      [lerp(pts[0], pts[1], 1 / 3), lerp(pts[3], pts[2], 1 / 3)], [lerp(pts[0], pts[1], 2 / 3), lerp(pts[3], pts[2], 2 / 3)],
      [lerp(pts[0], pts[3], 1 / 3), lerp(pts[1], pts[2], 1 / 3)], [lerp(pts[0], pts[3], 2 / 3), lerp(pts[1], pts[2], 2 / 3)],
    ];
    lines.forEach(([a, b], i) => this.guides[i].setAttribute('points', `${f(a)} ${f(b)}`));
    pts.forEach((p, i) => { this.handles[i].setAttribute('cx', p[0].toFixed(1)); this.handles[i].setAttribute('cy', p[1].toFixed(1)); });
    const top = lerp(pts[0], pts[1], 0.5), mid = lerp(pts[0], pts[2], 0.5);
    const len = Math.hypot(top[0] - mid[0], top[1] - mid[1]) || 1;
    const rx = top[0] + ((top[0] - mid[0]) / len) * 28, ry = top[1] + ((top[1] - mid[1]) / len) * 28;
    this.stem.setAttribute('x1', top[0].toFixed(1)); this.stem.setAttribute('y1', top[1].toFixed(1));
    this.stem.setAttribute('x2', rx.toFixed(1)); this.stem.setAttribute('y2', ry.toFixed(1));
    this.rot.setAttribute('cx', rx.toFixed(1)); this.rot.setAttribute('cy', ry.toFixed(1));
  }

  private local(e: PointerEvent): [number, number] {
    return stageLocal(e);
  }

  private down(e: PointerEvent): void {
    const m = this.engine.movie, v = this.view, pts = this.corners();
    if (!m || !v || !pts || e.button !== 0 || this.drag) return;
    const [x, y] = this.local(e);
    const pose = poseAt(m, this.engine.frame);
    const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2;
    const tag = `camera-${Date.now()}`;
    const cls = (e.target as Element).classList;
    this.engine.stop();
    if (cls.contains('fm-cam-rot')) this.drag = { kind: 'rotate', a0: Math.atan2(y - cy, x - cx), rot: pose.rotation, cx, cy, tag };
    else if (cls.contains('fm-cam-h')) this.drag = { kind: 'zoom', d0: Math.hypot(x - cx, y - cy) || 1, zoom: pose.zoom, cx, cy, tag };
    else this.drag = { kind: 'pan', x0: x, y0: y, panX: pose.panX, panY: pose.panY, tag };
    this.root.setPointerCapture(e.pointerId);
    this.pointer = e.pointerId;
    e.preventDefault();
  }

  private write(values: { panX?: number; panY?: number; zoom?: number; rotation?: number }, tag: string): void {
    const f = this.engine.frame, ease = newKeyState().lastEase;
    this.engine.run('Camera Keyframe', (mv) => setCameraKeys(mv, f, values, ease), tag);
  }

  private move(e: PointerEvent): void {
    const d = this.drag, v = this.view;
    if (!d || !v || e.pointerId !== this.pointer) return;
    const [x, y] = this.local(e);
    const r2 = (n: number): number => Math.round(n * 100) / 100;
    if (d.kind === 'pan') {
      this.write({ panX: r2(d.panX + (x - d.x0) / v.scale), panY: r2(d.panY + (y - d.y0) / v.scale) }, d.tag);
    } else if (d.kind === 'zoom') {
      const dist = Math.hypot(x - d.cx, y - d.cy) || 1;
      this.write({ zoom: Math.round(Math.min(20, Math.max(0.05, (d.zoom * d.d0) / dist)) * 1000) / 1000 }, d.tag);
    } else {
      let deg = d.rot + ((Math.atan2(y - d.cy, x - d.cx) - d.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      this.write({ rotation: Math.round(deg * 10) / 10 }, d.tag);
    }
  }

  private up(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.pointer) return;
    this.drag = null;
    this.engine.endGesture();
    try { this.root.releasePointerCapture(e.pointerId); } catch { /* released */ }
  }
}
