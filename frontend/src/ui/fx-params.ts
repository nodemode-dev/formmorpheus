// Extra controls for registry effect cards in the Action menu: a color swatch row (edits a color's three channels),
// a section heading, and the curve editor of Color Correction (Master, Red, Green, Blue). Built once, patched in place.
import '../styles/brush-curves.css';
import '../styles/fx-params.css';
import { cleanPoints, curveAt, curveLut, MAX_NODES } from '../paint/curves';
import { CURVE_IDS, parseCurve } from '../engine/fx/colorcorrect';
import { el, q, setClass, setHidden, setText } from './dom';
import { t } from './i18n';

const SVGNS = 'http://www.w3.org/2000/svg';
const NODE_R = 4.2;

export function groupHead(label: string): HTMLElement {
  const h = el('<div class="fm-kc-grouphead"></div>');
  setText(h, t(label));
  return h;
}

const hex2 = (v: number): string => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

export interface Swatch { root: HTMLElement; set(rgb: [number, number, number]): void }

/** A labelled color input; `change` gets the picked color as 0..1 channels while it is dragged. */
export function buildSwatch(label: string, begin: () => void, change: (rgb: [number, number, number]) => void, end: () => void): Swatch {
  const root = el('<div class="fm-kc-row fm-kc-swatch"><span class="fm-kc-label"></span><input class="fm-kc-color" type="color"></div>');
  setText(q(root, '.fm-kc-label'), t(label));
  const input = q<HTMLInputElement>(root, '.fm-kc-color');
  input.setAttribute('aria-label', t(label));
  input.addEventListener('pointerdown', begin);
  input.addEventListener('input', () => {
    const v = input.value;
    change([parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255]);
  });
  input.addEventListener('change', end);
  return { root, set(rgb) { const h = `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`; if (input.value !== h) input.value = h; } };
}

export interface CurvesApi {
  /** Starts and ends one drag (one undo step). */
  begin(): void;
  end(): void;
  /** Stores a lane option ('' removes the curve). */
  set(id: string, value: string): void;
}

export interface CurvesExtra { root: HTMLElement; sync(opts: Record<string, string | number | boolean>): void }

const CH_NAMES: Record<string, string> = { L: 'Master', R: 'Red', G: 'Green', B: 'Blue' };

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

export function buildCurves(api: CurvesApi): CurvesExtra {
  const root = el('<div class="fm-kc-curves"><div class="fm-kc-seg fm-kc-curvetabs" role="group"></div><div class="fm-bc-plot fm-kc-plot"></div><button class="fm-bc-reset" type="button" hidden></button></div>');
  const tabs = q(root, '.fm-kc-curvetabs');
  const plot = q(root, '.fm-kc-plot');
  const reset = q<HTMLButtonElement>(root, '.fm-bc-reset');
  setText(reset, t('Reset curve'));
  const tabBtns = new Map<string, HTMLButtonElement>();
  let cur = 'L';
  let opts: Record<string, string | number | boolean> = {};
  for (const id of CURVE_IDS) {
    const b = el<HTMLButtonElement>('<button class="fm-kc-segbtn" type="button"></button>');
    setText(b, t(CH_NAMES[id]));
    b.addEventListener('click', () => { cur = id; draw(); });
    tabBtns.set(id, b);
    tabs.appendChild(b);
  }
  const svg = svgEl('svg', { viewBox: '-6 -6 112 112', class: 'fm-bc-svg', role: 'group', 'aria-label': t('Curve'), tabindex: '-1' });
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
    const n = svgEl('circle', { r: String(NODE_R), class: 'fm-bc-node', tabindex: '0', role: 'slider', 'aria-label': `${t('node')} ${i + 1}` });
    nodes.push(n);
    svg.appendChild(n);
  }
  plot.appendChild(svg);

  let pts = [0, 0, 1, 1];

  function commit(next: number[]): void {
    const clean = cleanPoints(next);
    const straight = clean.length === 4 && clean[1] === 0 && clean[3] === 1;
    pts = clean;
    api.set('curve' + cur, straight ? '' : clean.map((v) => String(Math.round(v * 1000) / 1000)).join(','));
    paint();
  }

  function toUnits(e: PointerEvent): { x: number; y: number } {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 112 - 6, y = ((e.clientY - r.top) / r.height) * 112 - 6;
    return { x: Math.min(1, Math.max(0, x / 100)), y: Math.min(1, Math.max(0, 1 - y / 100)) };
  }

  let drag = -1;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = toUnits(e);
    const next = pts.slice();
    const n = next.length / 2;
    let hit = -1, best = (NODE_R * 1.8) / 100;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(next[i * 2] - p.x, next[i * 2 + 1] - p.y);
      if (d < best) { best = d; hit = i; }
    }
    api.begin();
    if (hit < 0) {
      if (n - 2 >= MAX_NODES || p.x < 0.03 || p.x > 0.97) { api.end(); return; }
      let at = 1;
      while (at < n - 1 && next[at * 2] < p.x) at++;
      next.splice(at * 2, 0, p.x, p.y);
      hit = at;
      commit(next);
    }
    drag = hit;
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const p = toUnits(e);
    const next = pts.slice();
    const n = next.length / 2;
    next[drag * 2 + 1] = p.y;
    if (drag > 0 && drag < n - 1) next[drag * 2] = Math.min(next[(drag + 1) * 2] - 0.02, Math.max(next[(drag - 1) * 2] + 0.02, p.x));
    commit(next);
  });
  const stop = (e: PointerEvent): void => {
    if (drag < 0) return;
    drag = -1;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    api.end();
  };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);
  svg.addEventListener('dblclick', (e) => {
    const i = nodes.indexOf(e.target as SVGCircleElement);
    const n = pts.length / 2;
    if (i <= 0 || i >= n - 1) return;
    const next = pts.slice();
    next.splice(i * 2, 2);
    api.begin();
    commit(next);
    api.end();
  });
  reset.addEventListener('click', () => { api.begin(); pts = [0, 0, 1, 1]; api.set('curve' + cur, ''); api.end(); paint(); });

  function paint(): void {
    const n = pts.length / 2;
    const lut = curveLut({ pts });
    let d = '';
    for (let i = 0; i <= 48; i++) { const x = i / 48; d += `${i ? 'L' : 'M'}${(x * 100).toFixed(1)} ${(100 - curveAt(lut, x) * 100).toFixed(1)}`; }
    if (path.getAttribute('d') !== d) path.setAttribute('d', d);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (i < n) {
        node.removeAttribute('display');
        node.setAttribute('cx', (pts[i * 2] * 100).toFixed(1));
        node.setAttribute('cy', (100 - pts[i * 2 + 1] * 100).toFixed(1));
        node.setAttribute('aria-valuenow', String(Math.round(pts[i * 2 + 1] * 100)));
        node.classList.toggle('is-end', i === 0 || i === n - 1);
      } else node.setAttribute('display', 'none');
    }
    setHidden(reset, parseCurve(opts['curve' + cur]) === null && drag < 0);
  }

  function draw(): void {
    for (const [id, b] of tabBtns) {
      setClass(b, 'is-active', id === cur);
      setClass(b, 'is-set', parseCurve(opts['curve' + id]) !== null);
    }
    if (drag < 0) pts = parseCurve(opts['curve' + cur]) ?? [0, 0, 1, 1];
    paint();
  }

  return { root, sync(o) { opts = o; draw(); } };
}
