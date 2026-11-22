// Export sound only: the mix or one file per track (stems) as WAV, AAC in M4A, or Opus in WebM / OGG.
// Opened from the Export dialog's "Sound only" tile. Built once; controls patch in place.
import type { Engine } from '../engine/engine';
import type { AudioEngine } from '../media/audio';
import { AUDIO_FORMATS, exportAudio, type AudioFormat } from '../export/audio-export';
import { downloadBlob } from '../io/api';
import { platform } from '../platform';
import { jobCapabilities } from '../export/engine-jobs';
import { LUFS_PRESETS } from '../media/loudness';
import { Dialog } from './dialogs';
import { el, q, setDisabled, setHidden, setText } from './dom';
import { t } from './i18n';
import { toast } from './toast';
import { MP3_MISSING, VIDEO_TOOLS_CHANGED, ffmpegChip } from './video-tools';

const KEY = 'formmorpheus.audioExport';

interface Saved { format: AudioFormat; stems: boolean; rate: number; lufs: number; kbps: number }
const MP3_RATES = [96, 128, 160, 192, 256, 320];
/** MP3 needs the engine's ffmpeg, which a platform may not have (iPad): then it is not offered. */
const FORMATS = AUDIO_FORMATS.filter((f) => (f.id !== 'mp3' || platform.features.mp3Export)
  // on iPad the engine has no Opus encoder either, so Opus is offered only when the page can encode it itself
  && (platform.kind !== 'ipad' || !f.id.endsWith('-opus') || typeof (globalThis as { AudioEncoder?: unknown }).AudioEncoder !== 'undefined'));

function load(): Saved {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    return { format: FORMATS.some((f) => f.id === r.format) ? (r.format as AudioFormat) : 'wav16', stems: r.stems === true, rate: r.rate === 44100 ? 44100 : 48000, lufs: (LUFS_PRESETS as readonly number[]).includes(r.lufs ?? 0) ? (r.lufs as number) : 0, kbps: MP3_RATES.includes(r.kbps ?? 0) ? (r.kbps as number) : 192 };
  } catch { return { format: 'wav16', stems: false, rate: 48000, lufs: 0, kbps: 192 }; }
}

export interface AudioExportDeps {
  engine: Engine;
  audio: () => AudioEngine | null;
  saveOutput: (blob: Blob, name: string) => Promise<void>;
}

export class AudioExportDialog {
  private readonly dlg = new Dialog('Export sound', 440);
  private readonly state = load();
  private readonly format = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Format">${FORMATS.map((f) => `<option value="${f.id}">${t(f.label)}</option>`).join('')}</select>`);
  private readonly scope = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Files"><option value="mix">${t('One mixed file')}</option><option value="stems">${t('One file per track (stems)')}</option></select>`);
  private readonly rate = el<HTMLSelectElement>('<select class="cv-input" aria-label="Sample rate"><option value="48000">48 kHz</option><option value="44100">44.1 kHz</option></select>');
  private readonly loud = el<HTMLSelectElement>(`<select class="cv-input" aria-label="${t('Loudness')}"><option value="0">${t('Off')}</option>${LUFS_PRESETS.map((v) => `<option value="${v}">${v} LUFS</option>`).join('')}</select>`);
  private readonly kbps = el<HTMLSelectElement>(`<select class="cv-input" aria-label="${t('MP3 bitrate')}">${MP3_RATES.map((v) => `<option value="${v}">${v} kbps</option>`).join('')}</select>`);
  private readonly kbpsRow: HTMLElement;
  private readonly mp3Note = el<HTMLElement>('<div class="fm-ex-notes is-warn" hidden></div>');
  private mp3Ok: boolean | null = null;
  private mp3Missing = false;
  private readonly mp3Chip = ffmpegChip(() => this.dlg.close(), MP3_MISSING);
  private readonly note = el<HTMLElement>('<div class="fm-ex-notes" hidden></div>');
  private readonly bar = el<HTMLElement>('<div class="cv-run-bar" hidden><i></i></div>');
  private readonly rateRow: HTMLElement;
  private readonly go: HTMLButtonElement;
  private busy = false;

