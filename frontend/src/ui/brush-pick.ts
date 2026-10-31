// Shape and Grain pickers for the Brush Studio: a row showing the current library stamp or grain and a grid of
// every authored one to pick from. The grid is built once on first open (thumbnails are drawn a few at a time so
// the editor stays responsive) and then only patched.

import '../styles/brush-pick.css';
import { el, q, setClass, setHidden, setText } from './dom';
import { t } from './i18n';
import { TIP_LIST, libTipImage } from '../paint/tips-lib';
import { GRAIN_LIST, grainThumb } from '../paint/grains-lib';
import type { Brush } from '../paint/types';

export type PickWhat = 'tip' | 'grain';
const THUMB = 44;

// Drawn thumbnails are kept for every later studio session.
const thumbs = new Map<string, ImageData>();

function thumbOf(what: PickWhat, id: string): ImageData | null {
  const key = `${what}:${id}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  const im = new ImageData(THUMB, THUMB);
  if (what === 'tip') {
    const tip = libTipImage(id);
    if (!tip) return null;
    // box-average the 256 px stamp down to the thumbnail; dark ink on a light card
    const k = tip.w / THUMB;
    for (let y = 0; y < THUMB; y++) {
      for (let x = 0; x < THUMB; x++) {
        let s = 0;
        for (let j = 0; j < k; j += 2) for (let i = 0; i < k; i += 2) s += tip.data[(Math.floor(y * k) + j) * tip.w + Math.floor(x * k) + i];
        const a = s / ((k / 2) * (k / 2));
        const p = (y * THUMB + x) * 4;
        im.data[p] = im.data[p + 1] = im.data[p + 2] = 20; im.data[p + 3] = a;
      }
    }
  } else {
    const g = grainThumb(id, THUMB);
    if (!g) return null;
    for (let i = 0; i < g.length; i++) { const p = i * 4; im.data[p] = im.data[p + 1] = im.data[p + 2] = g[i]; im.data[p + 3] = 255; }
  }
  thumbs.set(key, im);
  return im;
}

export interface PickRow {
  root: HTMLElement;
  /** Patch the row to show this brush's choice. */
  sync(b: Brush): void;
}

/** Builds the row. `onPick(id)` is called with a library id, or '' for the procedural default. */
export function buildPickRow(rowId: string, label: string, what: PickWhat, onPick: (id: string) => void): PickRow {
  const list = what === 'tip' ? TIP_LIST : GRAIN_LIST;
  const none = what === 'tip' ? 'Procedural' : 'Paper';
  const root = el<HTMLElement>(`<div class="fm-bs-row is-pick" data-id="${rowId}"><span class="fm-bs-lab">${label}</span>
    <button type="button" class="fm-pk-cur" aria-expanded="false"><canvas class="fm-pk-cth" width="${THUMB}" height="${THUMB}"></canvas><span class="fm-pk-name"></span></button>
    <div class="fm-pk-grid" hidden></div></div>`);
  const cur = q<HTMLButtonElement>(root, '.fm-pk-cur');
  const cth = q<HTMLCanvasElement>(root, '.fm-pk-cth');
  const name = q(root, '.fm-pk-name');
  const grid = q(root, '.fm-pk-grid');
  const cells = new Map<string, HTMLButtonElement>();
  let built = false;
  let shown = '\u0000';

  const paint = (c: HTMLCanvasElement, id: string): void => {
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, THUMB, THUMB);
    const im = id ? thumbOf(what, id) : null;
    if (im) g.putImageData(im, 0, 0);
  };

  const build = (): void => {
    built = true;
    let lastGroup = '';
    const todo: { id: string; c: HTMLCanvasElement }[] = [];
    const none0 = el<HTMLButtonElement>(`<button type="button" class="fm-pk-cell is-none" data-id="" title="${t(none)}"><span>${t(none)}</span></button>`);
    cells.set('', none0);
    grid.appendChild(none0);
    for (const it of list) {
      if (it.group !== lastGroup) { lastGroup = it.group; grid.appendChild(el(`<div class="fm-pk-group">${t(it.group)}</div>`)); }
      const b = el<HTMLButtonElement>(`<button type="button" class="fm-pk-cell" data-id="${it.id}" title="${t(it.name)}"><canvas width="${THUMB}" height="${THUMB}"></canvas></button>`);
      cells.set(it.id, b);
      grid.appendChild(b);
      todo.push({ id: it.id, c: q<HTMLCanvasElement>(b, 'canvas') });
    }
    setClass(cells.get(shown === '\u0000' ? '' : shown) ?? none0, 'is-on', true);
    // a few thumbnails per turn: a grain takes tens of milliseconds to generate the first time
    let i = 0;
    const step = (): void => {
      const t0 = performance.now();
      while (i < todo.length && performance.now() - t0 < 24) { paint(todo[i].c, todo[i].id); i++; }
      if (i < todo.length && root.isConnected) window.setTimeout(step, 0);
    };
    window.setTimeout(step, 0);
  };

  cur.addEventListener('click', () => {
    const open = !!grid.hidden;
    if (open && !built) build();
    setHidden(grid, !open);
    cur.setAttribute('aria-expanded', String(open));
    setClass(root, 'is-open', open);
  });
  grid.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.fm-pk-cell');
    if (b) onPick(b.dataset.id ?? '');
  });

  return {
    root,
    sync(b: Brush): void {
      const id = (what === 'tip' ? b.tipId : b.grainId) ?? '';
      if (id === shown) return;
      if (built) { setClass(cells.get(shown) ?? cells.get('')!, 'is-on', false); setClass(cells.get(id) ?? cells.get('')!, 'is-on', true); }
      shown = id;
      const it = list.find((x) => x.id === id);
      setText(name, it ? t(it.name) : t(none));
      paint(cth, id);
      setClass(root, 'is-set', !!id);
    },
  };
}
