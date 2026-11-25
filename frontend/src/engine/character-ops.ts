// Characters: a Group whose inner contents are named parts (types.ts CharacterInfo). Finding parts by name, making a
// group a character, the mouth chart, and where a nested content sits in movie time. Pure, no DOM.
import { looksLikeMouth } from './lipsync-ops';
import { relinkCharacter, uid } from './model';
import { OpError } from './ops';
import type { CharacterInfo, Content, Movie, Track } from './types';

export { relinkCharacter };

/** Where a content sits: its track, and the groups around it from the outermost in (empty at the top level). */
export interface Found { content: Content; track: Track; groups: Content[] }

export function findDeep(movie: Movie, id: string): Found | null {
  const walk = (tracks: Track[], groups: Content[]): Found | null => {
    for (const t of tracks) for (const c of t.content) {
      if (c.id === id) return { content: c, track: t, groups };
      if (c.kind === 'group') { const hit = walk(c.tracks, [...groups, c]); if (hit) return hit; }
    }
    return null;
  };
  return walk(movie.tracks, []);
}

/** The movie frame a content found by `findDeep` starts on (group offsets counted; a group's speed is not). */
export function movieStart(f: Found): number {
  let s = f.content.start;
  for (let i = f.groups.length - 1; i >= 0; i--) s = f.groups[i].start + (s - f.groups[i].offset);
  return s;
}

/** Edits one content wherever it sits; refuses one on a locked track. */
export function updateDeep(movie: Movie, id: string, fn: (c: Content) => Content): Movie {
  let hit = false;
  const map = (tracks: Track[]): Track[] => tracks.map((t) => {
    if (!t.content.some((c) => c.id === id || c.kind === 'group')) return t;
    let changed = false;
    const content = t.content.map((c) => {
      if (c.id === id) {
        if (t.locked) throw new OpError('Track is locked');
        hit = true; changed = true;
        return fn(c);
      }
      if (c.kind !== 'group') return c;
      const inner = map(c.tracks);
      if (inner === c.tracks) return c;
      changed = true;
      return { ...c, tracks: inner };
    });
    return changed ? { ...t, content } : t;
  });
  const tracks = map(movie.tracks);
  if (!hit) throw new OpError('That content no longer exists.');
  return { ...movie, tracks };
}

/** Every character in the movie, nested ones included, in Timeline order. */
export function listCharacters(movie: Movie): Content[] {
  const out: Content[] = [];
  const walk = (tracks: Track[]): void => { for (const t of tracks) for (const c of t.content) if (c.kind === 'group') { if (c.character) out.push(c); walk(c.tracks); } };
  walk(movie.tracks);
  return out;
}

export function characterOf(movie: Movie, charId: string): Content | null {
  const c = findDeep(movie, charId)?.content;
  return c && c.kind === 'group' && c.character ? c : null;
}

function innerIds(g: Content): Set<string> {
  const ids = new Set<string>();
  for (const t of g.tracks) for (const c of t.content) ids.add(c.id);
  return ids;
}

/** Part name to inner content id, for the parts the character still has. */
export function partsByName(movie: Movie, charId: string): Record<string, string> {
  const g = characterOf(movie, charId);
  if (!g?.character) return {};
  const have = innerIds(g);
  const out: Record<string, string> = {};
  for (const [name, id] of Object.entries(g.character.parts)) if (have.has(id)) out[name] = id;
  return out;
}

/** The id of a part by name (exact first, then ignoring case and spaces); null when the character lacks it. */
export function partId(movie: Movie, charId: string, name: string): string | null {
  const parts = partsByName(movie, charId);
  if (parts[name]) return parts[name];
  const want = squash(name);
  for (const [n, id] of Object.entries(parts)) if (squash(n) === want) return id;
  return null;
}

export function partContent(movie: Movie, charId: string, name: string): Content | null {
  const id = partId(movie, charId, name);
  const g = characterOf(movie, charId);
  if (!id || !g) return null;
  for (const t of g.tracks) for (const c of t.content) if (c.id === id) return c;
  return null;
}

