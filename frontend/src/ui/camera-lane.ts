// The Camera lane at the top of the Timeline: one row of key marks for the movie camera (pan, zoom, rotation),
// drawn on its own canvas above the tracks so it shares the Timeline's zoom and scroll. Click to move the
// Playhead, drag a mark to move its key, right-click for easing and delete.
import type { Engine } from '../engine/engine';
import { deleteCameraKey, moveCameraKey, setCameraEase } from '../engine/camera';
import { content } from '../engine/model';
import { laneFrames } from '../engine/keys';
import { cameraLane } from '../engine/transform';
import { EASES, type Content, type Movie } from '../engine/types';
import { cameraMode } from './camera-view';
import { drawLanes, LANE_H, type LaneGeom } from './key-lanes';
import type { TimelineView } from './timeline';
import { el, setClass } from './dom';
import { Popover, popRow, popSep } from './popover';

const HIT = 8;
const standIns = new WeakMap<object, Content>();

function standIn(m: Movie): Content | null {
  const cam = m.camera;
  if (!cam) return null;
  const have = standIns.get(cam);
  if (have && have.duration === Math.max(1, m.duration)) return have;
  const c = content('group', 0, Math.max(1, m.duration), { keys: cam.keys.map((l) => ({ ...l, expanded: false })), name: 'Camera' });
  standIns.set(cam, c);
  return c;
}

export class CameraLane {
  readonly canvas: HTMLCanvasElement;
  private readonly body: HTMLElement;
  private readonly menu: Popover;
  private readonly easeRows = new Map<string, ReturnType<typeof popRow>>();
  private menuAt = 0;
  private width = 0;
  private dpr = 1;
  private req = 0;
  private drag: { kind: 'scrub' } | { kind: 'key'; from: number; cur: number; base: Movie; tag: string; x0: number } | null = null;

  constructor(private readonly timeline: TimelineView, private readonly engine: Engine) {
    this.body = timeline.root.querySelector('.fm-tl-body') as HTMLElement;
    this.canvas = el<HTMLCanvasElement>('<canvas class="fm-cam-lane" aria-label="Camera lane" hidden></canvas>');
    const ruler = this.body.querySelector('.fm-tl-ruler') as HTMLElement;
    ruler.after(this.canvas);
    this.menu = new Popover('fm-cm fm-lm', 220);
    for (const e of EASES) {
      const r = popRow(null, e.label);
      r.el.addEventListener('click', () => { this.easeKey(e.id); this.menu.hide(); });
      this.easeRows.set(e.id, r);
      this.menu.body.appendChild(r.el);
    }
    const del = popRow(null, 'Delete key', { danger: true });
    del.el.addEventListener('click', () => { this.engine.run('Delete Camera Keyframe', (m) => deleteCameraKey(m, this.menuAt)); this.menu.hide(); });
    this.menu.body.append(popSep(), del.el);
    new ResizeObserver(() => this.schedule()).observe(this.canvas);
    timeline.onDrawn = () => this.schedule();
    for (const ev of ['movie', 'time', 'projects'] as const) engine.on(ev, () => this.schedule());
    cameraMode.onChange(() => this.schedule());
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    this.canvas.addEventListener('contextmenu', (e) => this.context(e));
  }

  private schedule(): void {
    if (this.req) return;
    this.req = requestAnimationFrame(() => { this.req = 0; this.draw(); });
  }

  private visible(m: Movie | null): boolean {
    return !!m && (!!cameraLane(m) || cameraMode.on);
  }

