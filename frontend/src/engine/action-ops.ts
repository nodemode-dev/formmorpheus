// Actions on a character: keys saved as a named action, applied over a span of its block, swapped and cleared.
// Spans count the frames the character's own tracks see, so they stay put when the block is moved or trimmed.
// Keys outside the span being written are never touched. Pure, no DOM.
import type { ActionDef, ActSpan, CharacterInfo, Content, Ease, Key, KeyKind, KeyLane, Movie, Track } from './types';
import { evalChannel, kindSpec, laneRank } from './keys';
import { uid } from './model';
import { OpError } from './ops';
import { srcFrame } from './retime';
import { findContent, levelFrameOf } from './transform';
import { BUILTIN_ACTIONS } from './actions-builtin';

/** The kinds of lane an action carries. */
const KINDS: ReadonlySet<KeyKind> = new Set<KeyKind>(['move', 'bones']);
const SCALES = new Set(['scaleX', 'scaleY']);
const MIRRORED = new Set(['x', 'rotation', 'px']);

export interface ActResult { movie: Movie; skipped: string[] }

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
  return ch.actions.find((a) => a.id === id) ?? BUILTIN_ACTIONS.find((a) => a.id === id) ?? null;
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
  return { ...a, length: Math.max(1, Math.round(a.length * r)), lanes, fps };
}

/** Lane kind and channel ids each part of an action keys; null for an action no longer known (everything it could key). */
function owned(a: ActionDef | null, ch: CharacterInfo): Map<string, Map<KeyKind, Set<string> | null>> {
  const out = new Map<string, Map<KeyKind, Set<string> | null>>();
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

function merge(into: Map<string, Map<KeyKind, Set<string> | null>>, from: Map<string, Map<KeyKind, Set<string> | null>>): void {
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
function dropRange(c: Content, kinds: Map<KeyKind, Set<string> | null>, lo: number, hi: number, guard: (f: number) => boolean): Content {
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
      const kept = list.filter((k) => k.frame < lo || k.frame > hi || guard(k.frame));
      if (kept.length !== list.length) laneChanged = true;
      if (kept.length) channels[id] = kept;
    }
    if (!laneChanged) { keys.push(lane); continue; }
    changed = true;
    if (Object.keys(channels).length) keys.push({ ...lane, channels });
  }
  return changed ? { ...c, keys } : c;
}

