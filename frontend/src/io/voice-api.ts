// AI voices on the engine (/api/voice): the built-in voice and its one-time setup, a voice app on this computer,
// and an online voice with the person's own key. Writes carry the window key like every engine call.
import { ApiError, serviceReady } from './api';

export type VoiceEngine = 'builtin' | 'local' | 'online';
export interface VoiceCue { start: number; end: number; text: string }
export interface VoiceOption { id: string; name: string; language?: string; group?: string }
/** The one-time setup of the built-in voice: finding Python, making its runtime, fetching the model. */
export interface VoiceJob { state: 'running' | 'done' | 'failed' | 'cancelled'; step: 'python' | 'runtime' | 'model'; done: number; total: number; error: string }
export interface BuiltinStatus { ready: boolean; runtime: boolean; model: boolean; python: string | null; folder: string; bytes: number; job: VoiceJob | null }
export interface LocalStatus { base: string; model: string; voice: string; hasKey: boolean }
export interface OnlineStatus { hasKey: boolean; canStore: boolean }
export interface VoiceStatus { builtin: BuiltinStatus; local: LocalStatus; online: OnlineStatus }
export interface LocalProbe { ok: boolean; models: string[]; voices: VoiceOption[]; error: string }
export interface SpeakRequest { engine: VoiceEngine; text: string; voice?: string; language?: string; speed?: number; model?: string }
export interface Spoken { id: string; mime: string; engine: VoiceEngine; voice: string; seconds: number | null; cues: VoiceCue[]; text: string; bytes: number }

const NOT_RUNNING = 'The FormMorpheus engine service is not running. Start it with ./formmorpheus.';
const json = { 'Content-Type': 'application/json' };

async function call(path: string, init?: RequestInit): Promise<Response> {
  if (!(await serviceReady())) throw new ApiError(NOT_RUNNING, 0);
  let res: Response;
  try { res = await fetch(`/api/voice${path}`, init); } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(NOT_RUNNING, 0);
  }
  if (!res.ok) {
    let detail = '';
    try { const body = (await res.json()) as { detail?: unknown }; if (typeof body?.detail === 'string') detail = body.detail; } catch { /* not JSON */ }
    throw new ApiError(detail || res.statusText || `Request failed (${res.status})`, res.status);
  }
  return res;
}

const send = (method: string, body?: unknown, signal?: AbortSignal): RequestInit => ({ method, ...(body === undefined ? {} : { headers: json, body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });

export const voiceApi = {
  async status(): Promise<VoiceStatus> { return (await (await call('/status')).json()) as VoiceStatus; },
  async setupBuiltin(): Promise<VoiceJob> { return (await (await call('/builtin/setup', send('POST'))).json()) as VoiceJob; },
  async builtinJob(): Promise<VoiceJob | null> { return ((await (await call('/builtin/job')).json()) as { job: VoiceJob | null }).job; },
  async cancelBuiltin(): Promise<void> { await call('/builtin/job', send('DELETE')); },
  async removeBuiltin(): Promise<void> { await call('/builtin', send('DELETE')); },
  async builtinVoices(): Promise<VoiceOption[]> { return ((await (await call('/builtin/voices')).json()) as { voices: VoiceOption[] }).voices; },
  async saveLocal(v: { base: string; model: string; voice: string; key?: string | null }): Promise<LocalStatus> { return (await (await call('/local', send('PUT', v))).json()) as LocalStatus; },
  async probeLocal(base: string): Promise<LocalProbe> { return (await (await call('/local/probe', send('POST', { base }))).json()) as LocalProbe; },
  async setOnlineKey(key: string): Promise<OnlineStatus> { return (await (await call('/online/key', send('PUT', { key }))).json()) as OnlineStatus; },
  async clearOnlineKey(): Promise<OnlineStatus> { return (await (await call('/online/key', send('DELETE'))).json()) as OnlineStatus; },
  async onlineVoices(): Promise<VoiceOption[]> { return ((await (await call('/online/voices')).json()) as { voices: VoiceOption[] }).voices; },
  /** Speaks the text; the sound waits on the engine until `audio` fetches it. */
  async speak(body: SpeakRequest, signal?: AbortSignal): Promise<Spoken> { return (await (await call('/speak', send('POST', body, signal))).json()) as Spoken; },
  async audio(id: string): Promise<Blob> { return (await call(`/audio/${encodeURIComponent(id)}`)).blob(); },
  async drop(id: string): Promise<void> { await call(`/audio/${encodeURIComponent(id)}`, send('DELETE')).catch(() => undefined); },
};
