// First sizes for the paint family (v0.17.0): an opaque paint, a texture and a halftone are laid with a loaded brush, so
// at a pen's 14 px they read as a thin marker line and a weave or a dot screen shows a tick or two. A spray is the
// opposite: its cloud must stay a mist, not fill the page. Pure maths on the brush; the host's size curve calls it.

import type { Brush } from './types';

const PAINTS = /^(round paint|flat paint|gouache|acrylic|filbert)$/;
const CLOTH = /^(canvas weave|canvas|fabric weave|linen|burlap|concrete|paper tooth|plaster|stone|bark|rust|weathered)$/;
const SPRAYS = /^(spray can|fat cap|thin cap|grit spray)$/;

/** The size in pixels a brush first opens at, given the host's own pick `want`. */
export function paintWant(b: Brush, want: number): number {
  const n = b.name.toLowerCase();
  const room = (k: number, cap: number): number => Math.min(b.maxSize * k, cap);
  if (PAINTS.test(n)) return Math.max(want, room(0.7, 56));
  if (CLOTH.test(n)) return Math.max(want, room(0.8, 48));
  if (n === 'halftone') return Math.max(want, room(0.6, 56));
  if (n === 'rough hatch') return Math.max(want, room(0.9, 40));
  if (n === 'fade spray') return room(0.35, 56);
  if (SPRAYS.test(n)) return room(0.35, 44);
  return want;
}
