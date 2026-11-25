// Starter actions, written as data at 24 fps over the part names head, body, arm-l, arm-r, leg-l and leg-r, and the
// character builder's own versions over its parts (hip, forearms, shins, eyes, brows, hair-sway, shadow, mouth).
// Values follow ActionDef: px and degrees added to each part's rest, scale multiplied. Pure, no DOM.
import type { Viseme } from '../media/lipsync';
import { easeCurve, evalChannel } from './keys';
import type { ActionDef, Ease, Key, KeyLane } from './types';

type Pt = [frame: number, value: number, ease?: Ease];

const INOUT = easeCurve('inout');

/** Keys as written; the ease leaves each key. */
function seq(pts: Pt[]): Key[] {
  return pts.map(([frame, value, ease]) => ({ frame, value, ease: ease ?? 'inout' }));
}

/**
 * A loop of `len` frames through cyclic extremes, shifted later by `lag` (follow-through). The span that crosses the
 * loop's end is split there at its eased value, leaving slowly and arriving fast, so the first and last key are equal.
 * The lane is then shifted so frame 0 is `rest`: placed later on the Timeline, it starts from the pose before it.
 */
function cyc(len: number, pts: Array<[number, number]>, lag = 0, rest = 0): Key[] {
  const at = pts.map(([f, v]) => [((f + lag) % len + len) % len, v] as [number, number]).sort((a, b) => a[0] - b[0]);
  return anchor(cycle(len, at), rest);
}

function cycle(len: number, at: Array<[number, number]>): Key[] {
  if (at[0][0] === 0) return seq([...at, [len, at[0][1]]]);
  const last = at[at.length - 1], first = at[0];
  const u = (len - last[0]) / (first[0] + len - last[0]);
  const edge = last[1] + (first[1] - last[1]) * INOUT(u);
  const mid: Pt[] = at.map(([f, v], i) => [f, v, i === at.length - 1 ? 'out' : 'inout']);
  return seq([[0, edge, 'in'], ...mid, [len, edge]]);
}

function anchor(keys: Key[], rest: number): Key[] {
  const d = rest - keys[0].value;
  return d ? keys.map((k) => ({ ...k, value: k.value + d })) : keys;
}

function move(channels: Record<string, Key[]>): KeyLane {
  return { kind: 'move', expanded: false, channels, options: { path: false } };
}

const part = (name: string, channels: Record<string, Key[]>): ActionDef['lanes'][number] => ({ part: name, keys: [move(channels)] });

const neg = (keys: Key[]): Key[] => keys.map((k) => ({ ...k, value: k.value === 0 ? 0 : -k.value }));

const IDLE = 48;
const WALK = 24;

const walkBody: Array<[number, number]> = [[2, 5], [8, -4], [14, 5], [20, -4]];
const walkArm: Key[] = cyc(WALK, [[6, -5], [18, 5]], 2);
const jumpArm: Key[] = seq([[0, 0], [6, -12], [11, 40], [16, 25], [21, -8], [26, 3], [30, 0]]);
const jumpArmY: Key[] = seq([[0, 0], [6, 32, 'in'], [14, -124, 'out'], [21, 32], [27, -4], [30, 0]]);
const jumpLegY: Key[] = seq([[0, 0], [6, 24.08, 'in'], [14, -120, 'out'], [21, 20.64], [26, 0], [30, 0]]);
const jumpLegS: Key[] = seq([[0, 1], [6, 0.93, 'in'], [10, 1.02], [14, 0.96], [18, 1], [21, 0.94], [26, 1], [30, 1]]);
const sitArm: Key[] = seq([[0, 0], [8, 6], [22, 12], [30, 10]]);
const sitArmY: Key[] = seq([[0, 0], [5, -4], [21, 164], [25, 149], [30, 150]]);
const sitLegY: Key[] = seq([[0, 0], [4, 0], [20, 154.8], [24, 151.36], [30, 154.8]]);
const sitLegS: Key[] = seq([[0, 1], [4, 1], [20, 0.55], [24, 0.56], [30, 0.55]]);

// ---- The character builder's own animations, as its studio wrote them -------------------------------------------
// Times are fractions of one pass of `dur` seconds; r in degrees (clockwise on screen, as here); x and y in rig pixels at
// body height 1; sx and sy scale. A key's letter is the ease leaving it (s, o, i, l). L is the Stage's left.

