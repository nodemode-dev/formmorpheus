// Perform mode UI: shared settings, the Stage banner and the Modifications popover.
import type { Engine } from '../engine/engine';
import { el, q, setClass, setHidden, setStyleVar, setText } from './dom';
import { Popover } from './popover';
import { t } from './i18n';
import { tf } from './i18n-fill';

const STORE = 'formmorpheus.perform';

type Listener = () => void;

/** Perform settings and the "a gesture is recording" flag, shared by the Stage, the Timeline and the Action menu. */
class PerformState {
  /** Motion filtering 0..1 (default 30%; 0 keeps every frame of the take). */
  filtering = 0.3;
  /** Roll sensitivity 0..1 for pen twist (default 100%). */
  roll = 1;
  /** Degrees of turn per mouse pixel while the rotate modifier is held, as 0..1 of 2 degrees (default 0.25 = 0.5 degree). */
  rotSpeed = 0.25;
  /** Frames the movie rolls in before the take starts recording (0 to 48). */
  preroll = 0;
  /** A take only records inside the movie's loop range, when it has one. */
  punch = false;
  /** What the held mouse modifier is doing during a take: shown in the banner. */
  mod: '' | 'rotating' | 'scaling' = '';
  /** The last take: the history depth before and after it and where it began, so Retake can undo it. */
  lastTake: { before: number; after: number; start: number } | null = null;
  /** Frames left of the pre-roll before the take starts recording (0: not counting in). */
  countIn = 0;
  private rec = false;
  private readonly subs = new Set<Listener>();

  constructor() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const o = JSON.parse(raw) as { filtering?: unknown; roll?: unknown; rotSpeed?: unknown; preroll?: unknown; punch?: unknown };
        if (typeof o.filtering === 'number') this.filtering = clamp(o.filtering);
        if (typeof o.roll === 'number') this.roll = clamp(o.roll);
        if (typeof o.rotSpeed === 'number') this.rotSpeed = clamp(o.rotSpeed);
        if (typeof o.preroll === 'number') this.preroll = Math.min(48, Math.max(0, Math.round(o.preroll)));
        if (typeof o.punch === 'boolean') this.punch = o.punch;
      }
    } catch { /* storage unavailable or corrupt: keep defaults */ }
  }

  get recording(): boolean { return this.rec; }

  /** Degrees per mouse pixel for the rotate modifier. */
  get rotDegPerPx(): number { return 0.1 + this.rotSpeed * 1.9; }

  setRecording(on: boolean): void {
    if (on === this.rec) return;
    this.rec = on;
    if (!on) { this.mod = ''; this.countIn = 0; }
    this.emit();
  }

  setCountIn(frames: number): void {
    const n = Math.max(0, Math.round(frames));
    if (n === this.countIn) return;
    this.countIn = n;
    this.emit();
  }

  setMod(mod: '' | 'rotating' | 'scaling'): void {
    if (mod === this.mod) return;
    this.mod = mod;
    this.emit();
  }

  /** Remember a finished take (history depth before and after it, and its first frame) for Retake. */
  markTake(before: number, after: number, start: number): void {
    this.lastTake = after > before ? { before, after, start } : null;
    this.emit();
  }

  set(patch: { filtering?: number; roll?: number; rotSpeed?: number; preroll?: number; punch?: boolean }): void {
    if (patch.filtering !== undefined) this.filtering = clamp(patch.filtering);
    if (patch.roll !== undefined) this.roll = clamp(patch.roll);
    if (patch.rotSpeed !== undefined) this.rotSpeed = clamp(patch.rotSpeed);
    if (patch.preroll !== undefined) this.preroll = Math.min(48, Math.max(0, Math.round(patch.preroll)));
    if (patch.punch !== undefined) this.punch = patch.punch;
    try { localStorage.setItem(STORE, JSON.stringify({ filtering: this.filtering, roll: this.roll, rotSpeed: this.rotSpeed, preroll: this.preroll, punch: this.punch })); } catch { /* ignore */ }
    this.emit();
  }

  /** Undo the last take (when nothing was edited since) and put the Playhead back where it began. */
  retake(engine: Engine): boolean {
    const t = this.lastTake;
    if (!t || this.rec || engine.history.past.length !== t.after) return false;
    while (engine.history.past.length > t.before) engine.undo();
    engine.seek(t.start);
    this.lastTake = null;
    this.emit();
    return true;
  }

  onChange(fn: Listener): void { this.subs.add(fn); }

  private emit(): void { for (const fn of this.subs) fn(); }
}

function clamp(n: number): number { return Math.min(1, Math.max(0, n)); }

export const perform = new PerformState();

/** Ring with a dot: the Playhead pill's glyph in Perform mode (the dot pulses while recording). */
export const REC_GLYPH = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle class="fm-rec-core" cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';

interface ModRow { range: HTMLInputElement; pill: HTMLElement; read: () => number; show: (v: number) => string; max: number }
type ModKey = 'filtering' | 'roll' | 'rotSpeed' | 'preroll';

/** The Modifications popover: Motion filtering, Roll sensitivity, mouse rotate speed, pre-roll and the punch range. Built on first use, then patched. */
class ModsPopover {
  private pop: Popover | null = null;
  private rows: Record<ModKey, ModRow> | null = null;
  private punch: HTMLButtonElement | null = null;
  private retake: HTMLButtonElement | null = null;
  private engine: Engine | null = null;

  /** The engine the Retake button acts on (set by the banner). */
  bind(engine: Engine): void { this.engine = engine; }

