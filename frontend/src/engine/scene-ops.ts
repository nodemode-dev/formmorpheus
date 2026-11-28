// Scene edits: the movie's stretches put in a new order, copied, dropped or opened up, with everything in them.
// Pure, no DOM. Content on every top-level track, camera keys, markers, subtitles and scene effects travel with the
// stretch they are in; whatever crosses a cut that comes apart is split at the cut first.
import { evalChannel } from './keys';
import { end, sortContent, uid } from './model';
import { cloneContent, OpError, splitContent } from './ops';
import { sceneSpans, scenesOf } from './scene-marks';
import type { Content, Key, KeyLane, Marker, Movie, SceneFx, SceneMark, SubtitleCue, Track } from './types';

/** One stretch of the new timeline: a scene of the movie as it is (`from`, its index) or an empty one of `len` frames. */
export interface Slot { from: number | null; len: number; mark: SceneMark }

interface Seg { start: number; end: number }
interface Hit { frame: number; slot: number; copy: boolean }

class Plan {
  readonly segs: Seg[];
  readonly pos: number[] = [];
  readonly occ: number[];
  readonly cuts: number[] = [];
  readonly total: number;
  readonly tail: number;

  constructor(readonly m: Movie, readonly slots: Slot[]) {
    this.segs = sceneSpans(m).map((s) => ({ start: s.start, end: s.end }));
    if (!this.segs.length) this.segs = [{ start: 0, end: m.duration }];
    this.occ = this.segs.map(() => 0);
    let at = 0;
    for (const s of slots) {
      this.pos.push(at);
      if (s.from !== null) this.occ[s.from]++;
      at += this.lenOf(s);
    }
    this.total = Math.max(1, at);
    this.tail = this.total - m.duration;
    const n = this.segs.length;
    for (let i = 0; i < n; i++) {
      const j = slots.findIndex((s) => s.from === i);
      const whole = this.occ[i] === 1 && (i === n - 1 ? j === slots.length - 1 : this.occ[i + 1] === 1 && slots[j + 1]?.from === i + 1);
      if (!whole) this.cuts.push(this.segs[i].end);
    }
  }

  lenOf(s: Slot): number {
    return s.from === null ? Math.max(1, Math.round(s.len)) : this.segs[s.from].end - this.segs[s.from].start;
  }

  segOf(f: number): number {
    if (f >= this.m.duration) return -1;
    for (let i = this.segs.length - 1; i >= 0; i--) if (f >= this.segs[i].start) return i;
    return 0;
  }

  /** Where a frame of the movie lands: once per copy of its stretch, none when the stretch is deleted. */
  map(f: number): Hit[] {
    const s = this.segOf(f);
    if (s < 0) return [{ frame: f + this.tail, slot: -1, copy: false }];
    const out: Hit[] = [];
    this.slots.forEach((slot, j) => {
      if (slot.from === s) out.push({ frame: f - this.segs[s].start + this.pos[j], slot: j, copy: out.length > 0 });
    });
    return out;
  }

  /** The cuts strictly inside [a, b). */
  inside(a: number, b: number): number[] {
    return this.cuts.filter((c) => c > a && c < b);
  }
}

const LOCKED = 'A locked track has content in this scene. Unlock the track first.';

/** Splits every top-level content that crosses a cut; returns, per original id, the pieces it became. */
function splitAtCuts(m: Movie, plan: Plan): { movie: Movie; pieces: Map<string, string[]> } {
  let movie = m;
  const pieces = new Map<string, string[]>();
  m.tracks.forEach((t, ti) => {
    for (const c of t.content) {
      const at = plan.inside(c.start, end(c));
      if (!at.length) continue;
      if (t.locked) throw new OpError(LOCKED);
      let id = c.id;
      const ids = [id];
      for (const f of at) {
        const r = splitContent(movie, id, f);
        movie = dropTransition(r.movie, ti, r.right);
        id = r.right;
        ids.push(id);
      }
      pieces.set(c.id, ids);
    }
  });
  return { movie, pieces };
}

