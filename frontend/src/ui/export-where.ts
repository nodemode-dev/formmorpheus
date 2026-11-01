// Where an export goes when the person chooses a folder: the desktop app's folder dialog (the engine then writes the
// files), or the browser's own directory picker where it has one. Without either, the file is downloaded as before.
import { unzipSync } from 'fflate';
import { t } from './i18n';

export type Dest = { kind: 'browser'; dir: FileSystemDirectoryHandle } | { kind: 'engine'; dir: string };

type DirPicker = (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
const picker = (): DirPicker | undefined => (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
const desktop = (): boolean => '__TAURI_INTERNALS__' in window;

export const canPickFolder = (): boolean => desktop() || typeof picker() === 'function';

/** Asks for a folder: null when the person cancels, 'unavailable' when the platform refuses the dialog (the browser wants a click
 *  just before it, which a started-from-elsewhere export does not have), so the caller falls back to a download. */
export async function pickDestination(): Promise<Dest | null | 'unavailable'> {
  try {
    if (desktop()) {
      const core = await import('@tauri-apps/api/core');
      const got = await core.invoke<string | string[] | null>('plugin:dialog|open', { options: { directory: true, multiple: false, title: t('Choose where to save') } });
      return typeof got === 'string' ? { kind: 'engine', dir: got } : null;
    }
    const pick = picker();
    if (!pick) return 'unavailable';
    const t0 = performance.now();
    try { return { kind: 'browser', dir: await pick.call(window, { mode: 'readwrite', id: 'fm-export' }) }; } catch (e) {
      // a person needs a moment to cancel: an instant refusal (no dialog could be shown) is not a cancel
      return e instanceof DOMException && e.name === 'AbortError' && performance.now() - t0 > 700 ? null : 'unavailable';
    }
  } catch { return 'unavailable'; }
}

const bad = /[\\/:*?"<>|\u0000-\u001f]/g;
const clean = (s: string): string => s.replace(bad, '-').replace(/^\.+/, '') || 'export';

async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try { await dir.getFileHandle(name); return true; } catch { /* not a file */ }
  try { await dir.getDirectoryHandle(name); return true; } catch { return false; }
}

/** The first name not taken in the folder: "name", "name 2", "name 3". */
async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n < 10000; n++) {
    const cand = n === 1 ? name : `${stem} ${n}${ext}`;
    if (!(await exists(dir, cand))) return cand;
  }
  return `${stem} ${Date.now()}${ext}`;
}

async function put(dir: FileSystemDirectoryHandle, name: string, data: Blob | Uint8Array): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(data instanceof Blob ? data : new Blob([data as BlobPart]));
  await w.close();
}

async function engineError(res: Response): Promise<Error> {
  let detail = '';
  try { const b = (await res.json()) as { detail?: unknown }; if (typeof b?.detail === 'string') detail = b.detail; } catch { /* not JSON */ }
  return new Error(detail || t('The file could not be saved there.'));
}

/** Saves one file into the chosen folder without replacing anything; returns where it went. */
export async function saveFileTo(dest: Dest, blob: Blob, name: string): Promise<string> {
  if (dest.kind === 'browser') {
    const free = await freeName(dest.dir, clean(name));
    await put(dest.dir, free, blob);
    return `${dest.dir.name}/${free}`;
  }
  const res = await fetch(`/api/save-to/file?dir=${encodeURIComponent(dest.dir)}&name=${encodeURIComponent(clean(name))}`, { method: 'POST', body: blob });
  if (!res.ok) throw await engineError(res);
  return ((await res.json()) as { path: string }).path;
}

/** Turns the zip of a picture sequence into a folder of pictures named after the movie; returns where and how many. */
export async function saveFramesTo(dest: Dest, zip: Blob, folder: string): Promise<{ where: string; files: number }> {
  if (dest.kind === 'engine') {
    const res = await fetch(`/api/save-to/frames?dir=${encodeURIComponent(dest.dir)}&folder=${encodeURIComponent(clean(folder))}`, { method: 'POST', body: zip });
    if (!res.ok) throw await engineError(res);
    const r = (await res.json()) as { path: string; files: number };
    return { where: r.path, files: r.files };
  }
  const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  const name = await freeName(dest.dir, clean(folder));
  const sub = await dest.dir.getDirectoryHandle(name, { create: true });
  let files = 0;
  for (const [path, bytes] of Object.entries(entries)) {
    const leaf = path.split('/').pop() ?? '';
    if (!leaf || path.endsWith('/')) continue;
    await put(sub, clean(leaf), bytes);
    files++;
  }
  return { where: `${dest.dir.name}/${name}`, files };
}
