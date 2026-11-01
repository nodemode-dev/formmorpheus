// The Pressure & Smoothing card's graph: the brush's pressure curve with its dotted diagonal, one tab each for what
// pressure drives (size, opacity, flow). It reuses the Studio's curve editor and writes through the brush store, so the
// card edits the saved brush directly while Brush Studio ("Advanced") remains the full editor. Built once, patched in place.

import { el, q, setClass, setHidden } from './dom';
import { t } from './i18n';
import type { Brush } from '../paint/types';
import { buildCurvePanel, type CurvePanel } from './brush-studio-curves';
import { brushDiff, cloneBrush } from './brush-studio-params';

type Chan = 'size' | 'opacity' | 'flow';
const TABS: { ch: Chan; label: string }[] = [{ ch: 'size', label: 'Size' }, { ch: 'opacity', label: 'Opacity' }, { ch: 'flow', label: 'Flow' }];

export interface CardCurves {
  root: HTMLElement;
  sync(b: Brush): void;
}

/** `get` returns the brush the card is on; `apply` writes a patch to it. */
export function buildCardCurves(get: () => Brush | null, apply: (patch: Partial<Brush>) => void): CardCurves {
  const root = el<HTMLElement>(`<div class="fm-bp-curves"><div class="fm-bp-curves-tabs" role="tablist" aria-label="${t('Pressure drives')}">${TABS.map((x, i) => `<button type="button" role="tab" class="fm-bp-curves-tab" data-ch="${x.ch}" aria-selected="${i === 0}">${t(x.label)}</button>`).join('')}</div><div class="fm-bp-curves-body"></div></div>`);
  const body = q(root, '.fm-bp-curves-body');
  const panels = new Map<Chan, CurvePanel>();
  let shown: Chan = 'size';
  // the Studio's editor edits a draft through (id, fn); here the draft is a copy of the saved brush and the difference is written back
  const edit = (_id: string, fn: (b: Brush) => void): void => {
    const b = get();
    if (!b) return;
    const d = cloneBrush(b);
    fn(d);
    const patch = brushDiff(b, d) as Record<string, unknown>;
    // a starter brush keeps edits as a patch, so a removed curve is written as an empty set
    if ('curves' in patch && patch.curves === undefined) patch.curves = {};
    apply(patch as Partial<Brush>);
  };
  for (const x of TABS) {
    const p = buildCurvePanel(edit, x.ch);
    setHidden(p.root, x.ch !== shown);
    panels.set(x.ch, p);
    body.appendChild(p.root);
  }
  root.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.fm-bp-curves-tab');
    const ch = tab?.dataset.ch as Chan | undefined;
    if (!tab || !ch) return;
    shown = ch;
    for (const [k, p] of panels) setHidden(p.root, k !== ch);
    for (const b of Array.from(root.querySelectorAll<HTMLElement>('.fm-bp-curves-tab'))) { const on = b.dataset.ch === ch; setClass(b, 'is-on', on); b.setAttribute('aria-selected', String(on)); }
  });
  setClass(q(root, '.fm-bp-curves-tab'), 'is-on', true);
  return {
    root,
    sync(b) {
      for (const p of panels.values()) p.sync(b);
      for (const tab of Array.from(root.querySelectorAll<HTMLElement>('.fm-bp-curves-tab'))) setClass(tab, 'has-curve', !!b.curves?.[tab.dataset.ch as Chan]);
    },
  };
}
