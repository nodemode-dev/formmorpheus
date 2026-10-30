import type { Commands } from './commands';
import { el, setHidden, setText } from './dom';
import { icon } from './icons';
import { readChoice, setTheme } from './themes';

export interface TitleToolsDeps {
  commands: Commands;
}

export class TitleTools {
  readonly root = el('<div class="cv-title-tools"></div>');
  private readonly results = el('<div class="cv-search-results" role="listbox"></div>');
  private readonly pop = el('<div class="cv-search-pop" hidden><input class="cv-search-input" type="search" placeholder="Search commands" aria-label="Search commands"></div>');
  private picked = 0;

  constructor(host: HTMLElement, private readonly d: TitleToolsDeps) {
    const theme = el<HTMLButtonElement>('<button class="cv-tt-btn" type="button" title="Light or dark" aria-label="Light or dark"></button>');
    const search = el<HTMLButtonElement>(`<button class="cv-tt-btn" type="button" title="Search commands" aria-label="Search commands">${icon('search', 16)}</button>`);
    const syncTheme = (): void => {
      const light = readChoice().theme === 'light';
      if (!theme.firstElementChild) theme.innerHTML = `<span class="cv-tt-sun">${icon('sun', 16)}</span><span class="cv-tt-moon">${icon('moon', 16)}</span>`;
      (theme.children[0] as HTMLElement).hidden = light;
      (theme.children[1] as HTMLElement).hidden = !light;
      theme.setAttribute('aria-pressed', String(light));
    };
    theme.addEventListener('click', () => { setTheme(readChoice().theme === 'light' ? 'studio' : 'light'); syncTheme(); });
    syncTheme();
    document.addEventListener('nm:ui-settings-changed', syncTheme);
    this.pop.appendChild(this.results);
    const input = this.pop.querySelector('input') as HTMLInputElement;
    search.addEventListener('click', () => this.open());
    input.addEventListener('input', () => { this.picked = 0; this.fill(input.value); });
    input.addEventListener('keydown', (e) => {
      const n = this.results.children.length;
      if (e.key === 'Escape') { this.close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (n) { this.picked = (this.picked + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; this.mark(); } return; }
      if (e.key === 'Enter') { const b = this.results.children[this.picked] as HTMLElement | undefined; if (b) b.click(); }
    });
    document.addEventListener('pointerdown', (e) => { if (!this.pop.hidden && !this.pop.contains(e.target as Node) && !search.contains(e.target as Node)) this.close(); });
    this.root.append(theme, search, this.pop);
    host.appendChild(this.root);
  }

  open(): void {
    setHidden(this.pop, false);
    const input = this.pop.querySelector('input') as HTMLInputElement;
    input.value = '';
    this.picked = 0;
    this.fill('');
    input.focus();
  }

  close(): void { setHidden(this.pop, true); }

  private fill(q: string): void {
    const c = this.d.commands, needle = q.trim().toLowerCase();
    const found = c.all().filter((cmd) => c.enabled(cmd) && c.label(cmd) && (!needle || c.label(cmd).toLowerCase().includes(needle))).slice(0, 8);
    this.results.textContent = '';
    for (const cmd of found) {
      const b = el<HTMLButtonElement>('<button class="cv-search-item" type="button" role="option"><span class="cv-search-label"></span><span class="cv-search-keys"></span></button>');
      setText(b.querySelector('.cv-search-label') as HTMLElement, c.label(cmd).replace(/\.\.\.$/, '…'));
      setText(b.querySelector('.cv-search-keys') as HTMLElement, c.keyLabel(cmd));
      b.addEventListener('click', () => { this.close(); c.run(cmd.id); });
      this.results.appendChild(b);
    }
    this.mark();
  }

  private mark(): void {
    Array.from(this.results.children).forEach((b, i) => { (b as HTMLElement).classList.toggle('is-picked', i === this.picked); b.setAttribute('aria-selected', String(i === this.picked)); });
  }
}
