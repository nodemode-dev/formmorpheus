// The effect stack section of the Action menu: the effects on the selected block in the order they apply
// (drag a handle to reorder), Copy / Paste of the whole stack, and saved presets.
// Built once; every update only patches rows (visibility, CSS order, text), so nothing flashes.
import type { Engine } from '../engine/engine';
import { allEffects, fxKind } from '../engine/fx/registry';
import { clearFx, copyFx, fxLanes, moveFx, pasteFx, type FxPreset } from '../engine/fx/stack';
import { kindSpec } from '../engine/keys';
import * as ops from '../engine/ops';
import type { Content, KeyKind, KeyLane } from '../engine/types';
import { el, patchList, q, setClass, setDisabled, setHidden, setText } from './dom';
import '../styles/fx-stack.css';

const GRIP = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/><circle cx="6" cy="8" r="1.2"/><circle cx="10" cy="8" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/></svg>';
const CLOSE = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

const STORE = 'fm-fx-presets';

function loadPresets(): FxPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '[]') as FxPreset[];
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p.name === 'string' && Array.isArray(p.lanes)) : [];
  } catch { return []; }
}

function storePresets(list: FxPreset[]): void {
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* storage blocked: presets last for this session only */ }
}

/** Effects copied from a block; shared by every Action menu. */
let clipboard: KeyLane[] | null = null;

interface Row { kind: KeyKind; el: HTMLElement; name: HTMLElement; grip: HTMLButtonElement }

export class FxStack {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly rows = new Map<KeyKind, Row>();
  private readonly copyBtn: HTMLButtonElement;
  private readonly pasteBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly nameRow: HTMLElement;
  private readonly nameIn: HTMLInputElement;
  private readonly presetBox: HTMLElement;
  private presets: FxPreset[] = loadPresets();
  /** Kinds in stack order for the content shown; while a drag runs, the order being dragged. */
  private order: KeyKind[] = [];
  private drag: { kind: KeyKind; from: number } | null = null;
  private target: Content | null = null;

