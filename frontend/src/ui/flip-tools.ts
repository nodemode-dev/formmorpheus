// Flipbook timing and reference popovers of the frame strip: Timing (shoot on ones, twos, threes, fours; reverse and append,
// cycle, blanks between, the inbetween onion; frame numbers) and Underlay (a picture or video under the drawing area).
// Each action is one history step. Built once; open() patches the values in place.
import { blanksBetween, cycleFrames, inbetweenOnion, reverseAppend, setShoot, shootOn, DEFAULT_UNDERLAY, setUnderlay } from '../engine/flip-time';
import * as ops from '../engine/ops';
import { importMedia } from '../media/import';
import type { FrameRef } from '../engine/flip-ops';
import type { Content, FlipUnderlay, Movie } from '../engine/types';
import { el, q, setClass, setHidden, setStyleVar, setText } from './dom';
import type { FlipSelect } from './flip-select';
import { flipServices } from './flip-services';
import { underlayView } from './flip-underlay';
import type { StripHost } from './flip-strip';
import { Popover, popField, popRow, popSep } from './popover';
import { toast } from './toast';

export type NumberMode = 'drawing' | 'frame' | 'off';

const SHOOT = [1, 2, 3, 4] as const;
const SHOOT_LABEL = ['Ones', 'Twos', 'Threes', 'Fours'];

interface Seg { root: HTMLElement; set(n: number): void }

function segment(title: string, on: (n: number) => void): Seg {
  const root = el<HTMLElement>(`<div class="fm-ft-seg-wrap"><div class="fm-ft-seg-title"></div><div class="fm-ft-seg" role="group"></div></div>`);
  setText(q(root, '.fm-ft-seg-title'), title);
  const box = q(root, '.fm-ft-seg');
  const btns = SHOOT.map((n, i) => {
    const b = el<HTMLButtonElement>(`<button class="fm-ft-seg-b" type="button"><span class="fm-ft-seg-n">${n}</span><span class="fm-ft-seg-l">${SHOOT_LABEL[i]}</span></button>`);
    b.addEventListener('click', () => on(n));
    box.appendChild(b);
    return b;
  });
  return { root, set: (n) => btns.forEach((b, i) => setClass(b, 'is-on', SHOOT[i] === n)) };
}

interface Slider { root: HTMLElement; set(v: number, text: string): void }

function slider(label: string, min: number, max: number, step: number, on: (v: number) => void): Slider {
  const root = el<HTMLElement>(`<div class="fm-ft-sl"><div class="fm-ft-sl-head"><span></span><span class="fm-ft-sl-val"></span></div><input class="fm-ft-range" type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}"></div>`);
  setText(q(root, '.fm-ft-sl-head span'), label);
  const input = q<HTMLInputElement>(root, 'input');
  const val = q(root, '.fm-ft-sl-val');
  const pct = (v: number): string => `${Math.round(((v - min) / (max - min)) * 100)}%`;
  input.addEventListener('input', () => { const v = Number(input.value); setStyleVar(input, '--fm-pct', pct(v)); on(v); });
  return {
    root,
    set: (v, text) => { if (document.activeElement !== input) input.value = String(v); setStyleVar(input, '--fm-pct', pct(v)); setText(val, text); },
  };
}

export class FlipTools {
  readonly timing: Popover;
  readonly under: Popover;
  private wholeTrack = false;
  private readonly newSeg: Seg;
  private readonly timeSeg: Seg;
  private readonly whole: ReturnType<typeof popRow>;
  private readonly nums: Record<NumberMode, ReturnType<typeof popRow>>;
  private readonly cycleField: ReturnType<typeof popField>;
  private readonly file: HTMLInputElement;
  private readonly choose: ReturnType<typeof popRow>;
  private readonly ulBody: HTMLElement;
  private readonly show: ReturnType<typeof popRow>;
  private readonly table: ReturnType<typeof popRow>;
  private readonly opacity: Slider;
  private readonly scale: Slider;
  private readonly fx: ReturnType<typeof popField>;
  private readonly fy: ReturnType<typeof popField>;
  private readonly fo: ReturnType<typeof popField>;
  private readonly name: HTMLElement;

