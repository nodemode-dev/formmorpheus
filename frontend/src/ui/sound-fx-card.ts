// The Sound effects card: the effect chain of one sound block or one track (noise gate, de-esser, EQ, compressor,
// reverb) and, for a track, ducking under another track. Built once; every control patches in place and every
// edit is one undo step (sliders merge while dragged).
import { duckProbe } from '../media/duck-meter';
import { DUCK_DEFAULT, FX_DEFAULTS, FX_MODULES, FX_RANGES, activeDuck, cleanFx, setBlockFx, setParam, setTrackDuck, setTrackFx, toggleModule, type AudioFx, type Duck, type FxModule } from '../engine/audio-fx';
import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import { eqResponse } from '../media/audio-dsp';
import { el, q, setClass, setHidden, setText } from './dom';
import { t } from './i18n';
import '../styles/audio-fx.css';

type Target = { kind: 'block' | 'track'; id: string };

interface Spec { mod: FxModule; path: string; label: string; min: number; max: number; unit: string; dec: number; log?: boolean }

const S = (mod: FxModule, path: string, label: string, r: readonly [number, number], unit: string, dec = 0, log = false): Spec => ({ mod, path, label, min: r[0], max: r[1], unit, dec, log });
const R = FX_RANGES;
const SPECS: Spec[] = [
  S('gate', 'threshold', 'Threshold', R.gate.threshold, 'dB', 0), S('gate', 'range', 'Reduction', R.gate.range, 'dB', 0),
  S('gate', 'attack', 'Attack', R.gate.attack, 'ms', 1, true), S('gate', 'hold', 'Hold', R.gate.hold, 'ms', 0), S('gate', 'release', 'Release', R.gate.release, 'ms', 0, true),
  S('deess', 'freq', 'Frequency', R.deess.freq, 'Hz', 0, true), S('deess', 'threshold', 'Threshold', R.deess.threshold, 'dB', 0), S('deess', 'amount', 'Reduction', R.deess.amount, 'dB', 0),
  S('eq', 'lowCut', 'Low cut', R.eq.lowCut, 'Hz', 0), S('eq', 'highCut', 'High cut', [1000, 20000], 'Hz', 0, true),
  S('eq', 'low.gain', 'Low', R.eq.gain, 'dB', 1), S('eq', 'low.freq', 'Low freq', R.eq.lowFreq, 'Hz', 0, true),
  S('eq', 'mid.gain', 'Mid', R.eq.gain, 'dB', 1), S('eq', 'mid.freq', 'Mid freq', R.eq.midFreq, 'Hz', 0, true), S('eq', 'mid.q', 'Mid width', R.eq.q, 'Q', 1, true),
  S('eq', 'high.gain', 'High', R.eq.gain, 'dB', 1), S('eq', 'high.freq', 'High freq', R.eq.highFreq, 'Hz', 0, true),
  S('comp', 'threshold', 'Threshold', R.comp.threshold, 'dB', 0), S('comp', 'ratio', 'Ratio', R.comp.ratio, ': 1', 1, true),
  S('comp', 'attack', 'Attack', R.comp.attack, 'ms', 1, true), S('comp', 'release', 'Release', R.comp.release, 'ms', 0, true),
  S('comp', 'makeup', 'Makeup', R.comp.makeup, 'dB', 1), S('comp', 'knee', 'Knee', R.comp.knee, 'dB', 0),
  S('reverb', 'size', 'Room size', R.reverb.size, '%', 0), S('reverb', 'decay', 'Decay', R.reverb.decay, 's', 1, true),
  S('reverb', 'damping', 'Damping', R.reverb.damping, '%', 0), S('reverb', 'mix', 'Mix', R.reverb.mix, '%', 0), S('reverb', 'preDelay', 'Pre-delay', R.reverb.preDelay, 'ms', 0),
];
const PCT = new Set(['size', 'damping', 'mix']);
const DUCK_SPECS: { key: 'amount' | 'threshold' | 'attack' | 'release'; label: string; r: readonly [number, number]; unit: string; dec: number; log: boolean }[] = [
  { key: 'amount', label: 'Duck by', r: R.duck.amount, unit: 'dB', dec: 0, log: false },
  { key: 'threshold', label: 'Threshold', r: R.duck.threshold, unit: 'dB', dec: 0, log: false },
  { key: 'attack', label: 'Attack', r: R.duck.attack, unit: 'ms', dec: 0, log: true },
  { key: 'release', label: 'Release', r: R.duck.release, unit: 'ms', dec: 0, log: true },
];
const TITLES: Record<FxModule, string> = { gate: 'Noise gate', deess: 'De-esser', eq: 'Equalizer', comp: 'Compressor', reverb: 'Reverb' };

