// Listen before importing: a sound picked with Import opens here with a player, then Import adds it or Cancel leaves
// the movie alone. A sound the browser cannot play (AIFF, CAF, AC-3) says it will be converted on import.
import { Dialog } from './dialogs';
import { el, setText } from './dom';
import { t } from './i18n';

const SOUND_EXT = /\.(mp3|wav|aac|m4a|flac|ogg|oga|opus|aif|aiff|aifc|caf|ac3|eac3|mp2)$/i;

/** True for a file that is a sound by its name or type, and not a video container. */
export const isSoundFile = (f: File): boolean => f.type.startsWith('audio/') || SOUND_EXT.test(f.name);

class SoundPreview extends Dialog {
  private readonly name = el<HTMLElement>('<div class="fm-prev-name"></div>');
  private readonly info = el<HTMLElement>('<p class="cv-note fm-prev-info"></p>');
  private readonly player = el<HTMLAudioElement>('<audio class="fm-prev-audio" style="width:100%" controls preload="metadata"></audio>');
  private readonly ok: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private resolve: ((v: boolean) => void) | null = null;
  private url = '';

  constructor() {
    super('Preview Sound', 420);
    this.body.append(this.name, this.player, this.info);
    this.cancel = this.button('Cancel', 'ghost', () => this.finish(false));
    this.ok = this.button('Import', 'primary', () => this.finish(true));
    this.onClose = () => this.finish(false);
    this.player.addEventListener('error', () => setText(this.info, t('This browser cannot play this sound here. It will be converted when it is imported.')));
    this.player.addEventListener('loadedmetadata', () => {
      const s = this.player.duration;
      setText(this.info, Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');
    });
  }

  ask(file: File): Promise<boolean> {
    setText(this.name, file.name);
    setText(this.info, '');
    this.url = URL.createObjectURL(file);
    this.player.src = this.url;
    this.open(this.ok);
    return new Promise<boolean>((resolve) => { this.resolve = resolve; });
  }

  private finish(v: boolean): void {
    const done = this.resolve;
    this.resolve = null;
    this.player.pause();
    if (this.isOpen) this.close();
    if (this.url) { this.player.removeAttribute('src'); this.player.load(); URL.revokeObjectURL(this.url); this.url = ''; }
    done?.(v);
  }
}

let dialog: SoundPreview | null = null;

/** Opens the preview for one sound; true when the person chose to import it. Without a window dialog layer it just says yes. */
export async function previewSound(file: File, always = false): Promise<boolean> {
  if (!document.getElementById('overlay-root')) return true;
  // the one rule (FT-GAP-20): a sound under a minute imports straight away unless "Preview sounds before import" is on
  if (!always && (await soundSeconds(file)) < SHORT_SOUND) return true;
  dialog ??= new SoundPreview();
  return dialog.ask(file);
}

const SHORT_SOUND = 60;

/** Length of a sound from its metadata; Infinity when the browser cannot tell within a moment (the dialog then opens). */
function soundSeconds(file: File): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const end = (s: number): void => { clearTimeout(timer); a.removeAttribute('src'); a.load(); URL.revokeObjectURL(url); resolve(s); };
    const timer = setTimeout(() => end(Infinity), 1500);
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => end(Number.isFinite(a.duration) ? a.duration : Infinity));
    a.addEventListener('error', () => end(Infinity));
    a.src = url;
  });
}
