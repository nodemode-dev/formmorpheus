// Which key lane of the selected block holds the keyboard focus in Keyframe and Perform modes: Up and Down step it
// through the block's lanes, then on to the neighbouring track. The Timeline draws a ring on it.
import type { Content, KeyKind } from '../engine/types';

export const laneFocus: { id: string | null; kind: KeyKind | null; onChange: (() => void) | null } = { id: null, kind: null, onChange: null };

/** Steps the focus one lane up (-1) or down (1) inside `c`; false when it is already at that end (or the block has no lanes) so the caller moves to the next track. */
export function stepLaneFocus(c: Content, dir: -1 | 1): boolean {
  const kinds = c.keys.map((l) => l.kind);
  if (!kinds.length) return false;
  const at = laneFocus.id === c.id && laneFocus.kind ? kinds.indexOf(laneFocus.kind) : -1;
  const next = at < 0 ? (dir === 1 ? 0 : kinds.length - 1) : at + dir;
  if (next < 0 || next >= kinds.length) { laneFocus.id = null; laneFocus.kind = null; laneFocus.onChange?.(); return false; }
  laneFocus.id = c.id;
  laneFocus.kind = kinds[next];
  laneFocus.onChange?.();
  return true;
}
