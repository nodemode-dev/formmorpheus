import '../styles/rw-extras.css';
import { api, capabilities, downloadBlob } from '../io/api';
import { LibraryFolderDialog } from './library-folder';
import { t } from './i18n';
import { tf } from './i18n-fill';
import { toast } from './toast';
import { flipHome, flipToCloud, inCloudTheater } from './theater-flip';
import { platform } from '../platform';

/** Storage choices of the Theater: the side panel button that opens the library folder choice (its tooltip shows the
 *  folder in use) and Copy to Folder for movies (a second storage). Desktop picks the folder with the system dialog;
 *  the browser downloads each movie file instead. */

let dialog: LibraryFolderDialog | null = null;

/** Wires the side panel button: click opens Library Folder, the tooltip follows the folder in use. */
export function mountStorageButton(btn: HTMLElement): void {
  if (platform.kind === 'ipad') { mountIpadPlace(btn, 'ipad'); return; }
  const tip = async (): Promise<void> => {
    const caps = await capabilities();
    const label = t('Library folder');
    btn.title = caps?.libraryDir ? `${label}: ${caps.libraryDir}` : label;
    // the button names the storage location in use, like the reference's location picker
    const info = await locations();
    const cloud = await inCloudTheater();
    const name = cloud ? t('On This Computer') : !info ? label : info.source === 'default' ? t('On This Computer') : info.icloud && info.dir === info.icloud ? t('iCloud Drive') : (info.dir.split(/[\\/]/).filter(Boolean).pop() ?? label);
    const span = btn.lastElementChild;
    if (span && span.textContent !== name) span.textContent = name;
    btn.classList.toggle('is-here', !cloud);
  };
  // in the cloud Theater a click flips back to this computer's; otherwise it opens the folder choice
  btn.addEventListener('click', () => { void inCloudTheater().then((cloud) => { if (cloud) { void flipHome(); return; } dialog ??= new LibraryFolderDialog(); void dialog.show(() => { void tip(); }); }); });
  document.addEventListener('fm:library-changed', () => { void tip(); });
  void tip();
}

/** The second storage entry of the side panel (G08): named for the cloud folder, "Cloud folder" while none is set; a click opens the Library Folder window where it is chosen. */
export function mountCloudButton(btn: HTMLElement): void {
  if (platform.kind === 'ipad') { mountIpadPlace(btn, 'icloud'); return; }
  const paint = async (): Promise<void> => {
    const to = await cloudTarget();
    const name = to ? to.name : t('Cloud folder');
    const span = btn.lastElementChild;
    if (span && span.textContent !== name) span.textContent = name;
    btn.title = to ? `${t('Cloud folder')}: ${to.dir}` : t('Cloud folder: not set');
    btn.classList.toggle('is-here', await inCloudTheater());
  };
  // a set cloud folder is a second Theater to flip to; with none set (or already there) the click opens the folder choice
  btn.addEventListener('click', () => { void inCloudTheater().then(async (cloud) => { if (!cloud && (await flipToCloud())) return; dialog ??= new LibraryFolderDialog(); void dialog.show(() => { void paint(); }); }); });
  document.addEventListener('fm:cloud-folder', () => { void paint(); });
  document.addEventListener('fm:library-changed', () => { void paint(); });
  void paint();
}

/** iPad: the two places the library can live, this iPad and the app's iCloud Drive folder; a click moves the library there, nothing is copied. */
function mountIpadPlace(btn: HTMLElement, place: 'ipad' | 'icloud'): void {
  const name = place === 'ipad' ? t('On This iPad') : t('iCloud Drive');
  const span = btn.lastElementChild;
  if (span && span.textContent !== name) span.textContent = name;
  btn.title = name;
  btn.classList.toggle('is-here', place === 'ipad');
  const inCloud = (i: Locations | null): boolean => !!i?.icloud && i.dir === i.icloud;
  const paint = async (): Promise<void> => {
    const info = await locations();
    btn.classList.toggle('is-here', place === 'icloud' ? inCloud(info) : !inCloud(info));
  };
  btn.addEventListener('click', () => {
    void (async () => {
      const info = await locations();
      if (place === 'ipad') { if (inCloud(info)) await flipHome(); return; }
      if (inCloud(info)) return;
      if (!info?.icloud) { toast(icloudOff(info?.icloudState), 'error'); return; }
      await flipToCloud();
    })();
  });
  document.addEventListener('fm:library-changed', () => { void paint(); });
  void paint();
}

function icloudOff(state: string | undefined): string {
  if (state === 'signedOut') return t('iCloud Drive is off on this iPad, or no one is signed in to iCloud. Turn it on in the Settings app, under your name, then iCloud, and try again.');
  if (state === 'unavailable') return t('iCloud Drive is on, but this app cannot reach its folder there. In the Settings app, under your name, then iCloud, check that iCloud Drive is allowed for FormMorpheus, and try again.');
  if (state === 'checking') return t('iCloud Drive is still being checked. Try again in a moment.');
  return t('iCloud Drive cannot be reached right now. Try again in a moment.');
}

interface Locations { dir: string; default: string; source: string; icloud: string | null; icloudState?: string }

/** The library's current folder and the iCloud Drive folder when this computer has one (null when the engine is away). */
export async function locations(): Promise<Locations | null> {
  // a few seconds of memory: Select mode asks on every tick of the selection
  if (seen && Date.now() - seen.at < 4000) return seen.info;
  try { const r = await fetch('/api/system/library'); const info = r.ok ? ((await r.json()) as Locations) : null; seen = { at: Date.now(), info }; return info; } catch { return null; }
}
let seen: { at: number; info: Locations | null } | null = null;
document.addEventListener('fm:library-changed', () => { seen = null; });

const CLOUD_KEY = 'formmorpheus.cloudFolder';

/** The second storage (G08): a folder the person's sync service keeps (any folder they pick); empty when none. */
export function cloudFolder(): string {
  try { return localStorage.getItem(CLOUD_KEY) ?? ''; } catch { return ''; }
}

export function setCloudFolder(dir: string): void {
  try { if (dir) localStorage.setItem(CLOUD_KEY, dir); else localStorage.removeItem(CLOUD_KEY); } catch { /* this session only */ }
  document.dispatchEvent(new CustomEvent('fm:cloud-folder'));
}

/** Where "Copy to Cloud" sends movies: the chosen cloud folder, else this computer's iCloud Drive folder; null when neither exists. */
export async function cloudTarget(): Promise<{ dir: string; name: string } | null> {
  const own = cloudFolder();
  if (own) return { dir: own, name: own.split(/[\\/]/).filter(Boolean).pop() ?? t('Cloud folder') };
  const icloud = (await locations())?.icloud;
  return icloud ? { dir: icloud, name: t('iCloud Drive') } : null;
}

/** Copy to Cloud: the movies' files go to the cloud folder; never overwrites (the engine numbers a taken name). */
export async function copyMoviesToCloud(names: string[]): Promise<void> {
  const to = await cloudTarget();
  if (!to) { toast(t('No cloud folder is set. Choose one in the Library Folder window.'), 'error'); return; }
  try {
    for (const n of names) await api.copyMovieTo(n, to.dir);
    toast(tf(names.length === 1 ? 'Copied to {dir}.' : '{n} movies copied to {dir}.', { n: names.length, dir: to.dir }));
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
