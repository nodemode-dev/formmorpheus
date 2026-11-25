// Actions on a character: keys saved as a named action, applied over a span of its block, swapped and cleared.
// Spans count the frames the character's own tracks see, so they stay put when the block is moved or trimmed.
// Keys outside the span being written are never touched. Pure, no DOM.
import type { ActionDef, ActSpan, CharacterInfo, Content, Ease, Key, KeyKind, KeyLane, Movie, Track } from './types';
import { hasCanvas } from './canvas';
import { evalChannel, kindSpec, laneRank } from './keys';
import { uid } from './model';
import { OpError } from './ops';
import { srcFrame } from './retime';
import { bounds, outline, shapeBase } from './shape';
import { findContent, levelFrameOf } from './transform';
import { BUILTIN_ACTIONS, builtinFor } from './actions-builtin';
import { applyLipsync, guessMapping, looksLikeMouth } from './lipsync-ops';
import type { Viseme } from '../media/lipsync';

/** The kinds of lane an action carries. */
const KINDS: ReadonlySet<KeyKind> = new Set<KeyKind>(['move', 'bones']);
const SCALES = new Set(['scaleX', 'scaleY']);
const MIRRORED = new Set(['x', 'rotation', 'px']);
const PIXELS = new Set(['x', 'y', 'px', 'py']);
/** The starter actions' pixel values are drawn for a leg this long from hip to sole, or a figure this tall. */
const REF_LEG = 344;
const REF_HEIGHT = 900;
const SOLE = ['shin-r', 'foot-r'];
/** Parts a built character may lack (CAST_CONTRACT): a starter moving them says nothing when they are missing. */
const OPTIONAL = new Set(['hip', 'forearm-l', 'forearm-r', 'shin-l', 'shin-r', 'foot-l', 'foot-r', 'hand-l', 'hand-r', 'eyes', 'brows', 'hair-sway', 'shadow']);

export interface ActResult { movie: Movie; skipped: string[] }

/** Lane kind and channel ids each part keys; null for every channel of that kind. */
type Own = Map<string, Map<KeyKind, Set<string> | null>>;

/** How an action lands on one character: mirrored when it is drawn the other way round, pixel values times `k`. */
interface Fit { mirror: boolean; k: number }

/** Passes of a loop over `span` frames: whole passes, and one more cut at the end for what is left. */
export function loopPasses(length: number, span: number): number {
  const n = Math.max(1, Math.floor(span / length));
  return n * length < span ? n + 1 : n;
}

interface PartRef {
  c: Content;
  /** Groups between the character and the part, outermost first. */
  chain: Content[];
}

/** The character group with this id; refuses anything else. */
export function characterOf(movie: Movie, id: string): Content & { character: CharacterInfo } {
  const g = findContent(movie, id);
  if (!g || g.kind !== 'group' || !g.character) throw new OpError('Select a character.');
  return g as Content & { character: CharacterInfo };
}

/** The character's own action with this id, else a built-in one. */
export function findAction(ch: CharacterInfo, id: string): ActionDef | null {
  for (let i = 0; i < ch.actions.length; i++) if (ch.actions[i].id === id) return ch.actions[i];
  for (let i = 0; i < BUILTIN_ACTIONS.length; i++) if (BUILTIN_ACTIONS[i].id === id) return builtinFor(BUILTIN_ACTIONS[i], ch.parts);
  return null;
}

/** The frame the character's tracks see at a movie frame (the Playhead). */
export function charFrame(movie: Movie, g: Content, frame: number): number {
  return Math.round(srcFrame(g, levelFrameOf(movie, g, frame) - g.start));
}

/** The block-local frame (0 is the block's first) where the character's tracks show `inner`; time remaps are not inverted. */
export function blockFrame(g: Content, inner: number): number {
  const s = g.speed ?? 1;
  if (s === 0) return 0;
  const d = (inner - g.offset) / s;
  return g.reverse ? g.duration - 1 - d : d;
}

