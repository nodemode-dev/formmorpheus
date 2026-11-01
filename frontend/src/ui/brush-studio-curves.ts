// Brush Studio: the pen response curves. One small curve editor per channel (size, opacity, flow, bleed,
// roundness, tilt): click the graph to add a node (up to four), drag nodes, double-click a node to remove it,
// arrow keys nudge a focused node. Each channel but tilt also has a response speed. Built once, patched in place.

import '../styles/brush-curves.css';
import { el, q, setClass, setHidden, setText } from './dom';
import { t } from './i18n';
import type { Brush, PenCurve, PenCurves } from '../paint/types';
import { MAX_NODES, cleanPoints, curveAt, curveLut, identityCurve, isIdentity } from '../paint/curves';

type Key = keyof PenCurves;

const CHANNELS: { key: Key; label: string; speed: boolean; hint: string }[] = [
  { key: 'size', label: 'Size', speed: true, hint: 'Pressure to stamp size' },
  { key: 'opacity', label: 'Opacity', speed: true, hint: 'Pressure to opacity' },
  { key: 'flow', label: 'Flow', speed: true, hint: 'Pressure to flow' },
  { key: 'bleed', label: 'Bleed', speed: true, hint: 'Pressure to edge softness (needs Bleed above 0)' },
  { key: 'roundness', label: 'Roundness', speed: true, hint: 'Pressure to roundness (needs Pressure roundness)' },
  { key: 'tilt', label: 'Tilt', speed: false, hint: 'Lean to tilt effect' },
];

const SVGNS = 'http://www.w3.org/2000/svg';
const NODE_R = 4.2;

interface Block {
  key: Key;
  root: HTMLElement;
  svg: SVGSVGElement;
  path: SVGPathElement;
  nodes: SVGCircleElement[];
  speed: HTMLInputElement | null;
  out: HTMLElement | null;
  reset: HTMLButtonElement;
  pts: number[];
}

