import { el, patchList, q, setClass, setHidden, setText } from './dom';
import { icon } from './icons';
import { t } from './i18n';
import '../styles/new-movie-card.css';

/** The New Movie dialog's first page (FV-223): one large light card for the chosen format, with its size badge, its
 *  name large, the two ways to begin as outline buttons, and a dot for every format. Built once, patched by `paint`. */
export interface HeroInfo {
  name: string;
  ratio: string;
  badge: string;
  /** The size line under the name, "3840 x 2160". */
  size: string;
  /** The sizes this format offers, and the one chosen; empty for Custom (its numbers are on the All sizes page). */
  sizes: string[];
  sizeAt: number;
  index: number;
  /** Width and height for the outline, 4:3 when unknown. */
  w: number;
  h: number;
}

export interface HeroHost {
  start(kind: 'empty' | 'flipbook'): void;
  go(index: number): void;
  size(at: number): void;
}

export const badgeOf = (w: number, h: number): string => {
  const m = Math.max(w, h);
  return m >= 3840 ? '4K' : m >= 2560 ? '2K' : m >= 1920 ? 'HD' : m >= 1280 ? '720' : 'SD';
};

export class NewMovieHero {
  readonly root = el(`<div class="fm-nmh" role="group" aria-label="Movie format">
    <div class="fm-nmh-card">
      <span class="fm-nmh-badge"></span>
      <span class="fm-nmh-box"><span class="fm-nmh-outline"></span></span>
      <div class="fm-nmh-name"></div>
      <div class="fm-nmh-meta"></div>
      <select class="cv-input fm-nmh-size" aria-label="Size"></select>
      <p class="fm-nmh-note" hidden>Set the width and height on the All sizes page.</p>
    </div>
    <div class="fm-nmh-go">
      <button class="fm-nmh-start" type="button" data-start="flipbook">${icon('flipbook', 26)}<span>Flipbook</span></button>
      <button class="fm-nmh-start" type="button" data-start="empty">${icon('newFile', 26)}<span>Empty</span></button>
    </div>
    <div class="fm-nmh-dots" role="tablist" aria-label="Formats"></div>
  </div>`);
  private readonly size = q<HTMLSelectElement>(this.root, '.fm-nmh-size');
  private readonly dots = q(this.root, '.fm-nmh-dots');
  private made = 0;

  constructor(private readonly h: HeroHost, private readonly count: number) {
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>('[data-start]'))) b.addEventListener('click', () => this.h.start(b.dataset.start === 'flipbook' ? 'flipbook' : 'empty'));
    this.size.addEventListener('change', () => this.h.size(Number(this.size.value)));
    this.dots.addEventListener('click', (e) => {
      const d = (e.target as HTMLElement).closest<HTMLElement>('[data-at]');
      if (d) this.h.go(Number(d.dataset.at));
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.h.go(this.at + (e.key === 'ArrowRight' ? 1 : -1)); }
    });
    this.root.tabIndex = 0;
  }

  private at = 0;

  paint(i: HeroInfo): void {
    this.at = i.index;
    setText(q(this.root, '.fm-nmh-badge'), i.badge);
    setText(q(this.root, '.fm-nmh-name'), t(i.name));
    setText(q(this.root, '.fm-nmh-meta'), `${i.ratio} · ${i.size}`);
    const k = 64 / Math.max(i.w, i.h), o = q(this.root, '.fm-nmh-outline');
    o.style.width = `${Math.round(i.w * k)}px`;
    o.style.height = `${Math.round(i.h * k)}px`;
    // the size menu lists this format's sizes; it is patched in place, never rebuilt while shown
    patchList(this.size, i.sizes.map((s, at) => ({ s, at })), {
      key: (x) => String(x.at),
      create: (x) => { const o2 = el<HTMLOptionElement>('<option></option>'); o2.value = String(x.at); o2.textContent = x.s; return o2; },
      update: (n, x) => { if (n.textContent !== x.s) n.textContent = x.s; },
    });
    if (this.size.value !== String(i.sizeAt)) this.size.value = String(i.sizeAt);
    setHidden(this.size, i.sizes.length === 0);
    setHidden(q(this.root, '.fm-nmh-note'), i.sizes.length > 0);
    if (!this.made) {
      this.made = 1;
      patchList(this.dots, Array.from({ length: this.count }, (_, n) => n), {
        key: (n) => String(n),
        create: (n) => { const d = el<HTMLButtonElement>('<button class="fm-nmh-dot" type="button" role="tab"></button>'); d.dataset.at = String(n); d.setAttribute('aria-label', `${t('Format')} ${n + 1}`); return d; },
        update: () => undefined,
      });
    }
    for (const d of Array.from(this.dots.children) as HTMLElement[]) { const on = Number(d.dataset.at) === i.index; setClass(d, 'is-active', on); d.setAttribute('aria-selected', String(on)); }
  }
}
