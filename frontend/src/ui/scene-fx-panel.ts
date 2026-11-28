import type { Engine } from '../engine/engine';
import { SCENE_FX, sceneFxKind, type SceneFxGroup } from '../engine/scene-fx';
import { timecode } from '../engine/time';
import type { Movie, SceneFx } from '../engine/types';
import { el, patchList, q, setClass, setDisabled, setHidden, setText, setTitle, setValue } from './dom';
import { onLanguage, t } from './i18n';
import { tf } from './i18n-fill';
import { icon } from './icons';
import { FxPreviews, paintPreview } from './scene-fx-preview';

const GROUPS: { id: SceneFxGroup; label: string }[] = [
  { id: 'weather', label: 'Weather' },
  { id: 'particles', label: 'Particles' },
  { id: 'light', label: 'Light' },
];

const TILE_W = 224, TILE_H = 126;
const SWATCH_W = 64, SWATCH_H = 36;
export const previewSeed = (kind: string): number => 7 + 101 * SCENE_FX.findIndex((k) => k.kind === kind);

export interface SceneFxActions {
  add(kind: string): void;
  strength(id: string, amount: number, done: boolean): void;
  from(id: string): void;
  to(id: string): void;
  remove(id: string): void;
}

/** The Effects tab: the effects in the movie, then a tile for every effect. Built once; the list is patched by id. */
export class SceneFxPanel {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly previews = new FxPreviews();
  private readonly labels: { node: Element; text: string }[] = [];
  private shown = false;

