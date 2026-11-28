// The Generate voice card: typed words become a sound block at the Playhead on a new Voice track, with subtitle
// lines when asked. Two ways to speak: the built-in voice, made on this computer from files downloaded once, and a
// speech server the person runs on this computer. Built once, then patched in place.
import type { Engine } from '../engine/engine';
import { uid } from '../engine/model';
import { linesFromSentences, type SubtitleLine } from '../engine/subtitles';
import type { AudioEngine } from '../media/audio';
import { encodeWav } from '../media/recorder';
import { splitSentences } from '../media/speech/sentences';
import { SERVER_DEFAULTS, checkServer, speakOnServer, type ServerSettings } from '../media/speech/server';
import { SENTENCE_GAP_SECONDS, VOICES, join, speak } from '../media/speech/voice';
import { el, patchList, q, setChecked, setClass, setDisabled, setHidden, setText, setValue } from './dom';
import { enhanceSelect } from './dropdown';
import { t } from './i18n';
import { tf } from './i18n-fill';
import { linesForWholeSound, placeVoice } from './speech-logic';
import { SpeechSetRow } from './speech-set-row';
import { loadSubtitleStyle } from './subtitle-style-store';
import '../styles/speech.css';

type Tab = 'built' | 'server';

interface Opts { tab: Tab; voice: string; speed: number; text: string; subtitles: boolean; server: ServerSettings }
const DEFAULTS: Opts = { tab: 'built', voice: 'af_heart', speed: 1, text: '', subtitles: true, server: { ...SERVER_DEFAULTS } };
const STORE = 'formmorpheus.speech';
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;
const TEXT_SAVE_MS = 400;

const X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const TABS: ReadonlyArray<readonly [Tab, string]> = [['built', 'Built-in voice'], ['server', 'Speech server']];
const GROUPS: ReadonlyArray<readonly ['us' | 'gb', 'f' | 'm', string]> = [
  ['us', 'f', 'US · female'], ['us', 'm', 'US · male'], ['gb', 'f', 'UK · female'], ['gb', 'm', 'UK · male'],
];

const speedOf = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, n)) : 1;
};

function loadOpts(): Opts {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Opts>;
    const server = { ...SERVER_DEFAULTS, ...(raw.server ?? {}) };
    return {
      ...DEFAULTS, ...raw,
      tab: raw.tab === 'server' ? 'server' : 'built',
      voice: VOICES.some((v) => v.id === raw.voice) ? (raw.voice as string) : DEFAULTS.voice,
      speed: speedOf(raw.speed ?? 1),
      text: typeof raw.text === 'string' ? raw.text : '',
      subtitles: raw.subtitles !== false,
      server: { url: String(server.url), model: String(server.model), voice: String(server.voice), speed: speedOf(server.speed) },
    };
  } catch { return { ...DEFAULTS, server: { ...SERVER_DEFAULTS } }; }
}

const isAbort = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'AbortError';
const sentence = (e: unknown): string => (e instanceof Error && e.message ? e.message : t('The voice could not be made.'));

export class SpeechPanel {
  private readonly root: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  private readonly setRow: SpeechSetRow;
  private readonly builtOn: HTMLElement;
  private readonly voice: HTMLSelectElement;
  private readonly speed: HTMLInputElement;
  private readonly speedVal: HTMLElement;
  private readonly url: HTMLInputElement;
  private readonly check: HTMLButtonElement;
  private readonly checkNote: HTMLElement;
  private readonly model: HTMLInputElement;
  private readonly models: HTMLElement;
  private readonly serverVoice: HTMLInputElement;
  private readonly serverSpeed: HTMLInputElement;
  private readonly serverSpeedVal: HTMLElement;
  private readonly common: HTMLElement;
  private readonly area: HTMLTextAreaElement;
  private readonly subs: HTMLInputElement;
  private readonly go: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly unknown: HTMLElement;
  private opts = loadOpts();
  private open = false;
  private busy: AbortController | null = null;
  private checking = false;
  private textTimer = 0;

