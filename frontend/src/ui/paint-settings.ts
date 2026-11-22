import type { OnionSettings } from '../engine/types';
import type { CursorMode, OutlineStyle, PenButton, ScalingMode } from '../paint/feel';
import { loadPrefs, updatePrefs } from './prefs';
import { ColourPanel } from './colour-panel';
import { brushStore } from './brush-store';
import '../styles/w16-panels.css';
import { el, q, setChecked, setClass, setDisabled, setHidden, setStyleVar, setText } from './dom';

export interface PaintPrefs {
  /** Kept in step with cursorMode (false when the mode is off) for older readers. */
  cursor: boolean;
  /** Kept in step with scaling (true for screen). */
  dynamicScaling: boolean;
  cursorMode: CursorMode;
  outline: OutlineStyle;
  scaling: ScalingMode;
  motionFilter: boolean;
  expression: number;
  penButton: PenButton;
  /** The pen's eraser end erases. */
  eraserEnd: boolean;
  sidebarRight: boolean;
  fingerPaints: boolean;
  pressure: [number, number][];
  smoothing: number;
  maskVisibility: number;
  /** Rapid undo delay: ms a held undo or redo waits before it repeats. */
  undoDelay: number;
  /** Show the picture with its keyframed opacity and filters at the Playhead while drawing. */
  keyframeEffects: boolean;
  /** Hide the Undo and Redo buttons on the sidebar (the gestures and keys still work). */
  hideUndoButtons: boolean;
  /** Hide the Eyedropper and Fill buttons on the top bar (the keys I and G and the Alt hold still work). */
  hideToolExtras?: boolean;
  /** Hold at the end of a stroke to snap it to a shape: for a pen only, for pen and mouse, or never. */
  quickShape: 'pen' | 'all' | 'off';
  /** Hold still after pressing to pick a color with the loupe: touch only, any pointer, or never. */
  holdPick: 'touch' | 'all' | 'off';
  /** The person picked the hold-to-pick choice themselves; until then every older stored 'touch' follows the default. */
  holdPickChosen?: boolean;
}

export const DEFAULT_PAINT_PREFS: PaintPrefs = {
  cursor: true,
  dynamicScaling: false,
  cursorMode: 'both',
  // the hover cursor shows the brush's own tip (shape, lean, roll) unless the person picks a plain outline
  outline: 'brush',
  scaling: 'off',
  motionFilter: false,
  expression: 0.5,
  penButton: 'cycle',
  eraserEnd: true,
  sidebarRight: false,
  fingerPaints: true,
  pressure: [[0, 0], [1, 1]],
  smoothing: 0,
  maskVisibility: 0.25,
  undoDelay: 420,
  keyframeEffects: false,
  hideUndoButtons: false,
  quickShape: 'pen',
  holdPick: 'all',
};

const KEY = 'formmorpheus.paint';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function validCurve(v: unknown): v is [number, number][] {
  if (!Array.isArray(v) || v.length < 2) return false;
  let px = -1;
  for (const p of v) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return false;
    if (!(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1) || p[0] < px) return false;
    px = p[0];
  }
  return v[0][0] === 0 && v[v.length - 1][0] === 1;
}

export function loadPaintPrefs(): PaintPrefs {
  const out: PaintPrefs = { ...DEFAULT_PAINT_PREFS, pressure: DEFAULT_PAINT_PREFS.pressure.map((p) => [...p] as [number, number]) };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return out;
    const o = JSON.parse(raw) as Partial<PaintPrefs>;
    for (const k of ['cursor', 'dynamicScaling', 'sidebarRight', 'fingerPaints', 'motionFilter', 'eraserEnd', 'keyframeEffects', 'hideUndoButtons', 'hideToolExtras'] as const) if (typeof o[k] === 'boolean') out[k] = o[k];
    // older files only had the two booleans: they decide the new choices
    out.cursorMode = o.cursorMode && ['hover', 'painting', 'both', 'off'].includes(o.cursorMode) ? o.cursorMode : out.cursor ? 'both' : 'off';
    out.scaling = o.scaling && ['off', 'canvas', 'screen'].includes(o.scaling) ? o.scaling : out.dynamicScaling ? 'screen' : 'off';
    if (o.outline && ['contrast', 'colour', 'brush'].includes(o.outline)) out.outline = o.outline;
    if (o.penButton && ['cycle', 'eyedropper', 'off'].includes(o.penButton)) out.penButton = o.penButton;
    if (o.quickShape && ['pen', 'all', 'off'].includes(o.quickShape)) out.quickShape = o.quickShape;
    // 'touch' saved by an older build was the default, not a choice: it follows the new default (pen and mouse too)
    if (o.holdPick && ['touch', 'all', 'off'].includes(o.holdPick) && (o.holdPick !== 'touch' || o.holdPickChosen === true)) out.holdPick = o.holdPick;
    if (o.holdPickChosen === true) out.holdPickChosen = true;
    out.cursor = out.cursorMode !== 'off';
    out.dynamicScaling = out.scaling !== 'off';
    for (const k of ['smoothing', 'maskVisibility', 'expression'] as const) if (typeof o[k] === 'number' && Number.isFinite(o[k])) out[k] = clamp01(o[k]);
    if (typeof o.undoDelay === 'number' && Number.isFinite(o.undoDelay)) out.undoDelay = Math.min(1000, Math.max(150, o.undoDelay));
    if (validCurve(o.pressure)) out.pressure = o.pressure.map((p) => [p[0], p[1]] as [number, number]);
  } catch { /* storage unavailable or corrupt: defaults */ }
  return out;
}

