// Action files: `[name].fmact`, a small JSON document `{format: 1, action: ActionDef}` (blend optional). Read is checked field by field
// and refused past 1 MB, so a stray file never reaches the movie half-formed.
import { ACTION_MAX_FRAMES, EASES, type ActionDef, type Ease, type Key, type KeyLane } from '../engine/types';

const EASE_IDS = new Set<string>([...EASES.map((e) => e.id), 'custom']);

export const FMACT_FORMAT = 1;
export const FMACT_MAX_BYTES = 1024 * 1024;

const safeName = (s: string): string => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 60) || 'Action';

export function fmactName(a: ActionDef): string { return `${safeName(a.name)}.fmact`; }

export function fmactBlob(a: ActionDef): Blob {
  return new Blob([JSON.stringify({ format: FMACT_FORMAT, action: a }, null, 1)], { type: 'application/json' });
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function bad(): never { throw new Error('That is not an action file.'); }

function key(v: unknown): Key {
  if (!isObj(v) || !num(v.frame) || !num(v.value) || typeof v.ease !== 'string' || !EASE_IDS.has(v.ease)) bad();
  const k: Key = { frame: Math.round(v.frame), value: v.value, ease: v.ease as Ease };
  const pair = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]);
  if (k.ease === 'custom' && pair(v.out) && pair(v.in)) { k.out = [v.out[0], v.out[1]]; k.in = [v.in[0], v.in[1]]; }
  return k;
}

const BAD_IDS = new Set(['__proto__', 'constructor', 'prototype']);

/** A lane of the action; keys outside its `length` frames are dropped. */
function lane(v: unknown, length: number): KeyLane | null {
  if (!isObj(v) || !isObj(v.channels)) bad();
  if (v.kind !== 'move' && v.kind !== 'bones') return null;
  const channels: Record<string, Key[]> = Object.create(null);
  for (const id of Object.keys(v.channels)) {
    if (BAD_IDS.has(id)) continue;
    const list = v.channels[id];
    if (!Array.isArray(list)) bad();
    const keys = list.map(key).filter((k) => k.frame >= 0 && k.frame <= length).sort((a, b) => a.frame - b.frame);
    if (keys.length) channels[id] = keys;
  }
  const options: KeyLane['options'] = Object.create(null);
  if (isObj(v.options)) for (const [k, o] of Object.entries(v.options)) if (!BAD_IDS.has(k) && (typeof o === 'string' || typeof o === 'number' || typeof o === 'boolean')) options[k] = o;
  return { kind: v.kind, expanded: false, channels, options };
}

/** The action in a file's text; throws a sentence for a person when it is not one. */
export function parseFmact(text: string): ActionDef {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { bad(); }
  if (!isObj(doc) || !isObj(doc.action)) bad();
  if (doc.format !== FMACT_FORMAT) throw new Error('This action file was made by a newer version of FormMorpheus.');
  const a = doc.action;
  if (typeof a.name !== 'string' || !num(a.length) || typeof a.loop !== 'boolean' || !Array.isArray(a.lanes)) bad();
  const length = Math.min(ACTION_MAX_FRAMES, Math.max(1, Math.round(a.length)));
  const lanes: ActionDef['lanes'] = [];
  for (const l of a.lanes) {
    if (!isObj(l) || typeof l.part !== 'string' || !Array.isArray(l.keys)) bad();
    const keys = l.keys.map((k) => lane(k, length)).filter((k): k is KeyLane => k !== null && Object.keys(k.channels).length > 0);
    if (keys.length) lanes.push({ part: l.part.slice(0, 120), keys });
  }
  if (!lanes.length) bad();
  const def: ActionDef = { id: typeof a.id === 'string' ? a.id : 'act', name: a.name.trim().slice(0, 120) || 'Action', length, loop: a.loop, lanes };
  if (num(a.fps) && a.fps > 0) def.fps = Math.min(240, Math.max(1, a.fps));
  // optional and new in 0.30.0: a file without it reads as before, and an older reader passes it by
  const blend = def.loop && num(a.blend) ? Math.min(Math.floor(length / 2), Math.round(a.blend)) : 0;
  if (blend >= 1) def.blend = blend;
  return def;
}

/** Reads an action file, refusing one over 1 MB before it is read. */
export async function readFmact(f: File): Promise<ActionDef> {
  if (f.size > FMACT_MAX_BYTES) throw new Error('That action file is over 1 MB, which is more than an action needs. It was not opened.');
  return parseFmact(await f.text());
}
