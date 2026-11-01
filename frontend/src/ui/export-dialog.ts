import type { Engine } from '../engine/engine';
import type { Renderer } from '../engine/render';
import type { AudioEngine } from '../media/audio';
import { browserHasAac } from '../export/run';
import { startExportAuto as startExport } from '../export/worker-host';
import { startExportRouted } from '../export/route';
import { AUDIO_BPS, movieFrameAt, outFps, stepsFor } from '../export/delivery';
import { jobCapabilities, startEngineExport, type EngineTarget, type JobCapabilities } from '../export/engine-jobs';
import { pictureHasAlpha } from '../export/still-formats';
import type { AudioKind, ExportFormat, ExportJob, ExportOptions, ExportProgress, PictureExt, ProresProfile } from '../export/types';
import { ExportPreview, type PreviewSpec } from './export-preview';
import { parseTime, timecode } from '../engine/time';
import { downloadBlob } from '../io/api';
import { canPickFolder, pickDestination, saveFileTo, saveFramesTo, type Dest } from './export-where';
import { Dialog } from './dialogs';
import { ExportExtras } from './export-extra';
import { askMissingFonts, substitutedFonts } from './fonts-missing';
import { el, q, setClass, setDisabled, setHidden, setStyleVar, setText } from './dom';
import { t } from './i18n';
import { toast } from './toast';
import { AudioExportDialog } from './audio-export-dialog';
import { ExportChip } from './export-chip';
import { exportCard } from './export-cards';
import { copyFrameToClipboard, exportSpriteSheet } from '../export/sprite-sheet';
import { ProgressMeter, clock, planFor, type Reading } from '../export/progress-meter';

const KEY = 'formmorpheus.export';

export interface ExportDeps {
  engine: Engine;
  renderer: Renderer;
  audio: () => AudioEngine | null;
  saveOutput: (blob: Blob, name: string) => Promise<void>;
  /** The Movie file tile: save the .fmo (with its undo history or without). */
  exportFmo?: (withHistory: boolean) => void;
  /** Writes the open Drawing or Flipbook frame to the movie (the editor stays open), so an export and its preview include work not yet finished. */
  commitOpen?: () => Promise<void>;
}

type Tab = 'share' | 'advanced';
type Preset = 'movie' | '480' | '720' | '1080' | '2160' | 'custom';
type Quality = ExportOptions['quality'];
type Gif = ExportOptions['gif'];
type Kind = 'video' | 'gif' | 'still' | 'frames' | 'webp-anim' | 'apng' | 'psd';
type Codec = 'h264' | 'hevc' | 'prores' | 'vp9';
type Container = 'mp4' | 'mov' | 'webm';

interface Saved {
  kind: Kind; codec: Codec; container: Container; profile: ProresProfile; audioKind: AudioKind; picture: PictureExt; tiffDeflate: boolean;
  preset: Preset; customW: number; customH: number; pingpong: boolean; audio: boolean; alpha: boolean;
  quality: Quality; colors: number; dither: Gif['dither']; loop: boolean; timing: Gif['timing']; alphaThreshold: number; palette: string; palOn: boolean;
  frameMs: number; smoothness: number; intensity: number; tab: Tab;
  /** Frames as images: a folder of pictures (where the platform has a folder dialog) or one zip. */
  framesTo: 'folder' | 'zip';
  /** Other exports: ask for the folder to save to. */
  askWhere: boolean;
  /** GIF: one GIF frame per movie frame. */
  exactFrames: boolean;
}

const KINDS: { id: Kind; label: string }[] = [{ id: 'video', label: 'Video' }, { id: 'gif', label: 'Animated GIF' }, { id: 'webp-anim', label: 'Animated WebP' }, { id: 'apng', label: 'Animated PNG' }, { id: 'still', label: 'Current frame' }, { id: 'psd', label: 'Layered PSD (current frame)' }, { id: 'frames', label: 'Frames as images' }];
const CODECS: { id: Codec; label: string }[] = [{ id: 'h264', label: 'H.264' }, { id: 'hevc', label: 'HEVC (H.265)' }, { id: 'prores', label: 'Apple ProRes' }, { id: 'vp9', label: 'VP9 (WebM)' }];
const PROFILES: { id: ProresProfile; label: string }[] = [
  { id: 'proxy', label: 'ProRes 422 Proxy' }, { id: 'lt', label: 'ProRes 422 LT' }, { id: '422', label: 'ProRes 422' }, { id: 'hq', label: 'ProRes 422 HQ' },
  { id: '4444', label: 'ProRes 4444' }, { id: '4444xq', label: 'ProRes 4444 XQ' },
];
const PICTURES: { id: PictureExt; label: string }[] = [
  { id: 'png', label: '.png' }, { id: 'jpg', label: '.jpg' }, { id: 'tiff', label: '.tiff' }, { id: 'tga', label: '.tga' }, { id: 'bmp', label: '.bmp' }, { id: 'webp', label: '.webp' },
];
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'movie', label: 'Document size' }, { id: '480', label: '480p' }, { id: '720', label: '720p' }, { id: '1080', label: '1080p' }, { id: '2160', label: '4K' }, { id: 'custom', label: 'Custom' },
];
const DURATIONS: { ms: number; label: string }[] = [{ ms: 0, label: 'Automatic' }, { ms: 10, label: '10 ms' }, { ms: 50, label: '50 ms' }, { ms: 200, label: '200 ms' }, { ms: 500, label: '500 ms' }];
const SMOOTH = ['Low', 'Medium', 'High', 'Highest'];
const COLOR_STEPS = [2, 4, 8, 16, 32, 64, 128, 256];
const QUALITIES: { id: Quality; label: string }[] = [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'very-high', label: 'Very high' }];
/** Formats the engine's ffmpeg encodes (the browser cannot). */
const ENGINE: Partial<Record<ExportFormat, EngineTarget>> = { 'prores-mov': 'prores', 'prores4444-mov': 'prores4444', 'hevc-mp4': 'hevc', 'hevc-mov': 'hevc', 'h264-mov': 'h264', 'h264-mp4': 'h264' };
const VIDEO: ExportFormat[] = ['mp4', 'webm', 'mov', 'prores-mov', 'prores4444-mov', 'hevc-mp4', 'hevc-mov', 'h264-mov', 'h264-mp4'];
const STAGES: Record<ExportProgress['stage'], string> = { frames: 'Drawing frames', audio: 'Mixing sound', encoding: 'Encoding', finishing: 'Finishing' };
const FORMAT_NAMES: Partial<Record<ExportFormat, string>> = { mp4: 'MP4 video', webm: 'WebM video', mov: 'MOV video', gif: 'Animated GIF', 'png-frames': 'frames', 'png-still': 'current frame', 'prores-mov': 'ProRes video', 'hevc-mp4': 'HEVC video', 'hevc-mov': 'HEVC video', 'h264-mov': 'H.264 video' };