export function savePaintPrefs(p: PaintPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked: the settings last this session */ }
}

/** Monotone cubic (Fritsch-Carlson) through the points, clamped 0..1. */
export function pressureCurve(points: [number, number][]): (x: number) => number {
  const n = points.length;
  if (n < 2) return (x) => clamp01(x);
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return clamp01(ys[0]);
    if (x >= xs[n - 1]) return clamp01(ys[n - 1]);
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    const v = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    return clamp01(v);
  };
}

type Tab = 'add' | 'canvas' | 'onions' | 'prefs';
let lastTab: Tab = 'add';

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const TAB_ICONS: Record<Tab, string> = {
  add: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10.5" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 16"/>'),
  canvas: svg('<path d="M7 3v14h14"/><path d="M3 7h14v14"/>'),
  onions: svg('<rect x="3" y="7" width="12" height="12" rx="2"/><path d="M9 4h10a2 2 0 0 1 2 2v10" opacity=".6"/>'),
  prefs: svg('<path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/>'),
};
const TAB_LABELS: Record<Tab, string> = { add: 'Add', canvas: 'Canvas', onions: 'Onions', prefs: 'Prefs' };
const TABS: Tab[] = ['add', 'canvas', 'onions', 'prefs'];

const ROW_ICONS = {
  photo: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10.5" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 16"/>'),
  crop: svg('<path d="M7 3v13a1 1 0 0 0 1 1h13"/><path d="M3 7h13a1 1 0 0 1 1 1v13"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  folder: svg('<path d="M3.5 7.5a2 2 0 0 1 2-2H9l2 2.2h7.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
};

const TOGGLE_TRACK = '<span class="cv-toggle-track"><span class="cv-toggle-knob"></span></span>';

interface ToggleRow { el: HTMLElement; input: HTMLInputElement; set(on: boolean): void; setDisabled(on: boolean): void }
function toggleRow(label: string, onChange: (on: boolean) => void): ToggleRow {
  const node = el(`<label class="fm-ps-row fm-ps-toggle"><span class="fm-ps-label"></span><span class="cv-toggle"><input type="checkbox">${TOGGLE_TRACK}</span></label>`);
  setText(q(node, '.fm-ps-label'), label);
  const input = q<HTMLInputElement>(node, 'input');
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => onChange(input.checked));
  return { el: node, input, set: (on) => setChecked(input, on), setDisabled: (on) => { setDisabled(input, on); setClass(node, 'is-disabled', on); } };
}

interface SliderRow { el: HTMLElement; set(v: number, text: string): void }
function sliderRow(label: string, min: number, max: number, step: number, onInput: (v: number) => void): SliderRow {
  const node = el(`<div class="fm-ps-row fm-ps-slider"><div class="fm-ps-head"><span class="fm-ps-label"></span><span class="fm-ps-val"></span></div><input class="fm-cm-range" type="range" min="${min}" max="${max}" step="${step}"></div>`);
  setText(q(node, '.fm-ps-label'), label);
  const val = q(node, '.fm-ps-val');
  const range = q<HTMLInputElement>(node, 'input');
  range.setAttribute('aria-label', label);
  const fill = (): void => setStyleVar(range, '--fm-pct', `${((range.valueAsNumber - min) / (max - min)) * 100}%`);
  range.addEventListener('input', () => { fill(); onInput(range.valueAsNumber); });
  return {
    el: node,
    set: (v, text) => {
      if (document.activeElement !== range && range.valueAsNumber !== v) range.value = String(v);
      fill();
      setText(val, text);
    },
  };
}

interface Seg { el: HTMLElement; set(i: number): void }
function segmented(labels: string[], onPick: (i: number) => void): Seg {
  const node = el(`<div class="fm-ps-seg" role="group" style="--n:${labels.length}">${labels.map((l) => `<button type="button" class="fm-ps-segbtn">${l}</button>`).join('')}</div>`);
  const btns = Array.from(node.querySelectorAll<HTMLButtonElement>('button'));
  btns.forEach((b, i) => b.addEventListener('click', () => onPick(i)));
  return { el: node, set: (i) => btns.forEach((b, j) => setClass(b, 'is-active', i === j)) };
}

