import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import { FPS_PRESETS, durationLabel, parseTime } from '../engine/time';
import type { PlaybackMode } from '../engine/types';
import { el, q, setChecked, setClass, setHidden, setText } from './dom';
import { followLanguage, fpsText } from './fps-label';
import { toggleOf } from './panels/controls';
import { askFpsChange } from './fps-change-dialog';
import { pickAuthorPicture } from './author-picture';
import { loadPrefs, updatePrefs } from './prefs';
import { openPaintOnCreate, setOpenPaintOnCreate } from './create-pref';
import { loadPaintPrefs, savePaintPrefs } from './paint-settings';
import { Popover } from './popover';
import { StageOptionsBody, type BackgroundPicker } from './stage-options';
import { MS_TAB_ICONS } from './ms-icons';
import { t } from './i18n';
import { api } from '../io/api';
import { toast } from './toast';
import { timelineSnap } from './timeline-ed';
import { rulerDrag, snapSeconds } from './timeline-nav';
import { previewSounds } from './preview-pref';
import '../styles/movie-settings.css';

/** The reference order: Share before Prefs. */
const TABS = ['Project', 'Stage', 'Timeline', 'Share', 'Prefs'] as const;
const PANE_OF: Record<(typeof TABS)[number], number> = { Project: 0, Stage: 1, Timeline: 2, Share: 4, Prefs: 3 };
/** The Gestures page: the pen words are generic (a pen, not a product). */
const GESTURES: Array<['penHover' | 'penRoll' | 'penPlay' | 'undoGestures' | 'multiFinger' | 'rotatePinch', string]> = [
  ['penHover', 'Pen hover on Timeline'], ['penRoll', 'Rotate performing with a twisting pen'], ['penPlay', 'Pen button plays and pauses'],
  ['undoGestures', 'Undo and redo gestures'], ['multiFinger', 'Multi-select with finger'], ['rotatePinch', 'Rotate Stage with pinch zoom'],
];
/** The Share tab's one-click exports: the labels and the Quick share ids of the Export dialog. */
const QUICK_EXPORTS: Array<[string, string]> = [['Video', 'mp4'], ['Animated GIF', 'gif'], ['Frames as images', 'png-frames'], ['Current frame', 'still']];
const UNDO_STEPS:Array<[string, string]> = [['10', '10'], ['20', '20'], ['50', '50'], ['100', '100'], ['250', '250'], ['1000', '1000'], ['0', 'Unlimited']];

function runCommand(id: string): void {
  document.dispatchEvent(new CustomEvent('fm:ms-close'));
  document.dispatchEvent(new CustomEvent('fm:command', { detail: id }));
}

function actionBtn(label: string, id: string): HTMLButtonElement {
  const b = el<HTMLButtonElement>('<button class="fm-ms-btn" type="button"></button>');
  setText(b, label);
  b.addEventListener('click', () => runCommand(id));
  return b;
}
const PLAYBACK: Array<[PlaybackMode, string]> = [['loop', 'Loop'], ['pingpong', 'Ping Pong'], ['oneshot', 'One Shot']];

function row(label: string, control: HTMLElement): HTMLElement {
  const r = el<HTMLElement>('<div class="fm-ms-row"><span class="fm-ms-label"></span></div>');
  setText(q(r, 'span'), label);
  r.appendChild(control);
  return r;
}

function input(type: string, cls = ''): HTMLInputElement {
  return el<HTMLInputElement>(`<input class="fm-ms-input ${cls}" type="${type}" autocomplete="off" spellcheck="false">`);
}

function select(options: Array<[string, string]>): HTMLSelectElement {
  return el<HTMLSelectElement>(`<select class="fm-ms-input">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`);
}

function enter(node: HTMLInputElement): void {
  node.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); node.blur(); } });
}

