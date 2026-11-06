// What kind of device is on the other end of the pointer: a key for it that holds still between sessions, saved
// settings per key, and a "this pen looks like a mouse" check. Pure: storage is handed in by the interface.

import { PenArbiter, type BarrelAction } from './pen-arbiter';
import { PressureCurve, PressureSmoother, type CurvePoint, type PointerLike } from './pen-sample';

export interface PenSettings {
  curve: CurvePoint[];
  min: number;
  max: number;
  /** 0..1 pressure smoothing. */
  smoothing: number;
  /** Tilt shapes the brush (off reports a flat pen). */
  tiltAngle: boolean;
  /** Unset follows the older Draw & Paint row. */
  eraserEnd?: 'erase' | 'off';
  barrel1?: BarrelAction;
  barrel2?: BarrelAction;
  palm: boolean;
  palmWidth: number;
  /** Read the pressure a mouse event carries (a tablet that arrives as a mouse). Off: some trackpads vary too. */
  mousePressure: boolean;
}

export interface PenProfile {
  label: string;
  curve: CurvePoint[];
  min: number;
  max: number;
  smoothing: number;
}

export const DEFAULT_PEN_SETTINGS: PenSettings = {
  curve: [[0, 0], [1, 1]], min: 0, max: 1, smoothing: 0.2, tiltAngle: true, barrel2: 'none', palm: true, palmWidth: 44, mousePressure: false,
};

export interface StorageIo { read(): string | null; write(s: string): void }

interface PointerStats {
  type: string;
  count: number;
  contact: number;
  pMin: number;
  pMax: number;
  distinct: Set<number>;
  half: number;
  full: number;
  zero: number;
  wMin: number;
  wMax: number;
  tilt: boolean;
  twist: boolean;
  tangential: boolean;
  deviceId: number;
  /** Last webkitForce seen, -1 when the engine has none. */
  force: number;
  hover: number;
  stamps: number[];
}

const blank = (type: string): PointerStats => ({ type, count: 0, contact: 0, pMin: 1, pMax: 0, distinct: new Set(), half: 0, full: 0, zero: 0, wMin: 1e9, wMax: 0, tilt: false, twist: false, tangential: false, deviceId: 0, force: -1, hover: 0, stamps: [] });

export type MouseLike = null | 'flat' | 'zero' | 'mouse';

/** Watches pointer events and describes the device behind them. */
export class DeviceTracker {
  private readonly by = new Map<string, PointerStats>();
  private lastType = 'pen';
  learnedTilt = new Set<string>();

  observe(e: PointerLike & { pointerId?: number }): void {
    const type = e.pointerType || 'mouse';
    let s = this.by.get(type);
    if (!s) { s = blank(type); this.by.set(type, s); }
    this.lastType = type;
    s.count++;
    s.stamps.push(e.timeStamp);
    if (s.stamps.length > 96) s.stamps.shift();
    const w = e.width || 0, h = e.height || 0;
    if (w) { s.wMin = Math.min(s.wMin, w, h || w); s.wMax = Math.max(s.wMax, w, h); }
    // some engines give only altitude and azimuth; upright (pi/2) is the default and means no tilt
    if (e.tiltX || e.tiltY || (typeof e.altitudeAngle === 'number' && e.altitudeAngle < Math.PI / 2 - 1e-3)) s.tilt = true;
    const wf = (e as { webkitForce?: number }).webkitForce;
    if (typeof wf === 'number') s.force = wf;
    if (e.twist) s.twist = true;
    if (e.tangentialPressure) s.tangential = true;
    if (e.persistentDeviceId) s.deviceId = e.persistentDeviceId;
    if (e.buttons === 0) { s.hover++; return; }
    s.contact++;
    const p = e.pressure;
    s.pMin = Math.min(s.pMin, p);
    s.pMax = Math.max(s.pMax, p);
    if (s.distinct.size < 24) s.distinct.add(Math.round(p * 1000));
    if (p === 0.5) s.half++;
    else if (p === 1) s.full++;
    else if (p === 0) s.zero++;
  }

  /** Forget what was seen (the test pad's Reset). */
  reset(): void { this.by.clear(); }

