// Recovery Points (Edit menu): the states kept automatically when you undo three or more steps and then act.
// Restore puts one back as a new undo step, so it can itself be undone; Delete forgets it.
import type { Engine } from '../engine/engine';
import type { RecoveryPoint } from '../engine/history';
import { Dialog } from './dialogs';
import { el, patchList, q, setDisabled, setHidden, setText } from './dom';
import { t } from './i18n';
import './../styles/shortcuts.css';

const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export class RecoveryDialog extends Dialog {
  private readonly list = el('<div class="fm-rp-list" role="list"></div>');
  private readonly empty = el('<p class="cv-note">No recovery point is kept yet. One is saved when you undo three or more steps and then make a change.</p>');

  constructor(private readonly engine: Engine) {
    super('Recovery Points', 520);
    this.body.append(this.list, this.empty, el('<p class="cv-note">The last three are kept, and they are saved inside the movie file.</p>'));
    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      const id = btn?.closest<HTMLElement>('.fm-rp-row')?.dataset.key;
      if (!btn || !id) return;
      if (btn.dataset.act === 'restore') { this.engine.restoreRecovery(id); this.close(); return; }
      this.engine.history.removeRecovery(id);
      this.render();
    });
    this.button('Done', 'primary', () => this.close());
  }

  show(): void {
    this.render();
    this.open();
  }

  private render(): void {
    const points: RecoveryPoint[] = this.engine.history.recovery;
    const fill = (n: HTMLElement, p: RecoveryPoint): void => {
      setText(q(n, '.fm-rp-what'), `${t('After')} ${p.label}`);
      setText(q(n, '.fm-rp-when'), when(p.time));
      setDisabled(q<HTMLButtonElement>(n, '[data-act="restore"]'), !this.engine.movie);
    };
    patchList(this.list, points, {
      key: (p) => p.id,
      create: (p) => { const n = el('<div class="fm-rp-row" role="listitem"><span class="fm-rp-what"></span><span class="fm-rp-when"></span><span><button class="cv-btn" type="button" data-act="restore">Restore</button> <button class="cv-btn cv-btn-ghost" type="button" data-act="delete">Delete</button></span></div>'); fill(n, p); return n; },
      update: fill,
    });
    setHidden(this.empty, points.length > 0);
  }
}
