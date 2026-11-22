import notice from '../../../NOTICE.md?raw';
import '../styles/onboarding.css';
import { capabilities } from '../io/api';
import { platform } from '../platform';
import { VERSION } from '../version';
import { Dialog } from './dialogs';
import { el, q, setHidden, setText } from './dom';
import { renderMarkdown } from './help-view';
import { t } from './i18n';

/** About formmorpheus: the version of the interface and of the engine, the credits, and the licenses (NOTICE.md,
 *  bundled at build time and drawn once, the first time they are opened). */
export class AboutDialog extends Dialog {
  private readonly engine: HTMLElement;
  private readonly lic: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private drawn = false;

  constructor() {
    super('About FormMorpheus', 520);
    q(this.scrim, '.cv-dialog').classList.add('fm-about-dlg');
    const root = el(`<div class="fm-about">
      <div class="fm-about-head">
        <img class="fm-about-mark" src="/mark.png" width="52" height="52" alt="" decoding="sync">
        <div><div class="fm-about-name">formmorpheus</div><div class="fm-about-by" translate="no">by nodemode.ai</div></div>
      </div>
      <dl class="fm-about-facts">
        <dt>Version</dt><dd class="fm-about-ver"></dd>
        <dt>Engine</dt><dd class="fm-about-eng"></dd>
        <dt>License</dt><dd>Apache-2.0</dd>
      </dl>
      <p class="fm-about-credits"></p>
      <button class="cv-btn fm-about-lic" type="button" aria-expanded="false">Licenses</button>
      <div class="fm-about-notice" hidden tabindex="0"></div>
    </div>`);
    this.body.appendChild(root);
    setText(q(root, '.fm-about-ver'), VERSION);
    setText(q(root, '.fm-about-credits'), t('The animation studio of the form family. Its shell, panels and colors come from the form image editor and the form effects editor, and its movie files are its own. Interface fonts are Inter and JetBrains Mono; movie files use fflate; video and sound use mediabunny.'));
    this.engine = q(root, '.fm-about-eng');
    this.lic = q(root, '.fm-about-notice');
    this.toggle = q<HTMLButtonElement>(root, '.fm-about-lic');
    this.toggle.addEventListener('click', () => {
      if (!this.drawn) { this.drawn = true; renderMarkdown(notice, this.lic); }
      const show = this.lic.hidden;
      setHidden(this.lic, !show);
      this.toggle.setAttribute('aria-expanded', String(show));
    });
    // iPad only: the device checks the owner runs (built on first use, from a template, before it is shown)
    if (platform.kind === 'ipad') {
      const diag = el<HTMLButtonElement>('<button class="cv-btn fm-about-diag" type="button"></button>');
      setText(diag, t('Diagnostics...'));
      this.toggle.after(diag);
      let dlg: { show(): void } | null = null;
      diag.addEventListener('click', () => {
        void import('./diagnostics-dialog').then((m) => { dlg ??= new m.DiagnosticsDialog(); dlg.show(); });
      });
    }
    this.button('Close', 'primary', () => this.close());
  }

  show(): void {
    if (this.isOpen) return;
    void capabilities().then((c) => setText(this.engine, c ? `${c.version} · ${c.platform}${c.desktop ? ' · desktop' : ''}` : t('Engine offline')));
    this.open();
  }
}