export class MovieSettings {
  private readonly pop: Popover;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly panes: HTMLElement[] = [];
  private readonly name = input('text');
  private readonly width = input('number');
  private readonly height = input('number');
  private readonly fps = select([...FPS_PRESETS.map((p): [string, string] => [String(p.fps), fpsText(p)]), ['custom', 'Custom']]);
  private readonly fpsCustom = input('number');
  private readonly fpsCustomRow: HTMLElement;
  private readonly duration = input('text');
  private readonly frames: HTMLElement;
  private readonly stage: StageOptionsBody;
  private readonly playbackRows: HTMLButtonElement[] = [];
  private readonly addKey = input('checkbox');
  private readonly loopVisible = input('checkbox');
  /** Timeline editing: snapping, the Ruler's drag, and the sound preview (kept per person, not per movie). */
  private readonly snapOn = input('checkbox');
  private readonly snapSec = input('checkbox');
  private readonly rulerScale = input('checkbox');
  private readonly soundPreview = input('checkbox');
  private readonly mbOn = input('checkbox');
  private readonly mbShutter = input('number');
  private readonly mbSamples = input('number');
  private forceCustom = false;
  private readonly undoSteps = select(UNDO_STEPS);
  private readonly recentUndo = select([['100', '100%'], ['75', '75%'], ['50', '50%'], ['25', '25%'], ['10', '10%']]);
  private readonly rapid = el<HTMLInputElement>('<input class="fm-ms-range" type="range" min="150" max="1000" step="50" aria-label="Rapid undo delay">');
  private readonly rapidChip = el<HTMLElement>('<span class="fm-ms-chip"></span>');
  private readonly stageUndo = input('checkbox');
  private readonly openPaint = input('checkbox');
  private readonly gestureBoxes = new Map<string, HTMLInputElement>();
  private prefsMain!: HTMLElement;
  private prefsGestures!: HTMLElement;
  private body!: HTMLElement;
  private readonly author = input('text', 'fm-ms-wide');
  private art!: HTMLImageElement;
  private artBtn!: HTMLButtonElement;
  private artClear!: HTMLButtonElement;
  private artUrl = '';
  private readonly hh = input('number', 'fm-ms-hms');
  private readonly mm = input('number', 'fm-ms-hms');
  private readonly ss = input('number', 'fm-ms-hms');

  /** Whole seconds from the three fields; the frames left over past a whole second stay. */
  private applyHms(): void {
    const m = this.engine.movie;
    if (!m) return;
    const secs = (this.hh.valueAsNumber || 0) * 3600 + (this.mm.valueAsNumber || 0) * 60 + (this.ss.valueAsNumber || 0);
    const rest = m.duration % Math.max(1, Math.round(m.fps));
    const frames = Math.round(secs * m.fps) + rest;
    if (frames > 0 && frames !== m.duration) this.run('Duration', { duration: frames });
    else this.patch(true);
  }