function partRef(g: Content, name: string): PartRef | null {
  const id = g.character?.parts[name];
  if (!id) return null;
  const walk = (tracks: Track[], chain: Content[]): PartRef | null => {
    for (const t of tracks) for (const c of t.content) {
      if (c.id === id) return { c, chain };
      if (c.kind === 'group') { const r = walk(c.tracks, [...chain, c]); if (r) return r; }
    }
    return null;
  };
  return walk(g.tracks, []);
}

/** A frame of the character's tracks as a key frame of the part. */
function keyFrame(p: PartRef, f: number): number {
  let v = f;
  for (const s of p.chain) v = srcFrame(s, v - s.start);
  return Math.round(v - p.c.start);
}

function mapDeep(tracks: Track[], id: string, fn: (c: Content) => Content): Track[] {
  return tracks.map((t) => {
    if (!t.content.some((c) => c.id === id || c.kind === 'group')) return t;
    return { ...t, content: t.content.map((c) => (c.id === id ? fn(c) : c.kind === 'group' ? { ...c, tracks: mapDeep(c.tracks, id, fn) } : c)) };
  });
}

function holds(tracks: Track[], id: string): boolean {
  return tracks.some((t) => t.content.some((c) => c.id === id || (c.kind === 'group' && holds(c.tracks, id))));
}

/** Writes the character back; a locked track refuses, as every edit does. */
function put(movie: Movie, g: Content): Movie {
  if (movie.tracks.some((t) => t.locked && holds([t], g.id))) throw new OpError('Track is locked');
  return { ...movie, tracks: mapDeep(movie.tracks, g.id, () => g) };
}

function withChar(g: Content, patch: Partial<CharacterInfo>): Content {
  const ch: CharacterInfo = { ...(g.character as CharacterInfo), ...patch };
  if (ch.acts && !ch.acts.length) delete ch.acts;
  return { ...g, character: ch };
}

/** The action at the movie's frame rate: key frames spaced so it keeps its speed (a loop still closes). */
function atRate(a: ActionDef, fps: number): ActionDef {
  const r = a.fps && a.fps !== fps ? fps / a.fps : 1;
  if (r === 1) return a;
  const lanes = a.lanes.map((l) => ({
    part: l.part,
    keys: l.keys.map((k) => {
      const channels: Record<string, Key[]> = {};
      for (const id in k.channels) {
        const at = new Map<number, Key>();
        for (const key of k.channels[id]) { const f = Math.round(key.frame * r); at.set(f, { ...key, frame: f }); }
        channels[id] = [...at.values()].sort((p, q) => p.frame - q.frame);
      }
      return { ...k, channels };
    }),
  }));
  const mouth = a.mouth?.map((m) => ({ ...m, frame: Math.round(m.frame * r) }));
  const blend = a.blend ? Math.max(1, Math.round(a.blend * r)) : 0;
  return { ...a, length: Math.max(1, Math.round(a.length * r)), lanes, fps, ...(mouth ? { mouth } : {}), ...(blend ? { blend } : {}) };
}

/** Lane kind and channel ids each part of an action keys; null for an action no longer known (everything it could key). */
function owned(a: ActionDef | null, ch: CharacterInfo): Own {
  const out: Own = new Map();
  if (!a) {
    for (const name of Object.keys(ch.parts)) out.set(name, new Map<KeyKind, Set<string> | null>([['move', null], ['bones', null]]));
    return out;
  }
  for (const l of a.lanes) {
    const kinds = out.get(l.part) ?? new Map<KeyKind, Set<string> | null>();
    for (const k of l.keys) {
      if (!KINDS.has(k.kind)) continue;
      const ids = kinds.get(k.kind) ?? new Set<string>();
      for (const id in k.channels) ids.add(id);
      kinds.set(k.kind, ids);
    }
    out.set(l.part, kinds);
  }
  return out;
}

