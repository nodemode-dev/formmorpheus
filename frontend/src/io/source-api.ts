// A character's linked SVG on the engine (/api/files/stat, /api/files/source), and the desktop app's file dialog that
// gives a real path. The Python engine serves both routes; the iPad's engine has neither, so the window never asks there.
import type { SourceLink } from '../engine/types';
import { platform } from '../platform';
import { t } from '../ui/i18n';
import { LINKED_SOURCE_LEN, LINKED_SOURCES_MAX, loadPrefs, updatePrefs } from '../ui/prefs';
import { ApiError, serviceReady } from './api';

const NOT_RUNNING = 'The FormMorpheus engine service is not running. Start it with ./formmorpheus.';

async function call(path: string): Promise<Response> {
  if (!(await serviceReady())) throw new ApiError(NOT_RUNNING, 0);
  let res: Response;
  try { res = await fetch(path, { cache: 'no-store' }); } catch { throw new ApiError(NOT_RUNNING, 0); }
  if (!res.ok) {
    let detail = '';
    try { const body = (await res.json()) as { detail?: unknown }; if (typeof body?.detail === 'string') detail = body.detail; } catch { /* not JSON */ }
    throw new ApiError(detail || res.statusText || `Request failed (${res.status})`, res.status);
  }
  return res;
}

const q = (path: string): string => `?path=${encodeURIComponent(path)}`;

/** True where a file dialog hands the window a real path (the desktop app): the only place links are made, followed and unlinked. */
export const canLinkPaths = (): boolean => platform.kind === 'desktop' && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Records that this computer linked a character to `path` (newest first, capped), so it is followed. */
export function trustSource(path: string): void {
  if (!path || path.length > LINKED_SOURCE_LEN) return;
  const cur = loadPrefs().linkedSources;
  if (cur[0] === path) return;
  updatePrefs({ linkedSources: [path, ...cur.filter((p) => p !== path)].slice(0, LINKED_SOURCES_MAX) });
}

/** True when this computer made the link to exactly `path`; a link that came inside a movie, a paste or a character is not. */
export const isTrusted = (path: string): boolean => loadPrefs().linkedSources.includes(path);

export const sourceApi = {
  /** The file's stat now; ApiError 404 when there is no file at the path. */
  async stat(path: string): Promise<SourceLink> {
    const s = (await (await call(`/api/files/stat${q(path)}`)).json()) as { size: number; mtime: number; sha256: string };
    return { path, size: s.size, mtime: s.mtime, sha256: s.sha256 };
  },
  /** The file's text and the stat of exactly those bytes. */
  async read(path: string): Promise<{ text: string; link: SourceLink }> {
    const res = await call(`/api/files/source${q(path)}`);
    const text = await res.text();
    const h = (k: string): string => res.headers.get(k) ?? '';
    return { text, link: { path, size: Number(h('X-Source-Size')) || 0, mtime: Number(h('X-Source-Mtime')) || 0, sha256: h('X-Source-Sha256') } };
  },
};

/** The desktop app's open dialog for one SVG: its path, or null when cancelled or not available. */
export async function pickSvgPath(title: string, near?: string): Promise<string | null> {
  if (!canLinkPaths()) return null;
  try {
    const core = await import('@tauri-apps/api/core');
    const got = await core.invoke<string | string[] | null>('plugin:dialog|open', {
      options: { multiple: false, directory: false, title: t(title), filters: [{ name: 'SVG', extensions: ['svg'] }], ...(near ? { defaultPath: near } : {}) },
    });
    return typeof got === 'string' ? got : null;
  } catch { return null; }
}
