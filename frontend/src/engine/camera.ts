// Movie camera edits. The camera's keys live in Movie.camera as one 'camera' lane; the key operations of
// key-ops.ts work on a content, so a stand-in content carries the lane through them and back. Frames are
// movie frames. Pure, no DOM.
import { content } from './model';
import { OpError } from './ops';
import * as keyOps from './key-ops';
import { evalLane, laneOf } from './keys';
import { CAMERA_REST, cameraPose, type CameraPose } from './transform';
import type { Ease, Movie } from './types';

function standIn(movie: Movie) {
  return content('group', 0, Math.max(1, movie.duration), { keys: movie.camera?.keys ?? [] });
}

function store(movie: Movie, keys: ReturnType<typeof standIn>['keys']): Movie {
  if (!keys.length) {
    if (!movie.camera) return movie;
    const { camera: _drop, ...rest } = movie;
    return rest as Movie;
  }
  return { ...movie, camera: { keys } };
}

/** The camera at a frame, the rest pose when the movie has none. */
export function poseAt(movie: Movie, frame: number): CameraPose {
  return cameraPose(movie, frame) ?? CAMERA_REST;
}

/** Writes the camera's values (any subset) as keys at `frame`; the first key may add one at frame 0 so earlier frames stay at rest. */
export function setCameraKeys(movie: Movie, frame: number, values: Partial<CameraPose>, ease: Ease = 'linear'): Movie {
  const f = Math.max(0, Math.round(frame));
  let c = standIn(movie);
  if (!laneOf(c, 'camera')) {
    c = keyOps.addLane(c, 'camera', f, movie.addKeyAtStart, ease);
    c = keyOps.setExpanded(c, 'camera', false);
  }
  const lane = laneOf(c, 'camera');
  const have = lane ? evalLane(c, lane, f) : { ...CAMERA_REST };
  c = keyOps.setKeys(c, 'camera', f, { ...have, ...values });
  return store(movie, c.keys);
}

export function moveCameraKey(movie: Movie, from: number, to: number): Movie {
  return store(movie, keyOps.moveKey(standIn(movie), 'camera', from, Math.max(0, Math.min(movie.duration - 1, to))).keys);
}

export function deleteCameraKey(movie: Movie, at: number): Movie {
  return store(movie, keyOps.deleteKey(standIn(movie), 'camera', at).keys);
}

export function setCameraEase(movie: Movie, at: number, ease: Ease): Movie {
  return store(movie, keyOps.setEase(standIn(movie), 'camera', at, ease).keys);
}

/** A track fixed to the screen ignores the camera (titles, overlays). */
export function setTrackScreen(movie: Movie, trackId: string, on: boolean): Movie {
  if (!movie.tracks.some((t) => t.id === trackId)) throw new OpError('That track no longer exists.');
  return {
    ...movie,
    tracks: movie.tracks.map((t) => {
      if (t.id !== trackId) return t;
      if (on) return { ...t, screen: true as const };
      const { screen: _screen, ...rest } = t;
      return rest;
    }),
  };
}

export function removeCamera(movie: Movie): Movie {
  return store(movie, []);
}

export function setExpanded(movie: Movie, expanded: boolean): Movie {
  return store(movie, keyOps.setExpanded(standIn(movie), 'camera', expanded).keys);
}