/** Clears the span `from..to` on the parts and channels `who` names, keeping keys at frames inside the `keep` spans. */
function clearRange(g: Content, who: Map<string, Map<KeyKind, Set<string> | null>>, from: number, to: number, keep: readonly ActSpan[]): Content {
  let out = g;
  for (const [name, kinds] of who) {
    const p = partRef(out, name);
    if (!p) continue;
    const a = keyFrame(p, from), b = keyFrame(p, to);
    const spans = keep.map((s) => { const x = keyFrame(p, s.from), y = keyFrame(p, s.to); return [Math.min(x, y), Math.max(x, y)]; });
    const next = dropRange(p.c, kinds, Math.min(a, b), Math.max(a, b), (f) => spans.some(([x, y]) => f >= x && f <= y));
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

function absolute(c: Content, kind: KeyKind, id: string, v: number, mirror: boolean): number {
  if (kind === 'bones') return mirror ? -v : v;
  if (kind !== 'move') return v;
  if (SCALES.has(id)) return restOf(c, kind, id) * v;
  return restOf(c, kind, id) + (mirror && MIRRORED.has(id) ? -v : v);
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

/** Built-ins are drawn with arm-r on the Stage's left; a character drawn the other way round gets them mirrored. */
function mirrored(g: Content, a: ActionDef): boolean {
  if (!a.id.startsWith('builtin:')) return false;
  const r = partRef(g, 'arm-r'), l = partRef(g, 'arm-l');
  if (!r || !l) return false;
  const x = (c: Content): number => c.transform.x + (c.pivot?.x ?? 0);
  return x(r.c) > x(l.c);
}

/** Writes the action's keys from `from`, `reps` passes; parts the character lacks are returned by name. */
function write(g: Content, a: ActionDef, from: number, reps: number): { g: Content; skipped: string[] } {
  const mirror = mirrored(g, a);
  const skipped: string[] = [];
  let out = g;
  for (const l of a.lanes) {
    const p = partRef(out, l.part);
    if (!p) { if (!skipped.includes(l.part)) skipped.push(l.part); continue; }
    let pc = p.c;
    for (const k of l.keys) {
      if (!KINDS.has(k.kind)) continue;
      for (const id in k.channels) {
        if (k.kind === 'bones' && !pc.rig?.bones.some((b) => b.id === id)) continue;
        if (k.kind === 'move' && !kindSpec('move').channels.some((s) => s.id === id)) continue;
        const src = [...k.channels[id]].sort((x, y) => x.frame - y.frame);
        const at = new Map<number, Key>();
        for (let r = 0; r < reps; r++) {
          for (const key of src) {
            const f = keyFrame(p, from + r * a.length + key.frame);
            if (f < 0 || f > pc.duration - 1) continue;
            // a later pass's first key takes the place of the last pass's closing key, with the ease that leaves it
            at.set(f, { ...key, frame: f, value: absolute(p.c, k.kind, id, key.value, mirror) });
          }
        }
        pc = putChannel(pc, k.kind, id, [...at.values()].sort((x, y) => x.frame - y.frame));
      }
    }
    if (pc !== p.c) { const next = pc; out = { ...out, tracks: mapDeep(out.tracks, p.c.id, () => next) }; }
  }
  return { g: out, skipped };
}

/**
 * Applies an action at `at` (a frame of the character's tracks), `repeats` passes when it loops. The span takes its frames
 * from any span it lands on (those keep what lies outside it) and replaces the keys inside it on the parts it moves.
 */
export function applyAction(movie: Movie, charId: string, actionId: string, at: number, repeats = 1): ActResult {
  const g = characterOf(movie, charId);
  const ch = g.character;
  const def = findAction(ch, actionId);
  if (!def) throw new OpError('That action no longer exists.');
  const a = atRate(def, movie.fps);
  const from = Math.round(at), reps = a.loop ? Math.max(1, Math.round(repeats)) : 1, to = from + a.length * reps;
  const acts = ch.acts ?? [];
  const hit = (s: ActSpan): boolean => s.from < to && s.to > from;
  const who = owned(a, ch);
  for (const s of acts) if (hit(s)) merge(who, owned(findAction(ch, s.action), ch));
  const others = acts.filter((s) => !hit(s));
  const cleared = clearRange(g, who, from, to, others);
  const { g: written, skipped } = write(cleared, a, from, reps);
  const names = new Set(a.lanes.map((l) => l.part));
  if (skipped.length >= names.size) throw new OpError('This character has none of the parts the action moves.');
  const kept: ActSpan[] = [];
  for (const s of acts) {
    if (!hit(s)) { kept.push(s); continue; }
    if (s.from < from) kept.push({ ...s, to: from });
    if (s.to > to) kept.push({ ...s, from: to });
  }
  kept.push({ action: def.id, from, to });
  kept.sort((p, q) => p.from - q.from);
  return { movie: put(movie, withChar(written, { acts: kept })), skipped };
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
  return put(movie, withChar(cleared, { acts: others }));
}

/** Puts another action over a placed one: its keys go, the new action fills the same span (a loop as many passes as fit). */
export function swapAction(movie: Movie, charId: string, spanIndex: number, actionId: string): ActResult {
  const s = (characterOf(movie, charId).character.acts ?? [])[spanIndex];
  if (!s) throw new OpError('That action is no longer on the Timeline.');
  const def = findAction(characterOf(movie, charId).character, actionId);
  if (!def) throw new OpError('That action no longer exists.');
  const a = atRate(def, movie.fps);
  const reps = a.loop ? Math.max(1, Math.round((s.to - s.from) / a.length)) : 1;
  return applyAction(clearAction(movie, charId, spanIndex), charId, actionId, s.from, reps);
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
        const rel = (v: number): number => relative(p.c, lane.kind, id, v);
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
