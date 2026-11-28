// A speech server the person runs on this computer. The window cannot reach it (the page's content policy allows
// the engine only), so both calls go through the engine's relay, which also keeps them to this computer.
import { engineFetch } from './models';

export interface ServerSettings { url: string; model: string; voice: string; speed: number }
export const SERVER_DEFAULTS: ServerSettings = { url: 'http://127.0.0.1:8080', model: '', voice: '', speed: 1 };

const BASE = '/api/speech-server';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const message = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'The speech server could not be reached.');

/** Whether a speech server answers at `url`, and the models it lists. Never rejects: the reason is in `error`. */
export async function checkServer(url: string): Promise<{ ok: boolean; models: string[]; error: string }> {
  try {
    const res = await engineFetch(`${BASE}/check`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url }) });
    const body = (await res.json()) as { ok?: unknown; models?: unknown; error?: unknown };
    const models = Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === 'string') : [];
    return { ok: body.ok === true, models, error: typeof body.error === 'string' ? body.error : '' };
  } catch (e) {
    return { ok: false, models: [], error: message(e) };
  }
}

/** The text spoken by the server, as the sound file it answered with. Rejects with the engine's sentence. */
export async function speakOnServer(text: string, settings: ServerSettings, signal?: AbortSignal): Promise<Blob> {
  const { url, model, voice, speed } = settings;
  const res = await engineFetch(`${BASE}/speak`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url, model, voice, input: text, speed }), signal });
  const type = res.headers.get('Content-Type') ?? 'audio/wav';
  return new Blob([await res.arrayBuffer()], { type });
}
