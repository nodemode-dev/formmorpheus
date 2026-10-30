import type { Engine } from '../engine/engine';
import { kindName, locate } from '../engine/model';
import * as ops from '../engine/ops';
import { BLEND_MODES, HIGHLIGHTS, type BlendMode, type Highlight, type MaskMode, type Movie } from '../engine/types';
import { el, q, setClass, setText } from './dom';
import { icon } from './icons';
import { Popover, popField, popRow, popSep, type PopRow } from './popover';
import { TrackMenu } from './track-menu';

const MASKS: Array<[MaskMode, string]> = [['none', 'None'], ['clipping', 'Clipping'], ['alpha', 'Alpha'], ['luminance', 'Luminance']];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export class ContentMenu {
  private readonly pop: Popover;
  private ids: string[] = [];
  private readonly tiles: Record<'cut' | 'copy' | 'duplicate' | 'paste', HTMLButtonElement>;
  private readonly range: HTMLInputElement;
  private readonly pct: HTMLElement;
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
  private readonly fill: PopRow;
  private readonly group: PopRow;
  private readonly ungroup: PopRow;
  private readonly del: PopRow;
  private readonly track: TrackMenu;

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
    this.fill = popRow('fillDuration', 'Fill duration');
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

    body.append(tileRow, popSep(), opacity, this.name.el, this.highlight.el, this.blend.el, this.mask.el, popSep(),
      this.split.el, this.after.el, this.fill.el, this.group.el, this.ungroup.el, trackRow.el, popSep(), this.del.el);
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
    for (const [id, r] of this.blendRows) r.setChecked(id === bl.id);
    const mk = first?.mask ?? 'none';
    for (const [id, r] of this.maskRows) r.setChecked(id === mk);
    this.invert.setChecked(!!first?.maskInvert);
    this.invert.setDisabled(mk !== 'alpha' && mk !== 'luminance');
    const over = sel.filter((c) => this.engine.isOver(c));
    this.split.setDisabled(over.length !== 1 || this.engine.frame <= over[0].start);
    this.after.setDisabled(none);
    this.fill.setDisabled(none);
    const isGroup = sel.length === 1 && first.kind === 'group';
    setClass(this.group.el, 'is-gone', sel.length < 2);
    setClass(this.ungroup.el, 'is-gone', !isGroup);
    this.del.setDisabled(none);
  }
}