function moves(o: Own, part: string, kind: KeyKind, id: string): boolean {
  const ids = o.get(part)?.get(kind);
  return ids === null || (ids !== undefined && ids.has(id));
}

function merge(into: Own, from: Own): void {
  for (const [part, kinds] of from) {
    const have = into.get(part) ?? new Map<KeyKind, Set<string> | null>();
    for (const [kind, ids] of kinds) {
      const cur = have.get(kind);
      if (cur === null) continue;
      if (ids === null) have.set(kind, null);
      else have.set(kind, new Set([...(cur ?? []), ...ids]));
    }
    into.set(part, have);
  }
}

/** Removes keys between `lo` and `hi` (key frames, inclusive) on the given channels, except at frames `guard` keeps. */
function dropRange(c: Content, kinds: Map<KeyKind, Set<string> | null>, lo: number, hi: number, guard: (f: number, kind: KeyKind, id: string) => boolean): Content {
  let changed = false;
  const keys: KeyLane[] = [];
  for (const lane of c.keys) {
    const ids = kinds.get(lane.kind);
    if (ids === undefined) { keys.push(lane); continue; }
    const channels: Record<string, Key[]> = {};
    let laneChanged = false;
    for (const id in lane.channels) {
      const list = lane.channels[id];
      if (ids !== null && !ids.has(id)) { channels[id] = list; continue; }
      const kept = list.filter((k) => k.frame < lo || k.frame > hi || guard(k.frame, lane.kind, id));
      if (kept.length !== list.length) laneChanged = true;
      if (kept.length) channels[id] = kept;
    }
    if (!laneChanged) { keys.push(lane); continue; }
    changed = true;
    if (Object.keys(channels).length) keys.push({ ...lane, channels });
  }
  return changed ? { ...c, keys } : c;
}

/**
 * Clears the span `from..to` on the parts and channels `who` names. A key stays only where one of the `keep` spans covers
 * its frame and that span's action moves the same part and channel (a shared boundary frame).
 */
function clearRange(g: Content, who: Own, from: number, to: number, keep: readonly ActSpan[]): Content {
  let out = g;
  const ch = g.character as CharacterInfo;
  const owns = keep.map((s) => owned(findAction(ch, s.action), ch));
  for (const [name, kinds] of who) {
    const p = partRef(out, name);
    if (!p) continue;
    const a = keyFrame(p, from), b = keyFrame(p, to);
    const spans = keep.map((s, i) => { const x = keyFrame(p, s.from), y = keyFrame(p, s.to); return { lo: Math.min(x, y), hi: Math.max(x, y), own: owns[i] }; });
    const guard = (f: number, kind: KeyKind, id: string): boolean => spans.some((s) => f >= s.lo && f <= s.hi && moves(s.own, name, kind, id));
    const next = dropRange(p.c, kinds, Math.min(a, b), Math.max(a, b), guard);
    if (next !== p.c) out = { ...out, tracks: mapDeep(out.tracks, p.c.id, () => next) };
  }
  return out;
}

function restOf(c: Content, kind: KeyKind, id: string): number {
  if (kind !== 'move') return 0;
  const t = c.transform;
  switch (id) {
    case 'x': return t.x;
    case 'y': return t.y;
    case 'rotation': return t.rotation;
    case 'scaleX': case 'scaleY': return t.scale;
    case 'px': return c.pivot?.x ?? 0;
    case 'py': return c.pivot?.y ?? 0;
    default: return 0;
  }
}

function absolute(c: Content, kind: KeyKind, id: string, v: number, fit: Fit): number {
  if (kind === 'bones') return fit.mirror ? -v : v;
  if (kind !== 'move') return v;
  if (SCALES.has(id)) return restOf(c, kind, id) * v;
  const d = PIXELS.has(id) ? v * fit.k : v;
  return restOf(c, kind, id) + (fit.mirror && MIRRORED.has(id) ? -d : d);
}

