import '../styles/trash.css';
import { api, type TrashItem } from '../io/api';
import { PERSON_SVG } from './character-glyph';
import { confirmAction } from './dialogs';
import { el, patchList, q, setClass, setDisabled, setHidden, setText, setTitle } from './dom';
import { icon } from './icons';
import { dateText, onLanguage, t, tn } from './i18n';
import { toast } from './toast';

/** Home's Recently Deleted page: movies, characters and exports the user deleted, kept for 30 days. Built once; rows are patched
 *  in place by id, so a restore or delete only removes that row. */
export class HomeTrash {
  readonly root = el(`<div class="fm-trash">
    <div class="fm-trash-bar"><span class="fm-trash-note">Items stay here for 30 days, then are deleted for good.</span><button class="cv-btn" type="button" data-empty>Empty</button></div>
    <div class="fm-trash-list" role="list"></div>
    <p class="fm-trash-empty" hidden>Nothing was deleted lately.</p>
  </div>`);
  private readonly list = q(this.root, '.fm-trash-list');
  private readonly none = q(this.root, '.fm-trash-empty');
  private readonly emptyBtn = q<HTMLButtonElement>(this.root, '[data-empty]');
  private all: TrashItem[] = [];
  private run = 0;

  constructor(private readonly onCount: (n: number) => void, private readonly onRestored: () => void) {
    this.list.addEventListener('click', (e) => {
      const t = e.target as HTMLElement, row = t.closest<HTMLElement>('.fm-trash-row'), item = row ? this.all.find((i) => i.id === row.dataset.key) : undefined;
      if (!item) return;
      if (t.closest('[data-restore]')) void this.restore(item);
      else if (t.closest('[data-purge]')) void this.purge(item);
    });
    this.emptyBtn.addEventListener('click', () => void this.empty());
    onLanguage(() => this.render());   // days left and dates follow the language
    this.render();
  }

  async refresh(): Promise<void> {
    const run = ++this.run;
    const items = await api.trash().catch(() => null);
    if (run !== this.run || !items) return;
    this.all = items;
    this.render();
  }

  private async restore(item: TrashItem): Promise<void> {
    try {
      const back = await api.restoreTrash(item.id);
      const named = item.kind === 'movie' || item.kind === 'character';
      const shown = named ? back.restored.replace(/\.fmo$/i, '') : back.restored;
      const was = named ? item.name : item.original;
      if (item.kind === 'character') toast((shown !== was ? t('Restored to Characters as {name}') : t('{name} is back in Characters.')).replace('{name}', shown));
      else if (shown !== was) toast(t('Restored as {name}').replace('{name}', shown));
    } catch (err) { toast((err as Error).message); }
    await this.refresh();
    this.onRestored();
  }

  private async purge(item: TrashItem): Promise<void> {
    if (!(await confirmAction('Delete now?', t('"{name}" will be deleted for good. This cannot be undone.').replace('{name}', item.name), 'Delete Now', true))) return;
    try { await api.purgeTrash(item.id); } catch (err) { toast((err as Error).message); }
    await this.refresh();
  }

  private async empty(): Promise<void> {
    if (!this.all.length) return;
    const count = this.all.length;
    if (!(await confirmAction('Empty Recently Deleted?', tn(count, 'All {n} item will be deleted for good. This cannot be undone.', 'All {n} items will be deleted for good. This cannot be undone.'), 'Empty', true))) return;
    try { await api.purgeTrash(); } catch (err) { toast((err as Error).message); }
    await this.refresh();
  }

  private render(): void {
    this.onCount(this.all.length);
    patchList(this.list, this.all, {
      key: (i) => i.id,
      create: (i) => {
        const n = el(`<div class="fm-trash-row" role="listitem"><span class="fm-trash-glyph"></span><span class="fm-trash-name"></span><span class="fm-trash-kind"></span><span class="fm-trash-when"></span><span class="fm-trash-left"></span><span class="fm-trash-acts"><button class="cv-btn" type="button" data-restore>Restore</button><button class="cv-btn cv-btn-ghost" type="button" data-purge>Delete Now</button></span></div>`);
        q(n, '.fm-trash-glyph').innerHTML = i.kind === 'character' ? PERSON_SVG : icon(i.kind === 'movie' ? 'film' : 'download', 16);
        this.fill(n, i);
        return n;
      },
      update: (n, i) => this.fill(n, i),
    });
    setHidden(this.none, this.all.length > 0);
    setDisabled(this.emptyBtn, this.all.length === 0);
  }

  private fill(n: HTMLElement, i: TrashItem): void {
    setText(q(n, '.fm-trash-name'), i.name);
    setTitle(q(n, '.fm-trash-name'), i.original);
    setText(q(n, '.fm-trash-kind'), i.kind === 'movie' ? 'Movie' : i.kind === 'character' ? 'Character' : 'Export');
    setText(q(n, '.fm-trash-when'), dateText(i.deleted * 1000));
    setText(q(n, '.fm-trash-left'), tn(i.daysLeft, '{n} day left', '{n} days left'));
    setClass(q(n, '.fm-trash-left'), 'is-soon', i.daysLeft <= 3);
  }
}