  constructor(private readonly engine: Engine, picker: BackgroundPicker, private readonly poster: () => Promise<Blob | null> = () => Promise.resolve(null)) {
    this.stage = new StageOptionsBody(engine, picker);
    this.pop = new Popover('fm-ms', 372);
    followLanguage(this.fps);
    // the tab bar sits at the bottom (icon over label) and never moves: the panel has one size, the pane scrolls
    const strip = el<HTMLElement>('<div class="fm-ms-tabs" role="tablist"></div>');
    TABS.forEach((label) => {
      const b = el<HTMLButtonElement>(`<button class="fm-ms-tab" type="button" role="tab">${MS_TAB_ICONS[label]}<span class="fm-ms-tab-label"></span></button>`);
      setText(q(b, '.fm-ms-tab-label'), label);
      b.addEventListener('click', () => this.tab(PANE_OF[label]));
      this.tabs[PANE_OF[label]] = b;
      strip.appendChild(b);
    });
    for (let i = 0; i < TABS.length; i++) this.panes.push(el<HTMLElement>('<div class="fm-ms-pane" role="tabpanel"></div>'));

    this.width.min = '16'; this.height.min = '16';
    this.fpsCustom.min = '1'; this.fpsCustom.max = '120'; this.fpsCustom.step = 'any';
    this.name.setAttribute('aria-label', 'Name');
    this.duration.title = 'Seconds like 10s, frames like 240, or timecode like 0:10:00';
    this.frames = el<HTMLElement>('<span class="fm-ms-hint"></span>');

    const size = el<HTMLElement>('<div class="fm-ms-pair"></div>');
    size.append(this.width, el<HTMLElement>('<span class="fm-ms-x">x</span>'), this.height);
    const fitBtn = el<HTMLButtonElement>('<button class="fm-ms-btn" type="button">Fit to content</button>');
    fitBtn.addEventListener('click', () => this.engine.run('Fit Duration', (m) => ops.fitToContent(m)));
    const durWrap = el<HTMLElement>('<div class="fm-ms-pair"></div>');
    durWrap.append(this.duration, this.frames);
    this.fpsCustomRow = row('Custom rate', this.fpsCustom);
    this.panes[0].append(row('Name', this.name), row('Resolution', size), row('Frame rate', this.fps), this.fpsCustomRow, row('Duration', durWrap), row('', fitBtn));

    this.panes[1].append(this.stage.el);
    const modes = el<HTMLElement>('<div class="fm-ms-group" role="radiogroup" aria-label="Playback"></div>');
    for (const [mode, label] of PLAYBACK) {
      const b = el<HTMLButtonElement>('<button class="fm-ms-radio" type="button" role="radio"><span class="fm-ms-label"></span><span class="fm-ms-check" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg></span></button>');
      setText(q(b, '.fm-ms-label'), label);
      b.dataset.mode = mode;
      b.addEventListener('click', () => this.run('Playback', { playback: mode }));
      this.playbackRows.push(b);
      modes.appendChild(b);
    }
    this.panes[2].append(el<HTMLElement>('<div class="fm-ms-head">Playback</div>'), modes, row('Loop only the visible region', toggleOf(this.loopVisible)), row('Add keyframe at start', toggleOf(this.addKey)),
      el<HTMLElement>('<div class="fm-ms-head">Editing</div>'), row('Snap', toggleOf(this.snapOn)), row('Snap to seconds', toggleOf(this.snapSec)), row('Ruler drag scales time', toggleOf(this.rulerScale)), row('Preview sounds before import', toggleOf(this.soundPreview)),
      el<HTMLElement>('<div class="fm-ms-head">Motion blur</div>'), row('Motion blur', toggleOf(this.mbOn)), row('Shutter angle', this.mbShutter), row('Motion blur maximum samples', this.mbSamples));
    this.mbShutter.min = '0'; this.mbShutter.max = '720'; this.mbSamples.min = '2'; this.mbSamples.max = '64';
    this.undoSteps.value = String(loadPrefs().undoDepth);
    this.undoSteps.addEventListener('change', () => {
      const p = updatePrefs({ undoDepth: Number(this.undoSteps.value) });
      this.engine.setUndoDepth(p.undoDepth, p.recentUndo);
    });
    this.recentUndo.value = String(loadPrefs().recentUndo);
    this.recentUndo.addEventListener('change', () => {
      const p = updatePrefs({ recentUndo: Number(this.recentUndo.value) });
      this.engine.setUndoDepth(p.undoDepth, p.recentUndo);
    });
    this.author.setAttribute('aria-label', 'Author');
    this.author.placeholder = 'Your name';
    enter(this.author);
    this.author.addEventListener('change', () => this.run('Author', { author: this.author.value }));
    // the picture shown in the Theater is a small thumbnail inside the About row, not a large preview
    const art = el<HTMLElement>('<span class="fm-ms-artwrap"><button class="fm-ms-art" type="button"><img alt="Theater picture" draggable="false"></button><button class="fm-ms-artclear" type="button" hidden></button></span>');
    this.art = q<HTMLImageElement>(art, 'img');
    this.artBtn = q<HTMLButtonElement>(art, '.fm-ms-art');
    this.artClear = q<HTMLButtonElement>(art, '.fm-ms-artclear');
    this.artBtn.title = t('Choose your own picture for this movie');
    this.artBtn.setAttribute('aria-label', t('Choose your own picture for this movie'));
    setText(this.artClear, t('Remove picture'));
    this.artBtn.addEventListener('click', () => { void pickAuthorPicture().then((url) => { if (url) { this.run('Picture in the Theater', { authorPicture: url }); void this.refreshArt(); } }); });
    this.artClear.addEventListener('click', () => { this.run('Picture in the Theater', { authorPicture: '' }); void this.refreshArt(); });
    this.panes[0].append(
      el<HTMLElement>('<div class="fm-ms-head">About this artwork</div>'), row('Picture in the Theater', art), row('Author', this.author),
      el<HTMLElement>('<div class="fm-ms-head">History</div>'),
      row('Undo steps', this.undoSteps), row('Recent undo steps', this.recentUndo), row('Recovery points', actionBtn('Recovery Points...', 'recovery-points')),
    );
    this.rapid.addEventListener('input', () => { setText(this.rapidChip, `${this.rapid.value} ms`); savePaintPrefs({ ...loadPaintPrefs(), undoDelay: Number(this.rapid.value) }); });
    const rapidCtl = el<HTMLElement>('<span class="fm-ms-slide"></span>');
    rapidCtl.append(this.rapid, this.rapidChip);
    this.stageUndo.addEventListener('change', () => {
      updatePrefs({ stageUndoButtons: this.stageUndo.checked });
      document.body.classList.toggle('fm-no-stage-undo', !this.stageUndo.checked);
    });
    this.openPaint.addEventListener('change', () => setOpenPaintOnCreate(this.openPaint.checked));
    // the Prefs page: its main rows, and the Gestures page behind a row (a back row returns)
    this.prefsMain = el<HTMLElement>('<div class="fm-ms-sub"></div>');
    this.prefsGestures = el<HTMLElement>('<div class="fm-ms-sub" hidden></div>');
    const gestRow = el<HTMLButtonElement>('<button class="fm-ms-row fm-ms-link" type="button"><span class="fm-ms-label">Gestures</span><span class="fm-ms-go" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg></span></button>');
    gestRow.addEventListener('click', () => this.gestures(true));
    const back = el<HTMLButtonElement>('<button class="fm-ms-row fm-ms-link fm-ms-back" type="button"><span class="fm-ms-go" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg></span><span class="fm-ms-label">Prefs</span></button>');
    back.addEventListener('click', () => this.gestures(false));
    this.prefsMain.append(
      row('Rapid undo delay', rapidCtl),
      row('Undo and redo buttons', toggleOf(this.stageUndo)),
      row('Open Draw & Paint after adding', toggleOf(this.openPaint)),
      row('Keyboard shortcuts', actionBtn('Keyboard Shortcuts...', 'shortcuts')),
      gestRow,
      row('More settings', actionBtn('Preferences...', 'settings')),
    );
    this.prefsGestures.append(back);
    for (const [key, label] of GESTURES) {
      const box = input('checkbox');
      box.addEventListener('change', () => { updatePrefs({ [key]: box.checked }); document.dispatchEvent(new CustomEvent('fm:gesture-prefs')); });
      this.gestureBoxes.set(key, box);
      this.prefsGestures.append(row(label, toggleOf(box)));
    }
    this.panes[3].append(this.prefsMain, this.prefsGestures);
    // G10: one-click rows run the export with default settings (the movie's size, rate and length); Advanced opens the dialog
    this.panes[4].append(el<HTMLElement>('<div class="fm-ms-head">Export</div>'));
    for (const [label, id] of QUICK_EXPORTS) {
      const b = el<HTMLButtonElement>('<button class="fm-ms-row fm-ms-link" type="button"><span class="fm-ms-label"></span><span class="fm-ms-go" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13h10"/></svg></span></button>');
      setText(q(b, '.fm-ms-label'), label);
      b.addEventListener('click', () => { document.dispatchEvent(new CustomEvent('fm:ms-close')); document.dispatchEvent(new CustomEvent('fm:export-quick', { detail: id })); });
      this.panes[4].append(b);
    }
    this.panes[4].append(
      row('Advanced export', actionBtn('Export...', 'export')),
      el<HTMLElement>('<div class="fm-ms-head">Share the movie</div>'),
      row('Movie file', actionBtn('Share', 'export-fmo')),
      row('Movie file with undo history', actionBtn('Share', 'export-fmo-history')),
    );

    const hms = el<HTMLElement>('<div class="fm-ms-pair"></div>');
    for (const [n, tag] of [[this.hh, 'h'], [this.mm, 'm'], [this.ss, 's']] as const) {
      n.min = '0'; n.step = '1';
      enter(n);
      n.addEventListener('change', () => this.applyHms());
      hms.append(n, el<HTMLElement>(`<span class="fm-ms-x">${tag}</span>`));
    }
    this.panes[0].insertBefore(row('Hours, minutes, seconds', hms), this.panes[0].children[5]);

    this.body = el<HTMLElement>('<div class="fm-ms-body"></div>');
    this.body.append(el<HTMLElement>('<div class="fm-ms-title">Movie Settings</div>'), ...this.panes);
    this.pop.body.append(this.body, strip);
    this.wire();
    this.tab(0);
    engine.on('movie', () => { if (this.pop.isOpen) this.patch(); });
    this.pop.onHide(() => setClass(this.anchor, 'is-ms-open', false));
    // an action that opens a dialog (Export, Preferences, Shortcuts) takes the popover away first
    document.addEventListener('fm:ms-close', () => this.pop.hide());
  }

