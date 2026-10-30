import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import * as tops from '../engine/transform-ops';
import { Popover, popRow, type PopRow } from './popover';
import { setClass } from './dom';
import { anchorMode } from './anchor-mode';

/** Flip horizontal, Flip vertical and Reset rows, shared by the Stage box's ellipsis menu and the content menu. */
export class TransformRows {
  readonly flipH: PopRow = popRow('flipH', 'Flip horizontal');
  readonly flipV: PopRow = popRow('flipV', 'Flip vertical');
  readonly reset: PopRow = popRow('rotate', 'Reset');
  readonly rows: HTMLElement[] = [this.flipH.el, this.flipV.el, this.reset.el];

  constructor(private readonly engine: Engine, private readonly ids: () => string[], private readonly done: () => void) {
    this.flipH.el.addEventListener('click', () => { this.run('Flip Horizontal', (m, ids) => tops.flip(m, ids, 'h')); });
    this.flipV.el.addEventListener('click', () => { this.run('Flip Vertical', (m, ids) => tops.flip(m, ids, 'v')); });
    this.reset.el.addEventListener('click', () => { this.run('Reset Transform', (m, ids) => tops.resetTransform(m, ids)); });
  }

  private run(label: string, fn: (m: import('../engine/types').Movie, ids: string[]) => import('../engine/types').Movie): void {
    const ids = this.ids();
    if (ids.length) this.engine.run(label, (m) => fn(m, ids));
    this.done();
  }

  /** Grey out Reset when every selected content already has the default transform; hide all when nothing visual is selected. */
  patch(): void {
    const m = this.engine.movie;
    const ids = this.ids();
    const cs = m ? ids.map((id) => locate(m, id)?.content).filter((c) => !!c && c.kind !== 'audio') : [];
    const none = cs.length === 0;
    this.flipH.setDisabled(none);
    this.flipV.setDisabled(none);
    this.reset.setDisabled(none || cs.every((c) => !!c && tops.isDefaultTransform(c.transform)));
    for (const r of this.rows) setClass(r, 'is-gone', false);
  }
}

/** The menu behind the ellipsis at the top right of the Stage box. */
export class StageBoxMenu {
  private readonly pop = new Popover('fm-box-menu', 200);
  private ids: string[] = [];
  private readonly rows: TransformRows;
  private readonly anchor: PopRow = popRow(null, 'Edit anchor');

  constructor(private readonly engine: Engine, onHide: () => void = () => undefined) {
    this.rows = new TransformRows(engine, () => this.ids, () => this.pop.hide());
    this.anchor.el.addEventListener('click', () => { if (this.ids[0]) anchorMode.start(this.ids[0]); this.pop.hide(); });
    this.pop.body.append(this.anchor.el, ...this.rows.rows);
    this.pop.onHide(onHide);
  }

  open(x: number, y: number, ids: string[]): void {
    this.ids = ids;
    this.rows.patch();
    this.anchor.setDisabled(this.engine.mode === 'perform');
    this.pop.showAt(x, y);
  }
}