type SEase = 's' | 'o' | 'i' | 'l';
type SKey = [t: number, v: number, e?: SEase];
type STrack = Partial<Record<'r' | 'x' | 'y' | 'sx' | 'sy', SKey[]>>;
interface SAnim { dur: number; tracks: Record<string, STrack> }

const blink = (at: number): SKey[] => [[0, 1], [at - 0.03, 1], [at, 0.08], [at + 0.03, 1], [1, 1]];

const S_IDLE: SAnim = { dur: 3.2, tracks: {
  hip: { y: [[0, 0], [0.5, 1.6], [1, 0]] }, torso: { r: [[0, -0.7], [0.5, 0.7], [1, -0.7]] }, head: { r: [[0, 1], [0.5, -1.4], [1, 1]] },
  arm_L_upper: { r: [[0, 0], [0.5, 2.2], [1, 0]] }, arm_R_upper: { r: [[0, 0], [0.5, -2.2], [1, 0]] }, eyes: { sy: blink(0.46) },
  hairSway: { r: [[0, 1.6], [0.5, -1.6], [1, 1.6]] },
} };

const S_WALK: SAnim = { dur: 1, tracks: {
  hip: { y: [[0, 0], [0.25, -5], [0.5, 0], [0.75, -5], [1, 0]], x: [[0, 0], [0.25, 3], [0.5, 0], [0.75, -3], [1, 0]] },
  torso: { r: [[0, 0], [0.25, 2.2], [0.5, 0], [0.75, -2.2], [1, 0]] },
  head: { r: [[0, 0], [0.25, -1.6], [0.5, 0], [0.75, 1.6], [1, 0]] }, hairSway: { r: [[0, 0], [0.25, -5], [0.5, 0], [0.75, 5], [1, 0]] },
  thigh_L: { sy: [[0, 1], [0.25, 0.72], [0.5, 1], [1, 1]], r: [[0, 0], [0.25, 4], [0.5, 0], [1, 0]] }, shin_L: { sy: [[0, 1], [0.25, 0.82], [0.5, 1], [1, 1]] },
  thigh_R: { sy: [[0, 1], [0.5, 1], [0.75, 0.72], [1, 1]], r: [[0, 0], [0.5, 0], [0.75, -4], [1, 0]] }, shin_R: { sy: [[0, 1], [0.5, 1], [0.75, 0.82], [1, 1]] },
  arm_L_upper: { r: [[0, 0], [0.25, 3], [0.5, 0], [0.75, -4], [1, 0]] }, arm_R_upper: { r: [[0, 0], [0.25, 4], [0.5, 0], [0.75, -3], [1, 0]] },
  arm_R_fore: { sy: [[0, 1], [0.25, 0.78], [0.5, 1], [1, 1]], r: [[0, 0], [0.25, 14], [0.5, 0], [1, 0]] },
  arm_L_fore: { sy: [[0, 1], [0.5, 1], [0.75, 0.78], [1, 1]], r: [[0, 0], [0.5, 0], [0.75, -14], [1, 0]] }, eyes: { sy: blink(0.6) },
} };

const S_RUN: SAnim = { dur: 0.56, tracks: {
  hip: { y: [[0, 0], [0.25, -11], [0.5, 0], [0.75, -11], [1, 0]], x: [[0, 0], [0.25, 4], [0.5, 0], [0.75, -4], [1, 0]] },
  torso: { r: [[0, 0], [0.25, 3.6], [0.5, 0], [0.75, -3.6], [1, 0]] },
  head: { r: [[0, 0], [0.25, -2.4], [0.5, 0], [0.75, 2.4], [1, 0]] }, hairSway: { r: [[0, 0], [0.25, -9], [0.5, 0], [0.75, 9], [1, 0]] },
  thigh_L: { sy: [[0, 1], [0.25, 0.58], [0.5, 1], [1, 1]], r: [[0, 0], [0.25, 6], [0.5, 0], [1, 0]] }, shin_L: { sy: [[0, 1], [0.25, 0.7], [0.5, 1], [1, 1]] },
  thigh_R: { sy: [[0, 1], [0.5, 1], [0.75, 0.58], [1, 1]], r: [[0, 0], [0.5, 0], [0.75, -6], [1, 0]] }, shin_R: { sy: [[0, 1], [0.5, 1], [0.75, 0.7], [1, 1]] },
  arm_L_upper: { r: [[0, 8], [0.25, 14], [0.5, 8], [0.75, 2], [1, 8]] }, arm_R_upper: { r: [[0, -8], [0.25, -2], [0.5, -8], [0.75, -14], [1, -8]] },
  arm_L_fore: { r: [[0, -50], [0.25, -30], [0.5, -50], [0.75, -78], [1, -50]], sy: [[0, 0.8], [0.25, 0.95], [0.5, 0.8], [0.75, 0.6], [1, 0.8]] },
  arm_R_fore: { r: [[0, 50], [0.25, 78], [0.5, 50], [0.75, 30], [1, 50]], sy: [[0, 0.8], [0.25, 0.6], [0.5, 0.8], [0.75, 0.95], [1, 0.8]] },
  mouthO: { sy: [[0, 0.5], [1, 0.5]] },
} };

