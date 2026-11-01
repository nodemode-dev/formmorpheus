// Brush Studio: the per-setting popover. A setting that answers to the pen carries a small graph button; it opens
// this card beside the row with a typed value, the setting's own pressure graph (its own nodes and response speed),
// the tilt trigger angle on a quarter circle, or the barrel roll switch. One card is built once and re-aimed at
// whichever row opened it; every change goes through the studio's edit() so Undo and the live pad see it.

import '../styles/brush-studio-pop.css';
import { el, q, setClass, setHidden, setText } from './dom';
import { t } from './i18n';
import type { Brush } from '../paint/types';
import { buildCurvePanel, type CurvePanel } from './brush-studio-curves';
import type { NumParam } from './brush-studio-params';

type Chan = 'size' | 'opacity' | 'flow' | 'bleed' | 'roundness' | 'tilt';
const CHANS: Chan[] = ['size', 'opacity', 'flow', 'bleed', 'roundness', 'tilt'];
const SVGNS = 'http://www.w3.org/2000/svg';
const MAX_ANGLE = 80;
const R = 86;

export const ICON_ADV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16"/><path d="M6 17c5 0 5-10 12-10"/></svg>';

export class SettingPop {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly val: HTMLInputElement;
  private readonly unit: HTMLElement;
  private readonly pressureBox: HTMLElement;
  private readonly tiltBox: HTMLElement;
  private readonly rollBox: HTMLElement;
  private readonly panels = new Map<Chan, CurvePanel>();
  private readonly arc: SVGPathElement;
  private readonly knob: SVGCircleElement;
  private readonly angleOut: HTMLElement;
  private readonly rollRel: HTMLInputElement;
  private param: NumParam | null = null;
  private anchor: HTMLElement | null = null;
  private drag = false;
  private brush: Brush | null = null;
  private readonly down = (e: PointerEvent): void => {
    const n = e.target as Node | null;
    if (!n || this.root.contains(n) || this.anchor?.contains(n)) return;
    this.close();
  };

