import { confirmAction } from './dialogs';
import { el, q, setClass, setDisabled, setStyleVar, setText, setTitle } from './dom';
import { icon } from './icons';
import { onLanguage, t } from './i18n';
import { tf } from './i18n-fill';

export const VIDEO_TOOLS = 'Video Tools';
export const FFMPEG_MISSING = 'ProRes and HEVC need ffmpeg, which is not on this computer. Get it in Preferences, Video Tools.';
export const MP3_MISSING = 'MP3 needs an ffmpeg with an MP3 encoder, which is not on this computer. The downloadable build has none, so install your own. See Preferences, Video Tools.';
export const VIDEO_TOOLS_CHANGED = 'fm:video-tools-changed';

type TaskState = 'idle' | 'downloading' | 'verifying' | 'done' | 'failed' | 'cancelled';

export interface VideoToolsState {
  ffmpeg: { found: boolean; path: string; version: string; source: '' | 'download' | 'computer'; gpl: boolean; encoders: string[] };
  formats: Record<'prores' | 'hevc' | 'hevcAlpha' | 'h264' | 'mp3' | 'aac' | 'opus', boolean>;
  family: { release: string; version: string; licence: string; releases: string; platform: string; available: boolean; installed: boolean; folder: string; downloadBytes: number; installedBytes: number };
  task: { state: TaskState; received: number; total: number; error: string };
}

const BASE = '/api/video-tools';
const POLL_MS = 400;
const FORMATS: ReadonlyArray<readonly [keyof VideoToolsState['formats'], string]> = [
  ['prores', 'ProRes and ProRes 4444'], ['hevc', 'HEVC'], ['hevcAlpha', 'HEVC with transparency'], ['h264', 'H.264 by the engine'], ['mp3', 'MP3'],
];
const DOWNLOAD_SENTENCE = 'Downloads ffmpeg {version} (about {size} MB) from the formai-binaries releases on GitHub. Its licence is {licence}. It is a separate program that FormMorpheus runs, not a part of FormMorpheus.';
const BUILD_NOTE = 'This build makes ProRes, and HEVC where the computer has a hardware encoder FormMorpheus can use (on Windows, only some graphics cards). It has no MP3 or H.264 encoder; for those, install your own ffmpeg.';

const mb = (bytes: number, digits = 0): string => (bytes / 1e6).toFixed(digits);

