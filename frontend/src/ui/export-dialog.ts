import type { Engine } from '../engine/engine';
import type { Renderer } from '../engine/render';
import type { AudioEngine } from '../media/audio';
import { startExport } from '../export/run';
import { jobCapabilities, startEngineExport, type EngineTarget, type JobCapabilities } from '../export/engine-jobs';
import type { ExportFormat, ExportJob, ExportOptions, ExportProgress } from '../export/types';
import { parseTime, timecode } from '../engine/time';
import { downloadBlob } from '../io/api';
import { Dialog } from './dialogs';
import { el, q, setClass, setDisabled, setHidden, setStyleVar, setText } from './dom';
import { toast } from './toast';

const KEY = 'formmorpheus.export';

export interface ExportDeps {
  engine: Engine;
  renderer: Renderer;
  audio: () => AudioEngine | null;
  saveOutput: (blob: Blob, name: string) => Promise<void>;
  /** The Movie file tile: save the .fmo (with its undo history or without). */
  exportFmo?: (withHistory: boolean) => void;
}

type Tab = 'share' | 'advanced';
type Preset = 'movie' | '720' | '1080' | '2160' | 'square' | 'custom';
type Quality = ExportOptions['quality'];
type Gif = ExportOptions['gif'];

interface Saved {
  format: ExportFormat; preset: Preset; customW: number; customH: number; pingpong: boolean; audio: boolean; alpha: boolean;
  quality: Quality; colors: number; dither: Gif['dither']; loop: boolean; timing: Gif['timing']; alphaThreshold: number; palette: string; tab: Tab;
}

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'mp4', label: 'MP4 video' }, { id: 'webm', label: 'WebM video' }, { id: 'mov', label: 'MOV video' }, { id: 'gif', label: 'Animated GIF' },
  { id: 'png-frames', label: 'PNG frames' }, { id: 'jpg-frames', label: 'JPG frames' }, { id: 'webp-frames', label: 'WebP frames' }, { id: 'png-still', label: 'PNG still' },
  { id: 'prores-mov', label: 'ProRes 422 HQ (engine)' }, { id: 'prores4444-mov', label: 'ProRes 4444 w/ alpha (engine)' }, { id: 'hevc-mp4', label: 'HEVC (engine)' },
];
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'movie', label: 'Movie size' }, { id: '720', label: '720p' }, { id: '1080', label: '1080p' }, { id: '2160', label: '4K' }, { id: 'square', label: 'Square 1080' }, { id: 'custom', label: 'Custom' },
];
const QUALITIES: { id: Quality; label: string }[] = [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'very-high', label: 'Very high' }];
/** Formats the engine's ffmpeg encodes (the browser cannot). */
const ENGINE: Partial<Record<ExportFormat, EngineTarget>> = { 'prores-mov': 'prores', 'prores4444-mov': 'prores4444', 'hevc-mp4': 'hevc' };
const VIDEO: ExportFormat[] = ['mp4', 'webm', 'mov', 'prores-mov', 'prores4444-mov', 'hevc-mp4'];
const ALPHA: ExportFormat[] = ['webm', 'png-frames', 'webp-frames', 'png-still', 'gif', 'prores4444-mov'];
const LOSSY: ExportFormat[] = ['mp4', 'webm', 'mov', 'jpg-frames', 'webp-frames', 'hevc-mp4'];
const STAGES: Record<ExportProgress['stage'], string> = { frames: 'Drawing frames', audio: 'Mixing sound', encoding: 'Encoding', finishing: 'Finishing' };

const DEFAULTS: Saved = {
  format: 'mp4', preset: 'movie', customW: 1920, customH: 1080, pingpong: false, audio: true, alpha: false,
  quality: 'high', colors: 256, dither: 'floyd-steinberg', loop: true, timing: 'exact', alphaThreshold: 128, palette: '', tab: 'share',
};

const pick = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);

