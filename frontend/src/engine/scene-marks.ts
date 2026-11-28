// Scenes: Movie.scenes, named stretches of the one timeline. A scene runs from its start to the next scene's start.
import type { SceneMark } from './types';

/** The list as read from a file, made safe and in order; null when there is none. */
export function tidyScenes(_raw: unknown, _duration: number): SceneMark[] | null {
  return null;
}
