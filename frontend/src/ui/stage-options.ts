// Stage options: background color (with the app's Color panel), Transparent background, Backstage visibility,
// Timecode and the movie-wide Onion skins. One body is built per host (the Stage Options popover and the Stage tab
// of Movie settings) and patched in place from the movie.
import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import { defaultOnion } from '../engine/model';
import { BACKSTAGE_DEFAULT } from '../engine/render';
import type { OnionSettings } from '../engine/types';
import type { RGB } from '../paint/types';
import { ColourPanel } from './colour-panel';
import { GuidesSection } from './stage-guides-panel';
import { el, q, setClass, setStyleVar, setText } from './dom';
import { t } from './i18n';
import { sliderRow, toggleRow, type Row } from './panels/controls';
import { Popover } from './popover';
import '../styles/stage-nav.css';

const hex = (c: RGB): string => '#' + [c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, '0')).join('');
function parseHex(s: string): RGB {
  const n = parseInt(s.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** The Color panel that edits the movie background; one per app. */
export class BackgroundPicker {
  private panel: ColourPanel | null = null;

  constructor(private readonly engine: Engine) {}

  isOpen(): boolean { return !!this.panel?.isOpen(); }

  open(anchor: HTMLElement): void {
    const m = this.engine.movie;
    if (!m) return;
    if (!this.panel) {
      this.panel = new ColourPanel({
        keepColours: true,
        onPick: (rgb, final) => {
          this.engine.run('Background', (mv) => ops.patchMovie(mv, { background: hex(rgb) }), 'movie-background');
          if (final) { this.engine.endGesture(); this.panel?.commit(rgb); }
        },
      });
      (document.getElementById('overlay-root') ?? document.body).appendChild(this.panel.root);
    }
    if (this.panel.isOpen()) { this.panel.close(); return; }
    this.panel.set(parseHex(m.background));
    this.panel.open(anchor);
    // beside the options, not over them
    const host = anchor.closest<HTMLElement>('.fm-pop');
    if (host) {
      const r = host.getBoundingClientRect(), w = this.panel.root.offsetWidth || 280;
      const left = r.left - w - 8 >= 8 ? r.left - w - 8 : Math.min(window.innerWidth - w - 8, r.right + 8);
      this.panel.root.style.left = `${Math.round(left)}px`;
      this.panel.root.style.top = `${Math.max(8, Math.round(r.top))}px`;
    }
  }

  close(): void { this.panel?.close(); }
}

export class StageOptionsBody {
  readonly el: HTMLElement;
  private readonly bgRow: HTMLElement;
  readonly swatch: HTMLButtonElement;
  private readonly hexLabel: HTMLElement;
  private readonly clear: Row<boolean>;
  private readonly back: Row<number>;
  private readonly tc: Row<boolean>;
  private readonly onion: { enabled: Row<boolean>; backward: Row<number>; forward: Row<number>; opacity: Row<number>; tint: Row<boolean>; blend: Row<boolean> };

  constructor(private readonly engine: Engine, private readonly picker: BackgroundPicker) {
    this.el = el('<div class="fm-so"><div class="fm-so-sec" data-sec="stage"></div><div class="fm-so-sec" data-sec="onion"></div></div>');
    this.bgRow = el(`<div class="fm-so-bg"><span>${t('Background color')}</span><button type="button" class="fm-so-swatch" aria-label="${t('Background color')}"><span class="fm-so-chip"></span><span class="fm-so-hex"></span></button></div>`);
    this.swatch = q<HTMLButtonElement>(this.bgRow, '.fm-so-swatch');
    this.hexLabel = q(this.bgRow, '.fm-so-hex');
    this.swatch.addEventListener('click', () => this.picker.open(this.swatch));
    this.clear = toggleRow(t('Transparent background'), (v) => this.engine.run('Transparent Background', (m) => ops.patchMovie(m, { transparent: v })));
    this.back = sliderRow(t('Backstage visibility'), 0, 100, 1, (v) => this.engine.run('Backstage Visibility', (m) => ops.patchMovie(m, { backstage: v / 100 }), 'movie-backstage'), { def: BACKSTAGE_DEFAULT * 100 });
    q(this.back.el, 'input[type="range"]').addEventListener('change', () => this.engine.endGesture());
    this.tc = toggleRow(t('Timecode'), (v) => this.engine.run('Timecode', (m) => ops.patchMovie(m, { timecode: v })));
    q(this.el, '[data-sec="stage"]').append(this.bgRow, this.clear.el, this.back.el, this.tc.el);

    const set = (p: Partial<OnionSettings>, merge?: string): void => { this.engine.run('Onion skins', (m) => ({ ...m, onion: { ...m.onion, ...p } }), merge ?? null); };
    const slide = (label: string, max: number, step: number, apply: (v: number) => Partial<OnionSettings>, key: string): Row<number> => {
      const r = sliderRow(label, 0, max, step, (v) => set(apply(v), key));
      q(r.el, 'input[type="range"]').addEventListener('change', () => this.engine.endGesture());
      return r;
    };
    this.onion = {
      enabled: toggleRow(t('Onion skin visibility'), (v) => set({ enabled: v })),
      backward: slide(t('Frames backwards'), 12, 1, (v) => ({ backFrames: v }), 'onion-back'),
      forward: slide(t('Frames forwards'), 12, 1, (v) => ({ foreFrames: v }), 'onion-fore'),
      opacity: slide(t('Opacity'), 1, 0.01, (v) => ({ opacity: v }), 'onion-opacity'),
      tint: toggleRow(t('Color tint'), (v) => set({ tint: v })),
      blend: toggleRow(t('Blend primary frame'), (v) => set({ blendPrimary: v })),
    };
    const sec = q(this.el, '[data-sec="onion"]');
    const head = el('<div class="fm-so-head"></div>');
    setText(head, t('Onion skins'));
    const o = this.onion;
    sec.append(head, o.enabled.el, o.backward.el, o.forward.el, o.opacity.el, o.tint.el, o.blend.el);
    this.guides = new GuidesSection(engine);
    this.el.appendChild(this.guides.el);
  }
  private readonly guides: GuidesSection;

  sync(): void {
    const m = this.engine.movie;
    if (!m) return;
    setStyleVar(this.swatch, '--fm-so-bg', m.background);
    setText(this.hexLabel, m.background.toUpperCase());
    setClass(this.bgRow, 'is-off', m.transparent);
    this.clear.set(m.transparent);
    this.back.set(Math.round((m.backstage ?? BACKSTAGE_DEFAULT) * 100));
    this.tc.set(m.timecode !== false);
    // movies from before onion skins (v0.3.0) have none, or older fields: fill from the defaults
    const o = { ...defaultOnion(), ...(m.onion ?? {}) }, w = this.onion;
    w.enabled.set(o.enabled); w.backward.set(o.backFrames); w.forward.set(o.foreFrames);
    w.opacity.set(o.opacity); w.tint.set(o.tint); w.blend.set(o.blendPrimary);
    this.guides.sync();
  }
}

/** The Stage Options popover (View menu, the Stage's right-click menu). */
export class StageOptions {
  private readonly pop = new Popover('fm-stage-opts', 340);
  private readonly body: StageOptionsBody;
  readonly picker: BackgroundPicker;

  constructor(private readonly engine: Engine) {
    this.picker = new BackgroundPicker(engine);
    this.body = new StageOptionsBody(engine, this.picker);
    this.pop.body.appendChild(this.body.el);
    this.pop.onHide(() => this.picker.close());
    engine.on('movie', () => { if (this.pop.isOpen) this.body.sync(); });
  }

  get isOpen(): boolean { return this.pop.isOpen; }

  /** Opens beside a point (right click) or below an anchor. */
  show(at: HTMLElement | { x: number; y: number }): void {
    if (!this.engine.movie) return;
    if (this.pop.isOpen) { this.pop.hide(); return; }
    this.body.sync();
    if (at instanceof HTMLElement) this.pop.showFor(at, 'below'); else this.pop.showAt(at.x, at.y);
  }

  /** Background color picker: the options open too, so the panel hangs from the swatch. */
  pickBackground(at: HTMLElement | { x: number; y: number }): void {
    if (!this.engine.movie) return;
    if (!this.pop.isOpen) this.show(at);
    if (!this.picker.isOpen()) this.picker.open(this.body.swatch);
  }
}