  constructor(private readonly engine: Engine, private readonly audio: () => AudioEngine) {
    const mk = (label: string, ...controls: HTMLElement[]): HTMLElement => {
      const row = el<HTMLElement>('<div class="fm-sp-row"><span class="fm-sp-lab"></span></div>');
      setText(q(row, '.fm-sp-lab'), t(label));
      row.append(...controls);
      return row;
    };
    const slider = (label: string): { range: HTMLInputElement; val: HTMLElement } => {
      const range = el<HTMLInputElement>(`<input class="fm-sp-range" type="range" min="${MIN_SPEED}" max="${MAX_SPEED}" step="0.05">`);
      range.setAttribute('aria-label', t(label));
      return { range, val: el<HTMLElement>('<span class="fm-sp-val"></span>') };
    };
    const field = (label: string): HTMLInputElement => {
      const input = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off">');
      input.setAttribute('aria-label', t(label));
      return input;
    };
    const note = (text: string, cls = 'fm-sp-note'): HTMLElement => {
      const p = el<HTMLElement>(`<p class="${cls}"></p>`);
      setText(p, t(text));
      return p;
    };

    this.root = el<HTMLElement>(
      '<section class="fm-sp" role="dialog" hidden>' +
      '<div class="fm-sp-head"><span class="fm-sp-title"></span><button class="fm-sp-x" type="button"></button></div>' +
      '<div class="fm-sp-tabs" role="tablist"></div>' +
      '<div class="fm-sp-pane" role="tabpanel" data-pane="built"></div>' +
      '<div class="fm-sp-pane" role="tabpanel" data-pane="server" hidden></div>' +
      '<div class="fm-sp-common"></div><div class="fm-sp-foot"></div></section>');
    this.root.setAttribute('aria-label', t('Generate voice'));
    setText(q(this.root, '.fm-sp-title'), t('Generate voice'));
    const closeBtn = q<HTMLButtonElement>(this.root, '.fm-sp-x');
    closeBtn.innerHTML = X;
    closeBtn.setAttribute('aria-label', t('Close'));
    closeBtn.addEventListener('click', () => this.close());

    const tabBar = q(this.root, '.fm-sp-tabs');
    tabBar.setAttribute('aria-label', t('How the voice is made'));
    for (const [id, label] of TABS) {
      const pane = q(this.root, `[data-pane="${id}"]`);
      pane.id = `fm-sp-pane-${id}`;
      const b = el<HTMLButtonElement>('<button class="fm-sp-tab" type="button" role="tab" aria-selected="false"></button>');
      b.id = `fm-sp-tab-${id}`;
      b.setAttribute('aria-controls', pane.id);
      pane.setAttribute('aria-labelledby', b.id);
      setText(b, t(label));
      b.addEventListener('click', () => this.showTab(id, true));
      this.tabs.set(id, b);
      this.panes.set(id, pane);
      tabBar.appendChild(b);
    }

    // Built-in voice
    this.setRow = new SpeechSetRow('voice', {
      about: 'Speech made on this computer, in English, with 28 voices. The files are downloaded once and can be removed.',
      remove: 'Remove the voice files',
      confirmTitle: 'Remove the voice files',
      confirmText: 'Remove the built-in voice files from this computer? They can be downloaded again.',
    }, () => this.patch());
    this.voice = el<HTMLSelectElement>('<select class="cv-input"></select>');
    this.voice.setAttribute('aria-label', t('Voice'));
    for (const [accent, gender, label] of GROUPS) {
      const group = document.createElement('optgroup');
      group.label = t(label);
      for (const v of VOICES) if (v.accent === accent && v.gender === gender) group.appendChild(new Option(v.name, v.id));
      this.voice.appendChild(group);
    }
    const sp = slider('Speed');
    this.speed = sp.range;
    this.speedVal = sp.val;
    this.builtOn = el<HTMLElement>('<div class="fm-sp-on" hidden></div>');
    this.builtOn.append(mk('Voice', this.voice), mk('Speed', this.speed, this.speedVal));
    (this.panes.get('built') as HTMLElement).append(this.setRow.root, this.builtOn);

    // Speech server
    this.url = field('Address');
    this.url.placeholder = SERVER_DEFAULTS.url;
    this.check = el<HTMLButtonElement>('<button class="cv-btn" type="button"></button>');
    setText(this.check, t('Check'));
    this.checkNote = el<HTMLElement>('<div class="fm-sp-check" aria-live="polite"></div>');
    this.model = field('Model');
    this.models = el<HTMLElement>('<datalist id="fm-sp-models"></datalist>');
    this.model.setAttribute('list', this.models.id);
    this.serverVoice = field('Voice');
    const ss = slider('Speed');
    this.serverSpeed = ss.range;
    this.serverSpeedVal = ss.val;
    (this.panes.get('server') as HTMLElement).append(
      note('This sends the text to a speech server running on this computer, which is how a voice cloned in another app is used.'),
      mk('Address', this.url, this.check), this.checkNote, mk('Model', this.model), this.models,
      mk('Voice', this.serverVoice), mk('Speed', this.serverSpeed, this.serverSpeedVal),
      note('Use only voices you have the right to use.', 'fm-sp-note fm-sp-rights'),
    );

    // The words, shared by both tabs
    this.common = q(this.root, '.fm-sp-common');
    this.area = el<HTMLTextAreaElement>('<textarea class="fm-sp-text" rows="5"></textarea>');
    this.area.setAttribute('aria-label', t('Words to speak'));
    this.area.placeholder = t('Type the words to speak');
    const chk = el<HTMLElement>('<label class="fm-sp-chk"><input type="checkbox"><span></span></label>');
    setText(q(chk, 'span'), t('Add subtitles'));
    this.subs = q<HTMLInputElement>(chk, 'input');
    this.go = el<HTMLButtonElement>('<button class="cv-btn fm-sp-go" type="button"></button>');
    setText(this.go, t('Generate'));
    this.cancel = el<HTMLButtonElement>('<button class="cv-btn" type="button" hidden></button>');
    setText(this.cancel, t('Cancel'));
    const actions = el<HTMLElement>('<div class="fm-sp-actions"></div>');
    actions.append(this.go, this.cancel);
    this.status = el<HTMLElement>('<div class="fm-sp-status" aria-live="polite"></div>');
    this.unknown = el<HTMLElement>('<div class="fm-sp-unknown" hidden></div>');
    this.common.append(this.area, chk, actions, this.status, this.unknown);
    q(this.root, '.fm-sp-foot').appendChild(this.setRow.remove);

    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    enhanceSelect(this.voice);

    this.voice.addEventListener('change', () => { this.opts = { ...this.opts, voice: this.voice.value }; this.persist(); });
    this.speed.addEventListener('input', () => { this.opts = { ...this.opts, speed: speedOf(this.speed.value) }; this.persist(); this.patch(); });
    this.serverSpeed.addEventListener('input', () => { this.setServer({ speed: speedOf(this.serverSpeed.value) }); this.patch(); });
    this.url.addEventListener('change', () => this.setServer({ url: this.url.value.trim() }));
    this.model.addEventListener('change', () => this.setServer({ model: this.model.value.trim() }));
    this.serverVoice.addEventListener('change', () => this.setServer({ voice: this.serverVoice.value.trim() }));
    this.check.addEventListener('click', () => { void this.checkNow(); });
    this.subs.addEventListener('change', () => { this.opts = { ...this.opts, subtitles: this.subs.checked }; this.persist(); });
    this.area.addEventListener('input', () => {
      this.opts = { ...this.opts, text: this.area.value };
      // typing saves on a pause, not on every letter
      window.clearTimeout(this.textTimer);
      this.textTimer = window.setTimeout(() => this.persist(), TEXT_SAVE_MS);
      this.patch();
    });
    this.go.addEventListener('click', () => { void this.generate(); });
    this.cancel.addEventListener('click', () => this.busy?.abort());
    window.addEventListener('keydown', (ev) => {
      if (!this.open || ev.key !== 'Escape' || !this.busy) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.busy.abort();
    }, true);
    this.engine.on('projects', () => { if (!this.engine.movie) this.close(); });
    this.syncControls();
    this.showTab(this.opts.tab, false);
  }

