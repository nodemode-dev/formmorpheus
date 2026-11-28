// Camera moves as a set: each writes camera keys from a frame for a length, with an ease that fits it. Pure, no DOM.
import { deleteCameraKey, poseAt, setCameraEase, setCameraKeys } from './camera';
import { OpError } from './ops';
import { CAMERA_REST, cameraLane, type CameraPose } from './transform';
import type { Ease, Movie } from './types';

export type CameraMoveId =
  | 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down'
  | 'push-selection' | 'whip-pan' | 'drift' | 'shake' | 'reset';

export const CAMERA_MOVE_IDS: ReadonlyArray<CameraMoveId> = [
  'push-in', 'pull-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'push-selection', 'whip-pan', 'drift', 'shake', 'reset',
];

/** A box in movie pixels, the camera left out. */
export interface WorldBox { x0: number; y0: number; x1: number; y1: number }

interface CamKey { frame: number; pose: CameraPose; ease: Ease }

const PUSH = 1.4;
const PAN = 0.12;
const MAX_ZOOM = 8;

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const tidy = (p: CameraPose): CameraPose => ({ panX: r2(p.panX), panY: r2(p.panY), zoom: r3(Math.max(0.05, Math.min(20, p.zoom))), rotation: Math.round(p.rotation * 10) / 10 });
const level = (p: CameraPose): boolean => Math.abs(p.rotation % 360) < 0.05;

/** The least zoom at which the frame stays inside the movie at this pan (level camera only); Infinity when none can. */
function leastZoom(m: Movie, panX: number, panY: number): number {
  const w = m.width - 2 * Math.abs(panX), h = m.height - 2 * Math.abs(panY);
  if (w <= 0 || h <= 0) return Infinity;
  return Math.max(m.width / w, m.height / h);
}

/** Raises the zoom just enough that no edge of the movie shows, when the camera is level, it can, and the move starts inside (`from`). */
function inside(m: Movie, p: CameraPose, from: CameraPose): CameraPose {
  if (!level(p) || leastZoom(m, from.panX, from.panY) > from.zoom + 0.001) return p;
  const z = leastZoom(m, p.panX, p.panY);
  return Number.isFinite(z) && z <= MAX_ZOOM && z > p.zoom ? { ...p, zoom: z } : p;
}

/** Keeps the pan where the frame stays inside the movie at this zoom (level camera only). */
function clampPan(m: Movie, p: CameraPose): CameraPose {
  if (!level(p) || p.zoom < 1) return p;
  const mx = m.width / 2 - m.width / (2 * p.zoom), my = m.height / 2 - m.height / (2 * p.zoom);
  return { ...p, panX: Math.max(-mx, Math.min(mx, p.panX)), panY: Math.max(-my, Math.min(my, p.panY)) };
}

/** A small repeatable sequence for the shake, seeded by the frame it starts on. */
function rand(seed: number): () => number {
  let s = (Math.floor(seed) * 2654435761 + 97) >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
}

/** The frames a move from `from` for `frames` covers, kept inside the movie; null when no frame follows. */
export function moveSpan(m: Movie, from: number, frames: number): { f0: number; f1: number } | null {
  const last = Math.max(0, m.duration - 1);
  const f0 = Math.max(0, Math.min(last, Math.round(from)));
  const f1 = Math.min(last, f0 + Math.max(1, Math.round(frames)));
  return f1 > f0 ? { f0, f1 } : null;
}

