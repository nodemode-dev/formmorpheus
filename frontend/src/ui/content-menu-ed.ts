// Rows the content menu adds for sizing, retime (speed, reverse, freeze) and transitions. Built once; patch() only
// relabels and toggles them each time the menu opens.
import type { Engine } from '../engine/engine';
import { canSize, SIZE_MODES, sizeContent, type SizeMode } from '../engine/fit-ops';
import { end } from '../engine/model';
import { autoOrient, cycleKeys, keyCount, thinKeys } from '../engine/key-fast-ops';
import * as ops from '../engine/ops';
import { canRetime, isFrozen, SPEED_MAX, SPEED_MIN, speedOf } from '../engine/retime';
import * as rt from '../engine/retime-ops';
import { defaultTransition, previousOf, TRANSITION_KINDS, MIN_TRANSITION } from '../engine/transitions';
import type { Content, Movie, TransitionKind } from '../engine/types';
import { importSize, setImportSize } from '../media/import-size';
import { el, q, setClass, setHidden, setText } from './dom';
import { Popover, popRow, popSep, type PopRow } from './popover';
import { toast } from './toast';
import { t } from './i18n';

const SPEED_STEPS = 1000;
/** Slider position (0 to 1000) to speed, logarithmic so 100% sits mid-way. */
const toSpeed = (v: number): number => SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, v / SPEED_STEPS);
const toPos = (s: number): number => Math.round((Math.log(s / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN)) * SPEED_STEPS);
const PRESETS = [0.25, 0.5, 1, 2, 4];
const DIRS: Array<['l' | 'r' | 'u' | 'd', string]> = [['l', 'From left'], ['r', 'From right'], ['u', 'From bottom'], ['d', 'From top']];

export class EdRows {
  readonly size: PopRow = popRow('image', 'Size on Stage', { sub: true });
  readonly speed: PopRow = popRow('fillDuration', 'Speed', { sub: true });
  readonly freeze: PopRow = popRow('split', 'Freeze frame at Playhead');
  readonly transition: PopRow = popRow('duplicateAfter', 'Transition', { sub: true });
  readonly keyTools: PopRow = popRow('keyframe', 'Keyframe tools', { sub: true });
  readonly rows: HTMLElement[];

  private readonly sizeRows = new Map<SizeMode, PopRow>();
  private readonly defRows = new Map<SizeMode, PopRow>();
  private readonly slider: HTMLInputElement;
  private readonly pct: HTMLElement;
  private readonly presetBtns: HTMLButtonElement[] = [];
  private readonly pitch: PopRow;
  private readonly reverse: PopRow;
  private readonly reset: PopRow;
  private readonly trKinds = new Map<TransitionKind | 'none', PopRow>();
  private readonly trDirs = new Map<string, PopRow>();
  private readonly trLen: HTMLInputElement;
  private readonly trLenRow: HTMLElement;
  private readonly trColor: HTMLInputElement;
  private readonly trColorRow: HTMLElement;
  private readonly trSep: HTMLElement;