  constructor(
    private readonly host: StripHost,
    private readonly sel: FlipSelect,
    private readonly numbers: { get(): NumberMode; set(m: NumberMode): void },
  ) {
    // ---- timing ----
    this.timing = new Popover('fm-ft-menu', 264);
    this.newSeg = segment('New frames on', (n) => this.setShoot(n));
    this.timeSeg = segment('Re-time frames to', (n) => this.retime(n));
    this.whole = popRow(null, 'Re-time the whole track', { check: true });
    this.whole.el.addEventListener('click', () => { this.wholeTrack = !this.wholeTrack; this.whole.setChecked(this.wholeTrack); });
    const rev = popRow('swap', 'Reverse and append');
    rev.el.addEventListener('click', () => this.reverse(false));
    const pong = popRow('swap', 'Ping-pong (no repeats)');
    pong.el.addEventListener('click', () => this.reverse(true));
    this.cycleField = popField('refresh', 'Cycle: N times, Enter', (v) => this.cycle(v));
    this.cycleField.input.inputMode = 'numeric';
    const blanks = popRow('plus', 'Blanks between frames');
    blanks.el.addEventListener('click', () => this.blanks());
    const onion = popRow('layers', 'Inbetween onion');
    onion.el.addEventListener('click', () => this.onionPreset());
    const numTitle = el<HTMLElement>('<div class="fm-ft-seg-title fm-ft-pad">Numbers on the strip</div>');
    const mk = (m: NumberMode, label: string) => { const r = popRow(null, label, { check: true }); r.el.addEventListener('click', () => { this.numbers.set(m); this.syncNumbers(); }); return r; };
    this.nums = { drawing: mk('drawing', 'Drawing numbers'), frame: mk('frame', 'Frame numbers'), off: mk('off', 'No numbers') };
    const note = el<HTMLElement>('<div class="fm-ft-note">Reverse, ping-pong, cycle and blanks act on the selected frames, or the whole track when none is selected. Inbetween onion shows only the previous and next drawing, tinted.</div>');
    this.timing.body.append(this.newSeg.root, this.timeSeg.root, this.whole.el, popSep(), rev.el, pong.el, this.cycleField.el, blanks.el, onion.el, note, popSep(), numTitle, this.nums.drawing.el, this.nums.frame.el, this.nums.off.el);

    // ---- underlay ----
    this.under = new Popover('fm-ft-menu', 280);
    this.file = el<HTMLInputElement>('<input type="file" accept="image/*,video/*" hidden>');
    this.file.addEventListener('change', () => { const f = this.file.files?.[0]; this.file.value = ''; if (f) void this.pick(f); });
    this.choose = popRow('image', 'Choose a picture or video...');
    this.choose.el.addEventListener('click', () => this.file.click());
    this.name = el<HTMLElement>('<div class="fm-ft-note fm-ft-name"></div>');
    this.show = popRow('eye', 'Show the reference', { check: true });
    this.show.el.addEventListener('click', () => this.patch('Underlay', (u) => ({ ...u, visible: !u.visible })));
    this.table = popRow('sun', 'Light table', { check: true });
    this.table.el.addEventListener('click', () => this.patch('Light table', (u) => ({ ...u, table: !u.table })));
    this.opacity = slider('Opacity', 0, 100, 1, (v) => this.patch('Underlay opacity', (u) => ({ ...u, opacity: v / 100 }), 'fu-op'));
    this.scale = slider('Scale', 10, 400, 1, (v) => this.patch('Underlay scale', (u) => ({ ...u, scale: v / 100 }), 'fu-sc'));
    const num = (u: string, key: 'x' | 'y' | 'offset'): ReturnType<typeof popField> => {
      const f = popField('move', u, (v) => { const n = Math.round(Number(v)); if (Number.isFinite(n)) this.patch('Underlay position', (x) => ({ ...x, [key]: n })); });
      f.input.inputMode = 'numeric';
      return f;
    };
    this.fx = num('Position X (px)', 'x');
    this.fy = num('Position Y (px)', 'y');
    this.fo = num('Time offset (frames)', 'offset');
    const fit = popRow('fitView', 'Fit to the canvas');
    fit.el.addEventListener('click', () => this.patch('Underlay position', (u) => ({ ...u, x: 0, y: 0, scale: 1 })));
    const del = popRow('delete', 'Remove the reference', { danger: true });
    del.el.addEventListener('click', () => { this.under.hide(); this.write('Remove underlay', null); });
    this.ulBody = el<HTMLElement>('<div class="fm-ft-ul"></div>');
    this.ulBody.append(this.name, this.show.el, this.table.el, this.opacity.root, this.scale.root, this.fx.el, this.fy.el, this.fo.el, fit.el, popSep(), del.el);
    const hint = el<HTMLElement>('<div class="fm-ft-note">Only seen while drawing. It is never on the Stage and never in an export.</div>');
    this.under.body.append(this.choose.el, this.ulBody, hint, this.file);
  }

  dispose(): void {
    this.timing.hide();
    this.under.hide();
    this.timing.el.remove();
    this.under.el.remove();
  }

  closeAll(): boolean {
    const was = this.timing.isOpen || this.under.isOpen;
    this.timing.hide();
    this.under.hide();
    return was;
  }

  // ---- opening ----

  openTiming(anchor: HTMLElement): void {
    const c = this.host.content();
    const t = c?.flip[this.host.row()];
    this.newSeg.set(t?.shoot ?? 1);
    this.timeSeg.set(0);
    this.whole.setChecked(this.wholeTrack);
    this.syncNumbers();
    this.under.hide();
    this.timing.showFor(anchor, 'above');
  }

  private underAnchor: HTMLElement | null = null;
  private underHad = false;

  openUnderlay(anchor: HTMLElement): void {
    this.timing.hide();
    this.underAnchor = anchor;
    this.syncUnder();
    this.under.showFor(anchor, 'above');
  }

