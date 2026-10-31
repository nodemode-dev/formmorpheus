// The Spans, Effects and Animate tabs of the Text card: styled words and letters, shadow and background box, build on / off and typewriter.
import type { Engine } from '../engine/engine';
import { locate, textColorFor } from '../engine/model';
import * as keyOps from '../engine/key-ops';
import * as ops from '../engine/ops';
import { animSpans, layoutText } from '../engine/text-layout';
import { DEFAULT_SIDE, paintRun, runValue, type AnimDir, type AnimOrder, type AnimUnit, type TextAnimSide, type TextRun } from '../engine/text-rich';
import { EASES, type Content, type Ease, type TextStyle } from '../engine/types';
import { ensureTextFont, fontCatalog } from '../media/fonts';
import { el, q, setClass, setHidden, setText } from './dom';
import { textSel } from './text-sel';

interface Ctl { sync(s: TextStyle): void }
type Mut = (s: TextStyle) => TextStyle;

const WEIGHTS: Array<[number, string]> = [[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];
const DIRS: Array<[string, string]> = [['none', 'None'], ['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right']];
const ORDERS: Array<[AnimOrder, string]> = [['forward', 'Forward'], ['backward', 'Backward'], ['center', 'From center'], ['random', 'Random']];
const UNITS: Array<[AnimUnit, string]> = [['char', 'Letter'], ['word', 'Word'], ['line', 'Line']];
const EASE_CHOICES = EASES.filter((e) => e.id !== 'hold');
const hex = (v: string | undefined, d: string): string => (v && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);

/** Drops fields that were cleared so a movie only carries what is used. */
function tidy(s: TextStyle): TextStyle {
  const o = { ...s } as unknown as Record<string, unknown>;
  for (const k of ['runs', 'shadow', 'box', 'anim']) if (o[k] === undefined) delete o[k];
  if (!s.runs || !s.runs.length) delete o.runs;
  if (s.anim) {
    const a = { ...s.anim } as Record<string, unknown>;
    for (const k of ['in', 'out', 'type']) if (a[k] === undefined) delete a[k];
    if (Object.keys(a).length) o.anim = a; else delete o.anim;
  }
  return o as unknown as TextStyle;
}

export class TextFxPanes {
  readonly spans = el<HTMLElement>('<div class="fm-tc-pane" data-pane="spans" data-rich hidden></div>');
  readonly effects = el<HTMLElement>('<div class="fm-tc-pane" data-pane="effects" data-rich hidden></div>');
  readonly animate = el<HTMLElement>('<div class="fm-tc-pane" data-pane="animate" data-rich hidden></div>');
  private readonly ctls: Ctl[] = [];
  private readonly info = el('<div class="fm-tr-info"></div>');
  private last: TextStyle | null = null;

  constructor(private readonly engine: Engine, private readonly getId: () => string) {
    this.buildSpans();
    this.buildEffects();
    this.buildAnimate();
    textSel.on(() => { if (this.last) this.sync(this.last); });
  }

  sync(s: TextStyle): void {
    this.last = s;
    for (const c of this.ctls) c.sync(s);
  }

  // ---- plumbing ----

  private mutate(fn: Mut, field: string): void {
    const id = this.getId();
    if (!id) return;
    this.engine.run('Edit Text', (m) => ops.updateContent(m, id, (c) => (c.text ? { ...c, text: tidy(fn(c.text)) } : c)), `text-${id}-${field}`);
  }

  private end(): void { this.engine.endGesture(); }

  private content(): Content | null {
    const m = this.engine.movie, id = this.getId();
    const at = m && id ? locate(m, id) : null;
    return at && at.content.text ? at.content : null;
  }

  private row(host: HTMLElement, label: string, ctl: HTMLElement | HTMLElement[]): HTMLElement {
    const r = el('<div class="fm-tc-row"><span></span></div>');
    setText(r.firstElementChild, label);
    for (const c of Array.isArray(ctl) ? ctl : [ctl]) r.appendChild(c);
    host.appendChild(r);
    return r;
  }

  /** `set` null: the caller wires the input itself (the Spans tab paints runs). */
  private num(host: HTMLElement, label: string, min: number, max: number, step: number, get: (s: TextStyle) => number | undefined, set: ((s: TextStyle, v: number) => TextStyle) | null, field: string, ph = ''): HTMLElement {
    const input = el<HTMLInputElement>(`<input class="fm-tc-num fm-tc-wide" type="number" min="${min}" max="${max}" step="${step}" aria-label="${label}">`);
    if (ph) input.placeholder = ph;
    if (set) input.addEventListener('input', () => { const v = input.valueAsNumber; if (Number.isFinite(v)) this.mutate((s) => set(s, Math.min(max, Math.max(min, v))), field); });
    input.addEventListener('change', () => this.end());
    this.ctls.push({ sync: (s) => { const v = get(s); if (document.activeElement !== input) input.value = v === undefined ? '' : String(Math.round(v * 1000) / 1000); } });
    return this.row(host, label, input);
  }

  private color(host: HTMLElement, label: string, get: (s: TextStyle) => string | undefined, set: ((s: TextStyle, v: string) => TextStyle) | null, field: string, ...extra: HTMLElement[]): HTMLElement {
    const input = el<HTMLInputElement>(`<input type="color" aria-label="${label}">`);
    const sw = el<HTMLElement>('<label class="fm-tc-swatch"></label>');
    sw.appendChild(input);
    if (set) input.addEventListener('input', () => this.mutate((s) => set(s, input.value), field));
    input.addEventListener('change', () => this.end());
    this.ctls.push({ sync: (s) => { const v = hex(get(s), '#000000'); if (input.value !== v) input.value = v; } });
    return this.row(host, label, [sw, ...extra]);
  }

  private select(host: HTMLElement, label: string, opts: Array<[string, string]>, get: (s: TextStyle) => string | undefined, set: ((s: TextStyle, v: string) => TextStyle) | null, field: string, blank = false): HTMLElement {
    const sel = el<HTMLSelectElement>(`<select class="fm-tc-select" aria-label="${label}"></select>`);
    if (blank) sel.appendChild(el('<option value="">Mixed</option>'));
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
    if (set) sel.addEventListener('change', () => { if (sel.value !== '') this.mutate((s) => set(s, sel.value), field); this.end(); });
    this.ctls.push({ sync: (s) => { const v = get(s) ?? ''; if (document.activeElement !== sel && sel.value !== v) sel.value = v; } });
    return this.row(host, label, sel);
  }

  /** A row of buttons; `on` says which are lit. */
  private seg(host: HTMLElement, label: string, items: Array<{ id: string; text: string; title?: string }>, on: (s: TextStyle) => Set<string>, press: (s: TextStyle, id: string) => TextStyle, field: string): HTMLElement {
    const box = el<HTMLElement>('<div class="fm-tc-seg fm-tc-seg-wide"></div>');
    const btns = new Map<string, HTMLButtonElement>();
    for (const it of items) {
      const b = el<HTMLButtonElement>('<button class="fm-tc-seg-btn" type="button" aria-pressed="false"></button>');
      b.innerHTML = it.text;
      b.title = it.title ?? '';
      b.addEventListener('click', () => { this.mutate((s) => press(s, it.id), field); this.end(); });
      btns.set(it.id, b);
      box.appendChild(b);
    }
    this.ctls.push({ sync: (s) => { const set = on(s); for (const [id, b] of btns) { setClass(b, 'is-on', set.has(id)); b.setAttribute('aria-pressed', String(set.has(id))); } } });
    return this.row(host, label, box);
  }

  private head(host: HTMLElement, text: string): HTMLElement {
    const h = el('<div class="fm-tr-head"></div>');
    setText(h, text);
    host.appendChild(h);
    return h;
  }

  // ---- Spans ----

  private rangeOf(s: TextStyle): { from: number; to: number; all: boolean } {
    const r = textSel.range(this.getId());
    if (r) return { from: Math.min(r.from, s.text.length), to: Math.min(r.to, s.text.length), all: false };
    return { from: 0, to: s.text.length, all: true };
  }

  private run(patch: Partial<Omit<TextRun, 'from' | 'to'>>, field: string): void {
    this.mutate((s) => {
      const r = this.rangeOf(s);
      return { ...s, runs: paintRun(s.runs, r.from, r.to, patch) };
    }, `run-${field}`);
  }

  private buildSpans(): void {
    const host = this.spans;
    host.appendChild(this.info);
    this.ctls.push({
      sync: (s) => {
        const r = this.rangeOf(s);
        setText(this.info, r.all ? 'All text. Select words or letters in the text box on the Stage to style just those.' : `Selected: "${s.text.slice(r.from, Math.min(r.to, r.from + 24)).replace(/\n/g, ' ')}${r.to - r.from > 24 ? '...' : ''}" (${r.to - r.from} characters)`);
      },
    });
    const val = <K extends keyof Omit<TextRun, 'from' | 'to'>>(s: TextStyle, k: K): TextRun[K] | undefined => { const r = this.rangeOf(s); return r.to > r.from ? runValue(s, r.from, r.to, k) : undefined; };
    const fonts = (): Array<[string, string]> => { const c = fontCatalog(this.engine.movie); return [...c.bundled, ...c.movie].map((f) => [f, f] as [string, string]); };
    const fontSel = this.select(host, 'Font', [], (s) => val(s, 'font'), null, 'font', true);
    const sel = q<HTMLSelectElement>(fontSel, 'select');
    const fillFonts = (): void => {
      const have = new Set(Array.from(sel.options).map((o) => o.value));
      for (const [v, t] of fonts()) if (!have.has(v)) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
    };
    fillFonts();
    sel.addEventListener('focus', fillFonts);
    this.ctls.push({ sync: (s) => { const f = val(s, 'font'); if (f && !Array.from(sel.options).some((o) => o.value === f)) { const o = document.createElement('option'); o.value = f; o.textContent = f; sel.appendChild(o); } if (document.activeElement !== sel) sel.value = f ?? ''; } });
    // the generic select handler above ignores the change (its setter returns the style untouched): apply the font here, once its faces are loaded
    sel.addEventListener('change', () => {
      const font = sel.value, t = this.content()?.text;
      if (!font || !t) return;
      void ensureTextFont({ ...t, font }).then(() => { this.run({ font }, 'font'); this.end(); });
    });
    const wt = this.select(host, 'Weight', WEIGHTS.map(([w, n]) => [String(w), n] as [string, string]), (s) => { const v = val(s, 'weight'); return v === undefined ? undefined : String(v); }, null, 'weight', true);
    q<HTMLSelectElement>(wt, 'select').addEventListener('change', (e) => {
      const weight = Number((e.target as HTMLSelectElement).value), t = this.content()?.text;
      if (!weight || !t) return;
      const font = val(t, 'font') ?? t.font;
      void ensureTextFont({ ...t, font, weight }).then(() => { this.run({ weight }, 'weight'); this.end(); });
    });
    this.num(host, 'Size', 4, 1500, 1, (s) => val(s, 'size'), null, 'size', 'Mixed');
    const sizeIn = q<HTMLInputElement>(host.lastElementChild as HTMLElement, 'input');
    sizeIn.addEventListener('input', () => { const v = sizeIn.valueAsNumber; if (Number.isFinite(v) && v >= 4) this.run({ size: Math.round(v) }, 'size'); });
    this.color(host, 'Color', (s) => val(s, 'color'), null, 'color');
    const colIn = q<HTMLInputElement>(host.lastElementChild as HTMLElement, 'input');
    colIn.addEventListener('input', () => this.run({ color: colIn.value }, 'color'));
    this.seg(host, 'Style', [
      { id: 'italic', text: '<span class="fm-tc-i">I</span>', title: 'Italic' },
      { id: 'underline', text: '<span class="fm-tc-u">U</span>', title: 'Underline' },
      { id: 'strike', text: '<span class="fm-tc-s">S</span>', title: 'Strikethrough' },
    ], (s) => { const o = new Set<string>(); for (const k of ['italic', 'underline', 'strike'] as const) if (val(s, k) === true) o.add(k); return o; },
    (s, id) => {
      const k = id as 'italic' | 'underline' | 'strike', cur = val(s, k) === true;
      const r = this.rangeOf(s);
      return { ...s, runs: paintRun(s.runs, r.from, r.to, { [k]: cur ? false : true }) };
    }, 'flag');
    this.num(host, 'Tracking', -200, 1000, 5, (s) => val(s, 'tracking'), null, 'tracking', 'Mixed');
    const trIn = q<HTMLInputElement>(host.lastElementChild as HTMLElement, 'input');
    trIn.addEventListener('input', () => { const v = trIn.valueAsNumber; if (Number.isFinite(v)) this.run({ tracking: v }, 'tracking'); });
    this.num(host, 'Baseline', -300, 300, 1, (s) => val(s, 'baseline'), null, 'baseline', 'Mixed');
    const blIn = q<HTMLInputElement>(host.lastElementChild as HTMLElement, 'input');
    blIn.addEventListener('input', () => { const v = blIn.valueAsNumber; if (Number.isFinite(v)) this.run({ baseline: v }, 'baseline'); });
    // outline of the span
    const sw = el<HTMLInputElement>('<input class="fm-tc-num" type="number" min="0" max="80" step="1" aria-label="Outline width in pixels">');
    this.color(host, 'Outline', (s) => val(s, 'stroke')?.color, null, 'stroke', sw);
    const oc = q<HTMLInputElement>(host.lastElementChild as HTMLElement, 'input[type="color"]');
    const outline = (): void => { const w = Math.max(0, Math.round(sw.valueAsNumber || 0)); this.run({ stroke: { color: oc.value, width: w } }, 'stroke'); };
    oc.addEventListener('input', () => { if (!(sw.valueAsNumber > 0)) sw.value = '4'; outline(); });
    sw.addEventListener('input', outline);
    sw.addEventListener('change', () => this.end());
    this.ctls.push({ sync: (s) => { if (document.activeElement !== sw) sw.value = String(val(s, 'stroke')?.width ?? 0); } });
    const clear = el<HTMLButtonElement>('<button class="fm-tc-mini" type="button">Clear styling</button>');
    clear.addEventListener('click', () => {
      this.mutate((s) => { const r = this.rangeOf(s); return { ...s, runs: this.cut(s.runs, r.from, r.to) }; }, 'run-clear');
      this.end();
    });
    this.ctls.push({ sync: (s) => { clear.disabled = !s.runs?.length; } });
    this.row(host, 'Reset', clear);
  }

  /** Removes the styling of [from,to): spans are trimmed or split around it. */
  private cut(runs: TextRun[] | undefined, from: number, to: number): TextRun[] | undefined {
    if (!runs) return runs;
    const out: TextRun[] = [];
    for (const r of runs) {
      if (r.to <= from || r.from >= to) { out.push(r); continue; }
      if (r.from < from) out.push({ ...r, to: from });
      if (r.to > to) out.push({ ...r, from: to });
    }
    return out.length ? out : undefined;
  }

  // ---- Effects ----

  private buildEffects(): void {
    const host = this.effects;
    this.head(host, 'Shadow');
    const shadowRows: HTMLElement[] = [];
    this.seg(host, 'Use', [{ id: 'on', text: 'On' }], (s) => new Set(s.shadow ? ['on'] : []),
      (s) => (s.shadow ? { ...s, shadow: undefined } : { ...s, shadow: { color: '#000000', angle: 45, distance: 8, blur: 10, opacity: 0.6 } }), 'shadow');
    shadowRows.push(this.color(host, 'Color', (s) => s.shadow?.color, (s, v) => (s.shadow ? { ...s, shadow: { ...s.shadow, color: v } } : s), 'shadow-color'));
    shadowRows.push(this.num(host, 'Angle', -360, 360, 1, (s) => s.shadow?.angle, (s, v) => (s.shadow ? { ...s, shadow: { ...s.shadow, angle: v } } : s), 'shadow-angle'));
    shadowRows.push(this.num(host, 'Distance', 0, 600, 1, (s) => s.shadow?.distance, (s, v) => (s.shadow ? { ...s, shadow: { ...s.shadow, distance: v } } : s), 'shadow-distance'));
    shadowRows.push(this.num(host, 'Blur', 0, 300, 1, (s) => s.shadow?.blur, (s, v) => (s.shadow ? { ...s, shadow: { ...s.shadow, blur: v } } : s), 'shadow-blur'));
    shadowRows.push(this.num(host, 'Opacity', 0, 100, 1, (s) => (s.shadow ? (s.shadow.opacity ?? 0.6) * 100 : undefined), (s, v) => (s.shadow ? { ...s, shadow: { ...s.shadow, opacity: v / 100 } } : s), 'shadow-opacity'));
    this.ctls.push({ sync: (s) => { for (const r of shadowRows) setHidden(r, !s.shadow); } });

    this.head(host, 'Background box');
    const boxRows: HTMLElement[] = [];
    this.seg(host, 'Use', [{ id: 'on', text: 'On' }], (s) => new Set(s.box ? ['on'] : []),
      (s) => (s.box ? { ...s, box: undefined } : { ...s, box: { color: textColorFor(s.color), padding: 24, radius: 12, opacity: 0.7, mode: 'line' } }), 'box');
    boxRows.push(this.color(host, 'Color', (s) => s.box?.color, (s, v) => (s.box ? { ...s, box: { ...s.box, color: v } } : s), 'box-color'));
    boxRows.push(this.num(host, 'Padding', 0, 600, 1, (s) => s.box?.padding, (s, v) => (s.box ? { ...s, box: { ...s.box, padding: v } } : s), 'box-padding'));
    boxRows.push(this.num(host, 'Radius', 0, 600, 1, (s) => s.box?.radius, (s, v) => (s.box ? { ...s, box: { ...s.box, radius: v } } : s), 'box-radius'));
    boxRows.push(this.num(host, 'Opacity', 0, 100, 1, (s) => (s.box ? s.box.opacity * 100 : undefined), (s, v) => (s.box ? { ...s, box: { ...s.box, opacity: v / 100 } } : s), 'box-opacity'));
    boxRows.push(this.seg(host, 'Per', [{ id: 'line', text: 'Line' }, { id: 'block', text: 'Block' }], (s) => new Set(s.box ? [s.box.mode] : []),
      (s, id) => (s.box ? { ...s, box: { ...s.box, mode: id as 'line' | 'block' } } : s), 'box-mode'));
    this.ctls.push({ sync: (s) => { for (const r of boxRows) setHidden(r, !s.box); } });
  }

  // ---- Animate ----

  private side(host: HTMLElement, which: 'in' | 'out', title: string): void {
    const get = (s: TextStyle): TextAnimSide | undefined => s.anim?.[which];
    const upd = (s: TextStyle, patch: Partial<TextAnimSide>): TextStyle => {
      const cur = get(s);
      return cur ? { ...s, anim: { ...s.anim, [which]: { ...cur, ...patch } } } : s;
    };
    this.head(host, title);
    const rows: HTMLElement[] = [];
    this.seg(host, 'Use', [{ id: 'on', text: 'On' }], (s) => new Set(get(s) ? ['on'] : []),
      (s) => (get(s) ? { ...s, anim: { ...s.anim, [which]: undefined } } : { ...s, anim: { ...s.anim, [which]: { ...DEFAULT_SIDE, ease: which === 'in' ? 'out' : 'in', fade: true, slide: { dir: 'up', dist: 40 } } } }), `anim-${which}`);
    rows.push(this.seg(host, 'Per', UNITS.map(([id, text]) => ({ id, text })), (s) => new Set(get(s) ? [get(s)!.unit] : []), (s, id) => upd(s, { unit: id as AnimUnit }), `anim-${which}-unit`));
    rows.push(this.seg(host, 'Fade', [{ id: 'fade', text: 'Fade' }], (s) => new Set(get(s)?.fade ? ['fade'] : []), (s) => upd(s, { fade: !get(s)?.fade }), `anim-${which}-fade`));
    rows.push(this.select(host, 'Slide', DIRS, (s) => get(s)?.slide?.dir ?? 'none', (s, v) => upd(s, { slide: v === 'none' ? undefined : { dir: v as AnimDir, dist: get(s)?.slide?.dist ?? 40 } }), `anim-${which}-dir`));
    rows.push(this.num(host, 'Distance', 0, 2000, 1, (s) => get(s)?.slide?.dist, (s, v) => upd(s, { slide: { dir: get(s)?.slide?.dir ?? 'up', dist: v } }), `anim-${which}-dist`));
    rows.push(this.num(host, 'Scale', 0, 10, 0.05, (s) => get(s)?.scale ?? 1, (s, v) => upd(s, { scale: v === 1 ? undefined : v }), `anim-${which}-scale`));
    rows.push(this.num(host, 'Rotate', -720, 720, 1, (s) => get(s)?.rotate ?? 0, (s, v) => upd(s, { rotate: v === 0 ? undefined : v }), `anim-${which}-rot`));
    rows.push(this.num(host, 'Blur', 0, 200, 1, (s) => get(s)?.blur ?? 0, (s, v) => upd(s, { blur: v === 0 ? undefined : v }), `anim-${which}-blur`));
    rows.push(this.num(host, 'Length', 1, 600, 1, (s) => get(s)?.dur, (s, v) => upd(s, { dur: v }), `anim-${which}-dur`));
    rows.push(this.num(host, 'Stagger', 0, 120, 0.5, (s) => get(s)?.stagger, (s, v) => upd(s, { stagger: v }), `anim-${which}-stagger`));
    rows.push(this.select(host, 'Order', ORDERS, (s) => get(s)?.order, (s, v) => upd(s, { order: v as AnimOrder }), `anim-${which}-order`));
    rows.push(this.num(host, 'Seed', 0, 9999, 1, (s) => get(s)?.seed, (s, v) => upd(s, { seed: Math.round(v) }), `anim-${which}-seed`));
    rows.push(this.select(host, 'Ease', EASE_CHOICES.map((e) => [e.id, e.label] as [string, string]), (s) => get(s)?.ease, (s, v) => upd(s, { ease: v as Ease }), `anim-${which}-ease`));
    rows.push(this.num(host, which === 'in' ? 'Delay' : 'Finish', 0, 3000, 1, (s) => get(s)?.offset, (s, v) => upd(s, { offset: v }), `anim-${which}-offset`));
    this.ctls.push({ sync: (s) => { for (const r of rows) setHidden(r, !get(s)); } });
  }

  private buildAnimate(): void {
    const host = this.animate;
    this.side(host, 'in', 'Build on');
    this.side(host, 'out', 'Build off');
    this.head(host, 'Typewriter');
    const rows: HTMLElement[] = [];
    const ty = (s: TextStyle) => s.anim?.type;
    const upd = (s: TextStyle, patch: Partial<NonNullable<ReturnType<typeof ty>>>): TextStyle => (ty(s) ? { ...s, anim: { ...s.anim, type: { ...(ty(s) as NonNullable<ReturnType<typeof ty>>), ...patch } } } : s);
    this.seg(host, 'Use', [{ id: 'on', text: 'On' }], (s) => new Set(ty(s) ? ['on'] : []),
      (s) => (ty(s) ? { ...s, anim: { ...s.anim, type: undefined } } : { ...s, anim: { ...s.anim, type: { cps: 14, cursor: true, offset: 0 } } }), 'anim-type');
    rows.push(this.num(host, 'Speed', 1, 400, 1, (s) => ty(s)?.cps, (s, v) => upd(s, { cps: v }), 'anim-cps', 'chars / second'));
    rows.push(this.seg(host, 'Cursor', [{ id: 'cursor', text: 'Show' }], (s) => new Set(ty(s)?.cursor ? ['cursor'] : []), (s) => upd(s, { cursor: !ty(s)?.cursor }), 'anim-cursor'));
    rows.push(this.num(host, 'Delay', 0, 3000, 1, (s) => ty(s)?.offset, (s, v) => upd(s, { offset: v }), 'anim-type-offset'));
    rows.push(this.seg(host, 'Erase', [{ id: 'erase', text: 'At end' }], (s) => new Set(ty(s)?.erase ? ['erase'] : []), (s) => upd(s, { erase: !ty(s)?.erase }), 'anim-erase'));
    rows.push(this.num(host, 'Finish', 0, 3000, 1, (s) => ty(s)?.eraseOffset ?? 0, (s, v) => upd(s, { eraseOffset: v }), 'anim-erase-offset'));
    this.ctls.push({ sync: (s) => { for (const r of rows) setHidden(r, !ty(s)); } });

    this.head(host, 'Keyframes');
    const note = el('<div class="fm-tr-info">By default the animators run on the block\'s own start and end. Key the progress to drive them by hand (Text Animation in the Action menu).</div>');
    host.appendChild(note);
    const bar = el<HTMLElement>('<div class="fm-tr-bar"></div>');
    const mk = (label: string, run: () => void): HTMLButtonElement => {
      const b = el<HTMLButtonElement>('<button class="fm-tc-mini" type="button"></button>');
      setText(b, label);
      b.addEventListener('click', () => { run(); this.end(); });
      bar.appendChild(b);
      return b;
    };
    const keyed = (c: Content, kind: 'in' | 'out' | 'type'): Content => {
      const t = c.text as TextStyle, lay = layoutText(t, this.engine.movie as NonNullable<Engine['movie']>), span = animSpans(t, lay);
      const fps = this.engine.movie?.fps ?? 24;
      const last = Math.max(1, c.duration - 1);
      if (kind === 'in') { const n = Math.max(1, Math.min(last, Math.round(span.in || 12))); return keyOps.setKeys(keyOps.setKeys(c, 'textanim', 0, { in: 0 }, 'linear'), 'textanim', n, { in: 1 }, 'linear'); }
      if (kind === 'out') { const n = Math.max(1, Math.min(last, Math.round(span.out || 12))); return keyOps.setKeys(keyOps.setKeys(c, 'textanim', Math.max(0, last - n), { out: 0 }, 'linear'), 'textanim', last, { out: 1 }, 'linear'); }
      const n = Math.max(1, Math.min(last, Math.round(((t.text.replace(/\s/g, '').length || 10) / Math.max(1, t.anim?.type?.cps ?? 14)) * fps)));
      return keyOps.setKeys(keyOps.setKeys(c, 'textanim', 0, { type: 0 }, 'linear'), 'textanim', n, { type: 1 }, 'linear');
    };
    const key = (kind: 'in' | 'out' | 'type'): void => {
      const id = this.getId();
      if (id) this.engine.run('Key Text Animation', (m) => ops.updateContent(m, id, (c) => (c.text ? keyed(c, kind) : c)));
    };
    const bIn = mk('Key build on', () => key('in'));
    const bOut = mk('Key build off', () => key('out'));
    const bTy = mk('Key typewriter', () => key('type'));
    const bDel = mk('Remove keys', () => { const id = this.getId(); if (id) this.engine.run('Remove Text Animation keys', (m) => ops.updateContent(m, id, (c) => keyOps.deleteLane(c, 'textanim'))); });
    host.appendChild(bar);
    this.ctls.push({ sync: (s) => { bIn.disabled = !s.anim?.in; bOut.disabled = !s.anim?.out; bTy.disabled = !s.anim?.type; bDel.disabled = !this.content()?.keys?.some((k) => k.kind === 'textanim'); } });
  }
}
