import '../styles/onboarding.css';
import { ApiError, capabilities, serviceReady } from '../io/api';
import { Dialog } from './dialogs';
import { el, q, setChecked, setDisabled, setHidden, setText, setValue } from './dom';
import { t } from './i18n';
import { toast } from './toast';
import { cloudFolder, setCloudFolder } from './theater-storage';

/** Where the movie library lives: on this computer (the default), in the iCloud Drive folder when the computer has one,
 *  or in a folder of your own. The engine checks the folder (a full path of your own, writable) and can copy the
 *  movies across; the movies already in the old folder are never deleted. */
interface Info { dir: string; default: string; source: 'override' | 'custom' | 'default'; icloud: string | null }

async function call<T>(method: 'GET' | 'POST', body?: unknown): Promise<T> {
  if (!(await serviceReady())) throw new ApiError('The formmorpheus engine service is not running. Start it with ./formmorpheus.', 0);
  const res = await fetch('/api/system/library', { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = (await res.json()) as { detail?: unknown }; if (typeof j.detail === 'string') detail = j.detail; } catch { /* not JSON */ }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

export class LibraryFolderDialog extends Dialog {
  private readonly form = el(`<div class="fm-lib">
    <label class="cv-field"><span>Library folder</span><input class="cv-input" type="text" dir="ltr" readonly spellcheck="false" data-f="now"></label>
    <label class="fm-share-opt"><input type="radio" name="fm-lib" value="default"><span class="fm-share-main"><strong>On this computer</strong><span class="fm-share-note" data-f="default"></span></span></label>
    <label class="fm-share-opt"><input type="radio" name="fm-lib" value="icloud"><span class="fm-share-main"><strong>iCloud Drive</strong><span class="fm-share-note" data-f="icloud"></span></span></label>
    <label class="fm-share-opt"><input type="radio" name="fm-lib" value="custom"><span class="fm-share-main"><strong>Another folder</strong><span class="fm-share-note">Type the full path of a folder you own, for example on an external drive.</span></span></label>
    <input class="cv-input fm-lib-path" type="text" dir="ltr" spellcheck="false" placeholder="/path/to/folder" aria-label="Folder path" data-f="path">
    <label class="cv-field cv-check"><span>Copy my movies into the new folder</span><input type="checkbox" data-f="copy" checked></label>
    <p class="fm-lib-note" data-f="note" hidden></p>
    <label class="cv-field fm-lib-cloud"><span>Cloud folder (optional)</span><input class="cv-input" type="text" dir="ltr" spellcheck="false" placeholder="/path/to/a/synced/folder" aria-label="Cloud folder" data-f="cloud"></label>
    <p class="fm-share-note">A second place for your movies: a folder your own sync service keeps in step. Copy to Cloud in the Theater sends a copy of a movie there; your library stays where it is.</p>
  </div>`);
  private info: Info | null = null;
  private readonly use: HTMLButtonElement;
  private onDone: ((dir: string) => void) | null = null;

  constructor() {
    super('Library Folder', 500);
    this.body.appendChild(this.form);
    this.button('Cancel', '', () => this.close());
    this.use = this.button('Use This Folder', 'primary', () => { void this.apply(); });
    this.form.addEventListener('input', () => this.sync());
    // the cloud folder is its own choice (G08): kept when the field is left, no library change
    q<HTMLInputElement>(this.form, '[data-f="cloud"]').addEventListener('change', (e) => setCloudFolder((e.target as HTMLInputElement).value.trim()));
  }

  private choice(): string { return q<HTMLInputElement>(this.form, 'input[name="fm-lib"]:checked').value; }

  private sync(): void {
    const path = q<HTMLInputElement>(this.form, '[data-f="path"]');
    const c = this.choice();
    setDisabled(path, c !== 'custom');
    const locked = this.info?.source === 'override';
    setDisabled(this.use, locked || (c === 'custom' && !path.value.trim()));
  }

  async show(onDone: (dir: string) => void): Promise<void> {
    this.onDone = onDone;
    try { this.info = await call<Info>('GET'); } catch (err) { toast((err as Error).message, 'error'); return; }
    const i = this.info;
    setValue(q(this.form, '[data-f="now"]'), i.dir);
    setText(q(this.form, '[data-f="default"]'), i.default);
    setText(q(this.form, '[data-f="icloud"]'), i.icloud ?? t('iCloud Drive was not found on this computer.'));
    const radios = Array.from(this.form.querySelectorAll<HTMLInputElement>('input[name="fm-lib"]'));
    for (const r of radios) {
      if (r.value === 'icloud') setDisabled(r, !i.icloud);
      setChecked(r, r.value === (i.source === 'default' ? 'default' : i.icloud && i.dir === i.icloud ? 'icloud' : 'custom'));
    }
    setValue(q(this.form, '[data-f="path"]'), i.source === 'custom' && i.dir !== i.icloud ? i.dir : '');
    setValue(q(this.form, '[data-f="cloud"]'), cloudFolder());
    const note = q(this.form, '[data-f="note"]');
    setText(note, t('This folder is set by FORMMORPHEUS_LIBRARY_DIR, so it cannot be changed here.'));
    setHidden(note, i.source !== 'override');
    this.sync();
    this.open();
  }

  private async apply(): Promise<void> {
    const i = this.info;
    if (!i) return;
    const c = this.choice();
    const dir = c === 'default' ? null : c === 'icloud' ? i.icloud : q<HTMLInputElement>(this.form, '[data-f="path"]').value.trim();
    try {
      const done = await call<{ dir: string; copied: number }>('POST', { dir, copyMovies: q<HTMLInputElement>(this.form, '[data-f="copy"]').checked });
      const caps = await capabilities();
      if (caps) caps.libraryDir = done.dir;
      this.close();
      toast(done.copied ? `${t('The library is now in')} ${done.dir} (${done.copied} ${t('movies copied')}).` : `${t('The library is now in')} ${done.dir}.`);
      this.onDone?.(done.dir);
      document.dispatchEvent(new CustomEvent('fm:library-changed'));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }
}
