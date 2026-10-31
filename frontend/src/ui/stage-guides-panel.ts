// The Guides section of Stage Options: rulers, grid (size, subdivisions), rule of thirds, title / action / vertical
// safe areas, snapping and Clear guides. Built once, patched from the movie. Each change is one undo step.
import type { Engine } from '../engine/engine';
import { GRID_DEFAULT, type Guides } from '../engine/guides';
import * as ops from '../engine/ops';
import { el, q, setDisabled, setHidden, setText } from './dom';
import { t } from './i18n';
import { sliderRow, toggleRow, type Row } from './panels/controls';
import '../styles/stage-guides.css';

export class GuidesSection {
  readonly el: HTMLElement;
  private readonly rows: Record<'show' | 'rulers' | 'grid' | 'thirds' | 'title' | 'action' | 'vertical' | 'snap', Row<boolean>>;
  private readonly size: Row<number>;
  private readonly div: Row<number>;
  private readonly clear: HTMLButtonElement;

  constructor(private readonly engine: Engine) {
    const set = (label: string, fn: (g: Guides) => Guides, merge?: string): void => {
      this.engine.run(label, (m) => ops.patchMovie(m, { guides: fn({ ...(m.guides ?? {}) }) }), merge ?? null);
    };
    this.el = el('<div class="fm-so-sec" data-sec="guides"><div class="fm-so-head"></div></div>');
    setText(q(this.el, '.fm-so-head'), t('Guides'));
    this.rows = {
      show: toggleRow(t('Show guides'), (v) => set('Show Guides', (g) => ({ ...g, hide: !v }))),
      rulers: toggleRow(t('Rulers'), (v) => set('Rulers', (g) => ({ ...g, rulers: v }))),
      grid: toggleRow(t('Grid'), (v) => set('Grid', (g) => ({ ...g, grid: v }))),
      thirds: toggleRow(t('Rule of thirds'), (v) => set('Rule of Thirds', (g) => ({ ...g, thirds: v }))),
      title: toggleRow(t('Title safe area'), (v) => set('Title Safe Area', (g) => ({ ...g, titleSafe: v }))),
      action: toggleRow(t('Action safe area'), (v) => set('Action Safe Area', (g) => ({ ...g, actionSafe: v }))),
      vertical: toggleRow(t('Vertical video safe area'), (v) => set('Vertical Safe Area', (g) => ({ ...g, verticalSafe: v }))),
      snap: toggleRow(t('Snap to guides'), (v) => set('Snap to Guides', (g) => ({ ...g, snap: v }))),
    };
    this.size = sliderRow(t('Grid size'), 10, 500, 5, (v) => set('Grid Size', (g) => ({ ...g, gridSize: v }), 'guides-size'), { def: GRID_DEFAULT });
    this.div = sliderRow(t('Grid subdivisions'), 1, 8, 1, (v) => set('Grid Subdivisions', (g) => ({ ...g, gridDiv: v }), 'guides-div'), { def: 1 });
    for (const r of [this.size, this.div]) q(r.el, 'input[type="range"]').addEventListener('change', () => this.engine.endGesture());
    this.clear = el<HTMLButtonElement>('<button type="button" class="fm-so-btn"></button>');
    setText(this.clear, t('Clear guide lines'));
    this.clear.addEventListener('click', () => set('Clear Guides', (g) => ({ ...g, lines: [] })));
    const r = this.rows;
    this.el.append(r.show.el, r.rulers.el, r.grid.el, this.size.el, this.div.el, r.thirds.el, r.title.el, r.action.el, r.vertical.el, r.snap.el, this.clear);
  }

  sync(): void {
    const m = this.engine.movie;
    if (!m) return;
    const g = m.guides ?? {};
    this.rows.show.set(g.hide !== true);
    this.rows.rulers.set(g.rulers === true);
    this.rows.grid.set(g.grid === true);
    this.rows.thirds.set(g.thirds === true);
    this.rows.title.set(g.titleSafe === true);
    this.rows.action.set(g.actionSafe === true);
    this.rows.vertical.set(g.verticalSafe === true);
    this.rows.snap.set(g.snap !== false);
    this.size.set(g.gridSize ?? GRID_DEFAULT);
    this.div.set(g.gridDiv ?? 1);
    setHidden(this.size.el, g.grid !== true);
    setHidden(this.div.el, g.grid !== true);
    setDisabled(this.clear, !g.lines?.length);
  }
}
