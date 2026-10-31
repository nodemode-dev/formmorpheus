import '../styles/shell-f3s.css';
import type { Engine } from '../engine/engine';
import { api } from '../io/api';
import { el } from './dom';
import { Popover } from './popover';
import { toast } from './toast';
import { t } from './i18n';

/** The open movie's name in the middle of the title bar. A click opens a small popup to rename it, like the Theater's
 *  title popup. A movie not yet saved reads "Untitled" until it has a name in the library. */
export function movieLabel(engine: Engine): string {
  const m = engine.movie;
  if (!m) return '';
  // every movie lives in the Theater from creation and saves itself: no unsaved dot, no "Untitled" state
  return !engine.libraryName && m.name === 'Untitled Movie' ? t('Untitled') : m.name;
}

export class TitleName {
  private readonly pop = new Popover('cv-th-title', 260);
  private readonly input = el<HTMLInputElement>('<input class="cv-th-title-input" type="text" maxlength="80" spellcheck="false" aria-label="Name">');

  constructor(private readonly btn: HTMLElement, private readonly engine: Engine) {
    btn.setAttribute('role', 'button');
    btn.tabIndex = 0;
    btn.title = t('Rename movie');
    this.pop.body.appendChild(this.input);
    btn.addEventListener('click', () => this.open());
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.open(); } });
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const to = this.input.value.trim();
      this.pop.hide();
      void this.rename(to).catch((err: Error) => toast(err.message, 'error'));
    });
  }

  private open(): void {
    const m = this.engine.movie;
    if (!m) return;
    this.input.value = this.engine.libraryName ?? (m.name === 'Untitled Movie' ? '' : m.name);
    this.pop.showFor(this.btn, 'below');
    this.input.focus();
    this.input.select();
  }

  private async rename(to: string): Promise<void> {
    const e = this.engine, m = e.movie;
    if (!m || !to || to === m.name) return;
    const from = e.libraryName;
    if (from && to !== from) {
      const item = await api.renameMovie(from, to);
      e.libraryName = item.name;
      e.nameMovie(item.name);
    } else {
      e.nameMovie(to);
    }
  }
}