  constructor(private readonly deps: AudioExportDeps) {
    const row = (label: string, c: HTMLElement): HTMLElement => {
      const r = el<HTMLElement>('<div class="cv-field fm-ex-row"><span></span><div class="fm-ex-ctl"></div></div>');
      setText(q(r, 'span'), t(label));
      q(r, '.fm-ex-ctl').append(c);
      return r;
    };
    const form = el<HTMLElement>('<div class="fm-ex-form"></div>');
    this.rateRow = row('Sample rate', this.rate);
    this.kbpsRow = row('MP3 bitrate', this.kbps);
    form.append(row('Format', this.format), row('Files', this.scope), this.rateRow, this.kbpsRow, row('Normalize loudness', this.loud));
    this.loud.value = String(this.state.lufs);
    this.kbps.value = String(this.state.kbps);
    this.dlg.body.append(form, this.mp3Note, this.mp3Chip, this.bar, this.note);
    if (!platform.features.mp3Export) {
      const off = el<HTMLElement>('<div class="fm-ex-notes"></div>');
      setText(off, t('MP3 is not offered on this device. Choose WAV, AAC or Opus.'));
      form.after(off);
    }
    this.format.value = this.state.format;
    this.scope.value = this.state.stems ? 'stems' : 'mix';
    this.rate.value = String(this.state.rate);
    const change = (): void => {
      this.state.format = this.format.value as AudioFormat;
      this.state.stems = this.scope.value === 'stems';
      this.state.rate = Number(this.rate.value);
      this.state.lufs = Number(this.loud.value);
      this.state.kbps = Number(this.kbps.value);
      setHidden(this.rateRow, !this.state.format.startsWith('wav'));
      setHidden(this.kbpsRow, this.state.format !== 'mp3');
      this.paintMp3();
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* not kept */ }
    };
    for (const c of [this.format, this.scope, this.rate, this.loud, this.kbps]) c.addEventListener('change', change);
    change();
    this.dlg.button('Close', 'ghost', () => this.dlg.close());
    this.go = this.dlg.button('Export', 'primary', () => { void this.run(); });
    document.addEventListener(VIDEO_TOOLS_CHANGED, () => { void this.readMp3(); });
  }

  open(): void {
    if (!this.deps.engine.movie) { toast('Open or create a movie first.'); return; }
    if (this.mp3Ok === null) { void this.readMp3().then(() => { if (this.deps.engine.movie && !this.dlg.isOpen) this.dlg.open(this.format); }); return; }
    this.dlg.open(this.format);
    void this.readMp3();
  }

  private async readMp3(): Promise<void> {
    const c = await jobCapabilities();
    this.mp3Ok = c?.ffmpeg === true && c.mp3 === true;
    this.mp3Missing = c !== null && !this.mp3Ok;
    this.paintMp3();
  }

  /** Tells, in the dialog, that MP3 goes through the engine's ffmpeg, and when that is missing. */
  private paintMp3(): void {
    const on = this.state.format === 'mp3';
    setHidden(this.mp3Note, !on || this.mp3Missing);
    setHidden(this.mp3Chip, !on || !this.mp3Missing);
    if (!on) return;
    setText(this.mp3Note, this.mp3Ok === false
      ? t('MP3 needs ffmpeg with the libmp3lame encoder, and this engine has none. Pick WAV, AAC or Opus, or install ffmpeg and reopen this dialog.')
      : t('The browser cannot encode MP3, so the engine\'s own ffmpeg encodes it from your mix.'));
    if (this.go) setDisabled(this.go, this.busy || this.mp3Ok === false);
  }

  private say(lines: string[], kind: 'ok' | 'warn' | 'error'): void {
    setHidden(this.note, lines.length === 0);
    for (const k of ['ok', 'warn', 'error']) this.note.classList.toggle(`is-${k}`, k === kind);
    if (this.note.dataset.text === lines.join('\n')) return;
    this.note.dataset.text = lines.join('\n');
    this.note.replaceChildren(...lines.map((l) => { const p = document.createElement('p'); p.textContent = l; return p; }));
  }

  private async run(): Promise<void> {
    const m = this.deps.engine.movie, audio = this.deps.audio();
    if (!m || !audio || this.busy) return;
    this.busy = true;
    setDisabled(this.go, true);
    setHidden(this.bar, false);
    this.say([], 'ok');
    try {
      const res = await exportAudio(audio, m, { format: this.state.format, from: 0, to: Math.max(1, m.duration), stems: this.state.stems, sampleRate: this.state.rate, mp3Kbps: this.state.kbps, ...(this.state.lufs ? { lufs: this.state.lufs } : {}) }, (d, n) => {
        q<HTMLElement>(this.bar, 'i').style.transform = `scaleX(${n > 0 ? d / n : 0})`;
      });
      downloadBlob(res.blob, res.name);
      let kept = true;
      try { await this.deps.saveOutput(res.blob, res.name); } catch { kept = false; }
      const lines = [t('Saved {name}').replace('{name}', res.name), ...res.warnings];
      if (!kept) lines.push(t('The file was downloaded, but it could not be kept in Exports.'));
      this.say(lines, res.warnings.length || !kept ? 'warn' : 'ok');
    } catch (e) {
      this.say([e instanceof Error && e.message ? e.message : t('The export failed.')], 'error');
    } finally {
      this.busy = false;
      setDisabled(this.go, false);
      this.paintMp3();
      setHidden(this.bar, true);
    }
  }
}