function relative(c: Content, kind: KeyKind, id: string, v: number): number {
  if (kind !== 'move') return v;
  if (SCALES.has(id)) { const b = restOf(c, kind, id); return b ? v / b : 1; }
  return v - restOf(c, kind, id);
}

/** Replaces a part's keys at the given frames on one channel, making the lane when the part has none of that kind. */
function putChannel(c: Content, kind: KeyKind, id: string, add: Key[]): Content {
  if (!add.length) return c;
  const old = c.keys.find((l) => l.kind === kind);
  const frames = new Set(add.map((k) => k.frame));
  const list = [...(old?.channels[id] ?? []).filter((k) => !frames.has(k.frame)), ...add].sort((p, q) => p.frame - q.frame);
  if (old) return { ...c, keys: c.keys.map((l) => (l === old ? { ...l, channels: { ...l.channels, [id]: list } } : l)) };
  const options: KeyLane['options'] = {};
  for (const o of kindSpec(kind).options ?? []) options[o.id] = o.def;
  const lane: KeyLane = { kind, expanded: false, channels: { [id]: list }, options };
  return { ...c, keys: [...c.keys, lane].sort((p, q) => laneRank(p.kind) - laneRank(q.kind)) };
}

/** Actions are kept with arm-r on the Stage's left; a character drawn the other way round plays them mirrored. */
function mirrored(g: Content): boolean {
  const r = partRef(g, 'arm-r'), l = partRef(g, 'arm-l');
  if (!r || !l) return false;
  const x = (c: Content): number => c.transform.x + (c.pivot?.x ?? 0);
  return x(r.c) > x(l.c);
}

/** Lowest and highest y a part's drawing reaches, from the movie centre, unmoved; null when it draws nothing. */
function reach(c: Content, h: number, out: { lo: number; hi: number } | null = null): { lo: number; hi: number } | null {
  let r = out;
  const add = (lo: number, hi: number): void => { if (r) { r.lo = Math.min(r.lo, lo); r.hi = Math.max(r.hi, hi); } else r = { lo, hi }; };
  if (c.kind === 'shape' && c.shape) { const b = bounds(outline(c.shape, shapeBase(c.shape))); if (b) add(b[1], b[3]); }
  if (hasCanvas(c) && c.canvas) add(c.canvas.y - h / 2, c.canvas.y + c.canvas.h - h / 2);
  for (const t of c.tracks) for (const x of t.content) r = reach(x, h, r);
  return r;
}

/** The character's size against the one the starter actions are drawn for: its leg-r from hip to sole, else its height. */
function sizeOf(g: Content, h: number): number {
  const leg = partRef(g, 'leg-r');
  const lr = leg?.c.pivot ? reach(leg.c, h) : null;
  // a leg in two parts and a foot (a built character): the sole is the lowest of them
  for (const name of SOLE) { const p = lr ? partRef(g, name) : null; const r = p ? reach(p.c, h) : null; if (lr && r) lr.hi = Math.max(lr.hi, r.hi); }
  if (leg && lr && leg.c.pivot) {
    const len = (lr.hi - leg.c.pivot.y) * Math.abs(leg.c.transform.scale);
    if (len > 1) return Math.min(20, Math.max(0.05, len / REF_LEG));
  }
  let all: { lo: number; hi: number } | null = null;
  for (const t of g.tracks) for (const x of t.content) all = reach(x, h, all);
  const tall = all ? all.hi - all.lo : 0;
  return tall > 1 ? Math.min(20, Math.max(0.05, tall / REF_HEIGHT)) : 1;
}

function fitFor(g: Content, a: ActionDef, h: number): Fit {
  return { mirror: mirrored(g), k: a.id.startsWith('builtin:') ? sizeOf(g, h) : 1 };
}

