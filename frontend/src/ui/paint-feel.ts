// Pen feel UI for Draw & Paint: the per-brush Pressure and Smoothing popover, its
// store, and the brush cursor drawn on the canvas (visibility modes, outline styles,
// shape and tilt).

import { baseAngle, tiltShape } from '../paint/dynamics';
import { type FeelOverride, type OutlineStyle } from '../paint/feel';
import type { Brush, RGB } from '../paint/types';
import { el, q, setClass, setText } from './dom';
import { Popover } from './popover';

const KEY = 'formmorpheus.paint.feel';

/** Per-brush overrides kept in this browser (the brush id is the key). */
export class FeelStore {
  private map: Record<string, FeelOverride> = {};

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.map = JSON.parse(raw) as Record<string, FeelOverride>;
    } catch { /* corrupt or blocked: no overrides */ }
  }

  get(id: string): FeelOverride { return this.map[id] ?? {}; }

  set(id: string, patch: FeelOverride): void {
    this.map[id] = { ...this.map[id], ...patch };
    this.save();
  }

  clear(id: string): void {
    delete this.map[id];
    this.save();
  }

  private save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.map)); } catch { /* this session only */ }
  }
}

const GAMMAS: { label: string; g: number | undefined }[] = [
  { label: 'Global', g: undefined }, { label: 'Soft', g: 0.6 }, { label: 'Linear', g: 1 }, { label: 'Firm', g: 1.8 },
];

export interface FeelHost {
  store: FeelStore;
  /** The global values a brush falls back to. */
  globals: () => { stabilization: number; motion: boolean; expression: number };
  changed: () => void;
}

/** Double-click a brush: Pressure curve, Stabilization, Motion filtering and Expression for that brush alone. */
export class FeelPopover {
  private readonly pop = new Popover('fm-pfeel', 264);
  private id = '';
  private readonly title: HTMLElement;
  private readonly stab: HTMLInputElement;
  private readonly stabVal: HTMLElement;
  private readonly motion: HTMLInputElement;
  private readonly expr: HTMLInputElement;
  private readonly exprVal: HTMLElement;
  private readonly exprRow: HTMLElement;
  private readonly roll: HTMLInputElement;
  private readonly gam: HTMLButtonElement[];

  constructor(private readonly host: FeelHost) {
    const body = el(`<div class="fm-pfeel-body">
      <div class="fm-pfeel-title"></div>
      <div class="fm-pfeel-sub">Pressure and smoothing</div>
      <div class="fm-pfeel-lab">Pressure curve</div>
      <div class="fm-pfeel-seg">${GAMMAS.map((g, i) => `<button type="button" data-g="${i}">${g.label}</button>`).join('')}</div>
      <label class="fm-pfeel-row"><span>Stabilization</span><output data-o="stab"></output><input type="range" min="0" max="1" step="0.01" data-i="stab"></label>
      <label class="fm-pfeel-check"><span>Motion filtering</span><input type="checkbox" data-i="motion"></label>
      <label class="fm-pfeel-row" data-row="expr"><span>Expression</span><output data-o="expr"></output><input type="range" min="0" max="1" step="0.01" data-i="expr"></label>
      <label class="fm-pfeel-check"><span>Barrel roll turns the stamp</span><input type="checkbox" data-i="roll"></label>
      <button type="button" class="fm-pfeel-reset">Use global settings</button>
    </div>`);
    this.pop.el.appendChild(body);
    this.title = q(body, '.fm-pfeel-title');
    this.stab = q<HTMLInputElement>(body, '[data-i="stab"]');
    this.stabVal = q(body, '[data-o="stab"]');
    this.motion = q<HTMLInputElement>(body, '[data-i="motion"]');
    this.expr = q<HTMLInputElement>(body, '[data-i="expr"]');
    this.exprVal = q(body, '[data-o="expr"]');
    this.exprRow = q(body, '[data-row="expr"]');
    this.roll = q<HTMLInputElement>(body, '[data-i="roll"]');
    this.gam = Array.from(body.querySelectorAll<HTMLButtonElement>('[data-g]'));
    this.gam.forEach((b, i) => b.addEventListener('click', () => this.apply({ gamma: GAMMAS[i].g }, i === 0)));
    this.stab.addEventListener('input', () => this.apply({ stabilization: this.stab.valueAsNumber }));
    this.motion.addEventListener('change', () => this.apply({ motion: this.motion.checked }));
    this.expr.addEventListener('input', () => this.apply({ expression: this.expr.valueAsNumber }));
    this.roll.addEventListener('change', () => this.apply({ roll: this.roll.checked }));
    q(body, '.fm-pfeel-reset').addEventListener('click', () => { this.host.store.clear(this.id); this.host.changed(); this.sync(); });
  }