  toggle(anchor: HTMLElement): void {
    if (this.pop.isOpen) { this.pop.hide(); return; }
    if (!this.engine.movie) return;
    this.forceCustom = false;
    this.gestures(false);
    this.patch(true);
    this.anchor = anchor;
    this.place();
    setClass(anchor, 'is-ms-open', true);
    void this.refreshArt();
  }

  private gestures(on: boolean): void {
    setHidden(this.prefsMain, on);
    setHidden(this.prefsGestures, !on);
  }

  /** The artwork picture is the current Stage frame, swapped in when it is ready. */
  private async refreshArt(): Promise<void> {
    const raw = this.engine.movie?.authorPicture;
    // a shared movie is outside input: only an embedded picture is shown, never an address that would be fetched
    const own = raw && /^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(raw) && raw.length < 400000 ? raw : undefined;
    setHidden(this.artClear, !raw);
    if (own) { if (this.art.src !== own) this.art.src = own; return; }
    const blob = await this.poster();
    if (!blob || !this.pop.isOpen) return;
    const url = URL.createObjectURL(blob);
    this.art.src = url;
    if (this.artUrl) URL.revokeObjectURL(this.artUrl);
    this.artUrl = url;
  }

  private anchor: HTMLElement | null = null;

  /** Opens on the side of the anchor w/ more room (the Timeline bar sits low), and again after a tab changes the height. */
  private place(): void {
    const a = this.anchor;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const above = r.top > window.innerHeight - r.bottom;
    // one fixed size, worked out once per opening: a tab never changes it, so the tab bar never moves
    const room = (above ? r.top - 40 : window.innerHeight - r.bottom) - 24;
    this.pop.el.style.height = `${Math.round(Math.max(300, Math.min(560, room)))}px`;
    this.pop.showFor(a, above ? 'above' : 'below');
  }