  constructor(private readonly host: HTMLElement, private readonly edit: (id: string, fn: (b: Brush) => void) => void) {
    this.root = el<HTMLElement>(`<div class="fm-bs-pop" role="dialog" aria-label="${t('Pen settings')}" hidden>
      <div class="fm-bs-pop-head"><span class="fm-bs-pop-title"></span><button type="button" class="fm-bs-btn is-small" data-pop="close">${t('Done')}</button></div>
      <label class="fm-bs-pop-val"><span>${t('Value')}</span><input type="number" step="1"><em></em></label>
      <div class="fm-bs-pop-sec" data-box="pressure"><div class="fm-bs-pop-h">${t('Pressure')}</div></div>
      <div class="fm-bs-pop-sec" data-box="tilt"><div class="fm-bs-pop-h">${t('Tilt')}</div></div>
      <div class="fm-bs-pop-sec" data-box="roll"><div class="fm-bs-pop-h">${t('Barrel roll')}</div>
        <p class="fm-bs-pop-note">${t('Turn the pen about its own axis. On a pen that reports no twist this has no effect.')}</p>
        <label class="fm-bs-pop-chk"><input type="checkbox"><span>${t('Relative to stroke')}</span></label></div>
    </div>`);
    this.title = q(this.root, '.fm-bs-pop-title');
    this.val = q(this.root, '.fm-bs-pop-val input');
    this.unit = q(this.root, '.fm-bs-pop-val em');
    this.pressureBox = q(this.root, '[data-box="pressure"]');
    this.tiltBox = q(this.root, '[data-box="tilt"]');
    this.rollBox = q(this.root, '[data-box="roll"]');
    this.rollRel = q(this.rollBox, 'input');
    for (const ch of CHANS) {
      const p = buildCurvePanel(edit, ch);
      p.root.dataset.ch = ch;
      this.panels.set(ch, p);
      (ch === 'tilt' ? this.tiltBox : this.pressureBox).appendChild(p.root);
    }
    // the trigger angle: a quarter circle, upright pen at the left edge, a flat pen along the bottom
    const wrap = el<HTMLElement>(`<div class="fm-bs-pop-angle"><svg viewBox="-6 -6 112 112" class="fm-bs-pop-svg" role="slider" aria-label="${t('Trigger angle')}" aria-valuemin="0" aria-valuemax="${MAX_ANGLE}" tabindex="0"></svg><div class="fm-bs-pop-angle-out"></div></div>`);
    const svg = q<SVGSVGElement>(wrap, 'svg');
    const mk = <K extends keyof SVGElementTagNameMap>(n: K, a: Record<string, string>): SVGElementTagNameMap[K] => { const x = document.createElementNS(SVGNS, n); for (const k in a) x.setAttribute(k, a[k]); svg.appendChild(x); return x; };
    mk('path', { d: `M0 100V${100 - R}A${R} ${R} 0 0 1 ${R} 100Z`, class: 'fm-bs-pop-quad' });
    for (const g of [15, 30, 45, 60, 75]) {
      const a = (g * Math.PI) / 180;
      mk('line', { x1: '0', y1: '100', x2: (Math.sin(a) * R).toFixed(1), y2: (100 - Math.cos(a) * R).toFixed(1), class: 'fm-bs-pop-tick' });
    }
    this.arc = mk('path', { d: 'M0 100', class: 'fm-bs-pop-sweep' });
    this.knob = mk('circle', { r: '5', class: 'fm-bs-pop-knob', cx: '0', cy: '100' });
    this.angleOut = q(wrap, '.fm-bs-pop-angle-out');
    this.tiltBox.appendChild(wrap);
    host.appendChild(this.root);

    this.root.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-pop="close"]')) this.close(); });
    this.root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } });
    this.val.addEventListener('change', () => {
      const p = this.param, v = this.val.valueAsNumber;
      if (!p || !Number.isFinite(v)) { this.sync(this.brush); return; }
      this.edit(p.id, (b) => p.set(b, Math.min(p.max, Math.max(p.min, v / p.mul))));
    });
    this.rollRel.addEventListener('change', () => this.edit('rollRelative', (b) => { if (this.rollRel.checked) b.rollRelative = true; else delete b.rollRelative; }));
    const at = (e: PointerEvent): number => {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 112 - 6, y = ((e.clientY - r.top) / r.height) * 112 - 6;
      return Math.min(MAX_ANGLE, Math.max(0, Math.round((Math.atan2(x, 100 - y) * 180) / Math.PI)));
    };
    const setAngle = (a: number): void => this.edit('tiltAngle', (b) => { if (a <= 0) delete b.tiltAngle; else b.tiltAngle = a; });
    svg.addEventListener('pointerdown', (e) => { this.drag = true; svg.setPointerCapture(e.pointerId); setAngle(at(e)); e.preventDefault(); });
    svg.addEventListener('pointermove', (e) => { if (this.drag) setAngle(at(e)); });
    const end = (e: PointerEvent): void => { this.drag = false; if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId); };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('keydown', (e) => {
      const cur = this.brush?.tiltAngle ?? 0;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setAngle(Math.min(MAX_ANGLE, cur + step)); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setAngle(Math.max(0, cur - step)); }
    });
  }

  isOpen(): boolean { return !this.root.hidden; }

  /** Opens the card for a row; the card sits beside the row, to the left of the settings column. */
  open(anchor: HTMLElement, p: NumParam, b: Brush): void {
    if (!p.adv) return;
    this.anchor = anchor;
    this.param = p;
    this.brush = b;
    setText(this.title, t(p.label));
    const mode = p.adv.mode, ch = p.adv.ch;
    setHidden(this.pressureBox, mode !== 'pressure');
    setHidden(this.tiltBox, mode !== 'tilt');
    setHidden(this.rollBox, mode !== 'roll');
    for (const [k, panel] of this.panels) setHidden(panel.root, k !== ch);
    setHidden(q(this.tiltBox, '.fm-bs-pop-angle'), !(mode === 'tilt'));
    this.sync(b);
    this.root.hidden = false;
    const ar = anchor.getBoundingClientRect(), hr = this.host.getBoundingClientRect();
    const w = this.root.offsetWidth, h = this.root.offsetHeight;
    // beside the settings column, over the pad, so the rows stay readable
    const edge = anchor.closest('.fm-bs-side')?.getBoundingClientRect().left ?? ar.left;
    const left = Math.max(8, edge - hr.left - w - 10);
    const top = Math.min(Math.max(56, ar.top - hr.top - 24), Math.max(56, hr.height - h - 8));
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    document.addEventListener('pointerdown', this.down, true);
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.removeEventListener('pointerdown', this.down, true);
    const a = this.anchor;
    this.anchor = null;
    if (a?.isConnected) a.focus({ preventScroll: true });
  }

  sync(b: Brush | null): void {
    if (!b) return;
    this.brush = b;
    const p = this.param;
    if (!p || this.root.hidden && !this.anchor) return;
    for (const panel of this.panels.values()) panel.sync(b);
    if (document.activeElement !== this.val) {
      const nv = String(Math.round(p.get(b) * p.mul * 100) / 100);
      if (this.val.value !== nv) this.val.value = nv;
    }
    this.val.min = String(p.min * p.mul); this.val.max = String(p.max * p.mul); this.val.step = String(Math.round(p.step * p.mul * 1000) / 1000);
    setText(this.unit, p.unit.trim());
    const a = b.tiltAngle ?? 0, rad = (a * Math.PI) / 180;
    const kx = Math.sin(rad) * R, ky = 100 - Math.cos(rad) * R;
    this.knob.setAttribute('cx', kx.toFixed(1));
    this.knob.setAttribute('cy', ky.toFixed(1));
    this.arc.setAttribute('d', a > 0 ? `M0 ${100 - R}A${R} ${R} 0 0 1 ${kx.toFixed(1)} ${ky.toFixed(1)}L0 100Z` : 'M0 100');
    q(this.tiltBox, 'svg').setAttribute('aria-valuenow', String(a));
    setText(this.angleOut, `${t('Trigger angle')}: ${a}°`);
    if (this.rollRel.checked !== !!b.rollRelative) this.rollRel.checked = !!b.rollRelative;
    setClass(this.root, 'has-curve', !!(p.adv?.ch && b.curves?.[p.adv.ch]));
  }
}