  private syncNumbers(): void {
    const m = this.numbers.get();
    for (const k of Object.keys(this.nums) as NumberMode[]) this.nums[k].setChecked(k === m);
  }

  private syncUnder(): void {
    const u = this.host.content()?.underlay;
    setHidden(this.ulBody, !u);
    // the card grows when a reference appears (or goes): keep it above its button
    if (!!u !== this.underHad) { this.underHad = !!u; if (this.under.isOpen && this.underAnchor) this.under.showFor(this.underAnchor, 'above'); }
    setText(this.choose.el.querySelector('.fm-pop-label'), u ? 'Replace the picture or video...' : 'Choose a picture or video...');
    if (!u) return;
    const a = flipServices.engine?.movie?.assets[u.asset];
    setText(this.name, a ? `${a.name}${a.kind === 'video' ? ' · video' : ''}` : 'Reference');
    this.show.setChecked(u.visible);
    this.table.setChecked(!!u.table);
    this.opacity.set(Math.round(u.opacity * 100), `${Math.round(u.opacity * 100)}%`);
    this.scale.set(Math.round(u.scale * 100), `${Math.round(u.scale * 100)}%`);
    this.fx.set(String(u.x));
    this.fy.set(String(u.y));
    this.fo.set(String(u.offset));
  }

  // ---- timing actions ----

  /** The selected frames, or every frame of the open track. */
  private refs(whole = true): FrameRef[] {
    if (this.sel.count > 0) return this.sel.refs();
    const c = this.host.content();
    const t = c?.flip[this.host.row()];
    if (!c || !t) return [];
    if (whole) return [{ track: t.id, frames: t.frames.map((f) => f.id) }];
    const f = t.frames[this.host.index()];
    return f ? [{ track: t.id, frames: [f.id] }] : [];
  }

  private setShoot(n: number): void {
    const r = this.host.row();
    this.newSeg.set(n);
    this.host.run(n > 1 ? `Shoot on ${SHOOT_LABEL[n - 1].toLowerCase()}` : 'Shoot on ones', (c) => setShoot(c, r, n));
  }

  private retime(n: number): void {
    const refs = this.refs(this.wholeTrack);
    if (!refs.length) return;
    this.timeSeg.set(n);
    this.host.run(`Re-time on ${SHOOT_LABEL[n - 1].toLowerCase()}`, (c) => shootOn(c, refs, n));
  }

  private reverse(skipEnds: boolean): void {
    const refs = this.refs();
    this.timing.hide();
    if (refs.length) this.host.run(skipEnds ? 'Ping-pong frames' : 'Reverse and append', (c) => reverseAppend(c, refs, skipEnds));
  }

  private cycle(v: string): void {
    const n = Math.round(Number(v));
    const refs = this.refs();
    if (!Number.isFinite(n) || n < 2 || !refs.length) return;
    this.timing.hide();
    this.host.run(`Cycle ${n} times`, (c) => cycleFrames(c, refs, n));
  }

  private blanks(): void {
    const refs = this.refs();
    this.timing.hide();
    if (refs.length) this.host.run('Insert blanks between frames', (c) => blanksBetween(c, refs));
  }

  private onionPreset(): void {
    this.timing.hide();
    const base = flipServices.engine?.movie?.onion;
    this.host.run('Inbetween onion', (c) => inbetweenOnion(c, c.onion ?? base ?? { enabled: true, backFrames: 1, foreFrames: 1, opacity: 0.55, tint: true, backColor: '#ff4f7a', foreColor: '#3a9bff', blendPrimary: false }));
  }

  // ---- underlay actions ----

  private write(label: string, u: FlipUnderlay | null, merge: string | null = null, extra?: (m: Movie) => Movie): void {
    const e = flipServices.engine;
    const id = this.host.content()?.id;
    if (!e || !id) return;
    e.run(label, (m) => ops.updateContent(extra ? extra(m) : m, id, (c: Content) => setUnderlay(c, u)), merge);
    underlayView.onRedraw?.();
    this.syncUnder();
  }

  private patch(label: string, fn: (u: FlipUnderlay) => FlipUnderlay, merge: string | null = null): void {
    const u = this.host.content()?.underlay;
    if (u) this.write(label, fn(u), merge);
  }

  private async pick(file: File): Promise<void> {
    const e = flipServices.engine;
    if (!e?.movie) return;
    try {
      const r = await importMedia(file, e.movie, 0);
      const hit = r.assets.find((a) => a.asset.kind === 'image' || a.asset.kind === 'video');
      if (!hit) { toast('Choose a picture or a video for the reference.', 'error'); return; }
      e.assets.set(hit.asset.id, hit.blob);
      const prev = this.host.content()?.underlay;
      this.write('Set underlay', { ...DEFAULT_UNDERLAY, ...(prev ? { ...prev } : {}), asset: hit.asset.id }, null, (m) => ({ ...m, assets: { ...m.assets, [hit.asset.id]: hit.asset } }));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That file could not be opened.', 'error');
    }
  }
}
