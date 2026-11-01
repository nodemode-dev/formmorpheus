import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import * as tops from '../engine/transform-ops';
import { Popover, popRow, type PopRow } from './popover';
import { setClass } from './dom';
import { anchorMode } from './anchor-mode';
import { ensureLane, newKeyState } from './action-menu';
import { animate, laneOf } from '../engine/keys';
import * as keyOps from '../engine/key-ops';
import { updateContent } from '../engine/ops';
import type { Movie } from '../engine/types';

/** Flip horizontal, Flip vertical and Reset rows, shared by the Stage box's ellipsis menu and the content menu. */
export class TransformRows {
  readonly flipH: PopRow = popRow('flipH', 'Flip horizontal');
  readonly flipV: PopRow = popRow('flipV', 'Flip vertical');
  readonly reset: PopRow = popRow('rotate', 'Reset');
  readonly rows: HTMLElement[] = [this.flipH.el, this.flipV.el, this.reset.el];

  constructor(private readonly engine: Engine, private readonly ids: () => string[], private readonly done: () => void) {
    this.flipH.el.addEventListener('click', () => { this.run('Flip Horizontal', (m, ids) => this.flip(m, ids, 'h')); });
    this.flipV.el.addEventListener('click', () => { this.run('Flip Vertical', (m, ids) => this.flip(m, ids, 'v')); });
    this.reset.el.addEventListener('click', () => { this.run('Reset Transform', (m, ids) => tops.resetTransform(m, ids)); });
  }

  /** Compose flips the base transform. Keyframe and Perform key a mirrored (negative) scale at the Playhead, so a flip can happen mid-clip. */
  private flip(m: Movie, ids: string[], axis: 'h' | 'v'): Movie {
    if (this.engine.mode === 'compose') return tops.flip(m, ids, axis);
    const f = this.engine.frame, ease = newKeyState().lastEase;
    const ch = axis === 'h' ? 'scaleX' : 'scaleY';
    let out = m;
    for (const id of ids) {
      const at = locate(out, id);
      if (!at || at.content.kind === 'audio') continue;
      const local = f - at.content.start;
      if (local < 0 || local >= at.content.duration) continue;
      out = updateContent(out, id, (c) => {
        const v = animate(c, local)[ch];
        return keyOps.setKeys(laneOf(c, 'move') ? c : ensureLane(c, 'move', local, m.addKeyAtStart, ease), 'move', local, { [ch]: -v });
      });
    }
    return out;
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
    // Reset puts the Compose transform back and leaves keyframes alone: it only belongs to Compose
    setClass(this.reset.el, 'is-gone', this.engine.mode !== 'compose');
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
    // the anchor works in Perform and Keyframe; Compose always turns and scales about the content centre
    this.anchor.setDisabled(this.engine.mode === 'compose');
    this.pop.showAt(x, y);
  }
}
