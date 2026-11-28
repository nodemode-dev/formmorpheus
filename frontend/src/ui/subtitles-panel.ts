// The Subtitles card: whether the video shows its lines, their one look, the lines themselves, lines from AI voices or
// from listening to a sound, and .srt and .vtt files. Built once, then patched in place; the lines are always read
// from engine.movie, never kept here.
import type { Engine } from '../engine/engine';
import type { Content, Movie, SubtitleCue, SubtitleStyle } from '../engine/types';
import { addCues, cueAt, cuesForSound, deleteCues, linesToCues, setCues, setSubtitleShow, setSubtitleStyle, subtitlesOf, updateCue, type TimedLine } from '../engine/subtitles';
import { ApiError, downloadBlob } from '../io/api';
import { parseSubtitles, writeSubtitles } from '../io/subtitle-files';
import { voiceApi, type ListenStatus, type VoiceJob } from '../io/voice-api';
import { soundForSpeech } from '../media/speech-pcm';
import { chooseOrCancel } from './dialogs';
import { el, patchList, q, setChecked, setClass, setDisabled, setHidden, setStyleVar, setText, setValue } from './dom';
import { enhanceSelect } from './dropdown';
import { t } from './i18n';
import '../styles/subtitles.css';

type Position = SubtitleStyle['position'];

const STORE = 'formmorpheus.subtitles';
const POLL_MS = 700;
const NEW_SECONDS = 2;
const LANGS: ReadonlyArray<readonly [string, string]> = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['nl', 'Dutch'], ['pl', 'Polish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'], ['ar', 'Arabic'],
  ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
];

const X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const GO = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14"/><path d="M10 6l8 6-8 6z"/></svg>';
const BIN = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';
const message = (e: unknown): string => (e instanceof ApiError || e instanceof Error ? e.message : String(e));
const mb = (bytes: number): string => (bytes / 1048576).toFixed(0);
const secs = (frame: number, fps: number): string => (frame / fps).toFixed(1);

/** Seconds as typed: "12.5", "12,5" or "1:02.5". NaN when it is none of those. */
function parseSeconds(raw: string): number {
  const parts = raw.trim().replace(',', '.').split(':');
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d*\.?\d*$/.test(p) || p === '' || p === '.')) return NaN;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

const isSound = (m: Movie, c: Content): boolean => {
  const a = c.asset ? m.assets[c.asset] : undefined;
  return !!a && (c.kind === 'audio' || (c.kind === 'video' && !!a.hasAudio));
};

/** Every block in the movie, groups included, each once. */
function allContent(m: Movie): Content[] {
  const out: Content[] = [];
  const seen = new Set<string>();
  const walk = (list: Content[]): void => {
    for (const c of list) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      for (const tr of c.tracks ?? []) walk(tr.content);
    }
  };
  for (const tr of m.tracks) walk(tr.content);
  return out;
}

function loadLanguage(): string {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as { language?: unknown };
    return typeof raw.language === 'string' && (raw.language === 'auto' || LANGS.some(([c]) => c === raw.language)) ? raw.language : 'auto';
  } catch { return 'auto'; }
}