function dropTransition(m: Movie, ti: number, id: string): Movie {
  const t = m.tracks[ti];
  const c = t.content.find((x) => x.id === id);
  if (!c?.transition) return m;
  const { transition: _drop, ...rest } = c;
  const tracks = [...m.tracks];
  tracks[ti] = { ...t, content: t.content.map((x) => (x.id === id ? (rest as Content) : x)) };
  return { ...m, tracks };
}

function placeTracks(m: Movie, plan: Plan, pieces: Map<string, string[]>): { tracks: Track[]; copies: Map<string, string>[] } {
  const copies = plan.slots.map(() => new Map<string, string>());
  const where = new Map<string, { slot: number; src: number }>();
  const tracks = m.tracks.map((t) => {
    const next: Content[] = [];
    let same = true;
    for (const c of t.content) {
      const hits = plan.map(c.start);
      if (t.locked && (hits.length !== 1 || hits[0].frame !== c.start)) throw new OpError(LOCKED);
      if (hits.length !== 1 || hits[0].frame !== c.start) same = false;
      for (const h of hits) {
        if (!h.copy) {
          const moved = h.frame === c.start ? c : { ...c, start: h.frame };
          next.push(moved);
          where.set(c.id, { slot: h.slot, src: c.start });
          continue;
        }
        const copy = cloneContent(c, h.frame);
        copies[h.slot].set(c.id, copy.id);
        where.set(copy.id, { slot: h.slot, src: c.start });
        next.push(copy);
      }
    }
    return same ? t : { ...t, content: sortContent(next) };
  });
  const family = new Map<string, string>();
  for (const [orig, ids] of pieces) for (const id of ids) family.set(id, orig);
  const startOf = new Map<string, { start: number; end: number }>();
  for (const t of m.tracks) for (const c of t.content) startOf.set(c.id, { start: c.start, end: end(c) });
  const parentFor = (p: string, at: { slot: number; src: number }): string => {
    let id = p;
    const orig = family.get(p);
    if (orig) {
      const ids = pieces.get(orig) ?? [p];
      id = ids.find((x) => { const r = startOf.get(x); return !!r && at.src >= r.start && at.src < r.end; }) ?? p;
    }
    return at.slot >= 0 ? copies[at.slot].get(id) ?? id : id;
  };
  const relinked = tracks.map((t) => {
    if (!t.content.some((c) => c.parent)) return t;
    let hit = false;
    const content = t.content.map((c) => {
      if (!c.parent) return c;
      const at = where.get(c.id);
      if (!at) return c;
      const p = parentFor(c.parent, at);
      if (p === c.parent) return c;
      hit = true;
      return { ...c, parent: p };
    });
    return hit ? { ...t, content } : t;
  });
  return { tracks: relinked, copies };
}

function easeBefore(keys: Key[], f: number): Key['ease'] {
  let e: Key['ease'] = keys[0].ease;
  for (const k of keys) { if (k.frame < f) e = k.ease; else break; }
  return e === 'custom' ? 'linear' : e;
}

function mapKeys(keys: Key[], plan: Plan, last: number): Key[] {
  if (!keys.length) return keys;
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  const add: Key[] = [];
  for (const c of plan.cuts) for (const x of [c - 1, c]) {
    if (x < 0 || x > last || sorted.some((k) => k.frame === x) || add.some((k) => k.frame === x)) continue;
    add.push({ frame: x, value: evalChannel(sorted, x) ?? sorted[0].value, ease: easeBefore(sorted, x) });
  }
  const out: Key[] = [];
  for (const k of [...sorted, ...add]) for (const h of plan.map(k.frame)) out.push(h.frame === k.frame ? k : { ...k, frame: h.frame });
  out.sort((a, b) => a.frame - b.frame);
  return out.filter((k, i) => i === 0 || out[i - 1].frame !== k.frame);
}

function mapCamera(m: Movie, plan: Plan): Movie['camera'] {
  const cam = m.camera;
  if (!cam || !cam.keys.length) return cam;
  const keys: KeyLane[] = cam.keys.map((lane) => {
    const channels: Record<string, Key[]> = {};
    for (const id in lane.channels) channels[id] = mapKeys(lane.channels[id], plan, m.duration - 1);
    return { ...lane, channels };
  });
  return { ...cam, keys };
}