const S_WAVE: SAnim = { dur: 2.2, tracks: {
  arm_R_upper: { r: [[0, 0], [0.16, -128], [0.84, -128], [1, 0]] },
  arm_R_fore: { r: [[0, 0], [0.16, -30], [0.3, -58], [0.44, -14], [0.58, -58], [0.72, -14], [0.84, -30], [1, 0]] },
  hand_R: { r: [[0, 0], [0.3, -14], [0.44, 14], [0.58, -14], [0.72, 14], [1, 0]] }, head: { r: [[0, 0], [0.16, 4.5], [0.84, 4.5], [1, 0]] },
  torso: { r: [[0, 0], [0.16, -1.8], [0.84, -1.8], [1, 0]] },
  mouthO: { sy: [[0, 0], [0.16, 0.9], [0.84, 0.9], [1, 0]] }, brows: { y: [[0, 0], [0.16, -3], [0.84, -3], [1, 0]] }, eyes: { sy: blink(0.5) },
  hairSway: { r: [[0, 0], [0.16, -3], [0.5, 2], [0.84, -3], [1, 0]] }, arm_L_upper: { r: [[0, 0], [0.5, 2], [1, 0]] },
} };

const S_JUMP: SAnim = { dur: 1.3, tracks: {
  hip: { y: [[0, 0], [0.22, 16, 'o'], [0.5, -84, 'i'], [0.76, 14], [1, 0]] },
  thigh_L: { sy: [[0, 1], [0.22, 0.905, 'o'], [0.36, 1.03], [0.5, 0.9], [0.68, 1, 'i'], [0.76, 0.915], [1, 1]] },
  thigh_R: { sy: [[0, 1], [0.22, 0.905, 'o'], [0.36, 1.03], [0.5, 0.9], [0.68, 1, 'i'], [0.76, 0.915], [1, 1]] },
  arm_L_upper: { r: [[0, 0], [0.22, -14, 'o'], [0.5, 152], [0.76, 24], [1, 0]] }, arm_R_upper: { r: [[0, 0], [0.22, 14, 'o'], [0.5, -152], [0.76, -24], [1, 0]] },
  arm_L_fore: { r: [[0, 0], [0.22, -20], [0.5, 12], [0.76, -16], [1, 0]] }, arm_R_fore: { r: [[0, 0], [0.22, 20], [0.5, -12], [0.76, 16], [1, 0]] },
  torso: { r: [[0, 0], [1, 0]] }, head: { r: [[0, 0], [0.22, 3], [0.5, -4], [0.76, 3], [1, 0]] },
  hairSway: { r: [[0, 0], [0.3, 4], [0.55, -7], [0.8, 6], [1, 0]] },
  shadow: { sx: [[0, 1], [0.22, 1.06, 'o'], [0.5, 0.62, 'i'], [0.76, 1.06], [1, 1]] }, mouthO: { sy: [[0, 0], [0.3, 0.2], [0.5, 1], [0.76, 0.3], [1, 0]] },
  brows: { y: [[0, 0], [0.5, -4], [1, 0]] },
} };