function plan(m: Movie, id: CameraMoveId, f0: number, f1: number, target: WorldBox | null): CamKey[] {
  const p0 = poseAt(m, f0);
  const vw = m.width / Math.max(0.01, p0.zoom), vh = m.height / Math.max(0.01, p0.zoom);
  const two = (end: CameraPose, ease: Ease, start: CameraPose = p0): CamKey[] => [{ frame: f0, pose: start, ease }, { frame: f1, pose: end, ease: 'linear' }];
  switch (id) {
    case 'push-in': return two({ ...p0, zoom: Math.min(MAX_ZOOM, p0.zoom * PUSH) }, 'inout');
    case 'pull-out': {
      const floor = level(p0) ? leastZoom(m, p0.panX, p0.panY) : 0;
      const z = Math.max(p0.zoom / PUSH, Number.isFinite(floor) ? floor : 0);
      if (z < p0.zoom * 0.97) return two({ ...p0, zoom: z }, 'inout');
      // no room to pull out without showing past the movie's edge: the move starts pushed in and pulls out to here
      return two(p0, 'inout', { ...p0, zoom: Math.min(MAX_ZOOM, p0.zoom * PUSH) });
    }
    case 'pan-left': return two(inside(m, { ...p0, panX: p0.panX - PAN * vw }, p0), 'inout');
    case 'pan-right': return two(inside(m, { ...p0, panX: p0.panX + PAN * vw }, p0), 'inout');
    case 'tilt-up': return two(inside(m, { ...p0, panY: p0.panY - PAN * vh }, p0), 'inout');
    case 'tilt-down': return two(inside(m, { ...p0, panY: p0.panY + PAN * vh }, p0), 'inout');
    case 'push-selection': {
      if (!target) throw new OpError('Select something to push in on.');
      const bw = Math.max(8, target.x1 - target.x0), bh = Math.max(8, target.y1 - target.y0);
      let zoom = Math.min(m.width / (bw * 1.5), m.height / (bh * 1.5));
      zoom = Math.max(level(p0) ? 1 : 0.25, Math.min(MAX_ZOOM, zoom));
      const end = clampPan(m, { ...p0, zoom, panX: (target.x0 + target.x1) / 2 - m.width / 2, panY: (target.y0 + target.y1) / 2 - m.height / 2 });
      return two(end, 'inout');
    }
    // the camera comes in fast from the side and settles on the framing it has here
    case 'whip-pan': return two(p0, 'in', { ...p0, panX: p0.panX - 0.6 * vw });
    case 'drift': return two(inside(m, { ...p0, panX: p0.panX + 0.04 * vw, panY: p0.panY - 0.015 * vh, zoom: p0.zoom * 1.05 }, p0), 'linear');
    case 'shake': {
      const amp = 0.022 * Math.min(vw, vh);
      const held = inside(m, { ...p0, panX: Math.abs(p0.panX) + amp, panY: Math.abs(p0.panY) + amp }, p0);
      const zoom = Math.max(p0.zoom, held.zoom);
      const next = rand(f0 + 1);
      const step = m.fps >= 20 ? 2 : 1;
      const keys: CamKey[] = [{ frame: f0, pose: p0, ease: 'inout' }];
      for (let f = f0 + step; f < f1; f += step) {
        const k = 1 - (f - f0) / (f1 - f0);
        keys.push({ frame: f, pose: { ...p0, zoom, panX: p0.panX + next() * amp * k, panY: p0.panY + next() * amp * k }, ease: 'inout' });
      }
      keys.push({ frame: f1, pose: p0, ease: 'linear' });
      return keys;
    }
    case 'reset': {
      const d = Math.abs(p0.panX) + Math.abs(p0.panY) + Math.abs(p0.zoom - 1) * 100 + Math.abs(p0.rotation);
      if (d < 0.05) throw new OpError('The camera is already at rest here.');
      return two({ ...CAMERA_REST }, 'inout');
    }
  }
}

/** Every frame inside (f0, f1] that holds a camera key. */
function framesWithin(m: Movie, f0: number, f1: number): number[] {
  const lane = cameraLane(m);
  if (!lane) return [];
  const out = new Set<number>();
  for (const id in lane.channels) for (const k of lane.channels[id]) if (k.frame > f0 && k.frame <= f1) out.add(k.frame);
  return [...out];
}

/**
 * Writes a camera move from `from` for `frames` movie frames. Camera keys already inside the move's stretch are
 * replaced; the key at the start takes the camera as it is there, so nothing before the move changes.
 */
export function applyCameraMove(m: Movie, id: CameraMoveId, from: number, frames: number, target: WorldBox | null = null): Movie {
  const span = moveSpan(m, from, frames);
  if (!span) throw new OpError('There is no room for a camera move after the Playhead.');
  const keys = plan(m, id, span.f0, span.f1, target);
  let out = m;
  for (const f of framesWithin(m, span.f0, span.f1)) out = deleteCameraKey(out, f);
  for (const k of keys) {
    out = setCameraKeys(out, k.frame, tidy(k.pose));
    out = setCameraEase(out, k.frame, k.ease);
  }
  return out;
}
