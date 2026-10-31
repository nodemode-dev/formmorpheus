import '../styles/rw-extras.css';
import { api, capabilities, downloadBlob } from '../io/api';
import { LibraryFolderDialog } from './library-folder';
import { t } from './i18n';
import { toast } from './toast';

/** Storage choices of the Theater: the side panel button that opens the library folder choice (its tooltip shows the
 *  folder in use) and Copy to Folder for movies (a second storage). Desktop picks the folder with the system dialog;
 *  the browser downloads each movie file instead. */

let dialog: LibraryFolderDialog | null = null;

/** Wires the side panel button: click opens Library Folder, the tooltip follows the folder in use. */
export function mountStorageButton(btn: HTMLElement): void {
  const tip = async (): Promise<void> => {
    const caps = await capabilities();
    const label = t('Library folder');
    btn.title = caps?.libraryDir ? `${label}: ${caps.libraryDir}` : label;
    // the button names the storage location in use, like the reference's location picker
    const info = await locations();
    const name = !info ? label : info.source === 'default' ? t('On This Computer') : info.icloud && info.dir === info.icloud ? t('iCloud Drive') : (info.dir.split(/[\\/]/).filter(Boolean).pop() ?? label);
    const span = btn.lastElementChild;
    if (span && span.textContent !== name) span.textContent = name;
  };
  btn.addEventListener('click', () => { dialog ??= new LibraryFolderDialog(); void dialog.show(() => { void tip(); }); });
  document.addEventListener('fm:library-changed', () => { void tip(); });
  void tip();
}

interface Locations { dir: string; default: string; source: string; icloud: string | null }

/** The library's current folder and the iCloud Drive folder when this computer has one (null when the engine is away). */
export async function locations(): Promise<Locations | null> {
  try { const r = await fetch('/api/system/library'); return r.ok ? ((await r.json()) as Locations) : null; } catch { return null; }
}

/** True when this computer has an iCloud Drive folder the movies can be copied to. */
export async function hasIcloud(): Promise<boolean> {
  return !!(await locations())?.icloud;
}

/** Copy to iCloud Drive: the movies' files go to the iCloud Drive folder; never overwrites. */
export async function copyMoviesToIcloud(names: string[]): Promise<void> {
  const dir = (await locations())?.icloud;
  if (!dir) { toast(t('iCloud Drive was not found on this computer.'), 'error'); return; }
  try {
    for (const n of names) await api.copyMovieTo(n, dir);
    toast(names.length === 1 ? `${t('Copied to')} ${dir}.` : `${names.length} ${t('movies copied')} ${dir}.`);
  } catch (err) { toast((err as Error).message, 'error'); }
}

/** The system folder picker (desktop app), or null when cancelled or unavailable. */
async function pickFolder(): Promise<string | null> {
  if (!('__TAURI_INTERNALS__' in window)) return null;
  const core = await import('@tauri-apps/api/core');
  const got = await core.invoke<string | string[] | null>('plugin:dialog|open', { options: { directory: true, multiple: false, title: t('Copy to Folder') } });
  return typeof got === 'string' ? got : null;
}

/** Copies the movies' files to a folder the person picks; never overwrites (the engine numbers a taken name). */
export async function copyMoviesToFolder(names: string[]): Promise<void> {
  if (!names.length) return;
  try {
    if (!('__TAURI_INTERNALS__' in window)) {
      for (const n of names) downloadBlob(await api.readMovie(n), `${n}.fmo`);
      toast(names.length === 1 ? 'Movie file downloaded.' : `${names.length} movie files downloaded.`);
      return;
    }
    const dir = await pickFolder();
    if (!dir) return;
    for (const n of names) await api.copyMovieTo(n, dir);
    toast(names.length === 1 ? `${t('Copied to')} ${dir}.` : `${names.length} ${t('movies copied')} ${dir}.`);
  } catch (err) { toast((err as Error).message, 'error'); }
}