/** Each channel the action can write on this character, its keys inside the action's frames; missing parts are named in `skipped`. */
function eachChannel(g: Content, a: ActionDef, skipped: string[] | null, fn: (pc: Content, p: PartRef, part: string, kind: KeyKind, id: string, src: Key[]) => Content): Content {
  let out = g;
  for (const l of a.lanes) {
    const p = partRef(out, l.part);
    if (!p) { if (skipped && !skipped.includes(l.part)) skipped.push(l.part); continue; }
    let pc = p.c;
    for (const k of l.keys) {
      if (!KINDS.has(k.kind)) continue;
      for (const id in k.channels) {
        if (k.kind === 'bones' && !pc.rig?.bones.some((b) => b.id === id)) continue;
        if (k.kind === 'move' && !kindSpec('move').channels.some((s) => s.id === id)) continue;
        const src = k.channels[id].filter((x) => x.frame >= 0 && x.frame <= a.length).sort((x, y) => x.frame - y.frame);
        if (src.length) pc = fn(pc, p, l.part, k.kind, id, src);
      }
    }
    if (pc !== p.c) { const next = pc; out = { ...out, tracks: mapDeep(out.tracks, p.c.id, () => next) }; }
  }
  return out;
}

/** Writes the action's keys from `from`, `reps` passes, none past `limit`; parts the character lacks are returned by name. */
function write(g: Content, a: ActionDef, from: number, reps: number, fit: Fit, limit = Infinity): { g: Content; skipped: string[] } {
  const skipped: string[] = [];
  const out = eachChannel(g, a, skipped, (pc, p, _part, kind, id, src) => {
    const at = new Map<number, Key>();
    for (let r = 0; r < reps; r++) {
      for (const key of src) {
        const t = from + r * a.length + key.frame;
        if (t > limit) break;
        const f = keyFrame(p, t);
        if (f < 0 || f > pc.duration - 1) continue;
        // a later pass's first key takes the place of the last pass's closing key, with the ease that leaves it
        at.set(f, { ...key, frame: f, value: absolute(p.c, kind, id, key.value, fit) });
      }
    }
    if (a.loop && a.blend) blendEnds(at, p, a, kind, id, src, from, Math.min(from + reps * a.length, limit), fit);
    return putChannel(pc, kind, id, [...at.values()].sort((x, y) => x.frame - y.frame));
  });
  return { g: out, skipped };
}

/** The channel's value at rest, as an action counts it. */
const restValue = (kind: KeyKind, id: string): number => (kind === 'move' && SCALES.has(id) ? 1 : 0);

/**
 * A loop whose first pose is not the rest pose: the span's first `blend` frames ease from rest into the loop as it
 * runs there, and its last `blend` frames ease back to rest, so nothing snaps or stays raised. Too short a span is left as is.
 */
function blendEnds(at: Map<number, Key>, p: PartRef, a: ActionDef, kind: KeyKind, id: string, src: Key[], from: number, end: number, fit: Fit): void {
  const b = a.blend ?? 0;
  if (end - from < 2 * b + 2) return;
  const lo = keyFrame(p, from), hi = keyFrame(p, end), inA = keyFrame(p, from + b), outA = keyFrame(p, end - b);
  for (const f of [...at.keys()]) if ((f > lo && f < inA) || (f > outA && f < hi)) at.delete(f);
  const rest = restValue(kind, id);
  const put = (f: number, k: Key): void => { if (f >= 0 && f <= p.c.duration - 1) at.set(f, { ...k, frame: f, value: absolute(p.c, kind, id, k.value, fit) }); };
  put(lo, { frame: 0, value: rest, ease: 'inout' });
  put(inA, keyAt(src, b % a.length));
  put(outA, { frame: 0, value: keyAt(src, (end - b - from) % a.length).value, ease: 'inout' });
  put(hi, { frame: 0, value: rest, ease: 'inout' });
}

