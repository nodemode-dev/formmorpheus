import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import * as trackOps from '../engine/track-ops';
import { setTrackScreen } from '../engine/camera';
import { setMute, setSolo } from '../media/audio-edit';
import { el } from './dom';
import { soundFxCard } from './sound-fx-card';
import { Popover, popField, popRow, popSep } from './popover';

export class TrackMenu {
  private readonly pop: Popover;
  private readonly list: HTMLElement;
  private close: () => void;
  private trackId: string | null = null;
  private readonly name;
  private readonly paste = popRow('paste', 'Paste');
  private readonly pasteT = popRow('paste', 'Paste track');
  private readonly clearGap = popRow('removeGap', 'Remove empty section');
  private readonly up = popRow('chevronUp', 'Move up');
  private readonly down = popRow('chevronDown', 'Move down');
  private readonly screen = popRow(null, 'Fixed to screen', { check: true });
  private readonly mute = popRow(null, 'Mute sound', { check: true });
  private readonly solo = popRow(null, 'Solo sound', { check: true });
  private readonly rec = popRow('audio', 'Record sound...');
  private readonly fxRow = popRow('audio', 'Sound effects...');
  onRecord: (() => void) | null = null;

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
    this.screen.el.addEventListener('click', () => {
      const on = !this.screen.el.classList.contains('is-checked');
      this.act('Fix Track to Screen', (m, id) => setTrackScreen(m, id, on));
    });
    this.mute.el.addEventListener('click', () => { const on = !this.mute.el.classList.contains('is-checked'); this.act(on ? 'Mute Track' : 'Unmute Track', (m, id) => setMute(m, id, on)); });
    this.solo.el.addEventListener('click', () => { const on = !this.solo.el.classList.contains('is-checked'); this.act(on ? 'Solo Track' : 'Unsolo Track', (m, id) => setSolo(m, id, on)); });
    this.rec.el.addEventListener('click', () => { this.close(); this.onRecord?.(); });
    this.fxRow.el.addEventListener('click', () => { const id = this.trackId; this.close(); if (id) soundFxCard(this.engine).show({ kind: 'track', id }); });
    const cutT = popRow('cut', 'Cut track');
    const copyT = popRow('copy', 'Copy track');
    const dupT = popRow('duplicate', 'Duplicate track');
    cutT.el.addEventListener('click', () => this.trackOp('Cut Track', (m, id) => { const t = m.tracks.find((x) => x.id === id); if (t) trackOps.copyTrack(t); return ops.deleteTrack(m, id); }));
    copyT.el.addEventListener('click', () => { const t = this.engine.movie?.tracks.find((x) => x.id === this.trackId); if (t) trackOps.copyTrack(t); this.close(); });
    dupT.el.addEventListener('click', () => this.trackOp('Duplicate Track', (m, id) => trackOps.duplicateTrack(m, id).movie));
    this.pasteT.el.addEventListener('click', () => this.trackOp('Paste Track', (m, id) => trackOps.pasteTrack(m, id).movie));
    this.list.append(this.name.el, cutT.el, copyT.el, dupT.el, this.pasteT.el, this.paste.el, popSep(), showAll.el, hideAll.el, this.clearGap.el, popSep(), this.screen.el, this.mute.el, this.solo.el, this.rec.el, this.fxRow.el, popSep(), add.el, this.up.el, this.down.el, popSep(), del.el);
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
    this.pasteT.setDisabled(at < 0 || !trackOps.hasTrackClip());
    this.clearGap.setDisabled(at < 0 || !m || m.tracks[at].content.some((c) => this.engine.isOver(c)));
    this.screen.setChecked(at >= 0 && !!m?.tracks[at].screen);
    this.screen.setDisabled(at < 0);
    this.mute.setChecked(at >= 0 && !!m?.tracks[at].mute);
    this.solo.setChecked(at >= 0 && !!m?.tracks[at].solo);
    this.mute.setDisabled(at < 0);
    this.solo.setDisabled(at < 0);
    this.up.setDisabled(at <= 0);
    this.down.setDisabled(!m || at < 0 || at >= m.tracks.length - 1);
  }

  private trackOp(label: string, fn: (m: NonNullable<Engine['movie']>, id: string) => ReturnType<typeof ops.patchMovie>): void {
    this.act(label, fn);
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