async function call(method: 'GET' | 'POST' | 'DELETE', path = ''): Promise<{ state: VideoToolsState | null; error: string }> {
  try {
    const res = await fetch(`${BASE}${path}`, { method });
    if (res.ok) return { state: (await res.json()) as VideoToolsState, error: '' };
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
    return { state: null, error: typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}` };
  } catch { return { state: null, error: 'The engine is not running.' }; }
}

/** Opens Preferences at Video Tools. */
export function openVideoTools(): void {
  document.dispatchEvent(new CustomEvent('fm:open-settings', { detail: { section: VIDEO_TOOLS } }));
}

/** The notice a dialog shows when a format needs ffmpeg and none is found; built once, shown and hidden in place. */
export function ffmpegChip(before: () => void, text = FFMPEG_MISSING): HTMLButtonElement {
  const chip = el<HTMLButtonElement>(`<button class="fm-vt-chip" type="button" hidden><span class="fm-vt-chip-icon">${icon('warning', 14)}</span><span class="fm-vt-chip-text"></span></button>`);
  const paint = (): void => setText(q(chip, '.fm-vt-chip-text'), t(text));
  paint();
  onLanguage(paint);
  chip.addEventListener('click', () => { before(); openVideoTools(); });
  return chip;
}

/** Preferences, Video Tools: where ffmpeg was found, what it encodes, and the family build to download or remove. */
export class VideoToolsPage {
  readonly groups: HTMLElement[];
  private state: VideoToolsState | null = null;
  private engineError = '';
  private timer = 0;
  private wasBusy = false;
  private readonly foundTitle = el('<strong class="fm-vt-found-title"></strong>');
  private readonly foundPath = el('<code class="fm-vt-found-path" translate="no" dir="ltr"></code>');
  private readonly formatRows = new Map<string, HTMLElement>();
  private readonly sentence = el('<p class="cv-note fm-vt-sentence"></p>');
  private readonly download = el<HTMLButtonElement>('<button class="cv-btn cv-btn-primary fm-vt-btn" type="button"></button>');
  private readonly second = el<HTMLButtonElement>('<button class="cv-btn fm-vt-btn" type="button"></button>');
  private readonly progress = el('<div class="fm-vt-progress"><div class="cv-run-bar"><i></i></div><span class="cv-note fm-vt-status"></span></div>');

  constructor(group: (label: string, ...content: HTMLElement[]) => HTMLElement, note: (text: string) => HTMLElement) {
    const found = el('<div class="fm-vt-found"></div>');
    found.append(this.foundTitle, this.foundPath);
    const list = el('<ul class="fm-vt-formats"></ul>');
    for (const [key] of FORMATS) {
      const row = el(`<li class="fm-vt-format"><span class="fm-vt-mark fm-vt-yes">${icon('check', 14)}</span><span class="fm-vt-mark fm-vt-no">${icon('close', 14)}</span><span class="fm-vt-name"></span></li>`);
      this.formatRows.set(key, row);
      list.append(row);
    }
    const actions = el('<div class="fm-vt-actions"></div>');
    actions.append(this.download, this.second);
    this.download.addEventListener('click', () => void this.start());
    this.second.addEventListener('click', () => void (this.busy() ? this.cancel() : this.remove()));
    this.groups = [
      group('ffmpeg', found, list, note(t('FormMorpheus uses an ffmpeg installed on this computer first, and the downloaded build only when there is none.'))),
      group('Download ffmpeg', this.sentence, note(t(BUILD_NOTE)), actions, this.progress),
    ];
    this.paint();
    onLanguage(() => this.paint());
  }

  show(): void {
    void this.refresh(true);
  }

  private busy(): boolean {
    const s = this.state?.task.state;
    return s === 'downloading' || s === 'verifying';
  }

  private async refresh(fresh = false): Promise<void> {
    const r = await call('GET', fresh ? '?refresh=true' : '');
    this.take(r.state, r.state ? '' : r.error);
  }

  private take(state: VideoToolsState | null, error: string): void {
    this.state = state;
    this.engineError = error;
    const busy = this.busy();
    if (this.wasBusy && !busy) document.dispatchEvent(new CustomEvent(VIDEO_TOOLS_CHANGED));
    this.wasBusy = busy;
    window.clearTimeout(this.timer);
    if (busy) this.timer = window.setTimeout(() => void this.refresh(), POLL_MS);
    this.paint();
  }

  private async start(): Promise<void> {
    const r = await call('POST', '/download');
    if (r.state) this.take(r.state, '');
    else { this.engineError = r.error; this.paint(); }
  }

  private async cancel(): Promise<void> {
    const r = await call('POST', '/cancel');
    if (r.state) this.take(r.state, '');
  }

  private async remove(): Promise<void> {
    const ok = await confirmAction(t('Remove the downloaded ffmpeg?'), t('ProRes and HEVC export need ffmpeg. You can download it again here at any time.'), t('Remove'), true);
    if (!ok) return;
    const r = await call('DELETE', '/download');
    if (r.state) { this.take(r.state, ''); document.dispatchEvent(new CustomEvent(VIDEO_TOOLS_CHANGED)); }
    else { this.engineError = r.error; this.paint(); }
  }

  private paint(): void {
    const s = this.state, f = s?.ffmpeg, fam = s?.family, task = s?.task;
    const busy = this.busy();
    setText(this.foundTitle, !s ? t(this.engineError ? 'The engine is not running.' : 'Looking for ffmpeg...')
      : !f?.found ? t('ffmpeg was not found on this computer.')
        : f.source === 'download' ? tf('ffmpeg {version}, the downloaded build', { version: f.version })
          : tf('ffmpeg {version}, installed on this computer', { version: f.version }));
    setText(this.foundPath, f?.found ? f.path : ' ');
    setTitle(this.foundPath, f?.found ? f.path : '');
    for (const [key, label] of FORMATS) {
      const row = this.formatRows.get(key);
      if (!row) continue;
      const on = s?.formats[key] === true;
      setClass(row, 'is-on', on);
      setClass(row, 'is-known', !!s);
      setText(q(row, '.fm-vt-name'), t(label));
    }
    setText(this.sentence, tf(DOWNLOAD_SENTENCE, { version: fam?.version ?? '7.1.5', size: mb(fam?.downloadBytes || 12e6), licence: fam?.licence ?? 'LGPL-2.1-or-later' }));
    const own = f?.found === true && f.source === 'computer';
    setText(this.download, t('Download ffmpeg'));
    setDisabled(this.download, !s || busy || !fam?.available || fam.installed || own);
    setText(this.second, t(busy ? 'Cancel' : 'Remove'));
    setDisabled(this.second, !s || (!busy && !fam?.installed));
    const frac = task && task.total > 0 ? Math.min(1, task.received / task.total) : 0;
    setClass(this.progress, 'is-running', busy);
    setStyleVar(q(this.progress, '.cv-run-bar > i'), 'transform', `scaleX(${(task?.state === 'verifying' ? 1 : frac).toFixed(4)})`);
    setText(q(this.progress, '.fm-vt-status'), this.status(own));
  }

  private status(own: boolean): string {
    const s = this.state;
    if (!s) return this.engineError ? t(this.engineError) : ' ';
    const { family: fam, task } = s;
    if (task.state === 'downloading') return tf('Downloading: {done} of {total} MB', { done: mb(task.received, 1), total: mb(task.total, 1) });
    if (task.state === 'verifying') return t('Checking every file against its recorded SHA-256...');
    if (task.state === 'failed' && !fam.installed) return t(task.error || 'The download could not be finished.');
    if (task.state === 'cancelled' && !fam.installed) return t('The download was cancelled. Nothing was installed.');
    if (this.engineError) return t(this.engineError);
    if (fam.installed) return own ? t('Downloaded, but not used: FormMorpheus uses the ffmpeg installed on this computer.') : tf('Installed in the data folder ({size} MB).', { size: mb(fam.installedBytes) });
    if (!fam.available) return tf('There is no build for this computer ({platform}). Install ffmpeg yourself.', { platform: fam.platform });
    if (own) return t('Not needed: FormMorpheus uses the ffmpeg installed on this computer.');
    return t('Not downloaded.');
  }
}