  constructor(private readonly engine: Engine, host: Popover, private readonly ids: () => string[], private readonly close: () => void) {
    // ---- size
    const sizePanel = Popover.panel('fm-pop fm-cm-sub fm-pop-sub');
    for (const s of SIZE_MODES) {
      const r = popRow(null, s.label, { check: false });
      r.el.addEventListener('click', () => { this.runSize(s.id); });
      this.sizeRows.set(s.id, r);
      sizePanel.appendChild(r.el);
    }
    sizePanel.appendChild(popSep());
    const head = el<HTMLElement>('<div class="fm-pop-row fm-pop-note"><span class="fm-pop-label">Default on import</span></div>');
    sizePanel.appendChild(head);
    for (const s of SIZE_MODES) {
      const r = popRow(null, s.label, { check: true });
      r.el.addEventListener('click', () => { setImportSize(s.id); this.paintDefaults(); });
      this.defRows.set(s.id, r);
      sizePanel.appendChild(r.el);
    }
    host.attachSub(this.size.el, sizePanel);

    // ---- speed
    const sp = Popover.panel('fm-pop fm-cm-sub fm-cm-speed fm-pop-sub');
    const box = el<HTMLElement>(`<div class="fm-cm-opacity"><div class="fm-cm-opacity-head"><span>Speed</span><span class="fm-cm-pct"></span></div><input class="fm-cm-range" type="range" min="0" max="${SPEED_STEPS}" step="1" aria-label="Speed"><div class="fm-sp-presets"></div></div>`);
    this.slider = q<HTMLInputElement>(box, 'input');
    this.pct = q(box, '.fm-cm-pct');
    const presets = q(box, '.fm-sp-presets');
    for (const p of PRESETS) {
      const b = el<HTMLButtonElement>(`<button class="fm-sp-preset" type="button">${Math.round(p * 100)}%</button>`);
      b.addEventListener('click', () => { this.applySpeed(p, true); });
      this.presetBtns.push(b);
      presets.appendChild(b);
    }
    this.slider.addEventListener('input', () => this.applySpeed(toSpeed(this.slider.valueAsNumber), false));
    this.slider.addEventListener('change', () => this.engine.endGesture());
    this.pitch = popRow(null, 'Keep pitch', { check: true });
    this.pitch.el.addEventListener('click', () => {
      const id = this.ids()[0];
      const c = this.first();
      if (!id || !c) return;
      const keep = !!c.speedPitch;
      this.engine.run('Speed Pitch', (m) => ops.updateContent(m, id, (x) => { const n = { ...x }; if (keep) delete n.speedPitch; else n.speedPitch = true; return n; }));
      this.patch();
    });
    this.reverse = popRow(null, 'Reverse', { check: true });
    this.reverse.el.addEventListener('click', () => {
      const ids = this.ids();
      const on = !this.first()?.reverse;
      this.engine.run('Reverse Clip', (m) => ids.reduce((acc, id) => rt.setReverse(acc, id, on), m));
      this.patch();
    });
    this.reset = popRow(null, 'Reset speed and direction');
    this.reset.el.addEventListener('click', () => {
      const ids = this.ids();
      this.engine.run('Reset Speed', (m) => ids.reduce((acc, id) => rt.resetRetime(acc, id), m));
      this.close();
    });
    sp.append(box, popSep(), this.pitch.el, this.reverse.el, this.reset.el);
    host.attachSub(this.speed.el, sp, () => this.patch());

    // ---- freeze
    this.freeze.el.addEventListener('click', () => {
      const c = this.first();
      if (!c) return;
      const frame = this.engine.frame;
      const len = Math.max(1, Math.round(this.engine.movie?.fps ?? 24));
      try {
        this.engine.run('Freeze Frame', (m) => { const r = rt.freezeAt(m, c.id, frame, len); return { movie: r.movie, select: [r.freeze] }; });
      } catch (e) { toast(e instanceof Error ? e.message : 'That frame cannot be held.', 'error'); }
      this.close();
    });

    // ---- transition
    const tp = Popover.panel('fm-pop fm-cm-sub fm-cm-transition fm-pop-sub');
    const none = popRow(null, 'None', { check: true });
    none.el.addEventListener('click', () => { this.setTransition(null); });
    this.trKinds.set('none', none);
    tp.appendChild(none.el);
    for (const k of TRANSITION_KINDS) {
      const r = popRow(null, k.label, { check: true });
      r.el.addEventListener('click', () => { this.setTransition(k.id); });
      this.trKinds.set(k.id, r);
      tp.appendChild(r.el);
    }
    this.trSep = popSep();
    tp.appendChild(this.trSep);
    for (const [d, label] of DIRS) {
      const r = popRow(null, label, { check: true });
      r.el.addEventListener('click', () => { this.patchTransition((t) => ({ ...t, dir: d })); });
      this.trDirs.set(d, r);
      tp.appendChild(r.el);
    }
    this.trColorRow = el<HTMLElement>('<label class="fm-pop-row fm-tr-field"><span class="fm-pop-label">Color</span><input class="fm-tr-color" type="color" value="#000000" aria-label="Dip color"></label>');
    this.trColor = q<HTMLInputElement>(this.trColorRow, 'input');
    this.trColor.addEventListener('input', () => { const v = this.trColor.value; this.patchTransition((t) => ({ ...t, color: v }), `trc-${this.ids()[0]}`); });
    this.trColor.addEventListener('change', () => this.engine.endGesture());
    this.trLenRow = el<HTMLElement>('<label class="fm-pop-row fm-tr-field"><span class="fm-pop-label">Frames</span><input class="fm-pop-input fm-tr-len" type="number" min="2" step="1" aria-label="Transition frames"></label>');
    this.trLen = q<HTMLInputElement>(this.trLenRow, 'input');
    this.trLen.addEventListener('change', () => {
      const n = Math.max(MIN_TRANSITION, Math.round(this.trLen.valueAsNumber || MIN_TRANSITION));
      this.patchTransition((t) => ({ ...t, duration: n }));
    });
    tp.append(this.trColorRow, this.trLenRow);
    host.attachSub(this.transition.el, tp, () => this.patch());

    // ---- keyframe fast paths
    const kp = Popover.panel('fm-pop fm-cm-sub fm-pop-sub');
    const act = (label: string, undo: string, fn: (c: Content) => Content, after?: (before: number, c: Content) => void): PopRow => {
      const r = popRow(null, label);
      r.el.addEventListener('click', () => {
        const ids = this.ids();
        const before = this.engine.selected.reduce((n, c) => n + keyCount(c), 0);
        this.engine.run(undo, (m) => ids.reduce((acc, id) => ops.updateContent(acc, id, fn), m));
        after?.(before, this.engine.selected[0]);
        this.close();
      });
      kp.appendChild(r.el);
      return r;
    };
    act('Loop keys to end of block', 'Loop Keys', (c) => cycleKeys(c, 'loop'));
    act('Ping-pong keys to end of block', 'Ping-pong Keys', (c) => cycleKeys(c, 'pingpong'));
    act('Cycle keys with offset', 'Cycle Keys', (c) => cycleKeys(c, 'offset'));
    kp.appendChild(popSep());
    for (const pct of [1, 3, 8]) {
      act(`Thin keys (${pct}%)`, 'Thin Keys', (c) => thinKeys(c, pct / 100), (before) => {
        const now = this.engine.selected.reduce((n, c) => n + keyCount(c), 0);
        toast(`${t('Keys removed')}: ${before - now}`, 'info', { ms: 1600 });
      });
    }
    kp.appendChild(popSep());
    act('Turn along motion path', 'Auto-orient', (c) => autoOrient(c));
    host.attachSub(this.keyTools.el, kp);

    this.rows = [this.size.el, this.speed.el, this.freeze.el, this.transition.el, this.keyTools.el];
  }

