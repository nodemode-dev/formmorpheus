// The Characters library on the engine (/api/characters): one .fmo per character in the data folder's Characters
// folder. Writes carry the window key like every engine call (io/window-key.ts adds it to /api requests).
import { ApiError, serviceReady } from './api';

export interface CharacterItem { name: string; file: string; path: string; size: number; modified: number; created?: number }

const NOT_RUNNING = 'The FormMorpheus engine service is not running. Start it with ./formmorpheus.';

const at = (name: string): string => `/api/characters/${encodeURIComponent(name)}`;

async function call(path: string, init?: RequestInit): Promise<Response> {
  if (!(await serviceReady())) throw new ApiError(NOT_RUNNING, 0);
  let res: Response;
  try { res = await fetch(path, init); } catch { throw new ApiError(NOT_RUNNING, 0); }
  if (!res.ok) {
    let detail = '';
    try { const body = (await res.json()) as { detail?: unknown }; if (typeof body?.detail === 'string') detail = body.detail; } catch { /* not JSON */ }
    throw new ApiError(detail || res.statusText || `Request failed (${res.status})`, res.status);
  }
  return res;
}

const json = { 'Content-Type': 'application/json' };

export const charactersApi = {
  /** Newest first. */
  async list(): Promise<{ folder: string; items: CharacterItem[] }> {
    const body = (await (await call('/api/characters')).json()) as { folder?: string; items?: CharacterItem[] };
    return { folder: body.folder ?? '', items: body.items ?? [] };
  },
  async read(name: string): Promise<Blob> {
    return (await call(at(name))).blob();
  },
  /** Replaces a character of the same name: the window picks a free name unless the person chose to replace. */
  async write(name: string, data: Blob): Promise<CharacterItem> {
    return (await (await call(at(name), { method: 'PUT', body: data, headers: { 'Content-Type': 'application/octet-stream' } })).json()) as CharacterItem;
  },
  /** 409 when `to` is taken. */
  async rename(name: string, to: string): Promise<CharacterItem> {
    return (await (await call(`${at(name)}/rename`, { method: 'POST', body: JSON.stringify({ to }), headers: json })).json()) as CharacterItem;
  },
  /** To Recently Deleted. */
  async remove(name: string): Promise<void> {
    await call(at(name), { method: 'DELETE' });
  },
  /** The poster's address for an <img>; `v` (the modified time) lets the browser keep it until the character changes. */
  posterUrl(name: string, v?: number): string {
    return `${at(name)}/poster${v ? `?v=${v}` : ''}`;
  },
};

/** The first of `base`, `base 2`, `base 3`... not in `taken`. */
export function freeName(base: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (n) => n.toLowerCase()));
  const clean = base.trim().replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Character';
  let n = clean, i = 2;
  while (used.has(n.toLowerCase())) n = `${clean} ${i++}`;
  return n;
}
