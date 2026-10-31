// Audio effects of a sound block or a track: the model (plain data, saved with the movie), the defaults and the
// pure edit functions. The sound itself is made by media/audio-dsp.ts. Absent fields mean "off".
import { OpError, updateContent } from './ops';
import type { Content, Movie, Track } from './types';

export interface EqBand { gain: number; freq: number }
export interface Eq {
  /** Hz; 0 or absent: off. */
  lowCut?: number;
  highCut?: number;
  low: EqBand;
  mid: EqBand & { q: number };
  high: EqBand;
}
export interface Gate { threshold: number; range: number; attack: number; hold: number; release: number }
export interface DeEss { freq: number; threshold: number; amount: number }
export interface Comp { threshold: number; ratio: number; attack: number; release: number; makeup: number; knee: number }
export interface Reverb { size: number; decay: number; damping: number; mix: number; preDelay: number }

/** Order of the chain: gate, de-esser, EQ, compressor, reverb. */
export interface AudioFx {
  gate?: Gate;
  deess?: DeEss;
  eq?: Eq;
  comp?: Comp;
  reverb?: Reverb;
  /** The whole chain is skipped while kept for later. */
  bypass?: true;
}

/** A track that ducks under another: `amount` dB less while the source is above `threshold` dB. */
export interface Duck { source: string; amount: number; threshold: number; attack: number; release: number }

export type FxModule = 'gate' | 'deess' | 'eq' | 'comp' | 'reverb';
export const FX_MODULES: FxModule[] = ['gate', 'deess', 'eq', 'comp', 'reverb'];

export const FX_DEFAULTS: { [K in FxModule]: NonNullable<AudioFx[K]> } = {
  gate: { threshold: -45, range: -60, attack: 2, hold: 60, release: 120 },
  deess: { freq: 6500, threshold: -28, amount: 6 },
  eq: { lowCut: 0, highCut: 0, low: { gain: 0, freq: 120 }, mid: { gain: 0, freq: 1000, q: 1 }, high: { gain: 0, freq: 6000 } },
  comp: { threshold: -18, ratio: 4, attack: 10, release: 120, makeup: 0, knee: 6 },
  reverb: { size: 0.5, decay: 1.8, damping: 0.5, mix: 0.25, preDelay: 15 },
};

export const DUCK_DEFAULT: Omit<Duck, 'source'> = { amount: 12, threshold: -34, attack: 40, release: 400 };

/** Ranges of every parameter, for sliders and for clamping what a saved movie holds. */
export const FX_RANGES = {
  gate: { threshold: [-80, 0], range: [-80, 0], attack: [0.1, 100], hold: [0, 1000], release: [5, 2000] },
  deess: { freq: [2000, 12000], threshold: [-60, 0], amount: [0, 24] },
  eq: { lowCut: [0, 400], highCut: [0, 20000], gain: [-18, 18], lowFreq: [30, 400], midFreq: [200, 5000], q: [0.2, 8], highFreq: [2000, 16000] },
  comp: { threshold: [-60, 0], ratio: [1, 20], attack: [0.1, 200], release: [5, 2000], makeup: [0, 24], knee: [0, 24] },
  reverb: { size: [0, 1], decay: [0.2, 8], damping: [0, 1], mix: [0, 1], preDelay: [0, 100] },
  duck: { amount: [0, 40], threshold: [-70, 0], attack: [1, 500], release: [10, 3000] },
} as const;

