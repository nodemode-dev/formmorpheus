// Draw & Paint at narrow widths (Split View, Stage Manager, small windows). The bar's own buttons stay where they are;
// the CSS in paint-narrow.css hides the ones that no longer fit, and this builds, once, a More button and a small panel
// whose rows press those hidden buttons. Nothing is rebuilt afterwards: the panel is only shown and hidden.

import { el, q, setHidden } from './dom';
import { icon } from './icons';
import { t } from './i18n';

interface Row { label: string; from: string; group: 'words' | 'extra' }

const ROWS: Row[] = [
  { label: 'Settings', from: '.fm-paint-word[data-w="settings"]', group: 'words' },
  { label: 'Filters', from: '.fm-paint-word[data-w="filters"]', group: 'words' },
  { label: 'Select', from: '.fm-paint-word[data-w="select"]', group: 'words' },
  { label: 'Transform', from: '.fm-paint-word[data-w="transform"]', group: 'words' },
  { label: 'Eyedropper', from: '.fm-paint-tool[data-tool="eyedropper"]', group: 'extra' },
  { label: 'Fill', from: '.fm-paint-tool[data-tool="fill"]', group: 'extra' },
];

/** Adds the overflow button to the tool row and its panel to the view. Call once, after the view's template exists. */
export function mountPaintOverflow(root: HTMLElement): void {
  const tools = q(root, '.fm-paint-tools');
  const btn = el<HTMLButtonElement>(`<button class="fm-paint-tool fm-paint-more" type="button" aria-haspopup="true" aria-expanded="false">${icon('more3', 24)}</button>`);
  btn.title = t('More tools');
  btn.setAttribute('aria-label', t('More tools'));
  const pop = el(`<div class="fm-paint-more-pop fm-pop" hidden>${ROWS.map((r) => `<button class="fm-pop-row" type="button" data-g="${r.group}" data-i="${ROWS.indexOf(r)}">${r.label}</button>`).join('')}</div>`);
  tools.appendChild(btn);
  root.appendChild(pop);

  const close = (): void => { setHidden(pop, true); btn.setAttribute('aria-expanded', 'false'); };
  const open = (): void => {
    const r = btn.getBoundingClientRect(), h = root.getBoundingClientRect();
    pop.style.setProperty('--x', `${Math.max(8, h.right - r.right)}px`);
    pop.style.setProperty('--y', `${r.bottom - h.top + 4}px`);
    setHidden(pop, false);
    btn.setAttribute('aria-expanded', 'true');
  };
  btn.addEventListener('click', () => { if (pop.hidden) open(); else close(); });
  pop.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-pop-row');
    if (!row) return;
    close();
    q<HTMLElement>(root, ROWS[Number(row.dataset.i)].from).click();
  });
  // a press anywhere else, Escape, or the bar growing wide again closes it
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target as Node) && !btn.contains(e.target as Node)) close(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) close(); });
  window.addEventListener('resize', () => { if (!pop.hidden && getComputedStyle(btn).display === 'none') close(); });
}