const S_DANCE: SAnim = { dur: 1.6, tracks: {
  hip: { x: [[0, -9], [0.5, 9], [1, -9]], y: [[0, 0], [0.25, 6], [0.5, 0], [0.75, 6], [1, 0]] },
  thigh_L: { r: [[0, -3], [0.5, 3], [1, -3]], sy: [[0, 1], [0.25, 0.965], [0.5, 1], [0.75, 0.965], [1, 1]] },
  thigh_R: { r: [[0, -3], [0.5, 3], [1, -3]], sy: [[0, 1], [0.25, 0.965], [0.5, 1], [0.75, 0.965], [1, 1]] },
  torso: { r: [[0, 5], [0.5, -5], [1, 5]] }, head: { r: [[0, -6], [0.5, 6], [1, -6]] }, hairSway: { r: [[0, 7], [0.5, -7], [1, 7]] },
  arm_L_upper: { r: [[0, 104], [0.25, 82], [0.5, 104], [0.75, 82], [1, 104]] }, arm_L_fore: { r: [[0, 62], [0.25, 88], [0.5, 62], [0.75, 88], [1, 62]] },
  arm_R_upper: { r: [[0, -82], [0.25, -104], [0.5, -82], [0.75, -104], [1, -82]] }, arm_R_fore: { r: [[0, -88], [0.25, -62], [0.5, -88], [0.75, -62], [1, -88]] },
  mouthO: { sy: [[0, 0.7], [1, 0.7]] }, eyes: { sy: blink(0.3) },
} };

const S_TALK: SAnim = { dur: 2.4, tracks: {
  mouthO: { sy: [[0, 0], [0.08, 0.9], [0.16, 0.3], [0.24, 1], [0.33, 0.2], [0.42, 0.8], [0.5, 0], [0.58, 0.7], [0.66, 0.3], [0.75, 1], [0.85, 0.4], [0.92, 0.7], [1, 0]] },
  head: { r: [[0, 0], [0.25, 2.6], [0.5, -1.2], [0.75, 2.2], [1, 0]] }, brows: { y: [[0, 0], [0.24, -3.5], [0.5, 0], [0.75, -3.5], [1, 0]] },
  arm_R_upper: { r: [[0, 0], [0.2, -26], [0.5, -18], [0.8, -30], [1, 0]] }, arm_R_fore: { r: [[0, 0], [0.2, -96], [0.5, -80], [0.8, -102], [1, 0]] },
  hand_R: { r: [[0, 0], [0.2, -20], [0.5, 10], [0.8, -20], [1, 0]] },
  torso: { r: [[0, 0], [0.5, -1], [1, 0]] }, eyes: { sy: blink(0.62) }, hairSway: { r: [[0, 0], [0.25, -2], [0.75, 2], [1, 0]] },
} };

const S_CHEER: SAnim = { dur: 1.1, tracks: {
  hip: { y: [[0, 0], [0.2, 10, 'o'], [0.5, -34, 'i'], [0.8, 8], [1, 0]] },
  thigh_L: { sy: [[0, 1], [0.2, 0.94, 'o'], [0.5, 0.94], [0.72, 1, 'i'], [0.8, 0.955], [1, 1]] },
  thigh_R: { sy: [[0, 1], [0.2, 0.94, 'o'], [0.5, 0.94], [0.72, 1, 'i'], [0.8, 0.955], [1, 1]] },
  arm_L_upper: { r: [[0, 146], [0.5, 164], [1, 146]] }, arm_R_upper: { r: [[0, -146], [0.5, -164], [1, -146]] },
  arm_L_fore: { r: [[0, 14], [0.5, -12], [1, 14]] }, arm_R_fore: { r: [[0, -14], [0.5, 12], [1, -14]] },
  head: { r: [[0, -3], [0.5, 3], [1, -3]] }, hairSway: { r: [[0, 0], [0.3, 5], [0.6, -7], [1, 0]] }, mouthO: { sy: [[0, 0.9], [0.5, 1.1], [1, 0.9]] },
  brows: { y: [[0, -3], [1, -3]] }, shadow: { sx: [[0, 1], [0.2, 1.04], [0.5, 0.8], [0.8, 1.04], [1, 1]] },
} };