function actionRow(iconSvg: string, label: string, onClick: () => void, chevron = false): { el: HTMLButtonElement; setDisabled(on: boolean): void } {
  const node = el<HTMLButtonElement>(`<button type="button" class="fm-ps-row fm-ps-action"><span class="fm-ps-ico">${iconSvg}</span><span class="fm-ps-label"></span>${chevron ? `<span class="fm-ps-chev">${ROW_ICONS.chevron}</span>` : ''}</button>`);
  setText(q(node, '.fm-ps-label'), label);
  node.addEventListener('click', () => { if (!node.classList.contains('is-disabled')) onClick(); });
  return { el: node, setDisabled: (on) => { setClass(node, 'is-disabled', on); node.tabIndex = on ? -1 : 0; } };
}

const CURVE = 160, PAD = 8, MAX_POINTS = 8, MIN_GAP = 0.02;

export interface PaintSettingsOptions {
  prefs: () => PaintPrefs;
  setPrefs: (p: Partial<PaintPrefs>) => void;
  onion: () => OnionSettings;
  setOnion: (p: Partial<OnionSettings>, merge?: string) => void;
  onionScope: () => 'flipbook' | 'movie' | null;
  setOnionScope?: (scope: 'flipbook' | 'movie') => void;
  onInsertPhoto: () => void;
  onInsertFile?: () => void;
  onCropResize?: () => void;
}

export class PaintSettings {
  readonly root: HTMLElement;
  private opened = false;
  private tab: Tab = lastTab;
  private side: 'back' | 'fore' = 'back';
  private readonly tabBtns = new Map<Tab, HTMLButtonElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  private anchor: HTMLElement | null = null;

  private readonly mask: SliderRow;
  private readonly keyEffects: ToggleRow;
  private readonly scrubSpeed: Seg;
  private readonly onEnabled: ToggleRow;
  private readonly sideSeg: Seg;
  private readonly frames: SliderRow;
  private readonly opacity: SliderRow;
  private readonly tint: ToggleRow;
  private readonly colorBar: HTMLElement;
  private readonly colorInput: HTMLButtonElement;
  private tintPanel: ColourPanel | null = null;
  private readonly blend: ToggleRow;
  private readonly scrubShow: ToggleRow;
  private readonly scopeSeg: Seg | null = null;
  private readonly scopeWrap: HTMLElement;
  private readonly crop: { setDisabled(on: boolean): void };
  private readonly cursor: Seg;
  private readonly outline: Seg;
  private readonly dyn: Seg;
  private readonly cursor2: Seg;
  private readonly outline2: Seg;
  private readonly cursorSheet: HTMLElement;
  private readonly advRow: HTMLElement;
  private readonly dynTog: ToggleRow;
  private readonly dynRow: HTMLElement;
  private lastScl: ScalingMode = 'screen';
  private readonly motion: ToggleRow;
  private readonly expr: SliderRow;
  private readonly penBtn: Seg;
  private readonly eraser: ToggleRow;
  private readonly quick: Seg;
  private readonly holdPickSeg: Seg;
  private readonly finger: ToggleRow;
  private readonly sideBar: Seg;
  private readonly smooth: SliderRow;
  private readonly undoDelay: SliderRow;
  private readonly hideUndo: ToggleRow;
  private readonly hideExtras: ToggleRow;
  private readonly curveRow: HTMLElement;
  private readonly curveWrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private curveOpen = false;
  private dragIdx = -1;
  private pts: [number, number][] = [];
  private folderNote!: HTMLElement;
  private moreFade: () => void = () => undefined;

  private async showBrushFolder(): Promise<void> {
    const dir = brushStore.folder();
    const say = (s: string): void => { setText(this.folderNote, s); setHidden(this.folderNote, !s); };
    if (!dir) { say('The brush folder is not available yet'); return; }
    if ('__TAURI_INTERNALS__' in window) {
      try {
        const core = await import('@tauri-apps/api/core');
        await core.invoke('reveal_folder', { path: dir });
        say('');
        return;
      } catch { /* the shell refused the folder: the path is shown instead */ }
    }
    say(dir);
  }