  private tab(at: number): void {
    this.tabs.forEach((b, i) => { setClass(b, 'is-active', i === at); b.setAttribute('aria-selected', String(i === at)); });
    this.panes.forEach((p, i) => setHidden(p, i !== at));
    this.body.scrollTop = 0;
  }

  private run(label: string, patch: ops.MoviePatch): void {
    this.engine.run(label, (m) => ops.patchMovie(m, patch));
    this.patch(true);
  }

  private wire(): void {
    for (const n of [this.name, this.width, this.height, this.fpsCustom, this.duration]) enter(n);
    // the name is the file's name in the Theater: renaming renames the library file, then the movie
    this.name.addEventListener('change', () => { void this.rename(this.name.value.trim()); });
    this.width.addEventListener('change', () => { if (Number.isFinite(this.width.valueAsNumber)) this.run('Resolution', { width: this.width.valueAsNumber }); else this.patch(true); });
    this.height.addEventListener('change', () => { if (Number.isFinite(this.height.valueAsNumber)) this.run('Resolution', { height: this.height.valueAsNumber }); else this.patch(true); });
    this.fps.addEventListener('change', () => {
      if (this.fps.value === 'custom') {
        this.forceCustom = true;
        setHidden(this.fpsCustomRow, false);
        this.fpsCustom.focus();
        return;
      }
      this.forceCustom = false;
      void this.setFps(Number(this.fps.value));
    });
    this.fpsCustom.addEventListener('change', () => { if (Number.isFinite(this.fpsCustom.valueAsNumber)) void this.setFps(this.fpsCustom.valueAsNumber); else this.patch(true); });
    this.duration.addEventListener('change', () => {
      const m = this.engine.movie;
      const frames = m ? parseTime(this.duration.value, m.fps) : null;
      if (frames !== null && frames > 0) this.run('Duration', { duration: frames });
      else this.patch(true);
    });
    this.loopVisible.addEventListener('change', () => this.run('Loop Visible Region', { loopVisible: this.loopVisible.checked }));
    this.snapOn.addEventListener('change', () => timelineSnap.set(this.snapOn.checked));
    this.snapSec.addEventListener('change', () => snapSeconds.set(this.snapSec.checked));
    this.rulerScale.addEventListener('change', () => rulerDrag.set(this.rulerScale.checked ? 'scale' : 'scrub'));
    this.soundPreview.addEventListener('change', () => previewSounds.set(this.soundPreview.checked));
    this.addKey.addEventListener('change', () => this.run('Keyframe at Start', { addKeyAtStart: this.addKey.checked }));
    const mb = (): void => {
      const sh = this.mbShutter.valueAsNumber, sm = this.mbSamples.valueAsNumber;
      this.run('Motion Blur', { motionBlur: { on: this.mbOn.checked, shutter: Number.isFinite(sh) ? sh : 180, samples: Number.isFinite(sm) ? sm : 16 } });
    };
    for (const n of [this.mbOn, this.mbShutter, this.mbSamples]) n.addEventListener('change', mb);
  }

