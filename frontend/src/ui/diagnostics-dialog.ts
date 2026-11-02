import '../styles/diagnostics.css';
import { platform } from '../platform';
import { PROBES, PencilPad, postDiagnostics, runDiagnostics, withPencil, type DiagReport, type PencilResult, type ProbeResult, type ProbeStatus } from '../platform/diagnostics';
import { Dialog } from './dialogs';
import { el, q, setClass, setDisabled, setText } from './dom';
import { t } from './i18n';
import { tf } from './i18n-fill';

const STATE_LABEL: Record<ProbeStatus | 'wait' | 'running', string> = { ok: 'Passed', warn: 'Needs attention', fail: 'Failed', skip: 'Skipped', wait: 'Waiting', running: 'Running' };

/** The iPad's Diagnostics panel: a Run button, a Pencil test pad and a list of the checks. Built once; rows and texts are patched. */
export class DiagnosticsDialog extends Dialog {
  private readonly rows = new Map<string, HTMLElement>();
  private readonly run: HTMLButtonElement;
  private readonly start: HTMLButtonElement;
  private readonly cap: HTMLInputElement;
  private readonly sent: HTMLElement;
  private readonly left: HTMLElement;
  private readonly live: HTMLElement;
  private readonly pad: PencilPad;
  private busy = false;
  private abort: AbortController | null = null;
  private report: DiagReport | null = null;

  constructor() {
    super('Diagnostics', 640);
    const list = PROBES.map((p) => `<li class="fm-diag-row" data-id="${p.id}" data-state="wait"><span class="fm-diag-dot"></span><span class="fm-diag-name"></span><span class="fm-diag-sum"></span><span class="fm-diag-state"></span></li>`).join('');
    const root = el(`<div class="fm-diag">
      <p class="fm-diag-note"></p>
      <div class="fm-diag-bar">
        <button class="cv-btn cv-btn-primary fm-diag-run" type="button"></button>
        <label class="fm-diag-cap"><span class="fm-diag-cap-l"></span><input class="cv-input" type="number" min="0" max="6000" step="256" value="1536"></label>
        <span class="fm-diag-sent"></span>
      </div>
      <div class="fm-diag-pad-wrap">
        <div class="fm-diag-pad-head"><span class="fm-diag-pad-title"></span><span class="fm-diag-pad-left"></span><button class="cv-btn fm-diag-start" type="button"></button></div>
        <div class="fm-diag-pad"><canvas width="1200" height="360"></canvas></div>
        <div class="fm-diag-pad-live"></div>
      </div>
      <ul class="fm-diag-list">${list}</ul>
    </div>`);
    this.body.appendChild(root);
    setText(q(root, '.fm-diag-note'), t('These checks run on this iPad and send their results to the app, which saves them as a file. Use the Pencil test first so its numbers are included.'));
    setText(q(root, '.fm-diag-cap-l'), t('Memory test limit (MB)'));
    setText(q(root, '.fm-diag-pad-title'), t('Pencil test'));
    this.run = q<HTMLButtonElement>(root, '.fm-diag-run');
    this.start = q<HTMLButtonElement>(root, '.fm-diag-start');
    this.cap = q<HTMLInputElement>(root, '.fm-diag-cap input');
    this.sent = q(root, '.fm-diag-sent');
    this.left = q(root, '.fm-diag-pad-left');
    this.live = q(root, '.fm-diag-pad-live');
    setText(this.run, t('Run Diagnostics'));
    setText(this.start, t('Start Pencil test'));
    for (const li of Array.from(root.querySelectorAll<HTMLElement>('.fm-diag-row'))) {
      const id = li.dataset.id ?? '';
      const p = PROBES.find((x) => x.id === id);
      setText(q(li, '.fm-diag-name'), t(p?.title ?? id));
      setText(q(li, '.fm-diag-state'), t(STATE_LABEL.wait));
      this.rows.set(id, li);
    }
    this.pad = new PencilPad(q(root, '.fm-diag-pad'), q<HTMLCanvasElement>(root, '.fm-diag-pad canvas'), (i) => {
      setText(this.left, `${i.left.toFixed(1)} s`);
      if (i.live) setText(this.live, i.live);
    }, (r) => this.padDone(r));
    this.start.addEventListener('click', () => {
      if (this.pad.isRunning) return;
      setDisabled(this.start, true);
      setText(this.live, t('Draw, hover and twist the Pencil on the pad now.'));
      this.pad.start();
    });
    this.run.addEventListener('click', () => { if (this.busy) this.abort?.abort(); else void this.go(); });
    platform.bridge.on('diagSaved', (p) => {
      setText(this.sent, p.ok === true ? `${t('Results saved.')} ${typeof p.name === 'string' ? p.name : ''}` : t('The app could not save the results.'));
    });
    this.button('Close', 'primary', () => this.close());
  }

  show(): void {
    this.open(this.start);
  }

  private padDone(r: PencilResult): void {
    setDisabled(this.start, false);
    setText(this.left, '');
    setText(this.live, `${t('Pencil test finished.')} ${r.sampleRateHz} Hz · ${tf('{n} samples', { n: r.penSamples })}`);
    setText(this.start, t('Run the Pencil test again'));
    // results already sent get the Pencil numbers added
    if (this.report && !this.busy) {
      const next = withPencil(this.report, () => this.pad.last);
      this.report = next;
      for (const p of next.probes) if (p.id === 'pencil' || p.id === 'latency') this.paint(p.id, p.status, p.summary);
      setText(this.sent, postDiagnostics(next) ? t('Results sent to the app.') : t('The results are ready, but no app is listening for them.'));
    }
  }

  private paint(id: string, state: ProbeStatus | 'wait' | 'running', sum = ''): void {
    const li = this.rows.get(id);
    if (!li) return;
    if (li.dataset.state !== state) li.dataset.state = state;
    setText(q(li, '.fm-diag-state'), t(STATE_LABEL[state]));
    setText(q(li, '.fm-diag-sum'), sum);
    setClass(li, 'is-done', state !== 'wait' && state !== 'running');
  }

  private async go(): Promise<void> {
    this.busy = true;
    this.abort = new AbortController();
    setText(this.run, t('Stop'));
    setText(this.sent, '');
    for (const id of this.rows.keys()) this.paint(id, 'wait');
    const mb = Number(this.cap.value);
    const report = await runDiagnostics({
      memoryCapMB: Number.isFinite(mb) ? Math.max(0, Math.min(6000, mb)) : 1536,
      pencil: () => this.pad.last,
      signal: this.abort.signal,
      onProbe: (id, state, res?: ProbeResult) => this.paint(id, state === 'running' ? 'running' : (res?.status ?? 'ok'), res?.summary ?? ''),
    });
    this.report = report;
    this.busy = false;
    this.abort = null;
    setText(this.run, t('Run Diagnostics'));
    setText(this.sent, postDiagnostics(report) ? t('Results sent to the app.') : t('The results are ready, but no app is listening for them.'));
  }
}