export class SubtitlesPanel {
  private readonly root: HTMLElement;
  private readonly err: HTMLElement;
  private readonly showBox: HTMLInputElement;
  private readonly font: HTMLSelectElement;
  private readonly size: HTMLInputElement;
  private readonly sizeVal: HTMLElement;
  private readonly posBtns: Record<Position, HTMLButtonElement>;
  private readonly color: HTMLInputElement;
  private readonly band: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly voicesBtn: HTMLButtonElement;
  private readonly listenBtn: HTMLButtonElement;
  private readonly listenCancel: HTMLButtonElement;
  private readonly runtimeNote: HTMLElement;
  private readonly setupBox: HTMLElement;
  private readonly setupBtn: HTMLButtonElement;
  private readonly setupCancel: HTMLButtonElement;
  private readonly prog: HTMLElement;
  private readonly stepLine: HTMLElement;
  private readonly readyBox: HTMLElement;
  private readonly language: HTMLSelectElement;
  private readonly fileInput: HTMLInputElement;
  private readonly importBtn: HTMLButtonElement;
  private readonly srtBtn: HTMLButtonElement;
  private readonly vttBtn: HTMLButtonElement;
  private readonly status: HTMLElement;
  private fonts: string[] = [];
  private st: ListenStatus | null = null;
  private job: VoiceJob | null = null;
  private ctrl: AbortController | null = null;
  private pollTimer = 0;
  private open = false;
  private nowId: string | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly engine: Engine, private readonly deps: { fonts: () => string[] }) {
    const row = (label: string, control: HTMLElement): HTMLElement => {
      const r = el<HTMLElement>('<div class="fm-sub-row"><span class="fm-sub-lab"></span></div>');
      setText(q(r, '.fm-sub-lab'), t(label));
      r.appendChild(control);
      return r;
    };
    const named = <T extends HTMLElement>(html: string, label: string): T => { const n = el<T>(html); n.setAttribute('aria-label', t(label)); return n; };
    const button = (cls: string, label: string): HTMLButtonElement => { const b = el<HTMLButtonElement>(`<button class="${cls}" type="button"></button>`); setText(b, t(label)); return b; };
    const para = (cls: string, label: string): HTMLElement => { const p = el<HTMLElement>(`<p class="${cls}"></p>`); setText(p, t(label)); return p; };
    const check = (label: string): { wrap: HTMLElement; box: HTMLInputElement } => {
      const wrap = el<HTMLElement>('<label class="fm-sub-check"><input type="checkbox"><span></span></label>');
      setText(q(wrap, 'span'), t(label));
      return { wrap, box: q<HTMLInputElement>(wrap, 'input') };
    };
    const head = (label: string): HTMLElement => { const h = el<HTMLElement>('<div class="fm-sub-sec"></div>'); setText(h, t(label)); return h; };

    this.root = el<HTMLElement>(
      '<section class="fm-sub" role="dialog" hidden>' +
      '<div class="fm-sub-head"><span class="fm-sub-title"></span><button class="fm-sub-x" type="button"></button></div>' +
      '<div class="fm-sub-err" role="alert" hidden></div>' +
      '<div class="fm-sub-body"></div></section>');
    this.root.setAttribute('aria-label', t('Subtitles'));
    setText(q(this.root, '.fm-sub-title'), t('Subtitles'));
    const closeBtn = q<HTMLButtonElement>(this.root, '.fm-sub-x');
    closeBtn.innerHTML = X;
    closeBtn.setAttribute('aria-label', t('Close'));
    closeBtn.addEventListener('click', () => this.close());
    this.err = q(this.root, '.fm-sub-err');

    // ---- shown, and the look ----
    const shown = check('Show subtitles in the video');
    this.showBox = shown.box;
    this.font = named<HTMLSelectElement>('<select class="cv-input"></select>', 'Font');
    this.size = named<HTMLInputElement>('<input type="range" min="2" max="15" step="0.5">', 'Size');
    this.sizeVal = el<HTMLElement>('<span class="fm-sub-val"></span>');
    const sizeRow = el<HTMLElement>('<div class="fm-sub-range"></div>');
    sizeRow.append(this.size, this.sizeVal);
    const posGroup = el<HTMLElement>('<div class="fm-sub-seg" role="radiogroup"></div>');
    posGroup.setAttribute('aria-label', t('Position'));
    const mkPos = (id: Position, label: string): HTMLButtonElement => {
      const b = el<HTMLButtonElement>('<button class="fm-sub-segbtn" type="button" role="radio"></button>');
      setText(b, t(label));
      b.addEventListener('click', () => this.look({ position: id }));
      posGroup.appendChild(b);
      return b;
    };
    this.posBtns = { top: mkPos('top', 'Top'), middle: mkPos('middle', 'Middle'), bottom: mkPos('bottom', 'Bottom') };
    posGroup.addEventListener('keydown', (e) => {
      const order: Position[] = ['top', 'middle', 'bottom'];
      const cur = order.indexOf(this.style()?.position ?? 'bottom');
      const rtl = getComputedStyle(posGroup).direction === 'rtl';
      let next = -1;
      if (e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = (cur + 1) % 3;
      else if (e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = (cur + 2) % 3;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = 2;
      if (next < 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.look({ position: order[next] });
      this.posBtns[order[next]].focus();
    });
    this.color = named<HTMLInputElement>('<input class="fm-sub-color" type="color">', 'Text color');
    const banded = check('Dark band behind the words');
    this.band = banded.box;

    // ---- the lines ----
    this.list = el<HTMLElement>('<div class="fm-sub-list" role="list"></div>');
    this.list.setAttribute('aria-label', t('Lines'));
    this.empty = el<HTMLElement>('<p class="fm-sub-empty"></p>');
    this.addBtn = button('cv-btn', 'Add line at the playhead');
    this.voicesBtn = button('cv-btn', 'From AI voices');
    const lineActs = el<HTMLElement>('<div class="fm-sub-acts"></div>');
    lineActs.append(this.addBtn, this.voicesBtn);

    // ---- listening to a sound ----
    this.listenBtn = button('cv-btn fm-sub-go', 'Subtitles from this sound');
    this.listenCancel = button('cv-btn', 'Cancel');
    setHidden(this.listenCancel, true);
    const listenActs = el<HTMLElement>('<div class="fm-sub-acts"></div>');
    listenActs.append(this.listenBtn, this.listenCancel);
    this.runtimeNote = para('fm-sub-note', 'Listening uses the built-in voice\'s runtime. Set up the built-in voice first, in the AI Voice card.');
    setHidden(this.runtimeNote, true);
    this.setupBox = el<HTMLElement>('<div class="fm-sub-setup" hidden></div>');
    this.setupBtn = button('cv-btn', 'Download the listening model');
    this.setupCancel = button('cv-btn', 'Cancel');
    this.prog = el<HTMLElement>('<div class="fm-sub-prog is-idle" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="fm-sub-fill"></div></div>');
    this.prog.setAttribute('aria-label', t('Download progress'));
    this.stepLine = el<HTMLElement>('<div class="fm-sub-step" aria-live="polite"></div>');
    const setupActs = el<HTMLElement>('<div class="fm-sub-acts"></div>');
    setupActs.append(this.setupBtn, this.setupCancel);
    this.setupBox.append(para('fm-sub-note', 'Listening needs its own model, a one-time download of about 80 MB.'), this.prog, this.stepLine, setupActs);
    this.readyBox = el<HTMLElement>('<div class="fm-sub-ready" hidden></div>');
    this.language = named<HTMLSelectElement>('<select class="cv-input"></select>', 'Language');
    this.language.append(new Option(t('Detect'), 'auto'), ...LANGS.map(([code, name]) => new Option(t(name), code)));
    this.language.value = loadLanguage();
    this.readyBox.append(row('Language', this.language));

    // ---- files ----
    this.fileInput = el<HTMLInputElement>('<input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" hidden>');
    this.importBtn = button('cv-btn', 'Import .srt or .vtt...');
    this.srtBtn = button('cv-btn', 'Export .srt');
    this.vttBtn = button('cv-btn', 'Export .vtt');
    const fileActs = el<HTMLElement>('<div class="fm-sub-acts is-wrap"></div>');
    fileActs.append(this.importBtn, this.srtBtn, this.vttBtn, this.fileInput);

    this.status = el<HTMLElement>('<div class="fm-sub-status" aria-live="polite"></div>');
    q(this.root, '.fm-sub-body').append(
      shown.wrap,
      head('Look'), row('Font', this.font), row('Size', sizeRow), row('Position', posGroup), row('Text color', this.color), banded.wrap,
      head('Lines'), this.list, this.empty, lineActs,
      listenActs, this.runtimeNote, this.setupBox, this.readyBox,
      head('Files'), fileActs,
      this.status,
    );

    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    enhanceSelect(this.font);
    enhanceSelect(this.language);

    // ---- wiring ----
    this.showBox.addEventListener('change', () => { const on = this.showBox.checked; this.engine.run('Subtitles', (m) => setSubtitleShow(m, on)); });
    this.font.addEventListener('change', () => { if (this.font.value) this.look({ font: this.font.value }); });
    // a drag is one undo step: the merge tag holds while the pointer moves, change ends it
    this.size.addEventListener('input', () => {
      const v = Number(this.size.value);
      if (Number.isFinite(v)) this.look({ size: v }, 'subtitle-size');
      this.patchSize(v);
    });
    this.color.addEventListener('input', () => this.look({ color: this.color.value }, 'subtitle-color'));
    for (const n of [this.size, this.color]) n.addEventListener('change', () => this.engine.endGesture());
    this.band.addEventListener('change', () => this.look({ band: this.band.checked }));
    this.addBtn.addEventListener('click', () => this.addLine());
    this.voicesBtn.addEventListener('click', () => this.fromVoices());
    this.listenBtn.addEventListener('click', () => { void this.listen(); });
    this.listenCancel.addEventListener('click', () => this.ctrl?.abort());
    this.setupBtn.addEventListener('click', () => { void this.startSetup(); });
    this.setupCancel.addEventListener('click', () => { void this.cancelSetup(); });
    this.language.addEventListener('change', () => {
      try { localStorage.setItem(STORE, JSON.stringify({ language: this.language.value })); } catch { /* kept for this session only */ }
    });
    this.importBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => { void this.importFile(); });
    this.srtBtn.addEventListener('click', () => this.exportFile('srt'));
    this.vttBtn.addEventListener('click', () => this.exportFile('vtt'));
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.running()) return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });
    // run, undo and redo emit 'movie'; closing a movie emits only 'projects'
    this.engine.on('movie', () => { if (this.open) this.patch(); });
    this.engine.on('projects', () => { if (this.open) this.patch(); });
    this.engine.on('selection', () => { if (this.open) this.patchListen(); });
    this.engine.on('time', () => { if (this.open) this.patchNow(!this.engine.playing); });
    this.engine.on('playing', (on) => { if (this.open && !on) this.patchNow(true); });
    this.patch();
  }

  show(): void {
    const was = this.open;
    this.open = true;
    if (!was) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.fonts = this.deps.fonts();
    setHidden(this.root, false);
    this.patch();
    this.patchNow(true);
    if (!was) this.showBox.focus();
    void this.refresh();
  }

  // Closing aborts nothing: a listening that runs finishes and its lines land in the movie.
  close(): void {
    if (!this.open) return;
    this.open = false;
    window.clearTimeout(this.pollTimer);
    this.pollTimer = 0;
    const inside = this.root.contains(document.activeElement);
    setHidden(this.root, true);
    if (inside && this.returnFocus?.isConnected) this.returnFocus.focus();
    this.returnFocus = null;
  }

  private running(): boolean { return !!this.ctrl || this.job?.state === 'running'; }
  private showErr(text: string): void { setText(this.err, text); setHidden(this.err, false); }
  private clearErr(): void { setHidden(this.err, true); }
  private say(text: string): void { setText(this.status, text); }
  private style(): SubtitleStyle | null { const m = this.engine.movie; return m ? subtitlesOf(m).style : null; }

  private look(patch: Partial<SubtitleStyle>, merge: string | null = null): void {
    this.engine.run('Subtitle Look', (m) => setSubtitleStyle(m, patch), merge);
  }

  // ---- the lines ----

  private cue(id: string): SubtitleCue | null {
    const m = this.engine.movie;
    return m ? subtitlesOf(m).cues.find((c) => c.id === id) ?? null : null;
  }

  private addLine(): void {
    const m = this.engine.movie;
    if (!m) return;
    const start = Math.max(0, Math.min(this.engine.frame, m.duration - 1));
    const end = Math.max(start + 1, Math.min(m.duration, start + Math.round(NEW_SECONDS * m.fps)));
    const before = new Set(subtitlesOf(m).cues.map((c) => c.id));
    if (!this.engine.run('Add Subtitle', (mv) => addCues(mv, [{ start, end, text: t('New line') }]))) return;
    const now = this.engine.movie;
    const made = now ? subtitlesOf(now).cues.find((c) => !before.has(c.id)) : undefined;
    const rowEl = made ? this.rowOf(made.id) : null;
    const text = rowEl?.querySelector<HTMLInputElement>('.fm-sub-text');
    if (text) { text.focus(); text.select(); }
  }

  private fromVoices(): void {
    const m = this.engine.movie;
    if (!m) return;
    const ids = allContent(m).filter((c) => isSound(m, c) && !!m.assets[c.asset as string]?.spoken).map((c) => c.id);
    this.clearErr();
    if (!ids.length) { this.say(t('No sound in this movie was spoken by an AI voice.')); return; }
    let count = 0;
    this.engine.run('Subtitles', (mv) => {
      let next = mv;
      count = 0;
      for (const id of ids) {
        const cues = cuesForSound(next, id);
        count += cues.length;
        next = addCues(next, cues, id);
      }
      return next;
    });
    this.say(t('{count} lines made from AI voices').replace('{count}', String(count)));
  }

  private commitTime(id: string, which: 'start' | 'end', input: HTMLInputElement): void {
    const m = this.engine.movie;
    const c = this.cue(id);
    if (!m || !c) return;
    const shown = secs(c[which], m.fps);
    const raw = input.value.trim();
    if (raw === shown) return;
    const s = parseSeconds(raw);
    if (Number.isFinite(s)) {
      const f = Math.round(s * m.fps);
      // start stays before end: the edited edge stops one frame short of the other
      const v = which === 'start' ? Math.max(0, Math.min(f, c.end - 1)) : Math.max(c.start + 1, f);
      if (v !== c[which]) this.engine.run('Edit Subtitle', (mv) => updateCue(mv, id, which === 'start' ? { start: v } : { end: v }));
    }
    // the field is focused, so the redraw leaves it: write what the movie now holds
    const after = this.cue(id);
    input.value = after ? secs(after[which], m.fps) : shown;
  }

  private commitText(id: string, input: HTMLInputElement): void {
    const c = this.cue(id);
    if (!c) return;
    const text = input.value.trim();
    if (!text) { input.value = c.text; return; }
    if (text !== c.text) this.engine.run('Edit Subtitle', (m) => updateCue(m, id, { text }));
  }

  private makeRow(cue: SubtitleCue): HTMLElement {
    const id = cue.id;
    const r = el<HTMLElement>(
      '<div class="fm-sub-cue" role="listitem">' +
      `<button class="fm-sub-icon fm-sub-seek" type="button">${GO}</button>` +
      '<input class="cv-input fm-sub-time fm-sub-start" type="text" inputmode="decimal" spellcheck="false" autocomplete="off">' +
      '<input class="cv-input fm-sub-time fm-sub-end" type="text" inputmode="decimal" spellcheck="false" autocomplete="off">' +
      '<input class="cv-input fm-sub-text" type="text" spellcheck="true" autocomplete="off">' +
      `<button class="fm-sub-icon fm-sub-del" type="button">${BIN}</button>` +
      '</div>');
    const seek = q<HTMLButtonElement>(r, '.fm-sub-seek');
    const start = q<HTMLInputElement>(r, '.fm-sub-start');
    const end = q<HTMLInputElement>(r, '.fm-sub-end');
    const text = q<HTMLInputElement>(r, '.fm-sub-text');
    const del = q<HTMLButtonElement>(r, '.fm-sub-del');
    seek.setAttribute('aria-label', t('Go to this line'));
    seek.title = t('Go to this line');
    start.setAttribute('aria-label', t('Starts at, in seconds'));
    end.setAttribute('aria-label', t('Ends at, in seconds'));
    text.setAttribute('aria-label', t('Words'));
    del.setAttribute('aria-label', t('Delete this line'));
    del.title = t('Delete this line');
    seek.addEventListener('click', () => { const c = this.cue(id); if (c) this.engine.seek(c.start); });
    del.addEventListener('click', () => { this.engine.run('Delete Subtitle', (m) => deleteCues(m, [id])); });
    for (const [input, which] of [[start, 'start'], [end, 'end']] as const) {
      input.addEventListener('change', () => this.commitTime(id, which, input));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.commitTime(id, which, input); } });
    }
    text.addEventListener('change', () => this.commitText(id, text));
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.commitText(id, text); } });
    this.fillRow(r, cue);
    return r;
  }

  private fillRow(r: HTMLElement, cue: SubtitleCue): void {
    const m = this.engine.movie;
    if (!m) return;
    setValue(q<HTMLInputElement>(r, '.fm-sub-start'), secs(cue.start, m.fps));
    setValue(q<HTMLInputElement>(r, '.fm-sub-end'), secs(cue.end, m.fps));
    setValue(q<HTMLInputElement>(r, '.fm-sub-text'), cue.text);
    setClass(r, 'is-now', cue.id === this.nowId);
  }

  private rowOf(id: string): HTMLElement | null {
    for (const n of Array.from(this.list.children)) if ((n as HTMLElement).dataset.key === id) return n as HTMLElement;
    return null;
  }

  /** Marks the line under the playhead; scrolls it into the list's view only when asked (playback stopped). */
  private patchNow(scroll: boolean): void {
    const m = this.engine.movie;
    const id = m ? cueAt(m, this.engine.frame)?.id ?? null : null;
    if (id !== this.nowId) {
      const old = this.nowId ? this.rowOf(this.nowId) : null;
      if (old) setClass(old, 'is-now', false);
      this.nowId = id;
    }
    const cur = id ? this.rowOf(id) : null;
    if (!cur) return;
    setClass(cur, 'is-now', true);
    if (!scroll) return;
    const top = cur.offsetTop;
    const bottom = top + cur.offsetHeight;
    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (bottom > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = bottom - this.list.clientHeight;
  }

  // ---- listening ----

  private soundSelected(): Content | null {
    const m = this.engine.movie;
    if (!m) return null;
    const sounds = this.engine.selected.filter((c) => isSound(m, c));
    return sounds.length === 1 ? sounds[0] : null;
  }

  private async refresh(): Promise<void> {
    try {
      this.st = await voiceApi.listenStatus();
    } catch (e) {
      this.showErr(message(e));
      this.patchListen();
      return;
    }
    this.job = this.st.job;
    if (this.job?.state === 'running') this.poll();
    this.patchListen();
  }

  private async startSetup(): Promise<void> {
    this.clearErr();
    try {
      this.job = await voiceApi.setupListen();
    } catch (e) {
      this.showErr(message(e));
      return;
    }
    this.patchListen();
    this.poll();
  }

  /** Polls the download only while the card is open and the download runs. */
  private poll(): void {
    window.clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(() => { void this.pollOnce(); }, POLL_MS);
  }

  private async pollOnce(): Promise<void> {
    this.pollTimer = 0;
    if (!this.open) return;
    let job: VoiceJob | null;
    try {
      job = await voiceApi.listenJob();
    } catch (e) {
      this.showErr(message(e));
      this.job = null;
      this.patchListen();
      return;
    }
    this.job = job;
    if (job?.state === 'running') { this.patchListen(); if (this.open) this.poll(); return; }
    if (job?.state === 'failed') this.showErr(job.error || t('The download did not finish.'));
    if (job?.state === 'cancelled') this.say(t('Download cancelled.'));
    if (job?.state === 'done') {
      this.job = null;
      try { this.st = await voiceApi.listenStatus(); } catch (e) { this.showErr(message(e)); }
    }
    this.patchListen();
  }

  private async cancelSetup(): Promise<void> {
    try { await voiceApi.cancelListen(); } catch (e) { this.showErr(message(e)); }
  }

  private async listen(): Promise<void> {
    const block = this.soundSelected();
    if (!block || this.ctrl || !this.st?.ready) return;
    const id = block.id;
    const name = block.name || this.engine.movie?.assets[block.asset as string]?.name || t('this sound');
    const language = this.language.value || 'auto';
    this.clearErr();
    this.say('');
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.patchListen();
    try {
      const sound = await soundForSpeech(this.engine, id);
      if (ctrl.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (!sound) { this.showErr(t('This sound could not be read.')); return; }
      const heard = await voiceApi.listen(sound.wav, language, ctrl.signal);
      const lines: TimedLine[] = sound.lines(heard.cues);
      const m = this.engine.movie;
      const cues = m ? linesToCues(m, id, lines) : [];
      if (!cues.length) { this.say(t('No words were heard in this sound.')); return; }
      let count = 0;
      this.engine.run('Subtitles', (mv) => { const made = linesToCues(mv, id, lines); count = made.length; return addCues(mv, made, id); });
      this.say(t('{count} lines from {name}').replace('{count}', String(count)).replace('{name}', name));
    } catch (e) {
      if (isAbort(e)) this.say(t('Cancelled.'));
      else this.showErr(message(e));
    } finally {
      this.ctrl = null;
      this.patchListen();
    }
  }

  // ---- files ----

  private async importFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    const m0 = this.engine.movie;
    if (!file || !m0) return;
    this.clearErr();
    let lines: TimedLine[];
    try {
      lines = parseSubtitles(await file.text());
    } catch (e) {
      this.showErr(message(e));
      return;
    }
    if (!lines.length) { this.say(t('No subtitles were found in that file.')); return; }
    const toCues = (fps: number): Array<Omit<SubtitleCue, 'id'>> => lines.map((l) => {
      const start = Math.max(0, Math.round(l.start * fps));
      return { start, end: Math.max(start + 1, Math.round(l.end * fps)), text: l.text };
    });
    let replace = false;
    const have = subtitlesOf(m0).cues.length;
    if (have) {
      const pick = await chooseOrCancel(
        t('Replace the subtitles?'),
        t('This movie has {have} lines already. Replace them with the {count} lines of the file, or add these to them.').replace('{have}', String(have)).replace('{count}', String(lines.length)),
        t('Replace'), t('Add'),
      );
      if (pick === null) return;
      replace = pick;
    }
    if (!this.engine.movie) return;
    this.engine.run('Import Subtitles', (m) => (replace ? setCues(m, toCues(m.fps)) : addCues(m, toCues(m.fps))));
    this.say(t('{count} lines imported from {name}').replace('{count}', String(lines.length)).replace('{name}', file.name));
  }

  private exportFile(format: 'srt' | 'vtt'): void {
    const m = this.engine.movie;
    if (!m) return;
    const cues = subtitlesOf(m).cues;
    if (!cues.length) return;
    const lines: TimedLine[] = cues.map((c) => ({ start: c.start / m.fps, end: c.end / m.fps, text: c.text }));
    const blob = new Blob([writeSubtitles(lines, format)], { type: format === 'vtt' ? 'text/vtt' : 'application/x-subrip' });
    const base = (m.name || t('Subtitles')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'subtitles';
    downloadBlob(blob, `${base}.${format}`);
  }

  // ---- patching ----

  private patchSize(v: number): void { setText(this.sizeVal, `${Number.isFinite(v) ? Number(v.toFixed(1)) : 5}%`); }

  /** The font list as the card opened with it, plus the movie's own font, keyed so an unchanged list is not touched. */
  private patchFonts(current: string): void {
    const items = this.fonts.includes(current) || !current ? this.fonts : [current, ...this.fonts];
    const sig = items.join('\u0001');
    if (this.font.dataset.sig !== sig) {
      this.font.dataset.sig = sig;
      patchList(this.font, items, {
        key: (f) => f,
        create: (f) => new Option(f, f),
        update: () => undefined,
      });
    }
    if (current && this.font.value !== current) this.font.value = current;
  }

  private patch(): void {
    const m = this.engine.movie;
    const sub = m ? subtitlesOf(m) : null;
    const style = sub?.style ?? null;
    const off = !m;

    setChecked(this.showBox, !!sub?.show);
    setDisabled(this.showBox, off);
    this.patchFonts(style?.font ?? '');
    setDisabled(this.font, off);
    if (style) { setValue(this.size, String(style.size)); this.patchSize(document.activeElement === this.size ? Number(this.size.value) : style.size); }
    setDisabled(this.size, off);
    for (const id of ['top', 'middle', 'bottom'] as const) {
      const on = style?.position === id;
      const b = this.posBtns[id];
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on || (!style && id === 'bottom') ? 0 : -1;
      setClass(b, 'is-on', on);
      setDisabled(b, off);
    }
    if (style) setValue(this.color, style.color);
    setDisabled(this.color, off);
    setChecked(this.band, !!style?.band);
    setDisabled(this.band, off);

    const cues = sub?.cues ?? [];
    if (m) this.nowId = cueAt(m, this.engine.frame)?.id ?? null;
    patchList(this.list, cues, { key: (c) => c.id, create: (c) => this.makeRow(c), update: (n, c) => this.fillRow(n, c) });
    setHidden(this.list, !cues.length);
    setText(this.empty, off ? t('Open a movie to add subtitles.') : t('No subtitles yet. AI voices add theirs when they speak.'));
    setHidden(this.empty, !!cues.length);
    setDisabled(this.addBtn, off);
    setDisabled(this.voicesBtn, off);
    setDisabled(this.importBtn, off);
    setDisabled(this.srtBtn, !cues.length);
    setDisabled(this.vttBtn, !cues.length);
    this.patchListen();
  }

  private patchListen(): void {
    const st = this.st;
    const listening = !!this.ctrl;
    const job = this.job?.state === 'running' ? this.job : null;
    const ready = !!st?.ready && !job;
    setHidden(this.runtimeNote, !st || ready || !!job || st.runtime);
    setHidden(this.setupBox, !st || ready || (!st.runtime && !job));
    setHidden(this.readyBox, !ready);
    setHidden(this.setupBtn, !!job);
    setHidden(this.setupCancel, !job);
    setClass(this.prog, 'is-idle', !job);
    const sized = !!job && job.total > 0;
    setClass(this.prog, 'is-busy', !!job && !sized);
    const frac = sized ? Math.min(1, job.done / job.total) : 0;
    setStyleVar(this.prog, '--p', frac.toFixed(3));
    if (sized) this.prog.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    else this.prog.removeAttribute('aria-valuenow');
    let step = '';
    if (job) {
      step = t('Downloading the listening model');
      if (sized) step += ` · ${t('{done} MB of {total} MB').replace('{done}', mb(job.done)).replace('{total}', mb(job.total))}`;
    }
    setText(this.stepLine, step);
    const off = !this.engine.movie;
    setDisabled(this.setupBtn, off);

    setText(this.listenBtn, listening ? t('Listening...') : t('Subtitles from this sound'));
    setClass(this.listenBtn, 'is-busy', listening);
    setDisabled(this.listenBtn, listening || !ready || !this.soundSelected());
    setHidden(this.listenCancel, !listening);
    setDisabled(this.language, off || listening);
  }
}