/** The action's key at frame `t` of a pass: its own key there, else the value shown there with the ease that runs on. */
function keyAt(src: Key[], t: number): Key {
  for (const k of src) if (k.frame === t) return k;
  return { frame: t, value: evalChannel(src, t) ?? 0, ease: easeBefore(src, t) };
}

/**
 * Writes each span's own key at the frames given where it starts or ends. A span owns its first frame, and its last
 * only on the channels no span starting there moves, so spans that touch share one key and a cut span ends cleanly.
 */
function seal(g: Content, spans: readonly ActSpan[], frames: readonly number[], h: number, fps: number): Content {
  const ch = g.character as CharacterInfo;
  let out = g;
  for (const f of frames) {
    const starts = spans.filter((s) => s.from === f).map((s) => owned(findAction(ch, s.action), ch));
    for (const s of spans) {
      if (s.from !== f && s.to !== f) continue;
      const def = findAction(ch, s.action);
      if (!def) continue;
      const a = atRate(def, fps);
      const head = s.from === f;
      const local = f - (s.start ?? s.from);
      const m = local % a.length;
      const t = !a.loop ? Math.min(local, a.length) : !head && m === 0 && local > 0 ? a.length : m;
      const fit = fitFor(out, a, h);
      // a blended loop rests where it truly starts and wherever it ends
      const rests = !!(a.loop && a.blend) && (!head || s.start === undefined);
      out = eachChannel(out, a, null, (pc, p, part, kind, id, src) => {
        if (!head && starts.some((o) => moves(o, part, kind, id))) return pc;
        const k = keyAt(src, t), at = keyFrame(p, f);
        if (at < 0 || at > pc.duration - 1) return pc;
        const v = rests ? restValue(kind, id) : k.value;
        return putChannel(pc, kind, id, [{ ...k, frame: at, value: absolute(p.c, kind, id, v, fit) }]);
      });
    }
  }
  return out;
}

/** A part named mouth that is a mouth chart: the row lip-sync shows (the top row shown) and the row of its drawings. */
function mouthChart(g: Content): { p: PartRef; row: number; chart: number } | null {
  const p = partRef(g, 'mouth');
  if (!p || p.c.kind !== 'flipbook' || !p.c.flip?.length) return null;
  const rows = p.c.flip;
  const row = Math.max(0, rows.findIndex((r) => !r.hidden));
  const kept = rows.findIndex((r, i) => i !== row && r.hidden && looksLikeMouth(r));
  const chart = kept >= 0 ? kept : row;
  return looksLikeMouth(rows[chart]) ? { p, row, chart } : null;
}

/**
 * Writes the action's mouth shapes over `from` up to `to` (frames of the character's tracks) into its mouth chart the way
 * lip-sync does, a loop's passes repeated; with no action the span shows Rest. Any other mouth is left alone.
 */
function speak(movie: Movie, g: Content, a: ActionDef | null, from: number, to: number): Content {
  const m = mouthChart(g);
  if (!m) return g;
  const p = m.p, at = keyFrame(p, from);
  const lo = Math.max(0, at), hi = Math.min(p.c.duration, keyFrame(p, to));
  if (hi <= lo) return g;
  const say = a?.mouth ?? [];
  const shapes: Viseme[] = [];
  for (let f = lo; f < hi; f++) {
    const t = !a ? 0 : a.loop ? (f - at) % a.length : Math.min(f - at, a.length);
    let s: Viseme = 'rest';
    for (const k of say) { if (k.frame <= t) s = k.shape; else break; }
    shapes.push(s);
  }
  const host = p.chain.length ? p.chain[p.chain.length - 1] : g;
  try {
    const out = applyLipsync({ ...movie, tracks: host.tracks }, {
      content: p.c.id, row: m.row, chartRow: m.chart === m.row ? -1 : m.chart, from: lo + p.c.start, shapes, map: guessMapping(p.c.flip[m.chart]),
    });
    return host === g ? { ...g, tracks: out.tracks } : { ...g, tracks: mapDeep(g.tracks, host.id, (x) => ({ ...x, tracks: out.tracks })) };
  } catch (e) {
    if (e instanceof OpError) return g;
    throw e;
  }
}

