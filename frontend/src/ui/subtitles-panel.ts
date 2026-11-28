// The Subtitles card: show or hide the movie's subtitles, restyle every line at once, edit the lines one by one,
// make lines from the selected sound block by speech to text, and read or write a subtitles file. The lines are the
// text blocks of the movie's subtitles track, so the list follows the movie (undo, a generated voice). Built once,
// then patched in place.
import type { Engine } from '../engine/engine';
import { end } from '../engine/model';
import * as ops from '../engine/ops';
import { findContent } from '../engine/transform';
import { fromSrt, linesFromWords, readSubtitles, restyleSubtitles, showSubtitles, subtitleTrack, toSrt, writeSubtitles, type SubtitleStyle } from '../engine/subtitles';
import type { Content, Movie } from '../engine/types';
import { downloadBlob } from '../io/api';
import { embedLibraryFamily, inLibrary } from '../io/fonts-library';
import type { AudioEngine } from '../media/audio';
import { ensureTextFont, fontCatalog, previewFont } from '../media/fonts';
import { listen } from '../media/speech/listen';
import { platform } from '../platform';
import { ColourPanel } from './colour-panel';
import { confirmAction } from './dialogs';
import { el, patchList, q, setChecked, setClass, setDisabled, setHidden, setStyleVar, setText, setValue } from './dom';
import { enhanceSelect } from './dropdown';
import { t, tn } from './i18n';
import { tf } from './i18n-fill';
import { icon } from './icons';
import { MAX_SUBTITLE_FILE_BYTES, addEmptyLine, addLines, clampSpan, clearSpan, formatSeconds, lineBlocks, listenLanguages, monoSamples, parseSeconds, removeLine, sameSound, sampleRange, styleFromControls, unheardReason, type StyleControls } from './speech-logic';
import { SpeechSetRow } from './speech-set-row';
import { loadSubtitleStyle, saveSubtitleStyle } from './subtitle-style-store';
import '../styles/subtitles.css';

interface Row { id: string; start: number; end: number; text: string }

