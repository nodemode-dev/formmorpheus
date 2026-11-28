// The strip of scene cards above the Timeline: built once, cards patched by scene id, pictures drawn when idle.
import type { Engine } from '../engine/engine';
import type { Renderer } from '../engine/render';
import { focusedScene, sceneAt, sceneSpans, type SceneSpan } from '../engine/scene-marks';
import { durationLabel } from '../engine/time';
import type { Movie } from '../engine/types';
import { el, patchList, q, setClass, setHidden, setText, setTitle } from './dom';
import { t } from './i18n';
import { tf } from './i18n-fill';
import { icon } from './icons';
import { Popover, popRow, popSep, type PopRow } from './popover';
import '../styles/scene-strip.css';

export type SceneAct = 'go' | 'rename' | 'focus' | 'duplicate' | 'earlier' | 'later' | 'add-after' | 'delete-cut' | 'delete';

export interface SceneStripDeps {
  can(act: SceneAct, id: string): boolean;
  checked(act: SceneAct, id: string): boolean;
  run(act: SceneAct, id: string): void;
  rename(id: string, name: string): void;
  addAtPlayhead(): void;
}

const PIC_W = 56;
const PIC_H = 32;
const DPR = 2;

const MENU: Array<{ act: SceneAct; icon: string; label: string; danger?: boolean; check?: boolean } | '-'> = [
  { act: 'go', icon: 'play', label: 'Go to Scene' },
  { act: 'rename', icon: 'rename', label: 'Rename Scene' },
  { act: 'focus', icon: 'eye', label: 'Focus on Scene', check: true },
  '-',
  { act: 'duplicate', icon: 'duplicate', label: 'Duplicate Scene' },
  { act: 'earlier', icon: 'chevronLeft', label: 'Move Scene Earlier' },
  { act: 'later', icon: 'chevronRight', label: 'Move Scene Later' },
  { act: 'add-after', icon: 'plus', label: 'Add Empty Scene After' },
  '-',
  { act: 'delete-cut', icon: 'cut', label: 'Delete Cut, Keep Content' },
  { act: 'delete', icon: 'trash', label: 'Delete Scene and Content', danger: true },
];

interface Card { node: HTMLElement; main: HTMLButtonElement; pic: HTMLCanvasElement; name: HTMLElement; len: HTMLElement; input: HTMLInputElement; drawn: string }

export class SceneStrip {
  readonly root = el<HTMLElement>(`<div class="fm-scenes" role="region">
<button class="fm-scenes-new" type="button">${icon('clapper', 16)}<span class="fm-scenes-newlabel"></span></button>
<div class="fm-scenes-list" role="list"></div>
<button class="fm-scenes-add fm-ghost-btn" type="button">${icon('plus', 16)}</button>
</div>`);
  private readonly list = q<HTMLElement>(this.root, '.fm-scenes-list');
  private readonly newBtn = q<HTMLButtonElement>(this.root, '.fm-scenes-new');
  private readonly addBtn = q<HTMLButtonElement>(this.root, '.fm-scenes-add');
  private readonly cards = new Map<string, Card>();
  private readonly pop = new Popover('fm-scenes-menu');
  private readonly rows = new Map<SceneAct, PopRow>();
  private menuFor = '';
  private editing = '';
  private picTimer = 0;
  private picTries = 0;
  private shownMovie: Movie | null = null;

