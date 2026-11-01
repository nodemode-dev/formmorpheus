// A second Theater: the cloud folder can be flipped to like the "On This Computer" Theater. Flipping points the
// library at the other folder (the engine keeps the choice), so the wall, stacks, Recent and Recently Deleted all
// follow; flipping back returns to the folder the library was in before. Nothing is copied or moved.
import { capabilities, serviceReady } from '../io/api';
import { t } from './i18n';
import { toast } from './toast';
import { cloudTarget, locations } from './theater-storage';

const HOME_KEY = 'formmorpheus.homeLibrary';
const trim = (p: string): string => p.replace(/[\\/]+$/, '');

/** The folder the library was in before the last flip to the cloud ('' = the default folder). */
function homeDir(): string {
  try { return localStorage.getItem(HOME_KEY) ?? ''; } catch { return ''; }
}
function setHome(dir: string): void {
  try { if (dir) localStorage.setItem(HOME_KEY, dir); else localStorage.removeItem(HOME_KEY); } catch { /* this session only */ }
}

async function point(dir: string | null): Promise<string | null> {
  if (!(await serviceReady())) { toast(t('The formmorpheus engine service is not running. Start it with ./formmorpheus.'), 'error'); return null; }
  try {
    const res = await fetch('/api/system/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir, copyMovies: false }) });
    if (!res.ok) {
      let detail = res.statusText;
      try { const j = (await res.json()) as { detail?: unknown }; if (typeof j.detail === 'string') detail = j.detail; } catch { /* not JSON */ }
      toast(detail, 'error');
      return null;
    }
    const done = (await res.json()) as { dir: string };
    const caps = await capabilities();
    if (caps) caps.libraryDir = done.dir;
    document.dispatchEvent(new CustomEvent('fm:library-changed'));
    return done.dir;
  } catch (err) { toast((err as Error).message, 'error'); return null; }
}

/** True while the Theater on screen is the cloud folder. */
export async function inCloudTheater(): Promise<boolean> {
  const [to, info] = await Promise.all([cloudTarget(), locations()]);
  return !!to && !!info && trim(to.dir) === trim(info.dir);
}

/** Flips to the cloud Theater; false when no cloud folder is set (the caller then opens the folder choice). */
export async function flipToCloud(): Promise<boolean> {
  const to = await cloudTarget();
  if (!to) return false;
  const info = await locations();
  if (info && trim(info.dir) !== trim(to.dir)) setHome(info.source === 'default' ? '' : info.dir);
  return (await point(to.dir)) !== null;
}

/** Flips back to the Theater on this computer (the folder the library was in before the cloud one). */
export async function flipHome(): Promise<boolean> {
  const dir = homeDir();
  return (await point(dir || null)) !== null;
}
