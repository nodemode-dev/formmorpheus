import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import { FPS_PRESETS, durationLabel, parseTime } from '../engine/time';
import type { PlaybackMode } from '../engine/types';
import { el, q, setChecked, setClass, setHidden, setText } from './dom';
import { followLanguage, fpsText } from './fps-label';
import { toggleOf } from './panels/controls';
import { confirmAction } from './dialogs';
import { loadPrefs, updatePrefs } from './prefs';
import { loadPaintPrefs, savePaintPrefs } from './paint-settings';
import { Popover } from './popover';
import { StageOptionsBody, type BackgroundPicker } from './stage-options';

const TABS = ['Project', 'Stage', 'Timeline', 'Prefs', 'Share'] as const;
const UNDO_STEPS: Array<[string, string]> = [['10', '10'], ['20', '20'], ['50', '50'], ['100', '100'], ['250', '250'], ['1000', '1000'], ['0', 'Unlimited']];

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
  private readonly playback = select(PLAYBACK);
  private readonly addKey = input('checkbox');
  private readonly loopVisible = input('checkbox');
  private readonly mbOn = input('checkbox');
  private readonly mbShutter = input('number');
  private readonly mbSamples = input('number');
  private forceCustom = false;
  private readonly undoSteps = select(UNDO_STEPS);
  private readonly recentUndo = select([['100', '100%'], ['75', '75%'], ['50', '50%'], ['25', '25%'], ['10', '10%']]);
  private readonly rapid = select([['150', '150 ms'], ['300', '300 ms'], ['420', '420 ms'], ['600', '600 ms'], ['800', '800 ms'], ['1000', '1000 ms']]);
  private readonly author = input('text', 'fm-ms-wide');
  private art!: HTMLImageElement;
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
    this.pop = new Popover('fm-ms', 380);
    followLanguage(this.fps);
    const strip = el<HTMLElement>('<div class="fm-ms-tabs" role="tablist"></div>');
    TABS.forEach((label, i) => {
      const b = el<HTMLButtonElement>('<button class="fm-ms-tab" type="button" role="tab"></button>');
      setText(b, label);
      b.addEventListener('click', () => this.tab(i));
      this.tabs.push(b);
      strip.appendChild(b);
      const pane = el<HTMLElement>('<div class="fm-ms-pane" role="tabpanel"></div>');
      this.panes.push(pane);
    });

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
    this.panes[2].append(row('Playback', this.playback), row('Loop only the visible region', toggleOf(this.loopVisible)), row('Add keyframe at start', toggleOf(this.addKey)), row('Motion blur', toggleOf(this.mbOn)), row('Shutter angle', this.mbShutter), row('Motion blur maximum samples', this.mbSamples));
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
    const art = el<HTMLElement>('<div class="fm-ms-art"><img alt="Artwork" draggable="false"><span class="fm-ms-art-cap">The picture shown in the Theater</span></div>');
    this.art = q<HTMLImageElement>(art, 'img');
    this.panes[0].append(
      el<HTMLElement>('<div class="fm-ms-head">About this artwork</div>'), art, row('Author', this.author),
      el<HTMLElement>('<div class="fm-ms-head">History</div>'),
      row('Undo steps', this.undoSteps), row('Recent undo steps', this.recentUndo), row('Recovery points', actionBtn('Recovery Points...', 'recovery-points')),
    );
    this.rapid.value = String(Math.round(loadPaintPrefs().undoDelay / 10) * 10);
    this.rapid.addEventListener('change', () => savePaintPrefs({ ...loadPaintPrefs(), undoDelay: Number(this.rapid.value) }));
    this.panes[3].append(
      row('Rapid undo delay', this.rapid),
      row('Keyboard shortcuts', actionBtn('Keyboard Shortcuts...', 'shortcuts')),
      row('More settings', actionBtn('Preferences...', 'settings')),
    );
    this.panes[4].append(
      row('Export', actionBtn('Export...', 'export')),
      row('Movie file', actionBtn('Share Movie File', 'export-fmo')),
      row('With undo history', actionBtn('Share Movie File with History', 'export-fmo-history')),
    );

    const hms = el<HTMLElement>('<div class="fm-ms-pair"></div>');
    for (const [n, tag] of [[this.hh, 'h'], [this.mm, 'm'], [this.ss, 's']] as const) {
      n.min = '0'; n.step = '1';
      enter(n);
      n.addEventListener('change', () => this.applyHms());
      hms.append(n, el<HTMLElement>(`<span class="fm-ms-x">${tag}</span>`));
    }
    this.panes[0].insertBefore(row('Hours, minutes, seconds', hms), this.panes[0].children[5]);

    this.pop.body.append(strip, ...this.panes);
    this.wire();
    this.tab(0);
    engine.on('movie', () => { if (this.pop.isOpen) this.patch(); });
    // an action that opens a dialog (Export, Preferences, Shortcuts) takes the popover away first
    document.addEventListener('fm:ms-close', () => this.pop.hide());
  }

  toggle(anchor: HTMLElement): void {
    if (this.pop.isOpen) { this.pop.hide(); return; }
    if (!this.engine.movie) return;
    this.forceCustom = false;
    this.patch(true);
    this.anchor = anchor;
    this.place();
    void this.refreshArt();
  }

  /** The artwork picture is the current Stage frame, swapped in when it is ready. */
  private async refreshArt(): Promise<void> {
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
    this.pop.showFor(a, r.top > window.innerHeight - r.bottom ? 'above' : 'below');
  }

  private tab(at: number): void {
    this.tabs.forEach((b, i) => { setClass(b, 'is-active', i === at); b.setAttribute('aria-selected', String(i === at)); });
    this.panes.forEach((p, i) => setHidden(p, i !== at));
    if (this.pop.isOpen) this.place();
  }

  private run(label: string, patch: ops.MoviePatch): void {
    this.engine.run(label, (m) => ops.patchMovie(m, patch));
    this.patch(true);
  }

  private wire(): void {
    for (const n of [this.name, this.width, this.height, this.fpsCustom, this.duration]) enter(n);
    this.name.addEventListener('change', () => this.run('Rename Movie', { name: this.name.value }));
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
    this.playback.addEventListener('change', () => this.run('Playback', { playback: this.playback.value as PlaybackMode }));
    this.loopVisible.addEventListener('change', () => this.run('Loop Visible Region', { loopVisible: this.loopVisible.checked }));
    this.addKey.addEventListener('change', () => this.run('Keyframe at Start', { addKeyAtStart: this.addKey.checked }));
    const mb = (): void => {
      const sh = this.mbShutter.valueAsNumber, sm = this.mbSamples.valueAsNumber;
      this.run('Motion Blur', { motionBlur: { on: this.mbOn.checked, shutter: Number.isFinite(sh) ? sh : 180, samples: Number.isFinite(sm) ? sm : 16 } });
    };
    for (const n of [this.mbOn, this.mbShutter, this.mbSamples]) n.addEventListener('change', mb);
  }

  /** A new frame rate retimes every block and key to keep its length in seconds, so a movie with content asks first. */
  private async setFps(fps: number): Promise<void> {
    const m = this.engine.movie;
    if (m && m.tracks.some((t) => t.content.length > 0) && fps !== m.fps) {
      const ok = await confirmAction('Change frame rate', 'Blocks, keyframes and Flipbook frames are retimed to keep their length in seconds. This can shift cuts by a frame. Undo restores them.', 'Change');
      if (!ok) { this.forceCustom = false; this.patch(true); return; }
    }
    this.run('Frame Rate', { fps });
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
    this.put(this.playback, m.playback, true);
    setChecked(this.addKey, m.addKeyAtStart);
    setChecked(this.loopVisible, !!m.loopVisible);
    setChecked(this.mbOn, !!m.motionBlur?.on);
    this.put(this.mbShutter, String(m.motionBlur?.shutter ?? 180), force);
    this.put(this.mbSamples, String(m.motionBlur?.samples ?? 16), force);
  }
}