  private first(): Content | null {
    const id = this.ids()[0];
    return this.engine.selected.find((c) => c.id === id) ?? null;
  }

  private runSize(mode: SizeMode): void {
    const ids = this.ids();
    try { this.engine.run('Size on Stage', (m) => sizeContent(m, ids, mode)); } catch (e) { toast(e instanceof Error ? e.message : 'That cannot be sized.', 'error'); }
    this.close();
  }

  private applySpeed(s: number, once: boolean): void {
    const c = this.first();
    if (!c) return;
    const id = c.id;
    const keep = !c.speedPitch;
    const speed = once ? s : Math.round(s * 20) / 20;
    this.engine.run('Speed', (m) => rt.setSpeed(m, id, speed, keep), once ? null : `speed-${id}`);
    if (once) this.engine.endGesture();
    this.paintSpeed();
  }

  private paintSpeed(): void {
    const c = this.first();
    const s = c ? (isFrozen(c) ? 0 : speedOf(c)) : 1;
    setText(this.pct, isFrozen(c ?? ({} as Content)) ? 'Held' : `${Math.round(s * 100)}%`);
    const pos = toPos(Math.max(SPEED_MIN, s || 1));
    if (document.activeElement !== this.slider) this.slider.value = String(pos);
    this.slider.style.setProperty('--fm-pct', `${(pos / SPEED_STEPS) * 100}%`);
    this.presetBtns.forEach((b, i) => setClass(b, 'is-on', Math.abs(PRESETS[i] - s) < 0.001));
  }

