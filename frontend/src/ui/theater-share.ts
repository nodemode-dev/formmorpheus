import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import '../styles/onboarding.css';
import { api, downloadBlob } from '../io/api';
import { MIME } from '../io/fmo';
import { Dialog } from './dialogs';
import { el, q, setText } from './dom';
import { t } from './i18n';
import { toast } from './toast';

/** Share from the Theater: a movie file with its full undo history, or a reduced one without the history and the
 *  hover strip (the movie, its pictures, sound and poster stay). Both sizes are shown before the choice is made. */
const sizeText = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The same movie file without history.json and preview.png; the manifest says it has no history. */
export async function reduceMovieFile(blob: Blob): Promise<Blob> {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const out: Zippable = {};
  for (const [path, bytes] of Object.entries(entries)) {
    if (path === 'history.json' || path === 'preview.png') continue;
    if (path === 'manifest.json') {
      const m = JSON.parse(strFromU8(bytes)) as Record<string, unknown>;
      m.history = false;
      out[path] = [strToU8(JSON.stringify(m)), { level: 6 }];
    } else out[path] = [bytes, { level: path.endsWith('.json') ? 6 : 0 }];
  }
  return new Blob([zipSync(out).buffer as ArrayBuffer], { type: MIME });
}

class ShareDialog extends Dialog {
  private full: Blob | null = null;
  private small: Blob | null = null;
  private name = '';
  private readonly share: HTMLButtonElement;
  private readonly choice = el(`<div class="fm-share">
    <p class="fm-share-lead"></p>
    <label class="fm-share-opt"><input type="radio" name="fm-share-kind" value="movie" checked><span class="fm-share-main"><strong>Movie file</strong><span class="fm-share-note">The .fmo, to open and keep editing.</span></span></label>
    <label class="fm-share-opt"><input type="radio" name="fm-share-kind" value="video"><span class="fm-share-main"><strong>Video</strong><span class="fm-share-note">Opens the movie and exports it as an .mp4.</span></span></label>
    <label class="fm-share-opt"><input type="radio" name="fm-share-kind" value="frames"><span class="fm-share-main"><strong>Frames as images</strong><span class="fm-share-note">Opens the movie and exports a picture for every frame.</span></span></label>
    <div class="fm-share-hist">
    <label class="fm-share-opt"><input type="radio" name="fm-share" value="full" checked><span class="fm-share-main"><strong>Full undo history</strong><span class="fm-share-note">Everything, so whoever opens the file can undo your steps. Larger.</span></span><span class="fm-share-size" data-s="full"></span></label>
    <label class="fm-share-opt"><input type="radio" name="fm-share" value="small"><span class="fm-share-main"><strong>Reduced file size</strong><span class="fm-share-note">The movie as it is now, without its undo history. Smaller.</span></span><span class="fm-share-size" data-s="small"></span></label>
    </div>
  </div>`);

  constructor() {
    super('Share Movie', 460);
    this.body.appendChild(this.choice);
    this.button('Cancel', '', () => this.close());
    this.share = this.button('Share', 'primary', () => { void this.go(); });
    for (const r of Array.from(this.choice.querySelectorAll<HTMLInputElement>('input[name="fm-share-kind"]'))) r.addEventListener('change', () => this.paintKind());
  }

  private kind(): 'movie' | 'video' | 'frames' {
    return (q<HTMLInputElement>(this.choice, 'input[name="fm-share-kind"]:checked').value as 'movie' | 'video' | 'frames');
  }

  /** The undo history choice and the sizes belong to the movie file only; Video and Frames open the movie instead. */
  private paintKind(): void {
    const movie = this.kind() === 'movie';
    q<HTMLElement>(this.choice, '.fm-share-hist').hidden = !movie;
    const ready = this.kind() !== 'movie' || (this.full !== null && this.small !== null);
    this.share.disabled = !ready;
    setText(this.share, t(movie ? 'Share' : 'Open and export'));
    this.share.dataset.en = movie ? 'Share' : 'Open and export';
    this.share.dataset.shown = this.share.textContent ?? '';
  }

  async show(name: string): Promise<void> {
    this.name = name;
    this.full = null;
    this.small = null;
    setText(q(this.choice, '.fm-share-lead'), `${t('Share')} "${name}".`);
    setText(q(this.choice, '[data-s="full"]'), '');
    setText(q(this.choice, '[data-s="small"]'), '');
    q<HTMLInputElement>(this.choice, 'input[name="fm-share-kind"][value="movie"]').checked = true;
    this.paintKind();
    this.share.disabled = true;
    this.open();
    try {
      this.full = await api.readMovie(name);
      setText(q(this.choice, '[data-s="full"]'), sizeText(this.full.size));
      this.small = await reduceMovieFile(this.full);
      setText(q(this.choice, '[data-s="small"]'), sizeText(this.small.size));
      this.paintKind();
    } catch (err) {
      this.close();
      toast((err as Error).message, 'error');
    }
  }

  private async go(): Promise<void> {
    const kind = this.kind();
    if (kind !== 'movie') {
      // the app opens the movie (asking about unsaved changes first) and runs the export from there
      const name = this.name;
      this.close();
      document.dispatchEvent(new CustomEvent('fm:share-export', { detail: { name, kind } }));
      return;
    }
    const reduced = q<HTMLInputElement>(this.choice, 'input[value="small"]').checked;
    const blob = reduced ? this.small : this.full;
    if (!blob) return;
    this.close();
    downloadBlob(blob, `${this.name}.fmo`);
  }
}

let dialog: ShareDialog | null = null;
export async function shareMovie(name: string): Promise<void> {
  dialog ??= new ShareDialog();
  await dialog.show(name);
}