  private draw(): void {
    const m = this.engine.movie;
    const show = this.visible(m);
    if (this.canvas.hasAttribute('hidden') === show) this.canvas.toggleAttribute('hidden', !show);
    setClass(this.body, 'has-camera', show);
    if (!show || !m) return;
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w <= 1) return;
    if (w !== this.width || dpr !== this.dpr || this.canvas.height !== Math.round(h * dpr)) {
      this.width = w; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ax = this.timeline.axis();
    const c = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const s = getComputedStyle(this.canvas);
    const v = (n: string, d: string): string => s.getPropertyValue(n).trim() || d;
    const pal = { bar: v('--fm-key-bar', '#1e1e22'), row: v('--fm-key-row', '#1a1a1e'), accent: v('--accent-color', '#f97316'), text: v('--text-primary', '#f2f2f2'), onAccent: v('--text-on-accent', '#ffffff') };
    const si = standIn(m);
    const x0 = ax.x(0), x1 = ax.x(m.duration);
    if (si) {
      const geom: LaneGeom = { x: (f) => ax.x(f), x0, x1, width: w };
      drawLanes(c, si, 1, geom, pal, h, Math.max(0, Math.min(m.duration - 1, this.engine.frame)));
    } else {
      c.fillStyle = pal.bar;
      c.beginPath();
      c.roundRect(Math.max(0, x0), 1, Math.max(0, Math.min(w, x1) - Math.max(0, x0)), LANE_H, 6);
      c.fill();
      c.fillStyle = v('--text-muted', '#8a8a8a');
      c.font = '600 10px Inter, system-ui, sans-serif';
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.fillText('Drag the frame on the Stage to key the camera', Math.max(8, x0 + 10), 1 + LANE_H / 2);
    }
    if (si) {
      c.fillStyle = v('--text-muted', '#8a8a8a');
      c.font = '600 9px Inter, system-ui, sans-serif';
      c.textBaseline = 'middle';
      c.textAlign = 'right';
      c.fillText('Camera', Math.min(w - 8, x1 - 8), 1 + LANE_H / 2);
    }
    const px = Math.round(ax.x(this.engine.frame)) + 0.5;
    c.strokeStyle = v('--fm-playhead', '#f2f2f2');
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(px, 0);
    c.lineTo(px, h);
    c.stroke();
  }

  private keyAt(m: Movie, x: number): number | null {
    const lane = cameraLane(m);
    if (!lane) return null;
    const ax = this.timeline.axis();
    let best: number | null = null, d = HIT + 0.001;
    for (const f of laneFrames(lane)) {
      const dist = Math.abs(ax.x(f) - x);
      if (dist < d) { d = dist; best = f; }
    }
    return best;
  }

  private xOf(e: MouseEvent): number {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }

  private down(e: PointerEvent): void {
    const m = this.engine.movie;
    if (!m || e.button !== 0) return;
    this.engine.stop();
    const x = this.xOf(e);
    const key = this.keyAt(m, x);
    this.canvas.setPointerCapture(e.pointerId);
    if (key !== null) {
      this.engine.seek(key);
      this.drag = { kind: 'key', from: key, cur: key, base: m, tag: `camkey-${Date.now()}`, x0: e.clientX };
    } else {
      this.drag = { kind: 'scrub' };
      this.engine.seek(Math.max(0, Math.min(m.duration - 1, Math.floor(this.timeline.axis().frame(x)))));
    }
  }

  private move(e: PointerEvent): void {
    const d = this.drag, m = this.engine.movie;
    if (!d || !m) return;
    const ax = this.timeline.axis();
    if (d.kind === 'scrub') {
      this.engine.seek(Math.max(0, Math.min(m.duration - 1, Math.floor(ax.frame(this.xOf(e))))));
      return;
    }
    const ppf = ax.x(1) - ax.x(0) || 1;
    const to = Math.max(0, Math.min(m.duration - 1, Math.round(d.from + (e.clientX - d.x0) / ppf)));
    if (to === d.cur) return;
    const base = d.base, from = d.from;
    if (this.engine.run('Move Camera Keyframe', () => moveCameraKey(base, from, to), d.tag)) {
      d.cur = to;
      this.engine.seek(to);
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (d?.kind === 'key') this.engine.endGesture();
  }

  private context(e: MouseEvent): void {
    const m = this.engine.movie;
    if (!m) return;
    e.preventDefault();
    const key = this.keyAt(m, this.xOf(e));
    if (key === null) return;
    this.menuAt = key;
    this.engine.seek(key);
    this.menu.showAt(e.clientX, e.clientY);
  }

  private easeKey(ease: string): void {
    const at = this.menuAt;
    this.engine.run('Camera Easing', (m) => setCameraEase(m, at, ease as never));
  }
}