  stats(type = this.lastType): PointerStats | undefined { return this.by.get(type); }

  get lastPointerType(): string { return this.lastType; }

  /** A key for this device that survives a restart: the driver's id when it gives one, else the kind of pointer, its contact size range and whether tilt ever arrives. */
  key(type = this.lastType): string {
    const s = this.by.get(type);
    if (!s) return `${type}:?`;
    if (s.deviceId) return `${type}:id${s.deviceId}`;
    const base = `${type}:w${Math.round(s.wMin === 1e9 ? 0 : s.wMin)}-${Math.round(s.wMax)}`;
    return `${base}:t${s.tilt || this.learnedTilt.has(base) ? 1 : 0}`;
  }

  baseKey(type = this.lastType): string { return this.key(type).replace(/:t\d$/, ''); }

  /** Events per second over the last second of the given type. */
  rateHz(type = this.lastType): number {
    const st = this.by.get(type)?.stamps;
    if (!st || st.length < 4) return 0;
    const end = st[st.length - 1];
    let i = st.length - 1;
    while (i > 0 && end - st[i - 1] <= 1000) i--;
    const n = st.length - 1 - i, span = end - st[i];
    return span > 0 && n >= 2 ? (n / span) * 1000 : 0;
  }

  /** Mouse events with a pressure that really moves: at least 4 distinct values other than 0, 0.5 and 1. */
  mouseVaries(): boolean {
    const m = this.by.get('mouse');
    if (!m) return false;
    let n = 0;
    for (const v of m.distinct) if (v !== 0 && v !== 500 && v !== 1000) n++;
    return n >= 4;
  }

  /**
   * A pen that is really a mouse: pen strokes whose pressure never moves off 0.5 (or 1, or stays 0), or, when the
   * person says they are using a tablet, pointer type mouse with buttons only.
   */
  looksLikeMouse(expectTablet = false): MouseLike {
    const pen = this.by.get('pen');
    if (pen && pen.contact >= 8) {
      if (pen.zero >= pen.contact - 1) return 'zero';
      // the press itself may say 0; what it says while drawing is what counts
      const live = [...pen.distinct].filter((v) => v > 0);
      if (live.length <= 1 && (live[0] === 500 || live[0] === 1000)) return 'flat';
    }
    const mouse = this.by.get('mouse');
    if (expectTablet && !pen && mouse && mouse.contact >= 8) return 'mouse';
    return null;
  }
}

/** A pointer record with a position: a PointerEvent, a coalesced one, or a stand-in carrying the same fields. */
export type PenPointer = PointerLike & { clientX: number; clientY: number };

/** What a platform adds to the pen's own events (the iPad's native Pencil data). The desktop leaves it null. */
export interface PenExtras {
  /** The same record with the native side's roll and settled pressure merged in; the event itself when it knows nothing. */
  pointer(e: PenPointer): PenPointer;
  /** The platform's predicted points ahead of this event, or null to use the engine's own. */
  predicted(e: PenPointer): PenPointer[] | null;
}

/** The one place pen settings, saved devices, the arbiter and the device tracker live. */
export class PenRuntime {
  extras: PenExtras | null = null;
  settings: PenSettings = { ...DEFAULT_PEN_SETTINGS, curve: DEFAULT_PEN_SETTINGS.curve.map((p) => [...p] as CurvePoint) };
  profiles: Record<string, PenProfile> = {};
  readonly tracker = new DeviceTracker();
  readonly arbiter = new PenArbiter(() => this.settings);
  /** The curve the pen is using right now (device profile if one is saved, else the settings). */
  readonly curve = new PressureCurve();
  readonly smoother = new PressureSmoother();
  smoothing = 0.2;
  private io: StorageIo | null = null;
  private applied = '';
  private rev = 0;

  attachStorage(io: StorageIo): void {
    if (this.io) return;
    this.io = io;
    try {
      const raw = io.read();
      if (!raw) return;
      const o = JSON.parse(raw) as { settings?: Partial<PenSettings>; profiles?: Record<string, PenProfile>; learned?: string[] };
      this.settings = sanitize(o.settings);
      if (o.profiles && typeof o.profiles === 'object') for (const [k, v] of Object.entries(o.profiles)) if (v && Array.isArray(v.curve)) this.profiles[k] = v;
      for (const k of o.learned ?? []) this.tracker.learnedTilt.add(k);
      this.rev++;
    } catch { /* corrupt: defaults */ }
  }