  private readonly down = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (!t || this.root.contains(t) || this.anchor?.contains(t) || this.tintPanel?.root.contains(t)) return;
    this.close();
  };
  private readonly key = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  constructor(private readonly o: PaintSettingsOptions) {
    this.root = el(
      `<div class="fm-ps" role="dialog" aria-label="Settings" hidden><div class="fm-ps-title">Settings</div>` +
      `<div class="fm-ps-tabs" role="tablist"></div><div class="fm-ps-panes"></div></div>`);
    this.root.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    const tabs = q(this.root, '.fm-ps-tabs'), panes = q(this.root, '.fm-ps-panes');
    for (const t of TABS) {
      const b = el<HTMLButtonElement>(`<button type="button" class="fm-ps-tab" role="tab" data-tab="${t}">${TAB_ICONS[t]}<span>${TAB_LABELS[t]}</span></button>`);
      b.addEventListener('click', () => this.showTab(t));
      tabs.appendChild(b);
      this.tabBtns.set(t, b);
      const p = el(`<div class="fm-ps-pane" role="tabpanel" data-pane="${t}" hidden></div>`);
      panes.appendChild(p);
      this.panes.set(t, p);
    }

    // Add
    const add = this.panes.get('add')!;
    add.appendChild(actionRow(ROW_ICONS.photo, 'Insert photos', () => { this.close(); o.onInsertPhoto(); }).el);
    add.appendChild(actionRow(ROW_ICONS.photo, 'Insert a file', () => { this.close(); o.onInsertFile?.(); }).el);

    // Canvas
    const canvasPane = this.panes.get('canvas')!;
    const crop = actionRow(ROW_ICONS.crop, 'Crop and resize', () => { this.close(); o.onCropResize?.(); });
    this.crop = crop;
    canvasPane.appendChild(crop.el);
    this.mask = sliderRow('Selection mask visibility', 0, 1, 0.01, (v) => o.setPrefs({ maskVisibility: v }));
    canvasPane.appendChild(this.mask.el);
    this.keyEffects = toggleRow('Keyframe effects', (v) => o.setPrefs({ keyframeEffects: v }));
    canvasPane.appendChild(this.keyEffects.el);

    // Onions
    const on = this.panes.get('onions')!;
    this.onEnabled = toggleRow('Onion skin visibility', (v) => o.setOnion({ enabled: v }));
    this.sideSeg = segmented(['Backwards', 'Forwards'], (i) => { this.side = i === 0 ? 'back' : 'fore'; this.refresh(); });
    this.frames = sliderRow('Frames', 0, 12, 1, (v) => o.setOnion(this.side === 'back' ? { backFrames: v } : { foreFrames: v }, `onion-frames-${this.side}`));
    this.opacity = sliderRow('Opacity', 0, 1, 0.01, (v) => o.setOnion(this.side === 'back' ? { backOpacity: v } : { foreOpacity: v }, `onion-opacity-${this.side}`));
    this.tint = toggleRow('Color tint', (v) => o.setOnion(this.side === 'back' ? { backTint: v } : { foreTint: v }));
    this.colorBar = el('<div class="fm-ps-colorbar"><button type="button" aria-label="Onion tint color"></button></div>');
    this.colorInput = q<HTMLButtonElement>(this.colorBar, 'button');
    // the app's own Color disc, opened beside the Settings card
    this.colorInput.addEventListener('click', () => {
      if (this.tintPanel?.isOpen()) { this.tintPanel.close(); return; }
      if (!this.tintPanel) {
        this.tintPanel = new ColourPanel({
          keepColours: true,
          onPick: (c, final) => {
            const h = '#' + [c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, '0')).join('');
            this.o.setOnion(this.side === 'back' ? { backColor: h } : { foreColor: h }, `onion-color-${this.side}`);
            if (final) this.tintPanel?.commit(c);
          },
        });
        (document.getElementById('overlay-root') ?? document.body).appendChild(this.tintPanel.root);
      }
      const on = this.o.onion(), col = (this.side === 'back' ? on.backColor : on.foreColor) ?? '#2f6bf0';
      const n = parseInt(col.replace('#', '').slice(0, 6), 16) || 0;
      this.tintPanel.set({ r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 });
      this.tintPanel.open(this.colorBar);
      const r = this.root.getBoundingClientRect(), w = this.tintPanel.root.offsetWidth || 280;
      const left = r.right + 8 + w <= window.innerWidth - 8 ? r.right + 8 : Math.max(8, r.left - w - 8);
      this.tintPanel.root.style.left = `${Math.round(left)}px`;
      this.tintPanel.root.style.top = `${Math.max(8, Math.round(r.top))}px`;
    });
    this.blend = toggleRow('Blend primary frame', (v) => o.setOnion({ blendPrimary: v }));
    this.scrubShow = toggleRow('Show while scrubbing', (v) => o.setOnion({ showWhileScrubbing: v }));
    this.scopeWrap = el('<div class="fm-ps-scope"></div>');
    if (o.setOnionScope) {
      const seg = segmented(['This flipbook', 'Whole movie'], (i) => o.setOnionScope?.(i === 0 ? 'flipbook' : 'movie'));
      this.scopeSeg = seg;
      this.scopeWrap.appendChild(seg.el);
    }
    on.append(this.onEnabled.el, this.sideSeg.el, this.frames.el, this.opacity.el, this.tint.el, this.colorBar, this.blend.el, this.scrubShow.el, this.scopeWrap);
    setHidden(this.scopeWrap, !o.setOnionScope);

    // Prefs
    const pr = this.panes.get('prefs')!;
    const CUR: CursorMode[] = ['hover', 'painting', 'both', 'off'], OUT: OutlineStyle[] = ['contrast', 'colour', 'brush'];
    const SCL: ScalingMode[] = ['off', 'canvas', 'screen'], PEN: PenButton[] = ['cycle', 'eyedropper', 'off'];
    const seg = (label: string, labels: string[], onPick: (i: number) => void): { row: HTMLElement; seg: Seg } => {
      const row = el('<div class="fm-ps-row fm-ps-sidebar"><span class="fm-ps-label"></span></div>');
      setText(q(row, '.fm-ps-label'), label);
      const s = segmented(labels, onPick);
      row.appendChild(s.el);
      return { row, seg: s };
    };
    const cur = seg('Brush cursor', ['Hover', 'Painting', 'Both', 'Off'], (i) => o.setPrefs({ cursorMode: CUR[i], cursor: CUR[i] !== 'off' }));
    this.cursor = cur.seg;
    const out = seg('Cursor outline', ['High contrast', 'Color', 'Brush'], (i) => o.setPrefs({ outline: OUT[i] }));
    this.outline = out.seg;
    // v0.17.0: "Advanced cursor settings" opens a second sheet beside the popover that repeats the two cursor options
    const cur2 = seg('Brush cursor', ['Hover', 'Painting', 'Both', 'Off'], (i) => o.setPrefs({ cursorMode: CUR[i], cursor: CUR[i] !== 'off' }));
    const out2 = seg('Cursor outline', ['High contrast', 'Color', 'Brush'], (i) => o.setPrefs({ outline: OUT[i] }));
    this.cursor2 = cur2.seg;
    this.outline2 = out2.seg;
    this.cursorSheet = el('<div class="fm-ps-sheet" hidden><div class="fm-ps-sheet-head"><button type="button" class="fm-ps-sheet-back" aria-label="Back"></button><span class="fm-ps-sheet-title"></span></div></div>');
    setText(q(this.cursorSheet, '.fm-ps-sheet-title'), 'Advanced cursor settings');
    setText(q(this.cursorSheet, '.fm-ps-sheet-back'), 'Done');
    this.cursorSheet.append(cur2.row, out2.row);
    this.root.appendChild(this.cursorSheet);
    q(this.cursorSheet, '.fm-ps-sheet-back').addEventListener('click', () => setHidden(this.cursorSheet, true));
    const adv = actionRow('', 'Advanced cursor settings', () => { setHidden(this.cursorSheet, !this.cursorSheet.hidden); }, true);
    q(adv.el, '.fm-ps-ico').remove();
    this.advRow = adv.el;
    // 'off' keeps one size in canvas pixels; canvas and screen follow the picture's size or the zoom
    // v0.17.0: a toggle plus a "Brush scaling" submenu row that shows while it is on
    this.dynTog = toggleRow('Dynamic brush scaling', (v) => {
      const m: ScalingMode = v ? (this.lastScl === 'off' ? 'screen' : this.lastScl) : 'off';
      o.setPrefs({ scaling: m, dynamicScaling: v });
      this.refresh();
    });
    this.dynTog.el.title = 'Off: one size in canvas pixels. On: the brush follows the zoom or the canvas size, see Brush scaling.';
    const scl = seg('Brush scaling', ['Canvas', 'Screen'], (i) => {
      this.lastScl = SCL[i + 1];
      o.setPrefs({ scaling: SCL[i + 1], dynamicScaling: true });
    });
    scl.row.title = 'Canvas: relative to the canvas size. Screen: the same size on the screen at any zoom.';
    this.dyn = scl.seg;
    this.dynRow = scl.row;
    this.motion = toggleRow('Motion filtering', (v) => o.setPrefs({ motionFilter: v }));
    this.expr = sliderRow('Expression', 0, 1, 0.01, (v) => o.setPrefs({ expression: v }));
    const pen = seg('Pen button', ['Cycle tool', 'Eyedropper', 'Off'], (i) => o.setPrefs({ penButton: PEN[i] }));
    this.penBtn = pen.seg;
    this.eraser = toggleRow('Pen eraser end erases', (v) => o.setPrefs({ eraserEnd: v }));
    const QS = ['pen', 'all', 'off'] as const, HP = ['touch', 'all', 'off'] as const;
    const qs = seg('QuickShape (hold to snap)', ['Pen', 'Pen and mouse', 'Off'], (i) => o.setPrefs({ quickShape: QS[i] }));
    this.quick = qs.seg;
    const hp = seg('Hold to pick a color', ['Touch', 'All', 'Off'], (i) => o.setPrefs({ holdPick: HP[i], holdPickChosen: true }));
    hp.row.title = 'Press and hold still on the picture to open the color loupe. Touch: fingers only. All: pen and mouse too.';
    this.holdPickSeg = hp.seg;
    this.finger = toggleRow('Paint with finger', (v) => o.setPrefs({ fingerPaints: v }));
    const sideRow = el('<div class="fm-ps-row fm-ps-sidebar"><span class="fm-ps-label">Size and opacity sidebar</span></div>');
    this.sideBar = segmented(['Left', 'Right'], (i) => o.setPrefs({ sidebarRight: i === 1 }));
    sideRow.appendChild(this.sideBar.el);
    this.smooth = sliderRow('Stabilization', 0, 1, 0.01, (v) => o.setPrefs({ smoothing: v }));
    this.undoDelay = sliderRow('Rapid undo delay', 150, 1000, 10, (v) => o.setPrefs({ undoDelay: v }));
    this.hideUndo = toggleRow('Hide Undo and Redo buttons', (v) => o.setPrefs({ hideUndoButtons: v }));
    this.hideExtras = toggleRow('Hide Eyedropper and Fill buttons', (v) => o.setPrefs({ hideToolExtras: v }));
    const pressure = actionRow('', 'Pressure', () => this.toggleCurve(), true);
    this.curveRow = pressure.el;
    q(this.curveRow, '.fm-ps-ico').remove();
    this.curveWrap = el(
      `<div class="fm-ps-curve" hidden><canvas width="${CURVE}" height="${CURVE}" aria-label="Pressure curve"></canvas>` +
      `<div class="fm-ps-curvebar"><span class="fm-ps-hint">Double-click adds a point. Drag one off the graph to remove it.</span><button type="button" class="fm-ps-reset">Reset</button></div></div>`);
    this.canvas = q<HTMLCanvasElement>(this.curveWrap, 'canvas');
    this.ctx = this.canvas.getContext('2d');
    this.initCanvas();
    q(this.curveWrap, '.fm-ps-reset').addEventListener('click', () => {
      this.pts = DEFAULT_PAINT_PREFS.pressure.map((p) => [...p] as [number, number]);
      this.commitCurve();
    });
    const SPD = ['precise', 'medium', 'fast'] as const;
    const spd = seg('Scrub speed', ['Precise', 'Medium', 'Fast'], (i) => { updatePrefs({ scrubSpeed: SPD[i] }); this.refresh(); });
    this.scrubSpeed = spd.seg;
    // Brush folder (desktop: opens it in the file browser; the browser build shows where it is)
    const folder = actionRow(ROW_ICONS.folder, 'Brush folder', () => this.showBrushFolder(), true);
    this.folderNote = el('<div class="fm-ps-folder-note" hidden></div>');
    const sect = (text: string): HTMLElement => { const h = el('<div class="fm-ps-sect"></div>'); setText(h, text); return h; };
    // the reference's order first (cursor, outline, Pressure, smoothing, scaling, sidebar, finger, scrub speed),
    // then the desktop pen and input rows under their own headings
    pr.append(cur.row, out.row, this.advRow, this.curveRow, this.curveWrap, this.smooth.el, this.dynTog.el, scl.row, sideRow, this.finger.el, spd.row,
      sect('Pen and input'), this.eraser.el, pen.row, qs.row, hp.row, this.motion.el, this.expr.el, this.undoDelay.el, this.hideUndo.el, this.hideExtras.el,
      sect('Files'), folder.el, this.folderNote);
    // the panel has no scrollbar (a house rule): a fade at the foot says there is more below
    const more = (): void => { const p = this.panes.get('prefs'); if (p) setClass(p, 'is-more', p.scrollTop + p.clientHeight < p.scrollHeight - 6); };
    this.panes.get('prefs')?.addEventListener('scroll', more, { passive: true });
    this.moreFade = more;

    this.showTab(this.tab, true);
  }

  isOpen(): boolean { return this.opened; }

  open(anchor: HTMLElement, tab?: Tab): void {
    this.anchor = anchor;
    const parent = anchor.offsetParent ?? document.body;
    if (this.root.parentElement !== parent) parent.appendChild(this.root);
    this.refresh();
    this.showTab(tab ?? this.tab, true);
    this.root.hidden = false;
    const a = anchor.getBoundingClientRect();
    const pr = parent === document.body ? { left: 0, top: 0, width: window.innerWidth } : parent.getBoundingClientRect();
    const w = this.root.offsetWidth;
    const left = Math.max(8, Math.min(a.left - pr.left, pr.width - w - 8));
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(a.bottom - pr.top + 6)}px`;
    setClass(this.cursorSheet, 'is-left', left + w * 2 + 16 > pr.width);
    if (!this.opened) {
      this.opened = true;
      document.addEventListener('pointerdown', this.down, true);
      document.addEventListener('keydown', this.key, true);
    }
    this.drawCurve();
    this.moreFade();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.hidden = true;
    setHidden(this.cursorSheet, true);
    this.anchor = null;
    this.tintPanel?.close(true);
    document.removeEventListener('pointerdown', this.down, true);
    document.removeEventListener('keydown', this.key, true);
    this.dragIdx = -1;
  }

  refresh(): void {
    const p = this.o.prefs(), on = this.o.onion(), scope = this.o.onionScope();
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    this.mask.set(p.maskVisibility, pct(p.maskVisibility));
    this.keyEffects.set(p.keyframeEffects);
    this.scrubSpeed.set(['precise', 'medium', 'fast'].indexOf(loadPrefs().scrubSpeed));
    this.cursor.set(['hover', 'painting', 'both', 'off'].indexOf(p.cursorMode));
    this.outline.set(['contrast', 'colour', 'brush'].indexOf(p.outline));
    this.cursor2.set(['hover', 'painting', 'both', 'off'].indexOf(p.cursorMode));
    this.outline2.set(['contrast', 'colour', 'brush'].indexOf(p.outline));
    if (p.scaling !== 'off') this.lastScl = p.scaling;
    this.dynTog.set(p.scaling !== 'off');
    setHidden(this.dynRow, p.scaling === 'off');
    this.dyn.set(p.scaling === 'canvas' ? 0 : 1);
    this.motion.set(p.motionFilter);
    this.expr.set(p.expression, pct(p.expression));
    this.expr.el.classList.toggle('is-disabled', !p.motionFilter);
    this.penBtn.set(['cycle', 'eyedropper', 'off'].indexOf(p.penButton));
    this.eraser.set(p.eraserEnd);
    this.quick.set(['pen', 'all', 'off'].indexOf(p.quickShape));
    this.holdPickSeg.set(['touch', 'all', 'off'].indexOf(p.holdPick));
    this.finger.set(p.fingerPaints);
    this.sideBar.set(p.sidebarRight ? 1 : 0);
    this.smooth.set(p.smoothing, pct(p.smoothing));
    this.undoDelay.set(p.undoDelay, `${Math.round(p.undoDelay)} ms`);
    this.hideUndo.set(p.hideUndoButtons);
    this.hideExtras.set(!!p.hideToolExtras);
    if (this.dragIdx < 0) this.pts = p.pressure.map((pt) => [pt[0], pt[1]] as [number, number]);
    setClass(this.curveRow, 'is-open', this.curveOpen);
    setHidden(this.curveWrap, !this.curveOpen);

    const onionsOff = scope === null;
    const onionBtn = this.tabBtns.get('onions')!;
    setClass(onionBtn, 'is-disabled', onionsOff);
    onionBtn.tabIndex = onionsOff ? -1 : 0;
    if (onionsOff && this.tab === 'onions') this.showTab('add', true);
    this.onEnabled.set(on.enabled);
    this.sideSeg.set(this.side === 'back' ? 0 : 1);
    const n = this.side === 'back' ? on.backFrames : on.foreFrames;
    this.frames.set(n, String(n));
    const op = (this.side === 'back' ? on.backOpacity : on.foreOpacity) ?? on.opacity;
    const tn = (this.side === 'back' ? on.backTint : on.foreTint) ?? on.tint;
    this.opacity.set(op, pct(op));
    this.tint.set(tn);
    const col = this.side === 'back' ? on.backColor : on.foreColor;
    setStyleVar(this.colorBar, '--c', col);
    setClass(this.colorBar, 'is-disabled', !tn);
    this.blend.set(on.blendPrimary);
    this.scrubShow.set(on.showWhileScrubbing !== false);
    this.scopeSeg?.set(scope === 'movie' ? 1 : 0);
    this.crop.setDisabled(!this.o.onCropResize);
    if (this.opened) this.drawCurve();
  }

  private showTab(t: Tab, quiet = false): void {
    if (t === 'onions' && this.o.onionScope() === null) t = 'add';
    this.tab = t;
    lastTab = t;
    for (const [k, b] of this.tabBtns) {
      setClass(b, 'is-active', k === t);
      b.setAttribute('aria-selected', String(k === t));
    }
    for (const [k, p] of this.panes) setHidden(p, k !== t);
    if (!quiet) this.refresh();
    this.moreFade();
  }

  private toggleCurve(): void {
    this.curveOpen = !this.curveOpen;
    setClass(this.curveRow, 'is-open', this.curveOpen);
    setHidden(this.curveWrap, !this.curveOpen);
    this.drawCurve();
    this.moreFade();
  }

  private commitCurve(): void {
    this.o.setPrefs({ pressure: this.pts.map((p) => [p[0], p[1]] as [number, number]) });
    this.drawCurve();
  }

  private toPx(p: [number, number]): [number, number] {
    const s = CURVE - PAD * 2;
    return [PAD + p[0] * s, PAD + (1 - p[1]) * s];
  }

  private fromEvent(e: PointerEvent): [number, number, boolean] {
    const r = this.canvas.getBoundingClientRect();
    const sx = CURVE / r.width, sy = CURVE / r.height;
    const px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sy, s = CURVE - PAD * 2;
    const x = (px - PAD) / s, y = 1 - (py - PAD) / s;
    const off = x < -0.08 || x > 1.08 || y < -0.08 || y > 1.08;
    return [x, y, off];
  }

  private initCanvas(): void {
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    if (dpr > 1) {
      this.canvas.width = CURVE * dpr;
      this.canvas.height = CURVE * dpr;
      this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.canvas.style.width = `${CURVE}px`;
    this.canvas.style.height = `${CURVE}px`;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      const [x, y] = this.fromEvent(e);
      const r = this.canvas.getBoundingClientRect();
      let best = -1, bd = 14 * 14;
      this.pts.forEach((p, i) => {
        const [qx, qy] = this.toPx(p);
        const dx = qx - (e.clientX - r.left) * (CURVE / r.width), dy = qy - (e.clientY - r.top) * (CURVE / r.height);
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) return;
      void x; void y;
      this.dragIdx = best;
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.dragIdx < 0) return;
      const i = this.dragIdx, last = this.pts.length - 1;
      const [x, y, off] = this.fromEvent(e);
      const ny = clamp01(y);
      if (i === 0 || i === last) this.pts[i] = [i === 0 ? 0 : 1, ny];
      else {
        const lo = this.pts[i - 1][0] + MIN_GAP, hi = this.pts[i + 1][0] - MIN_GAP;
        this.pts[i] = [Math.min(hi, Math.max(lo, x)), ny];
      }
      setClass(c, 'is-removing', off && i !== 0 && i !== last);
      this.commitCurve();
    });
    const end = (e: PointerEvent): void => {
      if (this.dragIdx < 0) return;
      const i = this.dragIdx, last = this.pts.length - 1;
      const [, , off] = this.fromEvent(e);
      this.dragIdx = -1;
      setClass(c, 'is-removing', false);
      if (off && i !== 0 && i !== last) { this.pts.splice(i, 1); this.commitCurve(); }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', (e) => {
      if (this.pts.length >= MAX_POINTS) return;
      const [x] = this.fromEvent(e as PointerEvent);
      if (x <= MIN_GAP || x >= 1 - MIN_GAP) return;
      if (this.pts.some((p) => Math.abs(p[0] - x) < MIN_GAP * 2)) return;
      const y = pressureCurve(this.pts)(x);
      const at = this.pts.findIndex((p) => p[0] > x);
      this.pts.splice(at, 0, [x, y]);
      this.commitCurve();
    });
  }

  private drawCurve(): void {
    const g = this.ctx;
    if (!g || !this.curveOpen) return;
    const cs = getComputedStyle(this.root);
    const accent = cs.getPropertyValue('--accent-color').trim() || '#857cf3';
    const line = cs.getPropertyValue('--line-2').trim() || '#555';
    const muted = cs.getPropertyValue('--text-muted').trim() || '#888';
    const s = CURVE - PAD * 2;
    g.clearRect(0, 0, CURVE, CURVE);
    g.lineWidth = 1;
    g.strokeStyle = line;
    g.beginPath();
    for (let i = 0; i <= 4; i++) {
      const v = PAD + (s * i) / 4 + 0.5;
      g.moveTo(v, PAD); g.lineTo(v, PAD + s);
      g.moveTo(PAD, v); g.lineTo(PAD + s, v);
    }
    g.stroke();
    g.setLineDash([3, 4]);
    g.strokeStyle = muted;
    g.beginPath();
    g.moveTo(PAD, PAD + s); g.lineTo(PAD + s, PAD);
    g.stroke();
    g.setLineDash([]);
    const f = pressureCurve(this.pts);
    g.strokeStyle = accent;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 64; i++) {
      const x = i / 64, [px, py] = this.toPx([x, f(x)]);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    const fill = cs.getPropertyValue('--text-primary').trim() || '#fff';
    this.pts.forEach((p, i) => {
      const [px, py] = this.toPx(p), end = i === 0 || i === this.pts.length - 1;
      g.beginPath();
      g.arc(px, py, end ? 5 : 4.5, 0, Math.PI * 2);
      g.fillStyle = end ? accent : fill;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = accent;
      g.stroke();
    });
  }
}
