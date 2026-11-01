// The options of one block inside an expanded group: show or hide, split at the Playhead, take it out of the group, delete.
import type { Engine } from '../engine/engine';
import * as groupInner from '../engine/group-inner-ops';
import { groupCtx } from '../engine/group-ctx';
import { end, locate } from '../engine/model';
import type { Content } from '../engine/types';
import { Popover, popRow, popSep } from './popover';
import { toast } from './toast';

export class InnerMenu {
  private readonly pop = new Popover('fm-tm', 212);
  private readonly hide = popRow(null, 'Hide');
  private readonly split = popRow(null, 'Split at Playhead');
  private readonly out = popRow(null, 'Move out of group');
  private readonly del = popRow('trash', 'Delete content', { danger: true });
  private item: Content | null = null;
  private group: Content | null = null;

  constructor(private readonly engine: Engine) {
    this.hide.el.addEventListener('click', () => {
      const c = this.item;
      if (!c) return;
      this.engine.run(c.hidden ? 'Show Content' : 'Hide Content', (m) => groupInner.updateInner(m, c.id, (x) => { const n: Content = { ...x }; if (x.hidden) delete n.hidden; else n.hidden = true; return n; }));
      this.pop.hide();
    });
    this.split.el.addEventListener('click', () => {
      const c = this.item, g = this.group;
      if (!c || !g) return;
      const local = this.engine.frame - g.start + g.offset;
      this.pop.hide();
      if (local <= c.start || local >= end(c)) { toast('Put the Playhead inside the content to split it', 'info'); return; }
      this.engine.run('Split Content', (m) => groupInner.splitInner(m, c.id, local));
    });
    this.out.el.addEventListener('click', () => {
      const c = this.item, g = this.group;
      if (!c || !g) return;
      const m = this.engine.movie, at = m ? locate(m, g.id) : null;
      this.pop.hide();
      if (!m || !at) return;
      const frame = g.start + c.start - g.offset;
      this.engine.run('Move out of group', (mv) => groupInner.moveOutOfGroup(mv, c.id, at.trackIndex, true, frame));
      groupCtx.picked = null;
    });
    this.del.el.addEventListener('click', () => {
      const c = this.item;
      if (!c) return;
      this.pop.hide();
      this.engine.run('Delete Content', (m) => groupInner.deleteInner(m, [c.id]));
      groupCtx.picked = null;
    });
    this.pop.body.append(this.hide.el, this.split.el, this.out.el, popSep(), this.del.el);
  }

  open(x: number, y: number, item: Content, group: Content): void {
    this.item = item;
    this.group = group;
    this.hide.setLabel(item.hidden ? 'Show' : 'Hide');
    this.pop.showAt(x, y);
  }
}
