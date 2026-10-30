// Drawing Layers panel of Draw & Paint: rows with thumbnail, name, blend letter and visibility,
// a side menu for the active row and a side card for opacity and blend mode.
import { el, patchList, q, setChecked, setClass, setHidden, setStyleVar, setText } from './dom';
import { BLEND_MODES } from '../engine/types';
import type { BlendMode } from '../engine/types';
import type { PaintDoc } from '../paint/doc';
import type { PaintLayer } from '../paint/types';

const TW = 56, TH = 38, TS = 2;
const ROW_H = 50, ROW_GAP = 2;

const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const ICON_HOOK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7a2 2 0 0 0 2 2h7M9.5 8.5 12 11l-2.5 2.5"/></svg>';

type SideKind = 'menu' | 'blend';

interface Thumb { layer: PaintLayer; raster: unknown; ver: number }

export class LayersPanel {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly list: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly blendCard: HTMLElement;
  private readonly range: HTMLInputElement;
  private readonly pct: HTMLElement;
  private readonly blendList: HTMLElement;
  private readonly thumbs = new WeakMap<HTMLElement, Thumb>();
  private anchor: HTMLElement | null = null;
  private opened = false;
  private side: { kind: SideKind; id: string } | null = null;
  private renaming: string | null = null;
  private lastDrag = 0;

