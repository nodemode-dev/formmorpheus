// Drawing Layers panel of Draw & Paint: rows with thumbnail, name, blend letter and visibility,
// a side menu for the active row and a side card for opacity and blend mode.
import { el, patchList, q, setChecked, setClass, setHidden, setStyleVar, setText } from './dom';
import { BLEND_MODES } from '../engine/types';
import type { BlendMode } from '../engine/types';
import type { PaintDoc } from '../paint/doc';
import type { PaintLayer } from '../paint/types';
import { blockEnd, depthOf, hiddenByFold, isInside } from '../paint/layer-tree';

const TW = 56, TH = 38, TS = 2, MW = 56;
const ROW_H = 50, ROW_GAP = 2, INDENT = 16;
const ICON_CHEV = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 6.5 2.5 3 2.5-3"/></svg>';
const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2H9l2 2.2h7.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>';
const ICON_PLUS ='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const ICON_HOOK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7a2 2 0 0 0 2 2h7M9.5 8.5 12 11l-2.5 2.5"/></svg>';

type SideKind = 'menu' | 'blend' | 'mask';

/** The blend modes in their families: a heading, then the modes (Passthrough is a group's own mode and is shown for groups only). */
const BLEND_GROUPS: { title: string; ids: BlendMode[] }[] = [
  { title: '', ids: ['normal'] },
  { title: 'Darken', ids: ['darken', 'multiply', 'color-burn', 'linear-burn', 'darker-color'] },
  { title: 'Lighten', ids: ['lighten', 'screen', 'color-dodge', 'add', 'lighter-color'] },
  { title: 'Contrast', ids: ['overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix'] },
  { title: 'Comparative', ids: ['difference', 'exclusion', 'subtract', 'divide'] },
  { title: 'Component', ids: ['hue', 'saturation', 'color', 'luminosity'] },
  { title: '', ids: ['passthrough'] },
];

function blendRows(): string {
  const label = (id: BlendMode): { label: string; short: string } => BLEND_MODES.find((m) => m.id === id) ?? { label: id, short: '' };
  return BLEND_GROUPS.map((g) =>
    (g.title ? `<div class="fm-lp-blendhead">${g.title}</div>` : '') +
    g.ids.map((id) => `<button type="button" class="fm-pop-row has-check" data-blend="${id}"><span class="fm-pop-label">${label(id).label}</span><span class="fm-lp-blendshort">${label(id).short}</span><span class="fm-pop-tail">${ICON_CHECK}</span></button>`).join('')).join('');
}

interface Thumb { layer: PaintLayer; raster: unknown; ver: number; mask: unknown }

export class LayersPanel {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly list: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly blendCard: HTMLElement;
  private readonly maskCard: HTMLElement;
  private readonly dropEl: HTMLElement;
  private readonly range: HTMLInputElement;
  private readonly pct: HTMLElement;
  private readonly blendList: HTMLElement;
  private readonly thumbs = new WeakMap<HTMLElement, Thumb>();
  private anchor: HTMLElement | null = null;
  private opened = false;
  private side: { kind: SideKind; id: string } | null = null;
  private renaming: string | null = null;
  private lastDrag = 0;
  /** Extra selection from Ctrl or Shift click: the active row plus these. Empty: a single selection. */
  private sel = new Set<string>();
  private anchorId = '';