  private build(): Popover {
    const pop = new Popover('fm-pf', 292);
    pop.body.appendChild(el('<div class="fm-pf-title">Modifications</div>'));
    const pct = (v: number): string => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
    const mk = (label: string, key: ModKey, hint: string, max: number, step: number, read: () => number, show: (v: number) => string, write: (v: number) => void): ModRow => {
      const wrap = el(`<div class="fm-pf-row"><span class="fm-pf-label"></span><input class="fm-kc-range" type="range" min="0" max="${max}" step="${step}"><span class="fm-kc-val"></span><span class="fm-pf-hint"></span></div>`);
      setText(q(wrap, '.fm-pf-label'), label);
      setText(q(wrap, '.fm-pf-hint'), hint);
      const range = q<HTMLInputElement>(wrap, '.fm-kc-range');
      range.setAttribute('aria-label', label);
      const pill = q(wrap, '.fm-kc-val');
      range.addEventListener('input', () => write(range.valueAsNumber));
      pop.body.appendChild(wrap);
      return { range, pill, read, show, max };
    };
    this.rows = {
      filtering: mk('Motion filtering', 'filtering', '0.0% keeps one keyframe per frame; more smooths and thins the take.', 1000, 1, () => perform.filtering * 1000, (v) => pct(v / 1000), (v) => perform.set({ filtering: v / 1000 })),
      roll: mk('Roll sensitivity', 'roll', 'How much a pen twist turns the content as it moves.', 1000, 1, () => perform.roll * 1000, (v) => pct(v / 1000), (v) => perform.set({ roll: v / 1000 })),
      rotSpeed: mk('Mouse rotate speed', 'rotSpeed', 'Hold R or Ctrl while dragging to turn the content with the mouse; hold S to scale it.', 1000, 1, () => perform.rotSpeed * 1000, () => `${perform.rotDegPerPx.toFixed(2)}°/px`, (v) => perform.set({ rotSpeed: v / 1000 })),
      preroll: mk('Pre-roll', 'preroll', 'Frames the movie rolls before the take starts recording.', 48, 1, () => perform.preroll, (v) => `${Math.round(v)} f`, (v) => perform.set({ preroll: v })),
    };
    const punch = el<HTMLButtonElement>('<button class="fm-kc-toggle fm-pf-punch" type="button" role="switch" aria-checked="false"><span class="fm-kc-tlabel">Punch in and out: record only inside the loop range</span><span class="fm-kc-switch"></span></button>');
    punch.addEventListener('click', () => perform.set({ punch: !perform.punch }));
    const retake = el<HTMLButtonElement>('<button class="fm-pf-retake" type="button"></button>');
    setText(retake, 'Retake (Shift+R): undo the last take');
    retake.addEventListener('click', () => { if (this.engine) perform.retake(this.engine); this.sync(); });
    this.punch = punch;
    this.retake = retake;
    pop.body.append(punch, retake);
    perform.onChange(() => this.sync());
    this.sync();
    return pop;
  }

  private sync(): void {
    const r = this.rows;
    if (!r) return;
    for (const row of Object.values(r)) {
      const v = row.read();
      if (row.range.valueAsNumber !== v) row.range.value = String(v);
      setStyleVar(row.range, '--p', `${(v / row.max) * 100}%`);
      setText(row.pill, row.show(v));
    }
    if (this.punch) { setClass(this.punch, 'is-on', perform.punch); this.punch.setAttribute('aria-checked', String(perform.punch)); }
    if (this.retake) this.retake.disabled = !perform.lastTake || perform.recording;
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
  readonly root = el(`<div class="fm-perf-banner" hidden><span class="fm-perf-dot"></span><span class="fm-perf-text">Ready</span><button class="fm-perf-retake" type="button" title="Retake: undo the last take (Shift+R)" aria-label="Retake" hidden>Retake</button><button class="fm-perf-gear" type="button" title="Modifications" aria-label="Modifications">${GEAR}</button></div>`);
  private readonly text = q(this.root, '.fm-perf-text');
  private readonly retakeBtn = q<HTMLButtonElement>(this.root, '.fm-perf-retake');
  /** The big count-in number over the Stage while the pre-roll runs. */
  private cue: HTMLElement | null = null;

  constructor(private readonly engine: Engine) {
    mods.bind(engine);
    q(this.root, '.fm-perf-gear').addEventListener('click', (e) => mods.toggle(e.currentTarget as HTMLElement, 'below'));
    this.retakeBtn.addEventListener('click', () => perform.retake(engine));
    engine.on('mode', (m) => { setHidden(this.root, m !== 'perform'); if (m !== 'perform') mods.hide(); });
    // Shift+R: Retake, outside text fields and not while a take is running (R then turns the content)
    window.addEventListener('keydown', (e) => {
      if (engine.mode !== 'perform' || perform.recording || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.code !== 'KeyR') return;
      if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (perform.retake(engine)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    perform.onChange(() => this.sync());
    engine.on('history', () => this.sync());
    setHidden(this.root, engine.mode !== 'perform');
  }

  private sync(): void {
    setClass(this.root, 'is-recording', perform.recording);
    const counting = perform.recording && perform.countIn > 0;
    setText(this.text, counting ? tf('Count-in · {n}', { n: String(perform.countIn) }) : perform.recording ? (perform.mod ? tf('Action · {mode}', { mode: t(perform.mod) }) : t('Action')) : t('Ready'));
    setClass(this.root, 'is-counting', counting);
    if (!this.cue && this.root.parentElement) {
      this.cue = el('<div class="fm-perf-cue" aria-hidden="true" hidden></div>');
      this.root.parentElement.appendChild(this.cue);
    }
    if (this.cue) {
      setHidden(this.cue, !counting);
      setText(this.cue, counting ? String(perform.countIn) : '');
    }
    setHidden(this.retakeBtn, !perform.lastTake || perform.recording || this.engine.history.past.length !== perform.lastTake.after);
  }
}
