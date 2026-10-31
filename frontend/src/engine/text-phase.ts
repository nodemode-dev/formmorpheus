// Where a Text block is in its build on / build off: the phase the one layout is painted at (CPU draw, GPU text picture, export).
import { easeCurve, type Animated } from './keys';
import { layoutText, textSettled } from './text-layout';
import type { TextPhase } from './text-anim';
import type { Content, Movie } from './types';

/** The phase for a frame of `c` (`local` frames since its start), or null when the block has no animators. */
export function textPhase(c: Content, local: number, a: Animated | undefined, movie: Movie): TextPhase | null {
  const s = c.text;
  if (!s || !s.anim) return null;
  const k = a?.textAnim;
  return { t: local, dur: c.duration, fps: movie.fps, inP: k ? k.in : null, outP: k ? k.out : null, typeP: k ? k.type : null, ease: easeCurve };
}

/** A string that changes only when the picture of the block changes (empty when the animators leave it at rest). */
export function phaseSig(c: Content, movie: Movie, ph: TextPhase | null): string {
  const s = c.text;
  if (!s || !ph) return '';
  if (textSettled(s, layoutText(s, movie), ph)) return 'rest';
  return `${ph.t}|${ph.inP ?? ''}|${ph.outP ?? ''}|${ph.typeP ?? ''}|${ph.dur}`;
}