  constructor(private readonly engine: Engine, private readonly act: SceneFxActions) {
    this.root = el<HTMLElement>('<div class="fm-scfx"></div>');
    const head = el<HTMLElement>('<div class="fm-build-sec"></div>');
    this.label(head, 'In this movie');
    this.empty = el<HTMLElement>('<p class="fm-build-note"></p>');
    this.label(this.empty, 'Click an effect below to lay it over the whole movie. You can then set its strength and where it starts and ends.');
    this.list = el<HTMLElement>('<div class="fm-scfx-list" role="list"></div>');
    this.root.append(head, this.empty, this.list);
    for (const g of GROUPS) {
      const sec = el<HTMLElement>('<div class="fm-build-sec"></div>');
      this.label(sec, g.label);
      const tiles = el<HTMLElement>('<div class="fm-build-tiles is-wide fm-scfx-tiles" role="group"></div>');
      tiles.setAttribute('aria-label', t(g.label));
      for (const k of SCENE_FX.filter((x) => x.group === g.id)) {
        const b = el<HTMLButtonElement>(`<button class="fm-build-tile fm-scfx-tile" type="button" data-kind="${k.kind}"><span class="fm-build-thumb"><canvas width="${TILE_W}" height="${TILE_H}" aria-hidden="true"></canvas></span><span class="fm-build-name"></span></button>`);
        this.label(q(b, '.fm-build-name'), k.name);
        this.previews.add(q<HTMLCanvasElement>(b, 'canvas'), k.kind, previewSeed(k.kind));
        tiles.append(b);
      }
      tiles.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.fm-scfx-tile');
        if (b && !b.disabled && b.dataset.kind) this.act.add(b.dataset.kind);
      });
      this.root.append(sec, tiles);
    }
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-do]');
      const id = b?.closest<HTMLElement>('.fm-scfx-card')?.dataset.key;
      if (!b || !id || b.disabled) return;
      if (b.dataset.do === 'from') this.act.from(id);
      else if (b.dataset.do === 'to') this.act.to(id);
      else if (b.dataset.do === 'remove') this.act.remove(id);
    });
    this.list.addEventListener('input', (e) => {
      const r = e.target as HTMLInputElement;
      const id = r.closest<HTMLElement>('.fm-scfx-card')?.dataset.key;
      if (r.type === 'range' && id) { this.act.strength(id, Number(r.value) / 100, false); this.showPct(r); }
    });
    this.list.addEventListener('change', (e) => {
      const r = e.target as HTMLInputElement;
      const id = r.closest<HTMLElement>('.fm-scfx-card')?.dataset.key;
      if (r.type === 'range' && id) this.act.strength(id, Number(r.value) / 100, true);
    });
    new IntersectionObserver((es) => {
      const on = es.some((x) => x.isIntersecting);
      if (on && !this.shown) { this.shown = true; this.patch(); } else if (!on) this.shown = false;
    }).observe(this.root);
    engine.on('movie', () => { if (this.shown) this.patch(); });
    engine.on('projects', () => { if (this.shown) this.patch(); });
    engine.on('time', () => { if (this.shown && !engine.playing) this.patchTime(); });
    engine.on('playing', (on) => { if (this.shown && !on) this.patchTime(); });
    onLanguage(() => { for (const l of this.labels) setText(l.node, t(l.text)); this.patch(); });
  }

  private label(node: Element, text: string): void {
    this.labels.push({ node, text });
    setText(node, t(text));
  }

  private showPct(r: HTMLInputElement): void {
    const out = r.parentElement?.querySelector('output');
    if (out) setText(out, `${r.value}%`);
  }

  /** Scrolls the effect's card into view once it is listed. */
  reveal(id: string): void {
    this.patch();
    const card = this.list.querySelector<HTMLElement>(`.fm-scfx-card[data-key="${CSS.escape(id)}"]`);
    card?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  patch(): void {
    const m = this.engine.movie;
    const items = m?.sceneFx ?? [];
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.fm-scfx-tile')) setDisabled(b, !m);
    setHidden(this.empty, items.length > 0);
    patchList(this.list, items, {
      key: (x) => x.id,
      create: (x) => { const n = this.card(x); this.fill(n, x, m); return n; },
      update: (n, x) => this.fill(n, x, m),
    });
    this.patchTime();
  }

  private card(x: SceneFx): HTMLElement {
    const n = el<HTMLElement>(
      '<div class="fm-scfx-card" role="listitem">' +
        '<div class="fm-scfx-head">' +
          `<span class="fm-scfx-swatch"><canvas width="${SWATCH_W}" height="${SWATCH_H}" aria-hidden="true"></canvas></span>` +
          '<span class="fm-scfx-title"><span class="fm-scfx-name"></span><span class="fm-scfx-range"></span></span>' +
          `<button class="fm-scfx-x" type="button" data-do="remove">${icon('delete', 14)}</button>` +
        '</div>' +
        '<label class="fm-scfx-amt"><span class="fm-scfx-amtname"></span><input type="range" min="0" max="100" step="1"><output></output></label>' +
        '<div class="fm-scfx-btns">' +
          '<button class="cv-btn" type="button" data-do="from"></button>' +
          '<button class="cv-btn" type="button" data-do="to"></button>' +
        '</div>' +
      '</div>');
    paintPreview(q<HTMLCanvasElement>(n, 'canvas'), x.kind, previewSeed(x.kind), 2.35);
    n.dataset.kind = x.kind;
    return n;
  }

  private fill(n: HTMLElement, x: SceneFx, m: Movie | null): void {
    const name = t(sceneFxKind(x.kind)?.name ?? x.kind);
    setText(q(n, '.fm-scfx-name'), name);
    const fps = m?.fps ?? 24;
    const whole = !!m && x.start === 0 && x.end >= m.duration;
    setText(q(n, '.fm-scfx-range'), whole ? t('The whole movie') : tf('{from} to {to}', { from: timecode(x.start, fps), to: timecode(x.end, fps) }));
    setText(q(n, '.fm-scfx-amtname'), t('Strength'));
    const r = q<HTMLInputElement>(n, 'input');
    r.setAttribute('aria-label', `${t('Strength')}: ${name}`);
    setValue(r, String(Math.round(x.amount * 100)));
    if (document.activeElement !== r) this.showPct(r);
    const rm = q<HTMLButtonElement>(n, '[data-do="remove"]');
    setTitle(rm, t('Remove'));
    rm.setAttribute('aria-label', `${t('Remove')}: ${name}`);
    const from = q<HTMLButtonElement>(n, '[data-do="from"]'), to = q<HTMLButtonElement>(n, '[data-do="to"]');
    setText(from, t('From the Playhead'));
    setText(to, t('To the Playhead'));
    setTitle(from, t('The effect starts at the Playhead'));
    setTitle(to, t('The effect ends at the Playhead'));
  }

  private patchTime(): void {
    const m = this.engine.movie;
    const f = this.engine.frame;
    for (const n of this.list.children as HTMLCollectionOf<HTMLElement>) {
      const x = m?.sceneFx?.find((i) => i.id === n.dataset.key);
      if (!x) continue;
      setClass(n, 'is-now', f >= x.start && f < x.end);
      setDisabled(q<HTMLButtonElement>(n, '[data-do="from"]'), f === x.start);
      setDisabled(q<HTMLButtonElement>(n, '[data-do="to"]'), f <= x.start || f === x.end);
    }
  }
}
