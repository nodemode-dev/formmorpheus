import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import { FPS_PRESETS, durationLabel, parseTime } from '../engine/time';
import type { PlaybackMode } from '../engine/types';
import { el, q, setChecked, setClass, setHidden, setText } from './dom';
import { toggleOf } from './panels/controls';
import { Popover } from './popover';

const TABS = ['Project', 'Stage', 'Timeline'] as const;
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
  private readonly fps = select([...FPS_PRESETS.map((p): [string, string] => [String(p.fps), `${p.fps} · ${p.label}`]), ['custom', 'Custom']]);
  private readonly fpsCustom = input('number');
  private readonly fpsCustomRow: HTMLElement;
  private readonly duration = input('text');
  private readonly frames: HTMLElement;
  private readonly bg = input('color', 'fm-ms-color');
  private readonly clear = input('checkbox');
  private readonly playback = select(PLAYBACK);
  private readonly addKey = input('checkbox');
  private readonly loopVisible = input('checkbox');
  private forceCustom = false;

  constructor(private readonly engine: Engine) {
    this.pop = new Popover('fm-ms', 380);
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

    const swatch = el<HTMLElement>('<div class="fm-ms-pair"></div>');
    swatch.appendChild(this.bg);
    this.panes[1].append(row('Background', swatch), row('Transparent background', toggleOf(this.clear)));
    this.panes[2].append(row('Playback', this.playback), row('Loop only the visible region', toggleOf(this.loopVisible)), row('Add keyframe at start', toggleOf(this.addKey)));

    this.pop.body.append(strip, ...this.panes);
    this.wire();
    this.tab(0);
    engine.on('movie', () => { if (this.pop.isOpen) this.patch(); });
  }

  toggle(anchor: HTMLElement): void {
    if (this.pop.isOpen) { this.pop.hide(); return; }
    if (!this.engine.movie) return;
    this.forceCustom = false;
    this.patch(true);
    this.pop.showFor(anchor, 'below');
  }

  private tab(at: number): void {
    this.tabs.forEach((b, i) => { setClass(b, 'is-active', i === at); b.setAttribute('aria-selected', String(i === at)); });
    this.panes.forEach((p, i) => setHidden(p, i !== at));
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
      this.run('Frame Rate', { fps: Number(this.fps.value) });
    });
    this.fpsCustom.addEventListener('change', () => { if (Number.isFinite(this.fpsCustom.valueAsNumber)) this.run('Frame Rate', { fps: this.fpsCustom.valueAsNumber }); else this.patch(true); });
    this.duration.addEventListener('change', () => {
      const m = this.engine.movie;
      const frames = m ? parseTime(this.duration.value, m.fps) : null;
      if (frames !== null && frames > 0) this.run('Duration', { duration: frames });
      else this.patch(true);
    });
    this.bg.addEventListener('input', () => this.engine.run('Background', (m) => ops.patchMovie(m, { background: this.bg.value }), 'movie-background'));
    this.bg.addEventListener('change', () => this.engine.endGesture());
    this.clear.addEventListener('change', () => this.run('Transparent Background', { transparent: this.clear.checked }));
    this.playback.addEventListener('change', () => this.run('Playback', { playback: this.playback.value as PlaybackMode }));
    this.loopVisible.addEventListener('change', () => this.run('Loop Visible Region', { loopVisible: this.loopVisible.checked }));
    this.addKey.addEventListener('change', () => this.run('Keyframe at Start', { addKeyAtStart: this.addKey.checked }));
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
    this.put(this.bg, m.background, true);
    setChecked(this.clear, m.transparent);
    setClass(this.bg.parentElement, 'is-off', m.transparent);
    this.put(this.playback, m.playback, true);
    setChecked(this.addKey, m.addKeyAtStart);
    setChecked(this.loopVisible, !!m.loopVisible);
  }
}