export interface CurvePanel {
  root: HTMLElement;
  /** Patch every graph from the brush. */
  sync(b: Brush): void;
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

/** Store (or drop, when it is the straight line again) one channel's curve on a brush. */
function putCurve(b: Brush, key: Key, pts: number[], speed: number): void {
  const c: PenCurve = { pts: cleanPoints(pts) };
  if (speed < 1) c.speed = speed;
  const next: PenCurves = { ...(b.curves ?? {}) };
  if (isIdentity(c)) delete next[key]; else next[key] = c;
  if (Object.keys(next).length) b.curves = next; else delete b.curves;
}

/** `only` builds a single channel's graph (the per-setting popover) with no hint line and one column. */
export function buildCurvePanel(edit: (id: string, fn: (b: Brush) => void) => void, only?: Key): CurvePanel {
  const root = el<HTMLElement>(`<div class="fm-bc${only ? ' is-single' : ''}">${only ? '' : `<p class="fm-bc-hint">${t('Click a graph to add a node (up to four). Drag a node to move it, double-click to remove it.')}</p>`}<div class="fm-bc-grid"></div></div>`);
  const grid = q(root, '.fm-bc-grid');
  const blocks: Block[] = [];

  for (const ch of CHANNELS) {
    if (only && ch.key !== only) continue;
    const card = el<HTMLElement>(`<div class="fm-bc-card" data-key="${ch.key}">
      <div class="fm-bc-head"><span class="fm-bc-name">${t(ch.label)}</span><button type="button" class="fm-bc-reset" title="${t('Reset curve')}" aria-label="${t('Reset curve')}: ${t(ch.label)}" hidden>${t('Reset')}</button></div>
      <div class="fm-bc-plot"></div>
      ${ch.speed ? `<label class="fm-bc-speed"><span>${t('Response speed')}</span><input type="range" min="0" max="1" step="0.01" value="1" aria-label="${t('Response speed')}: ${t(ch.label)}"><output></output></label>` : ''}
    </div>`);
    const plot = q(card, '.fm-bc-plot');
    const svg = svgEl('svg', { viewBox: '-6 -6 112 112', class: 'fm-bc-svg', role: 'group', 'aria-label': `${t(ch.label)} ${t('curve')}`, tabindex: '-1' });
    svg.appendChild(svgEl('rect', { x: '0', y: '0', width: '100', height: '100', class: 'fm-bc-frame' }));
    for (const g of [25, 50, 75]) {
      svg.appendChild(svgEl('line', { x1: String(g), y1: '0', x2: String(g), y2: '100', class: 'fm-bc-grid-l' }));
      svg.appendChild(svgEl('line', { x1: '0', y1: String(g), x2: '100', y2: String(g), class: 'fm-bc-grid-l' }));
    }
    svg.appendChild(svgEl('line', { x1: '0', y1: '100', x2: '100', y2: '0', class: 'fm-bc-diag' }));
    const path = svgEl('path', { class: 'fm-bc-curve', d: 'M0 100L100 0' });
    svg.appendChild(path);
    const nodes: SVGCircleElement[] = [];
    for (let i = 0; i < MAX_NODES + 2; i++) {
      const n = svgEl('circle', { r: String(NODE_R), class: 'fm-bc-node', tabindex: '0', role: 'slider', 'aria-label': `${t(ch.label)} ${t('node')} ${i + 1}` });
      nodes.push(n);
      svg.appendChild(n);
    }
    plot.appendChild(svg);
    const speed = ch.speed ? q<HTMLInputElement>(card, '.fm-bc-speed input') : null;
    const out = ch.speed ? q(card, '.fm-bc-speed output') : null;
    const reset = q<HTMLButtonElement>(card, '.fm-bc-reset');
    const blk: Block = { key: ch.key, root: card, svg, path, nodes, speed, out, reset, pts: identityCurve().pts.slice() };
    blocks.push(blk);
    grid.appendChild(card);
    wire(blk, ch.key);
  }

  function curSpeed(blk: Block): number { return blk.speed ? blk.speed.valueAsNumber : 1; }
  function commit(blk: Block, pts: number[]): void {
    edit(`curve.${blk.key}`, (b) => putCurve(b, blk.key, pts, curSpeed(blk)));
  }
  function toUnits(blk: Block, e: PointerEvent): { x: number; y: number } {
    const r = blk.svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 112 - 6, y = ((e.clientY - r.top) / r.height) * 112 - 6;
    return { x: Math.min(1, Math.max(0, x / 100)), y: Math.min(1, Math.max(0, 1 - y / 100)) };
  }

  function wire(blk: Block, key: Key): void {
    let drag = -1;
    blk.svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = toUnits(blk, e);
      const pts = blk.pts.slice();
      const n = pts.length / 2;
      let hit = -1, best = (NODE_R * 1.8) / 100;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(pts[i * 2] - p.x, pts[i * 2 + 1] - p.y);
        if (d < best) { best = d; hit = i; }
      }
      if (hit < 0) {
        if (n - 2 >= MAX_NODES || p.x < 0.03 || p.x > 0.97) return;
        let at = 1;
        while (at < n - 1 && pts[at * 2] < p.x) at++;
        pts.splice(at * 2, 0, p.x, p.y);
        hit = at;
        commit(blk, pts);
      }
      drag = hit;
      blk.svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    blk.svg.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const p = toUnits(blk, e);
      const pts = blk.pts.slice();
      const n = pts.length / 2;
      pts[drag * 2 + 1] = p.y;
      if (drag > 0 && drag < n - 1) pts[drag * 2] = Math.min(pts[(drag + 1) * 2] - 0.02, Math.max(pts[(drag - 1) * 2] + 0.02, p.x));
      commit(blk, pts);
    });
    const end = (e: PointerEvent): void => {
      if (drag < 0) return;
      drag = -1;
      if (blk.svg.hasPointerCapture(e.pointerId)) blk.svg.releasePointerCapture(e.pointerId);
    };
    blk.svg.addEventListener('pointerup', end);
    blk.svg.addEventListener('pointercancel', end);
    blk.svg.addEventListener('dblclick', (e) => {
      const i = blk.nodes.indexOf(e.target as SVGCircleElement);
      const n = blk.pts.length / 2;
      if (i <= 0 || i >= n - 1) return;
      const pts = blk.pts.slice();
      pts.splice(i * 2, 2);
      commit(blk, pts);
    });
    blk.svg.addEventListener('keydown', (e) => {
      const i = blk.nodes.indexOf(e.target as SVGCircleElement);
      const n = blk.pts.length / 2;
      if (i < 0 || i >= n) return;
      const pts = blk.pts.slice();
      const st = e.shiftKey ? 0.1 : 0.02;
      let used = true;
      if (e.key === 'ArrowUp') pts[i * 2 + 1] = Math.min(1, pts[i * 2 + 1] + st);
      else if (e.key === 'ArrowDown') pts[i * 2 + 1] = Math.max(0, pts[i * 2 + 1] - st);
      else if (e.key === 'ArrowLeft' && i > 0 && i < n - 1) pts[i * 2] = Math.max(pts[(i - 1) * 2] + 0.02, pts[i * 2] - st);
      else if (e.key === 'ArrowRight' && i > 0 && i < n - 1) pts[i * 2] = Math.min(pts[(i + 1) * 2] - 0.02, pts[i * 2] + st);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && i > 0 && i < n - 1) pts.splice(i * 2, 2);
      else used = false;
      if (!used) return;
      e.preventDefault();
      e.stopPropagation();
      commit(blk, pts);
    });
    blk.reset.addEventListener('click', () => edit(`curve.${key}`, (b) => putCurve(b, key, identityCurve().pts, 1)));
    if (blk.speed) blk.speed.addEventListener('input', () => commit(blk, blk.pts));
  }

  function syncBlock(blk: Block, b: Brush): void {
    const c = b.curves?.[blk.key];
    const pts = c ? cleanPoints(c.pts) : identityCurve().pts.slice();
    blk.pts = pts;
    const n = pts.length / 2;
    const lut = curveLut({ pts });
    let d = '';
    for (let i = 0; i <= 48; i++) { const x = i / 48; d += `${i ? 'L' : 'M'}${(x * 100).toFixed(1)} ${(100 - curveAt(lut, x) * 100).toFixed(1)}`; }
    if (blk.path.getAttribute('d') !== d) blk.path.setAttribute('d', d);
    for (let i = 0; i < blk.nodes.length; i++) {
      const node = blk.nodes[i];
      if (i < n) {
        node.removeAttribute('display');
        node.setAttribute('cx', (pts[i * 2] * 100).toFixed(1));
        node.setAttribute('cy', (100 - pts[i * 2 + 1] * 100).toFixed(1));
        node.setAttribute('aria-valuenow', String(Math.round(pts[i * 2 + 1] * 100)));
        node.classList.toggle('is-end', i === 0 || i === n - 1);
      } else node.setAttribute('display', 'none');
    }
    const sp = c && c.speed !== undefined ? c.speed : 1;
    if (blk.speed && Math.abs(blk.speed.valueAsNumber - sp) > 1e-6 && document.activeElement !== blk.speed) blk.speed.value = String(sp);
    if (blk.out) setText(blk.out, `${Math.round((blk.speed ? blk.speed.valueAsNumber : 1) * 100)}%`);
    const on = !!c;
    setHidden(blk.reset, !on);
    setClass(blk.root, 'is-set', on);
  }

  return { root, sync(b) { for (const blk of blocks) syncBlock(blk, b); } };
}