const PRESETS: { id: string; label: string; fx: AudioFx }[] = [
  { id: 'voice', label: 'Clean voice', fx: { gate: { ...FX_DEFAULTS.gate, threshold: -50 }, deess: { ...FX_DEFAULTS.deess }, eq: { lowCut: 90, highCut: 0, low: { gain: 0, freq: 120 }, mid: { gain: 2, freq: 3000, q: 1 }, high: { gain: 1.5, freq: 9000 } }, comp: { threshold: -20, ratio: 3, attack: 8, release: 140, makeup: 4, knee: 6 } } },
  { id: 'music', label: 'Music bed', fx: { eq: { lowCut: 40, highCut: 0, low: { gain: 0, freq: 120 }, mid: { gain: -3, freq: 1800, q: 0.8 }, high: { gain: 0, freq: 6000 } }, comp: { threshold: -22, ratio: 2.5, attack: 25, release: 250, makeup: 2, knee: 10 } } },
  { id: 'phone', label: 'Telephone', fx: { eq: { lowCut: 400, highCut: 3400, low: { gain: 0, freq: 120 }, mid: { gain: 4, freq: 1500, q: 1.2 }, high: { gain: 0, freq: 6000 } }, comp: { threshold: -24, ratio: 6, attack: 3, release: 80, makeup: 5, knee: 3 } } },
  { id: 'hall', label: 'Big hall', fx: { reverb: { size: 0.85, decay: 4.5, damping: 0.4, mix: 0.35, preDelay: 30 } } },
  { id: 'room', label: 'Small room', fx: { reverb: { size: 0.25, decay: 0.7, damping: 0.6, mix: 0.18, preDelay: 6 } } },
];

interface Row { spec: Spec; input: HTMLInputElement; val: HTMLElement }
interface Sec { mod: FxModule; root: HTMLElement; on: HTMLInputElement; rows: Row[] }

const toPos = (v: number, a: { min: number; max: number; log?: boolean }): number =>
  Math.round(1000 * (a.log && a.min > 0 ? Math.log(Math.max(a.min, v) / a.min) / Math.log(a.max / a.min) : (v - a.min) / (a.max - a.min || 1)));
const fromPos = (p: number, a: { min: number; max: number; log?: boolean }): number =>
  a.log && a.min > 0 ? a.min * Math.pow(a.max / a.min, p / 1000) : a.min + (p / 1000) * (a.max - a.min);

function readPath(obj: unknown, path: string): number {
  let cur = obj as Record<string, unknown> | undefined;
  for (const k of path.split('.')) cur = cur?.[k] as Record<string, unknown> | undefined;
  return typeof cur === 'number' ? cur : 0;
}

function show(v: number, s: { unit: string; dec: number }, pct: boolean): string {
  const x = pct ? v * 100 : v;
  return `${x.toFixed(s.dec)} ${s.unit}`.trim();
}

export class SoundFxCard {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly secs: Sec[] = [];
  private readonly bypass: HTMLInputElement;
  private readonly preset: HTMLSelectElement;
  private curve!: HTMLCanvasElement;
  private readonly duckBox: HTMLElement;
  private readonly duckOn: HTMLInputElement;
  private readonly duckSrc: HTMLSelectElement;
  private readonly duckRows: { key: 'amount' | 'threshold' | 'attack' | 'release'; input: HTMLInputElement; val: HTMLElement }[] = [];
  private target: Target | null = null;
  private open = false;
  private srcKey = '';

