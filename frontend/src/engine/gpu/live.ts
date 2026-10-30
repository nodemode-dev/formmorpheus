// What a movie still draws from: the ids of its contents and of the pictures they point at. The GPU compositor
// releases the textures of anything else when the movie changes (a deleted content leaves nothing behind).
import type { Content, DrawingLayer, Movie, Track } from '../types';

export interface LiveSet { contents: Set<string>; assets: Set<string> }

export function liveSet(movie: Movie): LiveSet {
  const contents = new Set<string>();
  const assets = new Set<string>();
  const layers = (ls: DrawingLayer[]): void => {
    for (const l of ls) {
      if (l.pixels) assets.add(l.pixels);
      if (l.mask) assets.add(l.mask);
    }
  };
  const walk = (tracks: Track[]): void => {
    for (const t of tracks) for (const c of t.content) one(c);
  };
  const one = (c: Content): void => {
    contents.add(c.id);
    if (c.asset) assets.add(c.asset);
    layers(c.layers);
    for (const t of c.flip) for (const f of t.frames) layers(f.layers);
    if (c.tracks.length) walk(c.tracks);
  };
  walk(movie.tracks);
  return { contents, assets };
}