/** Studio bone to part: its L (the Stage's left, the character's own right) is our -r. */
const S_PART: Record<string, string> = {
  hip: 'hip', torso: 'body', head: 'head', eyes: 'eyes', brows: 'brows', hairSway: 'hair-sway', shadow: 'shadow',
  thigh_L: 'leg-r', thigh_R: 'leg-l', shin_L: 'shin-r', shin_R: 'shin-l', foot_L: 'foot-r', foot_R: 'foot-l',
  arm_L_upper: 'arm-r', arm_R_upper: 'arm-l', arm_L_fore: 'forearm-r', arm_R_fore: 'forearm-l', hand_L: 'hand-r', hand_R: 'hand-l',
};
const S_CHAN = { r: 'rotation', x: 'x', y: 'y', sx: 'scaleX', sy: 'scaleY' } as const;
/** Rig pixels at body height 1 to action pixels: the studio's leg from hip to sole is 173 of them (80 + 78 + 15), ours REF_LEG 344. */
const RIG_PX = 344 / 173;
const S_FPS = 24;

function sEase(e: SEase | undefined): Pick<Key, 'ease' | 'out' | 'in'> {
  if (e === 'l') return { ease: 'linear' };
  if (e === 'o') return { ease: 'custom', out: [0.25, 0.46], in: [0.45, 0.94] };
  if (e === 'i') return { ease: 'custom', out: [0.55, 0.06], in: [0.68, 0.53] };
  return { ease: 'inout' };
}

/** Fractions to frames of a `len` pass; keys that round onto one frame are spread one apart, the last stays at its own. */
function sFrames(keys: SKey[], len: number): number[] {
  const at = keys.map(([t]) => Math.round(t * len));
  for (let i = 1; i < at.length; i++) if (at[i] <= at[i - 1]) at[i] = at[i - 1] + 1;
  at[at.length - 1] = Math.round(keys[keys.length - 1][0] * len);
  for (let i = at.length - 2; i >= 0; i--) if (at[i] >= at[i + 1]) at[i] = at[i + 1] - 1;
  return at;
}

function sKeys(keys: SKey[], len: number, k: number, flip: boolean): Key[] {
  const at = sFrames(keys, len);
  return keys.map(([, v, e], i) => { const value = (flip ? -v : v) * k; return { frame: at[i], value: value === 0 ? 0 : value, ...sEase(e) }; });
}

/** Mouth openness to a shape: closed is Rest, wider openings take wider shapes. */
function shapeOf(open: number): Viseme {
  return open <= 0.05 ? 'rest' : open < 0.45 ? 'E' : open < 0.75 ? 'O' : 'AI';
}

/** The openness track read on twos (no shape flashes for a single frame) and held as shapes, one run per change. */
function sMouth(keys: SKey[], len: number): NonNullable<ActionDef['mouth']> {
  const k = sKeys(keys, len, 1, false), out: NonNullable<ActionDef['mouth']> = [];
  for (let f = 0; f <= len; f = f + 2 > len && f < len ? len : f + 2) {
    const shape = shapeOf(evalChannel(k, f) ?? 0);
    if (!out.length || out[out.length - 1].shape !== shape) out.push({ frame: f, shape });
  }
  return out;
}

/** A studio animation as an action; `mirror` plays it with the sides swapped (L and R names traded, r and x turned). */
function fromStudio(id: string, name: string, loop: boolean, a: SAnim, mirror = false): ActionDef {
  const length = Math.round(a.dur * S_FPS);
  const lanes: ActionDef['lanes'] = [];
  let mouth: ActionDef['mouth'];
  for (const bone in a.tracks) {
    const tr = a.tracks[bone];
    if (bone === 'mouthO') { if (tr.sy) mouth = sMouth(tr.sy, length); continue; }
    const to = S_PART[mirror ? bone.replace(/_([LR])(_|$)/, (_m, s: string, e: string) => `_${s === 'L' ? 'R' : 'L'}${e}`) : bone];
    if (!to) continue;
    const channels: Record<string, Key[]> = {};
    for (const c of ['r', 'x', 'y', 'sx', 'sy'] as const) {
      const keys = tr[c];
      if (keys) channels[S_CHAN[c]] = sKeys(keys, length, c === 'x' || c === 'y' ? RIG_PX : 1, mirror && (c === 'r' || c === 'x'));
    }
    lanes.push(part(to, channels));
  }
  return { id, name, length, loop, fps: S_FPS, lanes, ...(mouth ? { mouth } : {}) };
}

const FLAT_PARTS = ['body', 'head', 'arm-r', 'arm-l', 'leg-r', 'leg-l'];

/**
 * A studio action for a character of separate parts that follow nothing (no hip, forearm or shin): every part carries
 * the hip's travel itself, and the lanes for parts it cannot have are left out.
 */
