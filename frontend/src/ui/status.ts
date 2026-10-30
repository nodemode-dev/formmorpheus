import type { Engine } from '../engine/engine';
import { durationLabel } from '../engine/time';
import { el, pendingClass, q, setClass, setStyleVar, setText, setTitle } from './dom';
import { icon } from './icons';
import { JobsList } from './jobs-list';

export const SERVICE_NOTE = 'The engine service saves and opens movies in the library. Start it with ./formmorpheus.';

const MODE_HINT: Record<string, string> = {
  compose: 'Compose · drag content in time and between tracks, trim its edges, right-click for options',
  perform: 'Perform · keyframes are recorded from live gestures (arrives with Phase 7)',
  keyframe: 'Keyframe · tap the pill on the Playhead for Action, drag the Stage box to set keys, right-click a lane for easing',
};

export class StatusBar {
  private readonly dims: HTMLElement;
  private readonly engineText: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly busy: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly jobs: JobsList;
  private errorTimer = 0;
  private dismiss: (() => void) | null = null;

  constructor(host: HTMLElement, private readonly engine: Engine) {
    host.insertAdjacentHTML('beforeend', `<div class="cv-st-tools"><button class="cv-st-btn" type="button" data-cmd="undo" title="Undo" aria-label="Undo">${icon('undo', 14)}</button><button class="cv-st-btn" type="button" data-cmd="redo" title="Redo" aria-label="Redo">${icon('redo', 14)}</button></div>
      <span class="cv-st-dims"></span><span class="cv-st-hint"></span>
      <span class="cv-st-busy" role="button" tabindex="0" title="Jobs"><span class="cv-st-busy-label">Working</span><span class="cv-st-bar" role="progressbar"><i></i></span><span class="cv-st-steps"></span></span>
      <span class="cv-st-engine">Engine: checking</span>`);
    this.dims = q(host, '.cv-st-dims');
    this.hint = q(host, '.cv-st-hint');
    this.busy = q(host, '.cv-st-busy');
    this.engineText = q(host, '.cv-st-engine');
    this.undoBtn = q<HTMLButtonElement>(host, '[data-cmd="undo"]');
    this.redoBtn = q<HTMLButtonElement>(host, '[data-cmd="redo"]');
    this.jobs = new JobsList(engine, this.busy);
    this.busy.addEventListener('click', () => this.jobs.toggle());
    engine.on('movie', () => this.syncDims());
    engine.on('projects', () => { this.syncDims(); this.syncHistory(); });
    engine.on('history', () => this.syncHistory());
    engine.on('mode', () => this.syncHint());
    engine.on('progress', () => this.syncProgress());
    engine.on('notice', (n) => { if (n.kind === 'error') this.flashError(n.text); });
    this.syncDims();
    this.syncHistory();
    this.syncHint();
  }

  setEngine(text: string, note = ''): void {
    setText(this.engineText, text);
    setTitle(this.engineText, note);
  }

  private syncDims(): void {
    const m = this.engine.movie;
    setText(this.dims, m ? `${m.width} × ${m.height} px · ${m.fps} fps · ${durationLabel(m.duration, m.fps)}` : '');
  }

  private syncHistory(): void {
    const h = this.engine.history;
    if (this.undoBtn.disabled !== !h.canUndo) this.undoBtn.disabled = !h.canUndo;
    if (this.redoBtn.disabled !== !h.canRedo) this.redoBtn.disabled = !h.canRedo;
    setTitle(this.undoBtn, h.canUndo ? `Undo ${h.undoLabel}` : 'Undo');
    setTitle(this.redoBtn, h.canRedo ? `Redo ${h.redoLabel}` : 'Redo');
  }

  private syncHint(): void {
    if (this.errorTimer) return;
    setClass(this.hint, 'is-error', false);
    const text = MODE_HINT[this.engine.mode] ?? '';
    setText(this.hint, text);
    setTitle(this.hint, text);
  }

  private flashError(text: string): void {
    window.clearTimeout(this.errorTimer);
    setClass(this.hint, 'is-error', true);
    setText(this.hint, text);
    setTitle(this.hint, text);
    this.errorTimer = window.setTimeout(() => { this.errorTimer = 0; this.syncHint(); }, 6000);
  }

  private syncProgress(): void {
    const jobs = this.engine.jobs;
    if (jobs.length > 0 && !this.dismiss) this.dismiss = pendingClass(this.busy);
    else if (jobs.length === 0 && this.dismiss) { this.dismiss(); this.dismiss = null; }
    const done = jobs.reduce((s, j) => s + j.done, 0), total = jobs.reduce((s, j) => s + j.total, 0);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    setStyleVar(q(this.busy, '.cv-st-bar'), '--p', `${pct}%`);
    setText(q(this.busy, '.cv-st-steps'), total > 0 ? `${pct}%` : '');
  }
}
