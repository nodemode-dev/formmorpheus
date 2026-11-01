// The Shape panel: a glass card for Shape, Solid and an Adjustment's mask. Every parameter has a slider, a number
// and a key button (a diamond: press to animate it, press again at another frame for another key). Edits are one
// merged undo step per gesture; a parameter that already has keys writes a key at the Playhead.
import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import * as ops from '../engine/ops';
import { animate } from '../engine/keys';
import { MAX_STOPS, SHAPE_CHANNELS, defaultStops, hexOf, resolveShape, rgbOf, type ChanInfo } from '../engine/shape';
import { isKeyed, keyParam, maskShape, unkeyParam, withShape, writeParams } from '../engine/shape-ops';
import type { ShapeDef, ShapePaint, ShapeStroke, ShapeType } from '../engine/shape-types';
import type { Content } from '../engine/types';
import { newKeyState } from './action-menu';
import { el, q, setClass, setHidden, setText } from './dom';
import { Popover } from './popover';
import '../styles/shape.css';

type Tab = 'shape' | 'fill' | 'stroke' | 'trim' | 'mask';
interface Row { ch: ChanInfo; wrap: HTMLElement; range: HTMLInputElement; num: HTMLInputElement; key: HTMLButtonElement }

const DIAMOND = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1.5L14.5 8 8 14.5 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const TYPES: Array<[ShapeType, string]> = [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon'], ['star', 'Star'], ['line', 'Line'], ['arrow', 'Arrow']];
const FILLS: Array<['none' | 'solid' | 'linear' | 'radial', string]> = [['none', 'None'], ['solid', 'Solid'], ['linear', 'Linear'], ['radial', 'Radial']];
const ALIGNS: Array<[NonNullable<ShapeStroke['align']>, string]> = [['inside', 'Inside'], ['center', 'Center'], ['outside', 'Outside']];
const CAPS: Array<[NonNullable<ShapeStroke['cap']>, string]> = [['butt', 'Butt'], ['round', 'Round'], ['square', 'Square']];
const JOINS: Array<[NonNullable<ShapeStroke['join']>, string]> = [['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']];

const rowsFor: Record<Exclude<Tab, 'mask'>, string[]> = {
  shape: ['w', 'h', 'radius', 'sides', 'points', 'inner'],
  fill: ['fillA', 'ga', 'gcx', 'gcy'],
  stroke: ['strokeW', 'strokeA', 'dash', 'gap', 'dashOffset'],
  trim: ['trimStart', 'trimEnd', 'trimOffset'],
};

export class ShapePanel {
  private readonly pop = new Popover('fm-tc fm-shp', 348);
  private id = '';
  private tab: Tab = 'shape';
  private tag: string | null = null;
  private readonly rows = new Map<string, Row>();
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  private readonly title: HTMLElement;
  private readonly typeSeg = new Map<string, HTMLButtonElement>();
  private readonly fillSeg = new Map<string, HTMLButtonElement>();
  private readonly alignSeg = new Map<string, HTMLButtonElement>();
  private readonly capSeg = new Map<string, HTMLButtonElement>();
  private readonly joinSeg = new Map<string, HTMLButtonElement>();
  private readonly fillColor: HTMLInputElement;
  private readonly strokeColor: HTMLInputElement;
  private readonly stops: Array<{ wrap: HTMLElement; color: HTMLInputElement; del: HTMLButtonElement; key: HTMLButtonElement }> = [];
  private readonly addStop: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly closed: HTMLButtonElement;
  private readonly maskBtn: HTMLButtonElement;
  private readonly maskInvert: HTMLButtonElement;
  private readonly maskHost: HTMLElement;
  private readonly solidHint: HTMLElement;

  constructor(private readonly engine: Engine) {
    const root = el<HTMLElement>(`<div class="fm-tc-body fm-shp-body">
      <div class="fm-shp-title"></div>
      <div class="fm-tc-tabs" role="tablist"></div>
      <div class="fm-tc-panes">
        <div class="fm-tc-pane" data-pane="shape">
          <div class="fm-tc-row fm-shp-typerow"><span>Type</span><div class="fm-tc-seg fm-tc-seg-wide fm-shp-types" data-g="type"></div></div>
          <div class="fm-shp-rows" data-rows="shape"></div>
          <div class="fm-shp-hint" data-h="solid">A width or height of 0 fills the whole movie.</div>
          <div class="fm-shp-hint" data-h="path">Drag the nodes and handles on the Stage. Double-click the outline to add a node; Alt-click a node to sharpen it; Delete removes it.</div>
          <div class="fm-tc-row fm-shp-pathrow"><span>Path</span><button class="fm-tc-mini" type="button" data-f="closed">Close path</button></div>
        </div>
        <div class="fm-tc-pane" data-pane="fill" hidden>
          <div class="fm-tc-row"><span>Fill</span><div class="fm-tc-seg fm-tc-seg-wide" data-g="fill"></div></div>
          <div class="fm-tc-row" data-r="fillcolor"><span>Color</span><label class="fm-tc-swatch"><input type="color" data-f="fillColor" aria-label="Fill color"></label><span class="fm-shp-keyc"></span></div>
          <div class="fm-shp-stops" data-g="stops"></div>
          <div class="fm-tc-row" data-r="addstop"><span>Stops</span><button class="fm-tc-mini" type="button" data-f="addStop">Add stop</button></div>
          <div class="fm-shp-rows" data-rows="fill"></div>
        </div>
        <div class="fm-tc-pane" data-pane="stroke" hidden>
          <div class="fm-tc-row"><span>Color</span><label class="fm-tc-swatch"><input type="color" data-f="strokeColor" aria-label="Stroke color"></label><span class="fm-shp-keyc"></span></div>
          <div class="fm-shp-rows" data-rows="stroke"></div>
          <div class="fm-tc-row"><span>Align</span><div class="fm-tc-seg fm-tc-seg-wide" data-g="align"></div></div>
          <div class="fm-tc-row"><span>Caps</span><div class="fm-tc-seg fm-tc-seg-wide" data-g="cap"></div></div>
          <div class="fm-tc-row"><span>Joins</span><div class="fm-tc-seg fm-tc-seg-wide" data-g="join"></div></div>
        </div>
        <div class="fm-tc-pane" data-pane="trim" hidden>
          <div class="fm-shp-hint">Trim path shows part of the outline's stroke: key End from 0 to 100% to draw a line on, or move Offset to travel it round.</div>
          <div class="fm-shp-rows" data-rows="trim"></div>
        </div>
        <div class="fm-tc-pane" data-pane="mask" hidden>
          <div class="fm-shp-hint">This block applies its filters (Action menu, Filter) to everything on the tracks below it, while it plays. A mask limits where.</div>
          <div class="fm-tc-row"><span>Mask</span><button class="fm-tc-mini" type="button" data-f="mask">Add mask</button><button class="fm-tc-mini" type="button" data-f="invert">Invert</button></div>
          <div class="fm-shp-mask" data-g="mask"></div>
        </div>
      </div>
    </div>`);
    this.pop.body.appendChild(root);
    this.title = q(root, '.fm-shp-title');
    this.note = q(root, '[data-h="path"]');
    this.solidHint = q(root, '[data-h="solid"]');
    this.closed = q<HTMLButtonElement>(root, '[data-f="closed"]');
    this.maskBtn = q<HTMLButtonElement>(root, '[data-f="mask"]');
    this.maskInvert = q<HTMLButtonElement>(root, '[data-f="invert"]');
    this.maskHost = q(root, '[data-g="mask"]');
    this.fillColor = q<HTMLInputElement>(root, '[data-f="fillColor"]');
    this.strokeColor = q<HTMLInputElement>(root, '[data-f="strokeColor"]');
    this.addStop = q<HTMLButtonElement>(root, '[data-f="addStop"]');

    const tabBar = q(root, '.fm-tc-tabs');
    for (const [id, label] of [['shape', 'Shape'], ['fill', 'Fill'], ['stroke', 'Stroke'], ['trim', 'Trim'], ['mask', 'Mask']] as Array<[Tab, string]>) {
      const b = el<HTMLButtonElement>(`<button class="fm-tc-tab" type="button" role="tab" aria-selected="false"></button>`);
      setText(b, label);
      b.addEventListener('click', () => { this.tab = id; this.sync(); });
      this.tabs.set(id, b);
      this.panes.set(id, q(root, `[data-pane="${id}"]`));
      tabBar.appendChild(b);
    }

    const seg = <T extends string>(host: HTMLElement, store: Map<string, HTMLButtonElement>, list: Array<[T, string]>, run: (k: T) => void): void => {
      for (const [k, label] of list) {
        const b = el<HTMLButtonElement>('<button class="fm-tc-seg-btn" type="button" aria-pressed="false"></button>');
        setText(b, label);
        b.addEventListener('click', () => { run(k); this.end(); });
        store.set(k, b);
        host.appendChild(b);
      }
    };
    seg(q(root, '[data-g="type"]'), this.typeSeg, TYPES, (k) => this.edit('Shape type', (d) => this.retype(d, k)));
    seg(q(root, '[data-g="fill"]'), this.fillSeg, FILLS, (k) => this.edit('Fill type', (d) => this.refill(d, k)));
    seg(q(root, '[data-g="align"]'), this.alignSeg, ALIGNS, (k) => this.edit('Stroke align', (d) => this.stroke(d, { align: k })));
    seg(q(root, '[data-g="cap"]'), this.capSeg, CAPS, (k) => this.edit('Stroke caps', (d) => this.stroke(d, { cap: k })));
    seg(q(root, '[data-g="join"]'), this.joinSeg, JOINS, (k) => this.edit('Stroke joins', (d) => this.stroke(d, { join: k })));

    for (const tab of Object.keys(rowsFor) as Array<keyof typeof rowsFor>) {
      const host = q(root, `[data-rows="${tab}"]`);
      for (const id of rowsFor[tab]) host.appendChild(this.makeRow(id).wrap);
    }
    this.fillColor.addEventListener('input', () => this.color('fill', this.fillColor.value));
    this.fillColor.addEventListener('change', () => this.end());
    this.strokeColor.addEventListener('input', () => this.color('stroke', this.strokeColor.value));
    this.strokeColor.addEventListener('change', () => this.end());

    // gradient stops: colour, position (keyable) and remove
    const stopHost = q(root, '[data-g="stops"]');
    for (let i = 0; i < MAX_STOPS; i++) {
      const wrap = el<HTMLElement>(`<div class="fm-shp-stop"><label class="fm-tc-swatch"><input type="color" aria-label="Stop color"></label><span class="fm-shp-stopat"></span><button class="fm-shp-key fm-shp-stopkey" type="button" title="Animate this color" aria-label="Animate this color" aria-pressed="false">${DIAMOND}</button><button class="fm-tc-mini fm-shp-del" type="button" title="Remove stop" aria-label="Remove stop">x</button></div>`);
      const color = q<HTMLInputElement>(wrap, 'input[type="color"]');
      const key = q<HTMLButtonElement>(wrap, '.fm-shp-stopkey');
      const del = q<HTMLButtonElement>(wrap, '.fm-shp-del');
      const at = q(wrap, '.fm-shp-stopat');
      at.appendChild(this.makeRow(`o${i}`, true).wrap);
      // written as three channels: a saved color, or a key when the stop's color is animated
      color.addEventListener('input', () => { const [r, g, b] = rgbOf(color.value); this.write({ [`g${i}R`]: r, [`g${i}G`]: g, [`g${i}B`]: b }); });
      color.addEventListener('change', () => this.end());
      key.addEventListener('click', (e) => { this.toggleStopKey(i, e.altKey); });
      del.addEventListener('click', () => { this.edit('Remove gradient stop', (d) => this.removeStop(d, i)); this.end(); });
      this.stops.push({ wrap, color, del, key });
      stopHost.appendChild(wrap);
    }
    this.addStop.addEventListener('click', () => { this.edit('Add gradient stop', (d) => this.insertStop(d)); this.end(); });
    this.closed.addEventListener('click', () => { this.edit('Close path', (d) => ({ ...d, closed: d.closed !== true, fill: d.closed !== true && !d.fill ? { kind: 'solid', color: '#3a8bff' } : d.fill })); this.end(); });
    this.maskBtn.addEventListener('click', () => {
      const m = this.engine.movie;
      if (!m) return;
      this.engine.run('Adjustment mask', (mv) => ops.updateContent(mv, this.id, (c) => (c.shape ? (() => { const { shape: _s, ...rest } = c; return rest as Content; })() : { ...c, shape: maskShape(mv) })));
      this.end();
    });
    this.maskInvert.addEventListener('click', () => { this.engine.run('Invert mask', (mv) => ops.patchContent(mv, [this.id], { maskInvert: !this.cur()?.maskInvert })); this.end(); });
    // the mask outline reuses the shape rows: type, size and feather
    const mHost = this.maskHost;
    const mseg = el<HTMLElement>('<div class="fm-tc-row"><span>Type</span><div class="fm-tc-seg fm-tc-seg-wide" data-g="mtype"></div></div>');
    mHost.appendChild(mseg);
    this.maskTypes = q(mseg, '[data-g="mtype"]');
    for (const [k, label] of TYPES.slice(0, 4)) {
      const b = el<HTMLButtonElement>('<button class="fm-tc-seg-btn" type="button" aria-pressed="false"></button>');
      setText(b, label);
      b.addEventListener('click', () => { this.edit('Mask shape', (d) => this.retype(d, k)); this.end(); });
      this.typeSeg.set('m:' + k, b);
      this.maskTypes.appendChild(b);
    }
    for (const id of ['w', 'h', 'radius', 'sides', 'points', 'inner', 'feather']) {
      const r = this.makeRow(id, false, 'm:');
      mHost.appendChild(r.wrap);
    }

    this.pop.onHide(() => { this.id = ''; this.tag = null; });
    for (const ev of ['time', 'movie', 'selection'] as const) this.engine.on(ev, () => { if (this.pop.isOpen) this.sync(); });
  }

  private maskTypes!: HTMLElement;

  get isOpen(): boolean { return this.pop.isOpen; }

  hide(): void { this.pop.hide(); }

  /** Opens for the selected Shape, Solid or Adjustment (or the one named). */
  open(at: HTMLElement | { x: number; y: number }, id?: string): void {
    const c = id ? locate(this.engine.movie as NonNullable<Engine['movie']>, id)?.content : this.engine.selected[0];
    if (!c || !['shape', 'solid', 'adjust'].includes(c.kind)) return;
    this.id = c.id;
    this.tab = c.kind === 'adjust' ? 'mask' : 'shape';
    this.sync();
    if (at instanceof HTMLElement) this.pop.showFor(at, 'above'); else this.pop.showAt(at.x, at.y);
  }

  private cur(): Content | null {
    const m = this.engine.movie;
    return m && this.id ? locate(m, this.id)?.content ?? null : null;
  }

  private end(): void { this.engine.endGesture(); this.tag = null; }

  // ---- row building --------------------------------------------------------

  private makeRow(id: string, bare = false, prefix = ''): Row {
    const ch = SHAPE_CHANNELS.find((s) => s.id === id) as ChanInfo;
    const wrap = el<HTMLElement>(`<div class="fm-tc-row fm-shp-row${bare ? ' is-bare' : ''}"><span class="fm-shp-lab"></span><input class="fm-cm-range fm-tc-range" type="range" min="${ch.min}" max="${ch.max}" step="${ch.step}"><input class="fm-tc-num" type="number" step="${ch.step * ch.display}"><button class="fm-shp-key" type="button" aria-pressed="false">${DIAMOND}</button></div>`);
    setText(q(wrap, '.fm-shp-lab'), ch.label);
    const range = q<HTMLInputElement>(wrap, 'input[type="range"]');
    const num = q<HTMLInputElement>(wrap, 'input[type="number"]');
    const key = q<HTMLButtonElement>(wrap, '.fm-shp-key');
    range.setAttribute('aria-label', ch.label);
    num.setAttribute('aria-label', `${ch.label} value`);
    const put = (v: number): void => {
      if (!Number.isFinite(v)) return;
      const val = Math.min(ch.max, Math.max(ch.min, v));
      this.write({ [id]: ch.step >= 1 ? Math.round(val) : val });
    };
    range.addEventListener('input', () => put(range.valueAsNumber));
    range.addEventListener('change', () => this.end());
    num.addEventListener('input', () => { if (num.value !== '') put(num.valueAsNumber / ch.display); });
    num.addEventListener('change', () => this.end());
    key.addEventListener('click', (e) => this.toggleKey(id, e.altKey));
    const row: Row = { ch, wrap, range, num, key };
    this.rows.set(prefix + id, row);
    if (!prefix) this.rows.set(id, row);
    return row;
  }

  // ---- writing -------------------------------------------------------------

  private edit(label: string, fn: (d: ShapeDef) => ShapeDef): void {
    const id = this.id;
    this.tag ??= `shp-${Date.now()}`;
    this.engine.run(label, (m) => ops.updateContent(m, id, (c) => withShape(c, fn)), this.tag);
  }

  private write(vals: Record<string, number>): void {
    const id = this.id, frame = this.engine.frame;
    this.tag ??= `shp-${Date.now()}`;
    this.engine.run('Shape', (m) => ops.updateContent(m, id, (c) => {
      const local = Math.max(0, Math.min(c.duration - 1, frame - c.start));
      return writeParams(c, vals, local, m.addKeyAtStart, newKeyState().lastEase);
    }), this.tag);
  }

  private color(which: 'fill' | 'stroke', hex: string): void {
    const [r, g, b] = rgbOf(hex);
    const pre = which === 'fill' ? 'fill' : 'stroke';
    const c = this.cur();
    // a colour with no stroke yet starts one so the swatch has an effect
    if (which === 'stroke' && c?.shape && !c.shape.stroke) this.edit('Stroke', (d) => ({ ...d, stroke: { color: hex, width: 12, cap: 'round', join: 'round' } }));
    if (which === 'fill' && c?.shape && !c.shape.fill) this.edit('Fill', (d) => ({ ...d, fill: { kind: 'solid', color: hex } }));
    this.write({ [`${pre}R`]: r, [`${pre}G`]: g, [`${pre}B`]: b });
  }

  private toggleKey(id: string, remove: boolean): void {
    const c = this.cur(), frame = this.engine.frame;
    if (!c) return;
    const v = resolveShape(c.shape, animate(c, frame - c.start).shape)[id];
    this.engine.run(remove ? 'Remove shape keys' : 'Shape keyframe', (m) => ops.updateContent(m, this.id, (cc) => {
      const local = Math.max(0, Math.min(cc.duration - 1, frame - cc.start));
      return remove ? unkeyParam(cc, id, local, v) : keyParam(cc, id, local, v, m.addKeyAtStart, newKeyState().lastEase);
    }));
    this.end();
  }

  /** Keys the three channels of one gradient stop's color at the Playhead in one step; Alt removes the animation. */
  private toggleStopKey(i: number, remove: boolean): void {
    const c = this.cur(), frame = this.engine.frame;
    if (!c) return;
    const vals = resolveShape(c.shape, animate(c, frame - c.start).shape);
    const ids = ['R', 'G', 'B'].map((k) => `g${i}${k}`);
    this.engine.run(remove ? 'Remove shape keys' : 'Shape keyframe', (m) => ops.updateContent(m, this.id, (cc) => {
      const local = Math.max(0, Math.min(cc.duration - 1, frame - cc.start));
      let out = cc;
      for (const id of ids) out = remove ? unkeyParam(out, id, local, vals[id]) : keyParam(out, id, local, vals[id], m.addKeyAtStart, newKeyState().lastEase);
      return out;
    }));
    this.end();
  }

  private retype(d: ShapeDef, type: ShapeType): ShapeDef {
    if (d.type === type) return d;
    const line = type === 'line' || type === 'arrow';
    const n: ShapeDef = { ...d, type, sides: type === 'polygon' ? d.sides ?? 5 : d.sides, points: type === 'star' ? d.points ?? 5 : d.points, inner: type === 'star' ? d.inner ?? 0.5 : d.inner, radius: type === 'rect' ? d.radius ?? 0 : d.radius };
    if (type === 'arrow' && d.type !== 'arrow') n.h = 60;
    if (d.type === 'arrow' && type !== 'arrow') n.h = Math.max(40, d.w / 2);
    if (line && !d.stroke) n.stroke = { color: '#ffffff', width: 12, cap: 'round', join: 'round' };
    return n;
  }

  private refill(d: ShapeDef, kind: 'none' | 'solid' | 'linear' | 'radial'): ShapeDef {
    if (kind === 'none') return { ...d, fill: null };
    const prev = d.fill;
    const f: ShapePaint = { ...(prev ?? { color: '#3a8bff' }), kind };
    if (kind !== 'solid' && (!f.stops || f.stops.length < 2)) f.stops = defaultStops(f.color);
    return { ...d, fill: f };
  }

  private stroke(d: ShapeDef, patch: Partial<ShapeStroke>): ShapeDef {
    return { ...d, stroke: { ...(d.stroke ?? { color: '#ffffff', width: 12, cap: 'round', join: 'round' }), ...patch } };
  }

  private stopColor(d: ShapeDef, i: number, hex: string): ShapeDef {
    const f = d.fill;
    if (!f) return d;
    const stops = (f.stops && f.stops.length >= 2 ? f.stops : defaultStops(f.color)).map((s) => ({ ...s }));
    if (stops[i]) stops[i].color = hex;
    return { ...d, fill: { ...f, stops, color: i === 0 ? hex : f.color } };
  }

  private removeStop(d: ShapeDef, i: number): ShapeDef {
    const f = d.fill;
    if (!f?.stops || f.stops.length <= 2) return d;
    return { ...d, fill: { ...f, stops: f.stops.filter((_, k) => k !== i) } };
  }

  private insertStop(d: ShapeDef): ShapeDef {
    const f = d.fill;
    if (!f || f.kind === 'solid') return d;
    const stops = (f.stops && f.stops.length >= 2 ? f.stops : defaultStops(f.color)).map((s) => ({ ...s }));
    if (stops.length >= MAX_STOPS) return d;
    // splits the widest gap, the new stop taking the colour halfway between its neighbours
    let at = 0, gap = -1;
    for (let k = 0; k < stops.length - 1; k++) if (stops[k + 1].o - stops[k].o > gap) { gap = stops[k + 1].o - stops[k].o; at = k; }
    const a = rgbOf(stops[at].color), b = rgbOf(stops[at + 1].color);
    stops.splice(at + 1, 0, { o: (stops[at].o + stops[at + 1].o) / 2, color: hexOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2) });
    return { ...d, fill: { ...f, stops } };
  }

  // ---- reading -------------------------------------------------------------

  private sync(): void {
    const c = this.cur();
    if (!c || !c.shape) { if (this.pop.isOpen) this.pop.hide(); return; }
    const d = c.shape, adj = c.kind === 'adjust', solid = c.kind === 'solid', path = d.type === 'path';
    const v = resolveShape(d, animate(c, this.engine.frame - c.start).shape);
    setText(this.title, adj ? 'Adjustment' : solid ? 'Solid' : path ? 'Path' : 'Shape');
    for (const [id, b] of this.tabs) {
      const hidden = (adj && id !== 'mask') || (id === 'mask' && !adj) || (solid && (id === 'stroke' || id === 'trim'));
      setHidden(b, hidden);
      setClass(b, 'is-on', id === this.tab);
      b.setAttribute('aria-selected', String(id === this.tab));
    }
    if (this.tabs.get(this.tab)?.hidden) this.tab = adj ? 'mask' : 'shape';
    for (const [id, p] of this.panes) setHidden(p, id !== this.tab);
    setHidden(q(this.pop.el, '.fm-tc-tabs'), adj);
    const show = (id: string, on: boolean): void => {
      for (const k of [id, 'm:' + id]) { const r = this.rows.get(k); if (r) setHidden(r.wrap, !on); }
    };
    show('radius', d.type === 'rect');
    show('sides', d.type === 'polygon');
    show('points', d.type === 'star');
    show('inner', d.type === 'star');
    show('w', !path);
    show('h', !path && d.type !== 'line');
    setText(q((this.rows.get('w') as Row).wrap, '.fm-shp-lab'), d.type === 'line' || d.type === 'arrow' ? 'Length' : 'Width');
    setText(q((this.rows.get('h') as Row).wrap, '.fm-shp-lab'), d.type === 'arrow' ? 'Head size' : 'Height');
    setHidden(q(this.pop.el, '.fm-shp-typerow'), path || solid);
    setHidden(this.solidHint, !solid);
    setHidden(this.note, !path);
    setHidden(q(this.pop.el, '.fm-shp-pathrow'), !path);
    setText(this.closed, d.closed ? 'Open path' : 'Close path');
    for (const [k, b] of this.typeSeg) if (!k.startsWith('m:')) { setClass(b, 'is-on', k === d.type); b.setAttribute('aria-pressed', String(k === d.type)); }
    for (const [k, b] of this.typeSeg) if (k.startsWith('m:')) { setClass(b, 'is-on', 'm:' + d.type === k); b.setAttribute('aria-pressed', String('m:' + d.type === k)); }
    // fill
    const kind = d.fill ? d.fill.kind : 'none';
    for (const [k, b] of this.fillSeg) { setClass(b, 'is-on', k === kind); b.setAttribute('aria-pressed', String(k === kind)); }
    const grad = kind === 'linear' || kind === 'radial';
    setHidden(q(this.pop.el, '[data-r="fillcolor"]'), kind !== 'solid');
    setHidden(q(this.pop.el, '[data-g="stops"]'), !grad);
    setHidden(q(this.pop.el, '[data-r="addstop"]'), !grad);
    show('fillA', kind !== 'none');
    show('ga', kind === 'linear');
    show('gcx', kind === 'radial');
    show('gcy', kind === 'radial');
    const hex = hexOf(v.fillR, v.fillG, v.fillB);
    if (document.activeElement !== this.fillColor && this.fillColor.value !== hex) this.fillColor.value = hex;
    const shex = hexOf(v.strokeR, v.strokeG, v.strokeB);
    if (document.activeElement !== this.strokeColor && this.strokeColor.value !== shex) this.strokeColor.value = shex;
    const stops = d.fill?.stops && d.fill.stops.length >= 2 ? d.fill.stops : defaultStops(d.fill?.color);
    this.stops.forEach((s, i) => {
      setHidden(s.wrap, !grad || i >= stops.length);
      const shown = i < stops.length ? hexOf(v[`g${i}R`], v[`g${i}G`], v[`g${i}B`]) : '';
      if (shown && document.activeElement !== s.color && s.color.value !== shown) s.color.value = shown;
      const kd = !!c && ['R', 'G', 'B'].some((k) => isKeyed(c, `g${i}${k}`));
      setClass(s.key, 'is-keyed', kd);
      s.key.setAttribute('aria-pressed', String(kd));
      setHidden(s.del, stops.length <= 2);
    });
    setHidden(this.addStop, stops.length >= MAX_STOPS);
    // stroke
    const st = d.stroke;
    for (const [k, b] of this.alignSeg) { const on = (st?.align ?? 'center') === k; setClass(b, 'is-on', on); b.setAttribute('aria-pressed', String(on)); }
    for (const [k, b] of this.capSeg) { const on = (st?.cap ?? 'butt') === k; setClass(b, 'is-on', on); b.setAttribute('aria-pressed', String(on)); }
    for (const [k, b] of this.joinSeg) { const on = (st?.join ?? 'miter') === k; setClass(b, 'is-on', on); b.setAttribute('aria-pressed', String(on)); }
    // mask
    setText(this.maskBtn, d && adj && c.shape ? 'Remove mask' : 'Add mask');
    setClass(this.maskInvert, 'is-on', c.maskInvert);
    setHidden(this.maskHost, !c.shape);
    setHidden(this.maskInvert, !c.shape);
    // every row's value, range, key state
    const lim = Math.max(this.engine.movie?.width ?? 1920, this.engine.movie?.height ?? 1080) * 2;
    for (const row of this.rows.values()) {
      const id = row.ch.id;
      const val = v[id];
      if (val === undefined || !Number.isFinite(val)) continue;
      const hi = row.ch.unit === 'px' && row.ch.max >= 2000 ? Math.max(lim, val) : row.ch.max;
      if (row.range.max !== String(hi)) row.range.max = String(hi);
      if (document.activeElement !== row.range && row.range.valueAsNumber !== val) row.range.value = String(val);
      const shown = Math.round(val * row.ch.display * 100) / 100;
      if (document.activeElement !== row.num && row.num.value !== String(shown)) row.num.value = String(shown);
      const keyed = isKeyed(c, id);
      setClass(row.key, 'is-keyed', keyed);
      row.key.title = keyed ? 'Add a key here. Alt-click removes the animation.' : 'Animate this value';
      row.key.setAttribute('aria-pressed', String(keyed));
    }
  }
}