  private paintDefaults(): void {
    const cur = importSize();
    for (const [id, r] of this.defRows) r.setChecked(id === cur);
  }

  private setTransition(kind: TransitionKind | null): void {
    const id = this.ids()[0];
    const fps = this.engine.movie?.fps ?? 24;
    if (!id) return;
    this.engine.run(kind ? 'Add Transition' : 'Remove Transition', (m) => ops.updateContent(m, id, (c) => {
      const n = { ...c };
      if (kind) n.transition = c.transition?.kind === kind ? c.transition : defaultTransition(kind, fps); else delete n.transition;
      return n;
    }));
    this.patch();
  }

  private patchTransition(fn: (t: NonNullable<Content['transition']>) => NonNullable<Content['transition']>, tag?: string): void {
    const id = this.ids()[0];
    if (!id) return;
    this.engine.run('Transition', (m) => ops.updateContent(m, id, (c) => (c.transition ? { ...c, transition: fn(c.transition) } : c)), tag ?? null);
    this.patch();
  }

  /** Relabel and toggle every row for the current selection. */
  patch(): void {
    const sel = this.engine.selected;
    const m = this.engine.movie;
    const one = sel.length === 1 ? sel[0] : null;
    const sizable = sel.length > 0 && sel.some(canSize);
    setClass(this.size.el, 'is-gone', !sizable);
    this.paintDefaults();
    const retimable = !!one && canRetime(one);
    setClass(this.speed.el, 'is-gone', !retimable);
    setClass(this.freeze.el, 'is-gone', !(one && one.kind !== 'audio' && canRetime(one)));
    this.freeze.setDisabled(!(one && this.engine.isOver(one)));
    if (one) {
      const s = isFrozen(one) ? 0 : speedOf(one);
      this.speed.setValue(isFrozen(one) ? 'Held' : s === 1 && !one.reverse ? '' : `${Math.round(s * 100)}%${one.reverse ? ' R' : ''}`);
      this.paintSpeed();
      const sound = one.kind === 'audio' || (one.kind === 'video' && !!one.asset && !!m?.assets[one.asset]?.hasAudio);
      setHidden(this.pitch.el, !sound);
      this.pitch.setChecked(!one.speedPitch);
      this.reverse.setChecked(!!one.reverse);
      this.slider.disabled = isFrozen(one);
    }
    const prev = one && m ? previousOf(m.tracks.find((t) => t.content.includes(one))?.content ?? [], one) : null;
    setClass(this.transition.el, 'is-gone', !one);
    this.transition.setDisabled(!prev || end(prev) !== one?.start);
    const tr = one?.transition;
    this.transition.setValue(tr ? (TRANSITION_KINDS.find((k) => k.id === tr.kind)?.label ?? '') : '');
    for (const [k, r] of this.trKinds) r.setChecked(k === (tr?.kind ?? 'none'));
    const dirs = tr?.kind === 'wipe' || tr?.kind === 'push';
    for (const [d, r] of this.trDirs) { setHidden(r.el, !dirs); r.setChecked((tr?.dir ?? 'l') === d); }
    setHidden(this.trColorRow, tr?.kind !== 'dip');
    if (tr?.kind === 'dip' && this.trColor.value !== (tr.color ?? '#000000')) this.trColor.value = tr.color ?? '#000000';
    setHidden(this.trLenRow, !tr);
    if (tr && document.activeElement !== this.trLen) this.trLen.value = String(tr.duration);
    setHidden(this.trSep, !tr);
    setClass(this.keyTools.el, 'is-gone', !sel.some((c) => c.keys.length > 0));
  }
}

