// The page's side of the Apple Pencil bridge. Runs only when the shell says it is an iPad; on the desktop this module
// does nothing at all (no listener, no timer, penRuntime.extras stays null).
//
// Native to page (platform.bridge): `pencil` (a batch per frame: flat number arrays), `pencilClock`, `pencilPrefs`,
// `squeeze`, `doubleTap`, `hoverPose`. Page to native: `pencilClockPing`, `pencilPrefsRequest`, `haptic`.
//
// What the web pointer events already give us (position, pressure, tilt, coalesced and predicted points) stays the
// source of every stroke. This module only adds what the web view lacks, matched by timestamp:
//   - barrel roll (Pencil Pro) as `twist`
//   - the settled force when an estimate was corrected after the event was sent
//   - the system's own predicted touches, used in place of the engine's when they are fresh
// plus the squeeze and double tap, mapped to the paint commands by the person's choice in Settings.

import { penRuntime, type PenPointer } from '../paint/pen-device';
import { platform } from './index';

export type PencilAction = 'system' | 'color' | 'eraser' | 'undo' | 'toggle' | 'off';
/** What the Draw & Paint view is asked to do (the system's own choices add 'previous' and 'brush'). */
export type PencilCommand = 'color' | 'eraser' | 'undo' | 'toggle' | 'previous' | 'brush';

export interface PencilPrefs {
  squeeze: PencilAction;
  tap: PencilAction;
  /** Show the brush outline while the Pencil hovers. */
  hoverPreview: boolean;
}

/** The person's Pencil choices from Settings > Apple Pencil, as the shell last reported them. */
export interface SystemPencil { tap: string; squeeze: string; pencilOnly: boolean; hoverPreview: boolean }

const KEY = 'formmorpheus.pencil';
const ACTIONS: PencilAction[] = ['system', 'color', 'eraser', 'undo', 'toggle', 'off'];
const DEFAULTS: PencilPrefs = { squeeze: 'system', tap: 'system', hoverPreview: true };

function sane(o: Partial<PencilPrefs> | null | undefined): PencilPrefs {
  return {
    squeeze: o?.squeeze && ACTIONS.includes(o.squeeze) ? o.squeeze : DEFAULTS.squeeze,
    tap: o?.tap && ACTIONS.includes(o.tap) ? o.tap : DEFAULTS.tap,
    hoverPreview: typeof o?.hoverPreview === 'boolean' ? o.hoverPreview : DEFAULTS.hoverPreview,
  };
}

function load(): PencilPrefs {
  try { return sane(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PencilPrefs>); } catch { return { ...DEFAULTS }; }
}

let prefs: PencilPrefs = load();
let system: SystemPencil | null = null;
const listeners = new Set<() => void>();

export const isIpadPencil = (): boolean => platform.kind === 'ipad';
export const pencilPrefs = (): PencilPrefs => prefs;
export const systemPencil = (): SystemPencil | null => system;
export function onPencilChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function setPencilPrefs(p: Partial<PencilPrefs>): void {
  prefs = sane({ ...prefs, ...p });
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* this session only */ }
  for (const fn of Array.from(listeners)) fn();
}

/** True when Settings turned the hover brush outline off (only ever true on the iPad). */
export const hoverPreviewOff = (): boolean => platform.kind === 'ipad' && !prefs.hoverPreview;

// ---------------------------------------------------------------- the clock

// UITouch timestamps count from system start; event.timeStamp counts from the page's time origin. The page sends a
// ping, the shell answers with its uptime, and the midpoint of the round trip gives the offset. The reply with the
// shortest round trip wins; the best value ages so a slow drift is followed.
const clock = { offset: 0, rtt: Infinity, ready: false, id: 0, sent: new Map<number, number>() };

function ping(): void {
  const id = ++clock.id;
  clock.sent.set(id, performance.now());
  if (clock.sent.size > 16) clock.sent.delete(clock.sent.keys().next().value as number);
  platform.bridge.post('pencilClockPing', { id });
}

function onClock(p: Record<string, unknown>): void {
  const id = Number(p.id), up = Number(p.up);
  const t0 = clock.sent.get(id);
  clock.sent.delete(id);
  if (t0 === undefined || !Number.isFinite(up)) return;
  const t1 = performance.now(), rtt = t1 - t0;
  clock.rtt *= 1.1;
  if (rtt <= clock.rtt) { clock.rtt = rtt; clock.offset = (t0 + t1) / 2 - up; clock.ready = true; }
}

// ---------------------------------------------------------------- native samples