const STORE = 'formmorpheus.subtitles';
const X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const SIZES: ReadonlyArray<readonly [SubtitleStyle['size'], string]> = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
const POSITIONS: ReadonlyArray<readonly [SubtitleStyle['position'], string]> = [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
const FONT_GROUPS: ReadonlyArray<readonly ['bundled' | 'library' | 'movie' | 'system', string]> = [['bundled', 'Built in'], ['library', 'Fonts library'], ['movie', 'In this movie'], ['system', 'On this computer']];
const NAME_CHARS = 80;
const MOVED = 'Another movie was opened, so no lines were added.';

const isAbort = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'AbortError';
const sentence = (e: unknown): string => (e instanceof Error && e.message ? e.message : t('Speech to text failed.'));
const hexOf = (rgb: { r: number; g: number; b: number }): string => `#${[rgb.r, rgb.g, rgb.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;

function loadLanguage(): string {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as { language?: unknown };
    return typeof raw.language === 'string' && /^[a-z]{2}$/.test(raw.language) ? raw.language : 'en';
  } catch { return 'en'; }
}

/** The movie made long enough to show its last line. */
function covered(m: Movie): Movie {
  const last = lineBlocks(m).reduce((n, c) => Math.max(n, end(c)), 0);
  return last > m.duration ? { ...m, duration: last } : m;
}

export class SubtitlesPanel {
  private readonly root: HTMLElement;
  private readonly shown: HTMLInputElement;
  private readonly font: HTMLSelectElement;
  private readonly size: HTMLSelectElement;
  private readonly position: HTMLSelectElement;
  private readonly color: HTMLButtonElement;
  private readonly hex: HTMLElement;
  private readonly band: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly add: HTMLButtonElement;
  private readonly source: HTMLElement;
  private readonly setRow: SpeechSetRow;
  private readonly heardOn: HTMLElement;
  private readonly lang: HTMLSelectElement;
  private readonly hear: HTMLButtonElement;
  private readonly hearStop: HTMLButtonElement;
  private readonly meter: HTMLElement;
  private readonly status: HTMLElement;
  private readonly file: HTMLInputElement;
  private readonly exportBtn: HTMLButtonElement;
  private colorPanel: ColourPanel | null = null;
  private style = loadSubtitleStyle();
  private language = loadLanguage();
  private fontKey = '';
  private open = false;
  private busy: AbortController | null = null;
  /** The id of the movie the run in hand was started in. */
  private runMovie = '';
  /** Speech to text needs the engine's speech model files, which an iPad's engine does not keep. */
  private readonly canHear = platform.features.speech;

  constructor(private readonly engine: Engine, private readonly audio: () => AudioEngine) {
    const mk = (label: string, ...controls: HTMLElement[]): HTMLElement => {
      const row = el<HTMLElement>('<div class="fm-st-row"><span class="fm-st-lab"></span></div>');
      setText(q(row, '.fm-st-lab'), t(label));
      row.append(...controls);
      return row;
    };
    const chk = (label: string): { row: HTMLElement; box: HTMLInputElement } => {
      const row = el<HTMLElement>('<label class="fm-st-chk"><input type="checkbox"><span></span></label>');
      setText(q(row, 'span'), t(label));
      return { row, box: q<HTMLInputElement>(row, 'input') };
    };
    const select = (label: string, options: ReadonlyArray<readonly [string, string]>, translate = true): HTMLSelectElement => {
      const s = el<HTMLSelectElement>('<select class="cv-input"></select>');
      s.setAttribute('aria-label', t(label));
      for (const [value, text] of options) s.appendChild(new Option(translate ? t(text) : text, value));
      return s;
    };
    const head = (label: string): HTMLElement => {
      const h = el<HTMLElement>('<div class="fm-st-sec"></div>');
      setText(h, t(label));
      return h;
    };
    const button = (label: string, cls = 'cv-btn'): HTMLButtonElement => {
      const b = el<HTMLButtonElement>(`<button class="${cls}" type="button"></button>`);
      setText(b, t(label));
      return b;
    };

    this.root = el<HTMLElement>(
      '<section class="fm-st" role="dialog" hidden>' +
      '<div class="fm-st-head"><span class="fm-st-title"></span><button class="fm-st-x" type="button"></button></div>' +
      '<div class="fm-st-body"></div></section>');
    this.root.setAttribute('aria-label', t('Subtitles'));
    setText(q(this.root, '.fm-st-title'), t('Subtitles'));
    const closeBtn = q<HTMLButtonElement>(this.root, '.fm-st-x');
    closeBtn.innerHTML = X;
    closeBtn.setAttribute('aria-label', t('Close'));
    closeBtn.addEventListener('click', () => this.close());

    const show = chk('Show subtitles in the video');
    this.shown = show.box;

    // Style
    this.font = select('Font', []);
    this.size = select('Size', SIZES);
    this.position = select('Position', POSITIONS);
    this.color = el<HTMLButtonElement>('<button class="fm-st-swatch" type="button"><i class="fm-st-chip"></i></button>');
    this.color.setAttribute('aria-label', t('Color'));
    this.hex = el<HTMLElement>('<span class="fm-st-hex"></span>');
    const band = chk('Dark band behind the words');
    this.band = band.box;

    // Lines
    this.list = el<HTMLElement>('<div class="fm-st-lines" role="list"></div>');
    this.list.setAttribute('aria-label', t('Subtitle lines'));
    this.empty = el<HTMLElement>('<p class="fm-st-note"></p>');
    setText(this.empty, t('No subtitle lines yet.'));
    this.add = button('Add a line at the playhead');

    // From sound
    this.source = el<HTMLElement>('<p class="fm-st-note fm-st-source" aria-live="polite"></p>');
    this.setRow = new SpeechSetRow('listen', {
      about: 'Speech to text runs on this computer. Its files are downloaded once and can be removed.',
      remove: 'Remove the speech to text files',
      confirmTitle: 'Remove the speech to text files',
      confirmText: 'Remove the speech to text files from this computer? They can be downloaded again.',
    }, () => this.patch());
    this.lang = select('Language', listenLanguages().map(([code, name]) => [code, `${name} (${code})`] as const), false);
    this.hear = button('Make subtitles from this sound');
    this.hearStop = button('Cancel');
    this.meter = el<HTMLElement>('<div class="fm-st-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" hidden><div class="fm-st-bar"></div></div>');
    this.meter.setAttribute('aria-label', t('Speech to text progress'));
    this.status = el<HTMLElement>('<div class="fm-st-status" aria-live="polite"></div>');
    const hearRow = el<HTMLElement>('<div class="fm-st-actions"></div>');
    hearRow.append(this.hear, this.hearStop);
    this.heardOn = el<HTMLElement>('<div class="fm-st-on" hidden></div>');
    this.heardOn.append(mk('Language', this.lang), hearRow, this.meter);

    // File
    const importBtn = button('Import subtitles file...');
    this.exportBtn = button('Export subtitles file...');
    this.file = el<HTMLInputElement>('<input class="fm-st-file" type="file" accept=".srt,text/plain,application/x-subrip" hidden>');
    const fileRow = el<HTMLElement>('<div class="fm-st-actions"></div>');
    fileRow.append(importBtn, this.exportBtn, this.file);

    q(this.root, '.fm-st-body').append(
      show.row,
      head('Style'), mk('Font', this.font), mk('Size', this.size), mk('Position', this.position), mk('Color', this.color, this.hex), band.row,
      head('Lines'), this.list, this.empty, this.add,
      // without speech to text the From sound part is never put on the card; the status line also serves File
      ...(this.canHear ? [head('From sound'), this.source, this.setRow.root, this.heardOn] : []), this.status, ...(this.canHear ? [this.setRow.remove] : []),
      head('File'), fileRow,
    );
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    for (const s of [this.font, this.size, this.position, this.lang]) enhanceSelect(s);

    this.shown.addEventListener('change', () => {
      const on = this.shown.checked;
      this.engine.run(on ? 'Show Subtitles' : 'Hide Subtitles', (m) => showSubtitles(m, on));
      this.sync();
    });
    this.font.addEventListener('change', () => { void this.pickFont(this.font.value); });
    this.size.addEventListener('change', () => this.restyle({ size: this.size.value }));
    this.position.addEventListener('change', () => this.restyle({ position: this.position.value }));
    this.band.addEventListener('change', () => this.restyle({ band: this.band.checked }));
    this.color.addEventListener('click', () => this.toggleColor());
    this.add.addEventListener('click', () => this.addLine());
    this.lang.addEventListener('change', () => {
      this.language = this.lang.value;
      try { localStorage.setItem(STORE, JSON.stringify({ language: this.language })); } catch { /* kept for this session only */ }
    });
    this.hear.addEventListener('click', () => { void this.fromSound(); });
    this.hearStop.addEventListener('click', () => this.busy?.abort());
    importBtn.addEventListener('click', () => { this.file.value = ''; this.file.click(); });
    this.file.addEventListener('change', () => { const f = this.file.files?.[0]; if (f) void this.importFile(f); });
    this.exportBtn.addEventListener('click', () => this.exportFile());
    window.addEventListener('keydown', (ev) => {
      if (!this.open || ev.key !== 'Escape' || !this.busy) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.busy.abort();
    }, true);
    this.engine.on('movie', () => { if (this.open) this.sync(); });
    this.engine.on('selection', () => { if (this.open) this.patch(); });
    this.engine.on('projects', () => {
      if (!this.engine.movie) this.close();
      // lines heard in one movie's sound never land in the next movie opened
      else if (this.busy && this.elsewhere()) this.busy.abort();
    });
    window.addEventListener('fm:fonts', () => { if (this.open) this.sync(); });
    this.lang.value = this.language;
  }

  show(): void {
    if (!this.engine.movie) return;
    this.open = true;
    setHidden(this.root, false);
    if (this.canHear) this.setRow.start();
    this.sync();
  }

  close(): void {
    this.busy?.abort();
    this.colorPanel?.close();
    this.open = false;
    this.setRow.halt();
    setHidden(this.root, true);
  }

  // ---- what the card shows ----

  /** The style of the lines the movie has, else the one last chosen here. */
  private current(): SubtitleStyle {
    const m = this.engine.movie;
    const read = m ? readSubtitles(m) : null;
    return read && read.lines.length ? read.style : this.style;
  }

  private sync(): void {
    const m = this.engine.movie;
    if (!m) return;
    const read = readSubtitles(m);
    const style = this.current();
    setChecked(this.shown, read.shown);
    setDisabled(this.shown, !subtitleTrack(m));
    this.syncFonts(m, style.font);
    setValue(this.size, style.size);
    setValue(this.position, style.position);
    setStyleVar(this.color, '--c', style.color);
    setText(this.hex, style.color.toUpperCase());
    setChecked(this.band, style.band);
    const rows: Row[] = lineBlocks(m).map((c) => ({ id: c.id, start: c.start / m.fps, end: end(c) / m.fps, text: c.text?.text ?? '' }));
    patchList(this.list, rows, {
      key: (r) => r.id,
      create: (r) => this.makeRow(r),
      update: (node, r) => this.fillRow(node, r),
    });
    setHidden(this.empty, rows.length > 0);
    setDisabled(this.exportBtn, !rows.some((r) => r.text.trim()));
    this.patch();
  }

  /** The font chooser's options, rebuilt only when the families on offer change. */
  private syncFonts(m: Movie, font: string): void {
    const cat = fontCatalog(m);
    const known = FONT_GROUPS.some(([g]) => cat[g].includes(font));
    const key = `${FONT_GROUPS.map(([g]) => cat[g].join('|')).join('||')}||${known ? '' : font}`;
    if (key !== this.fontKey) {
      this.fontKey = key;
      this.font.textContent = '';
      for (const [g, label] of FONT_GROUPS) {
        const fams = g === 'movie' && !known ? [...cat.movie, font] : cat[g];
        if (!fams.length) continue;
        const group = document.createElement('optgroup');
        group.label = t(label);
        for (const fam of fams) { group.appendChild(new Option(fam, fam)); previewFont(fam); }
        this.font.appendChild(group);
      }
    }
    setValue(this.font, font);
  }

  private patch(): void {
    const m = this.engine.movie;
    const working = !!this.busy;
    const block = this.soundBlock();
    setText(this.source, block ? tf('Selected sound: {name}', { name: block.name }) : t('Select a sound block on the Timeline first.'));
    setHidden(this.heardOn, !this.setRow.installed);
    setHidden(this.hear, working);
    setHidden(this.hearStop, !working);
    setHidden(this.meter, !working);
    setDisabled(this.hear, !m || !block);
    setDisabled(this.lang, working);
    setDisabled(this.setRow.remove, working);
  }

  private soundBlock(): Content | null {
    return this.engine.selected.find((c) => c.kind === 'audio' && !!c.asset) ?? null;
  }

  // ---- style ----

  private restyle(patch: Partial<StyleControls>, merge: string | null = null): void {
    const cur = this.current();
    const next = styleFromControls({ ...cur, ...patch }, cur);
    this.style = next;
    saveSubtitleStyle(next);
    this.engine.run('Subtitle Style', (m) => restyleSubtitles(m, next), merge);
    this.sync();
  }

  private async pickFont(family: string): Promise<void> {
    try {
      await ensureTextFont({ font: family, weight: 500, size: 40, text: 'Aa' });
      // a Fonts library font travels with the movie that uses it
      if (inLibrary(family)) await embedLibraryFamily(this.engine, family);
    } catch (e) {
      console.error('Subtitle font could not be loaded:', e);
    }
    this.restyle({ font: family });
  }

  private toggleColor(): void {
    if (!this.colorPanel) {
      // the shared Color disc, as on the Text card
      this.colorPanel = new ColourPanel({
        keepColours: true,
        onPick: (rgb, final) => {
          this.restyle({ color: hexOf(rgb) }, 'subtitle-color');
          if (final) { this.engine.endGesture(); this.colorPanel?.commit(rgb); }
        },
      });
      (document.getElementById('overlay-root') ?? document.body).appendChild(this.colorPanel.root);
    }
    if (this.colorPanel.isOpen()) { this.colorPanel.close(); return; }
    const n = parseInt(this.current().color.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0;
    this.colorPanel.set({ r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 });
    this.colorPanel.open(this.color);
  }

  // ---- lines ----

  private makeRow(r: Row): HTMLElement {
    const row = el<HTMLElement>(
      '<div class="fm-st-line" role="listitem"><input class="cv-input fm-st-time" data-f="start" type="text" inputmode="decimal" autocomplete="off">' +
      '<input class="cv-input fm-st-time" data-f="end" type="text" inputmode="decimal" autocomplete="off">' +
      `<input class="cv-input fm-st-text" data-f="text" type="text" autocomplete="off"><button class="fm-st-del" type="button">${icon('delete', 14)}</button></div>`);
    const start = q<HTMLInputElement>(row, '[data-f="start"]'), stop = q<HTMLInputElement>(row, '[data-f="end"]'), text = q<HTMLInputElement>(row, '[data-f="text"]');
    start.setAttribute('aria-label', t('Start, in seconds'));
    stop.setAttribute('aria-label', t('End, in seconds'));
    text.setAttribute('aria-label', t('Words'));
    const del = q<HTMLButtonElement>(row, '.fm-st-del');
    del.setAttribute('aria-label', t('Delete this line'));
    del.title = t('Delete this line');
    const id = r.id;
    const retime = (): void => this.retime(id, start, stop);
    start.addEventListener('change', retime);
    stop.addEventListener('change', retime);
    text.addEventListener('change', () => this.reword(id, text.value));
    del.addEventListener('click', () => { this.engine.run('Delete Subtitle', (m) => removeLine(m, id)); });
    this.fillRow(row, r);
    return row;
  }

  private fillRow(node: HTMLElement, r: Row): void {
    setValue(q<HTMLInputElement>(node, '[data-f="start"]'), formatSeconds(r.start));
    setValue(q<HTMLInputElement>(node, '[data-f="end"]'), formatSeconds(r.end));
    setValue(q<HTMLInputElement>(node, '[data-f="text"]'), r.text);
  }

  /** Typed times onto the block, kept between the lines before and after it. */
  private retime(id: string, start: HTMLInputElement, stop: HTMLInputElement): void {
    const m = this.engine.movie;
    if (!m) return;
    const blocks = lineBlocks(m);
    const i = blocks.findIndex((c) => c.id === id);
    if (i < 0) return;
    const c = blocks[i];
    const lo = i > 0 ? end(blocks[i - 1]) : 0;
    const hi = i < blocks.length - 1 ? blocks[i + 1].start : Number.POSITIVE_INFINITY;
    const span = clampSpan(parseSeconds(start.value) ?? c.start / m.fps, parseSeconds(stop.value) ?? end(c) / m.fps, m.fps, lo, hi);
    if (span.start !== c.start || span.duration !== c.duration) this.engine.run('Subtitle Time', (mv) => covered(ops.updateContent(mv, id, (x) => ({ ...x, start: span.start, duration: span.duration }))));
    this.refill(id);
  }

  private reword(id: string, value: string): void {
    const text = value.replace(/\s+/g, ' ').trim();
    this.engine.run('Subtitle Words', (m) => ops.updateContent(m, id, (c) => (c.text && c.text.text !== text ? { ...c, name: text.slice(0, NAME_CHARS), text: { ...c.text, text } } : c)));
    this.refill(id);
  }

  /**
   * A row's fields set from the movie after an edit, the field in hand included: they show what the movie kept,
   * which is not what was typed when a time was held between its neighbours or the edit was refused (a locked track).
   */
  private refill(id: string): void {
    const m = this.engine.movie;
    const c = m ? lineBlocks(m).find((x) => x.id === id) : undefined;
    const row = Array.from(this.list.children).find((n) => (n as HTMLElement).dataset.key === id);
    if (!m || !c || !row) return;
    const set = (name: string, value: string): void => { q<HTMLInputElement>(row, `[data-f="${name}"]`).value = value; };
    set('start', formatSeconds(c.start / m.fps));
    set('end', formatSeconds(end(c) / m.fps));
    set('text', c.text?.text ?? '');
  }

  private addLine(): void {
    let made: string | null = null;
    const style = this.current();
    // where a line already shows at the playhead nothing is added, and `made` is that line
    this.engine.run('Add Subtitle', (m) => {
      const r = addEmptyLine(m, this.engine.frame / m.fps, style);
      made = r.id;
      return r.added ? covered(r.movie) : m;
    });
    if (!made) return;
    const row = Array.from(this.list.children).find((n) => (n as HTMLElement).dataset.key === made);
    const field = row?.querySelector<HTMLInputElement>('[data-f="text"]');
    row?.scrollIntoView({ block: 'nearest' });
    field?.focus();
  }

  // ---- from sound ----

  private async fromSound(): Promise<void> {
    const m = this.engine.movie;
    const block = this.soundBlock();
    if (!m || !block || !block.asset || this.busy) return;
    const unheard = unheardReason(block);
    if (unheard === 'backward') { this.say(t('This sound block plays backward, so its words cannot be heard.'), true); return; }
    if (unheard === 'frozen') { this.say(t('This sound block is frozen, so it plays no words to hear.'), true); return; }
    const ctl = new AbortController();
    this.busy = ctl;
    this.runMovie = m.id;
    this.progress(0);
    this.say(t('Reading the sound...'));
    this.patch();
    try {
      const buf = await this.audio().decode(block.asset);
      if (!buf) throw new Error(t('This sound could not be decoded.'));
      const speed = block.speed && block.speed > 0 ? block.speed : 1;
      const range = sampleRange(block.offset, block.duration, m.fps, buf.sampleRate, buf.length, speed);
      const channels = Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch));
      const samples = monoSamples(channels, range.from, range.to);
      if (!samples.length) throw new Error(t('This sound block plays no sound.'));
      const words = await listen(samples, buf.sampleRate, {
        language: this.language, signal: ctl.signal,
        onProgress: (f) => { this.progress(f); this.say(f === null ? t('Listening...') : tf('Listening: {percent}%', { percent: Math.round(f * 100) })); },
      });
      // a retimed block plays its sound faster or slower, so the heard times are brought to movie time
      const timed = speed === 1 ? words : words.map((w) => ({ ...w, start: w.start / speed, end: w.end / speed }));
      const lines = linesFromWords(timed, block.start / m.fps);
      if (this.elsewhere()) { this.say(t(MOVED)); return; }
      if (!lines.length) { this.say(t('No words were heard in this sound.')); return; }
      const style = this.current();
      const from = block.start, to = end(block);
      let replaced = 0;
      let stale = false;
      const ok = this.engine.run('Subtitles from Sound', (mv) => {
        // the listening took a while: the block is looked up again, and lines timed for a block since moved are not written
        const now = findContent(mv, block.id);
        stale = !now || !sameSound(block, now);
        if (stale) return mv;
        const cleared = clearSpan(mv, from, to);
        replaced = cleared.removed;
        return covered(addLines(cleared.movie, lines, style));
      });
      const added = tn(lines.length, '{n} line added.', '{n} lines added.');
      if (stale) this.say(t('The sound block was changed or removed while it was heard, so no lines were added.'), true);
      else this.say(!ok ? t('The lines could not be added to the movie.') : replaced ? `${added} ${t('They replace the lines that were under this sound.')}` : added, !ok);
    } catch (e) {
      if (this.elsewhere()) this.say(t(MOVED));
      else if (isAbort(e)) this.say(t('Cancelled.'));
      else { console.error('Subtitles from sound failed:', e); this.say(sentence(e), true); }
    } finally {
      this.busy = null;
      this.patch();
    }
  }

  /** True when the movie open now is not the one the run in hand was started in. */
  private elsewhere(): boolean {
    const m = this.engine.movie;
    return !!m && m.id !== this.runMovie;
  }

  private say(text: string, bad = false): void {
    setClass(this.status, 'is-bad', bad);
    setText(this.status, text);
  }

  /** Null: at work with no figure to show, so the bar sweeps and reads no value. */
  private progress(fraction: number | null): void {
    setClass(this.meter, 'is-unknown', fraction === null);
    if (fraction === null) { this.meter.removeAttribute('aria-valuenow'); return; }
    const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    setStyleVar(this.meter, '--pct', `${pct}%`);
    this.meter.setAttribute('aria-valuenow', String(pct));
  }

  // ---- files ----

  private async importFile(file: File): Promise<void> {
    const m = this.engine.movie;
    if (!m) return;
    // judged by its size alone, before a byte is read
    if (file.size > MAX_SUBTITLE_FILE_BYTES) { this.say(t('That file is larger than 5 MB, so it was not read as a subtitles file.'), true); return; }
    let lines: ReturnType<typeof fromSrt>;
    try { lines = fromSrt(await file.text()); } catch (e) {
      console.error('Subtitles file could not be read:', e);
      this.say(t('That file could not be read.'), true);
      return;
    }
    if (!lines.length) { this.say(t('No subtitle lines were found in that file.'), true); return; }
    const had = readSubtitles(m).lines.length;
    if (had && !(await confirmAction(t('Replace subtitles'), tf('Replace the {had} lines in this movie with the {n} lines in the file?', { had, n: lines.length }), t('Replace'), true))) return;
    const style = this.current();
    const ok = this.engine.run('Import Subtitles', (mv) => covered(writeSubtitles(mv, lines, style)));
    this.say(ok ? tn(lines.length, '{n} line imported.', '{n} lines imported.') :t('The lines could not be added to the movie.'), !ok);
  }

  private exportFile(): void {
    const m = this.engine.movie;
    if (!m) return;
    const text = toSrt(readSubtitles(m).lines);
    if (!text) return;
    const name = (m.name || 'Subtitles').replace(/[\\/:*?"<>|]/g, '_');
    downloadBlob(new Blob([text], { type: 'application/x-subrip' }), `${name}.srt`);
  }
}
