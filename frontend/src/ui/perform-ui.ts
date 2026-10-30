// Perform mode UI: shared settings, the Stage banner and the Modifications popover.
import type { Engine } from '../engine/engine';
import { el, q, setClass, setHidden, setStyleVar, setText } from './dom';
import { Popover } from './popover';

const STORE = 'formmorpheus.perform';

type Listener = () => void;

/** Perform settings and the "a gesture is recording" flag, shared by the Stage, the Timeline and the Action menu. */
class PerformState {
  /** Motion filtering 0..1 (default 30%). */
  filtering = 0.3;
  /** Roll sensitivity 0..1 for pen twist (default 50%). */
  roll = 0.5;
  private rec = false;
  private readonly subs = new Set<Listener>();

  constructor() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const o = JSON.parse(raw) as { filtering?: unknown; roll?: unknown };
        if (typeof o.filtering === 'number') this.filtering = clamp(o.filtering);
        if (typeof o.roll === 'number') this.roll = clamp(o.roll);
      }
    } catch { /* storage unavailable or corrupt: keep defaults */ }
  }

  get recording(): boolean { return this.rec; }

  setRecording(on: boolean): void {
    if (on === this.rec) return;
    this.rec = on;
    this.emit();
  }

  set(patch: { filtering?: number; roll?: number }): void {
    if (patch.filtering !== undefined) this.filtering = clamp(patch.filtering);
    if (patch.roll !== undefined) this.roll = clamp(patch.roll);
    try { localStorage.setItem(STORE, JSON.stringify({ filtering: this.filtering, roll: this.roll })); } catch { /* ignore */ }
    this.emit();
  }

  onChange(fn: Listener): void { this.subs.add(fn); }

  private emit(): void { for (const fn of this.subs) fn(); }
}

function clamp(n: number): number { return Math.min(1, Math.max(0, n)); }

export const perform = new PerformState();

/** Ring with a dot: the Playhead pill's glyph in Perform mode (the dot pulses while recording). */
export const REC_GLYPH = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle class="fm-rec-core" cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';

interface ModRow { range: HTMLInputElement; pill: HTMLElement }

/** The Modifications popover: Motion filtering and Roll sensitivity. Built on first use, then patched. */
class ModsPopover {
  private pop: Popover | null = null;
  private rows: { filtering: ModRow; roll: ModRow } | null = null;

  private build(): Popover {
    const pop = new Popover('fm-pf', 280);
    pop.body.appendChild(el('<div class="fm-pf-title">Modifications</div>'));
    const mk = (label: string, key: 'filtering' | 'roll', hint: string): ModRow => {
      const wrap = el(`<div class="fm-pf-row"><span class="fm-pf-label"></span><input class="fm-kc-range" type="range" min="0" max="100" step="1"><span class="fm-kc-val"></span><span class="fm-pf-hint"></span></div>`);
      setText(q(wrap, '.fm-pf-label'), label);
      setText(q(wrap, '.fm-pf-hint'), hint);
      const range = q<HTMLInputElement>(wrap, '.fm-kc-range');
      range.setAttribute('aria-label', label);
      const pill = q(wrap, '.fm-kc-val');
      range.addEventListener('input', () => perform.set({ [key]: range.valueAsNumber / 100 }));
      pop.body.appendChild(wrap);
      return { range, pill };
    };
    this.rows = {
      filtering: mk('Motion filtering', 'filtering', 'Smooths and thins a take into fewer keyframes.'),
      roll: mk('Roll sensitivity', 'roll', 'How much a pen twist rotates the content.'),
    };
    perform.onChange(() => this.sync());
    this.sync();
    return pop;
  }

  private sync(): void {
    const r = this.rows;
    if (!r) return;
    for (const [key, row] of [['filtering', r.filtering], ['roll', r.roll]] as const) {
      const pct = Math.round(perform[key] * 100);
      if (row.range.valueAsNumber !== pct) row.range.value = String(pct);
      setStyleVar(row.range, '--p', `${pct}%`);
      setText(row.pill, `${pct}%`);
    }
  }

  get isOpen(): boolean { return !!this.pop && this.pop.isOpen; }

  hide(): void { this.pop?.hide(); }

  toggle(anchor: HTMLElement, side: 'above' | 'below'): void {
    if (!this.pop) this.pop = this.build();
    if (this.pop.isOpen) { this.pop.hide(); return; }
    this.pop.showFor(anchor, side);
  }
}

export const mods = new ModsPopover();

/** The banner at the top left of the Stage: Ready or Recording, plus the Modifications gear. Built once. */
export class PerformBanner {
  readonly root = el(`<div class="fm-perf-banner" hidden><span class="fm-perf-dot"></span><span class="fm-perf-text">Ready</span><button class="fm-perf-gear" type="button" title="Modifications" aria-label="Modifications">${GEAR}</button></div>`);
  private readonly text = q(this.root, '.fm-perf-text');

  constructor(engine: Engine) {
    q(this.root, '.fm-perf-gear').addEventListener('click', (e) => mods.toggle(e.currentTarget as HTMLElement, 'below'));
    engine.on('mode', (m) => { setHidden(this.root, m !== 'perform'); if (m !== 'perform') mods.hide(); });
    perform.onChange(() => this.sync());
    setHidden(this.root, engine.mode !== 'perform');
  }

  private sync(): void {
    setClass(this.root, 'is-recording', perform.recording);
    setText(this.text, perform.recording ? 'Recording' : 'Ready');
  }
}