interface Rec {
  /** Touch ordinal. */
  id: number;
  /** Page time, ms. */
  t: number;
  /** Position in the web view, points. */
  x: number;
  y: number;
  /** Force over maximum force. */
  force: number;
  /** Radians. */
  roll: number;
  /** An update replaced the estimate. */
  upd: boolean;
  idx: number;
}

const SAMPLE = 12, UPDATE = 7, RING_MAX = 768, RING_CUT = 256;
const ring: Rec[] = [];
const byIdx = new Map<number, Rec>();
let predicted: Rec[] = [];
let lastNativeAt = -1e9;
// native position + cal = page position; learned from matched pairs (the web view may sit inside insets)
const cal = { x: 0, y: 0, n: 0 };

function rec(s: number[], i: number): Rec {
  return { id: s[i], t: s[i + 2] + clock.offset, x: s[i + 3], y: s[i + 4], force: s[i + 5], roll: s[i + 8], upd: false, idx: s[i + 11] };
}

function nums(v: unknown): number[] { return Array.isArray(v) ? (v as number[]) : []; }

function onPencil(p: Record<string, unknown>): void {
  lastNativeAt = performance.now();
  const s = nums(p.s), u = nums(p.u);
  for (let i = 0; i + SAMPLE <= s.length; i += SAMPLE) {
    const r = rec(s, i);
    ring.push(r);
    if (r.idx >= 0) byIdx.set(r.idx, r);
  }
  if (ring.length > RING_MAX) {
    for (const r of ring.splice(0, RING_CUT)) if (r.idx >= 0 && byIdx.get(r.idx) === r) byIdx.delete(r.idx);
  }
  for (let i = 0; i + UPDATE <= u.length; i += UPDATE) {
    const r = byIdx.get(u[i]);
    if (!r) continue;
    r.force = u[i + 2];
    r.roll = u[i + 5];
    r.upd = true;
  }
  if (p.p !== undefined) {
    const q = nums(p.p), out: Rec[] = [];
    for (let i = 0; i + SAMPLE <= q.length; i += SAMPLE) out.push(rec(q, i));
    predicted = out;
  }
}

/** The native sample that belongs to a web event: nearest in time, and in place once the offset is known. */
function nearest(e: PenPointer): Rec | null {
  let best: Rec | null = null, bestCost = Infinity;
  const t = e.timeStamp, placed = cal.n >= 4;
  for (let i = ring.length - 1; i >= 0; i--) {
    const r = ring[i];
    if (r.t < t - 40) break;
    const dt = Math.abs(r.t - t);
    if (dt > 15) continue;
    const cost = dt + (placed ? 0.5 * Math.hypot(r.x + cal.x - e.clientX, r.y + cal.y - e.clientY) : 0);
    if (cost < bestCost) { best = r; bestCost = cost; }
  }
  if (!best || bestCost > (placed ? 12 : 8)) return null;
  if (Math.abs(best.t - t) < 6) {
    const dx = e.clientX - best.x, dy = e.clientY - best.y;
    if (cal.n === 0) { cal.x = dx; cal.y = dy; } else { cal.x += (dx - cal.x) * 0.1; cal.y += (dy - cal.y) * 0.1; }
    cal.n = Math.min(cal.n + 1, 1000);
  }
  return best;
}

const degrees = (rad: number): number => (((rad * 180) / Math.PI) % 360 + 360) % 360;

function copy(e: PenPointer, over: Partial<PenPointer>): PenPointer {
  return {
    pointerType: e.pointerType, pressure: e.pressure, tangentialPressure: e.tangentialPressure, tiltX: e.tiltX, tiltY: e.tiltY,
    twist: e.twist, altitudeAngle: e.altitudeAngle, azimuthAngle: e.azimuthAngle, width: e.width, height: e.height,
    button: e.button, buttons: e.buttons, timeStamp: e.timeStamp, isTrusted: e.isTrusted, persistentDeviceId: e.persistentDeviceId,
    clientX: e.clientX, clientY: e.clientY, ...over,
  };
}

function pointer(e: PenPointer): PenPointer {
  if (e.pointerType !== 'pen' || !clock.ready || !ring.length) return e;
  const r = nearest(e);
  // The batch for a frame can reach the page a little after the web event it describes. Roll turns slowly, so an event
  // with no match of its own takes the latest roll the shell sent (if it is recent).
  const stale = performance.now() - lastNativeAt > 100;
  const rollRad = r ? r.roll : stale ? 0 : ring[ring.length - 1].roll;
  const roll = degrees(rollRad);
  // a corrected force replaces the estimate that was current when the event went out
  const pressure = r && r.upd && r.force > 0 && e.buttons !== 0 ? r.force : e.pressure;
  if (pressure === e.pressure && (e.twist || !roll)) return e;
  return copy(e, { pressure, twist: e.twist || roll });
}