function mapMarkers(list: Marker[], plan: Plan): Marker[] {
  const out: Marker[] = [];
  for (const k of list) for (const h of plan.map(k.frame)) out.push(h.copy ? { ...k, id: uid('mk'), frame: h.frame } : { ...k, frame: h.frame });
  out.sort((a, b) => a.frame - b.frame);
  return out.filter((k, i) => i === 0 || out[i - 1].frame !== k.frame);
}

/** Lines and effects: split where they cross a cut, then each piece goes with its stretch. */
function mapRanges<T extends { id: string; start: number; end: number }>(list: T[], plan: Plan, fresh: () => string, fix?: (x: T, slot: number) => T): T[] {
  const out: T[] = [];
  for (const x of list) {
    const bounds = [x.start, ...plan.inside(x.start, x.end), x.end];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const a = bounds[i], b = bounds[i + 1];
      for (const h of plan.map(a)) {
        const piece = { ...x, id: i === 0 && !h.copy ? x.id : fresh(), start: h.frame, end: h.frame + (b - a) };
        out.push(h.copy && fix ? fix(piece, h.slot) : piece);
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Lays the movie out again as `slots` say, in one pure step. */
export function recut(m: Movie, slots: Slot[]): Movie {
  if (!slots.length) throw new OpError('A movie needs at least one scene.');
  const plan = new Plan(m, slots);
  const split = splitAtCuts(m, plan);
  const { tracks, copies } = placeTracks(split.movie, plan, split.pieces);
  const next: Movie = { ...split.movie, tracks, duration: plan.total };
  const camera = mapCamera(m, plan);
  if (camera) next.camera = camera;
  if (m.markers?.length) next.markers = mapMarkers(m.markers, plan);
  if (m.subtitles?.cues.length) {
    const cues = mapRanges<SubtitleCue>(m.subtitles.cues, plan, () => uid('sb'), (c, slot) => (c.from && copies[slot].has(c.from) ? { ...c, from: copies[slot].get(c.from) } : c));
    next.subtitles = { ...m.subtitles, cues };
  }
  if (m.sceneFx?.length) next.sceneFx = mapRanges<SceneFx>(m.sceneFx, plan, () => uid('fx'));
  next.scenes = slots.map((s, j) => ({ ...s.mark, start: plan.pos[j] }));
  if (next.camera?.follow && !tracks.some((t) => t.content.some((c) => c.id === next.camera?.follow?.id))) {
    const { follow: _f, ...cam } = next.camera;
    next.camera = cam;
  }
  if (m.loopFrom !== undefined && m.loopTo !== undefined) {
    const focus = sceneSpans(m).findIndex((s) => s.start === m.loopFrom && s.end - 1 === m.loopTo);
    const j = focus >= 0 ? slots.findIndex((s) => s.from === focus) : -1;
    if (j >= 0) { next.loopFrom = plan.pos[j]; next.loopTo = plan.pos[j] + plan.lenOf(slots[j]) - 1; }
    else {
      const a = plan.map(m.loopFrom)[0]?.frame, b = plan.map(m.loopTo)[0]?.frame;
      if (a !== undefined && b !== undefined && b >= a && b < plan.total) { next.loopFrom = a; next.loopTo = b; }
      else { delete next.loopFrom; delete next.loopTo; }
    }
  }
  return next;
}

function slotsOf(m: Movie): Slot[] {
  return scenesOf(m).map((mark, i) => ({ from: i, len: 0, mark }));
}

function indexOf(m: Movie, id: string): number {
  const i = scenesOf(m).findIndex((s) => s.id === id);
  if (i < 0) throw new OpError('That scene no longer exists.');
  return i;
}

/** Starts of the new layout's scenes, for the Playhead to follow. */
export function sceneStart(m: Movie, id: string): number {
  return scenesOf(m).find((s) => s.id === id)?.start ?? 0;
}

/** A cut at the frame. A movie with no scenes gets its first scene at 0 and, past it, a second at the frame. */
export function addSceneAt(m: Movie, frame: number, name: (n: number) => string): { movie: Movie; id: string } {
  const f = Math.max(0, Math.min(m.duration - 1, Math.round(frame)));
  const list = scenesOf(m);
  if (!list.length) {
    const first: SceneMark = { id: uid('sc'), name: name(1), start: 0 };
    if (f === 0) return { movie: { ...m, scenes: [first] }, id: first.id };
    const second: SceneMark = { id: uid('sc'), name: name(2), start: f };
    return { movie: { ...m, scenes: [first, second] }, id: second.id };
  }
  if (list.some((s) => s.start === f)) throw new OpError('A scene already starts on this frame.');
  const used = new Set(list.map((s) => s.name));
  let n = list.length + 1;
  while (used.has(name(n))) n++;
  const mark: SceneMark = { id: uid('sc'), name: name(n), start: f };
  return { movie: { ...m, scenes: [...list, mark].sort((a, b) => a.start - b.start) }, id: mark.id };
}

export function renameScene(m: Movie, id: string, name: string): Movie {
  const i = indexOf(m, id);
  const clean = name.trim().slice(0, 80);
  if (!clean || clean === scenesOf(m)[i].name) return m;
  return { ...m, scenes: scenesOf(m).map((s) => (s.id === id ? { ...s, name: clean } : s)) };
}

/** Takes the cut at the scene's start away: it joins the scene before. The only scene's cut leaves the movie one stretch. */
export function deleteCut(m: Movie, id: string): Movie {
  const i = indexOf(m, id);
  const list = scenesOf(m);
  if (list.length === 1) { const { scenes: _s, ...rest } = m; return rest as Movie; }
  if (i === 0) throw new OpError('The first scene has no cut before it.');
  return { ...m, scenes: list.filter((s) => s.id !== id) };
}

/** The scene and what is in it go; what follows moves up. */
export function deleteScene(m: Movie, id: string): Movie {
  const i = indexOf(m, id);
  if (scenesOf(m).length < 2) throw new OpError('The only scene cannot be deleted.');
  return recut(m, slotsOf(m).filter((s) => s.from !== i));
}

/** A copy of the scene, with copies of everything in it, right after it. */
export function duplicateScene(m: Movie, id: string, name: string): { movie: Movie; id: string } {
  const i = indexOf(m, id);
  const slots = slotsOf(m);
  const mark: SceneMark = { id: uid('sc'), name, start: 0 };
  slots.splice(i + 1, 0, { from: i, len: 0, mark });
  return { movie: recut(m, slots), id: mark.id };
}

/** The scene swaps places with its neighbour before (-1) or after (1). */
export function moveScene(m: Movie, id: string, dir: -1 | 1): Movie {
  const i = indexOf(m, id);
  const slots = slotsOf(m);
  const k = i + dir;
  if (k < 0 || k >= slots.length) throw new OpError(dir < 0 ? 'This is already the first scene.' : 'This is already the last scene.');
  [slots[i], slots[k]] = [slots[k], slots[i]];
  return recut(m, slots);
}

/** An empty scene of `len` frames after the scene; what follows moves later. */
export function addEmptyAfter(m: Movie, id: string, len: number, name: string): { movie: Movie; id: string } {
  const i = indexOf(m, id);
  const slots = slotsOf(m);
  const mark: SceneMark = { id: uid('sc'), name, start: 0 };
  slots.splice(i + 1, 0, { from: null, len, mark });
  return { movie: recut(m, slots), id: mark.id };
}

/** Playback loops in the scene (the loop range is its stretch); null takes the loop range away. */
export function focusScene(m: Movie, id: string | null): Movie {
  const n = { ...m };
  delete n.loopFrom;
  delete n.loopTo;
  if (id === null) return m.loopFrom === undefined && m.loopTo === undefined ? m : n;
  const s = sceneSpans(m).find((x) => x.mark.id === id);
  if (!s) throw new OpError('That scene no longer exists.');
  return { ...n, loopFrom: s.start, loopTo: Math.min(m.duration, s.end) - 1 };
}
