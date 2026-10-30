export interface Capabilities {
  app: string;
  version: string;
  platform: string;
  desktop: boolean;
  dataDir: string;
  dataDirSource: 'override' | 'portable' | 'default';
  libraryDir: string;
  projectExt: string;
}

export interface LibraryItem { name: string; file: string; path: string; modified: number; size: number }
export interface OutputItem { name: string; path: string; modified: number; size: number; kind: string }
export interface TrashItem { id: string; name: string; original: string; kind: 'movie' | 'export'; deleted: number; size: number; daysLeft: number }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

let serviceState: 'unknown' | 'up' | 'down' = 'unknown';
let caps: Promise<Capabilities | null> | null = null;
const serviceWatchers = new Set<(up: boolean) => void>();

export function serviceDown(): boolean { return serviceState === 'down'; }
export function onServiceChange(fn: (up: boolean) => void): () => void { serviceWatchers.add(fn); return () => { serviceWatchers.delete(fn); }; }
export async function serviceReady(): Promise<boolean> { await (caps ??= probe()); return serviceState === 'up'; }
export async function capabilities(): Promise<Capabilities | null> { return (caps ??= probe()); }

async function probe(): Promise<Capabilities | null> {
  const desktop = '__TAURI_INTERNALS__' in window;
  for (let i = 0; i < (desktop ? 10 : 1); i++) {
    try {
      const res = await fetch('/api/capabilities');
      if (res.ok) { const c = (await res.json()) as Capabilities; set('up'); return c; }
    } catch { /* not answering */ }
    if (i < 9 && desktop) await new Promise((r) => window.setTimeout(r, 500));
  }
  set('down');
  return null;
  function set(next: 'up' | 'down'): void { const was = serviceState; serviceState = next; if (was !== next) for (const fn of [...serviceWatchers]) fn(next === 'up'); }
}
if (typeof window !== 'undefined') window.addEventListener('focus', () => { if (serviceState === 'down') caps = probe(); });

const NOT_RUNNING = 'The formmorpheus engine service is not running. Start it with ./formmorpheus.';

async function request(path: string, init?: RequestInit): Promise<Response> {
  if (!(await serviceReady())) throw new ApiError(NOT_RUNNING, 0);
  let res: Response;
  try { res = await fetch(`/api${path}`, init); } catch { throw new ApiError(NOT_RUNNING, 0); }
  if (!res.ok) {
    let detail = '';
    try { const body = (await res.json()) as { detail?: unknown }; if (typeof body?.detail === 'string') detail = body.detail; } catch { /* not JSON */ }
    throw new ApiError(detail || res.statusText || `Request failed (${res.status})`, res.status);
  }
  return res;
}

const lib = (name: string): string => `/library/${encodeURIComponent(name)}`;

export const api = {
  async library(): Promise<LibraryItem[]> {
    return ((await (await request('/library')).json()) as { items: LibraryItem[] }).items;
  },
  async readMovie(name: string): Promise<Blob> {
    return (await request(lib(name))).blob();
  },
  async writeMovie(name: string, data: Blob): Promise<LibraryItem> {
    return (await (await request(lib(name), { method: 'PUT', body: data, headers: { 'Content-Type': 'application/octet-stream' } })).json()) as LibraryItem;
  },
  async renameMovie(name: string, to: string): Promise<LibraryItem> {
    return (await (await request(`${lib(name)}/rename`, { method: 'POST', body: JSON.stringify({ to }), headers: { 'Content-Type': 'application/json' } })).json()) as LibraryItem;
  },
  async duplicateMovie(name: string): Promise<LibraryItem> {
    return (await (await request(`${lib(name)}/duplicate`, { method: 'POST' })).json()) as LibraryItem;
  },
  async deleteMovie(name: string): Promise<void> {
    await request(lib(name), { method: 'DELETE' });
  },
  async outputs(): Promise<OutputItem[]> {
    try {
      const body = (await (await request('/exports')).json()) as { folder?: string; items: OutputItem[] };
      if (body.folder) exportsFolder = body.folder;
      return body.items;
    } catch { return []; }
  },
  async writeOutput(name: string, data: Blob): Promise<OutputItem> {
    return (await (await request(`/exports/${encodeURIComponent(name)}`, { method: 'PUT', body: data, headers: { 'Content-Type': 'application/octet-stream' } })).json()) as OutputItem;
  },
  async deleteOutput(name: string): Promise<void> {
    await request(`/exports/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },
  async trash(): Promise<TrashItem[]> {
    return ((await (await request('/trash')).json()) as { items: TrashItem[] }).items;
  },
  async restoreTrash(id: string): Promise<void> {
    await request(`/trash/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  },
  /** Deletes one item for good, or empties Recently Deleted when no id is given. */
  async purgeTrash(id?: string): Promise<void> {
    await request(id === undefined ? '/trash' : `/trash/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async stat(paths: string[]): Promise<Array<{ path: string; exists: boolean; size: number; modified: number }>> {
    return paths.map((path) => ({ path, exists: false, size: 0, modified: 0 }));
  },
  async thumbnail(by: { name?: string; path?: string }): Promise<Blob | null> {
    if (!by.name) return null;
    try { return await (await request(`${lib(by.name)}/poster`)).blob(); } catch { return null; }
  },
  /** A .fmo from an absolute path the operating system handed the app (double-click, Open With). */
  async readFile(path: string): Promise<Blob> {
    return (await request(`/files/read?path=${encodeURIComponent(path)}`)).blob();
  },
  async readPath(path: string): Promise<Blob | null> {
    const name = exportName(path);
    if (!name) return null;
    try { return await (await request(`/exports/${encodeURIComponent(name)}`)).blob(); } catch { return null; }
  },
};

let exportsFolder = '';

/** The export file name when `path` is a file in the Exports folder (as api.outputs lists it), else null. */
function exportName(path: string): string | null {
  if (!exportsFolder || !path.startsWith(exportsFolder)) return null;
  const rest = path.slice(exportsFolder.length).replace(/^[\\/]+/, '');
  return rest && !/[\\/]/.test(rest) ? rest : null;
}

/** Saves a blob through the browser's download (an anchor with the download attribute). */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Opens an export from the Exports page: downloads it. False when the path is not one of the kept exports. */
export async function openOutput(path: string): Promise<boolean> {
  const name = exportName(path);
  if (!name) return false;
  const blob = await api.readPath(path);
  if (blob) downloadBlob(blob, name);
  return !!blob;
}