  private async rename(to: string): Promise<void> {
    const e = this.engine, m = e.movie;
    if (!m || !to || to === (e.libraryName ?? m.name)) { this.patch(true); return; }
    try {
      if (e.libraryName) {
        const item = await api.renameMovie(e.libraryName, to);
        e.libraryName = item.name;
        e.nameMovie(item.name);
      } else this.run('Rename Movie', { name: to });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('The movie could not be renamed.'), 'error');
    }
    this.patch(true);
  }

  /** A new frame rate retimes every block and key to keep its length in seconds, so a movie with content asks first. */
  private async setFps(fps: number): Promise<void> {
    const m = this.engine.movie;
    let keepFrames = false;   // an empty movie only keeps its length in seconds
    if (m && m.tracks.some((t) => t.content.length > 0) && fps !== m.fps) {
      keepFrames = true;   // the reference keeps the frames and the speed changes
      const ans = await askFpsChange(m.fps, fps, m.duration);
      if (ans === 'cancel') { this.forceCustom = false; this.patch(true); return; }
      keepFrames = ans === 'keep-frames';
    }
    this.run('Frame Rate', { fps, keepFrames });
  }

  private put(node: HTMLInputElement | HTMLSelectElement, value: string, force: boolean): void {
    if (node.value === value) return;
    if (force || document.activeElement !== node) node.value = value;
  }

  private patch(force = false): void {
    const m = this.engine.movie;
    if (!m) return;
    this.put(this.name, m.name, force);
    this.put(this.width, String(m.width), force);
    this.put(this.height, String(m.height), force);
    const preset = FPS_PRESETS.some((p) => p.fps === m.fps);
    const custom = this.forceCustom || !preset;
    this.put(this.fps, custom ? 'custom' : String(m.fps), true);
    setHidden(this.fpsCustomRow, !custom);
    this.put(this.fpsCustom, String(m.fps), force);
    this.put(this.duration, durationLabel(m.duration, m.fps), force);
    setText(this.frames, `${m.duration} f`);
    const whole = Math.floor(m.duration / Math.max(1, m.fps));
    this.put(this.hh, String(Math.floor(whole / 3600)), force);
    this.put(this.mm, String(Math.floor((whole % 3600) / 60)), force);
    this.put(this.ss, String(whole % 60), force);
    this.put(this.undoSteps, String(loadPrefs().undoDepth), true);
    this.put(this.recentUndo, String(Math.round(loadPrefs().recentUndo / 25) * 25 || 10), true);
    this.put(this.author, m.author ?? '', force);
    this.stage.sync();
    for (const b of this.playbackRows) { const on = b.dataset.mode === m.playback; setClass(b, 'is-on', on); b.setAttribute('aria-checked', String(on)); }
    const p = loadPrefs();
    const delay = String(Math.round(loadPaintPrefs().undoDelay / 50) * 50);
    if (this.rapid.value !== delay) this.rapid.value = delay;
    setText(this.rapidChip, `${delay} ms`);
    setChecked(this.stageUndo, p.stageUndoButtons);
    setChecked(this.openPaint, openPaintOnCreate());
    for (const [key] of GESTURES) { const box = this.gestureBoxes.get(key); if (box) setChecked(box, p[key]); }
    setChecked(this.addKey, m.addKeyAtStart);
    setChecked(this.loopVisible, !!m.loopVisible);
    setChecked(this.snapOn, timelineSnap.on);
    setChecked(this.snapSec, snapSeconds.on);
    setChecked(this.rulerScale, rulerDrag.mode === 'scale');
    setChecked(this.soundPreview, previewSounds.on);
    setChecked(this.mbOn, !!m.motionBlur?.on);
    this.put(this.mbShutter, String(m.motionBlur?.shutter ?? 180), force);
    this.put(this.mbSamples, String(m.motionBlur?.samples ?? 16), force);
  }
}
