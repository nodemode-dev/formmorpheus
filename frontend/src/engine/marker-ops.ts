// Markers: named, coloured cue points on the ruler. Stored in Movie.markers, written only once one exists.
import { uid } from './model';
import { OpError } from './ops';
import type { Marker, Movie } from './types';

export const MARKER_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;

function sorted(list: Marker[]): Marker[] {
  return [...list].sort((a, b) => a.frame - b.frame);
}

function withMarkers(movie: Movie, list: Marker[]): Movie {
  const next: Movie = { ...movie };
  if (list.length) next.markers = sorted(list); else delete next.markers;
  return next;
}

export function markersOf(movie: Movie): Marker[] {
  return movie.markers ?? [];
}

export function markerAtFrame(movie: Movie, frame: number): Marker | null {
  return markersOf(movie).find((k) => k.frame === frame) ?? null;
}

export function addMarker(movie: Movie, frame: number, name = ''): { movie: Movie; id: string } {
  const f = Math.max(0, Math.round(frame));
  if (markerAtFrame(movie, f)) throw new OpError('There is already a marker on this frame.');
  const m: Marker = { id: uid('mk'), frame: f, name };
  return { movie: withMarkers(movie, [...markersOf(movie), m]), id: m.id };
}

export interface MarkerPatch { name?: string; color?: string | null }

export function patchMarker(movie: Movie, id: string, p: MarkerPatch): Movie {
  if (!markersOf(movie).some((k) => k.id === id)) throw new OpError('That marker no longer exists.');
  return withMarkers(movie, markersOf(movie).map((k) => {
    if (k.id !== id) return k;
    const n: Marker = { ...k };
    if (p.name !== undefined) n.name = p.name.slice(0, 80);
    if (p.color !== undefined) { if (p.color) n.color = p.color; else delete n.color; }
    return n;
  }));
}

export function moveMarker(movie: Movie, id: string, frame: number): Movie {
  const f = Math.max(0, Math.round(frame));
  const list = markersOf(movie);
  if (!list.some((k) => k.id === id)) throw new OpError('That marker no longer exists.');
  if (list.some((k) => k.id !== id && k.frame === f)) throw new OpError('There is already a marker on that frame.');
  return withMarkers(movie, list.map((k) => (k.id === id ? { ...k, frame: f } : k)));
}

export function deleteMarker(movie: Movie, id: string): Movie {
  return withMarkers(movie, markersOf(movie).filter((k) => k.id !== id));
}

/** The frame of the next marker after `frame` (or the previous before it); null when there is none. */
export function stepMarker(movie: Movie, frame: number, dir: 1 | -1): number | null {
  const list = markersOf(movie);
  if (dir === 1) { for (const k of list) if (k.frame > frame) return k.frame; return null; }
  for (let i = list.length - 1; i >= 0; i--) if (list[i].frame < frame) return list[i].frame;
  return null;
}