const DEFAULTS: Saved = {
  kind: 'video', codec: 'h264', container: 'mp4', profile: 'hq', audioKind: 'aac', picture: 'png', tiffDeflate: true,
  preset: 'movie', customW: 1920, customH: 1080, pingpong: false, audio: true, alpha: false,
  quality: 'high', colors: 256, dither: 'floyd-steinberg', loop: true, timing: 'exact', alphaThreshold: 128, palette: '', palOn: false,
  frameMs: 0, smoothness: 2, intensity: 50, tab: 'share', framesTo: 'folder', askWhere: false, exactFrames: true,
};

const pick = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);

function load(): Saved {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Saved, unknown>> & { format?: unknown };
    // a remembered choice from before the Video / GIF / frames layout
    const old = typeof r.format === 'string' ? r.format : '';
    const legacy: Partial<Saved> = old === 'gif' ? { kind: 'gif' } : old === 'png-still' ? { kind: 'still' } : /-frames$/.test(old) ? { kind: 'frames', picture: pick(old.replace('-frames', ''), ['png', 'jpg', 'webp'] as const, 'png') }
      : old === 'webm' ? { codec: 'vp9', container: 'webm' } : old === 'mov' ? { container: 'mov' } : old.startsWith('prores') ? { codec: 'prores', container: 'mov', profile: old.startsWith('prores4444') ? '4444' : 'hq' } : old.startsWith('hevc') ? { codec: 'hevc', container: old.endsWith('mov') ? 'mov' : 'mp4' } : {};
    const d = { ...DEFAULTS, ...legacy };
    return {
      kind: pick(r.kind, KINDS.map((k) => k.id), d.kind), codec: pick(r.codec, CODECS.map((c) => c.id), d.codec), container: pick(r.container, ['mp4', 'mov', 'webm'] as const, d.container),
      profile: pick(r.profile, PROFILES.map((p) => p.id), d.profile), audioKind: pick(r.audioKind, ['aac', 'pcm'] as const, d.audioKind), picture: pick(r.picture, PICTURES.map((p) => p.id), d.picture), tiffDeflate: r.tiffDeflate !== false,
      preset: pick(r.preset, PRESETS.map((p) => p.id), DEFAULTS.preset),
      customW: num(r.customW, 2, 16384, DEFAULTS.customW), customH: num(r.customH, 2, 16384, DEFAULTS.customH),
      pingpong: r.pingpong === true, audio: r.audio !== false, alpha: r.alpha === true,
      quality: pick(r.quality, QUALITIES.map((x) => x.id), DEFAULTS.quality), colors: num(r.colors, 2, 256, 256),
      dither: pick(r.dither, ['none', 'floyd-steinberg', 'ordered'] as const, DEFAULTS.dither), loop: r.loop !== false, timing: pick(r.timing, ['exact', 'even'] as const, 'exact'),
      alphaThreshold: num(r.alphaThreshold, 0, 255, 128), palette: typeof r.palette === 'string' ? r.palette.slice(0, 2000) : '', palOn: r.palOn === true,
      frameMs: pick(String(r.frameMs ?? 0), DURATIONS.map((x) => String(x.ms)), '0') === '0' ? 0 : Number(r.frameMs), smoothness: num(r.smoothness, 0, 3, 2), intensity: num(r.intensity, 0, 100, 50),
      tab: pick(r.tab, ['share', 'advanced'] as const, 'share'),
      framesTo: pick(r.framesTo, ['folder', 'zip'] as const, 'folder'), askWhere: r.askWhere === true, exactFrames: r.exactFrames !== false,
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
  { id: 'mp4', label: 'Video', sub: 'Plays everywhere (.mp4)', icon: TILE_ICONS.mp4 },
  { id: 'gif', label: 'Animated GIF', sub: 'Small, loops forever', icon: TILE_ICONS.gif },
  { id: 'png-frames', label: 'Frames as images', sub: 'A PNG for every frame', icon: TILE_ICONS.frames },
  { id: 'still', label: 'Current frame', sub: 'A single PNG still', icon: TILE_ICONS.still },
  { id: 'sprite', label: 'Sprite sheet', sub: 'A grid of frames (.png) and its rects (.json)', icon: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>') },
  { id: 'copy', label: 'Copy current frame', sub: 'A PNG on the clipboard', icon: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>') },
  { id: 'fmo', label: 'Movie file', sub: 'Smaller, keep editing (.fmo)', icon: TILE_ICONS.fmo },
  { id: 'audio', label: 'Sound only', sub: 'WAV, M4A, Opus, or one file per track', icon: svg('<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>') },
  { id: 'fmo-history', label: 'Movie file with full history', sub: 'Every undo step (.fmo)', icon: TILE_ICONS.fmo },
];

/** The folder a sequence is saved in carries the movie's name (the same cleaning the zip's inner folder gets). */
const safeFolder = (name: string): string => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().replace(/^\.+|\.+$/g, '').trim() || 'movie';

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

export class ExportDialog {
  private readonly dlg = new Dialog('Export', 1120);
  private readonly state: Saved = load();
  private readonly extras: ExportExtras = new ExportExtras({
    applyKind: (p) => this.applyKind(p),
    current: () => ({ kind: this.state.kind, codec: this.state.codec, container: this.state.container, quality: this.state.quality }),
    changed: () => { this.readForm(); this.sync(); },
    measure: () => this.measureSize(),
  });
  private sampleJob: ExportJob | null = null;
  private readonly rows = new Map<string, HTMLElement>();
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly shareBox = el<HTMLElement>('<div class="fm-ex-tiles"></div>');
  private readonly advBox = el<HTMLElement>('<div class="fm-ex-adv"></div>');
  private readonly runBox = el<HTMLElement>(
    '<div class="fm-ex-run" hidden><div class="fm-ex-run-head"><span class="fm-ex-run-title"></span><span class="fm-ex-run-count"></span></div><div class="cv-run-bar"><i></i></div><div class="fm-ex-run-time"></div></div>');
  private readonly notes = el<HTMLElement>('<div class="fm-ex-notes" hidden></div>');
  private readonly formBox = el<HTMLElement>('<div class="fm-ex-form"></div>');
  private readonly actions = el<HTMLElement>('<div class="fm-ex-actions"></div>');
  private footerHost: HTMLElement | null = null;
  private readonly kind = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Format">${KINDS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('')}</select>`);
  private readonly codec = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Video codec">${CODECS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('')}</select>`);
  private readonly profile = el<HTMLSelectElement>(`<select class="cv-input" aria-label="ProRes type">${PROFILES.map((f) => `<option value="${f.id}">${f.label}</option>`).join('')}</select>`);
  private readonly container = el<HTMLSelectElement>('<select class="cv-input" aria-label="File container"><option value="mp4">.mp4</option><option value="mov">.mov</option><option value="webm">.webm</option></select>');
  private readonly audioKind = el<HTMLSelectElement>('<select class="cv-input" aria-label="Audio encoding"><option value="aac">AAC</option><option value="pcm">Linear PCM</option></select>');
  private readonly picture = el<HTMLSelectElement>(`<select class="cv-input" aria-label="File container">${PICTURES.map((f) => `<option value="${f.id}">${f.label}</option>`).join('')}</select>`);
  private readonly tiffMode = el<HTMLSelectElement>('<select class="cv-input" aria-label="TIFF compression"><option value="deflate">Deflate</option><option value="none">None</option></select>');
  private readonly duration = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Frame duration">${DURATIONS.map((d) => `<option value="${d.ms}">${d.label}</option>`).join('')}</select>`);
  private readonly smooth = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Smoothness">${SMOOTH.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select>`);
  private readonly intensity = el<HTMLInputElement>('<input type="range" min="0" max="100" step="1" aria-label="Intensity">');
  private readonly intensityValue = el<HTMLElement>('<span class="fm-ex-val"></span>');
  private readonly colorStep = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Number of colors">${COLOR_STEPS.map((n) => `<option value="${n}">${n}</option>`).join('')}<option value="custom">Custom</option></select>`);
  private readonly fontNote = el<HTMLElement>('<div class="fm-ex-fontnote" hidden><p></p><button class="cv-btn" type="button">Fix fonts</button></div>');
  private readonly alphaNote = el<HTMLElement>('<span class="cv-note fm-ex-alpha-note" hidden></span>');
  private readonly framesTo = el<HTMLSelectElement>('<select class="cv-input" aria-label="Save frames as"><option value="folder">A folder of images</option><option value="zip">One zip file</option></select>');
  private readonly askWhere = el<HTMLInputElement>('<input type="checkbox" aria-label="Choose where to save">');
  private readonly exactFrames = el<HTMLInputElement>('<input type="checkbox" aria-label="One GIF frame for every movie frame">');
  private readonly palOn = el<HTMLInputElement>('<input type="checkbox" aria-label="Custom palette">');
  private readonly palPick = el<HTMLInputElement>('<input type="color" class="fm-ex-pick" value="#ff6a00" aria-label="Add a palette color">');
  private readonly palAdd = el<HTMLButtonElement>('<button class="cv-btn" type="button">Add color</button>');
  private readonly palChips = el<HTMLElement>('<div class="fm-ex-chips"></div>');
  private preview!: ExportPreview;
  private lastTab: Tab = 'share';
  private readonly preset = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Resolution">${PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}</select>`);
  private readonly width = el<HTMLInputElement>('<input class="cv-input" type="number" min="2" max="16384" step="1" aria-label="Width">');
  private readonly height = el<HTMLInputElement>('<input class="cv-input" type="number" min="2" max="16384" step="1" aria-label="Height">');
  private readonly size = el<HTMLElement>('<span class="cv-note fm-ex-size"></span>');
  private readonly rangeSel = el<HTMLSelectElement>('<select class="cv-input" aria-label="Range"><option value="whole">Whole movie</option><option value="custom">In and out</option></select>');
  private readonly inField = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" aria-label="In" placeholder="00:00:00">');
  private readonly outField = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" aria-label="Out" placeholder="00:00:00">');
  private readonly rangeNote = el<HTMLElement>('<span class="cv-note"></span>');
  private readonly mode = el<HTMLSelectElement>('<select class="cv-input" aria-label="Play"><option value="once">One Shot</option><option value="pingpong">Ping Pong</option></select>');
  private readonly gmode = el<HTMLSelectElement>('<select class="cv-input" aria-label="Playback"><option value="once">Loop</option><option value="pingpong">Ping Pong</option></select>');
  private readonly audio = el<HTMLInputElement>('<input type="checkbox" aria-label="Include sound">');
  private readonly alpha = el<HTMLInputElement>('<input type="checkbox" aria-label="Transparent background">');
  private readonly quality = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Quality">${QUALITIES.map((x) => `<option value="${x.id}">${x.label}</option>`).join('')}</select>`);
  private readonly colors = el<HTMLInputElement>('<input type="number" class="cv-input" min="2" max="256" step="1" aria-label="Colors">');
  private readonly dither = el<HTMLSelectElement>('<select class="cv-input" aria-label="Dithering"><option value="floyd-steinberg">Diffuse</option><option value="ordered">Stable</option><option value="none">None</option></select>');
  private readonly loop = el<HTMLInputElement>('<input type="checkbox" aria-label="Loop forever">');
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
  /** A short notice for the next result: the folder dialog was refused, so the file came as a download. */
  private fallback = '';
  // the running export's readout: shown in the window, and in a chip when the window is closed
  private meter: ProgressMeter | null = null;
  private tick = 0;
  private runName = '';
  private runStage = '';
  private runLast: Reading | null = null;
  private readonly chip = new ExportChip({ show: () => this.open(), cancel: () => { this.job?.cancel(); } });
  private audioDlg: AudioExportDialog | null = null;
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
    this.preview = new ExportPreview({
      movie: () => this.deps.engine.movie, renderer: this.deps.renderer,
      onFocus: (x, y) => { this.extras.setFocus(x, y); this.readForm(); this.sync(); },
    });
    this.buildAdvanced();
    this.advBox.append(this.preview.root, this.formBox);
    q(this.fontNote, 'button').addEventListener('click', () => { void askMissingFonts().then(() => this.sync()); });
    body.append(seg, this.fontNote, this.shareBox, this.advBox, this.runBox, this.notes);
    this.cancel = this.dlg.button('Close', 'ghost', () => this.onCancel());
    this.run = this.dlg.button('Export', 'primary', () => {
      if (this.rangeBad()) { this.note([this.range().error], 'error'); return; }
      this.start(this.fromForm());
    });
    this.dlg.onClose = () => { save(this.state); this.preview.stop(); if (!this.busy) this.preview.release(); this.syncChip(); };
    body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement) || e.target.type === 'checkbox' || this.state.tab !== 'advanced') return;
      e.preventDefault();
      // Enter in the In or Out field commits the typed time (shown as a timecode); it does not start the export
      if (e.target === this.inField || e.target === this.outField) { this.commitRange(); return; }
      this.run.click();
    });
  }

  open(tab?: Tab): void {
    if (!this.deps.engine.movie) { toast('Open or create a movie first.'); return; }
    if (!this.busy) this.hydrate();
    this.setTab(tab ?? this.state.tab);
    void this.refreshEngine();
    this.dlg.open(this.state.tab === 'share' ? this.shareBox.querySelector<HTMLElement>('button') : this.kind);
    this.syncChip();
    // the preview waits for the open frame to reach the movie, or it would show the movie without it
    void (this.deps.commitOpen?.() ?? Promise.resolve()).catch(() => undefined).then(() => { if (this.dlg.isOpen && this.state.tab === 'advanced') this.autoPreview(); });
  }

  close(): void { this.sampleJob?.cancel(); this.dlg.close(); }

  /** A short sample of the current settings is encoded and the whole file's size is worked out from it (the Measure button). */
  private async measureSize(): Promise<{ bytes: number; key: string } | null> {
    const movie = this.deps.engine.movie;
    if (!movie || this.sampleJob) return null;
    this.readForm();
    const o = this.build();
    if (ENGINE[o.format] || o.format === 'psd' || o.format === 'png-still') return null;
    const key = this.optsKey(o);
    const total = stepsFor(o, movie.fps), rate = outFps(o, movie.fps);
    const take = Math.min(total, Math.max(6, Math.round(rate * 1.5)));
    const i0 = Math.max(0, Math.floor((total - take) / 2));
    const first = movieFrameAt(i0, o, movie.fps);
    const span = Math.max(2, Math.ceil((take * movie.fps) / rate));
    const from = Math.max(o.from, Math.min(first, o.to - 1)), to = Math.min(o.to, from + span);
    if (to <= from) return null;
    const sample: ExportOptions = { ...o, from, to, pingpong: false, includeAudio: false, targetBytes: undefined };
    const job = startExport({ movie, renderer: this.deps.renderer, audio: null }, sample);
    this.sampleJob = job;
    try {
      const res = await job.result;
      const per = res.blob.size / stepsFor(sample, movie.fps);
      const sec = total / rate;
      return { bytes: per * total + (o.includeAudio ? (AUDIO_BPS / 8) * sec : 0), key };
    } catch { return null; } finally { this.sampleJob = null; }
  }

  /** The settings that decide a file's size (a watermark picture counts by its length). */
  private optsKey(o: ExportOptions): string {
    return JSON.stringify({ ...o, watermark: o.watermark ? { ...o.watermark, image: o.watermark.image ? o.watermark.image.length : 0 } : undefined });
  }

  private caps: JobCapabilities | null = null;

  /** Disables the codecs the engine's ffmpeg cannot encode (patched in place). */
  private async refreshEngine(): Promise<void> {
    const caps: JobCapabilities | null = await jobCapabilities();
    this.caps = caps;
    const need: Partial<Record<Codec, EngineTarget>> = { hevc: 'hevc', prores: 'prores' };
    for (const opt of Array.from(this.codec.options)) {
      const target = need[opt.value as Codec];
      if (!target) continue;
      const base = CODECS.find((f) => f.id === opt.value)?.label ?? opt.value;
      const info = caps?.targets[target];
      const ok = info?.available === true;
      const reason = ok ? '' : caps ? info?.reason ?? 'Not available' : 'The engine is not running';
      opt.disabled = !ok;
      opt.title = t(reason);
      // composed text escapes the page translator, so each part is translated here
      const text = ok ? t(base) : `${t(base)} (${t(reason).replace(/\.$/, '')})`;
      if (opt.textContent !== text) opt.textContent = text;
    }
    const target = need[this.state.codec];
    if (this.state.kind === 'video' && target && caps?.targets[target]?.available !== true) {
      this.state.codec = 'h264';
      this.codec.value = 'h264';
    }
    this.sync();
  }

  /** The Advanced tab renders a preview when it is entered, if the last one is not current. */
  private autoPreview(): void {
    if (this.busy) return;
    this.updatePreviewSpec();
    if (this.preview.needsRender) void this.preview.render();
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
    const inten = el<HTMLElement>('<div class="fm-ex-slide"></div>');
    inten.append(this.intensity, this.intensityValue);
    const pal = el<HTMLElement>('<div class="fm-ex-pal"></div>');
    pal.append(this.palette, this.palPick, this.palAdd);
    const chipsRow = this.row('chips', '', this.palChips);
    const F = this.formBox;
    // extras.rows: 0 Delivery head, 1 to 2 presets, then frame rate, scale, reframe, focus x / y (3 to 7), watermark (8 to 13),
    // loudness (14), rate control, kbps, MB, loops, lossless (15 to 19), file names (20), estimate (21)
    const ex = this.extras.rows;
    F.append(
      exportCard('Presets', ...ex.slice(1, 3)),
      exportCard('Video',
        this.row('kind', 'Format', this.kind),
        this.row('codec', 'Video codec', this.codec),
        this.row('profile', 'ProRes type', this.profile),
        this.row('container', 'File container', this.container),
        this.row('picture', 'File container', this.picture),
        this.row('tiffmode', 'TIFF compression', this.tiffMode),
        this.row('preset', 'Resolution', this.preset),
        this.row('dims', 'Size', dims, this.size),
        ...ex.slice(3, 5),
        this.row('range', 'Range', this.rangeSel),
        this.row('inout', 'In and out', range, this.rangeNote),
        this.row('mode', 'Playback', this.mode),
        this.row('alpha', 'Background', this.check(this.alpha, 'Transparent background'), this.alphaNote),
        this.row('framesto', 'Save frames as', this.framesTo),
        this.row('askwhere', 'Save to', this.check(this.askWhere, 'Choose a folder to save to')),
        ...ex.slice(5, 8),
      ),
      exportCard('Audio',
        this.row('audio', 'Sound', this.check(this.audio, 'Include sound')),
        this.row('audiokind', 'Audio encoding', this.audioKind),
        ex[14],
      ),
      exportCard('Quality',
        this.row('quality', 'Quality', this.quality),
        ...ex.slice(15, 20),
        ex[21],
      ),
      exportCard('Advanced',
        ...ex.slice(8, 14),
        ex[20],
        gifHead,
        this.row('duration', 'Frame duration', this.duration),
        this.row('gmode', 'Playback', this.gmode),
        this.row('dither', 'Dithering', this.dither),
        this.row('smooth', 'Smoothness', this.smooth),
        this.row('intensity', 'Intensity', inten),
        this.row('colorstep', 'Number of colors', this.colorStep, this.colors),
        this.row('palon', 'Custom palette', this.check(this.palOn, 'Use my own palette')),
        this.row('palette', 'Palette', pal),
        chipsRow,
        this.row('threshold', 'Alpha threshold', thr),
        this.row('loop', 'Loop', this.check(this.loop, 'Loop forever')),
        this.row('exact', 'Frames', this.check(this.exactFrames, 'One GIF frame for every movie frame')),
      ),
    );
    const change = (): void => { this.readForm(); this.sync(); };
    for (const c of [this.kind, this.codec, this.profile, this.container, this.audioKind, this.picture, this.tiffMode, this.duration, this.smooth, this.intensity, this.colorStep, this.palOn, this.gmode,
      this.preset, this.rangeSel, this.mode, this.audio, this.alpha, this.quality, this.colors, this.dither, this.loop, this.threshold, this.palette, this.inField, this.outField, this.framesTo, this.askWhere, this.exactFrames]) {
      c.addEventListener('input', change);
      c.addEventListener('change', change);
    }
    this.gmode.addEventListener('change', () => { this.mode.value = this.gmode.value; });
    this.mode.addEventListener('change', () => { this.gmode.value = this.mode.value; });
    this.palAdd.addEventListener('click', () => {
      const cur = this.palette.value.trim();
      this.palette.value = `${cur}${cur ? ' ' : ''}${this.palPick.value}`;
      change();
    });
    this.palChips.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('.fm-ex-chip');
      if (!chip) return;
      const list = this.palette.value.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
      list.splice(Number(chip.dataset.i), 1);
      this.palette.value = list.join(' ');
      change();
    });
    this.preset.addEventListener('change', () => this.extras.clearSize());
    this.width.addEventListener('input', () => { this.extras.clearSize(); this.dim('w'); });
    this.height.addEventListener('input', () => { this.extras.clearSize(); this.dim('h'); });
  }

  /** The palette's colors as small swatches, patched in place (click one to remove it). */
  private paintChips(): void {
    const list = (this.palette.value.match(/#[0-9a-fA-F]{6}\b/g) ?? []).slice(0, 256);
    const kids = this.palChips.children;
    for (let i = 0; i < list.length; i++) {
      let chip = kids[i] as HTMLElement | undefined;
      if (!chip) { chip = el<HTMLElement>('<span class="fm-ex-chip"></span>'); this.palChips.appendChild(chip); }
      chip.dataset.i = String(i);
      setStyleVar(chip, '--c', list[i]);
      chip.title = list[i];
      setHidden(chip, false);
    }
    for (let i = list.length; i < kids.length; i++) setHidden(kids[i] as HTMLElement, true);
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
    this.kind.value = s.kind;
    this.codec.value = s.codec;
    this.profile.value = s.profile;
    this.container.value = s.container;
    this.audioKind.value = s.audioKind;
    this.picture.value = s.picture;
    this.tiffMode.value = s.tiffDeflate ? 'deflate' : 'none';
    this.duration.value = String(s.frameMs);
    this.smooth.value = String(s.smoothness);
    this.intensity.value = String(s.intensity);
    this.colorStep.value = COLOR_STEPS.includes(s.colors) ? String(s.colors) : 'custom';
    this.palOn.checked = s.palOn;
    this.preset.value = s.preset;
    this.rangeSel.value = 'whole';
    this.inField.value = timecode(0, m.fps);
    this.outField.value = timecode(Math.max(0, m.duration - 1), m.fps);
    this.mode.value = s.pingpong ? 'pingpong' : 'once';
    this.gmode.value = s.pingpong ? 'pingpong' : 'once';
    this.audio.checked = s.audio;
    this.alpha.checked = s.alpha;
    this.quality.value = s.quality;
    this.colors.value = String(s.colors);
    this.dither.value = s.dither;
    this.loop.checked = s.loop;
    this.framesTo.value = s.framesTo;
    this.askWhere.checked = s.askWhere;
    this.exactFrames.checked = s.exactFrames;
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
    s.kind = this.kind.value as Kind;
    s.codec = this.codec.value as Codec;
    s.profile = this.profile.value as ProresProfile;
    s.container = this.container.value as Container;
    s.audioKind = this.audioKind.value as AudioKind;
    s.picture = this.picture.value as PictureExt;
    s.tiffDeflate = this.tiffMode.value === 'deflate';
    s.frameMs = Number(this.duration.value) || 0;
    s.smoothness = num(Number(this.smooth.value), 0, 3, 2);
    s.intensity = num(this.intensity.valueAsNumber, 0, 100, 50);
    s.palOn = this.palOn.checked;
    // the GIF Playback control and the video one are the same choice: whichever is on screen wins
    s.pingpong = (s.kind === 'gif' || s.kind === 'webp-anim' || s.kind === 'apng' ? this.gmode : this.mode).value === 'pingpong';
    // video: the container follows the codec
    if (s.codec === 'prores') s.container = 'mov'; else if (s.codec === 'vp9') s.container = 'webm'; else if (s.container === 'webm') s.container = 'mp4';
    this.container.value = s.container;
    if (s.container !== 'mov' && s.audioKind === 'pcm') { s.audioKind = 'aac'; this.audioKind.value = 'aac'; }
    s.preset = this.preset.value as Preset;
    s.audio = this.audio.checked;
    s.alpha = this.alpha.checked;
    s.quality = this.quality.value as Quality;
    s.colors = this.colorStep.value === 'custom' ? num(this.colors.valueAsNumber, 2, 256, s.colors) : Number(this.colorStep.value);
    if (this.colorStep.value !== 'custom') this.colors.value = String(s.colors);
    s.dither = this.dither.value as Gif['dither'];
    s.loop = this.loop.checked;
    s.framesTo = this.framesTo.value === 'zip' ? 'zip' : 'folder';
    s.askWhere = this.askWhere.checked;
    s.exactFrames = this.exactFrames.checked;
    s.alphaThreshold = num(this.threshold.valueAsNumber, 0, 255, s.alphaThreshold);
    s.palette = this.palette.value;
    if (s.preset === 'custom' && document.activeElement !== this.width && document.activeElement !== this.height) { this.width.value = String(s.customW); this.dimsFromAspect(); }
  }

  /** The size the chosen preset gives for this movie (video sizes are made even). */
  private outSize(): [number, number] {
    const m = this.deps.engine.movie;
    if (!m) return [2, 2];
    const s = this.state;
    const video = VIDEO.includes(this.format());
    const fix = (w: number, h: number): [number, number] => (video ? [even(w), even(h)] : [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))]);
    // a delivery preset's box or long edge, and the resolution scale, apply on top of the resolution choice
    const dx = (w: number, h: number): [number, number] => this.extras.size([w, h], video);
    if (s.preset === 'movie') return dx(m.width, m.height);
    if (s.preset === 'custom') return dx(s.customW, s.customH);
    const short = Number(s.preset) || 1080, k = short / Math.min(m.width, m.height);
    return dx(...fix(m.width * k, m.height * k));
  }

  /** What the delivery rows need to know to show their size estimate. */
  private extraInfo(w: number, h: number) {
    const m = this.deps.engine.movie as NonNullable<Engine['movie']>;
    const s = this.state, r = this.range(), n = r.to - r.from;
    return {
      kind: s.kind, codec: s.codec, width: w, height: h, baseSteps: s.pingpong && n >= 3 ? n + n - 2 : n, movieFps: m.fps,
      audio: s.audio && this.audioKindOn(), quality: s.quality, alpha: s.alpha && m.transparent, picture: s.kind === 'still' || s.kind === 'frames' ? s.picture : undefined,
      layers: m.tracks.filter((t) => !t.hidden && t.content.some((c) => r.from >= c.start && r.from < c.start + c.duration)).length,
      aspect: m.width / m.height,
    };
  }

  private audioKindOn(): boolean { return this.state.kind === 'video'; }

  /** A delivery preset picks a format: set the dialog's own controls to match. */
  private applyKind(p: { kind?: string; codec?: string; container?: string; quality?: ExportOptions['quality'] }): void {
    const s = this.state;
    if (p.kind) { s.kind = p.kind as Kind; this.kind.value = s.kind; }
    if (p.codec) { s.codec = p.codec as Codec; this.codec.value = s.codec; }
    if (p.container) { s.container = p.container as Container; this.container.value = s.container; }
    if (p.quality) { s.quality = p.quality; this.quality.value = s.quality; }
    this.sync();
  }

  private range(): { from: number; to: number; error: string } {
    const m = this.deps.engine.movie;
    if (!m) return { from: 0, to: 1, error: '' };
    if (this.state.kind === 'still' || this.state.kind === 'psd') { const f = Math.min(Math.max(0, this.deps.engine.frame), Math.max(0, m.duration - 1)); return { from: f, to: f + 1, error: '' }; }
    if (this.rangeSel.value === 'whole') return { from: 0, to: Math.max(1, m.duration), error: '' };
    const a = parseTime(this.inField.value, m.fps), b = parseTime(this.outField.value, m.fps);
    if (a === null || b === null) return { from: 0, to: Math.max(1, m.duration), error: 'Type the in and out as timecodes, for example 00:02:00 or 48.' };
    const from = Math.min(Math.max(0, a), m.duration - 1), last = Math.min(Math.max(from, b), m.duration - 1);
    return { from, to: last + 1, error: last < b || from > a ? 'The range was kept inside the movie.' : '' };
  }

  /** The typed In and Out are read, kept inside the movie and written back as timecodes. */
  private commitRange(): void {
    const m = this.deps.engine.movie;
    if (!m) return;
    const a = parseTime(this.inField.value, m.fps), b = parseTime(this.outField.value, m.fps);
    if (a !== null) this.inField.value = timecode(Math.min(Math.max(0, a), m.duration - 1), m.fps);
    if (b !== null) this.outField.value = timecode(Math.min(Math.max(0, b), m.duration - 1), m.fps);
    this.readForm();
    this.sync();
  }

  private rangeBad(): boolean { return /timecodes/.test(this.range().error); }

  /** Shows only the rows that apply to the chosen format, and the sums under them. */
  private sync(): void {
    const m = this.deps.engine.movie;
    if (!m) return;
    const s = this.state, show = (id: string, on: boolean): void => { const r = this.rows.get(id); if (r) setHidden(r, !on); };
    const still = s.kind === 'still' || s.kind === 'psd', gif = s.kind === 'gif' || s.kind === 'webp-anim' || s.kind === 'apng', video = s.kind === 'video', frames = s.kind === 'frames';
    const pic = s.kind === 'still' || frames;
    show('codec', video);
    show('profile', video && s.codec === 'prores');
    show('container', video);
    show('picture', pic);
    show('tiffmode', pic && s.picture === 'tiff');
    show('range', !still);
    show('inout', !still && this.rangeSel.value === 'custom');
    show('mode', video || frames);
    show('gmode', gif);
    show('audio', video);
    show('audiokind', video && this.audio.checked);
    // HEVC cannot carry transparency without the platform encoder: say so instead of hiding the choice
    const noHevcAlpha = video && s.codec === 'hevc' && this.caps?.targets.hevc?.alpha !== true;
    show('alpha', m.transparent && (this.alphaOk() || noHevcAlpha));
    setDisabled(this.alpha, noHevcAlpha);
    setHidden(this.alphaNote, !noHevcAlpha);
    if (noHevcAlpha) setText(this.alphaNote, t(this.caps ? (this.caps.targets.hevc?.alpha_reason ?? 'HEVC with transparency is not available here.') : 'The engine is not running, so HEVC with transparency is not available.'));
    show('quality', (video && s.codec !== 'prores') || (pic && (s.picture === 'jpg' || s.picture === 'webp')) || s.kind === 'webp-anim');
    const isGif = s.kind === 'gif';
    for (const id of ['gifhead', 'duration', 'dither', 'colorstep', 'palon', 'loop', 'exact']) show(id, isGif);
    // a folder to save to, where the platform has a folder dialog: frames get a folder of pictures (or a zip), other exports may ask
    show('framesto', frames && canPickFolder());
    show('askwhere', !frames && canPickFolder());
    show('smooth', isGif && s.dither === 'ordered');
    show('intensity', isGif && s.dither === 'ordered');
    show('palette', isGif && s.palOn);
    show('chips', isGif && s.palOn);
    show('threshold', isGif && m.transparent && this.alpha.checked);
    setHidden(this.colors, this.colorStep.value !== 'custom');
    // choices that do not apply to the chosen codec, patched in place
    const opt = (sel: HTMLSelectElement, value: string, on: boolean): void => { const o = Array.from(sel.options).find((x) => x.value === value); if (o && o.hidden !== !on) { o.hidden = !on; o.disabled = !on; } };
    opt(this.container, 'mp4', s.codec === 'h264' || s.codec === 'hevc');
    opt(this.container, 'mov', s.codec === 'h264' || s.codec === 'hevc' || s.codec === 'prores');
    opt(this.container, 'webm', s.codec === 'vp9');
    opt(this.audioKind, 'pcm', s.container === 'mov');
    opt(this.preset, '480', true);
    setText(this.intensityValue, String(s.intensity));
    this.paintChips();
    setHidden(q(this.rows.get('dims') as HTMLElement, '.fm-ex-dims'), this.state.preset !== 'custom');
    const [w, h] = this.outSize();
    this.extras.sync(this.extraInfo(w, h), this.state.tab === 'advanced' ? this.optsKey(this.build()) : '');
    if (this.state.preset !== 'custom') { setText(this.size, `${w} x ${h}`); setHidden(this.size, false); } else setHidden(this.size, true);
    setText(this.thresholdValue, String(this.state.alphaThreshold));
    const r = this.range();
    const n = r.to - r.from, steps = this.state.pingpong && n >= 3 ? n + n - 2 : n;
    setText(this.rangeNote, r.error || `${steps} ${steps === 1 ? 'frame' : 'frames'} · ${(steps / m.fps).toFixed(steps / m.fps < 10 ? 2 : 1)} s`);
    setClass(this.rangeNote, 'is-bad', this.rangeBad());
    setDisabled(this.run, this.busy);
    // Text in a font that cannot be found is drawn in Inter: say so before the file is made
    const lost = substitutedFonts(m, r.from, r.to);
    setHidden(this.fontNote, lost.length === 0);
    if (lost.length) setText(q(this.fontNote, 'p'), t('Text in {fonts} will be drawn in Inter, because that font is not available here.').replace('{fonts}', lost.join(', ')));
    this.updatePreviewSpec();
  }

  /** The export format the choices add up to. */
  private format(): ExportFormat {
    const s = this.state;
    if (s.kind === 'gif') return 'gif';
    if (s.kind === 'webp-anim' || s.kind === 'apng' || s.kind === 'psd') return s.kind;
    if (s.kind === 'still') return 'png-still';
    if (s.kind === 'frames') return `${s.picture}-frames` as ExportFormat;
    if (s.codec === 'vp9') return 'webm';
    if (s.codec === 'prores') return 'prores-mov';
    if (s.codec === 'hevc') return s.container === 'mov' ? 'hevc-mov' : 'hevc-mp4';
    // Linear PCM sound in a .mov goes through the engine
    if (s.container === 'mov' && s.audio && s.audioKind === 'pcm' && this.caps?.targets.h264?.available === true) return 'h264-mov';
    return s.container === 'mov' ? 'mov' : 'mp4';
  }

  /** The picture type a frame is written as (png for video and GIF). */
  private ext(): PictureExt {
    return this.state.kind === 'still' || this.state.kind === 'frames' ? this.state.picture : 'png';
  }

  /** Whether the chosen format can carry a transparent background. */
  private alphaOk(): boolean {
    const s = this.state;
    if (s.kind === 'gif' || s.kind === 'webp-anim' || s.kind === 'apng' || s.kind === 'psd') return true;
    if (s.kind === 'video') return s.codec === 'vp9' || (s.codec === 'prores' && (s.profile === '4444' || s.profile === '4444xq')) || (s.codec === 'hevc' && this.caps?.targets.hevc?.alpha === true);
    return pictureHasAlpha(s.picture);
  }

  private build(): ExportOptions {
    const m = this.deps.engine.movie as NonNullable<Engine['movie']>;
    const s = this.state, r = this.range(), [width, height] = this.outSize();
    const pal = s.palOn ? s.palette.match(/#[0-9a-fA-F]{6}\b/g) : null;
    const format = this.format();
    const video = s.kind === 'video';
    const o: ExportOptions = {
      format, width, height, from: r.from, to: r.to,
      pingpong: s.pingpong && s.kind !== 'still' && s.kind !== 'psd', includeAudio: s.audio && video,
      alpha: s.alpha && m.transparent && this.alphaOk(), quality: s.quality,
      gif: {
        colors: s.colors, dither: s.dither, palette: pal && pal.length ? pal : null, alphaThreshold: s.alphaThreshold, loop: s.loop, timing: s.timing,
        frameMs: s.frameMs, smoothness: s.smoothness, intensity: s.intensity, exactFrames: s.exactFrames,
      },
      picture: s.kind === 'still' || s.kind === 'frames' ? s.picture : undefined, tiffDeflate: s.tiffDeflate,
      audioCodec: s.audioKind, proresProfile: s.codec === 'prores' ? s.profile : undefined,
    };
    return this.extras.patch(o, this.extraInfo(width, height));
  }

  private fromForm(): ExportOptions {
    this.readForm();
    return this.build();
  }

  /** Tells the preview what the settings give now; it turns stale when that changed. */
  private updatePreviewSpec(): void {
    if (!this.deps.engine.movie || this.state.tab !== 'advanced') return;
    const o = this.build();
    const ext = this.ext();
    const spec: PreviewSpec = {
      opts: o, keepAlpha: o.alpha && pictureHasAlpha(ext),
      lossy: ext === 'jpg' ? 'jpg' : ext === 'webp' ? 'webp' : null,
      key: JSON.stringify([o.format, o.width, o.height, o.from, o.to, o.pingpong, o.alpha, o.quality, o.format === 'gif' ? [o.gif.colors, o.gif.dither, o.gif.palette, o.gif.alphaThreshold, o.gif.smoothness, o.gif.intensity] : 0, ext, this.deps.engine.movie.background, o.fps ?? 0, o.fit ?? '', o.focus ?? 0, o.watermark ? [o.watermark.kind, o.watermark.text, o.watermark.image?.length, o.watermark.pos, o.watermark.opacity, o.watermark.size] : 0]),
    };
    this.preview.setSpec(spec);
  }

  // Quick share ---------------------------------------------------------------------------------

  private quick(id: string): void {
    const m = this.deps.engine.movie;
    if (!m || this.busy) return;
    if (id === 'audio') { (this.audioDlg ??= new AudioExportDialog({ engine: this.deps.engine, audio: this.deps.audio, saveOutput: this.deps.saveOutput })).open(); return; }
    if (id === 'fmo' || id === 'fmo-history') { this.deps.exportFmo?.(id === 'fmo-history'); if (!this.deps.exportFmo) toast('Saving the movie file is not available here.'); this.close(); return; }
    if (id === 'sprite' || id === 'copy') { void this.extraAction(id); return; }
    const base = this.fromFormDefaults();
    if (id === 'mp4') this.start({ ...base, format: 'mp4', includeAudio: true, quality: 'high' });
    else if (id === 'gif') {
      const k = Math.min(1, 640 / Math.max(m.width, m.height));
      this.start({ ...base, format: 'gif', width: Math.max(1, Math.round(m.width * k)), height: Math.max(1, Math.round(m.height * k)), alpha: m.transparent });
    } else if (id === 'png-frames') this.start({ ...base, format: 'png-frames', alpha: m.transparent });
    else { const f = Math.min(Math.max(0, this.deps.engine.frame), Math.max(0, m.duration - 1)); this.start({ ...base, format: 'png-still', from: f, to: f + 1, alpha: m.transparent }); }
  }

  /** Sprite sheet (a PNG and a JSON of frame rects) and Copy current frame (PNG on the clipboard). */
  private async extraAction(id: 'sprite' | 'copy'): Promise<void> {
    const m = this.deps.engine.movie;
    if (!m) return;
    const deps = { movie: m, renderer: this.deps.renderer, audio: this.deps.audio() };
    this.busy = true;
    try {
      if (id === 'copy') {
        const ok = await copyFrameToClipboard(deps, Math.min(Math.max(0, this.deps.engine.frame), Math.max(0, m.duration - 1)), m.transparent);
        toast(ok ? t('Copied the current frame.') : t('This browser would not put the picture on the clipboard.'), ok ? 'info' : 'error');
        return;
      }
      const r = await exportSpriteSheet(deps, { from: 0, to: Math.max(1, m.duration), alpha: m.transparent }, (d, n) => this.paintBusy(true, 'Frames', n ? d / n : 0, `${d} / ${n}`));
      for (const [blob, name] of [[r.png, `${r.name} sprites.png`], [r.json, `${r.name} sprites.json`]] as const) {
        downloadBlob(blob, name);
        try { await this.deps.saveOutput(blob, name); } catch { /* the download stands */ }
      }
      toast(t('Sprite sheet: {n} frames in {cols} by {rows}, cells {w} x {h}.').replace('{n}', String(r.frames)).replace('{cols}', String(r.cols)).replace('{rows}', String(r.rows)).replace('{w}', String(r.cell[0])).replace('{h}', String(r.cell[1])), 'info');
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : t('The export failed.'), 'error');
    } finally {
      this.busy = false;
      this.paintBusy(false, '', 0);
    }
  }

  /** A one-click export from outside the dialog (the Movie settings Share tab): default settings, the movie's own size, rate and length. */
  runQuick(id: string): void {
    this.quick(id);
  }

  private fromFormDefaults(): ExportOptions {
    const m = this.deps.engine.movie as NonNullable<Engine['movie']>;
    return {
      format: 'mp4', width: even(m.width), height: even(m.height), from: 0, to: Math.max(1, m.duration), pingpong: false, includeAudio: false, alpha: false, quality: 'high',
      gif: { colors: 256, dither: 'floyd-steinberg', palette: null, alphaThreshold: 128, loop: true, timing: 'exact', exactFrames: true },
    };
  }

  // Running -------------------------------------------------------------------------------------

  /** Browser H.264 with AAC sound: when this browser has no AAC encoder the engine encodes it instead. */
  private start(opts: ExportOptions): void {
    const plain = opts.format === 'mp4' || opts.format === 'mov';
    if (!plain || !opts.includeAudio || opts.audioCodec === 'pcm' || this.busy) { this.begin(opts); return; }
    this.busy = true;
    this.paintBusy(true, 'Starting', 0);
    void browserHasAac().then(async (ok) => {
      this.busy = false;
      const caps = this.caps ?? await jobCapabilities();
      if (!ok && caps?.targets.h264?.available === true && caps.aac) this.begin({ ...opts, format: opts.format === 'mov' ? 'h264-mov' : 'h264-mp4' });
      else this.begin(opts);
    });
  }

  /** Asks for the folder first where the person chose one (frames as a folder of images, or Choose a folder to save to), then runs. */
  private begin(opts: ExportOptions, committed = false): void {
    if (this.busy || !this.deps.engine.movie) return;
    if (!committed && this.deps.commitOpen) {
      // work in an open Drawing or Flipbook is not in the movie until written: write it first
      this.busy = true;
      void this.deps.commitOpen().catch(() => undefined).then(() => { this.busy = false; this.begin(opts, true); });
      return;
    }
    const frames = opts.format.endsWith('-frames');
    const ask = canPickFolder() && (frames ? this.state.framesTo === 'folder' : this.state.askWhere);
    if (!ask) { this.launch(opts, null); return; }
    void pickDestination().then((dest) => {
      if (dest === 'unavailable') { this.fallback = t('The folder could not be chosen here, so the file was downloaded instead.'); this.launch(opts, null); return; }
      if (!dest) { this.note(['Export cancelled.'], 'warn'); toast(t('Export cancelled.')); return; }
      this.launch(opts, dest);
    });
  }

  private launch(opts: ExportOptions, dest: Dest | null): void {
    const movie = this.deps.engine.movie;
    if (!movie || this.busy) return;
    save(this.state);
    this.busy = true;
    this.note([]);
    this.paintBusy(true, `Starting`, 0);
    const label = t('Export {name}').replace('{name}', FORMAT_NAMES[opts.format] ?? opts.format.replace(/-/g, ' '));
    const ej = this.deps.engine.startJob(label, 1);
    this.engineJob = ej;
    const off = this.deps.engine.on('progress', () => { if (ej.cancelled) job.cancel(); });
    const target = ENGINE[opts.format];
    const deps = { movie, renderer: this.deps.renderer, audio: this.deps.audio() };
    const job = target ? startEngineExport(deps, { ...opts, target }) : startExportRouted(deps, opts);
    this.job = job;
    const meter = new ProgressMeter(planFor(opts.format, { engine: !!target, audio: opts.includeAudio && VIDEO.includes(opts.format) }));
    this.meter = meter;
    this.runName = label;
    this.runStage = t('Starting');
    this.runLast = null;
    this.tick = window.setInterval(() => { if (this.runLast) this.showReading(meter.read()); }, 500);
    this.syncChip();
    job.onProgress((p) => {
      ej.total = Math.max(1, p.total);
      this.deps.engine.stepJob(ej, p.done);
      this.runStage = t(STAGES[p.stage]);
      this.showReading(meter.update(p));
    });
    void job.result.then(async (res) => {
      const lines = [...res.warnings];
      if (res.gpuReset) lines.push(t('The graphics card reset during the export, so part of it was drawn without it and may differ slightly.'));
      if (this.fallback) { lines.push(this.fallback); this.fallback = ''; }
      let kept = true;
      let shown = res.name;
      let landed = false;
      if (dest) {
        // the folder the person chose: a sequence becomes a folder of pictures named after the movie, anything else one file
        try {
          if (opts.format.endsWith('-frames') && res.mime === 'application/zip') {
            const r = await saveFramesTo(dest, res.blob, safeFolder(movie.name));
            shown = t('{n} frames in {where}').replace('{n}', String(r.files)).replace('{where}', r.where);
          } else shown = await saveFileTo(dest, res.blob, res.name);
          landed = true;
        } catch (e) {
          lines.push(`${e instanceof Error && e.message ? e.message : t('The file could not be saved there.')} ${t('It was downloaded instead.')}`);
        }
      }
      // a zip that became a folder is not kept again as a zip in Exports
      if (!landed) downloadBlob(res.blob, res.name);
      if (!res.kept && !(landed && opts.format.endsWith('-frames'))) { try { await this.deps.saveOutput(res.blob, res.name); } catch { kept = false; } }
      if (!kept) lines.push(landed ? 'The file could not be kept in Exports.' : 'The file was downloaded, but it could not be kept in Exports.');
      const took = clock(meter.read().elapsedMs);
      this.finish(off, ej);
      if (this.dlg.isOpen) this.note([t('Saved {name}').replace('{name}', shown) + ` · ${took}`, ...lines], lines.length ? 'warn' : 'ok');
      else toast(t('Exported {name} in {time}.').replace('{name}', shown).replace('{time}', took) + (lines.length ? ` ${lines.join(' ')}` : ''), kept ? 'info' : 'error', kept ? { actions: [{ label: t('Show in Exports'), run: () => document.dispatchEvent(new CustomEvent('fm:show-exports')) }] } : undefined);
    }, (e: unknown) => {
      this.finish(off, ej);
      if (e instanceof DOMException && e.name === 'AbortError') {
        if (this.dlg.isOpen) this.note(['Export cancelled.'], 'warn'); else toast(t('Export cancelled.'));
        return;
      }
      const text = e instanceof Error && e.message ? e.message : 'The export failed.';
      if (this.dlg.isOpen) this.note([text], 'error'); else toast(text, 'error');
    });
  }

  /** One reading to the window's readout and to the chip. */
  private showReading(r: Reading): void {
    this.runLast = r;
    const count = r.total > 1 && r.stage !== 'finishing' ? t('{done} of {total} frames').replace('{done}', String(r.done)).replace('{total}', String(r.total)) : `${Math.round(r.frac * 100)}%`;
    this.paintBusy(true, this.runStage, r.frac, count);
    const left = r.etaMs === null ? '' : ` · ${t('{time} left').replace('{time}', clock(r.etaMs))}`;
    setText(q(this.runBox, '.fm-ex-run-time'), `${t('Elapsed {time}').replace('{time}', clock(r.elapsedMs))}${left}`);
    this.chip.paint(this.runName, this.runStage, r);
  }

  /** The chip is up while an export runs and its window is closed. */
  private syncChip(): void {
    this.chip.set(this.busy && !!this.job && !this.dlg.isOpen);
  }

  private finish(off: () => void, ej: NonNullable<ExportDialog['engineJob']>): void {
    off();
    this.deps.engine.endJob(ej);
    this.engineJob = null;
    this.job = null;
    this.busy = false;
    window.clearInterval(this.tick);
    this.meter = null;
    this.runLast = null;
    this.syncChip();
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
    // Cancel and Export sit together on the one bar at the foot of the window on both tabs; Preview stays under the preview picture
    this.footerHost ??= this.cancel.parentElement;
    if (this.footerHost && this.run.parentElement !== this.footerHost) this.footerHost.append(this.cancel, this.run);
    if (tab === 'advanced') { this.sync(); if (this.lastTab !== 'advanced' && this.dlg.isOpen) this.autoPreview(); }
    this.lastTab = tab;
  }
}
