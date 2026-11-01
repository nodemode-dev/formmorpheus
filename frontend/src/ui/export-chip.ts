// The export readout that stays on screen when the Export window is closed: what is running, frames done,
// time elapsed and left, a bar, and Show and Cancel. Built once; every update patches text and a style variable.
import { clock, type Reading } from '../export/progress-meter';
import { el, q, setClass, setHidden, setStyleVar, setText, setTitle } from './dom';
import { t } from './i18n';

export interface ChipHandlers { show: () => void; cancel: () => void }

export class ExportChip {
  private readonly root = el<HTMLElement>(
    '<div class="fm-exchip" role="status" aria-live="off" hidden>' +
    '<div class="fm-exchip-main"><span class="fm-exchip-name"></span><span class="fm-exchip-count"></span></div>' +
    '<div class="fm-exchip-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>' +
    '<div class="fm-exchip-foot"><span class="fm-exchip-time"></span><span class="fm-exchip-btns">' +
    '<button type="button" class="fm-exchip-btn" data-act="show"></button><button type="button" class="fm-exchip-btn is-stop" data-act="cancel"></button></span></div></div>');
  private readonly bar = q(this.root, '.fm-exchip-bar');
  private shown = false;

  constructor(h: ChipHandlers) {
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    q(this.root, '[data-act="show"]').addEventListener('click', h.show);
    q(this.root, '[data-act="cancel"]').addEventListener('click', h.cancel);
    this.words();
  }

  /** Re-reads the labels (language change). */
  words(): void {
    setText(q(this.root, '[data-act="show"]'), t('Show'));
    setText(q(this.root, '[data-act="cancel"]'), t('Cancel'));
  }

  get visible(): boolean { return this.shown; }

  set(on: boolean): void {
    this.shown = on;
    setHidden(this.root, !on);
  }

  paint(name: string, stageLabel: string, r: Reading): void {
    const pct = Math.round(r.frac * 100);
    setText(q(this.root, '.fm-exchip-name'), `${stageLabel} · ${name}`);
    setText(q(this.root, '.fm-exchip-count'), r.total > 1 ? `${r.done} / ${r.total}` : `${pct}%`);
    setStyleVar(this.bar, '--p', `${pct}%`);
    this.bar.setAttribute('aria-valuenow', String(pct));
    const left = r.etaMs === null ? '' : ` · ${t('{time} left').replace('{time}', clock(r.etaMs))}`;
    setText(q(this.root, '.fm-exchip-time'), `${t('Elapsed {time}').replace('{time}', clock(r.elapsedMs))}${left}`);
    setTitle(this.root, `${pct}%`);
    setClass(this.root, 'is-late', r.etaMs === null && r.elapsedMs > 4000);
  }
}