  constructor(private readonly engine: Engine) {
    this.root = el<HTMLElement>('<section class="fm-sfx" role="dialog" hidden><div class="fm-sfx-head"><span class="fm-sfx-title"></span><button class="fm-sfx-x" type="button"></button></div><div class="fm-sfx-body"></div></section>');
    this.root.setAttribute('aria-label', t('Sound effects'));
    this.title = q(this.root, '.fm-sfx-title');
    const x = q<HTMLButtonElement>(this.root, '.fm-sfx-x');
    x.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.setAttribute('aria-label', t('Close'));
    x.addEventListener('click', () => this.close());
    const body = q(this.root, '.fm-sfx-body');

    const top = el<HTMLElement>('<div class="fm-sfx-top"><select class="cv-input fm-sfx-preset"></select><label class="fm-sfx-chk"><input type="checkbox" class="fm-sfx-bypass"><span></span></label></div>');
    this.preset = q<HTMLSelectElement>(top, '.fm-sfx-preset');
    this.preset.setAttribute('aria-label', t('Preset'));
    this.preset.append(new Option(t('Preset...'), ''), ...PRESETS.map((p) => new Option(t(p.label), p.id)), new Option(t('Clear all effects'), 'clear'));
    this.bypass = q<HTMLInputElement>(top, '.fm-sfx-bypass');
    setText(q(top, '.fm-sfx-chk span'), t('Bypass'));
    body.appendChild(top);
    this.preset.addEventListener('change', () => {
      const v = this.preset.value;
      this.preset.value = '';
      if (v === 'clear') this.commit('Clear Sound Effects', undefined, null);
      else { const p = PRESETS.find((x2) => x2.id === v); if (p) this.commit('Sound Effects Preset', cleanFx(structuredClone(p.fx)), null); }
    });
    this.bypass.addEventListener('change', () => {
      const fx = this.fx();
      if (!fx) return;
      const next: AudioFx = { ...fx };
      if (this.bypass.checked) next.bypass = true; else delete next.bypass;
      this.commit('Bypass Sound Effects', next, null);
    });

    for (const mod of FX_MODULES) {
      const root = el<HTMLElement>('<section class="fm-sfx-sec"><label class="fm-sfx-sech"><input type="checkbox"><span></span></label><div class="fm-sfx-secb"></div></section>');
      setText(q(root, '.fm-sfx-sech span'), t(TITLES[mod]));
      const on = q<HTMLInputElement>(root, 'input');
      const secb = q(root, '.fm-sfx-secb');
      if (mod === 'eq') {
        this.curve = el<HTMLCanvasElement>('<canvas class="fm-sfx-curve" aria-label="EQ curve"></canvas>');
        secb.appendChild(this.curve);
      }
      const rows: Row[] = [];
      for (const spec of SPECS.filter((s) => s.mod === mod)) {
        const row = el<HTMLElement>('<div class="fm-sfx-row"><span class="fm-sfx-lab"></span><input type="range" min="0" max="1000" step="1"><span class="fm-sfx-val"></span></div>');
        setText(q(row, '.fm-sfx-lab'), t(spec.label));
        const input = q<HTMLInputElement>(row, 'input');
        input.setAttribute('aria-label', `${t(TITLES[mod])} ${t(spec.label)}`);
        const r: Row = { spec, input, val: q(row, '.fm-sfx-val') };
        input.addEventListener('input', () => this.slide(r));
        input.addEventListener('change', () => this.engine.endGesture());
        input.addEventListener('dblclick', () => {
          const d = readPath(FX_DEFAULTS[mod], spec.path);
          input.value = String(toPos(d, spec));
          this.slide(r);
          this.engine.endGesture();
        });
        rows.push(r);
        secb.appendChild(row);
      }
      on.addEventListener('change', () => this.commit(`${on.checked ? 'Add' : 'Remove'} ${TITLES[mod]}`, toggleModule(this.fx(), mod, on.checked), null));
      body.appendChild(root);
      this.secs.push({ mod, root, on, rows });
    }

    this.duckBox = el<HTMLElement>('<section class="fm-sfx-sec"><label class="fm-sfx-sech"><input type="checkbox"><span></span></label><div class="fm-sfx-secb"><div class="fm-sfx-row"><span class="fm-sfx-lab"></span><select class="cv-input fm-sfx-src"></select><span></span></div></div></section>');
    this.duckOn = q<HTMLInputElement>(this.duckBox, 'input');
    setText(q(this.duckBox, '.fm-sfx-sech span'), t('Duck under another track'));
    setText(q(this.duckBox, '.fm-sfx-lab'), t('Listen to'));
    this.duckSrc = q<HTMLSelectElement>(this.duckBox, '.fm-sfx-src');
    const duckBody = q(this.duckBox, '.fm-sfx-secb');
    for (const d of DUCK_SPECS) {
      const row = el<HTMLElement>('<div class="fm-sfx-row"><span class="fm-sfx-lab"></span><input type="range" min="0" max="1000" step="1"><span class="fm-sfx-val"></span></div>');
      setText(q(row, '.fm-sfx-lab'), t(d.label));
      const input = q<HTMLInputElement>(row, 'input');
      input.setAttribute('aria-label', `${t('Ducking')} ${t(d.label)}`);
      input.addEventListener('input', () => this.duckEdit({ [d.key]: Math.round(fromPos(Number(input.value), { min: d.r[0], max: d.r[1], log: d.log })) }, `fx-duck-${d.key}`));
      input.addEventListener('change', () => this.engine.endGesture());
      this.duckRows.push({ key: d.key, input, val: q(row, '.fm-sfx-val') });
      duckBody.appendChild(row);
    }
    // gain reduction: how far the ducked track is turned down at the Playhead, live while the card is open
    const gr = el<HTMLElement>('<div class="fm-sfx-row fm-sfx-gr"><span class="fm-sfx-lab"></span><span class="fm-sfx-grbar"><i></i></span><span class="fm-sfx-val"></span></div>');
    setText(q(gr, '.fm-sfx-lab'), t('Gain reduction'));
    this.grBar = q(gr, '.fm-sfx-grbar i');
    this.grVal = q(gr, '.fm-sfx-val');
    duckBody.appendChild(gr);
    this.duckOn.addEventListener('change', () => {
      const tr = this.trackId();
      if (!tr) return;
      if (!this.duckOn.checked) { this.engine.run('Remove Ducking', (m) => setTrackDuck(m, tr, undefined)); return; }
      const m = this.engine.movie;
      const other = m?.tracks.find((o) => o.id !== tr && o.content.some((c) => c.kind === 'audio' || c.kind === 'video'));
      if (other) this.engine.run('Duck Track', (mv) => setTrackDuck(mv, tr, { source: other.id, ...DUCK_DEFAULT }));
      else this.duckOn.checked = false;
    });
    this.duckSrc.addEventListener('change', () => this.duckEdit({ source: this.duckSrc.value }, 'fx-duck-src'));
    // ducking is what a track is most often given: it sits above the effect chain, not under five modules
    body.insertBefore(this.duckBox, this.secs[0]?.root ?? null);
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);