  constructor(private readonly engine: Engine, private readonly open: (kind: KeyKind) => void) {
    this.root = el(
      '<div class="fm-fxs" hidden>' +
      '<div class="fm-fxs-head"><span class="fm-fxs-title"></span><span class="fm-fxs-acts"><button class="fm-fxs-btn" type="button" data-a="copy"></button><button class="fm-fxs-btn" type="button" data-a="paste"></button><button class="fm-fxs-btn" type="button" data-a="save"></button></span></div>' +
      '<div class="fm-fxs-name" hidden><input class="fm-fxs-in" type="text" maxlength="40"><button class="fm-fxs-btn is-primary" type="button" data-a="ok"></button></div>' +
      '<div class="fm-fxs-list"></div>' +
      '<div class="fm-fxs-presets" hidden></div>' +
      '</div>');
    setText(q(this.root, '.fm-fxs-title'), 'Effect stack');
    this.copyBtn = q(this.root, '[data-a="copy"]');
    this.pasteBtn = q(this.root, '[data-a="paste"]');
    this.saveBtn = q(this.root, '[data-a="save"]');
    setText(this.copyBtn, 'Copy');
    setText(this.pasteBtn, 'Paste');
    setText(this.saveBtn, 'Save preset');
    this.copyBtn.title = 'Copy effects';
    this.pasteBtn.title = 'Paste effects';
    this.nameRow = q(this.root, '.fm-fxs-name');
    this.nameIn = q(this.nameRow, '.fm-fxs-in');
    this.nameIn.placeholder = 'Preset name';
    this.nameIn.setAttribute('aria-label', 'Preset name');
    setText(q(this.nameRow, '[data-a="ok"]'), 'Save');
    this.list = q(this.root, '.fm-fxs-list');
    this.presetBox = q(this.root, '.fm-fxs-presets');

    for (const e of allEffects()) {
      const kind = fxKind(e.id);
      const row = el(`<div class="fm-fxs-row" hidden><button class="fm-fxs-grip" type="button">${GRIP}</button><button class="fm-fxs-open" type="button"><span class="fm-fxs-ico">${kindSpec(kind).icon}</span><span class="fm-fxs-name-t"></span></button></div>`);
      const name = q(row, '.fm-fxs-name-t');
      setText(name, e.label);
      const grip = q<HTMLButtonElement>(row, '.fm-fxs-grip');
      grip.title = 'Drag to reorder';
      grip.setAttribute('aria-label', 'Drag to reorder');
      q(row, '.fm-fxs-open').addEventListener('click', () => this.open(kind));
      grip.addEventListener('pointerdown', (ev) => this.startDrag(ev, kind));
      grip.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
        ev.preventDefault();
        const i = this.order.indexOf(kind);
        this.commitMove(kind, i + (ev.key === 'ArrowUp' ? -1 : 1));
      });
      this.list.appendChild(row);
      this.rows.set(kind, { kind, el: row, name, grip });
    }

    this.copyBtn.addEventListener('click', () => { if (this.target) { clipboard = copyFx(this.target); this.sync(this.target); } });
    this.pasteBtn.addEventListener('click', () => this.apply(clipboard, false, 'Paste effects'));
    this.saveBtn.addEventListener('click', () => {
      setHidden(this.nameRow, !this.nameRow.hidden);
      if (!this.nameRow.hidden) this.nameIn.focus();
    });
    const commitName = (): void => {
      const name = this.nameIn.value.trim();
      if (!name || !this.target) return;
      const lanes = copyFx(this.target);
      if (!lanes.length) return;
      this.presets = [...this.presets.filter((p) => p.name !== name), { name, lanes }];
      storePresets(this.presets);
      this.nameIn.value = '';
      setHidden(this.nameRow, true);
      this.sync(this.target);
    };
    q(this.nameRow, '[data-a="ok"]').addEventListener('click', commitName);
    this.nameIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitName(); } });
  }

  /** Patches the section for the content shown (null: none). */
  sync(c: Content | null): void {
    this.target = c;
    const lanes = c ? fxLanes(c) : [];
    const showable = !!c && c.kind !== 'audio' && (lanes.length > 0 || !!clipboard?.length || this.presets.length > 0);
    setHidden(this.root, !showable);
    if (!showable || this.drag) return;
    this.order = lanes.map((l) => l.kind);
    this.paintOrder();
    setDisabled(this.copyBtn, !lanes.length);
    setDisabled(this.pasteBtn, !clipboard || !clipboard.length);
    setDisabled(this.saveBtn, !lanes.length);
    if (!lanes.length) setHidden(this.nameRow, true);
    setHidden(this.presetBox, !this.presets.length);
    patchList(this.presetBox, this.presets, {
      key: (p) => p.name,
      create: (p) => {
        const chip = el('<span class="fm-fxs-chip"><button class="fm-fxs-apply" type="button"></button><button class="fm-fxs-del" type="button"></button></span>');
        q(chip, '.fm-fxs-del').innerHTML = CLOSE;
        q(chip, '.fm-fxs-del').title = 'Delete preset';
        q(chip, '.fm-fxs-del').setAttribute('aria-label', 'Delete preset');
        q(chip, '.fm-fxs-apply').addEventListener('click', () => {
          const cur = this.presets.find((x) => x.name === chip.dataset.key);
          if (cur) this.apply(cur.lanes, false, 'Apply effect preset');
        });
        q(chip, '.fm-fxs-del').addEventListener('click', () => {
          this.presets = this.presets.filter((x) => x.name !== chip.dataset.key);
          storePresets(this.presets);
          this.sync(this.target);
        });
        return chip;
      },
      update: (node, p) => { setText(q(node, '.fm-fxs-apply'), p.name); (q(node, '.fm-fxs-apply') as HTMLButtonElement).title = 'Apply preset'; },
    });
  }

  private paintOrder(): void {
    for (const [kind, r] of this.rows) {
      const i = this.order.indexOf(kind);
      setHidden(r.el, i < 0);
      if (i >= 0 && r.el.style.order !== String(i)) r.el.style.order = String(i);
    }
  }

  private apply(lanes: KeyLane[] | null, replace: boolean, label: string): void {
    const t = this.target;
    if (!t || !lanes || !lanes.length) return;
    this.engine.run(label, (m) => ops.updateContent(m, t.id, (cc) => pasteFx(cc, lanes, replace)));
  }

  private commitMove(kind: KeyKind, to: number): void {
    const t = this.target;
    if (!t || to < 0 || to >= this.order.length) return;
    this.engine.run('Reorder effects', (m) => ops.updateContent(m, t.id, (cc) => moveFx(cc, kind, to)));
  }

  /** Drag by the handle: rows swap places live (CSS order only), one undo step on release. */
  private startDrag(ev: PointerEvent, kind: KeyKind): void {
    const row = this.rows.get(kind);
    if (!row || !this.target || this.order.length < 2 || ev.button !== 0) return;
    ev.preventDefault();
    row.grip.setPointerCapture(ev.pointerId);
    this.drag = { kind, from: this.order.indexOf(kind) };
    setClass(row.el, 'is-dragging', true);
    const move = (e: PointerEvent): void => {
      const d = this.drag;
      if (!d) return;
      // the slot under the pointer, measured on the other visible rows
      const others = this.order.filter((k) => k !== d.kind);
      let to = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = this.rows.get(others[i])!.el.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { to = i; break; }
      }
      const next = others.slice();
      next.splice(to, 0, d.kind);
      if (next.join() !== this.order.join()) { this.order = next; this.paintOrder(); }
    };
    const end = (e: PointerEvent): void => {
      row.grip.removeEventListener('pointermove', move);
      row.grip.removeEventListener('pointerup', end);
      row.grip.removeEventListener('pointercancel', end);
      try { row.grip.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      setClass(row.el, 'is-dragging', false);
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      const to = this.order.indexOf(d.kind);
      if (e.type === 'pointerup' && to !== d.from) {
        const t = this.target;
        if (t) this.engine.run('Reorder effects', (m) => ops.updateContent(m, t.id, (cc) => moveFx(cc, d.kind, to)));
      } else if (this.target) this.sync(this.target);
    };
    row.grip.addEventListener('pointermove', move);
    row.grip.addEventListener('pointerup', end);
    row.grip.addEventListener('pointercancel', end);
  }

  /** Removes every effect from the target (kept for a Clear all hook). */
  clearAll(): void {
    const t = this.target;
    if (t) this.engine.run('Clear effects', (m) => ops.updateContent(m, t.id, (cc) => clearFx(cc)));
  }
}