/**
 * Applies an action at `at` (a frame of the character's tracks), `repeats` passes when it loops. The span takes its frames
 * from any span it lands on (those keep what lies outside it) and replaces the keys inside it on the parts it moves.
 * With `limit` (a frame of the character's tracks, inclusive) nothing is written past it and the span ends there.
 */
export function applyAction(movie: Movie, charId: string, actionId: string, at: number, repeats = 1, limit?: number): ActResult {
  const g = characterOf(movie, charId);
  const ch = g.character;
  const def = findAction(ch, actionId);
  if (!def) throw new OpError('That action no longer exists.');
  const a = atRate(def, movie.fps);
  const from = Math.round(at), reps = a.loop ? Math.max(1, Math.round(repeats)) : 1;
  const to = limit === undefined ? from + a.length * reps : Math.min(from + a.length * reps, Math.max(from + 1, Math.round(limit)));
  const acts = ch.acts ?? [];
  const hit = (s: ActSpan): boolean => s.from < to && s.to > from;
  const who = owned(a, ch);
  for (const s of acts) if (hit(s)) merge(who, owned(findAction(ch, s.action), ch));
  const others = acts.filter((s) => !hit(s));
  const cleared = clearRange(g, who, from, to, others);
  const { g: written, skipped } = write(cleared, a, from, reps, fitFor(cleared, a, movie.height), to);
  const names = new Set(a.lanes.map((l) => l.part));
  if (skipped.length >= names.size) throw new OpError('This character has none of the parts the action moves.');
  const kept: ActSpan[] = [];
  for (const s of acts) {
    if (!hit(s)) { kept.push(s); continue; }
    if (s.from < from) kept.push({ ...s, to: from });
    if (s.to > to) kept.push({ ...s, from: to, start: s.start ?? s.from });
  }
  kept.push({ action: def.id, from, to });
  kept.sort((p, q) => p.from - q.from);
  const sealed = seal(written, kept, [from, to], movie.height, movie.fps);
  // a mouth an earlier action set inside the span goes back to Rest unless this one sets it
  const spoke = a.mouth || acts.some((s) => hit(s) && findAction(ch, s.action)?.mouth);
  const said = spoke ? speak(movie, sealed, a.mouth ? a : null, from, to) : sealed;
  // a built character without hair or a shadow is complete, so its optional parts are never named
  return { movie: put(movie, withChar(said, { acts: kept })), skipped: def.id.startsWith('builtin:') ? skipped.filter((n) => !OPTIONAL.has(n)) : skipped };
}

/** Removes the keys of one placed action (inside its span, on the parts and channels it moves) and the span. */
export function clearAction(movie: Movie, charId: string, spanIndex: number): Movie {
  const g = characterOf(movie, charId);
  const ch = g.character;
  const acts = ch.acts ?? [];
  const s = acts[spanIndex];
  if (!s) throw new OpError('That action is no longer on the Timeline.');
  const others = acts.filter((_, i) => i !== spanIndex);
  const cleared = clearRange(g, owned(findAction(ch, s.action), ch), s.from, s.to, others);
  const sealed = seal(cleared, others, [s.from, s.to], movie.height, movie.fps);
  const said = findAction(ch, s.action)?.mouth ? speak(movie, sealed, null, s.from, s.to) : sealed;
  return put(movie, withChar(said, { acts: others }));
}

/** Puts another action over a placed one: its keys go, the new action fills the same span and never runs past it. */
export function swapAction(movie: Movie, charId: string, spanIndex: number, actionId: string): ActResult {
  const s = (characterOf(movie, charId).character.acts ?? [])[spanIndex];
  if (!s) throw new OpError('That action is no longer on the Timeline.');
  const def = findAction(characterOf(movie, charId).character, actionId);
  if (!def) throw new OpError('That action no longer exists.');
  const a = atRate(def, movie.fps);
  const reps = a.loop ? loopPasses(a.length, s.to - s.from) : 1;
  return applyAction(clearAction(movie, charId, spanIndex), charId, actionId, s.from, reps, s.to);
}