  constructor(private readonly engine: Engine, private readonly renderer: Renderer, private readonly deps: SceneStripDeps) {
    this.root.setAttribute('aria-label', t('Scenes'));
    setText(q(this.root, '.fm-scenes-newlabel'), t('New Scene at Playhead'));
    setTitle(this.newBtn, t('Cut the movie into scenes: the first cut goes at the Playhead'));
    const addLabel = t('New Scene at Playhead');
    setTitle(this.addBtn, addLabel);
    this.addBtn.setAttribute('aria-label', addLabel);
    this.newBtn.addEventListener('click', () => this.deps.addAtPlayhead());
    this.addBtn.addEventListener('click', () => this.deps.addAtPlayhead());
    for (const item of MENU) {
      if (item === '-') { this.pop.body.appendChild(popSep()); continue; }
      const row = popRow(item.icon, t(item.label), { danger: item.danger, check: item.check });
      row.el.addEventListener('click', () => {
        if (row.el.classList.contains('is-disabled')) return;
        const id = this.menuFor;
        this.pop.hide();
        this.deps.run(item.act, id);
      });
      this.rows.set(item.act, row);
      this.pop.body.appendChild(row.el);
    }
    this.list.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || this.list.scrollWidth <= this.list.clientWidth) return;
      e.preventDefault();
      this.list.scrollLeft += e.deltaY;
    }, { passive: false });
    engine.on('movie', () => this.patch());
    engine.on('projects', () => this.patch());
    engine.on('time', () => this.patchCurrent());
    engine.on('playing', (on) => { if (!on) this.schedulePics(); });
    this.patch();
  }

  /** Opens the in-place name field of a scene's card. */
  rename(id: string): void {
    const card = this.cards.get(id);
    const m = this.engine.movie;
    const span = m ? sceneSpans(m).find((s) => s.mark.id === id) : null;
    if (!card || !span) return;
    this.editing = id;
    card.input.value = span.mark.name;
    setHidden(card.input, false);
    setClass(card.node, 'is-editing', true);
    card.node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    card.input.focus();
    card.input.select();
  }

  private endRename(card: Card, id: string, keep: boolean): void {
    if (this.editing !== id) return;
    this.editing = '';
    const value = card.input.value;
    setHidden(card.input, true);
    setClass(card.node, 'is-editing', false);
    if (keep) this.deps.rename(id, value);
  }

  private makeCard(span: SceneSpan): HTMLElement {
    const node = el<HTMLElement>(`<div class="fm-scene" role="listitem">
<button class="fm-scene-main" type="button"><canvas class="fm-scene-pic" width="${PIC_W * DPR}" height="${PIC_H * DPR}" aria-hidden="true"></canvas><span class="fm-scene-text"><span class="fm-scene-name"></span><span class="fm-scene-len"></span></span><span class="fm-scene-focus">${icon('eye', 12)}</span></button>
<input class="fm-scene-input" type="text" spellcheck="false" autocomplete="off" maxlength="80" hidden>
<button class="fm-scene-more fm-ghost-btn" type="button">${icon('dots', 14)}</button>
</div>`);
    const id = span.mark.id;
    const card: Card = {
      node,
      main: q<HTMLButtonElement>(node, '.fm-scene-main'),
      pic: q<HTMLCanvasElement>(node, '.fm-scene-pic'),
      name: q<HTMLElement>(node, '.fm-scene-name'),
      len: q<HTMLElement>(node, '.fm-scene-len'),
      input: q<HTMLInputElement>(node, '.fm-scene-input'),
      drawn: '',
    };
    const more = q<HTMLButtonElement>(node, '.fm-scene-more');
    more.setAttribute('aria-label', t('Scene actions'));
    setTitle(more, t('Scene actions'));
    card.input.setAttribute('aria-label', t('Scene name'));
    card.main.addEventListener('click', () => this.deps.run('go', id));
    card.main.addEventListener('dblclick', (e) => { e.preventDefault(); this.deps.run('rename', id); });
    card.main.addEventListener('contextmenu', (e) => { e.preventDefault(); this.openMenu(id, null, e.clientX, e.clientY); });
    more.addEventListener('click', () => this.openMenu(id, more));
    card.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.endRename(card, id, true); card.main.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.endRename(card, id, false); card.main.focus(); }
      e.stopPropagation();
    });
    card.input.addEventListener('blur', () => this.endRename(card, id, true));
    this.cards.set(id, card);
    this.updateCard(card, span);
    return node;
  }

  private updateCard(card: Card, span: SceneSpan): void {
    const m = this.engine.movie;
    if (!m) return;
    setText(card.name, span.mark.name);
    setText(card.len, durationLabel(span.end - span.start, m.fps));
    setTitle(card.main, tf('{name} · click to go to it, double-click to rename', { name: span.mark.name }));
    card.main.setAttribute('aria-label', tf('Go to {name}', { name: span.mark.name }));
  }

  private openMenu(id: string, anchor: HTMLElement | null, x = 0, y = 0): void {
    this.menuFor = id;
    for (const [act, row] of this.rows) {
      row.setDisabled(!this.deps.can(act, id));
      row.setChecked(this.deps.checked(act, id));
    }
    if (anchor) this.pop.showFor(anchor, 'above');
    else this.pop.showAt(x, y);
  }

  patch(): void {
    const m = this.engine.movie;
    const spans = m ? sceneSpans(m) : [];
    const empty = spans.length === 0;
    setHidden(this.newBtn, !empty);
    setHidden(this.list, empty);
    setHidden(this.addBtn, empty);
    setClass(this.root, 'is-empty', empty);
    patchList(this.list, spans, {
      key: (s) => s.mark.id,
      create: (s) => this.makeCard(s),
      update: (node, s) => { const c = this.cards.get(s.mark.id); if (c && c.node === node) this.updateCard(c, s); },
    });
    for (const id of [...this.cards.keys()]) if (!spans.some((s) => s.mark.id === id)) this.cards.delete(id);
    if (this.menuFor && !this.cards.has(this.menuFor)) this.pop.hide();
    this.patchCurrent();
    if (m !== this.shownMovie) { this.shownMovie = m; this.picTries = 0; this.schedulePics(); }
  }

  private patchCurrent(): void {
    const m = this.engine.movie;
    if (!m) return;
    const now = sceneAt(m, this.engine.frame)?.mark.id ?? '';
    const focus = focusedScene(m)?.mark.id ?? '';
    for (const [id, c] of this.cards) {
      setClass(c.node, 'is-current', id === now);
      setClass(c.node, 'is-focus', id === focus);
      c.main.setAttribute('aria-current', id === now ? 'true' : 'false');
    }
    setClass(this.root, 'is-focused', !!focus);
  }

  private schedulePics(delay = 350): void {
    window.clearTimeout(this.picTimer);
    this.picTimer = window.setTimeout(() => this.drawPics(), delay);
  }

  private drawPics(): void {
    const m = this.engine.movie;
    if (!m || this.engine.playing) return;
    let pending = false;
    for (const s of sceneSpans(m)) {
      const card = this.cards.get(s.mark.id);
      if (!card) continue;
      const key = `${this.engine.revision}:${s.start}`;
      if (card.drawn === key) continue;
      const ctx = card.pic.getContext('2d');
      if (!ctx) continue;
      const W = card.pic.width, H = card.pic.height;
      const k = Math.min(W / m.width, H / m.height);
      const w = m.width * k, h = m.height * k;
      ctx.clearRect(0, 0, W, H);
      try {
        this.renderer.drawFrame(ctx, m, Math.min(s.start, m.duration - 1), { scale: k, ox: (W - w) / 2, oy: (H - h) / 2, width: W, height: H }, { backstage: false, background: m.background, transparentChecker: null });
      } catch { continue; }
      if (this.renderer.takeComplete()) card.drawn = key; else pending = true;
    }
    if (pending && this.picTries++ < 6) this.schedulePics(600);
  }
}
