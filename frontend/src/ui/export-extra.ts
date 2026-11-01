// The delivery rows of the Export dialog (Advanced): presets (built in and your own), frame rate, resolution
// scale, rate control (quality, bitrate or file size), a live size estimate, and the options of animated pictures
// and frame sequences. Built once; the dialog calls sync() and patch() (see export/delivery.ts for the maths).
import { BUILTIN_PRESETS, DEFAULT_PATTERN, estimateBytes, formatBytes, outFps, type EstimateKind, type Preset, type PresetSpec } from '../export/delivery';
import type { ExportOptions } from '../export/types';
import { LUFS_PRESETS } from '../media/loudness';
import { el, q, setClass, setDisabled, setHidden, setText } from './dom';
import { t } from './i18n';

const KEY = 'formmorpheus.export.delivery';

type RateMode = 'quality' | 'bitrate' | 'size';

type Fit = 'contain' | 'cover' | 'blur';
type WmPos = 'tl' | 'tr' | 'bl' | 'br' | 'c';

interface State {
  preset: string; fps: number; scale: number; fit: Fit; box: [number, number] | null; longEdge: number;
  rate: RateMode; kbps: number; mb: number; loops: number; lossless: boolean; pattern: string;
  /** Crop focus in percent of the movie frame. */
  fx: number; fy: number;
  wm: 'none' | 'text' | 'image'; wmText: string; wmImage: string; wmPos: WmPos; wmOpacity: number; wmSize: number;
  /** Target loudness of the sound in LUFS; 0 leaves it as mixed. */
  lufs: number;
}

const DEFAULTS: State = {
  preset: '', fps: 0, scale: 100, fit: 'contain', box: null, longEdge: 0, rate: 'quality', kbps: 8000, mb: 10, loops: 0, lossless: false, pattern: DEFAULT_PATTERN,
  fx: 50, fy: 50, wm: 'none', wmText: '', wmImage: '', wmPos: 'br', wmOpacity: 70, wmSize: 12, lufs: 0,
};

const FPS_CHOICES = [0, 12, 15, 20, 24, 25, 30, 48, 50, 60];
const SCALES = [200, 100, 75, 50, 25];

export interface ExtraHost {
  /** A preset picks a format: the dialog applies these to its own controls. */
  applyKind(p: { kind?: string; codec?: string; container?: string; quality?: ExportOptions['quality'] }): void;
  /** The dialog's own choices, saved with a preset of yours. */
  current(): { kind: string; codec: string; container: string; quality: ExportOptions['quality'] };
  changed(): void;
  /** Encodes a short sample of the current settings and reports the whole file's size (the Measure button); null: it could not. */
  measure?(): Promise<{ bytes: number; key: string } | null>;
}