function easeBefore(list: Key[], f: number): Ease {
  let e: Ease = 'linear';
  for (const k of list) { if (k.frame < f) e = k.ease; else break; }
  return e;
}

/**
 * A new action of the character from its parts' Move and Bones keys between two frames of its tracks. A channel keyed
 * inside the range gets keys at both ends at the values it shows there. Loops when every channel ends where it starts.
 */
export function actionFromKeys(movie: Movie, charId: string, from: number, to: number, name: string): { movie: Movie; action: ActionDef } {
  const g = characterOf(movie, charId);
  const lo = Math.round(Math.min(from, to)), hi = Math.round(Math.max(from, to));
  if (hi - lo < 1) throw new OpError('Choose a range of at least two frames.');
  const length = hi - lo;
  const lanes: ActionDef['lanes'] = [];
  const flip = mirrored(g);
  let loop = true;
  for (const part of Object.keys(g.character.parts)) {
    const p = partRef(g, part);
    if (!p) continue;
    const a0 = keyFrame(p, lo), a1 = keyFrame(p, hi);
    const keys: KeyLane[] = [];
    for (const lane of p.c.keys) {
      if (!KINDS.has(lane.kind)) continue;
      const channels: Record<string, Key[]> = {};
      for (const id in lane.channels) {
        const list = lane.channels[id];
        const inside = list.filter((k) => k.frame >= a0 && k.frame <= a1);
        if (!inside.length) continue;
        const turn = flip && (lane.kind === 'bones' || MIRRORED.has(id));
        const rel = (v: number): number => (turn ? -relative(p.c, lane.kind, id, v) : relative(p.c, lane.kind, id, v));
        const out: Key[] = [];
        if (inside[0].frame > a0) out.push({ frame: 0, value: rel(evalChannel(list, a0) ?? 0), ease: easeBefore(list, a0) });
        for (const k of inside) out.push({ ...k, frame: Math.min(length, k.frame - a0), value: rel(k.value) });
        const last = inside[inside.length - 1];
        if (last.frame < a1) out.push({ frame: length, value: rel(evalChannel(list, a1) ?? 0), ease: last.ease });
        if (Math.abs(out[0].value - out[out.length - 1].value) > 1e-6) loop = false;
        channels[id] = out;
      }
      if (Object.keys(channels).length) keys.push({ kind: lane.kind, expanded: false, channels, options: { ...lane.options } });
    }
    if (keys.length) lanes.push({ part, keys });
  }
  if (!lanes.length) throw new OpError('The character has no keys between those frames.');
  const action: ActionDef = { id: uid('act'), name: name.trim() || 'Action', length, loop, lanes, fps: movie.fps };
  return { movie: put(movie, withChar(g, { actions: [...g.character.actions, action] })), action };
}

/** Adds an action (an imported one) to the character under a fresh id. */
export function addAction(movie: Movie, charId: string, def: ActionDef): { movie: Movie; id: string } {
  const g = characterOf(movie, charId);
  const id = uid('act');
  return { movie: put(movie, withChar(g, { actions: [...g.character.actions, { ...def, id }] })), id };
}

/** Removes one of the character's own actions; its placed spans go too, their keys stay as plain keys. */
export function removeAction(movie: Movie, charId: string, actionId: string): Movie {
  const g = characterOf(movie, charId);
  const ch = g.character;
  if (!ch.actions.some((a) => a.id === actionId)) throw new OpError('That action no longer exists.');
  return put(movie, withChar(g, { actions: ch.actions.filter((a) => a.id !== actionId), acts: (ch.acts ?? []).filter((s) => s.action !== actionId) }));
}