const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A saved fx with every number present and inside its range (a hand-edited file cannot break the DSP). */
export function cleanFx(fx: AudioFx | undefined): AudioFx | undefined {
  if (!fx) return undefined;
  const out: AudioFx = {};
  const R = FX_RANGES, D = FX_DEFAULTS;
  if (fx.gate) { const g = fx.gate, d = D.gate; out.gate = { threshold: clamp(num(g.threshold, d.threshold), ...R.gate.threshold), range: clamp(num(g.range, d.range), ...R.gate.range), attack: clamp(num(g.attack, d.attack), ...R.gate.attack), hold: clamp(num(g.hold, d.hold), ...R.gate.hold), release: clamp(num(g.release, d.release), ...R.gate.release) }; }
  if (fx.deess) { const g = fx.deess, d = D.deess; out.deess = { freq: clamp(num(g.freq, d.freq), ...R.deess.freq), threshold: clamp(num(g.threshold, d.threshold), ...R.deess.threshold), amount: clamp(num(g.amount, d.amount), ...R.deess.amount) }; }
  if (fx.eq) {
    const e = fx.eq, d = D.eq;
    out.eq = {
      lowCut: clamp(num(e.lowCut, 0), ...R.eq.lowCut), highCut: e.highCut ? clamp(num(e.highCut, 0), 1000, 20000) : 0,
      low: { gain: clamp(num(e.low?.gain, 0), ...R.eq.gain), freq: clamp(num(e.low?.freq, d.low.freq), ...R.eq.lowFreq) },
      mid: { gain: clamp(num(e.mid?.gain, 0), ...R.eq.gain), freq: clamp(num(e.mid?.freq, d.mid.freq), ...R.eq.midFreq), q: clamp(num(e.mid?.q, 1), ...R.eq.q) },
      high: { gain: clamp(num(e.high?.gain, 0), ...R.eq.gain), freq: clamp(num(e.high?.freq, d.high.freq), ...R.eq.highFreq) },
    };
  }
  if (fx.comp) { const g = fx.comp, d = D.comp; out.comp = { threshold: clamp(num(g.threshold, d.threshold), ...R.comp.threshold), ratio: clamp(num(g.ratio, d.ratio), ...R.comp.ratio), attack: clamp(num(g.attack, d.attack), ...R.comp.attack), release: clamp(num(g.release, d.release), ...R.comp.release), makeup: clamp(num(g.makeup, 0), ...R.comp.makeup), knee: clamp(num(g.knee, d.knee), ...R.comp.knee) }; }
  if (fx.reverb) { const g = fx.reverb, d = D.reverb; out.reverb = { size: clamp(num(g.size, d.size), ...R.reverb.size), decay: clamp(num(g.decay, d.decay), ...R.reverb.decay), damping: clamp(num(g.damping, d.damping), ...R.reverb.damping), mix: clamp(num(g.mix, d.mix), ...R.reverb.mix), preDelay: clamp(num(g.preDelay, d.preDelay), ...R.reverb.preDelay) }; }
  if (fx.bypass) out.bypass = true;
  return out;
}

/** The fx the DSP should run: undefined when nothing is on (so callers can skip the work and the cache key). */
export function activeFx(fx: AudioFx | undefined): AudioFx | undefined {
  if (!fx || fx.bypass) return undefined;
  const c = cleanFx(fx);
  if (!c) return undefined;
  if (c.eq) {
    const e = c.eq;
    const flat = !e.lowCut && !e.highCut && !e.low.gain && !e.mid.gain && !e.high.gain;
    if (flat) delete c.eq;
  }
  return FX_MODULES.some((k) => c[k]) ? c : undefined;
}

export function hasFx(fx: AudioFx | undefined): boolean {
  return !!fx && FX_MODULES.some((k) => fx[k]);
}

export function activeDuck(d: Duck | undefined): Duck | undefined {
  if (!d || !d.source || !(d.amount > 0)) return undefined;
  const R = FX_RANGES.duck;
  return { source: d.source, amount: clamp(d.amount, ...R.amount), threshold: clamp(d.threshold, ...R.threshold), attack: clamp(d.attack, ...R.attack), release: clamp(d.release, ...R.release) };
}

/** Next fx with one module switched on (defaults) or off. Empty fx is dropped by the callers. */
export function toggleModule(fx: AudioFx | undefined, mod: FxModule, on: boolean): AudioFx | undefined {
  const next: AudioFx = { ...(fx ?? {}) };
  if (on) (next as Record<string, unknown>)[mod] = structuredClone(FX_DEFAULTS[mod]);
  else delete next[mod];
  return FX_MODULES.some((k) => next[k]) ? next : undefined;
}

/** Next fx with one parameter of a module set. `path` is "param" or "band.param". */
export function setParam(fx: AudioFx, mod: FxModule, path: string, value: number): AudioFx {
  const cur = fx[mod];
  if (!cur) return fx;
  const copy = structuredClone(cur) as unknown as Record<string, unknown>;
  const [a, b] = path.split('.');
  if (b) (copy[a] as Record<string, number>)[b] = value; else copy[a] = value;
  return cleanFx({ ...fx, [mod]: copy }) ?? fx;
}

function withFx<T extends { fx?: AudioFx }>(x: T, fx: AudioFx | undefined): T {
  const next = { ...x };
  if (fx && hasFx(fx)) next.fx = fx; else delete next.fx;
  return next;
}

export function setBlockFx(m: Movie, id: string, fx: AudioFx | undefined): Movie {
  return updateContent(m, id, (c: Content) => {
    if (c.kind !== 'audio' && c.kind !== 'video') throw new OpError('Only sound has effects.');
    return withFx(c, fx);
  });
}

function patchTrack(m: Movie, trackId: string, fn: (t: Track) => Track): Movie {
  if (!m.tracks.some((t) => t.id === trackId)) throw new OpError('That track no longer exists.');
  return { ...m, tracks: m.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

export function setTrackFx(m: Movie, trackId: string, fx: AudioFx | undefined): Movie {
  return patchTrack(m, trackId, (t) => withFx(t, fx));
}

export function setTrackDuck(m: Movie, trackId: string, duck: Duck | undefined): Movie {
  return patchTrack(m, trackId, (t) => {
    const next: Track = { ...t };
    if (duck && duck.source && duck.source !== trackId) next.duck = duck; else delete next.duck;
    return next;
  });
}