  open(id: string, name: string, x: number, y: number): void {
    this.id = id;
    setText(this.title, name);
    this.sync();
    this.pop.showAt(x, y);
  }

  hide(): void { this.pop.hide(); }

  private apply(p: FeelOverride, dropGamma = false): void {
    if (dropGamma) {
      const cur = { ...this.host.store.get(this.id) };
      delete cur.gamma;
      this.host.store.clear(this.id);
      this.host.store.set(this.id, cur);
    } else this.host.store.set(this.id, p);
    this.host.changed();
    this.sync();
  }

  private sync(): void {
    const o = this.host.store.get(this.id), g = this.host.globals();
    const stab = o.stabilization ?? g.stabilization, motion = o.motion ?? g.motion, expr = o.expression ?? g.expression;
    if (document.activeElement !== this.stab) this.stab.value = String(stab);
    if (document.activeElement !== this.expr) this.expr.value = String(expr);
    setText(this.stabVal, `${Math.round(stab * 100)}%`);
    setText(this.exprVal, `${Math.round(expr * 100)}%`);
    this.motion.checked = motion;
    this.roll.checked = !!o.roll;
    setClass(this.exprRow, 'is-disabled', !motion);
    this.gam.forEach((b, i) => setClass(b, 'is-on', GAMMAS[i].g === o.gamma));
  }
}

// ---------------------------------------------------------------- cursor

export interface CursorShape {
  x: number;
  y: number;
  /** Radius in screen pixels. */
  r: number;
  style: OutlineStyle;
  colour: RGB;
  brush: Brush;
  tiltX: number;
  tiltY: number;
  /** Stamp angle from barrel roll in degrees, 0 when not rolling. */
  roll: number;
  stroking: boolean;
}

const luma = (c: RGB): number => (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) / 255;

/** The outline of the brush at the pointer; the caller has set the base transform. */
export function drawBrushCursor(ctx: CanvasRenderingContext2D, s: CursorShape): void {
  const b = s.brush;
  let rx = s.r, ry = s.r, angle = 0;
  const square = b.tip === 'square' || b.tip === 'chisel';
  if (s.style === 'brush') {
    const t = tiltShape(b, s.tiltX, s.tiltY);
    const rn = Math.min(1, Math.max(0.12, b.roundness * t.roundnessMul));
    ry = Math.max(1.5, s.r * rn);
    angle = t.angle ?? (s.roll ? (s.roll * Math.PI) / 180 : baseAngle(b));
  }
  const path = (): void => {
    ctx.beginPath();
    if (s.style === 'brush' && square) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(angle);
      ctx.rect(-rx, -ry, rx * 2, ry * 2);
      ctx.restore();
    } else ctx.ellipse(s.x, s.y, rx, ry, angle, 0, Math.PI * 2);
  };
  ctx.save();
  ctx.lineJoin = 'round';
  const light = luma(s.colour) > 0.55;
  path();
  if (s.style === 'colour') {
    ctx.strokeStyle = light ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.strokeStyle = `rgb(${s.colour.r}, ${s.colour.g}, ${s.colour.b})`;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (s.style === 'brush') {
    // a small centre tick so the dab position reads for flat nibs
    ctx.beginPath();
    ctx.moveTo(s.x - 3, s.y); ctx.lineTo(s.x + 3, s.y);
    ctx.moveTo(s.x, s.y - 3); ctx.lineTo(s.x, s.y + 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}