  private readonly onDown = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (!t || this.anchor?.contains(t)) return;
    if (this.root.contains(t)) {
      // A press outside the side cards and the rows' controls dismisses the side card.
      if (this.side && !this.menu.contains(t) && !this.blendCard.contains(t) && !this.maskCard.contains(t) && !(t as HTMLElement).closest?.('.fm-lp-row')) this.closeSide();
      return;
    }
    this.close();
  };
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || this.renaming) return;
    e.stopPropagation();
    if (this.side) this.closeSide(false); else this.close();
  };

  constructor(private readonly opts: { doc: () => PaintDoc | null; onClose?: () => void }) {
    this.root = el<HTMLElement>(`<div class="fm-lp" hidden>
      <div class="fm-lp-card fm-pp-glass">
        <div class="fm-lp-head"><div class="fm-lp-title">Drawing Layers</div><div class="fm-lp-head-btns"><button type="button" class="fm-lp-txt fm-lp-multi fm-lp-delsel is-danger" aria-label="Delete selected layers" title="Delete selected layers" hidden>Delete</button><button type="button" class="fm-lp-txt fm-lp-multi fm-lp-groupsel" aria-label="Group selected layers" title="Group selected layers" hidden>Group</button><button type="button" class="fm-lp-add fm-lp-single fm-lp-addlayer" aria-label="Add layer" title="Add layer (Alt: add a group)">${ICON_PLUS}</button></div></div>
        <div class="fm-lp-listwrap"><div class="fm-lp-list"></div><div class="fm-lp-drop" hidden></div></div>
      </div>
      <div class="fm-lp-side fm-lp-menu fm-pp-glass" hidden>
        <button type="button" class="fm-pop-row" data-act="rename"><span class="fm-pop-label">Rename</span></button>
        <button type="button" class="fm-pop-row" data-act="addmask" data-for="layer"><span class="fm-pop-label">Mask</span></button>
        <button type="button" class="fm-pop-row has-check" data-act="clip" data-for="layer"><span class="fm-pop-label">Clipping Mask</span><span class="fm-pop-tail">${ICON_CHECK}</span></button>
        <button type="button" class="fm-pop-row has-check" data-act="lock" data-for="layer" title="Alpha Lock (Alt+click a layer, or swipe right with two fingers)"><span class="fm-pop-label">Alpha Lock</span><span class="fm-pop-tail">${ICON_CHECK}</span></button>
        <button type="button" class="fm-pop-row" data-act="merge" data-for="layer" title="Merge Down (Alt+Shift+click a layer, or pinch two layers together)"><span class="fm-pop-label">Merge Down</span></button>
        <button type="button" class="fm-pop-row" data-act="clear" data-for="layer"><span class="fm-pop-label">Clear</span></button>
        <div class="fm-pop-sep"></div>
        <button type="button" class="fm-pop-row" data-act="group"><span class="fm-pop-label">Group</span></button>
        <button type="button" class="fm-pop-row" data-act="newgroup"><span class="fm-pop-label">New Group</span></button>
        <button type="button" class="fm-pop-row" data-act="ungroup" data-for="group"><span class="fm-pop-label">Ungroup</span></button>
        <button type="button" class="fm-pop-row" data-act="flatten" data-for="group"><span class="fm-pop-label">Flatten</span></button>
        <button type="button" class="fm-pop-row" data-act="dup"><span class="fm-pop-label">Duplicate</span></button>
        <button type="button" class="fm-pop-row is-danger" data-act="delete"><span class="fm-pop-label">Delete</span></button>
      </div>
      <div class="fm-lp-side fm-lp-maskcard fm-pp-glass" hidden>
        <button type="button" class="fm-pop-row has-check" data-mact="on"><span class="fm-pop-label">Mask Enabled</span><span class="fm-pop-tail">${ICON_CHECK}</span></button>
        <button type="button" class="fm-pop-row has-check" data-mact="link"><span class="fm-pop-label">Linked to Layer</span><span class="fm-pop-tail">${ICON_CHECK}</span></button>
        <div class="fm-pop-sep"></div>
        <button type="button" class="fm-pop-row" data-mact="invert"><span class="fm-pop-label">Invert Mask</span></button>
        <button type="button" class="fm-pop-row" data-mact="apply"><span class="fm-pop-label">Apply Mask</span></button>
        <button type="button" class="fm-pop-row is-danger" data-mact="delete"><span class="fm-pop-label">Delete Mask</span></button>
      </div>
      <div class="fm-lp-side fm-lp-blendcard fm-pp-glass" hidden>
        <div class="fm-cm-opacity"><div class="fm-cm-opacity-head"><span>Opacity</span><span class="fm-cm-pct fm-lp-pct">100%</span></div><input class="fm-cm-range fm-lp-range" type="range" min="0" max="100" step="1" value="100"></div>
        <div class="fm-pop-sep"></div>
        <div class="fm-lp-blends">${blendRows()}</div>
      </div>
    </div>`);
    this.card = q(this.root, '.fm-lp-card');
    this.list = q(this.root, '.fm-lp-list');
    this.menu = q(this.root, '.fm-lp-menu');
    this.blendCard = q(this.root, '.fm-lp-blendcard');
    this.maskCard = q(this.root, '.fm-lp-maskcard');
    this.dropEl = q(this.root, '.fm-lp-drop');
    this.range = q<HTMLInputElement>(this.root, '.fm-lp-range');
    this.pct = q(this.root, '.fm-lp-pct');
    this.blendList = q(this.root, '.fm-lp-blends');

    q(this.root, '.fm-lp-addlayer').addEventListener('click', (e) => {
      const d = this.doc(); if (!d) return;
      if (e.altKey) d.addGroup(); else d.addLayer();
      this.refresh();
    });
    q(this.root, '.fm-lp-delsel').addEventListener('click', () => {
      const d = this.doc(); if (!d || this.sel.size < 2) return;
      const ids = Array.from(this.sel);
      this.sel.clear(); this.closeSide();
      d.deleteMany(ids); this.refresh();
    });
    q(this.root, '.fm-lp-groupsel').addEventListener('click', () => {
      const d = this.doc(); if (!d || this.sel.size < 2) return;
      const ids = Array.from(this.sel);
      this.sel.clear(); this.closeSide();
      d.groupMany(ids); this.refresh();
    });
    this.maskCard.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mact]');
      if (b) this.onMaskMenu(b.dataset.mact ?? '');
    });
    this.list.addEventListener('click', (e) => this.onListClick(e));
    this.list.addEventListener('change', (e) => {
      const t = e.target as HTMLElement;
      if (!t.classList.contains('fm-lp-check')) return;
      const id = t.closest<HTMLElement>('.fm-lp-row')?.dataset.key;
      const d = this.doc();
      if (id && d) { d.setProps(id, { visible: (t as HTMLInputElement).checked }); this.refresh(); }
    });
    this.list.addEventListener('pointerdown', (e) => this.touchDown(e), true);
    this.list.addEventListener('pointerdown', (e) => this.onRowDown(e));
    document.addEventListener('pointermove', (e) => this.touchMove(e));
    for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, (e) => this.touchEnd(e as PointerEvent));
    this.list.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-lp-row');
      if (row && (e.target as HTMLElement).closest('.fm-lp-name')) this.startRename(row.dataset.key ?? '');
    });
    this.menu.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b) this.onMenu(b.dataset.act ?? '');
    });
    this.range.addEventListener('input', () => {
      const d = this.doc(); const id = this.side?.id;
      if (!d || !id) return;
      const v = Number(this.range.value);
      d.setProps(id, { opacity: v / 100 }, `opacity:${id}`);
      setText(this.pct, `${v}%`);
      setStyleVar(this.range, '--fm-pct', `${v}%`);
    });
    // moving down the list shows each mode on the picture; leaving the list (or closing the card) puts the layer back
    this.blendList.addEventListener('pointerover', (e) => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-blend]');
      if (b) this.previewBlend(b.dataset.blend as BlendMode);
    });
    // leaving the list shows the picked mode again (or the layer's own); a click picks a mode and keeps it on show;
    // tapping outside the card confirms it and closes, Escape puts the layer back
    this.blendList.addEventListener('pointerleave', () => this.previewBlend(this.pendingBlend ?? this.blendPreview?.blend ?? null));
    this.blendList.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-blend]');
      if (!b) return;
      this.pendingBlend = b.dataset.blend as BlendMode;
      this.previewBlend(this.pendingBlend);
      this.syncSide();
    });
    // a right click or a touch held on a row opens its menu
    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-lp-row');
      const id = row?.dataset.key, d = this.doc();
      if (!row || !id || !d) return;
      const l = d.layer(id);
      if (!l) return;
      if (!l.group && d.active !== id) d.setActive(id);
      this.openSide('menu', id, row);
      this.refresh();
    });
  }

  open(anchor: HTMLElement): void {
    this.anchor = anchor;
    if (!this.root.parentElement) (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    this.root.hidden = false;
    if (!this.opened) {
      this.opened = true;
      document.addEventListener('pointerdown', this.onDown, true);
      document.addEventListener('keydown', this.onKey, true);
    }
    this.refresh();
    this.place();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.closeSide();
    this.clearSwipe();
    this.renaming = null;
    this.root.hidden = true;
    this.anchor = null;
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
    this.opts.onClose?.();
  }

  isOpen(): boolean { return this.opened; }

  /** Layers (not groups) picked together with Ctrl or Shift click, top to bottom; empty for a single selection. */
  selectedLeaves(): string[] {
    const d = this.doc();
    if (!d || this.sel.size < 2) return [];
    // a picked group counts as every layer inside it
    const picked = (l: { id: string }): boolean => this.sel.has(l.id) || [...this.sel].some((s) => isInside(d.layers, l.id, s));
    return d.layers.filter((l) => !l.group && picked(l)).map((l) => l.id);
  }

  refresh(): void {
    if (!this.opened) return;
    const d = this.doc();
    const all = d ? d.layers : [];
    // rows inside a folded group are not listed
    const layers = all.filter((l) => !hiddenByFold(all, l.id));
    const active = d?.active ?? '';
    for (const id of Array.from(this.sel)) if (!all.some((l) => l.id === id)) this.sel.delete(id);
    if (this.sel.size === 1) this.sel.clear();
    const multi = this.sel.size > 1;
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>('.fm-lp-multi'))) setHidden(b, !multi);
    // picking several layers swaps the plus for Delete and Group
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>('.fm-lp-single'))) setHidden(b, multi);
    patchList(this.list, layers, {
      key: (l) => l.id,
      create: (l) => {
        const row = el<HTMLElement>(`<div class="fm-lp-row">
          <button type="button" class="fm-lp-fold" aria-label="Fold group" title="Fold or open the group" hidden>${ICON_CHEV}</button>
          <span class="fm-lp-hook">${ICON_HOOK}</span>
          <canvas class="fm-lp-thumb" width="${TW * TS}" height="${TH * TS}"></canvas>
          <span class="fm-lp-folder" hidden>${ICON_FOLDER}</span>
          <canvas class="fm-lp-mthumb" width="${MW * TS}" height="${TH * TS}" title="Mask" hidden></canvas>
          <span class="fm-lp-name"></span><input class="fm-lp-rename" type="text" hidden spellcheck="false">
          <button type="button" class="fm-lp-blend" title="Opacity and blend mode"></button>
          <label class="fm-lp-vis"><input class="fm-lp-check" type="checkbox"></label>
          <span class="fm-lp-acts" hidden><button type="button" data-sw="dup">Duplicate</button><button type="button" data-sw="del" class="is-danger">Delete</button></span>
        </div>`);
        this.patchRow(row, l, active, all);
        return row;
      },
      update: (row, l) => this.patchRow(row, l, active, all),
    });
    this.syncSide();
    this.fit();
  }

  private doc(): PaintDoc | null { return this.opts.doc(); }

  private patchRow(row: HTMLElement, l: PaintLayer, active: string, layers: PaintLayer[]): void {
    const d = this.doc();
    const group = !!l.group;
    const editMask = !!d && d.maskEditing() && l.id === active;
    setClass(row, 'is-active', !group && l.id === active);
    setClass(row, 'is-group', group);
    setClass(row, 'is-clip', l.clipping && !group);
    setClass(row, 'is-hidden', !l.visible);
    setClass(row, 'is-multi', this.sel.has(l.id));
    setClass(row, 'is-folded', !!l.collapsed);
    setClass(row, 'is-side', !!this.side && this.side.id === l.id);
    setStyleVar(row, '--fm-depth', String(depthOf(layers, l.id)));
    if (this.renaming !== l.id) setText(q(row, '.fm-lp-name'), l.name);
    const short = BLEND_MODES.find((m) => m.id === l.blend)?.short ?? 'N';
    setText(q(row, '.fm-lp-blend'), short);
    setClass(q(row, '.fm-lp-blend'), 'is-set', l.blend !== 'normal' || l.opacity < 0.995);
    setChecked(q<HTMLInputElement>(row, '.fm-lp-check'), l.visible);
    const c = q<HTMLCanvasElement>(row, '.fm-lp-thumb');
    const mc = q<HTMLCanvasElement>(row, '.fm-lp-mthumb');
    setHidden(q(row, '.fm-lp-fold'), !group);
    setHidden(q(row, '.fm-lp-folder'), !group);
    setHidden(c, group);
    setHidden(mc, !l.mask);
    setClass(c, 'is-sel', !group && l.id === active && !editMask);
    setClass(mc, 'is-sel', editMask);
    setClass(mc, 'is-off', !!l.mask && !l.mask.on);
    const prev = this.thumbs.get(row);
    if (!prev || prev.layer !== l || prev.raster !== l.raster || prev.ver !== l.version || prev.mask !== l.mask) {
      if (d) {
        if (!group) {
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, c.width, c.height);
            try { ctx.drawImage(d.thumbnail(l.id, c.width, c.height) as unknown as CanvasImageSource, 0, 0); } catch { /* thumbnail not ready */ }
          }
        }
        if (l.mask) {
          const mctx = mc.getContext('2d');
          if (mctx) {
            mctx.clearRect(0, 0, mc.width, mc.height);
            try { mctx.drawImage(d.maskThumbnail(l.id, mc.width, mc.height) as unknown as CanvasImageSource, 0, 0); } catch { /* thumbnail not ready */ }
          }
        }
        this.thumbs.set(row, { layer: l, raster: l.raster, ver: l.version, mask: l.mask });
      }
    }
  }

  private place(): void {
    const a = this.anchor;
    if (!a) return;
    const host = (this.root.offsetParent as HTMLElement | null) ?? document.body;
    const hr = host.getBoundingClientRect(), ar = a.getBoundingClientRect();
    const w = this.card.offsetWidth || 280;
    this.root.style.left = `${Math.round(Math.max(8, ar.right - hr.left - w))}px`;
    this.root.style.top = `${Math.round(ar.bottom - hr.top + 8)}px`;
  }

  private fit(): void {
    const host = this.root.offsetParent as HTMLElement | null;
    if (!host) return;
    const top = this.root.offsetTop;
    this.list.style.maxHeight = `${Math.max(120, host.clientHeight - top - 76)}px`;
  }

  // Selection, side cards and renaming

  // Touch gestures and their desktop equivalents: swipe right on a row selects it with others, swipe left shows
  // Duplicate and Delete, two fingers swiped right toggle Alpha Lock, two layers pinched together merge, and
  // Alt+click is Alpha Lock, Alt+Shift+click is Merge Down.

  private touchPts = new Map<number, { x: number; y: number; x0: number; y0: number; row: string }>();
  private twoFinger = false;
  private fired = false;
  private pinch0 = 0;

  private touchDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-lp-row');
    this.touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, row: row?.dataset.key ?? '' });
    if (this.touchPts.size === 2) {
      this.twoFinger = true;
      this.fired = false;
      const [a, b] = [...this.touchPts.values()];
      this.pinch0 = Math.abs(a.y - b.y);
    }
  }

  private touchMove(e: PointerEvent): void {
    const p = this.touchPts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    const d = this.doc();
    if (this.touchPts.size !== 2 || this.fired || !d) return;
    const [a, b] = [...this.touchPts.values()];
    if (a.row && a.row === b.row) {
      const dx = ((a.x - a.x0) + (b.x - b.x0)) / 2, dy = (Math.abs(a.y - a.y0) + Math.abs(b.y - b.y0)) / 2;
      const l = d.layer(a.row);
      if (dx > 28 && dy < 24 && l && !l.group) {
        this.fired = true;
        this.lastDrag = performance.now();
        d.setProps(l.id, { alphaLock: !l.alphaLock });
        this.refresh();
      }
    } else if (a.row && b.row && this.pinch0 >= 60 && Math.abs(a.y - b.y) < this.pinch0 * 0.55) {
      this.fired = true;
      this.lastDrag = performance.now();
      this.mergeSpan(a.row, b.row);
    }
  }

  private touchEnd(e: PointerEvent): void {
    if (!this.touchPts.delete(e.pointerId)) return;
    if (!this.touchPts.size) { this.twoFinger = false; this.fired = false; }
  }

  /** Merges the layers from the upper one down to the lower one into the lower one. */
  private mergeSpan(a: string, b: string): void {
    const d = this.doc();
    if (!d) return;
    const ia = d.layers.findIndex((l) => l.id === a), ib = d.layers.findIndex((l) => l.id === b);
    if (ia < 0 || ib < 0) return;
    const ids = d.layers.slice(Math.min(ia, ib), Math.max(ia, ib) + 1).filter((l) => !l.group).map((l) => l.id);
    for (let k = 0; k < ids.length - 1; k++) if (d.canMergeDown(ids[k])) d.mergeDown(ids[k]);
    this.closeSide();
    this.refresh();
  }

  private toggleSel(id: string): void {
    const d = this.doc();
    const l = d?.layer(id);
    if (!d || !l) return;
    this.closeSide();
    if (this.sel.size === 0 && !d.layer(d.active)?.group) this.sel.add(d.active);
    if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id);
    this.anchorId = id;
    if (!l.group && this.sel.has(id)) d.setActive(id);
    this.refresh();
  }

  private swiped: HTMLElement | null = null;

  private clearSwipe(): void {
    if (!this.swiped) return;
    setClass(this.swiped, 'is-swiped', false);
    setHidden(q(this.swiped, '.fm-lp-acts'), true);
    this.swiped = null;
  }

  private showSwipe(row: HTMLElement): void {
    this.clearSwipe();
    this.closeSide();
    this.swiped = row;
    setClass(row, 'is-swiped', true);
    setHidden(q(row, '.fm-lp-acts'), false);
  }

  private onListClick(e: MouseEvent): void {
    if (performance.now() - this.lastDrag < 150) return;
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.fm-lp-row');
    const id = row?.dataset.key;
    const d = this.doc();
    if (!row || !id || !d) return;
    const sw = t.closest<HTMLElement>('[data-sw]');
    if (sw) {
      this.clearSwipe();
      if (sw.dataset.sw === 'dup') d.duplicateLayer(id); else d.deleteLayer(id);
      this.closeSide();
      this.refresh();
      return;
    }
    if (this.swiped) this.clearSwipe();
    if (t.closest('.fm-lp-vis') || t.closest('.fm-lp-rename')) return;
    const l = d.layer(id);
    if (!l) return;
    if (e.altKey && !l.group && !(e.ctrlKey || e.metaKey)) {
      if (d.active !== id) d.setActive(id);
      if (e.shiftKey) { if (d.canMergeDown(id)) { d.mergeDown(id); this.closeSide(); } }
      else d.setProps(id, { alphaLock: !l.alphaLock });
      this.refresh();
      return;
    }
    if (t.closest('.fm-lp-fold')) { d.setCollapsed(id, !l.collapsed); this.closeSide(); this.refresh(); return; }
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      this.closeSide();
      if (this.sel.size === 0 && !d.layer(d.active)?.group) this.sel.add(d.active);
      if (e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        const shown = d.layers.filter((x) => !hiddenByFold(d.layers, x.id));
        const a = shown.findIndex((x) => x.id === (this.anchorId || d.active)), b = shown.findIndex((x) => x.id === id);
        if (a >= 0 && b >= 0) { this.sel.clear(); for (let k = Math.min(a, b); k <= Math.max(a, b); k++) this.sel.add(shown[k].id); }
      } else if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id);
      this.anchorId = id;
      if (!l.group && this.sel.has(id)) d.setActive(id);
      this.refresh();
      return;
    }
    this.anchorId = id;
    if (this.sel.size) { this.sel.clear(); this.refresh(); }
    if (t.closest('.fm-lp-blend')) {
      if (!l.group && d.active !== id) d.setActive(id);
      this.openSide('blend', id, row);
      this.refresh();
      return;
    }
    if (l.group) {
      if (this.side?.kind === 'menu' && this.side.id === id) this.closeSide(); else this.openSide('menu', id, row);
      this.refresh();
      return;
    }
    if (t.closest('.fm-lp-mthumb') && l.mask) {
      if (d.active === id && d.maskEditing()) {
        if (this.side?.kind === 'mask' && this.side.id === id) this.closeSide(); else this.openSide('mask', id, row);
      } else {
        d.setActive(id);
        d.setMaskEdit(true);
        this.closeSide();
      }
      this.refresh();
      return;
    }
    if (t.closest('.fm-lp-thumb') && d.active === id && d.maskEditing()) { d.setMaskEdit(false); this.closeSide(); this.refresh(); return; }
    if (d.active !== id) { d.setActive(id); this.closeSide(); this.refresh(); return; }
    if (this.side?.kind === 'menu' && this.side.id === id) this.closeSide();
    else this.openSide('menu', id, row);
  }

  private openSide(kind: SideKind, id: string, row: HTMLElement): void {
    if (this.side && (this.side.kind !== kind || this.side.id !== id)) this.endPreview(true);
    this.side = { kind, id };
    setHidden(this.menu, kind !== 'menu');
    setHidden(this.blendCard, kind !== 'blend');
    setHidden(this.maskCard, kind !== 'mask');
    this.syncSide();
    this.placeSide(row);
  }

  private blendPreview: { id: string; blend: BlendMode } | null = null;
  /** The mode clicked in the list: it is recorded when the card closes by a tap outside. */
  private pendingBlend: BlendMode | null = null;

  /** Shows `mode` on the side card's layer without recording it. */
  private previewBlend(mode: BlendMode | null): void {
    const d = this.doc();
    const id = this.side?.kind === 'blend' ? this.side.id : '';
    const l = id && d ? d.layer(id) : null;
    if (!d || !l || !mode) return;
    if (!this.blendPreview) this.blendPreview = { id, blend: l.blend };
    if (l.blend === mode) return;
    l.blend = mode;
    d.markDirty(id, { x: 0, y: 0, w: d.width, h: d.height });
  }

  /** Puts the layer back and, when `keep` and a mode was picked, records that mode as one step. */
  private endPreview(keep = false): void {
    const p = this.blendPreview;
    const pick = this.pendingBlend;
    this.blendPreview = null;
    this.pendingBlend = null;
    const d = this.doc();
    const l = p && d ? d.layer(p.id) : null;
    if (!p || !d || !l) return;
    if (l.blend !== p.blend) {
      l.blend = p.blend;
      d.markDirty(p.id, { x: 0, y: 0, w: d.width, h: d.height });
      d.settle();
    }
    if (keep && pick && pick !== p.blend) { d.setProps(p.id, { blend: pick }); this.refresh(); }
  }

  /** Escape: close only the side card (a blend preview is put back); false when none was open. */
  closeInner(): boolean {
    if (!this.opened || !this.side) return false;
    this.closeSide(false);
    this.refresh();
    return true;
  }

  private closeSide(keep = true): void {
    if (!this.side) return;
    this.endPreview(keep);
    this.side = null;
    setHidden(this.menu, true);
    setHidden(this.blendCard, true);
    setHidden(this.maskCard, true);
  }

  private sideEl(): HTMLElement | null {
    return this.side ? (this.side.kind === 'menu' ? this.menu : this.side.kind === 'mask' ? this.maskCard : this.blendCard) : null;
  }

  private placeSide(row: HTMLElement): void {
    const s = this.sideEl();
    if (!s) return;
    const host = (this.root.offsetParent as HTMLElement | null) ?? document.body;
    const cardW = this.card.offsetWidth, w = s.offsetWidth, h = s.offsetHeight;
    const rootLeft = this.root.offsetLeft;
    let x = -(w + 8);
    if (rootLeft + x < 8) x = cardW + 8; // no room at the left: open to the right
    const rowTop = row.getBoundingClientRect().top - this.root.getBoundingClientRect().top;
    const maxTop = host.clientHeight - this.root.offsetTop - h - 8;
    const y = Math.max(0, Math.min(rowTop - 4, maxTop));
    s.style.left = `${x}px`;
    s.style.top = `${Math.round(y)}px`;
  }

  /** Reflects the layer's current props in the open side card. */
  private syncSide(): void {
    const d = this.doc();
    if (!this.side || !d) return;
    const l = d.layer(this.side.id);
    if (!l) { this.closeSide(); return; }
    const grp = !!l.group;
    if (this.side.kind === 'menu') {
      for (const b of Array.from(this.menu.querySelectorAll<HTMLElement>('[data-for]'))) setHidden(b, b.dataset.for === 'layer' ? grp : !grp);
      setHidden(q(this.menu, '[data-act=addmask]'), grp || !!l.mask);
      setClass(q(this.menu, '[data-act=clip]'), 'is-checked', l.clipping);
      setClass(q(this.menu, '[data-act=lock]'), 'is-checked', l.alphaLock);
      setClass(q(this.menu, '[data-act=merge]'), 'is-disabled', !d.canMergeDown(l.id));
    } else if (this.side.kind === 'mask') {
      if (!l.mask) { this.closeSide(); return; }
      setClass(q(this.maskCard, '[data-mact=on]'), 'is-checked', l.mask.on);
      setClass(q(this.maskCard, '[data-mact=link]'), 'is-checked', l.mask.linked);
    } else {
      setHidden(q(this.blendList, '[data-blend=passthrough]'), !grp);
      const v = Math.round(l.opacity * 100);
      if (document.activeElement !== this.range && this.range.value !== String(v)) this.range.value = String(v);
      setText(this.pct, `${v}%`);
      setStyleVar(this.range, '--fm-pct', `${v}%`);
      for (const b of Array.from(this.blendList.children) as HTMLElement[]) setClass(b, 'is-checked', b.dataset.blend === l.blend);
      // the opacity slider and the list sit in one card: the layer's blend letter follows the shown mode
      const row = this.rowOf(l.id);
      if (row) setText(q(row, '.fm-lp-blend'), BLEND_MODES.find((m) => m.id === l.blend)?.short ?? 'N');
    }
  }

  private onMenu(act: string): void {
    const d = this.doc(); const id = this.side?.id;
    if (!d || !id) return;
    const l = d.layer(id);
    if (!l) return;
    switch (act) {
      case 'rename': {
        const row = this.rowOf(id);
        this.closeSide();
        if (row) this.startRename(id);
        return;
      }
      case 'clip': d.setProps(id, { clipping: !l.clipping }); break;
      case 'lock': d.setProps(id, { alphaLock: !l.alphaLock }); break;
      case 'merge': if (d.canMergeDown(id)) { d.mergeDown(id); this.closeSide(); } break;
      case 'dup': d.duplicateLayer(id); this.closeSide(); break;
      case 'clear': d.clearLayer(id); this.closeSide(); break;
      case 'delete': d.deleteLayer(id); this.closeSide(); break;
      case 'addmask': d.addMask(id); this.closeSide(); break;
      case 'group': d.addGroup(id); this.closeSide(); break;
      case 'newgroup': d.addGroup(); this.closeSide(); break;
      case 'ungroup': d.ungroup(id); this.closeSide(); break;
      case 'flatten': d.flattenGroup(id); this.closeSide(); break;
    }
    this.refresh();
  }

  private onMaskMenu(act: string): void {
    const d = this.doc(); const id = this.side?.id;
    if (!d || !id) return;
    const l = d.layer(id);
    if (!l || !l.mask) return;
    switch (act) {
      case 'on': d.setMask(id, { on: !l.mask.on }); break;
      case 'link': d.setMask(id, { linked: !l.mask.linked }); break;
      case 'invert': d.invertMask(id); this.closeSide(); break;
      case 'apply': d.applyMask(id); this.closeSide(); break;
      case 'delete': d.deleteMask(id); this.closeSide(); break;
    }
    this.refresh();
  }

  private rowOf(id: string): HTMLElement | null {
    for (const r of Array.from(this.list.children) as HTMLElement[]) if (r.dataset.key === id) return r;
    return null;
  }

  private startRename(id: string): void {
    const row = this.rowOf(id); const d = this.doc(); const l = d?.layer(id);
    if (!row || !d || !l) return;
    this.renaming = id;
    const name = q(row, '.fm-lp-name'), input = q<HTMLInputElement>(row, '.fm-lp-rename');
    input.value = l.name;
    setHidden(name, true);
    setHidden(input, false);
    input.focus();
    input.select();
    let done = false;
    const end = (commit: boolean): void => {
      if (done) return;
      done = true;
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
      const v = input.value.trim();
      this.renaming = null;
      setHidden(input, true);
      setHidden(name, false);
      if (commit && v && v !== l.name) d.setProps(id, { name: v });
      this.refresh();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') { e.preventDefault(); end(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); }
      e.stopPropagation();
    };
    const onBlur = (): void => end(true);
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
  }

  // Drag to reorder and to move into or out of groups

  /** Where a dragged row would land at the pointer: its group and the entry it goes above (null: bottom of the group). Moves the drop line. */
  private dropAt(d: PaintDoc, dragId: string, dx: number, cy: number): { parent: string | null; before: string | null } | null {
    const all = d.layers;
    const di = all.findIndex((l) => l.id === dragId);
    if (di < 0) return null;
    const gone = new Set(all.slice(di, blockEnd(all, di)).map((l) => l.id));
    const rest = all.filter((l) => !gone.has(l.id));
    const rows = (Array.from(this.list.children) as HTMLElement[]).filter((r) => !gone.has(r.dataset.key ?? ''));
    let g = 0;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (cy > b.top + b.height / 2) g++; else break;
    }
    const byId = new Map(rest.map((l) => [l.id, l]));
    const prev = g > 0 ? byId.get(rows[g - 1].dataset.key ?? '') : undefined;
    const next = g < rows.length ? byId.get(rows[g].dataset.key ?? '') : undefined;
    const depthPrev = prev ? depthOf(rest, prev.id) : -1;
    const maxD = prev ? depthPrev + (prev.group && !prev.collapsed ? 1 : 0) : 0;
    const minD = Math.min(next ? depthOf(rest, next.id) : 0, maxD);
    const depth = Math.max(minD, Math.min(maxD, depthOf(all, dragId) + Math.round(dx / INDENT)));
    let parent: string | null;
    let before: string | null;
    if (!prev) {
      parent = null;
      before = rest[0]?.id ?? null;
    } else if (depth === depthPrev + 1) {
      parent = prev.id;
      const n = rest[rest.indexOf(prev) + 1];
      before = n && n.parent === prev.id ? n.id : null;
    } else {
      let a = prev;
      for (let da = depthPrev; da > depth; da--) a = byId.get(a.parent ?? '') ?? a;
      parent = a.parent ?? null;
      const n = rest[blockEnd(rest, rest.indexOf(a))];
      before = n && (n.parent ?? null) === parent ? n.id : null;
    }
    const wrap = this.dropEl.parentElement as HTMLElement;
    const wr = wrap.getBoundingClientRect();
    const edge = prev ? rows[g - 1].getBoundingClientRect().bottom : rows[0] ? rows[0].getBoundingClientRect().top : wr.top;
    const left = 8 + depth * INDENT;
    this.dropEl.style.top = `${Math.round(edge - wr.top)}px`;
    this.dropEl.style.left = `${left}px`;
    this.dropEl.style.width = `${Math.max(20, wr.width - left - 8)}px`;
    setHidden(this.dropEl, false);
    return { parent, before };
  }

  private onRowDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('.fm-lp-vis, .fm-lp-blend, .fm-lp-rename, .fm-lp-fold')) return;
    const row = t.closest<HTMLElement>('.fm-lp-row');
    const d = this.doc();
    if (!row || !d || t.closest('.fm-lp-acts')) return;
    const id = row.dataset.key ?? '';
    const startX = e.clientX, startY = e.clientY, pid = e.pointerId;
    let started = false;
    let swipe = 0;
    let drop: { parent: string | null; before: string | null } | null = null;

    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid || this.twoFinger) return;
      const dy = ev.clientY - startY;
      if (!started) {
        // a mostly sideways flick is a swipe: right picks the row with others, left shows Duplicate and Delete
        const dx = ev.clientX - startX;
        if (!swipe && Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy) * 1.5) swipe = dx > 0 ? 1 : -1;
        if (swipe) return;
        if (Math.abs(dy) < 5 || d.layers.length < 2) return;
        started = true;
        row.setPointerCapture(pid);
        this.list.classList.add('is-dragging');
        row.classList.add('is-lifted');
        this.closeSide();
      }
      row.style.transform = `translateY(${dy}px)`;
      drop = this.dropAt(d, id, ev.clientX - startX, ev.clientY);
    };
    const end = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      if (swipe && ev.type === 'pointerup' && !this.twoFinger) {
        this.lastDrag = performance.now();
        if (swipe > 0) this.toggleSel(id); else this.showSwipe(row);
        return;
      }
      if (!started) return;
      this.lastDrag = performance.now();
      this.list.classList.add('is-settling');
      row.style.transform = '';
      row.classList.remove('is-lifted');
      this.list.classList.remove('is-dragging');
      setHidden(this.dropEl, true);
      if (drop && ev.type === 'pointerup') {
        if (this.sel.size > 1 && this.sel.has(id)) d.moveMany(Array.from(this.sel), drop.parent, drop.before);
        else d.moveEntry(id, drop.parent, drop.before);
      }
      this.refresh();
      requestAnimationFrame(() => this.list.classList.remove('is-settling'));
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  }
}