function load(): Saved {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Saved, unknown>>;
    return {
      format: pick(r.format, FORMATS.map((f) => f.id), DEFAULTS.format), preset: pick(r.preset, PRESETS.map((p) => p.id), DEFAULTS.preset),
      customW: num(r.customW, 2, 16384, DEFAULTS.customW), customH: num(r.customH, 2, 16384, DEFAULTS.customH),
      pingpong: r.pingpong === true, audio: r.audio !== false, alpha: r.alpha === true,
      quality: pick(r.quality, QUALITIES.map((x) => x.id), DEFAULTS.quality), colors: num(r.colors, 2, 256, 256),
      dither: pick(r.dither, ['none', 'floyd-steinberg', 'ordered'] as const, DEFAULTS.dither), loop: r.loop !== false, timing: pick(r.timing, ['exact', 'even'] as const, 'exact'),
      alphaThreshold: num(r.alphaThreshold, 0, 255, 128), palette: typeof r.palette === 'string' ? r.palette.slice(0, 2000) : '', tab: pick(r.tab, ['share', 'advanced'] as const, 'share'),
    };
  } catch { return { ...DEFAULTS }; }
}

function save(s: Saved): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { return; }
}

const svg = (body: string): string => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const TILE_ICONS = {
  mp4: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>'),
  gif: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M8 10.5c-1.8 0-2.5 1-2.5 1.8s.7 1.8 2.5 1.8c.9 0 1.5-.4 1.5-1.2H8M12 10v4M15 14v-4h3M15 12h2"/>'),
  frames: svg('<rect x="6" y="3.5" width="14" height="11" rx="1.5"/><path d="M3.5 7v11a2 2 0 0 0 2 2H17"/>'),
  still: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4"/>'),
  fmo: svg('<path d="M12 3.5l8 4.2v8.6l-8 4.2-8-4.2V7.7z"/><path d="M4.5 8l7.5 4 7.5-4M12 12v8"/>'),
};

interface Tile { id: string; label: string; sub: string; icon: string }
const TILES: Tile[] = [
  { id: 'mp4', label: 'MP4 video', sub: 'Plays everywhere', icon: TILE_ICONS.mp4 },
  { id: 'gif', label: 'Animated GIF', sub: 'Small, loops forever', icon: TILE_ICONS.gif },
  { id: 'png-frames', label: 'PNG frames', sub: 'One picture per frame', icon: TILE_ICONS.frames },
  { id: 'still', label: 'Current frame', sub: 'A single PNG still', icon: TILE_ICONS.still },
  { id: 'fmo', label: 'Movie file', sub: 'Keep editing later (.fmo)', icon: TILE_ICONS.fmo },
];

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

export class ExportDialog {
  private readonly dlg = new Dialog('Export', 640);
  private readonly state: Saved = load();
  private readonly rows = new Map<string, HTMLElement>();
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly shareBox = el<HTMLElement>('<div class="fm-ex-tiles"></div>');
  private readonly advBox = el<HTMLElement>('<div class="fm-ex-adv"></div>');
  private readonly runBox = el<HTMLElement>(
    '<div class="fm-ex-run" hidden><div class="fm-ex-run-head"><span class="fm-ex-run-title"></span><span class="fm-ex-run-count"></span></div><div class="cv-run-bar"><i></i></div></div>');
  private readonly notes = el<HTMLElement>('<div class="fm-ex-notes" hidden></div>');
  private readonly format = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Format">${FORMATS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('')}</select>`);
  private readonly preset = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Resolution">${PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}</select>`);
  private readonly width = el<HTMLInputElement>('<input class="cv-input" type="number" min="2" max="16384" step="1" aria-label="Width">');
  private readonly height = el<HTMLInputElement>('<input class="cv-input" type="number" min="2" max="16384" step="1" aria-label="Height">');
  private readonly size = el<HTMLElement>('<span class="cv-note fm-ex-size"></span>');
  private readonly rangeSel = el<HTMLSelectElement>('<select class="cv-input" aria-label="Range"><option value="whole">Whole movie</option><option value="custom">In and out</option></select>');
  private readonly inField = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" aria-label="In" placeholder="00:00:00">');
  private readonly outField = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" aria-label="Out" placeholder="00:00:00">');
  private readonly rangeNote = el<HTMLElement>('<span class="cv-note"></span>');
  private readonly mode = el<HTMLSelectElement>('<select class="cv-input" aria-label="Play"><option value="once">One shot</option><option value="pingpong">Ping pong</option></select>');
  private readonly audio = el<HTMLInputElement>('<input type="checkbox" aria-label="Include sound">');
  private readonly alpha = el<HTMLInputElement>('<input type="checkbox" aria-label="Transparent background">');
  private readonly quality = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Quality">${QUALITIES.map((x) => `<option value="${x.id}">${x.label}</option>`).join('')}</select>`);
  private readonly colors = el<HTMLInputElement>('<input type="number" class="cv-input" min="2" max="256" step="1" aria-label="Colors">');
  private readonly dither = el<HTMLSelectElement>('<select class="cv-input" aria-label="Dither"><option value="none">None</option><option value="floyd-steinberg">Floyd-Steinberg</option><option value="ordered">Ordered</option></select>');
  private readonly loop = el<HTMLInputElement>('<input type="checkbox" aria-label="Loop forever">');
  private readonly timing = el<HTMLSelectElement>('<select class="cv-input" aria-label="Timing"><option value="exact">Exact frame times</option><option value="even">Even steps</option></select>');
  private readonly threshold = el<HTMLInputElement>('<input type="range" min="0" max="255" step="1" aria-label="Alpha threshold">');
  private readonly thresholdValue = el<HTMLElement>('<span class="fm-ex-val"></span>');
  private readonly palette = el<HTMLInputElement>('<input type="text" class="cv-input" spellcheck="false" placeholder="Automatic, or #000000 #ffffff #ff6a00" aria-label="Palette colors">');
  private readonly run: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private job: ExportJob | null = null;

