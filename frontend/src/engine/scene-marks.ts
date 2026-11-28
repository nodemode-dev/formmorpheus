// Scenes: Movie.scenes, named stretches of the one timeline. A scene runs from its start to the next scene's start.
import { uid } from './model';
import type { Movie, SceneMark } from './types';

export interface SceneSpan { mark: SceneMark; index: number; start: number; end: number }

const NAME_MAX = 80;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The list as read from a file, made safe and in order; null when there is none. */
export function tidyScenes(raw: unknown, duration: number): SceneMark[] | null {
  if (!Array.isArray(raw)) return null;
  const last = Math.max(0, Math.floor(Number.isFinite(duration) ? duration : 1) - 1);
  const seen = new Set<string>();
  const list: SceneMark[] = [];
  for (const r of raw) {
    if (!isRecord(r) || typeof r.start !== 'number' || !Number.isFinite(r.start)) continue;
    const start = Math.max(0, Math.round(r.start));
    if (start > last) continue;
    const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : uid('sc');
    seen.add(id);
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, NAME_MAX) : '';
    list.push({ id, name, start });
  }
  if (!list.length) return null;
  list.sort((a, b) => a.start - b.start);
  const out: SceneMark[] = [];
  for (const s of list) if (!out.length || out[out.length - 1].start !== s.start) out.push(s);
  out[0] = { ...out[0], start: 0 };
  out.forEach((s, i) => { if (!s.name) out[i] = { ...s, name: `Scene ${i + 1}` }; });
  return out;
}

export function scenesOf(m: Movie): SceneMark[] {
  return m.scenes ?? [];
}

/** Every scene with its stretch (end not included); the last runs to the movie's end. */
export function sceneSpans(m: Movie): SceneSpan[] {
  const list = scenesOf(m);
  return list.map((mark, index) => ({ mark, index, start: mark.start, end: Math.max(mark.start + 1, list[index + 1]?.start ?? m.duration) }));
}

export function sceneSpan(m: Movie, id: string): SceneSpan | null {
  return sceneSpans(m).find((s) => s.mark.id === id) ?? null;
}

/** The scene the frame is in; null when the movie has no scenes. */
export function sceneAt(m: Movie, frame: number): SceneSpan | null {
  const spans = sceneSpans(m);
  for (let i = spans.length - 1; i >= 0; i--) if (frame >= spans[i].start) return spans[i];
  return spans[0] ?? null;
}

/** The scene whose stretch is the movie's loop range, if one is. */
export function focusedScene(m: Movie): SceneSpan | null {
  if (m.loopFrom === undefined || m.loopTo === undefined) return null;
  return sceneSpans(m).find((s) => s.start === m.loopFrom && s.end - 1 === m.loopTo) ?? null;
}

/** A name of the form the caller gives (with {n}) that no scene has yet. */
export function freeSceneName(m: Movie, pattern: (n: number) => string): string {
  const used = new Set(scenesOf(m).map((s) => s.name));
  let n = scenesOf(m).length + 1;
  while (used.has(pattern(n))) n++;
  return pattern(n);
}
