// Starter actions, written as data at 24 fps over the part names head, body, arm-l, arm-r, leg-l and leg-r.
// Values follow ActionDef: px and degrees added to each part's rest, scale multiplied. Pure, no DOM.
import { easeCurve } from './keys';
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
const jumpArm: Key[] = seq([[0, 0], [6, -12], [11, 40], [16, 25], [21, -8], [26, 3], [30, 0]]);
const jumpArmY: Key[] = seq([[0, 0], [6, 32, 'in'], [14, -124, 'out'], [21, 32], [27, -4], [30, 0]]);
const jumpLegY: Key[] = seq([[0, 0], [6, 24.08, 'in'], [14, -120, 'out'], [21, 20.64], [26, 0], [30, 0]]);
const jumpLegS: Key[] = seq([[0, 1], [6, 0.93, 'in'], [10, 1.02], [14, 0.96], [18, 1], [21, 0.94], [26, 1], [30, 1]]);
const sitArm: Key[] = seq([[0, 0], [8, 6], [22, 12], [30, 10]]);
const sitArmY: Key[] = seq([[0, 0], [5, -4], [21, 164], [25, 149], [30, 150]]);
const sitLegY: Key[] = seq([[0, 0], [4, 0], [20, 154.8], [24, 151.36], [30, 154.8]]);
const sitLegS: Key[] = seq([[0, 1], [4, 1], [20, 0.55], [24, 0.56], [30, 0.55]]);

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
  {
    id: 'builtin:wave', name: 'Wave', length: 48, loop: false, fps: 24,
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
      part('arm-r', { y: cyc(WALK, walkBody, 1), rotation: cyc(WALK, [[6, -5], [18, 5]], 2) }),
      part('arm-l', { y: cyc(WALK, walkBody, 1), rotation: cyc(WALK, [[6, -5], [18, 5]], 2) }),
    ],
  },
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