/** Of `names`, the ones the character has no part for (an action's or a starter's part list). */
export function missingParts(movie: Movie, charId: string, names: string[]): string[] {
  return names.filter((n) => !partId(movie, charId, n));
}

const squash = (s: string): string => s.toLowerCase().replace(/[\s_]+/g, '');

/** Names a group's inner contents as parts (a repeated name gets a number) and picks the mouth: the first inner Flipbook that looks like a mouth set. */
export function characterInfoOf(g: Content, name: string): CharacterInfo {
  const parts: Record<string, string> = {};
  let mouth: string | undefined;
  // top track first, as the Timeline lists them
  for (const t of g.tracks) for (const c of t.content) {
    const base = c.name.trim() || 'Part';
    let n = base, i = 2;
    while (parts[n]) n = `${base} ${i++}`;
    parts[n] = c.id;
    if (!mouth && c.kind === 'flipbook' && c.flip.some(looksLikeMouth)) mouth = c.id;
  }
  const clean = name.trim().slice(0, 80) || g.name;
  return mouth ? { name: clean, parts, mouth } : { name: clean, parts };
}

/** Makes a group a character named `name`; a character already keeps its other fields and gets its parts named again. */
export function makeCharacter(movie: Movie, groupId: string, name: string): Movie {
  const g = findDeep(movie, groupId)?.content;
  if (!g) throw new OpError('That content no longer exists.');
  if (g.kind !== 'group') throw new OpError('Make Character needs one group.');
  if (!g.tracks.some((t) => t.content.length)) throw new OpError('That group is empty.');
  return updateDeep(movie, groupId, (c) => {
    const info = characterInfoOf(c, name);
    const kept = c.character ? { ...c.character, ...info } : info;
    if (!info.mouth) delete kept.mouth;
    return { ...c, name: info.name, character: kept };
  });
}

/** Turns a character back into a plain group. */
export function clearCharacter(movie: Movie, groupId: string): Movie {
  return updateDeep(movie, groupId, (c) => {
    const { character: _drop, ...rest } = c;
    return rest as Content;
  });
}

/**
 * Puts a mouth chart Flipbook in place of the character's `mouth` part: same id, name, parent, pivot, transform, keys
 * and timing, so whatever followed the old mouth follows the chart. With no `mouth` part it goes on a new inner track
 * on top, following `head` when there is one. Sets the character's mouth to it.
 */
export function attachMouthChart(movie: Movie, charId: string, flipbook: Content): Movie {
  if (flipbook.kind !== 'flipbook') throw new OpError('That content is not a flipbook.');
  const g = characterOf(movie, charId);
  if (!g?.character) throw new OpError('That content is not a character.');
  const oldId = partId(movie, charId, 'mouth');
  const head = partId(movie, charId, 'head');
  return updateDeep(movie, charId, (c) => {
    const ch = c.character as CharacterInfo;
    let id: string;
    let tracks: Track[];
    if (oldId) {
      id = oldId;
      tracks = c.tracks.map((t) => (t.content.some((x) => x.id === oldId) ? { ...t, content: t.content.map((x) => (x.id === oldId ? {
        ...flipbook, id: x.id, name: x.name, start: x.start, duration: x.duration, offset: 0, transform: x.transform, keys: x.keys,
        ...(x.parent ? { parent: x.parent } : {}), ...(x.pivot ? { pivot: x.pivot } : {}), ...(x.hidden ? { hidden: x.hidden } : {}),
      } : x)) } : t));
    } else {
      id = flipbook.id;
      const item: Content = { ...flipbook, name: 'mouth', start: 0, duration: Math.max(1, c.duration), ...(head ? { parent: head } : {}) };
      tracks = [{ id: uid('t'), name: 'mouth', hidden: false, content: [item] }, ...c.tracks];
    }
    const parts = oldId ? ch.parts : { ...ch.parts, mouth: id };
    return { ...c, tracks, character: { ...ch, parts, mouth: id } };
  });
}
