import '../styles/tutorials.css';
import type { Engine } from '../engine/engine';
import { el, q, setClass, setHidden, setStyleVar, setText } from './dom';
import { t } from './i18n';
import { buildTutorials, type Tutorial } from './tutorial-steps';

/** Runs a guided tutorial on a practice movie: a ring on the real control and a small card beside it. Each step waits
 *  until the person has done it (or clicked the control), then moves on by itself; "Skip this step" and "Stop" are always
 *  there. Built once; steps only change text, classes and position variables. Reuses the first-run tour's card look. */
const KEY = 'formmorpheus.tutorialsDone';

export const tutorialsDone = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
};
const markDone = (id: string): void => {
  try { const d = tutorialsDone(); if (!d.includes(id)) localStorage.setItem(KEY, JSON.stringify([...d, id])); } catch { /* shown again */ }
};

export interface CoachDeps {
  engine: Engine;
  /** Resolves true when the movie that is open may be replaced (the person saved or discarded). */
  askToKeep: () => Promise<boolean>;
  closeHome: () => void;
}

export class TutorialCoach {
  private readonly root = el(`<div class="fm-tut" hidden>
    <div class="fm-tut-ring"></div>
    <div class="fm-tour-card fm-tut-card" role="dialog" aria-live="polite" aria-label="Tutorial">
      <div class="fm-tour-count"></div>
      <div class="fm-tour-title"></div>
      <p class="fm-tour-text"></p>
      <div class="fm-tut-wait"><span class="fm-tut-pulse"></span><span class="fm-tut-wait-text"></span></div>
      <div class="fm-tour-dots"></div>
      <div class="fm-tour-actions">
        <button class="cv-btn cv-btn-ghost" type="button" data-t="stop">Stop</button>
        <span class="fm-tour-gap"></span>
        <button class="cv-btn" type="button" data-t="skip">Skip this step</button>
        <button class="cv-btn cv-btn-primary" type="button" data-t="more" hidden>Next tutorial</button>
        <button class="cv-btn cv-btn-primary" type="button" data-t="end" hidden>Done</button>
      </div>
    </div>
  </div>`);
  private readonly card = q(this.root, '.fm-tut-card');
  private readonly ring = q(this.root, '.fm-tut-ring');
  private readonly dotsBox = q(this.root, '.fm-tour-dots');
  private readonly skip = q<HTMLButtonElement>(this.root, '[data-t="skip"]');
  private readonly more = q<HTMLButtonElement>(this.root, '[data-t="more"]');
  private readonly end = q<HTMLButtonElement>(this.root, '[data-t="end"]');
  private readonly wait = q(this.root, '.fm-tut-wait');
  private dots: HTMLElement[] = [];
  private list: Tutorial[] = [];
  private tut: Tutorial | null = null;
  private at = 0;
  private timer = 0;
  private last = '';
  private clickHit = false;
  private starting = false;
  /** Called when a tutorial starts or stops, so the Help Center can refresh its ticks. */
  onChange: (() => void) | null = null;

