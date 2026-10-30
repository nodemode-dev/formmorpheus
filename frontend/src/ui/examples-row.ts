import '../styles/onboarding.css';
import { api } from '../io/api';
import { EXAMPLES, installExamples } from './examples';
import { el, q, setHidden, setText, swapMedia } from './dom';
import { icon } from './icons';
import { t } from './i18n';
import { toast } from './toast';

/** Home's Examples section: a card per example movie (poster, name, one line) and Reset Examples. Built once; a card
 *  whose movie was deleted writes it again when clicked, then opens it. */
export class ExamplesRow {
  readonly root = el(`<section class="cv-home-section fm-examples">
    <div class="cv-home-section-head"><h2 class="cv-home-section-title">Examples</h2><button class="cv-btn cv-btn-ghost" type="button" data-cmd="reset-examples">Reset Examples</button></div>
    <div class="fm-examples-grid"></div>
  </section>`);
  private readonly cards = new Map<string, { img: HTMLImageElement; glyph: HTMLElement; key: string }>();

  constructor(private readonly open: (name: string) => void) {
    const grid = q(this.root, '.fm-examples-grid');
    for (const ex of EXAMPLES) {
      const card = el(`<button class="fm-example" type="button"><span class="fm-example-thumb"><img alt="" decoding="async" hidden><span class="fm-example-glyph">${icon('film', 22)}</span></span><span class="fm-example-name"></span><span class="fm-example-note"></span></button>`);
      setText(q(card, '.fm-example-name'), ex.name.replace(/^Example /, ''));
      setText(q(card, '.fm-example-note'), t(ex.blurb));
      card.addEventListener('click', () => { void this.launch(ex.name); });
      grid.appendChild(card);
      this.cards.set(ex.name, { img: q<HTMLImageElement>(card, 'img'), glyph: q(card, '.fm-example-glyph'), key: '' });
    }
  }

  private async launch(name: string): Promise<void> {
    try {
      await installExamples({ reset: false, only: name });
      this.open(name);
    } catch (err) { toast((err as Error).message, 'error'); }
  }

  /** Re-reads which examples exist and swaps in any changed poster. */
  async refresh(): Promise<void> {
    const items = new Map((await api.library().catch(() => [])).map((i) => [i.name, i]));
    for (const [name, c] of this.cards) {
      const item = items.get(name);
      const key = item ? String(item.modified) : '';
      if (key === c.key) continue;
      c.key = key;
      const blob = item ? await api.thumbnail({ name }) : null;
      if (!blob || !blob.size) { setHidden(c.img, true); setHidden(c.glyph, false); continue; }
      const url = URL.createObjectURL(blob);
      try { await swapMedia(c.img, url); setHidden(c.img, false); setHidden(c.glyph, true); } catch { /* the glyph stays */ }
    }
  }
}
