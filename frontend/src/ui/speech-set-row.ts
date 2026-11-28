// The download row of one speech model set, shared by the Generate voice and Subtitles cards: what the files are,
// their size and licence, Download, progress with Cancel, a failure with a retry, and a quiet Remove once installed.
// Built once, then patched in place from the engine's status, which is asked again while a download runs.
import { cancelSet, downloadSet, removeSet, speechModels, type SetState, type SpeechSet } from '../media/speech/models';
import { confirmAction } from './dialogs';
import { el, q, setDisabled, setHidden, setStyleVar, setText } from './dom';
import { t } from './i18n';
import { tf } from './i18n-fill';
import '../styles/speech.css';

const POLL_MS = 500;
const MB = 1024 * 1024;

export interface SetWords {
  /** What the files are, shown while they are not installed. */
  about: string;
  remove: string;
  confirmTitle: string;
  confirmText: string;
}

/** Megabytes for a person: one decimal under ten, none above. */
export function mbText(bytes: number): string {
  const mb = Math.max(0, bytes) / MB;
  return mb < 10 ? mb.toFixed(1) : String(Math.round(mb));
}

const sentence = (e: unknown): string => (e instanceof Error && e.message ? e.message : t('The engine is not running.'));

export class SpeechSetRow {
  /** Shown while the set is not installed. */
  readonly root: HTMLElement;
  /** Shown while it is: the control that removes the files. */
  readonly remove: HTMLButtonElement;
  private readonly info: HTMLElement;
  private readonly get: HTMLButtonElement;
  private readonly prog: HTMLElement;
  private readonly progText: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly stop: HTMLButtonElement;
  private readonly fail: HTMLElement;
  private readonly failText: HTMLElement;
  private state: SetState | null = null;
  private error = '';
  private live = false;
  private timer = 0;

  constructor(private readonly set: SpeechSet, private readonly words: SetWords, private readonly onChange: () => void) {
    this.root = el<HTMLElement>(
      '<div class="fm-ss"><p class="fm-ss-about"></p><div class="fm-ss-info"></div>' +
      '<button class="cv-btn fm-ss-get" type="button"></button>' +
      '<div class="fm-ss-prog" hidden><div class="fm-ss-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="fm-ss-bar"></div></div>' +
      '<div class="fm-ss-progrow"><span class="fm-ss-progtext" aria-live="polite"></span><button class="cv-btn fm-ss-stop" type="button"></button></div></div>' +
      '<div class="fm-ss-fail" role="alert" hidden><span class="fm-ss-failtext"></span><br><button class="cv-btn fm-ss-retry" type="button"></button></div></div>');
    setText(q(this.root, '.fm-ss-about'), t(words.about));
    this.info = q(this.root, '.fm-ss-info');
    this.get = q<HTMLButtonElement>(this.root, '.fm-ss-get');
    setText(this.get, t('Download'));
    this.prog = q(this.root, '.fm-ss-prog');
    this.progText = q(this.root, '.fm-ss-progtext');
    this.bar = q(this.root, '.fm-ss-meter');
    this.bar.setAttribute('aria-label', t('Download progress'));
    this.stop = q<HTMLButtonElement>(this.root, '.fm-ss-stop');
    setText(this.stop, t('Cancel'));
    this.fail = q(this.root, '.fm-ss-fail');
    this.failText = q(this.root, '.fm-ss-failtext');
    const retry = q<HTMLButtonElement>(this.root, '.fm-ss-retry');
    setText(retry, t('Try again'));
    this.remove = el<HTMLButtonElement>('<button class="fm-ss-remove" type="button" hidden></button>');
    setText(this.remove, t(words.remove));

    this.get.addEventListener('click', () => { void this.act(() => downloadSet(this.set)); });
    retry.addEventListener('click', () => { void this.act(() => (this.state ? downloadSet(this.set) : speechModels())); });
    this.stop.addEventListener('click', () => { void this.act(() => cancelSet(this.set)); });
    this.remove.addEventListener('click', () => { void this.askRemove(); });
    this.patch();
  }

  get installed(): boolean { return this.state?.installed === true; }
  get known(): boolean { return this.state !== null; }

  /** The card opened: read the status, and keep reading it while a download runs. */
  start(): void {
    this.live = true;
    void this.act(() => speechModels());
  }

  /** The card closed: a download goes on in the engine, the asking stops. */
  halt(): void {
    this.live = false;
    window.clearTimeout(this.timer);
  }

  private async act(call: () => Promise<Record<SpeechSet, SetState>>): Promise<void> {
    window.clearTimeout(this.timer);
    try {
      const sets = await call();
      this.state = sets[this.set];
      this.error = '';
    } catch (e) {
      console.error('Speech model set request failed:', e);
      this.error = sentence(e);
    }
    this.patch();
    this.onChange();
    if (this.live && !this.error && this.state?.task.state === 'downloading') this.timer = window.setTimeout(() => { void this.act(() => speechModels()); }, POLL_MS);
  }

  private async askRemove(): Promise<void> {
    if (!(await confirmAction(t(this.words.confirmTitle), t(this.words.confirmText), t('Remove'), true))) return;
    await this.act(() => removeSet(this.set));
  }

  private patch(): void {
    const s = this.state;
    const task = s?.task;
    const loading = task?.state === 'downloading';
    const failed = !!this.error || task?.state === 'failed';
    setHidden(this.root, !!s?.installed);
    // a failed request leaves the files where they were, so Remove stays reachable for another try
    setHidden(this.remove, !s?.installed);
    setText(this.info, s ? tf('{size} MB to download once · {files} files · Licence: {licence}', { size: mbText(s.bytes), files: s.files, licence: s.licence }) : '');
    setHidden(this.get, loading || failed);
    setDisabled(this.get, !s);
    setHidden(this.prog, !loading);
    if (task && loading) {
      const pct = task.total > 0 ? Math.min(100, (task.done / task.total) * 100) : 0;
      setStyleVar(this.bar, '--pct', `${pct.toFixed(1)}%`);
      this.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
      setText(this.progText, tf('{done} of {total} MB', { done: mbText(task.done), total: mbText(task.total) }));
    }
    setHidden(this.fail, !failed);
    if (failed) setText(this.failText, this.error || task?.error || t('The download could not be finished.'));
    else if (task?.state === 'cancelled' && s && !s.installed) setText(this.info, `${t('The download was cancelled.')} ${tf('{size} MB to download once · {files} files · Licence: {licence}', { size: mbText(s.bytes), files: s.files, licence: s.licence })}`);
  }
}