  save(): void {
    this.rev++;
    try { this.io?.write(JSON.stringify({ v: 1, settings: this.settings, profiles: this.profiles, learned: [...this.tracker.learnedTilt] })); } catch { /* this session only */ }
  }

  update(patch: Partial<PenSettings>): void {
    this.settings = sanitize({ ...this.settings, ...patch });
    this.save();
  }

  /** Remember what this device is, so its key is steady next time. */
  noteDevice(): void {
    const t = this.tracker, s = t.stats('pen');
    if (s?.tilt && !t.learnedTilt.has(t.baseKey('pen'))) { t.learnedTilt.add(t.baseKey('pen')); this.save(); }
  }

  /** Change the curve, range or smoothing: a saved device profile takes it if there is one, else the shared settings. */
  edit(p: { curve?: CurvePoint[]; min?: number; max?: number; smoothing?: number }): void {
    const prof = this.profiles[this.tracker.key('pen')];
    if (!prof) { this.update(p); return; }
    if (p.curve) prof.curve = p.curve.map((q) => [...q] as CurvePoint);
    if (p.min !== undefined) prof.min = p.min;
    if (p.max !== undefined) prof.max = p.max;
    if (p.smoothing !== undefined) prof.smoothing = p.smoothing;
    this.save();
  }

  /** Save the settings now in force as this device's own. */
  saveProfile(key: string, label: string): void {
    const c = this.effective();
    this.profiles[key] = { label, curve: c.points.map((p) => [...p] as CurvePoint), min: c.min, max: c.max, smoothing: this.smoothing };
    this.save();
  }

  forgetProfile(key: string): void {
    delete this.profiles[key];
    this.save();
  }

  /** The curve, min, max and smoothing for the pen in use; rebuilt only when the device or settings changed. */
  effective(): PressureCurve {
    const key = this.tracker.key('pen');
    const stamp = `${key}|${this.rev}`;
    if (stamp !== this.applied) {
      this.applied = stamp;
      const p = this.profiles[key];
      const src = p ?? this.settings;
      this.curve.set(src.curve, src.min, src.max);
      this.smoothing = src.smoothing;
    }
    return this.curve;
  }
}

function num(v: unknown, d: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
}

const ACTIONS: BarrelAction[] = ['eyedropper', 'menu', 'undo', 'pan', 'cycle', 'none'];

function sanitize(o?: Partial<PenSettings>): PenSettings {
  const d = DEFAULT_PEN_SETTINGS;
  const curve = Array.isArray(o?.curve) && o.curve.length >= 2 && o.curve.every((p) => Array.isArray(p) && p.length === 2) ? o.curve.map((p) => [num(p[0], 0, 0, 1), num(p[1], 0, 0, 1)] as CurvePoint) : d.curve.map((p) => [...p] as CurvePoint);
  return {
    curve,
    min: num(o?.min, d.min, 0, 0.5),
    max: num(o?.max, d.max, 0.5, 1),
    smoothing: num(o?.smoothing, d.smoothing, 0, 1),
    tiltAngle: typeof o?.tiltAngle === 'boolean' ? o.tiltAngle : d.tiltAngle,
    eraserEnd: o?.eraserEnd === 'erase' || o?.eraserEnd === 'off' ? o.eraserEnd : undefined,
    barrel1: o?.barrel1 && ACTIONS.includes(o.barrel1) ? o.barrel1 : undefined,
    barrel2: o?.barrel2 && ACTIONS.includes(o.barrel2) ? o.barrel2 : d.barrel2,
    palm: typeof o?.palm === 'boolean' ? o.palm : d.palm,
    palmWidth: num(o?.palmWidth, d.palmWidth, 20, 200),
    mousePressure: typeof o?.mousePressure === 'boolean' ? o.mousePressure : d.mousePressure,
  };
}

export const penRuntime = new PenRuntime();