    for (const ev of ['movie', 'selection', 'history'] as const) this.engine.on(ev, () => { if (this.open) this.patch(); });
  }

  /** Shows the card for a sound block or for a track. */
  show(target: Target): void {
    this.target = target;
    this.open = true;
    setHidden(this.root, false);
    this.patch();
    if (!this.raf) this.raf = requestAnimationFrame(() => this.meterTick());
  }

  close(): void {
    this.open = false;
    setHidden(this.root, true);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private grBar!: HTMLElement;
  private grVal!: HTMLElement;
  private raf = 0;
  private grLast = Number.NaN;

  /** Reads the ducked track's gain at the Playhead (0 to -24 dB shown) and patches the bar in place. */
  private meterTick(): void {
    this.raf = 0;
    if (!this.open) return;
    this.raf = requestAnimationFrame(() => this.meterTick());
    const m = this.engine.movie, id = this.trackId();
    const db = m && id && this.duckOn.checked ? duckProbe.read?.(id, this.engine.frame / m.fps) ?? 0 : 0;
    if (db === this.grLast) return;
    this.grLast = db;
    this.grBar.style.transform = `scaleX(${Math.min(1, -db / 24)})`;
    setText(this.grVal, db < -0.05 ? `${db.toFixed(1)} dB` : '0 dB');
  }

  private trackId(): string | null {
    const m = this.engine.movie;
    if (!m || !this.target) return null;
    return this.target.kind === 'track' ? this.target.id : locate(m, this.target.id)?.track.id ?? null;
  }

  private fx(): AudioFx | undefined {
    const m = this.engine.movie;
    if (!m || !this.target) return undefined;
    if (this.target.kind === 'track') return m.tracks.find((tr) => tr.id === this.target?.id)?.fx;
    return locate(m, this.target.id)?.content.fx;
  }

  private commit(label: string, next: AudioFx | undefined, merge: string | null): void {
    const tg = this.target;
    if (!tg) return;
    this.engine.run(label, (m) => (tg.kind === 'track' ? setTrackFx(m, tg.id, next) : setBlockFx(m, tg.id, next)), merge);
  }

  private slide(r: Row): void {
    const fx = this.fx();
    if (!fx?.[r.spec.mod]) return;
    const raw = fromPos(Number(r.input.value), r.spec);
    const k = r.spec.max - r.spec.min <= 1 ? 100 : r.spec.max - r.spec.min <= 20 ? 20 : 10;
    const v = Math.round(raw * k) / k;
    this.commit(`${TITLES[r.spec.mod]} ${r.spec.label}`, setParam(fx, r.spec.mod, r.spec.path, v), `fx-${this.target?.id}-${r.spec.mod}.${r.spec.path}`);
  }

  private duckEdit(change: Partial<Duck>, merge: string): void {
    const tr = this.trackId();
    const m = this.engine.movie;
    const cur = m?.tracks.find((x) => x.id === tr)?.duck;
    if (!tr || !cur) return;
    this.engine.run('Ducking', (mv) => setTrackDuck(mv, tr, { ...cur, ...change } as Duck), `${merge}-${tr}`);
  }

  patch(): void {
    const m = this.engine.movie;
    const tg = this.target;
    const trackId = this.trackId();
    const tr = m?.tracks.find((x) => x.id === trackId);
    if (!m || !tg || !tr) { this.close(); return; }
    const block = tg.kind === 'block' ? locate(m, tg.id)?.content ?? null : null;
    setText(this.title, `${t('Sound effects')} · ${tg.kind === 'track' ? tr.name : block?.name ?? ''}`);
    const fx = this.fx();
    if (this.bypass.checked !== !!fx?.bypass) this.bypass.checked = !!fx?.bypass;
    this.bypass.disabled = !fx;
    for (const s of this.secs) {
      const cur = fx?.[s.mod];
      if (s.on.checked !== !!cur) s.on.checked = !!cur;
      setClass(s.root, 'is-on', !!cur);
      for (const r of s.rows) {
        const v = cur ? readPath(cur, r.spec.path) : readPath(FX_DEFAULTS[s.mod], r.spec.path);
        if (document.activeElement !== r.input) r.input.value = String(toPos(v, r.spec));
        setText(r.val, show(v, r.spec, PCT.has(r.spec.path)));
        r.input.disabled = !cur;
      }
    }
    this.drawCurve(fx?.eq);
    setHidden(this.duckBox, tg.kind !== 'track');
    if (tg.kind === 'track') {
      const duck = activeDuck(tr.duck) ?? tr.duck;
      if (this.duckOn.checked !== !!duck) this.duckOn.checked = !!duck;
      const choices = m.tracks.filter((o) => o.id !== tr.id);
      const key = choices.map((o) => `${o.id}|${o.name}`).join('\n');
      if (key !== this.srcKey) {
        this.srcKey = key;
        this.duckSrc.replaceChildren(...choices.map((o) => new Option(o.name, o.id)));
      }
      if (duck && this.duckSrc.value !== duck.source && document.activeElement !== this.duckSrc) this.duckSrc.value = duck.source;
      this.duckSrc.disabled = !duck;
      for (const r of this.duckRows) {
        const d = DUCK_SPECS.find((x) => x.key === r.key) as (typeof DUCK_SPECS)[number];
        const v = duck ? duck[r.key] : DUCK_DEFAULT[r.key];
        if (document.activeElement !== r.input) r.input.value = String(toPos(v, { min: d.r[0], max: d.r[1], log: d.log }));
        setText(r.val, show(v, d, false));
        r.input.disabled = !duck;
      }
    }
  }

  private drawCurve(eq: AudioFx['eq']): void {
    const cv = this.curve;
    const w = cv.clientWidth || 280, h = 54, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = cv.getContext('2d');
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const st = getComputedStyle(cv);
    c.strokeStyle = st.getPropertyValue('--border-light').trim() || 'rgba(128,128,128,.35)';
    c.beginPath();
    c.moveTo(0, h / 2 + 0.5);
    c.lineTo(w, h / 2 + 0.5);
    c.stroke();
    if (!eq) return;
    c.strokeStyle = st.getPropertyValue('--accent-color').trim() || '#857cf3';
    c.lineWidth = 1.6;
    c.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const hz = 20 * Math.pow(1000, x / w);
      const db = Math.max(-24, Math.min(24, eqResponse(eq, 48000, hz)));
      const y = h / 2 - (db / 24) * (h / 2 - 3);
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  }
}

let shared: SoundFxCard | null = null;
/** The one Sound effects card of the window. */
export function soundFxCard(engine: Engine): SoundFxCard {
  return shared ?? (shared = new SoundFxCard(engine));
}
