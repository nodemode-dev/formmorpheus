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
  };
  btn.addEventListener('click', () => { dialog ??= new LibraryFolderDialog(); void dialog.show(() => { void tip(); }); });
  document.addEventListener('fm:library-changed', () => { void tip(); });
  void tip();
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
