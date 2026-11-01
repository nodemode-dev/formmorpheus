// The size a picture or video is shown at when it reads 100 percent: its fit to the Stage. A fresh import
// stores scale 3.6 for a 400 px picture on a 1440 px Stage, and shows 100 percent, as the spec says.
// Display only: the stored values and old files are untouched. Pure, no DOM.
import type { Content, Movie } from './types';

/** Stored scale that reads as 100 percent for a content: the fit scale of an image or video, else 1. */
export function fitBase(movie: Movie, c: Content): number {
  if (c.kind !== 'image' && c.kind !== 'video') return 1;
  const a = c.asset ? movie.assets[c.asset] : undefined;
  if (!a || !(a.width > 0 && a.height > 0)) return 1;
  const k = Math.min(movie.width / a.width, movie.height / a.height);
  return Number.isFinite(k) && k > 0 ? k : 1;
}

/** Whether a Move channel id is one of the two scales (the ones read relative to the fit). */
export function isScaleChannel(id: string): boolean {
  return id === 'scaleX' || id === 'scaleY';
}