// ---- arrange: what is in front is the track order (the first track draws last, on top). No content command moves a
// block in front or behind, so these move the tracks holding the selection with ops.moveTrack, keeping their own order.
export type ArrangeHow = 'front' | 'forward' | 'backward' | 'back';

/** Indices of the tracks holding `ids`, top first. */
function heldTracks(m: Movie, ids: string[]): number[] {
  const want = new Set(ids), out: number[] = [];
  m.tracks.forEach((t, i) => { if (t.content.some((c) => want.has(c.id))) out.push(i); });
  return out;
}

/** Whether the tracks holding `ids` can still move that way: some other track lies above them (front) or below them (back). */
export function canArrange(m: Movie | null, ids: string[], how: ArrangeHow): boolean {
  if (!m || !ids.length) return false;
  const held = heldTracks(m, ids);
  if (!held.length) return false;
  if (how === 'front' || how === 'forward') return held.some((ti, k) => ti !== k);
  const n = m.tracks.length;
  return held.some((ti, k) => ti !== n - held.length + k);
}

/** Moves the tracks holding `ids` to the front, one place forward, one place back, or to the back. */
export function arrangeTracks(m: Movie, ids: string[], how: ArrangeHow): Movie {
  const held = heldTracks(m, ids);
  if (!held.length) throw new ops.OpError('That content no longer exists.');
  const tid = held.map((i) => m.tracks[i].id);
  const set = new Set(tid);
  const at = (mv: Movie, id: string): number => mv.tracks.findIndex((t) => t.id === id);
  let acc = m;
  if (how === 'front') tid.forEach((id, k) => { acc = ops.moveTrack(acc, id, k); });
  else if (how === 'back') for (let k = tid.length - 1; k >= 0; k--) acc = ops.moveTrack(acc, tid[k], acc.tracks.length - (tid.length - k));
  else if (how === 'forward') {
    for (const id of tid) { const i = at(acc, id); if (i > 0 && !set.has(acc.tracks[i - 1].id)) acc = ops.moveTrack(acc, id, i - 1); }
  } else {
    for (let k = tid.length - 1; k >= 0; k--) { const i = at(acc, tid[k]); if (i < acc.tracks.length - 1 && !set.has(acc.tracks[i + 1].id)) acc = ops.moveTrack(acc, tid[k], i + 1); }
  }
  return acc;
}

const ARRANGE: Array<[ArrangeHow, string]> = [
  ['front', 'Bring to Front'],
  ['forward', 'Bring Forward'],
  ['backward', 'Send Backward'],
  ['back', 'Send to Back'],
];

/** The Arrange submenu of the content menu: built once, patch() only enables and disables its four rows. */
export class ArrangeRows {
  readonly row: PopRow = popRow('layers', 'Arrange', { sub: true });
  private readonly items = new Map<ArrangeHow, PopRow>();

  constructor(private readonly engine: Engine, host: Popover, private readonly ids: () => string[], close: () => void) {
    const panel = Popover.panel('fm-pop fm-cm-sub fm-pop-sub');
    for (const [how, label] of ARRANGE) {
      const r = popRow(null, label);
      r.el.addEventListener('click', () => {
        const ids = this.ids();
        if (!canArrange(this.engine.movie, ids, how)) return;
        // one undo step; the selection stays on the same blocks
        this.engine.run(label, (m) => ({ movie: arrangeTracks(m, ids, how), select: ids }));
        close();
      });
      this.items.set(how, r);
      panel.appendChild(r.el);
    }
    host.attachSub(this.row.el, panel);
  }

  patch(): void {
    const m = this.engine.movie, ids = this.ids();
    setClass(this.row.el, 'is-gone', !ids.length);
    for (const [how, r] of this.items) r.setDisabled(!canArrange(m, ids, how));
  }
}