function flat(a: ActionDef): ActionDef {
  const hip = a.lanes.find((l) => l.part === 'hip')?.keys[0].channels ?? {};
  const lanes = a.lanes.filter((l) => FLAT_PARTS.includes(l.part)).map((l) => part(l.part, { ...hip, ...l.keys[0].channels }));
  if (Object.keys(hip).length) for (const p of FLAT_PARTS) if (!lanes.some((l) => l.part === p)) lanes.push(part(p, { ...hip }));
  return { ...a, lanes };
}

/** On a character with the builder's parts (a hip, a forearm), these play in place of the starter of the same id. */
const RIG_ACTIONS: ReadonlyMap<string, ActionDef> = new Map([
  fromStudio('builtin:idle', 'Idle', true, S_IDLE),
  fromStudio('builtin:walk', 'Walk in place', true, S_WALK),
  fromStudio('builtin:run', 'Run', true, S_RUN),
  // our Wave Hello lifts arm-r; the studio waves with its R arm, so it plays mirrored
  fromStudio('builtin:wave', 'Wave Hello', false, S_WAVE, true),
  fromStudio('builtin:jump', 'Jump', false, S_JUMP),
  fromStudio('builtin:dance', 'Dance', true, S_DANCE),
  fromStudio('builtin:talk', 'Talk', true, S_TALK),
  fromStudio('builtin:cheer', 'Cheer', true, S_CHEER),
].map((a) => [a.id, a]));

const rigOf = (id: string): ActionDef => RIG_ACTIONS.get(id) as ActionDef;

/** The starter to play for `id` on a character with these parts: the builder's version when it has a hip and a forearm. */
export function builtinFor(def: ActionDef, parts: Readonly<Record<string, string>>): ActionDef {
  if (!parts.hip || !(parts['forearm-r'] || parts['forearm-l'])) return def;
  return RIG_ACTIONS.get(def.id) ?? def;
}

