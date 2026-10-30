// Bones on the Stage: which block is being rigged or posed (set by the Action menu's Bones card), and the
// overlay that shows its skeleton. Rig mode draws bones (a click-drag from the last bone's tip, Alt for a new
// root) and selects them; Pose mode turns a bone by dragging it and writes a key at the Playhead (one undo step
// per drag); in Perform the drag plays the movie and records that bone's rotation. A Warp on the same block
// bends the skinned picture afterwards, so handles are shown through it (a drag ignores the Warp's bend).
import type { Engine } from '../engine/engine';
import type { View } from '../engine/render';
import * as keyOps from '../engine/key-ops';
import * as ops from '../engine/ops';
import { animate, kindSpec, laneOf, type Animated } from '../engine/keys';
import { applyTake, Recorder, roomFor } from '../engine/perform';
import { addBone, boneMatrices, boneTip, deleteBone, nextBoneId, posedBones, rotationToward, skinOf, skinPoints, weightAt } from '../engine/bones';
import { contentRect, localToStage, stageToLocal, warpActive, warpPoint, type Rect } from '../engine/warp-draw';
import type { Content, Ease } from '../engine/types';
import { el, setText } from './dom';
import { BonesCard } from './bones-card';
import { newKeyState } from './action-menu';
import { perform } from './perform-ui';
import '../styles/bones.css';
import { stageLocal } from './stage-nav';

export type BonesTool = 'rig' | 'pose';
type Listener = () => void;

/** The Stage's bones state: null `id` when no block is being rigged. */
class BonesMode {
  id: string | null = null;
  tool: BonesTool = 'pose';
  selected: string | null = null;
  weights = false;
  private readonly subs = new Set<Listener>();

  private fire(): void { for (const fn of this.subs) fn(); }

  open(id: string | null): void {
    if (id === this.id) return;
    this.id = id;
    this.selected = null;
    this.fire();
  }

  setTool(t: BonesTool): void { if (t !== this.tool) { this.tool = t; this.fire(); } }
  select(bone: string | null): void { if (bone !== this.selected) { this.selected = bone; this.fire(); } }
  setWeights(on: boolean): void { if (on !== this.weights) { this.weights = on; this.fire(); } }
  onChange(fn: Listener): void { this.subs.add(fn); }
}

export const bonesMode = new BonesMode();

const SVG = 'http://www.w3.org/2000/svg';
const MIN_BONE = 6;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, cls: string): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG, tag);
  n.setAttribute('class', cls);
  return n;
}

function setHide(node: Element, hidden: boolean): void {
  if (node.hasAttribute('hidden') !== hidden) node.toggleAttribute('hidden', hidden);
}

