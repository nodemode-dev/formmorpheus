import notice from '../../../NOTICE.md?raw';
import '../styles/onboarding.css';
import { capabilities } from '../io/api';
import { VERSION } from '../version';
import { Dialog } from './dialogs';
import { el, q, setHidden, setText } from './dom';
import { renderMarkdown } from './help-view';
import { icon } from './icons';
import { t } from './i18n';

/** About formmorpheus: the version of the interface and of the engine, the credits, and the licenses (NOTICE.md,
 *  bundled at build time and drawn once, the first time they are opened). */
export class AboutDialog extends Dialog {
  private readonly engine: HTMLElement;
  private readonly lic: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private drawn = false;

  constructor() {
    super('About formmorpheus', 520);
    q(this.scrim, '.cv-dialog').classList.add('fm-about-dlg');
    const root = el(`<div class="fm-about">
      <div class="fm-about-head">
        <span class="fm-about-mark">${icon('film', 30)}</span>
        <div><div class="fm-about-name">formmorpheus</div><div class="fm-about-by">by NodeMode</div></div>
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
    this.button('Close', 'primary', () => this.close());
  }

  show(): void {
    if (this.isOpen) return;
    void capabilities().then((c) => setText(this.engine, c ? `${c.version} · ${c.platform}${c.desktop ? ' · desktop' : ''}` : t('Engine offline')));
    this.open();
  }
}