export interface ExtraInfo {
  kind: EstimateKind; codec: string; width: number; height: number; baseSteps: number; movieFps: number; audio: boolean;
  quality: ExportOptions['quality']; alpha: boolean; picture?: string; layers: number;
  /** The movie's width over its height: the Reframe rows show when the output has another shape. */
  aspect?: number;
}

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export class ExportExtras {
  readonly rows: HTMLElement[] = [];
  state: State = { ...DEFAULTS };
  private user: Preset[] = [];
  private readonly map = new Map<string, HTMLElement>();
  private readonly presetSel = el<HTMLSelectElement>('<select class="cv-input" aria-label="Preset"></select>');
  private readonly presetName = el<HTMLInputElement>('<input type="text" class="cv-input" spellcheck="false" maxlength="40" placeholder="Name for your preset" aria-label="Preset name">');
  private readonly presetSave = el<HTMLButtonElement>('<button class="cv-btn" type="button">Save as preset</button>');
  private readonly presetDel = el<HTMLButtonElement>('<button class="cv-btn" type="button">Delete preset</button>');
  private readonly fps = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Frame rate">${FPS_CHOICES.map((n) => `<option value="${n}">${n === 0 ? 'Same as the movie' : `${n} fps`}</option>`).join('')}</select>`);
  private readonly scale = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Resolution scale">${SCALES.map((n) => `<option value="${n}">${n}%</option>`).join('')}</select>`);
  private readonly fit = el<HTMLSelectElement>('<select class="cv-input" aria-label="Reframe"><option value="contain">Fit inside (bars)</option><option value="cover">Fill (crop)</option><option value="blur">Fit over blurred fill</option></select>');
  private readonly focusX = el<HTMLInputElement>('<input type="range" class="cv-input" min="0" max="100" step="1" aria-label="Focus point, horizontal">');
  private readonly focusY = el<HTMLInputElement>('<input type="range" class="cv-input" min="0" max="100" step="1" aria-label="Focus point, vertical">');
  private readonly wmKind = el<HTMLSelectElement>('<select class="cv-input" aria-label="Watermark"><option value="none">None</option><option value="text">Text</option><option value="image">Picture</option></select>');
  private readonly wmText = el<HTMLInputElement>('<input type="text" class="cv-input" spellcheck="false" maxlength="80" aria-label="Watermark text">');
  private readonly wmFile = el<HTMLInputElement>('<input type="file" class="cv-input" accept="image/*" aria-label="Watermark picture">');
  private readonly wmPos = el<HTMLSelectElement>('<select class="cv-input" aria-label="Watermark position"><option value="tl">Top left</option><option value="tr">Top right</option><option value="bl">Bottom left</option><option value="br">Bottom right</option><option value="c">Center</option></select>');
  private readonly wmOpacity = el<HTMLInputElement>('<input type="range" class="cv-input" min="5" max="100" step="1" aria-label="Watermark opacity">');
  private readonly wmSize = el<HTMLInputElement>('<input type="range" class="cv-input" min="3" max="60" step="1" aria-label="Watermark size">');
  private readonly lufs = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Normalize loudness"><option value="0">Off</option>${LUFS_PRESETS.map((v) => `<option value="${v}">${v} LUFS</option>`).join('')}</select>`);
  private readonly measure = el<HTMLButtonElement>('<button class="cv-btn" type="button">Measure</button>');
  private readonly rate = el<HTMLSelectElement>('<select class="cv-input" aria-label="Rate control"><option value="quality">Constant quality</option><option value="bitrate">Target bitrate</option><option value="size">Target file size</option></select>');
  private readonly kbps = el<HTMLInputElement>('<input type="number" class="cv-input" min="50" max="400000" step="50" aria-label="Bitrate in kilobits per second">');
  private readonly mb = el<HTMLInputElement>('<input type="number" class="cv-input" min="0.1" max="20000" step="0.1" aria-label="File size in megabytes">');
  private readonly loops = el<HTMLInputElement>('<input type="number" class="cv-input" min="0" max="65535" step="1" aria-label="Loop count">');
  private readonly lossless = el<HTMLInputElement>('<input type="checkbox" aria-label="Lossless">');
  private readonly pattern = el<HTMLInputElement>('<input type="text" class="cv-input" spellcheck="false" aria-label="File name pattern">');
  private readonly estimate = el<HTMLElement>('<span class="cv-note fm-ex-estimate"></span>');
  private readonly patternNote = el<HTMLElement>('<span class="cv-note"></span>');

  constructor(private readonly host: ExtraHost) {
    this.read();
    this.rebuildPresets();
    const row = (id: string, label: string, ...c: HTMLElement[]): void => {
      const r = el<HTMLElement>('<div class="cv-field fm-ex-row"><span></span><div class="fm-ex-ctl"></div></div>');
      setText(q(r, 'span'), label);
      q(r, '.fm-ex-ctl').append(...c);
      this.map.set(id, r);
      this.rows.push(r);
    };
    const head = el<HTMLElement>('<div class="fm-ex-sect">Delivery</div>');
    this.rows.push(head);
    const save = el<HTMLElement>('<div class="fm-ex-pal"></div>');
    save.append(this.presetName, this.presetSave, this.presetDel);
    const lossRow = el<HTMLElement>('<label class="fm-ex-check"><span></span></label>');
    lossRow.prepend(this.lossless);
    setText(q(lossRow, 'span'), 'Lossless');
    row('preset', 'Preset', this.presetSel);
    row('presetsave', 'Your presets', save);
    row('xfps', 'Frame rate', this.fps);
    row('scale', 'Resolution scale', this.scale);
    row('fit', 'Reframe', this.fit);
    row('focusx', 'Focus point, across', this.focusX);
    row('focusy', 'Focus point, down', this.focusY);
    row('wm', 'Watermark', this.wmKind);
    row('wmtext', 'Watermark text', this.wmText);
    row('wmfile', 'Watermark picture', this.wmFile);
    row('wmpos', 'Watermark position', this.wmPos);
    row('wmop', 'Watermark opacity', this.wmOpacity);
    row('wmsize', 'Watermark size', this.wmSize);
    row('lufs', 'Normalize loudness', this.lufs);
    row('rate', 'Rate control', this.rate);
    row('kbps', 'Bitrate (kbps)', this.kbps);
    row('mb', 'File size (MB)', this.mb);
    row('loops', 'Loop count (0 is forever)', this.loops);
    row('lossless', 'Compression', lossRow);
    row('pattern', 'File names', this.pattern, this.patternNote);
    row('estimate', 'Estimated size', this.estimate, this.measure);
    this.paint();

    const changed = (): void => { this.readControls(); this.host.changed(); };
    for (const c of [this.fps, this.scale, this.fit, this.rate, this.kbps, this.mb, this.loops, this.lossless, this.pattern, this.focusX, this.focusY, this.wmKind, this.wmText, this.wmPos, this.wmOpacity, this.wmSize, this.lufs]) {
      c.addEventListener('input', changed);
      c.addEventListener('change', changed);
    }
    this.wmFile.addEventListener('change', () => { void this.loadPicture(); });
    this.measure.addEventListener('click', () => { void this.runMeasure(); });
    this.presetSel.addEventListener('change', () => this.pick(this.presetSel.value));
    this.presetSave.addEventListener('click', () => this.saveUser());
    this.presetDel.addEventListener('click', () => this.deleteUser());
    this.presetName.addEventListener('input', () => setDisabled(this.presetSave, this.presetName.value.trim() === ''));
    this.presetName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (this.presetName.value.trim()) this.saveUser(); } });
  }

  // Persistence ---------------------------------------------------------------------------------

  private read(): void {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { state?: Partial<State>; user?: Preset[] };
      const s = r.state ?? {};
      this.state = {
        preset: typeof s.preset === 'string' ? s.preset : '',
        fps: FPS_CHOICES.includes(Number(s.fps)) ? Number(s.fps) : 0,
        scale: SCALES.includes(Number(s.scale)) ? Number(s.scale) : 100,
        fit: s.fit === 'cover' || s.fit === 'blur' ? s.fit : 'contain',
        fx: num(s.fx, 0, 100, 50), fy: num(s.fy, 0, 100, 50),
        wm: s.wm === 'text' || s.wm === 'image' ? s.wm : 'none',
        wmText: typeof s.wmText === 'string' ? s.wmText.slice(0, 80) : '',
        wmImage: typeof s.wmImage === 'string' && s.wmImage.length < 700_000 ? s.wmImage : '',
        wmPos: s.wmPos === 'tl' || s.wmPos === 'tr' || s.wmPos === 'bl' || s.wmPos === 'c' ? s.wmPos : 'br',
        wmOpacity: num(s.wmOpacity, 5, 100, 70), wmSize: num(s.wmSize, 3, 60, 12),
        lufs: (LUFS_PRESETS as readonly number[]).includes(Number(s.lufs)) ? Number(s.lufs) : 0,
        box: Array.isArray(s.box) && s.box.length === 2 ? [num(s.box[0], 2, 16384, 1920), num(s.box[1], 2, 16384, 1080)] : null,
        longEdge: num(s.longEdge, 0, 16384, 0),
        rate: s.rate === 'bitrate' || s.rate === 'size' ? s.rate : 'quality',
        kbps: num(s.kbps, 50, 400000, DEFAULTS.kbps), mb: num(s.mb, 0.1, 20000, DEFAULTS.mb),
        loops: Math.round(num(s.loops, 0, 65535, 0)), lossless: s.lossless === true,
        pattern: typeof s.pattern === 'string' ? s.pattern.slice(0, 120) : DEFAULT_PATTERN,
      };
      this.user = (Array.isArray(r.user) ? r.user : []).filter((p) => p && typeof p.id === 'string' && typeof p.label === 'string' && p.spec && typeof p.spec === 'object').slice(0, 40);
    } catch { this.state = { ...DEFAULTS }; this.user = []; }
  }

  private write(): void {
    try { localStorage.setItem(KEY, JSON.stringify({ state: this.state, user: this.user })); } catch { /* storage is off */ }
  }

  // Presets -------------------------------------------------------------------------------------

  private rebuildPresets(): void {
    const sel = this.presetSel;
    sel.replaceChildren();
    const add = (value: string, label: string, parent: HTMLElement = sel): void => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = t(label);
      parent.appendChild(o);
    };
    add('', 'Custom');
    for (const p of BUILTIN_PRESETS) add(p.id, p.label);
    if (this.user.length) {
      const g = document.createElement('optgroup');
      g.label = t('Your presets');
      for (const p of this.user) add(p.id, p.label, g);
      sel.appendChild(g);
    }
    sel.value = [...BUILTIN_PRESETS, ...this.user].some((p) => p.id === this.state.preset) ? this.state.preset : '';
  }

  private specOf(id: string): PresetSpec | null {
    return [...BUILTIN_PRESETS, ...this.user].find((p) => p.id === id)?.spec ?? null;
  }

  private pick(id: string): void {
    this.state.preset = id;
    const spec = this.specOf(id);
    if (spec) this.apply(spec);
    this.paint();
    this.host.changed();
  }

  private apply(sp: PresetSpec): void {
    const s = this.state;
    s.box = sp.box ?? null;
    s.longEdge = sp.longEdge ?? 0;
    if (sp.fit) s.fit = sp.fit;
    s.fps = sp.fps ?? 0;
    s.scale = SCALES.includes(sp.scale ?? 100) ? sp.scale ?? 100 : 100;
    s.rate = sp.rate ?? 'quality';
    if (sp.kbps) s.kbps = sp.kbps;
    if (sp.mb) s.mb = sp.mb;
    s.loops = sp.loops ?? 0;
    s.lossless = sp.lossless === true;
    s.pattern = sp.pattern ?? DEFAULT_PATTERN;
    this.host.applyKind({ kind: sp.kind, codec: sp.codec, container: sp.container, quality: sp.quality });
  }

  private saveUser(): void {
    const label = this.presetName.value.trim().slice(0, 40);
    if (!label) return;
    const cur = this.host.current(), s = this.state;
    const spec: PresetSpec = {
      kind: cur.kind as PresetSpec['kind'], codec: cur.codec as PresetSpec['codec'], container: cur.container as PresetSpec['container'], quality: cur.quality,
      fps: s.fps, scale: s.scale, fit: s.fit, rate: s.rate, kbps: s.kbps, mb: s.mb, loops: s.loops, lossless: s.lossless, pattern: s.pattern,
    };
    if (s.box) spec.box = s.box;
    if (s.longEdge) spec.longEdge = s.longEdge;
    const same = this.user.find((p) => p.label.toLowerCase() === label.toLowerCase());
    const id = same?.id ?? `user-${Date.now().toString(36)}`;
    if (same) same.spec = spec; else this.user.push({ id, label, spec });
    s.preset = id;
    this.presetName.value = '';
    setDisabled(this.presetSave, true);
    this.rebuildPresets();
    this.write();
    this.paint();
  }

  private deleteUser(): void {
    const id = this.state.preset;
    this.user = this.user.filter((p) => p.id !== id);
    this.state.preset = '';
    this.rebuildPresets();
    this.write();
    this.paint();
  }

  /** The user changed the resolution by hand: a preset's box no longer rules. */
  clearSize(): void {
    if (!this.state.box && !this.state.longEdge) return;
    this.state.box = null;
    this.state.longEdge = 0;
    this.state.preset = '';
    this.presetSel.value = '';
    this.paint();
  }

  // Controls ------------------------------------------------------------------------------------

  private readControls(): void {
    const s = this.state;
    s.fps = Number(this.fps.value) || 0;
    s.scale = Number(this.scale.value) || 100;
    s.fit = this.fit.value === 'cover' || this.fit.value === 'blur' ? this.fit.value : 'contain';
    s.fx = num(this.focusX.valueAsNumber, 0, 100, s.fx);
    s.fy = num(this.focusY.valueAsNumber, 0, 100, s.fy);
    s.wm = this.wmKind.value === 'text' || this.wmKind.value === 'image' ? this.wmKind.value : 'none';
    s.wmText = this.wmText.value.slice(0, 80);
    s.wmPos = this.wmPos.value as WmPos;
    s.wmOpacity = num(this.wmOpacity.valueAsNumber, 5, 100, s.wmOpacity);
    s.wmSize = num(this.wmSize.valueAsNumber, 3, 60, s.wmSize);
    s.lufs = Number(this.lufs.value) || 0;
    s.rate = this.rate.value as RateMode;
    s.kbps = num(this.kbps.valueAsNumber, 50, 400000, s.kbps);
    s.mb = num(this.mb.valueAsNumber, 0.1, 20000, s.mb);
    s.loops = Math.round(num(this.loops.valueAsNumber, 0, 65535, s.loops));
    s.lossless = this.lossless.checked;
    s.pattern = this.pattern.value.slice(0, 120);
    // an edited control leaves the preset it came from
    if (s.preset) { s.preset = ''; this.presetSel.value = ''; setDisabled(this.presetDel, true); }
    this.write();
  }

  private paint(): void {
    const s = this.state;
    const set = (c: HTMLInputElement | HTMLSelectElement, v: string): void => { if (c.value !== v && document.activeElement !== c) c.value = v; };
    set(this.fps, String(s.fps)); set(this.scale, String(s.scale)); set(this.fit, s.fit); set(this.rate, s.rate); set(this.lufs, String(s.lufs));
    set(this.focusX, String(Math.round(s.fx))); set(this.focusY, String(Math.round(s.fy)));
    set(this.wmKind, s.wm); set(this.wmText, s.wmText); set(this.wmPos, s.wmPos); set(this.wmOpacity, String(s.wmOpacity)); set(this.wmSize, String(s.wmSize));
    set(this.kbps, String(Math.round(s.kbps))); set(this.mb, String(s.mb)); set(this.loops, String(s.loops)); set(this.pattern, s.pattern);
    this.lossless.checked = s.lossless;
    this.presetSel.value = s.preset;
    if (this.presetSel.value !== s.preset) this.presetSel.value = '';
    setDisabled(this.presetDel, !this.user.some((p) => p.id === s.preset));
    setDisabled(this.presetSave, this.presetName.value.trim() === '');
    this.write();
  }

  // Dialog hooks --------------------------------------------------------------------------------

  /** The output size the dialog's resolution gives, after a preset's box or long edge and the scale. */
  size(base: [number, number], video: boolean): [number, number] {
    const s = this.state;
    let [w, h] = base;
    if (s.box) [w, h] = s.box;
    else if (s.longEdge > 0) { const k = Math.min(1, s.longEdge / Math.max(w, h)); w *= k; h *= k; }
    w *= s.scale / 100; h *= s.scale / 100;
    const fix = (n: number): number => (video ? Math.max(2, Math.round(n / 2) * 2) : Math.max(1, Math.round(n)));
    return [fix(w), fix(h)];
  }

  /** Adds the delivery options to what the dialog built. */
  patch(o: ExportOptions, info: ExtraInfo): ExportOptions {
    const s = this.state, out: ExportOptions = { ...o };
    if (s.fps > 0 && info.kind !== 'still' && info.kind !== 'psd') out.fps = s.fps;
    if (s.box || this.reframes(info)) {
      out.fit = s.fit;
      if (s.fit === 'cover' && (s.fx !== 50 || s.fy !== 50)) out.focus = { x: s.fx / 100, y: s.fy / 100 };
    }
    if (info.kind !== 'psd') {
      if (s.wm === 'text' && s.wmText.trim()) out.watermark = { kind: 'text', text: s.wmText.trim(), pos: s.wmPos, opacity: s.wmOpacity / 100, size: s.wmSize / 3 };
      else if (s.wm === 'image' && s.wmImage) out.watermark = { kind: 'image', image: s.wmImage, pos: s.wmPos, opacity: s.wmOpacity / 100, size: s.wmSize };
    }
    if (info.kind === 'video' && this.rateOk(info)) {
      if (s.rate === 'bitrate') out.videoBitrate = Math.round(s.kbps * 1000);
      else if (s.rate === 'size') out.targetBytes = Math.round(s.mb * 1_048_576);
    } else if ((info.kind === 'gif' || info.kind === 'webp-anim' || info.kind === 'apng') && s.rate === 'size') out.targetBytes = Math.round(s.mb * 1_048_576);
    if (s.lufs && o.includeAudio) out.loudness = s.lufs;
    if (info.kind === 'apng' || info.kind === 'webp-anim') out.loops = s.loops;
    if (info.kind === 'webp-anim') out.lossless = s.lossless;
    if (info.kind === 'frames') out.namePattern = s.pattern;
    return out;
  }

  /** The output has another shape than the movie, so bars, a crop or a blurred fill is needed. */
  private reframes(info: ExtraInfo): boolean {
    return !!info.aspect && info.width > 0 && info.height > 0 && Math.abs(info.width / info.height - info.aspect) > 0.005;
  }

  /** The preview was dragged: the crop focus moves (percent of the movie frame). */
  setFocus(x: number, y: number): void {
    this.state.fx = Math.min(100, Math.max(0, x * 100));
    this.state.fy = Math.min(100, Math.max(0, y * 100));
    if (this.state.preset) { this.state.preset = ''; this.presetSel.value = ''; }
    this.paint();
  }

  /** Reads a watermark picture, shrinks it (at most 512 px) and keeps it as a data URL. */
  private async loadPicture(): Promise<void> {
    const f = this.wmFile.files?.[0];
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
      const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
      (c.getContext('2d') as OffscreenCanvasRenderingContext2D).drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const blob = await c.convertToBlob({ type: 'image/png' });
      const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
      this.state.wmImage = url;
      this.state.wm = 'image';
      this.paint();
      this.host.changed();
    } catch { /* an unreadable picture: the watermark stays as it was */ }
  }

  /** The last measured size and the settings it was measured for (it only shows while they still match). */
  private measured: { bytes: number; key: string } | null = null;
  private measuring = false;

  private async runMeasure(): Promise<void> {
    if (!this.host.measure || this.measuring) return;
    this.measuring = true;
    setText(this.measure, 'Measuring');
    setDisabled(this.measure, true);
    try {
      this.measured = await this.host.measure();
    } catch { this.measured = null; }
    this.measuring = false;
    setText(this.measure, 'Measure');
    setDisabled(this.measure, false);
    this.host.changed();
  }

  /** Bitrate control reaches only the codecs the window encodes itself. */
  private rateOk(info: ExtraInfo): boolean {
    // HEVC and ProRes are encoded by the engine's ffmpeg: two passes for a software HEVC, a profile pick for ProRes
    return info.kind === 'video' && (info.codec === 'h264' || info.codec === 'vp9' || info.codec === 'hevc' || info.codec === 'prores');
  }

  /** Shows the rows that fit the format and fills the size estimate (patched in place). */
  sync(info: ExtraInfo, key = ''): void {
    const s = this.state;
    const show = (id: string, on: boolean): void => { const r = this.map.get(id); if (r) setHidden(r, !on); };
    const anim = info.kind === 'gif' || info.kind === 'webp-anim' || info.kind === 'apng';
    const timed = info.kind === 'video' || anim || info.kind === 'frames';
    show('xfps', timed);
    show('lufs', info.kind === 'video');
    const re = s.box !== null || this.reframes(info);
    show('fit', re);
    show('focusx', re && s.fit === 'cover');
    show('focusy', re && s.fit === 'cover');
    const wmOn = info.kind !== 'psd';
    show('wm', wmOn);
    show('wmtext', wmOn && s.wm === 'text');
    show('wmfile', wmOn && s.wm === 'image');
    show('wmpos', wmOn && s.wm !== 'none');
    show('wmop', wmOn && s.wm !== 'none');
    show('wmsize', wmOn && s.wm !== 'none');
    setHidden(this.measure, !this.host.measure || info.kind === 'psd' || info.kind === 'still');
    const canRate = this.rateOk(info) || anim;
    show('rate', canRate);
    const opt = (v: string, on: boolean): void => { const o = Array.from(this.rate.options).find((x) => x.value === v); if (o && o.hidden !== !on) { o.hidden = !on; o.disabled = !on; } };
    opt('bitrate', info.kind === 'video');
    // the saved mode is kept for when a format that has rate control returns
    const mode = canRate ? (anim && s.rate === 'bitrate' ? 'quality' : s.rate) : 'quality';
    show('kbps', canRate && mode === 'bitrate');
    show('mb', canRate && mode === 'size');
    show('loops', info.kind === 'apng' || info.kind === 'webp-anim');
    show('lossless', info.kind === 'webp-anim');
    show('pattern', info.kind === 'frames');
    if (info.kind === 'frames') setText(this.patternNote, `{name} {n} {f} {tc}  →  ${t('for example')} ${(this.state.pattern || DEFAULT_PATTERN).replace('{name}', 'Movie').replace('{n}', '00001').replace('{f}', '00000').replace('{tc}', '00-00-01-12')}.png`);
    const rate = outFps({ fps: s.fps > 0 && info.kind !== 'still' && info.kind !== 'psd' ? s.fps : undefined }, info.movieFps);
    const steps = info.kind === 'still' || info.kind === 'psd' ? 1 : Math.max(1, Math.round((info.baseSteps * rate) / info.movieFps));
    const bytes = estimateBytes({
      kind: info.kind, width: info.width, height: info.height, steps, fps: rate, audio: info.audio, quality: info.quality, alpha: info.alpha, picture: info.picture,
      rate: this.rateOk(info) ? { mode, kbps: s.kbps, mb: s.mb } : undefined,
      layers: info.layers, lossless: s.lossless, prores: info.kind === 'video' && info.codec === 'prores',
    });
    const limit = canRate && mode === 'size' ? s.mb * 1_048_576 : 0;
    const m = this.measured && this.measured.key === key && key !== '' ? this.measured : null;
    const text = limit ? `${t('Aims for')} ${formatBytes(limit)} · ${steps} ${t('frames')}` : m ? `${t('Measured about')} ${formatBytes(m.bytes)} · ${steps} ${steps === 1 ? t('frame') : t('frames')}` : `${t('About')} ${formatBytes(bytes)} · ${steps} ${steps === 1 ? t('frame') : t('frames')}${info.kind === 'psd' ? ` · ${info.layers} ${t('layers')}` : ''}`;
    const viaEngine = canRate && mode !== 'quality' && info.kind === 'video' && (info.codec === 'hevc' || info.codec === 'prores');
    setText(this.estimate, viaEngine ? `${text} · ${t(info.codec === 'prores' ? 'ProRes picks the nearest profile, by the engine ffmpeg' : 'Two passes by the engine ffmpeg')}` : text);
    setClass(this.estimate, 'is-estimate', true);
  }
}