function setCls(node: Element, cls: string, on: boolean): void {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

/** One bone's pieces on the overlay. */
interface Piece { g: SVGGElement; shape: SVGPolygonElement; tip: SVGCircleElement; joint: SVGCircleElement }

type Drag =
  | { kind: 'pose'; id: string; bone: string; tag: string; pointer: number; rec?: { rec: Recorder; start: number; last: number | null } }
  | { kind: 'draw'; id: string; parent: string | undefined; from: [number, number]; pointer: number };

/** Weight colour: blue at 0 through green to red at 1 (opaque; the canvas itself is translucent). */
function heat(w: number): string {
  return `hsl(${Math.round(240 * (1 - Math.min(1, Math.max(0, w))))} 85% 50%)`;
}

export class BonesOverlay {
  readonly root: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly hit: SVGRectElement;
  private readonly ghost: SVGLineElement;
  private readonly wt: HTMLCanvasElement;
  private readonly pieces: Piece[] = [];
  private drag: Drag | null = null;
  private view: View | null = null;
  private offWrap: (() => void) | null = null;
  private box = '';
  private cw = 0;
  private ch = 0;
  private readonly pt = [0, 0];
  private readonly card: BonesCard;
  private readonly panel: HTMLElement;

  constructor(host: HTMLElement, private readonly engine: Engine) {
    this.root = el('<div class="fm-bones-ov" hidden><canvas class="fm-bones-wt" aria-hidden="true"></canvas><svg class="fm-bones-svg" aria-label="Bones"></svg></div>');
    this.svg = this.root.querySelector('svg') as unknown as SVGSVGElement;
    this.wt = this.root.querySelector('canvas') as HTMLCanvasElement;
    this.hit = svgEl('rect', 'fm-bones-hit');
    this.ghost = svgEl('line', 'fm-bones-ghost');
    this.ghost.setAttribute('hidden', '');
    this.svg.append(this.hit, this.ghost);
    // the card lives on the Stage, not in the Action menu: that menu closes on any outside press, and the tools must stay at hand
    const panel = el(`<div class="fm-bones-panel" role="group" aria-label="Bones"><div class="fm-ka-title"><span class="fm-ka-tico">${kindSpec('bones').icon}</span><span></span></div></div>`);
    setText(panel.querySelector('.fm-ka-title span:last-child'), 'Bones');
    this.card = new BonesCard(engine, () => bonesMode.open(null));
    panel.appendChild(this.card.root);
    // the card sits on the Stage itself, not in the space that turns with a rotated view
    (host.parentElement ?? host).appendChild(panel);
    this.panel = panel;
    host.appendChild(this.root);
    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    this.svg.addEventListener('pointercancel', (e) => this.up(e));
    // capture lost w/o a pointerup (the window lost focus): end the drag or take like a lift
    this.svg.addEventListener('lostpointercapture', (e) => this.up(e));
    window.addEventListener('keydown', (e) => this.key(e), true);
    engine.on('selection', () => {
      const sel = engine.selected;
      if (bonesMode.id && !(sel.length === 1 && sel[0].id === bonesMode.id)) bonesMode.open(null);
    });
    engine.on('mode', (m) => { if (m === 'compose') bonesMode.open(null); });
    engine.on('time', () => { const d = this.drag; if (d?.kind === 'pose' && d.rec && d.rec.last !== null && engine.playing) this.sample(d); });
  }

  get dragging(): boolean { return !!this.drag; }

  private piece(i: number): Piece {
    while (this.pieces.length <= i) {
      const g = svgEl('g', 'fm-bone');
      const shape = svgEl('polygon', 'fm-bone-shape');
      const joint = svgEl('circle', 'fm-bone-joint');
      const tip = svgEl('circle', 'fm-bone-tip');
      joint.setAttribute('r', '4');
      tip.setAttribute('r', '5.5');
      const n = this.pieces.length;
      shape.setAttribute('data-i', String(n));
      tip.setAttribute('data-i', String(n));
      g.append(shape, joint, tip);
      this.svg.insertBefore(g, this.ghost);
      this.pieces.push({ g, shape, tip, joint });
    }
    return this.pieces[i];
  }

  /** Content-space point (before any Warp) to overlay coordinates. */
  private place(a: Animated, m: { width: number; height: number }, rect: Rect, v: View, x: number, y: number): [number, number] {
    const o = this.pt;
    if (warpActive(a)) warpPoint(a, rect, (x - rect.x) / rect.w, (y - rect.y) / rect.h, o);
    else { o[0] = x; o[1] = y; }
    localToStage(a, m.width, m.height, o[0], o[1], o);
    return [v.ox + o[0] * v.scale, v.oy + o[1] * v.scale];
  }

  /** Place the overlay for this draw; true when it is showing (the move box stays hidden then). */
  sync(view: View | null, sel: Content[]): boolean {
    const m = this.engine.movie;
    const c = sel.length === 1 ? sel[0] : null;
    if (!m || !view || !c || bonesMode.id !== c.id || this.engine.mode === 'compose') {
      setHide(this.root, true);
      setHide(this.panel, true);
      this.view = null;
      return false;
    }
    this.view = view;
    setHide(this.root, false);
    setHide(this.panel, false);
    const box = `0 0 ${view.width} ${view.height}`;
    if (box !== this.box) {
      this.svg.setAttribute('viewBox', box);
      this.hit.setAttribute('width', String(view.width));
      this.hit.setAttribute('height', String(view.height));
      this.box = box;
    }
    const rig = c.rig;
    this.card.sync(c, laneOf(c, 'bones'));
    const rigging = bonesMode.tool === 'rig';
    setCls(this.root, 'is-rig', rigging);
    const local = this.engine.frame - c.start;
    const a = animate(c, local);
    // the rest skeleton while rigging, so new bones land where the picture was drawn
    const rot = rigging ? null : a.bones;
    const rect = contentRect(c, m);
    const posed = rig ? posedBones(rig, rot) : [];
    for (let i = 0; i < Math.max(posed.length, this.pieces.length); i++) {
      if (i >= posed.length) { setHide(this.pieces[i].g, true); continue; }
      const p = this.piece(i);
      setHide(p.g, false);
      const [hx, hy] = this.place(a, m, rect, view, posed[i].head[0], posed[i].head[1]);
      const [tx, ty] = this.place(a, m, rect, view, posed[i].tip[0], posed[i].tip[1]);
      const dx = tx - hx, dy = ty - hy, len = Math.hypot(dx, dy) || 1;
      const wd = Math.min(9, Math.max(3, len * 0.16));
      const nx = (-dy / len) * wd, ny = (dx / len) * wd;
      const bx = hx + dx * 0.2, by = hy + dy * 0.2;
      p.shape.setAttribute('points', `${hx.toFixed(1)},${hy.toFixed(1)} ${(bx + nx).toFixed(1)},${(by + ny).toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)} ${(bx - nx).toFixed(1)},${(by - ny).toFixed(1)}`);
      p.joint.setAttribute('cx', hx.toFixed(1)); p.joint.setAttribute('cy', hy.toFixed(1));
      p.tip.setAttribute('cx', tx.toFixed(1)); p.tip.setAttribute('cy', ty.toFixed(1));
      setCls(p.g, 'is-selected', rig!.bones[i].id === bonesMode.selected);
      setCls(p.g, 'is-root', rig!.bones[i].parent === undefined);
    }
    this.paintWeights(c, a, rot, rect, view);
    return true;
  }

  /** The skin mesh tinted by the selected bone's weights (blue none, red full), following the pose. */
  private paintWeights(c: Content, a: Animated, rot: Record<string, number> | null, rect: Rect, view: View): void {
    const m = this.engine.movie;
    const on = bonesMode.weights && !!c.rig && !!m;
    setHide(this.wt, !on);
    if (!on || !c.rig || !m) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(view.width * dpr), ph = Math.round(view.height * dpr);
    if (this.cw !== pw || this.ch !== ph) { this.wt.width = pw; this.wt.height = ph; this.cw = pw; this.ch = ph; }
    const ctx = this.wt.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    const rig = c.rig;
    const bi = Math.max(0, rig.bones.findIndex((b) => b.id === bonesMode.selected));
    const skin = skinOf(rig, rect);
    const pts = skinPoints(skin, boneMatrices(rig, rot));
    const nv = skin.rx.length;
    const sx = new Float32Array(nv), sy = new Float32Array(nv), w = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      const [x, y] = this.place(a, m, rect, view, pts[v * 2], pts[v * 2 + 1]);
      sx[v] = x; sy[v] = y;
      w[v] = weightAt(skin, bi, v);
    }
    ctx.lineWidth = 0.75;
    ctx.lineJoin = 'round';
    for (let j = 0; j < skin.rows; j++) {
      for (let i = 0; i < skin.cols; i++) {
        const v0 = j * (skin.cols + 1) + i, v1 = v0 + 1, v2 = v0 + skin.cols + 1, v3 = v2 + 1;
        const col = heat((w[v0] + w[v1] + w[v2] + w[v3]) / 4);
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(sx[v0], sy[v0]); ctx.lineTo(sx[v1], sy[v1]); ctx.lineTo(sx[v3], sy[v3]); ctx.lineTo(sx[v2], sy[v2]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  private target(): Content | null {
    const sel = this.engine.selected;
    return bonesMode.id && sel.length === 1 && sel[0].id === bonesMode.id ? sel[0] : null;
  }

  /** Pointer to content space (before any Warp), using the block's current move / scale / rotation. */
  private toLocal(e: PointerEvent, c: Content): [number, number] | null {
    const m = this.engine.movie, v = this.view;
    if (!m || !v) return null;
    const [lx, ly] = stageLocal(e);
    const sx = (lx - v.ox) / v.scale, sy = (ly - v.oy) / v.scale;
    const out = [0, 0];
    stageToLocal(animate(c, this.engine.frame - c.start), m.width, m.height, sx, sy, out);
    return [out[0], out[1]];
  }

  private down(e: PointerEvent): void {
    const c = this.target();
    if (!c || e.button !== 0 || this.drag) return;
    const node = e.target as Element;
    const bi = node.hasAttribute('data-i') ? Number(node.getAttribute('data-i')) : -1;
    const bone = bi >= 0 ? c.rig?.bones[bi] : undefined;
    if (bonesMode.tool === 'rig') {
      const onTip = !!bone && node.classList.contains('fm-bone-tip');
      if (bone && !onTip) { bonesMode.select(bone.id); e.preventDefault(); return; }
      const p = this.toLocal(e, c);
      if (!p || !(onTip || node.classList.contains('fm-bones-hit'))) return;
      const bones = c.rig?.bones ?? [];
      // a press on a tip grows that bone; elsewhere the new bone hangs from the selected (else the last) bone
      const parent = e.altKey && !onTip ? undefined : onTip ? bone : bones.find((b) => b.id === bonesMode.selected) ?? bones[bones.length - 1];
      this.drag = { kind: 'draw', id: c.id, parent: parent?.id, from: parent ? boneTip(parent) : p, pointer: e.pointerId };
      node.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (!bone || !this.engine.isOver(c)) return;
    bonesMode.select(bone.id);
    this.drag = { kind: 'pose', id: c.id, bone: bone.id, tag: `bones-${Date.now()}`, pointer: e.pointerId };
    node.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (this.engine.mode === 'perform') this.beginRec(this.drag, c);
  }

  /** Perform mode: the drag plays the movie from the Playhead and records this bone's rotation. */
  private beginRec(d: Extract<Drag, { kind: 'pose' }>, c: Content): void {
    d.rec = { rec: new Recorder('bones', [d.bone]), start: c.start, last: null };
    perform.setRecording(true);
    this.offWrap?.();
    this.offWrap = this.engine.on('wrap', () => {
      const last = (this.engine.movie?.duration ?? 1) - 1;
      this.engine.stop();
      queueMicrotask(() => this.engine.seek(last));
    });
    this.engine.play();
  }

  private move(e: PointerEvent): void {
    const d = this.drag, v = this.view;
    if (!d || !v || e.pointerId !== d.pointer) return;
    const c = this.engine.selected.find((x) => x.id === d.id);
    if (!c) return;
    const p = this.toLocal(e, c);
    if (!p) return;
    if (d.kind === 'draw') {
      const m = this.engine.movie;
      if (!m) return;
      const a = animate(c, this.engine.frame - c.start), rect = contentRect(c, m);
      const [x1, y1] = this.place(a, m, rect, v, d.from[0], d.from[1]);
      const [x2, y2] = this.place(a, m, rect, v, p[0], p[1]);
      this.ghost.removeAttribute('hidden');
      this.ghost.setAttribute('x1', x1.toFixed(1)); this.ghost.setAttribute('y1', y1.toFixed(1));
      this.ghost.setAttribute('x2', x2.toFixed(1)); this.ghost.setAttribute('y2', y2.toFixed(1));
      return;
    }
    const rig = c.rig;
    if (!rig) return;
    const a = animate(c, this.engine.frame - c.start);
    const posed = posedBones(rig, a.bones);
    const bi = rig.bones.findIndex((b) => b.id === d.bone);
    if (bi < 0) return;
    const head = posed[bi].head;
    const target = (Math.atan2(p[1] - head[1], p[0] - head[0]) * 180) / Math.PI;
    const r = Math.round(rotationToward(rig, a.bones, d.bone, target) * 10) / 10;
    if (d.rec) {
      d.rec.last = r;
      this.sample(d);
      return;
    }
    const local = this.engine.frame - c.start;
    if (local < 0 || local >= c.duration) return;
    const ease = newKeyState().lastEase;
    this.engine.run('Pose Bone', (mv) => ops.updateContent(mv, d.id, (cc) => writeBone(cc, d.bone, local, r, mv.addKeyAtStart, ease)), d.tag);
  }

  private sample(d: Extract<Drag, { kind: 'pose' }>): void {
    const r = d.rec;
    if (!r || r.last === null) return;
    r.rec.add(this.engine.frame - r.start, { [d.bone]: r.last });
    this.commit(d, 0);
  }

  private commit(d: Extract<Drag, { kind: 'pose' }>, filtering: number): void {
    const r = d.rec;
    if (!r) return;
    const take = r.rec.finish(filtering);
    if (!take) return;
    this.engine.run('Perform Bone', (mv) => ops.updateContent(mv, d.id, (c) => applyTake(c, take, 'linear', roomFor(mv, d.id))), d.tag);
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    this.ghost.setAttribute('hidden', '');
    if (d.kind === 'draw') {
      const c = this.engine.selected.find((x) => x.id === d.id);
      const p = c && e.type === 'pointerup' ? this.toLocal(e, c) : null;
      if (c && p) {
        const dx = p[0] - d.from[0], dy = p[1] - d.from[1], len = Math.hypot(dx, dy);
        if (len >= MIN_BONE) {
          const id = nextBoneId(c.rig);
          this.engine.run('Add Bone', (mv) => ops.updateContent(mv, d.id, (cc) => addBone(cc, { id, parent: d.parent, x: round(d.from[0]), y: round(d.from[1]), length: round(len), angle: round((Math.atan2(dy, dx) * 180) / Math.PI) })));
          bonesMode.select(id);
        } else bonesMode.select(null);
      }
      this.engine.endGesture();
    } else {
      if (d.rec) {
        this.offWrap?.();
        this.offWrap = null;
        if (d.rec.last !== null) d.rec.rec.add(this.engine.frame - d.rec.start, { [d.bone]: d.rec.last });
        this.engine.stop();
        this.commit(d, perform.filtering);
        perform.setRecording(false);
      }
      this.engine.endGesture();
    }
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* released */ }
  }

  /** Delete removes the selected bone (and the bones that hang from it) while rigging. */
  private key(e: KeyboardEvent): void {
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || bonesMode.tool !== 'rig' || !bonesMode.selected || !this.view || !this.target()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    e.stopPropagation();
    removeSelectedBone(this.engine);
  }
}

function round(n: number): number { return Math.round(n * 10) / 10; }

/** Write one bone's rotation at a content-local frame; a fresh channel also gets a rest key at 0 when "key at start" is on. */
export function writeBone(c: Content, bone: string, local: number, value: number, keyAtStart: boolean, ease: Ease): Content {
  const lane = laneOf(c, 'bones');
  const fresh = !lane;
  const empty = !lane?.channels[bone]?.length;
  let out = c;
  if (empty && keyAtStart && local > 0) out = keyOps.setKeys(out, 'bones', 0, { [bone]: 0 }, ease);
  out = keyOps.setKeys(out, 'bones', local, { [bone]: value }, empty ? ease : undefined);
  return fresh ? keyOps.setExpanded(out, 'bones', false) : out;
}

/** Remove the selected bone of the selected block (one undo step). */
export function removeSelectedBone(engine: Engine): void {
  const id = bonesMode.id, bone = bonesMode.selected;
  if (!id || !bone) return;
  engine.run('Delete Bone', (mv) => ops.updateContent(mv, id, (c) => deleteBone(c, bone)));
  bonesMode.select(null);
}