  show(): void {
    if (!this.engine.movie) return;
    this.open = true;
    setHidden(this.root, false);
    this.syncControls();
    this.setRow.start();
    this.patch();
  }

  close(): void {
    this.busy?.abort();
    window.clearTimeout(this.textTimer);
    this.persist();
    this.open = false;
    this.setRow.halt();
    setHidden(this.root, true);
  }

  private persist(): void {
    try { localStorage.setItem(STORE, JSON.stringify(this.opts)); } catch { /* kept for this session only */ }
  }

  private setServer(patch: Partial<ServerSettings>): void {
    this.opts = { ...this.opts, server: { ...this.opts.server, ...patch } };
    this.persist();
  }

  private syncControls(): void {
    const o = this.opts;
    this.voice.value = o.voice;
    setValue(this.speed, String(o.speed));
    setValue(this.url, o.server.url);
    setValue(this.model, o.server.model);
    setValue(this.serverVoice, o.server.voice);
    setValue(this.serverSpeed, String(o.server.speed));
    if (this.area.value !== o.text && document.activeElement !== this.area) this.area.value = o.text;
    setChecked(this.subs, o.subtitles);
  }

  private showTab(id: Tab, keep: boolean): void {
    for (const [k, b] of this.tabs) {
      setClass(b, 'is-on', k === id);
      b.setAttribute('aria-selected', String(k === id));
      b.tabIndex = k === id ? 0 : -1;
    }
    for (const [k, p] of this.panes) setHidden(p, k !== id);
    if (keep && this.opts.tab !== id) { this.opts = { ...this.opts, tab: id }; this.persist(); }
    this.patch();
  }

