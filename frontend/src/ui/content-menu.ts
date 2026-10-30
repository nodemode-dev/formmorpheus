import type { Engine } from '../engine/engine';
import { content, kindName, locate } from '../engine/model';
import * as flipOps from '../engine/flip-ops';
import * as keyOps from '../engine/key-ops';
import * as ops from '../engine/ops';
import { BLEND_MODES, HIGHLIGHTS, type BlendMode, type Highlight, type MaskMode, type Movie } from '../engine/types';
import { el, q, setClass, setHidden, setText } from './dom';
import { icon } from './icons';
import { Popover, popField, popRow, popSep, type PopRow } from './popover';
import { TrackMenu } from './track-menu';
import { BoilMake } from './boil-make';
import { canConvert } from './flip-convert';
import { ParentPicker } from './parent-picker';
import { TransformRows } from './stage-box-menu';

const MASKS: Array<[MaskMode, string]> = [['none', 'None'], ['clipping', 'Clipping'], ['alpha', 'Alpha'], ['luminance', 'Luminance']];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export class ContentMenu {
  private readonly pop: Popover;
  private ids: string[] = [];
  private readonly tiles: Record<'cut' | 'copy' | 'duplicate' | 'paste', HTMLButtonElement>;
  private readonly range: HTMLInputElement;
  private readonly pct: HTMLElement;
  private readonly volume: HTMLElement;
  private readonly vrange: HTMLInputElement;
  private readonly vpct: HTMLElement;
  private readonly separate: PopRow;
  private readonly name;
  private readonly blend: PopRow;
  private readonly blendRows = new Map<BlendMode, PopRow>();
  private readonly hlRows = new Map<Highlight, PopRow>();
  private readonly maskRows = new Map<MaskMode, PopRow>();
  private readonly invert: PopRow;
  private readonly highlight: PopRow;
  private readonly mask: PopRow;
  private readonly split: PopRow;
  private readonly after: PopRow;
  private readonly reverse: PopRow;
  private readonly toFlip: PopRow;
  private readonly toBoil: PopRow;
  private readonly boilMake: BoilMake;
  private readonly toTracks: PopRow;
  private readonly fill: PopRow;
  private readonly lip: PopRow;
  /** Opens the lip-sync dialog for the selection (set by the app). */
  onLipsync: (() => void) | null = null;
  /** Converts the selection to a Flipbook (bakes non-Drawing content first); set by the app. */
  onConvert: ((ids: string[]) => void) | null = null;
  private readonly formvis: PopRow;
  onEditInFormvis: ((id: string) => void) | null = null;
  private readonly group: PopRow;
  private readonly ungroup: PopRow;
  private readonly del: PopRow;
  private readonly track: TrackMenu;
  private readonly parents: ParentPicker;
  private readonly xform: TransformRows;

  constructor(private readonly engine: Engine) {
    this.pop = new Popover('fm-cm', 264);
    const body = this.pop.body;

    const tileRow = el<HTMLElement>('<div class="fm-cm-tiles"></div>');
    const tile = (name: 'cut' | 'copy' | 'duplicate' | 'paste', label: string, run: () => void): HTMLButtonElement => {
      const b = el<HTMLButtonElement>(`<button class="fm-cm-tile" type="button">${icon(name, 16)}<span></span></button>`);
      setText(q(b, 'span:last-child'), label);
      b.addEventListener('click', () => { run(); this.pop.hide(); });
      tileRow.appendChild(b);
      return b;
    };
    this.tiles = {
      cut: tile('cut', 'Cut', () => this.engine.copy(true)),
      copy: tile('copy', 'Copy', () => this.engine.copy()),
      duplicate: tile('duplicate', 'Duplicate', () => this.each('Duplicate', (m, id) => ops.duplicateContent(m, id))),
      paste: tile('paste', 'Paste', () => this.engine.paste()),
    };

    const opacity = el<HTMLElement>('<div class="fm-cm-opacity"><div class="fm-cm-opacity-head"><span>Opacity</span><span class="fm-cm-pct"></span></div><input class="fm-cm-range" type="range" min="0" max="100" step="1" aria-label="Opacity"></div>');
    this.range = q<HTMLInputElement>(opacity, 'input');
    this.pct = q<HTMLElement>(opacity, '.fm-cm-pct');
    this.range.addEventListener('input', () => {
      const v = this.range.valueAsNumber;
      this.paintRange(v);
      const ids = this.ids;
      this.engine.run('Opacity', (m) => ops.patchContent(m, ids, { opacity: v / 100 }), `opacity-${ids.join()}`);
    });
    this.range.addEventListener('change', () => this.engine.endGesture());

    this.volume = el<HTMLElement>('<div class="fm-cm-opacity fm-cm-volume"><div class="fm-cm-opacity-head"><span>Volume</span><span class="fm-cm-pct"></span></div><input class="fm-cm-range" type="range" min="0" max="200" step="1" aria-label="Volume"></div>');
    this.vrange = q<HTMLInputElement>(this.volume, 'input');
    this.vpct = q<HTMLElement>(this.volume, '.fm-cm-pct');
    this.vrange.addEventListener('input', () => {
      const v = this.vrange.valueAsNumber;
      this.paintVolume(v);
      const ids = this.ids;
      this.engine.run('Volume', (m) => ops.patchContent(m, ids, { volume: v / 100 }), `volume-${ids.join()}`);
    });
    this.vrange.addEventListener('change', () => this.engine.endGesture());

    this.separate = popRow('audio', 'Separate audio and video');
    this.separate.el.addEventListener('click', () => { this.separateAudio(); this.pop.hide(); });

    this.name = popField('rename', 'Rename', (v) => {
      const ids = this.ids;
      this.engine.run('Rename', (m) => ops.patchContent(m, ids, { name: v }));
      this.pop.hide();
    });

    this.highlight = popRow('highlight', 'Highlight', { sub: true });
    const hlPanel = Popover.panel('fm-pop fm-cm-sub fm-pop-sub');
    for (const h of HIGHLIGHTS) {
      const r = popRow(null, cap(h), { check: true });
      r.ico.appendChild(el<HTMLElement>(`<span class="fm-cm-dot" data-hl="${h}"></span>`));
      r.el.addEventListener('click', () => { this.patch({ highlight: h }, 'Highlight'); this.pop.hide(); });
      this.hlRows.set(h, r);
      hlPanel.appendChild(r.el);
    }
    this.pop.attachSub(this.highlight.el, hlPanel);

    this.blend = popRow('blendN', 'Blend mode', { sub: true });
    const blendPanel = Popover.panel('fm-pop fm-cm-sub fm-cm-blend fm-pop-sub');
    for (const b of BLEND_MODES) {
      const r = popRow(null, b.label, { check: true });
      r.setValue(b.short);
      r.el.addEventListener('click', () => { this.patch({ blend: b.id }, 'Blend Mode'); this.pop.hide(); });
      this.blendRows.set(b.id, r);
      blendPanel.appendChild(r.el);
    }
    this.pop.attachSub(this.blend.el, blendPanel);

    this.mask = popRow('mask', 'Mask', { sub: true });
    const maskPanel = Popover.panel('fm-pop fm-cm-sub fm-pop-sub');
    for (const [id, label] of MASKS) {
      const r = popRow(null, label, { check: true });
      r.el.addEventListener('click', () => { this.patch({ mask: id }, 'Mask'); this.pop.hide(); });
      this.maskRows.set(id, r);
      maskPanel.appendChild(r.el);
    }
    this.invert = popRow(null, 'Invert', { check: true });
    this.invert.el.addEventListener('click', () => {
      const on = !this.invert.el.classList.contains('is-checked');
      this.patch({ maskInvert: on }, 'Invert Mask');
      this.pop.hide();
    });
    maskPanel.append(popSep(), this.invert.el);
    this.pop.attachSub(this.mask.el, maskPanel);

    this.split = popRow('split', 'Split content');
    this.after = popRow('duplicateAfter', 'Duplicate after');
    this.reverse = popRow(null, 'Reverse keyframes');
    this.reverse.el.addEventListener('click', () => {
      const ids = this.ids;
      this.engine.run('Reverse Keyframes', (m) => ids.reduce((acc, id) => ops.updateContent(acc, id, (c) => keyOps.reverseKeys(c)), m));
      this.pop.hide();
    });
    this.toFlip = popRow('flipbook', 'Convert to Flipbook');
    this.toFlip.el.addEventListener('click', () => {
      const ids = this.ids;
      if (this.onConvert) this.onConvert(ids);
      else this.engine.run('Convert to Flipbook', (m) => { const r = flipOps.tracksToFlipbook(m, ids); return { movie: r.movie, select: [r.id] }; });
      this.pop.hide();
    });
    this.boilMake = new BoilMake(engine);
    this.toBoil = popRow('flipbook', 'Make Boil Frames...');
    this.toBoil.el.addEventListener('click', (e) => {
      const id = this.ids[0];
      this.pop.hide();
      if (id) this.boilMake.open(e.clientX, e.clientY, id);
    });
    this.toTracks = popRow('flipbook', 'Convert Flipbook to tracks');
    this.toTracks.el.addEventListener('click', () => {
      const id = this.ids[0];
      this.engine.run('Convert Flipbook to Tracks', (m) => { const r = flipOps.flipbookToTracks(m, id); return { movie: r.movie, select: r.ids }; });
      this.pop.hide();
    });
    this.fill = popRow('fillDuration', 'Fill duration');
    this.lip = popRow('audio', 'Lip-sync from Sound...');
    this.lip.el.addEventListener('click', () => { this.pop.hide(); this.onLipsync?.(); });
    this.formvis = popRow('layers', 'Edit in formvis');
    this.formvis.el.addEventListener('click', () => { const id = this.ids[0]; this.pop.hide(); if (id) this.onEditInFormvis?.(id); });
    this.group = popRow('group', 'Group');
    this.ungroup = popRow('ungroup', 'Ungroup');
    const trackRow = popRow('track', 'Track options', { sub: true });
    this.del = popRow('trash', 'Delete content', { danger: true });

    this.split.el.addEventListener('click', () => this.splitHere());
    this.after.el.addEventListener('click', () => { this.each('Duplicate After', (m, id) => ops.duplicateAfter(m, id)); this.pop.hide(); });
    this.fill.el.addEventListener('click', () => {
      const ids = this.ids;
      this.engine.run('Fill Duration', (m) => ids.reduce((acc, id) => ops.fillDuration(acc, id), m));
      this.pop.hide();
    });
    this.group.el.addEventListener('click', () => {
      const ids = this.ids;
      this.engine.run('Group', (m) => { const r = ops.groupContent(m, ids); return { movie: r.movie, select: [r.group] }; });
      this.pop.hide();
    });
    this.ungroup.el.addEventListener('click', () => {
      const id = this.ids[0];
      this.engine.run('Ungroup', (m) => { const r = ops.ungroupContent(m, id); return { movie: r.movie, select: r.ids }; });
      this.pop.hide();
    });
    this.del.el.addEventListener('click', () => {
      const ids = this.ids;
      this.engine.run('Delete', (m) => ops.deleteContent(m, ids));
      this.pop.hide();
    });

    this.track = new TrackMenu(engine);
    this.track.embed(this.pop, trackRow.el, () => this.trackOf());

    this.parents = new ParentPicker(engine, this.pop);
    this.xform = new TransformRows(engine, () => this.ids, () => this.pop.hide());
    body.append(tileRow, popSep(), opacity, this.volume, this.name.el, this.highlight.el, this.blend.el, this.mask.el, this.parents.row.el, ...this.xform.rows, popSep(),
      this.toFlip.el, this.toBoil.el, this.toTracks.el, this.lip.el, this.formvis.el, this.separate.el, this.split.el, this.after.el, this.reverse.el, this.fill.el, this.group.el, this.ungroup.el, trackRow.el, popSep(), this.del.el);
  }

  open(x: number, y: number): void {
    this.patchAll();
    this.pop.showAt(x, y);
  }

  private trackOf(): string | null {
    const m = this.engine.movie, first = this.engine.selected[0];
    return m && first ? locate(m, first.id)?.track.id ?? null : this.engine.selection.track;
  }

  private paintRange(v: number): void {
    setText(this.pct, `${v}%`);
    this.range.style.setProperty('--fm-pct', `${v}%`);
  }

  private paintVolume(v: number): void {
    setText(this.vpct, `${v}%`);
    this.vrange.style.setProperty('--fm-pct', `${v / 2}%`);
  }

  /** The video goes silent and a new audio block on the same asset takes over, on a track just below. */
  private separateAudio(): void {
    const c = this.engine.selected[0];
    if (!c || c.kind !== 'video' || !c.asset) return;
    const id = c.id, assetId = c.asset;
    this.engine.run('Separate Audio and Video', (m) => {
      const cur = locate(m, id);
      if (!cur) throw new ops.OpError('That content no longer exists.');
      const item = content('audio', cur.content.start, cur.content.duration, { name: `${cur.content.name} audio`, asset: assetId, offset: cur.content.offset, volume: cur.content.volume });
      const muted = ops.patchContent(m, [id], { volume: 0 });
      const placed = ops.placeContent(muted, null, item, cur.trackIndex + 1);
      return { movie: placed.movie, select: [item.id] };
    });
  }

  private patch(p: ops.ContentPatch, label: string): void {
    const ids = this.ids;
    this.engine.run(label, (m) => ops.patchContent(m, ids, p));
  }

  private each(label: string, fn: (m: Movie, id: string) => { movie: Movie; copy: string }): void {
    const ids = this.ids;
    this.engine.run(label, (m) => {
      let acc = m;
      const made: string[] = [];
      for (const id of ids) { const r = fn(acc, id); acc = r.movie; made.push(r.copy); }
      return { movie: acc, select: made };
    });
  }

  private splitHere(): void {
    const hit = this.engine.selected.filter((c) => this.engine.isOver(c));
    if (hit.length !== 1) return;
    const id = hit[0].id, frame = this.engine.frame;
    this.engine.run('Split Content', (m) => { const r = ops.splitContent(m, id, frame); return { movie: r.movie, select: [r.right] }; });
    this.pop.hide();
  }

  private patchAll(): void {
    const sel = this.engine.selected, first = sel[0], none = sel.length === 0;
    this.ids = sel.map((c) => c.id);
    for (const k of ['cut', 'copy', 'duplicate'] as const) setClass(this.tiles[k], 'is-disabled', none);
    setClass(this.tiles.paste, 'is-disabled', !this.engine.hasClipboard);
    const pct = first ? Math.round(first.opacity * 100) : 100;
    this.range.value = String(pct);
    this.range.disabled = none;
    this.paintRange(pct);
    const sound = !none && sel.every((c) => c.kind === 'audio' || c.kind === 'video');
    setHidden(this.volume, !sound);
    const vol = first ? Math.round(first.volume * 100) : 100;
    this.vrange.value = String(vol);
    this.paintVolume(vol);
    const m = this.engine.movie;
    const sep = sel.length === 1 && first.kind === 'video' && first.volume > 0 && !!first.asset && !!m?.assets[first.asset]?.hasAudio;
    setClass(this.separate.el, 'is-gone', !sep);
    this.name.set(sel.length === 1 && first ? first.name : '');
    this.name.input.placeholder = sel.length > 1 ? `${sel.length} items` : sel.length === 1 ? kindName(first.kind) : 'Rename';
    this.name.setDisabled(none);
    this.highlight.setDisabled(none);
    this.blend.setDisabled(none);
    this.mask.setDisabled(none);
    const hl = first?.highlight ?? 'none';
    for (const [h, r] of this.hlRows) r.setChecked(h === hl);
    const bl = BLEND_MODES.find((b) => b.id === (first?.blend ?? 'normal')) ?? BLEND_MODES[0];
    this.blend.ico.textContent = bl.short;
    setClass(this.blend.ico, 'is-glyph', true);
    for (const [id, r] of this.blendRows) { r.setChecked(id === bl.id); if (id === 'passthrough') setClass(r.el, 'is-gone', !sel.some((c) => c.kind === 'group')); }
    const mk = first?.mask ?? 'none';
    for (const [id, r] of this.maskRows) r.setChecked(id === mk);
    this.invert.setChecked(!!first?.maskInvert);
    this.invert.setDisabled(mk !== 'alpha' && mk !== 'luminance');
    const over = sel.filter((c) => this.engine.isOver(c));
    this.split.setDisabled(over.length !== 1 || this.engine.frame <= over[0].start);
    this.after.setDisabled(none);
    setClass(this.reverse.el, 'is-gone', this.engine.mode !== 'keyframe');
    this.reverse.setDisabled(!sel.some((c) => c.keys.length > 0));
    this.fill.setDisabled(none);
    setClass(this.toFlip.el, 'is-gone', none || !sel.every((c) => canConvert(c)));
    setClass(this.toBoil.el, 'is-gone', !(sel.length === 1 && first.kind === 'drawing'));
    setClass(this.toTracks.el, 'is-gone', !(sel.length === 1 && first.kind === 'flipbook'));
    const lipOk = sel.length === 1 && m !== null && (first.kind === 'flipbook' || (!!first.asset && (first.kind === 'audio' || (first.kind === 'video' && !!m.assets[first.asset]?.hasAudio))));
    setClass(this.lip.el, 'is-gone', !lipOk);
    setClass(this.formvis.el, 'is-gone', !(sel.length === 1 && first.kind === 'drawing'));
    const isGroup = sel.length === 1 && first.kind === 'group';
    setClass(this.group.el, 'is-gone', sel.length < 2);
    this.parents.patch(this.ids);
    this.xform.patch();
    setClass(this.ungroup.el, 'is-gone', !isGroup);
    this.del.setDisabled(none);
  }
}