function predictedFor(e: PenPointer): PenPointer[] | null {
  if (e.pointerType !== 'pen' || !clock.ready) return null;
  if (performance.now() - lastNativeAt > 120) return null;
  // a batch can land a frame after the event it belongs to: only points still ahead of this event are of use
  const ahead = predicted.filter((r) => r.t > e.timeStamp - 1);
  if (!ahead.length) return null;
  return ahead.map((r) => copy(e, { clientX: r.x + cal.x, clientY: r.y + cal.y, timeStamp: r.t, twist: e.twist || degrees(r.roll), isTrusted: true }));
}

// ---------------------------------------------------------------- hover, squeeze, double tap

let hoverRoll = 0;
let hoverAt = -1e9;

/** Barrel roll of the hovering Pencil in degrees, 0 when it is not hovering (only ever non-zero on the iPad). */
export function pencilRoll(): number {
  if (platform.kind !== 'ipad') return 0;
  return performance.now() - hoverAt < 200 ? hoverRoll : 0;
}

function resolve(kind: 'tap' | 'squeeze'): PencilCommand | null {
  const p = prefs[kind];
  if (p === 'off') return null;
  if (p !== 'system') return p;
  switch (system?.[kind] ?? (kind === 'tap' ? 'switchEraser' : 'showContextualPalette')) {
    case 'switchEraser': return 'toggle';
    case 'switchPrevious': return 'previous';
    case 'showColorPalette':
    case 'showContextualPalette': return 'color';
    case 'showInkAttributes': return 'brush';
    default: return null;
  }
}

let lastAct = -1e9;

/** Runs the chosen command: Draw & Paint listens for this event. */
export function runPencilCommand(command: PencilCommand): void {
  document.dispatchEvent(new CustomEvent('fm:pencil-action', { detail: { action: command } }));
}

function act(kind: 'tap' | 'squeeze'): void {
  const now = performance.now();
  if (now - lastAct < 250) return;
  const c = resolve(kind);
  if (!c) return;
  lastAct = now;
  runPencilCommand(c);
}

let lastHaptic = -1e9;

/** A canvas haptic on a Pencil Pro (an alignment or a finished shape); nothing happens on other hardware. */
export function pencilHaptic(kind: 'alignment' | 'pathCompleted'): void {
  if (platform.kind !== 'ipad') return;
  const now = performance.now();
  if (now - lastHaptic < 40) return;
  lastHaptic = now;
  platform.bridge.post('haptic', { kind });
}

// ---------------------------------------------------------------- install

/** Takes one native message (used by the bridge listeners below and by the platform dispatcher if it routes by type). */
export function pencilReceive(type: string, p: Record<string, unknown>): void {
  switch (type) {
    case 'pencil': onPencil(p); break;
    case 'pencilClock': onClock(p); break;
    case 'pencilPrefs':
      system = { tap: String(p.tap ?? ''), squeeze: String(p.squeeze ?? ''), pencilOnly: p.pencilOnly === true, hoverPreview: p.hoverPreview !== false };
      for (const fn of Array.from(listeners)) fn();
      break;
    case 'squeeze': if (p.phase === 'ended') act('squeeze'); break;
    case 'doubleTap': act('tap'); break;
    case 'hoverPose':
      if (p.pencil === false) break;
      hoverRoll = degrees(Number(p.roll) || 0);
      hoverAt = performance.now();
      break;
    default: break;
  }
}

let installed = false;

function install(): void {
  if (installed || platform.kind !== 'ipad') return;
  installed = true;
  penRuntime.extras = { pointer, predicted: predictedFor };
  for (const type of ['pencil', 'pencilClock', 'pencilPrefs', 'squeeze', 'doubleTap', 'hoverPose']) {
    platform.bridge.on(type, (p) => pencilReceive(type, p));
  }
  // a short burst to find the best round trip, then one a quarter minute while the page is showing
  for (let i = 0; i < 8; i++) window.setTimeout(ping, 150 * i);
  window.setInterval(() => { if (document.visibilityState === 'visible') ping(); }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    platform.bridge.post('pencilPrefsRequest');
    for (let i = 0; i < 3; i++) window.setTimeout(ping, 100 * i);
  });
  platform.bridge.post('pencilPrefsRequest');
}

install();