/** Built-in actions; ids start with `builtin:` so a saved span names one without copying it into the character. */
export const BUILTIN_ACTIONS: readonly ActionDef[] = [
  {
    id: 'builtin:idle', name: 'Idle', length: IDLE, loop: true, fps: 24,
    lanes: [
      part('body', { y: cyc(IDLE, [[0, 0], [24, -3]]), scaleY: cyc(IDLE, [[0, 1], [24, 1.015]], 0, 1) }),
      part('head', { y: cyc(IDLE, [[0, 0], [24, -5]], 3), rotation: cyc(IDLE, [[12, 1], [36, -1]], 4) }),
      part('arm-r', { y: cyc(IDLE, [[0, 0], [24, -3]], 2), rotation: cyc(IDLE, [[0, 0], [24, 1.5]], 5) }),
      part('arm-l', { y: cyc(IDLE, [[0, 0], [24, -3]], 2), rotation: cyc(IDLE, [[0, 0], [24, -1.5]], 5) }),
    ],
  },
  {
    id: 'builtin:nod', name: 'Nod', length: 26, loop: false, fps: 24,
    lanes: [
      part('head', {
        y: seq([[0, 0], [3, -3], [8, 14], [13, 1], [17, 10], [22, -1], [26, 0]]),
        scaleY: seq([[0, 1], [3, 1.01], [8, 0.95], [13, 1], [17, 0.97], [22, 1], [26, 1]]),
      }),
      part('body', { y: seq([[0, 0], [10, 2], [19, 1.5], [26, 0]]) }),
    ],
  },
  {
    id: 'builtin:shake', name: 'Shake head', length: 30, loop: false, fps: 24,
    lanes: [
      part('head', {
        x: seq([[0, 0], [4, -12], [10, 12], [16, -11], [22, 8], [27, -2], [30, 0]]),
        scaleX: seq([[0, 1], [4, 0.96], [7, 1], [10, 0.96], [13, 1], [16, 0.96], [19, 1], [22, 0.98], [25, 1], [30, 1]]),
        rotation: seq([[0, 0], [4, -1.5], [10, 1.5], [16, -1.5], [22, 1], [27, 0], [30, 0]]),
      }),
      part('body', { rotation: seq([[0, 0], [7, -0.6], [13, 0.6], [19, -0.5], [25, 0.3], [30, 0]]) }),
    ],
  },
  flat(rigOf('builtin:talk')),
  {
    id: 'builtin:wave', name: 'Wave Hello', length: 48, loop: false, fps: 24,
    lanes: [
      part('arm-r', { rotation: seq([[0, 0], [9, 158], [14, 128], [19, 158], [24, 128], [29, 158], [34, 132], [37, 140], [45, -4], [48, 0]]) }),
      part('head', { rotation: seq([[0, 0], [12, -4], [38, -4], [46, 0.5], [48, 0]]) }),
      part('body', { y: seq([[0, 0], [10, -2], [38, -2], [46, 1], [48, 0]]) }),
      part('arm-l', { y: seq([[0, 0], [11, -2], [39, -2], [47, 1], [48, 0]]) }),
    ],
  },
  {
    id: 'builtin:point', name: 'Point', length: 36, loop: false, fps: 24,
    lanes: [
      part('arm-l', { rotation: seq([[0, 0], [4, 8], [11, -96], [15, -88], [18, -91], [30, -90], [36, -90]]), y: seq([[0, 0], [5, 2], [12, -1], [17, 0], [36, 0]]) }),
      part('head', { rotation: seq([[0, 0], [6, 0], [14, 3], [36, 3]]), x: seq([[0, 0], [6, 0], [14, 4], [36, 4]]) }),
      part('body', { y: seq([[0, 0], [4, 2], [11, -1], [16, 0], [36, 0]]) }),
      part('arm-r', { y: seq([[0, 0], [5, 2], [12, -1], [17, 0], [36, 0]]) }),
    ],
  },
  {
    id: 'builtin:walk', name: 'Walk in place', length: WALK, loop: true, fps: 24,
    lanes: [
      part('leg-r', { y: seq([[0, 0], [6, -30, 'out'], [12, 0, 'linear'], [24, 0]]), rotation: seq([[0, 0], [6, 3, 'out'], [12, 0, 'linear'], [24, 0]]) }),
      part('leg-l', { y: seq([[0, 0, 'linear'], [12, 0], [18, -30, 'out'], [24, 0]]), rotation: seq([[0, 0, 'linear'], [12, 0], [18, -3, 'out'], [24, 0]]) }),
      part('body', { y: cyc(WALK, walkBody), rotation: cyc(WALK, [[6, 1.5], [18, -1.5]]) }),
      part('head', { y: cyc(WALK, walkBody, 2), rotation: cyc(WALK, [[9, -1.2], [21, 1.2]]) }),
      part('arm-r', { y: cyc(WALK, walkBody, 1), rotation: walkArm }),
      part('arm-l', { y: cyc(WALK, walkBody, 1), rotation: neg(walkArm) }),
    ],
  },
  flat(rigOf('builtin:run')),
  {
    id: 'builtin:jump', name: 'Jump', length: 30, loop: false, fps: 24,
    lanes: [
      part('body', {
        y: seq([[0, 0], [6, 22, 'in'], [14, -120, 'out'], [21, 20], [27, -3], [30, 0]]),
        scaleY: seq([[0, 1], [6, 0.95, 'in'], [10, 1.04], [14, 1, 'out'], [21, 0.95], [25, 1.01], [30, 1]]),
      }),
      part('head', { y: seq([[0, 0], [7, 42, 'in'], [15, -128, 'out'], [22, 40], [27, -6], [30, 0]]) }),
      part('arm-r', { y: jumpArmY, rotation: jumpArm }),
      part('arm-l', { y: jumpArmY, rotation: neg(jumpArm) }),
      part('leg-r', { y: jumpLegY, scaleY: jumpLegS }),
      part('leg-l', { y: jumpLegY, scaleY: jumpLegS }),
    ],
  },
  flat(rigOf('builtin:cheer')),
  flat(rigOf('builtin:dance')),
  {
    id: 'builtin:sit', name: 'Sit', length: 30, loop: false, fps: 24,
    lanes: [
      part('body', { y: seq([[0, 0], [4, -4], [20, 160], [24, 148], [30, 150]]) }),
      part('head', { y: seq([[0, 0], [6, -4], [22, 168], [26, 147], [30, 150]]) }),
      part('arm-r', { y: sitArmY, rotation: sitArm }),
      part('arm-l', { y: sitArmY, rotation: neg(sitArm) }),
      part('leg-r', { y: sitLegY, scaleY: sitLegS }),
      part('leg-l', { y: sitLegY, scaleY: sitLegS }),
    ],
  },
];
