// The iPad window and document hooks (phase 59): files the system hands the app, the open movie reported for state
// restoration, and the on-screen keyboard. Desktop never reaches any of it (every entry point returns on platform.kind).
//
//   native to page  openURL { kind: 'library', name }          a movie that already lives in the Library
//                           { kind: 'import', path, name }     a picture, video, sound, brush or font file to bring in
//                           { kind: 'restore', name }          the movie this window showed when it was closed
//                           { url, path }                      the older form: a .fmo path
//   page to native  movie   { name, id, title }                the open movie (name is its Library name, null when none)
import '../styles/ipad-window.css';
import { toast } from '../ui/toast';
import { t } from '../ui/i18n';
import { tf } from '../ui/i18n-fill';
import { api } from '../io/api';
import type { Engine } from '../engine/engine';
import { platform } from './index';

export interface IpadShellOptions {
  engine: Engine;
  openFromLibrary: (name: string) => Promise<void>;
  openFromPath: (path: string) => Promise<void>;
  /** Brings one file into the open movie (the same path the Import command takes). */
  importFile: (file: File) => Promise<void>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The pixels the on-screen keyboard covers, as --fm-kb-inset on the root (0 when it is away), and a class while it is up. */
function installKeyboardInset(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let frame = 0;
  const apply = (): void => {
    frame = 0;
    const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const open = covered > 40;
    const value = open ? `${covered}px` : '0px';
    if (root.style.getPropertyValue('--fm-kb-inset') !== value) root.style.setProperty('--fm-kb-inset', value);
    if (root.classList.contains('fm-kb-open') !== open) root.classList.toggle('fm-kb-open', open);
    if (!open) { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); return; }
    // a field under the keyboard comes up into the free part of the window
    const a = document.activeElement;
    if (a instanceof HTMLElement && a.matches('input, textarea, [contenteditable="true"]')) {
      const r = a.getBoundingClientRect();
      if (r.bottom > vv.offsetTop + vv.height - 8) a.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  };
  const soon = (): void => { if (!frame) frame = requestAnimationFrame(apply); };
  vv.addEventListener('resize', soon, { passive: true });
  vv.addEventListener('scroll', soon, { passive: true });
  window.addEventListener('focusin', soon, { passive: true });
  apply();
}

export function installIpadShell(opts: IpadShellOptions): void {
  if (platform.kind !== 'ipad') return;
  const { engine } = opts;
  document.documentElement.classList.add('is-ipad');
  installKeyboardInset();

  let chain: Promise<void> = Promise.resolve();
  const run = (p: Record<string, unknown>): Promise<void> => {
    const kind = str(p.kind), name = str(p.name), path = str(p.path);
    if (kind === 'library' && name) return opts.openFromLibrary(name);
    if (kind === 'restore' && name) {
      // only into an empty window: a movie opened since launch is the person's own choice
      if (engine.movie) return Promise.resolve();
      return api.library().then((items) => { if (items.some((i) => i.name === name)) return opts.openFromLibrary(name); }, () => undefined);
    }
    if (kind === 'import' && path) {
      if (!engine.movie) { toast(tf('Open or make a movie first, then bring in {name}.', { name: name || path.split('/').pop() || '' }), 'info'); return Promise.resolve(); }
      return api.readFile(path).then((blob) => opts.importFile(new File([blob], name || path.split('/').pop() || 'file')), (e: unknown) => {
        toast(e instanceof Error ? e.message : t('The file could not be opened.'), 'error');
      });
    }
    if (!kind && /\.fmo$/i.test(path)) return opts.openFromPath(path);
    return Promise.resolve();
  };
  platform.bridge.on('openURL', (p) => { chain = chain.then(() => run(p)).catch(() => undefined); });

  let last = '';
  const report = (): void => {
    const name = engine.libraryName, id = engine.movie?.id ?? null, title = engine.movie?.name ?? '';
    const key = `${name ?? ''}|${id ?? ''}|${title}`;
    if (key === last) return;
    last = key;
    platform.bridge.post('movie', { name, id, title });
  };
  for (const ev of ['projects', 'saved', 'movie'] as const) engine.on(ev, report);
  report();
}