  private patch(): void {
    const built = this.opts.tab === 'built';
    const ready = !built || this.setRow.installed;
    const working = !!this.busy;
    setHidden(this.builtOn, !this.setRow.installed);
    setHidden(this.common, !ready);
    setText(this.speedVal, `${this.opts.speed.toFixed(2)}x`);
    setText(this.serverSpeedVal, `${this.opts.server.speed.toFixed(2)}x`);
    setHidden(this.go, working);
    setHidden(this.cancel, !working);
    setDisabled(this.go, !this.engine.movie || !this.opts.text.trim());
    setDisabled(this.check, this.checking || working);
    for (const c of [this.voice, this.speed, this.url, this.model, this.serverVoice, this.serverSpeed, this.subs]) setDisabled(c, working);
    if (this.area.readOnly !== working) this.area.readOnly = working;
    for (const b of this.tabs.values()) setDisabled(b, working);
    setDisabled(this.setRow.remove, working);
  }

  private async checkNow(): Promise<void> {
    const url = this.url.value.trim() || SERVER_DEFAULTS.url;
    this.setServer({ url });
    this.checking = true;
    setText(this.checkNote, t('Checking...'));
    setClass(this.checkNote, 'is-bad', false);
    this.patch();
    const got = await checkServer(url);
    this.checking = false;
    patchList(this.models, got.models, {
      key: (m) => m,
      create: (m) => { const o = document.createElement('option'); o.value = m; return o; },
      update: () => undefined,
    });
    setClass(this.checkNote, 'is-bad', !got.ok);
    if (!got.ok) setText(this.checkNote, got.error || t('The speech server could not be reached.'));
    else if (!got.models.length) setText(this.checkNote, t('The speech server answered. It lists no models, so type the model name.'));
    else {
      setText(this.checkNote, tf(got.models.length === 1 ? 'The speech server answered with {n} model.' : 'The speech server answered with {n} models.', { n: got.models.length }));
      if (!this.model.value.trim()) { this.model.value = got.models[0]; this.setServer({ model: got.models[0] }); }
    }
    this.patch();
  }

  // ---- generate ----