  /** True while an export renders: the movie it reads must not be closed or replaced meanwhile. */
  get running(): boolean {
    return this.job !== null;
  }
  private engineJob: ReturnType<Engine['startJob']> | null = null;
  private busy = false;
  private aspect = 16 / 9;

  constructor(private readonly deps: ExportDeps) {
    const { body } = this.dlg;
    const seg = el<HTMLElement>('<div class="fm-ex-seg" role="tablist"></div>');
    (['share', 'advanced'] as const).forEach((id) => {
      const b = el<HTMLButtonElement>('<button class="fm-ex-segbtn" type="button" role="tab"></button>');
      setText(b, id === 'share' ? 'Quick share' : 'Advanced');
      b.addEventListener('click', () => this.setTab(id));
      this.tabs.push(b);
      seg.appendChild(b);
    });
    for (const t of TILES) {
      const b = el<HTMLButtonElement>('<button class="fm-ex-tile" type="button"><span class="fm-ex-tile-ico"></span><span class="fm-ex-tile-label"></span><span class="fm-ex-tile-sub"></span></button>');
      q(b, '.fm-ex-tile-ico').innerHTML = t.icon;
      setText(q(b, '.fm-ex-tile-label'), t.label);
      setText(q(b, '.fm-ex-tile-sub'), t.sub);
      b.dataset.tile = t.id;
      b.addEventListener('click', () => this.quick(t.id));
      this.shareBox.appendChild(b);
    }
    this.buildAdvanced();
    body.append(seg, this.shareBox, this.advBox, this.runBox, this.notes);
    this.cancel = this.dlg.button('Close', 'ghost', () => this.onCancel());
    this.run = this.dlg.button('Export', 'primary', () => {
      if (this.rangeBad()) { this.note([this.range().error], 'error'); return; }
      this.start(this.fromForm());
    });
    this.dlg.onClose = () => save(this.state);
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'checkbox' && this.state.tab === 'advanced') { e.preventDefault(); this.run.click(); } });
  }

  open(tab?: Tab): void {
    if (!this.deps.engine.movie) { toast('Open or create a movie first.'); return; }
    if (!this.busy) this.hydrate();
    this.setTab(tab ?? this.state.tab);
    void this.refreshEngine();
    this.dlg.open(this.state.tab === 'share' ? this.shareBox.querySelector<HTMLElement>('button') : this.format);
  }

  close(): void { this.dlg.close(); }

  /** Enables or disables the three engine formats from what the engine's ffmpeg can encode (patched in place). */
  private async refreshEngine(): Promise<void> {
    const caps: JobCapabilities | null = await jobCapabilities();
    for (const opt of Array.from(this.format.options)) {
      const target = ENGINE[opt.value as ExportFormat];
      if (!target) continue;
      const base = FORMATS.find((f) => f.id === opt.value)?.label ?? opt.value;
      const info = caps?.targets[target];
      const ok = info?.available === true;
      const reason = ok ? '' : caps ? info?.reason ?? 'Not available' : 'The engine is not running';
      opt.disabled = !ok;
      opt.title = reason;
      const text = ok ? base : `${base} (${reason.replace(/\.$/, '')})`;
      if (opt.textContent !== text) opt.textContent = text;
    }
    const sel = this.state.format;
    const target = ENGINE[sel];
    if (target && caps?.targets[target]?.available !== true) {
      this.state.format = 'mp4';
      this.format.value = 'mp4';
    }
    this.sync();
  }

  // Advanced form ------------------------------------------------------------------------------

  private row(id: string, label: string, ...controls: HTMLElement[]): HTMLElement {
    const r = el<HTMLElement>('<div class="cv-field fm-ex-row"><span></span><div class="fm-ex-ctl"></div></div>');
    setText(q(r, 'span'), label);
    q(r, '.fm-ex-ctl').append(...controls);
    this.rows.set(id, r);
    return r;
  }

  private check(input: HTMLInputElement, text: string): HTMLElement {
    const l = el<HTMLElement>('<label class="fm-ex-check"><span></span></label>');
    l.prepend(input);
    setText(q(l, 'span'), text);
    return l;
  }

  private buildAdvanced(): void {
    const dims = el<HTMLElement>('<div class="fm-ex-dims"></div>');
    dims.append(this.width, el<HTMLElement>('<span class="fm-ex-x">x</span>'), this.height);
    const range = el<HTMLElement>('<div class="fm-ex-range"></div>');
    range.append(this.inField, el<HTMLElement>('<span class="fm-ex-x">to</span>'), this.outField);
    const thr = el<HTMLElement>('<div class="fm-ex-slide"></div>');
    thr.append(this.threshold, this.thresholdValue);
    const gifHead = el<HTMLElement>('<div class="fm-ex-sect" data-row="gifhead">GIF</div>');
    this.rows.set('gifhead', gifHead);
    const A = this.advBox;
    A.append(
      this.row('format', 'Format', this.format),
      this.row('preset', 'Resolution', this.preset),
      this.row('dims', 'Size', dims, this.size),
      this.row('range', 'Range', this.rangeSel),
      this.row('inout', 'In and out', range, this.rangeNote),
      this.row('mode', 'Play', this.mode),
      this.row('audio', 'Sound', this.check(this.audio, 'Include sound')),
      this.row('alpha', 'Background', this.check(this.alpha, 'Transparent background')),
      this.row('quality', 'Quality', this.quality),
      gifHead,
      this.row('colors', 'Colors', this.colors),
      this.row('dither', 'Dither', this.dither),
      this.row('palette', 'Palette', this.palette),
      this.row('threshold', 'Alpha threshold', thr),
      this.row('timing', 'Timing', this.timing),
      this.row('loop', 'Loop', this.check(this.loop, 'Loop forever')),
    );
    const change = (): void => { this.readForm(); this.sync(); };
    for (const c of [this.format, this.preset, this.rangeSel, this.mode, this.audio, this.alpha, this.quality, this.colors, this.dither, this.loop, this.timing, this.threshold, this.palette, this.inField, this.outField]) {
      c.addEventListener('input', change);
      c.addEventListener('change', change);
    }
    this.width.addEventListener('input', () => this.dim('w'));
    this.height.addEventListener('input', () => this.dim('h'));
  }

  /** Custom width and height stay locked to the movie's aspect. */
  private dim(from: 'w' | 'h'): void {
    this.state.preset = 'custom';
    setClass(this.preset, 'is-custom', true);
    this.preset.value = 'custom';
    const w = this.width.valueAsNumber, h = this.height.valueAsNumber;
    if (from === 'w' && w > 0) { this.state.customW = Math.round(w); this.state.customH = Math.max(2, Math.round(w / this.aspect)); }
    else if (from === 'h' && h > 0) { this.state.customH = Math.round(h); this.state.customW = Math.max(2, Math.round(h * this.aspect)); }
    if (from === 'w' && this.height !== document.activeElement) this.height.value = String(this.state.customH);
    if (from === 'h' && this.width !== document.activeElement) this.width.value = String(this.state.customW);
    this.sync();
  }

  private hydrate(): void {
    const m = this.deps.engine.movie;
    if (!m) return;
    const s = this.state;
    this.aspect = m.width / m.height;
    this.format.value = s.format;
    this.preset.value = s.preset;
    this.rangeSel.value = 'whole';
    this.inField.value = timecode(0, m.fps);
    this.outField.value = timecode(Math.max(0, m.duration - 1), m.fps);
    this.mode.value = s.pingpong ? 'pingpong' : 'once';
    this.audio.checked = s.audio;
    this.alpha.checked = s.alpha;
    this.quality.value = s.quality;
    this.colors.value = String(s.colors);
    this.dither.value = s.dither;
    this.loop.checked = s.loop;
    this.timing.value = s.timing;
    this.threshold.value = String(s.alphaThreshold);
    this.palette.value = s.palette;
    this.width.value = String(s.customW);
    this.height.value = String(s.customH);
    if (s.preset === 'custom') this.dimsFromAspect();
    this.sync();
  }

  private dimsFromAspect(): void {
    this.state.customH = Math.max(2, Math.round(this.state.customW / this.aspect));
    this.height.value = String(this.state.customH);
  }

  private readForm(): void {
    const s = this.state;
    s.format = this.format.value as ExportFormat;
    s.preset = this.preset.value as Preset;
    s.pingpong = this.mode.value === 'pingpong';
    s.audio = this.audio.checked;
    s.alpha = this.alpha.checked;
    s.quality = this.quality.value as Quality;
    s.colors = num(this.colors.valueAsNumber, 2, 256, s.colors);
    s.dither = this.dither.value as Gif['dither'];
    s.loop = this.loop.checked;
    s.timing = this.timing.value as Gif['timing'];
    s.alphaThreshold = num(this.threshold.valueAsNumber, 0, 255, s.alphaThreshold);
    s.palette = this.palette.value;
    if (s.preset === 'custom' && document.activeElement !== this.width && document.activeElement !== this.height) { this.width.value = String(s.customW); this.dimsFromAspect(); }
  }

  /** The size the chosen preset gives for this movie (video sizes are made even). */
  private outSize(): [number, number] {
    const m = this.deps.engine.movie;
    if (!m) return [2, 2];
    const s = this.state;
    const video = VIDEO.includes(s.format);
    const fix = (w: number, h: number): [number, number] => (video ? [even(w), even(h)] : [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))]);
    if (s.preset === 'movie') return fix(m.width, m.height);
    if (s.preset === 'square') return fix(1080, 1080);
    if (s.preset === 'custom') return fix(s.customW, s.customH);
    const short = Number(s.preset) || 1080, k = short / Math.min(m.width, m.height);
    return fix(m.width * k, m.height * k);
  }

  private range(): { from: number; to: number; error: string } {
    const m = this.deps.engine.movie;
    if (!m) return { from: 0, to: 1, error: '' };
    if (this.state.format === 'png-still') { const f = Math.min(Math.max(0, this.deps.engine.frame), Math.max(0, m.duration - 1)); return { from: f, to: f + 1, error: '' }; }
    if (this.rangeSel.value === 'whole') return { from: 0, to: Math.max(1, m.duration), error: '' };
    const a = parseTime(this.inField.value, m.fps), b = parseTime(this.outField.value, m.fps);
    if (a === null || b === null) return { from: 0, to: Math.max(1, m.duration), error: 'Type the in and out as timecodes, for example 00:02:00 or 48.' };
    const from = Math.min(Math.max(0, a), m.duration - 1), last = Math.min(Math.max(from, b), m.duration - 1);
    return { from, to: last + 1, error: last < b || from > a ? 'The range was kept inside the movie.' : '' };
  }

  private rangeBad(): boolean { return /timecodes/.test(this.range().error); }

  /** Shows only the rows that apply to the chosen format, and the sums under them. */
  private sync(): void {
    const m = this.deps.engine.movie;
    if (!m) return;
    const f = this.state.format, show = (id: string, on: boolean): void => { const r = this.rows.get(id); if (r) setHidden(r, !on); };
    const still = f === 'png-still', gif = f === 'gif';
    show('range', !still);
    show('inout', !still && this.rangeSel.value === 'custom');
    show('mode', !still);
    show('audio', VIDEO.includes(f));
    show('alpha', m.transparent && ALPHA.includes(f));
    show('quality', LOSSY.includes(f));
    for (const id of ['gifhead', 'colors', 'dither', 'palette', 'threshold', 'timing', 'loop']) show(id, gif);
    show('threshold', gif && m.transparent && this.alpha.checked);
    setHidden(q(this.rows.get('dims') as HTMLElement, '.fm-ex-dims'), this.state.preset !== 'custom');
    const [w, h] = this.outSize();
    if (this.state.preset !== 'custom') { setText(this.size, `${w} x ${h}`); setHidden(this.size, false); } else setHidden(this.size, true);
    setText(this.thresholdValue, String(this.state.alphaThreshold));
    const r = this.range();
    const n = r.to - r.from, steps = this.state.pingpong && n >= 3 ? n + n - 2 : n;
    setText(this.rangeNote, r.error || `${steps} ${steps === 1 ? 'frame' : 'frames'} · ${(steps / m.fps).toFixed(steps / m.fps < 10 ? 2 : 1)} s`);
    setClass(this.rangeNote, 'is-bad', this.rangeBad());
    setDisabled(this.run, this.busy);
  }

  private fromForm(): ExportOptions {
    this.readForm();
    const m = this.deps.engine.movie as NonNullable<Engine['movie']>;
    const s = this.state, r = this.range(), [width, height] = this.outSize();
    const pal = s.palette.match(/#[0-9a-fA-F]{6}\b/g);
    return {
      format: s.format, width, height, from: r.from, to: r.to,
      pingpong: s.pingpong && s.format !== 'png-still', includeAudio: s.audio && VIDEO.includes(s.format),
      alpha: s.alpha && m.transparent && ALPHA.includes(s.format), quality: s.quality,
      gif: { colors: s.colors, dither: s.dither, palette: pal && pal.length ? pal : null, alphaThreshold: s.alphaThreshold, loop: s.loop, timing: s.timing },
    };
  }

  // Quick share ---------------------------------------------------------------------------------

  private quick(id: string): void {
    const m = this.deps.engine.movie;
    if (!m || this.busy) return;
    if (id === 'fmo') { this.deps.exportFmo?.(false); if (!this.deps.exportFmo) toast('Saving the movie file is not available here.'); this.close(); return; }
    const base = this.fromFormDefaults();
    if (id === 'mp4') this.start({ ...base, format: 'mp4', includeAudio: true, quality: 'high' });
    else if (id === 'gif') {
      const k = Math.min(1, 640 / Math.max(m.width, m.height));
      this.start({ ...base, format: 'gif', width: Math.max(1, Math.round(m.width * k)), height: Math.max(1, Math.round(m.height * k)), alpha: m.transparent });
    } else if (id === 'png-frames') this.start({ ...base, format: 'png-frames', alpha: m.transparent });
    else { const f = Math.min(Math.max(0, this.deps.engine.frame), Math.max(0, m.duration - 1)); this.start({ ...base, format: 'png-still', from: f, to: f + 1, alpha: m.transparent }); }
  }

  private fromFormDefaults(): ExportOptions {
    const m = this.deps.engine.movie as NonNullable<Engine['movie']>;
    return {
      format: 'mp4', width: even(m.width), height: even(m.height), from: 0, to: Math.max(1, m.duration), pingpong: false, includeAudio: false, alpha: false, quality: 'high',
      gif: { colors: 256, dither: 'floyd-steinberg', palette: null, alphaThreshold: 128, loop: true, timing: 'exact' },
    };
  }

  // Running -------------------------------------------------------------------------------------

  private start(opts: ExportOptions): void {
    const movie = this.deps.engine.movie;
    if (!movie || this.busy) return;
    save(this.state);
    this.busy = true;
    this.note([]);
    this.paintBusy(true, `Starting`, 0);
    const label = `Export ${FORMATS.find((f) => f.id === opts.format)?.label ?? opts.format}`;
    const ej = this.deps.engine.startJob(label, 1);
    this.engineJob = ej;
    const off = this.deps.engine.on('progress', () => { if (ej.cancelled) job.cancel(); });
    const target = ENGINE[opts.format];
    const deps = { movie, renderer: this.deps.renderer, audio: this.deps.audio() };
    const job = target ? startEngineExport(deps, { ...opts, target }) : startExport(deps, opts);
    this.job = job;
    job.onProgress((p) => {
      ej.total = Math.max(1, p.total);
      this.deps.engine.stepJob(ej, p.done);
      this.paintBusy(true, STAGES[p.stage], p.total > 0 ? p.done / p.total : 0, `${p.done} / ${p.total}`);
    });
    void job.result.then(async (res) => {
      downloadBlob(res.blob, res.name);
      let kept = true;
      if (!res.kept) { try { await this.deps.saveOutput(res.blob, res.name); } catch { kept = false; } }
      const lines = [...res.warnings];
      if (!kept) lines.push('The file was downloaded, but it could not be kept in Exports.');
      this.finish(off, ej);
      if (this.dlg.isOpen) this.note([`Saved ${res.name}`, ...lines], lines.length ? 'warn' : 'ok');
      else toast(lines.length ? `Exported ${res.name}. ${lines.join(' ')}` : `Exported ${res.name}.`, kept ? 'info' : 'error');
    }, (e: unknown) => {
      this.finish(off, ej);
      if (e instanceof DOMException && e.name === 'AbortError') { this.note(['Export cancelled.'], 'warn'); return; }
      const text = e instanceof Error && e.message ? e.message : 'The export failed.';
      if (this.dlg.isOpen) this.note([text], 'error'); else toast(text, 'error');
    });
  }

  private finish(off: () => void, ej: NonNullable<ExportDialog['engineJob']>): void {
    off();
    this.deps.engine.endJob(ej);
    this.engineJob = null;
    this.job = null;
    this.busy = false;
    this.paintBusy(false, '', 0);
    // the Export button was disabled while running and focus fell to the page: bring it back so Escape closes
    q<HTMLElement>(this.dlg.scrim, '.cv-dialog').focus();
  }

  private onCancel(): void {
    if (this.busy && this.job) { this.job.cancel(); return; }
    this.close();
  }

  private paintBusy(on: boolean, stage: string, frac: number, count = ''): void {
    setHidden(this.runBox, !on);
    setDisabled(this.run, on);
    setText(this.cancel, on ? 'Cancel export' : 'Close');
    this.cancel.dataset.en = on ? 'Cancel export' : 'Close';
    this.cancel.dataset.shown = this.cancel.textContent ?? '';
    for (const b of this.shareBox.querySelectorAll<HTMLButtonElement>('button')) setDisabled(b, on);
    setClass(this.advBox, 'is-busy', on);
    setClass(this.shareBox, 'is-busy', on);
    if (!on) return;
    setText(q(this.runBox, '.fm-ex-run-title'), stage);
    setText(q(this.runBox, '.fm-ex-run-count'), count);
    setStyleVar(q(this.runBox, '.cv-run-bar > i'), 'transform', `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(4)})`);
    q<HTMLElement>(this.runBox, '.cv-run-bar > i').style.width = '100%';
  }

  private note(lines: string[], kind: 'ok' | 'warn' | 'error' = 'ok'): void {
    setHidden(this.notes, lines.length === 0);
    for (const k of ['ok', 'warn', 'error']) setClass(this.notes, `is-${k}`, k === kind);
    if (this.notes.dataset.text === lines.join('\n')) return;
    this.notes.dataset.text = lines.join('\n');
    this.notes.replaceChildren(...lines.map((l) => { const p = document.createElement('p'); p.textContent = l; return p; }));
  }

  private setTab(tab: Tab): void {
    this.state.tab = tab;
    this.tabs.forEach((b, i) => { const on = (i === 0) === (tab === 'share'); setClass(b, 'is-active', on); b.setAttribute('aria-selected', String(on)); });
    setHidden(this.shareBox, tab !== 'share');
    setHidden(this.advBox, tab !== 'advanced');
    setHidden(this.run, tab !== 'advanced');
    if (tab === 'advanced') this.sync();
  }
}