  constructor(private readonly deps: CoachDeps) {
    this.root.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t;
      if (a === 'stop' || a === 'end') this.stop();
      else if (a === 'skip') this.go(this.at + 1);
      else if (a === 'more') this.runNext();
    });
    // a click on the ringed control counts for steps that only ask for a click; the control still gets it
    window.addEventListener('click', (e) => {
      if (!this.tut || this.root.hidden) return;
      const target = this.target();
      if (target && (e.target as Node | null) && target.contains(e.target as Node)) this.clickHit = true;
    }, true);
    window.addEventListener('resize', () => { if (this.tut) this.place(true); });
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
  }

  get isActive(): boolean { return this.tut !== null; }
  get tutorials(): readonly Tutorial[] { return this.list; }

  /** The tutorials' titles and notes, for the Help Center's list (the steps are rebuilt at each start). */
  catalog(): readonly Tutorial[] {
    if (!this.list.length) this.fresh();
    return this.list;
  }

  /** Builds the step lists (the practice movie's checks read the engine, so they are made once per start). */
  private fresh(): void { this.list = buildTutorials(this.deps.engine, t); }

  /** Starts one tutorial by id on a new practice movie. */
  async start(id: string): Promise<boolean> {
    if (this.starting) return false;
    this.starting = true;
    try {
      this.stop(true);
      if (this.deps.engine.movie && !(await this.deps.askToKeep())) return false;
      this.fresh();
      const tut = this.list.find((x) => x.id === id);
      if (!tut) return false;
      this.deps.closeHome();
      tut.prepare();
      this.tut = tut;
      this.rebuildDots(tut.steps.length);
      setHidden(this.root, false);
      this.onChange?.();
      this.go(0);
      window.clearInterval(this.timer);
      this.timer = window.setInterval(() => this.tick(), 220);
      return true;
    } finally { this.starting = false; }
  }

  /** The dots are made when a tutorial starts (the card is not showing anything yet), not while it runs. */
  private rebuildDots(n: number): void {
    this.dotsBox.replaceChildren();
    this.dots = [];
    for (let i = 0; i < n; i++) { const d = el('<span class="fm-tour-dot"></span>'); this.dotsBox.appendChild(d); this.dots.push(d); }
  }

  stop(quiet = false): void {
    window.clearInterval(this.timer);
    if (!this.tut) return;
    this.tut = null;
    setHidden(this.root, true);
    if (!quiet) this.onChange?.();
  }

  private runNext(): void {
    const i = this.list.findIndex((x) => x.id === this.tut?.id);
    const next = this.list[i + 1];
    if (next) void this.start(next.id); else this.stop();
  }

  private target(): HTMLElement | null {
    const s = this.tut?.steps[this.at];
    if (!s) return null;
    const n = typeof s.target === 'string' ? document.querySelector<HTMLElement>(s.target) : s.target();
    return n && n.offsetParent !== null ? n : null;
  }

  private go(i: number): void {
    const tut = this.tut;
    if (!tut) return;
    this.clickHit = false;
    this.last = '';
    if (i >= tut.steps.length) { this.finish(tut); return; }
    this.at = Math.max(0, i);
    const s = tut.steps[this.at];
    s.enter?.();
    setText(q(this.root, '.fm-tour-count'), `${t(tut.title)} · ${this.at + 1} / ${tut.steps.length}`);
    setText(q(this.root, '.fm-tour-title'), t(s.title));
    setText(q(this.root, '.fm-tour-text'), t(s.text));
    setText(q(this.root, '.fm-tut-wait-text'), t(s.click ? 'Waiting for you to click it' : 'Waiting for you to do it'));
    setHidden(this.wait, false);
    this.dots.forEach((d, n) => { setClass(d, 'is-current', n === this.at); setClass(d, 'is-done', n < this.at); });
    setHidden(this.skip, false);
    setHidden(this.more, true);
    setHidden(this.end, true);
    this.place(true);
  }

  private finish(tut: Tutorial): void {
    markDone(tut.id);
    const hasNext = this.list.findIndex((x) => x.id === tut.id) < this.list.length - 1;
    setText(q(this.root, '.fm-tour-count'), t(tut.title));
    setText(q(this.root, '.fm-tour-title'), t('Well done'));
    setText(q(this.root, '.fm-tour-text'), t('You finished this tutorial. The practice movie stays open: keep playing with it, or close it without saving.'));
    setHidden(this.wait, true);
    this.dots.forEach((d) => { setClass(d, 'is-current', false); setClass(d, 'is-done', true); });
    setHidden(this.skip, true);
    setHidden(this.more, !hasNext);
    setHidden(this.end, false);
    this.at = tut.steps.length;
    ringOff(this.ring);
    this.card.classList.add('is-center');
    this.place(true);
    this.onChange?.();
  }

  private tick(): void {
    const tut = this.tut;
    if (!tut || this.at >= tut.steps.length) return;
    const s = tut.steps[this.at];
    let done = false;
    try { done = (s.until?.() ?? false) || (!!s.click && this.clickHit); } catch { done = false; }
    if (done) { this.go(this.at + 1); return; }
    this.place(false);
  }

  /** Puts the ring on the target and the card beside it; a changed rectangle is the only thing that writes. */
  private place(force: boolean): void {
    const vw = window.innerWidth, vh = window.innerHeight, pad = 6;
    const finished = this.at >= (this.tut?.steps.length ?? 0);
    const target = finished ? null : this.target();
    const r = target?.getBoundingClientRect();
    const key = `${r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : 'none'}|${this.at}|${vw}x${vh}`;
    if (!force && key === this.last) return;
    this.last = key;
    setClass(this.card, 'is-center', !r);
    const cw = Math.min(340, vw - 32), ch = this.card.offsetHeight || 190;
    setStyleVar(this.card, '--w', `${cw}px`);
    if (!r) {
      ringOff(this.ring);
      setStyleVar(this.card, '--x', `${Math.max(16, vw - cw - 20)}px`);
      setStyleVar(this.card, '--y', `${Math.max(12, vh - ch - 56)}px`);
      return;
    }
    const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
    const w = Math.min(vw - x, r.width + pad * 2), h = Math.min(vh - y, r.height + pad * 2);
    setClass(this.ring, 'is-off', false);
    setStyleVar(this.ring, '--x', `${x}px`);
    setStyleVar(this.ring, '--y', `${y}px`);
    setStyleVar(this.ring, '--w', `${w}px`);
    setStyleVar(this.ring, '--h', `${h}px`);
    // a row of an open menu: the card goes beside the whole menu so it never covers the other rows
    const menu = target?.closest<HTMLElement>('.fm-pop, .cv-menu')?.getBoundingClientRect();
    if (menu) {
      const side = menu.left - cw - 14 >= 12 ? menu.left - cw - 14 : Math.min(vw - cw - 12, menu.right + 14);
      setStyleVar(this.card, '--x', `${side}px`);
      setStyleVar(this.card, '--y', `${Math.max(12, Math.min(vh - ch - 12, y))}px`);
      return;
    }
    let cy = y + h + 12;
    let cx = Math.min(vw - cw - 16, Math.max(16, r.left + r.width / 2 - cw / 2));
    if (cy + ch > vh - 12) cy = y - ch - 12;
    if (cy < 12) { cy = y + 16; cx = Math.max(16, Math.min(vw - cw - 16, r.right - cw - 16)); } // a big target: the card sits inside its top corner
    setStyleVar(this.card, '--x', `${cx}px`);
    setStyleVar(this.card, '--y', `${Math.max(12, cy)}px`);
  }
}

function ringOff(ring: HTMLElement): void { setClass(ring, 'is-off', true); }
