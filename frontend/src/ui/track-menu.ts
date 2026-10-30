import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import { el } from './dom';
import { Popover, popField, popRow, popSep } from './popover';

export class TrackMenu {
  private readonly pop: Popover;
  private readonly list: HTMLElement;
  private close: () => void;
  private trackId: string | null = null;
  private readonly name;
  private readonly paste = popRow('paste', 'Paste');
  private readonly clearGap = popRow('removeGap', 'Remove empty section');
  private readonly up = popRow('chevronUp', 'Move up');
  private readonly down = popRow('chevronDown', 'Move down');

  constructor(private readonly engine: Engine) {
    this.pop = new Popover('fm-tm', 232);
    this.close = () => this.pop.hide();
    this.list = el<HTMLElement>('<div class="fm-tm-list"></div>');
    this.name = popField('rename', 'Track name', (v) => this.act('Rename Track', (m, id) => ops.renameTrack(m, id, v)));
    const showAll = popRow('showAll', 'Show all');
    const hideAll = popRow('hideAll', 'Hide all');
    const add = popRow('plus', 'Add track above');
    const del = popRow('trash', 'Delete track', { danger: true });
    this.paste.el.addEventListener('click', () => this.pasteHere());
    showAll.el.addEventListener('click', () => this.act('Show All Tracks', (m) => ops.setAllHidden(m, false)));
    hideAll.el.addEventListener('click', () => this.act('Hide All Tracks', (m) => ops.setAllHidden(m, true)));
    this.clearGap.el.addEventListener('click', () => this.act('Remove Empty Section', (m, id) => ops.removeEmptySection(m, id, this.engine.frame)));
    add.el.addEventListener('click', () => this.act('Add Track', (m, id) => ops.addTrack(m, Math.max(0, m.tracks.findIndex((t) => t.id === id))).movie));
    this.up.el.addEventListener('click', () => this.act('Move Track', (m, id) => ops.moveTrack(m, id, m.tracks.findIndex((t) => t.id === id) - 1)));
    this.down.el.addEventListener('click', () => this.act('Move Track', (m, id) => ops.moveTrack(m, id, m.tracks.findIndex((t) => t.id === id) + 1)));
    del.el.addEventListener('click', () => this.act('Delete Track', (m, id) => ops.deleteTrack(m, id)));
    this.list.append(this.name.el, this.paste.el, popSep(), showAll.el, hideAll.el, this.clearGap.el, popSep(), add.el, this.up.el, this.down.el, popSep(), del.el);
    this.pop.body.appendChild(this.list);
  }

  open(x: number, y: number, trackId: string): void {
    this.patch(trackId);
    this.pop.showAt(x, y);
  }

  embed(host: Popover, row: HTMLElement, track: () => string | null): void {
    const panel = Popover.panel('fm-pop fm-tm fm-pop-sub');
    panel.style.width = '232px';
    panel.appendChild(this.list);
    this.close = () => host.hide();
    host.attachSub(row, panel, () => this.patch(track()));
  }

  patch(trackId: string | null): void {
    this.trackId = trackId;
    const m = this.engine.movie;
    const at = m && trackId ? m.tracks.findIndex((t) => t.id === trackId) : -1;
    this.name.set(at >= 0 && m ? m.tracks[at].name : '');
    this.name.setDisabled(at < 0);
    this.paste.setDisabled(at < 0 || !this.engine.hasClipboard);
    this.clearGap.setDisabled(at < 0 || !m || m.tracks[at].content.some((c) => this.engine.isOver(c)));
    this.up.setDisabled(at <= 0);
    this.down.setDisabled(!m || at < 0 || at >= m.tracks.length - 1);
  }

  private pasteHere(): void {
    if (!this.trackId) return;
    this.engine.select([], this.trackId);
    this.engine.paste();
    this.close();
  }

  private act(label: string, fn: (m: NonNullable<Engine['movie']>, id: string) => ReturnType<typeof ops.patchMovie>): void {
    const id = this.trackId;
    if (!id) return;
    this.engine.run(label, (m) => fn(m, id));
    this.close();
  }
}