  private async generate(): Promise<void> {
    const text = this.area.value.trim();
    if (!this.engine.movie || this.busy || !text) return;
    const ctl = new AbortController();
    this.busy = ctl;
    setHidden(this.unknown, true);
    setClass(this.status, 'is-bad', false);
    this.patch();
    try {
      if (this.opts.tab === 'built') await this.fromBuiltIn(text, ctl.signal);
      else await this.fromServer(text, ctl.signal);
    } catch (e) {
      if (isAbort(e)) setText(this.status, t('Cancelled.'));
      else {
        console.error('Generate voice failed:', e);
        setClass(this.status, 'is-bad', true);
        setText(this.status, sentence(e));
      }
    } finally {
      this.busy = null;
      this.patch();
    }
  }

  private async fromBuiltIn(text: string, signal: AbortSignal): Promise<void> {
    const total = splitSentences(text).length;
    const said = (done: number): void => setText(this.status, tf('Sentence {done} of {total}', { done: Math.min(total, done + 1), total }));
    said(0);
    const spoken = await speak(text, { voice: this.opts.voice, speed: this.opts.speed, signal, onProgress: (done) => said(done) });
    if (!spoken.sentences.length) throw new Error(t('There are no words to speak in that text.'));
    const { samples } = join(spoken, SENTENCE_GAP_SECONDS);
    const seconds = samples.length / spoken.sampleRate;
    const blob = encodeWav({ channels: [samples], sampleRate: spoken.sampleRate, seconds });
    const id = uid('a');
    this.engine.assets.set(id, blob);
    this.land(id, blob, seconds, (at) => linesFromSentences(spoken.sentences, at, SENTENCE_GAP_SECONDS));
    if (spoken.unknown.length) {
      setText(this.unknown, tf('Spelled out, because no dictionary has them: {words}', { words: spoken.unknown.join(', ') }));
      setHidden(this.unknown, false);
    }
  }

  private async fromServer(text: string, signal: AbortSignal): Promise<void> {
    setText(this.status, t('Waiting for the speech server...'));
    const settings: ServerSettings = { ...this.opts.server, url: this.opts.server.url.trim() || SERVER_DEFAULTS.url };
    const blob = await speakOnServer(text, settings, signal);
    // the sound is kept as the server sent it; it is decoded only to learn how long it is
    const id = uid('a');
    this.engine.assets.set(id, blob);
    const buf = await this.audio().decode(id);
    if (signal.aborted || !buf || !(buf.duration > 0)) {
      this.engine.assets.delete(id);
      if (signal.aborted) throw new DOMException('Speaking was cancelled', 'AbortError');
      throw new Error(t('The speech server answered with sound FormMorpheus could not read.'));
    }
    this.land(id, blob, buf.duration, (at) => linesForWholeSound(text, buf.duration, at));
  }

  /** The sound and its lines onto the movie as one undo step; the stored sound is dropped again when the step fails. */
  private land(assetId: string, blob: Blob, seconds: number, linesAt: (startSeconds: number) => SubtitleLine[]): void {
    const m = this.engine.movie;
    if (!m) { this.engine.assets.delete(assetId); throw new Error(t('The movie was closed before the voice was ready.')); }
    const start = this.engine.frame;
    const lines = this.opts.subtitles ? linesAt(start / m.fps) : [];
    const mime = blob.type.split(';')[0].trim() || 'audio/wav';
    const style = loadSubtitleStyle();
    let ok = false;
    try {
      ok = this.engine.run('Generate Voice', (mv) => {
        const placed = placeVoice(mv, { assetId, mime, size: blob.size, seconds }, start, lines, style);
        return { movie: placed.movie, select: [placed.blockId] };
      });
    } finally {
      if (!ok) this.engine.assets.delete(assetId);
    }
    if (!ok) throw new Error(t('The voice could not be added to the movie.'));
    setText(this.status, tf(lines.length ? 'Voice added: {seconds} s, with subtitles.' : 'Voice added: {seconds} s.', { seconds: seconds.toFixed(1) }));
  }
}
