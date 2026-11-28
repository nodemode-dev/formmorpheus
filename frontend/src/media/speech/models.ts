// The engine's side of the speech model sets: what is installed, and the download, cancel and remove of each set.
// Requests go through the window's fetch, which io/window-key.ts has taught to carry the window key.
import { ApiError } from '../../io/api';
import { MODELS_BASE as BASE, fileUrl as fileUrlOf } from './paths';

export type SpeechSet = 'voice' | 'listen';
export interface SetTask { state: 'idle' | 'downloading' | 'failed' | 'cancelled'; done: number; total: number; error: string }
export interface SetState { installed: boolean; bytes: number; files: number; licence: string; task: SetTask }

export const ENGINE_DOWN = 'The engine is not running.';

/** A fetch of the engine that fails with the engine's own sentence. An abort is passed on as it is. */
export async function engineFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try { res = await fetch(path, init); } catch (e) {
    if ((e as { name?: unknown } | null)?.name === 'AbortError') throw e;
    throw new ApiError(ENGINE_DOWN, 0);
  }
  if (res.ok) return res;
  let detail = '';
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body?.detail === 'string') detail = body.detail;
  } catch { /* not JSON */ }
  throw new ApiError(detail || res.statusText || `Request failed (${res.status})`, res.status);
}

async function sets(method: 'GET' | 'POST' | 'DELETE', path = ''): Promise<Record<SpeechSet, SetState>> {
  const res = await engineFetch(`${BASE}${path}`, { method });
  const body = (await res.json().catch(() => null)) as { sets?: Record<SpeechSet, SetState> } | null;
  if (!body?.sets?.voice || !body.sets.listen) throw new ApiError('The engine gave an answer FormMorpheus could not read.', res.status);
  return body.sets;
}

export function speechModels(): Promise<Record<SpeechSet, SetState>> { return sets('GET'); }
/** Starts the set's download in the engine; poll speechModels() for its progress. */
export function downloadSet(set: SpeechSet): Promise<Record<SpeechSet, SetState>> { return sets('POST', `/${set}/download`); }
export function cancelSet(set: SpeechSet): Promise<Record<SpeechSet, SetState>> { return sets('POST', `/${set}/cancel`); }
export function removeSet(set: SpeechSet): Promise<Record<SpeechSet, SetState>> { return sets('DELETE', `/${set}`); }

export function fileUrl(set: SpeechSet, path: string): string { return fileUrlOf(set, path); }
