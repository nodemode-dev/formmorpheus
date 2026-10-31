import type { Engine } from '../engine/engine';
import { HoldRepeat } from './paint-gestures';
import { loadPaintPrefs } from './paint-settings';
import { historyLabel } from './history-label';
import { t } from './i18n';
import { el, setClass, setStyleVar, setText } from './dom';
import '../styles/movie-settings.css';

/** The Undo and Redo buttons of the Stage and the status bar repeat while held, after the Rapid undo delay. */
const BUTTONS = '.fm-stage-undo [data-cmd="undo"], .fm-stage-undo [data-cmd="redo"], .cv-status [data-cmd="undo"], .cv-status [data-cmd="redo"]';
const SHOW_MS = 1500;

/** A banner at the top of the Stage naming the step just undone or redone. A burst of steps is one banner with a count. */
class Banner {
  private readonly node = el<HTMLElement>('<div class="fm-undo-banner" role="status" aria-live="polite"><span class="fm-undo-text"></span></div>');
  private timer = 0;
  private verb = '';
  private count = 0;

  constructor(private readonly host: () => HTMLElement | null) {
    document.body.appendChild(this.node);
  }

  show(verb: 'Undo' | 'Redo', label: string): void {
    this.count = this.verb === verb && this.timer ? this.count + 1 : 1;
    this.verb = verb;
    const name = historyLabel(label);
    setText(this.node.firstElementChild, `${t(verb)} ${name}${this.count > 1 ? `, ${this.count} ${t('steps')}` : ''}`);
    const r = this.host()?.getBoundingClientRect();
    if (r) { setStyleVar(this.node, '--ub-x', `${Math.round(r.left + r.width / 2)}px`); setStyleVar(this.node, '--ub-y', `${Math.round(r.top + 14)}px`); }
    setClass(this.node, 'is-on', true);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = 0; this.verb = ''; setClass(this.node, 'is-on', false); }, SHOW_MS);
  }
}

/** Wires the banner to every undo and redo (button, key, gesture) and the hold-repeat to the Stage and status buttons. */
export function installUndoUi(engine: Engine, stageHost: () => HTMLElement | null, run: (cmd: 'undo' | 'redo') => void): void {
  const banner = new Banner(stageHost);
  engine.on('notice', (n) => {
    const m = /^(Undo|Redo) (.*)$/.exec(n.text);
    if (m && n.kind === 'info') banner.show(m[1] as 'Undo' | 'Redo', m[2]);
  });
  const repeat = new HoldRepeat(loadPaintPrefs().undoDelay, 80);
  let swallow = false;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !(e.target instanceof Element)) return;
    const b = e.target.closest<HTMLButtonElement>(BUTTONS);
    if (!b || b.disabled) return;
    const cmd = b.dataset.cmd === 'redo' ? 'redo' : 'undo';
    repeat.delay = loadPaintPrefs().undoDelay;
    try { b.setPointerCapture(e.pointerId); } catch { /* gone */ }
    swallow = true;
    repeat.start(() => run(cmd));
    const end = (): void => { repeat.stop(); b.removeEventListener('pointerup', end); b.removeEventListener('pointercancel', end); b.removeEventListener('lostpointercapture', end); };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
  }, true);
  // the press already ran the step: the click that follows must not run it again (keyboard clicks have detail 0)
  document.addEventListener('click', (e) => {
    if (!swallow || !(e.target instanceof Element) || !e.target.closest(BUTTONS)) return;
    if (e.detail === 0) return;
    swallow = false;
    e.stopPropagation();
  }, true);
}