  private readonly onDown = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (!t || this.anchor?.contains(t)) return;
    if (this.root.contains(t)) {
      // A press outside the side cards and the rows' controls dismisses the side card.
      if (this.side && !this.menu.contains(t) && !this.blendCard.contains(t) && !(t as HTMLElement).closest?.('.fm-lp-row')) this.closeSide();
      return;
    }
    this.close();
  };
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || this.renaming) return;
    e.stopPropagation();
    if (this.side) this.closeSide(); else this.close();
  };

  constructor(private readonly opts: { doc: () => PaintDoc | null; onClose?: () => void }) {
    const modes = BLEND_MODES.filter((m) => m.id !== 'passthrough');
    this.root = el<HTMLElement>(`<div class="fm-lp" hidden>
      <div class="fm-lp-card fm-pp-glass">
        <div class="fm-lp-head"><div class="fm-lp-title">Drawing Layers</div><button type="button" class="fm-lp-add" aria-label="Add layer" title="Add layer">${ICON_PLUS}</button></div>
        <div class="fm-lp-list"></div>
      </div>
      <div class="fm-lp-side fm-lp-menu fm-pp-glass" hidden>
        <button type="button" class="fm-pop-row" data-act="rename"><span class="fm-pop-label">Rename</span></button>
        <button type="button" class="fm-pop-row has-check" data-act="clip"><span class="fm-pop-label">Clipping Mask</span><span class="fm-pop-tail">${ICON_CHECK}</span></button>
        <button type="button" class="fm-pop-row has-check" data-act="lock"><span class="fm-pop-label">Alpha Lock</span><span class="fm-pop-tail">${ICON_CHECK}</span></button>
        <div class="fm-pop-sep"></div>
        <button type="button" class="fm-pop-row" data-act="merge"><span class="fm-pop-label">Merge Down</span></button>
        <button type="button" class="fm-pop-row" data-act="dup"><span class="fm-pop-label">Duplicate</span></button>
        <button type="button" class="fm-pop-row" data-act="clear"><span class="fm-pop-label">Clear</span></button>
        <button type="button" class="fm-pop-row is-danger" data-act="delete"><span class="fm-pop-label">Delete</span></button>
      </div>
      <div class="fm-lp-side fm-lp-blendcard fm-pp-glass" hidden>
        <div class="fm-cm-opacity"><div class="fm-cm-opacity-head"><span>Opacity</span><span class="fm-cm-pct fm-lp-pct">100%</span></div><input class="fm-cm-range fm-lp-range" type="range" min="0" max="100" step="1" value="100"></div>
        <div class="fm-pop-sep"></div>
        <div class="fm-lp-blends">${modes.map((m) => `<button type="button" class="fm-pop-row has-check" data-blend="${m.id}"><span class="fm-pop-label">${m.label}</span><span class="fm-pop-tail">${ICON_CHECK}</span></button>`).join('')}</div>
      </div>
    </div>`);
    this.card = q(this.root, '.fm-lp-card');
    this.list = q(this.root, '.fm-lp-list');
    this.menu = q(this.root, '.fm-lp-menu');
    this.blendCard = q(this.root, '.fm-lp-blendcard');
    this.range = q<HTMLInputElement>(this.root, '.fm-lp-range');
    this.pct = q(this.root, '.fm-lp-pct');
    this.blendList = q(this.root, '.fm-lp-blends');

    q(this.root, '.fm-lp-add').addEventListener('click', () => {
      const d = this.doc(); if (!d) return;
      d.addLayer(); this.refresh();
    });
    this.list.addEventListener('click', (e) => this.onListClick(e));
    this.list.addEventListener('change', (e) => {
      const t = e.target as HTMLElement;
      if (!t.classList.contains('fm-lp-check')) return;
      const id = t.closest<HTMLElement>('.fm-lp-row')?.dataset.key;
      const d = this.doc();
      if (id && d) { d.setProps(id, { visible: (t as HTMLInputElement).checked }); this.refresh(); }
    });
    this.list.addEventListener('pointerdown', (e) => this.onRowDown(e));
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
    this.blendList.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-blend]');
      const d = this.doc(); const id = this.side?.id;
      if (!b || !d || !id) return;
      d.setProps(id, { blend: b.dataset.blend as BlendMode });
      this.refresh();
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
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
    this.renaming = null;
    this.root.hidden = true;
    this.anchor = null;
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
    this.opts.onClose?.();
  }

  isOpen(): boolean { return this.opened; }

  refresh(): void {
    if (!this.opened) return;
    const d = this.doc();
    const layers = d ? d.layers : [];
    const active = d?.active ?? '';
    patchList(this.list, layers, {
      key: (l) => l.id,
      create: (l) => {
        const row = el<HTMLElement>(`<div class="fm-lp-row">
          <span class="fm-lp-hook">${ICON_HOOK}</span>
          <canvas class="fm-lp-thumb" width="${TW * TS}" height="${TH * TS}"></canvas>
          <span class="fm-lp-name"></span><input class="fm-lp-rename" type="text" hidden spellcheck="false">
          <button type="button" class="fm-lp-blend" title="Opacity and blend mode"></button>
          <label class="fm-lp-vis"><input class="fm-lp-check" type="checkbox"></label>
        </div>`);
        this.patchRow(row, l, active, layers);
        return row;
      },
      update: (row, l) => this.patchRow(row, l, active, layers),
    });
    this.syncSide();
    this.fit();
  }

  private doc(): PaintDoc | null { return this.opts.doc(); }

  private patchRow(row: HTMLElement, l: PaintLayer, active: string, layers: PaintLayer[]): void {
    setClass(row, 'is-active', l.id === active);
    setClass(row, 'is-clip', l.clipping);
    setClass(row, 'is-hidden', !l.visible);
    if (this.renaming !== l.id) setText(q(row, '.fm-lp-name'), l.name);
    const short = BLEND_MODES.find((m) => m.id === l.blend)?.short ?? 'N';
    setText(q(row, '.fm-lp-blend'), short);
    setClass(q(row, '.fm-lp-blend'), 'is-set', l.blend !== 'normal' || l.opacity < 0.995);
    setChecked(q<HTMLInputElement>(row, '.fm-lp-check'), l.visible);
    void layers;
    const c = q<HTMLCanvasElement>(row, '.fm-lp-thumb');
    const prev = this.thumbs.get(row);
    if (!prev || prev.layer !== l || prev.raster !== l.raster || prev.ver !== l.version) {
      const d = this.doc();
      if (d) {
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, c.width, c.height);
          try { ctx.drawImage(d.thumbnail(l.id, c.width, c.height) as unknown as CanvasImageSource, 0, 0); } catch { /* thumbnail not ready */ }
        }
        this.thumbs.set(row, { layer: l, raster: l.raster, ver: l.version });
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

  private onListClick(e: MouseEvent): void {
    if (performance.now() - this.lastDrag < 150) return;
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.fm-lp-row');
    const id = row?.dataset.key;
    const d = this.doc();
    if (!row || !id || !d) return;
    if (t.closest('.fm-lp-vis') || t.closest('.fm-lp-rename')) return;
    if (t.closest('.fm-lp-blend')) {
      if (d.active !== id) d.setActive(id);
      this.openSide('blend', id, row);
      this.refresh();
      return;
    }
    if (d.active !== id) { d.setActive(id); this.closeSide(); this.refresh(); return; }
    if (this.side?.kind === 'menu' && this.side.id === id) this.closeSide();
    else this.openSide('menu', id, row);
  }

  private openSide(kind: SideKind, id: string, row: HTMLElement): void {
    this.side = { kind, id };
    setHidden(this.menu, kind !== 'menu');
    setHidden(this.blendCard, kind !== 'blend');
    this.syncSide();
    this.placeSide(row);
  }

  private closeSide(): void {
    if (!this.side) return;
    this.side = null;
    setHidden(this.menu, true);
    setHidden(this.blendCard, true);
  }

  private placeSide(row: HTMLElement): void {
    const s = this.side ? (this.side.kind === 'menu' ? this.menu : this.blendCard) : null;
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
    if (this.side.kind === 'menu') {
      setClass(q(this.menu, '[data-act=clip]'), 'is-checked', l.clipping);
      setClass(q(this.menu, '[data-act=lock]'), 'is-checked', l.alphaLock);
      setClass(q(this.menu, '[data-act=merge]'), 'is-disabled', d.layers.indexOf(l) >= d.layers.length - 1);
    } else {
      const v = Math.round(l.opacity * 100);
      if (document.activeElement !== this.range && this.range.value !== String(v)) this.range.value = String(v);
      setText(this.pct, `${v}%`);
      setStyleVar(this.range, '--fm-pct', `${v}%`);
      for (const b of Array.from(this.blendList.children) as HTMLElement[]) setClass(b, 'is-checked', b.dataset.blend === l.blend);
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
      case 'merge': if (d.layers.indexOf(l) < d.layers.length - 1) { d.mergeDown(id); this.closeSide(); } break;
      case 'dup': d.duplicateLayer(id); this.closeSide(); break;
      case 'clear': d.clearLayer(id); this.closeSide(); break;
      case 'delete': d.deleteLayer(id); this.closeSide(); break;
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

  // Drag to reorder

  private onRowDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('.fm-lp-vis, .fm-lp-blend, .fm-lp-rename')) return;
    const row = t.closest<HTMLElement>('.fm-lp-row');
    const d = this.doc();
    if (!row || !d || d.layers.length < 2) return;
    const rows = Array.from(this.list.children) as HTMLElement[];
    const from = rows.indexOf(row);
    const id = row.dataset.key ?? '';
    const startY = e.clientY, pid = e.pointerId;
    const pitch = row.offsetHeight + ROW_GAP || ROW_H + ROW_GAP;
    let started = false, to = from;

    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      let dy = ev.clientY - startY;
      if (!started) {
        if (Math.abs(dy) < 5) return;
        started = true;
        row.setPointerCapture(pid);
        this.list.classList.add('is-dragging');
        row.classList.add('is-lifted');
        this.closeSide();
      }
      dy = Math.max(-from * pitch, Math.min((rows.length - 1 - from) * pitch, dy));
      row.style.transform = `translateY(${dy}px)`;
      to = Math.max(0, Math.min(rows.length - 1, Math.round(from + dy / pitch)));
      rows.forEach((r, i) => {
        if (r === row) return;
        const shift = from < to && i > from && i <= to ? -pitch : from > to && i >= to && i < from ? pitch : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const end = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      if (!started) return;
      this.lastDrag = performance.now();
      this.list.classList.add('is-settling');
      for (const r of rows) r.style.transform = '';
      row.classList.remove('is-lifted');
      this.list.classList.remove('is-dragging');
      if (to !== from && ev.type === 'pointerup') d.moveLayer(id, to);
      this.refresh();
      requestAnimationFrame(() => this.list.classList.remove('is-settling'));
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  }
}
