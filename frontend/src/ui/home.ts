import type { ShellModel } from './shell-model';
import { el, setClass, setHidden, setText } from './dom';
import { HomeFiles } from './home-files';
import { HomeTrash } from './home-trash';
import { icon } from './icons';
import { ExamplesRow } from './examples-row';
import { mountCloudButton, mountStorageButton } from './theater-storage';
import { Popover, popRow } from './popover';
import { theaterLayout } from './shell-opts';
import { platform } from '../platform';
import '../styles/theater-wall.css';

export interface HomeDeps {
  engine: ShellModel;
  autoShow: () => boolean;
  afterClose: () => boolean;
  recent: () => string[];
  openRecent: (name: string) => void;
  openPath: (path: string) => void;
  removeRecent: (name: string) => void;
  openName?: () => string | null;
  run: (command: string) => void;
}

export class HomeScreen {
  readonly root = el('<section class="cv-home" aria-label="Home" hidden></section>');
  /** Each page's file browser: Start's short Recent grid and the Recent, Projects and Outputs pages. */
  private readonly pages = new Map<Page, HomeFiles>();
  private page: Page = 'projects';
  private forced = false;
  private lastCount = 0;
  private lastId: string | null = null;
  private hadDocument = false;
  private back!: HTMLElement;
  private readonly trash: HomeTrash;
  private readonly examples: ExamplesRow;

  /** Home (1.87.3): a navigation column (Start, Recent, Projects, Outputs with counts; Create; Preferences and Help at
   *  its foot) beside a main area. Start has a greeting with Open and New document, a drop zone listing what opens, a
   *  short Recent grid with See all, and new document sizes. Every page is built once; switching pages toggles them. */
  constructor(host: HTMLElement, private readonly d: HomeDeps) {
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
    const navItem = (v: Page, ic: string, label: string): string => `<button class="cv-home-nav-item" type="button" data-v="${v}">${icon(ic, 16)}<span>${label}</span>${v === 'start' ? '' : '<span class="cv-home-count">0</span>'}</button>`;
    const cmdItem = (cmd: string, ic: string, label: string): string => `<button class="cv-home-nav-item" type="button" data-cmd="${cmd}">${icon(ic, 16)}<span>${label}</span></button>`;
    const key = (k: string): string => `<span class="cv-keys" dir="ltr"><kbd class="cv-key">${mod}</kbd><kbd class="cv-key">${k}</kbd></span>`;
    const formats = ['FMO', 'PNG', 'JPEG', 'GIF', 'WEBP', 'MP4', 'MOV', 'WAV', 'MP3'].map((f) => `<span class="cv-home-format">${f}</span>`).join('');
    const sizes = PRESETS.map((p, i) => `<button class="cv-home-size" type="button" data-size="${i}"><span class="cv-home-size-box"><span style="aspect-ratio: ${p.w} / ${p.h}"></span></span><span class="cv-home-size-name">${p.name}</span><span class="cv-home-size-meta">${p.w} x ${p.h} px · ${p.fps} fps</span></button>`).join('');
    this.root.innerHTML = `<header class="cv-home-top">
      <button class="cv-home-toggle" type="button" data-toggle title="Sidebar" aria-label="Sidebar" aria-expanded="false">${icon('panelNav', 18)}</button>
      <button class="cv-home-word" type="button" data-brand aria-haspopup="menu" title="About, What's New, Help"><b>form</b>morpheus</button>
      <span class="cv-home-top-gap"></span>
      <button class="cv-home-toggle" type="button" data-tools title="Filter, sort and view" aria-label="Filter, sort and view" aria-pressed="false">${icon('more3', 18)}</button>
      <button class="cv-home-pill" type="button" data-select aria-pressed="false">Select</button>
      <button class="cv-home-plus" type="button" data-cmd="new" title="New Movie" aria-label="New Movie">${icon('plus', 18)}</button>
    </header>
    <nav class="cv-home-nav" aria-label="Home">
      <button class="cv-home-nav-item cv-home-storage" type="button" data-storage>${icon('folder', 16)}<span>Library folder</span></button>
      <button class="cv-home-nav-item cv-home-storage" type="button" data-cloud>${icon('upload', 16)}<span>Cloud folder</span></button>
      ${navItem('projects', 'folder', 'Movies')}${navItem('recent', 'history', 'Recent')}${navItem('start', 'film', 'Start')}${navItem('outputs', 'download', 'Exports')}${navItem('trash', 'delete', 'Recently Deleted')}
      <div class="cv-home-nav-sep"></div>
      <div class="cv-home-nav-title">Create</div>
      ${cmdItem('new', 'newFile', 'New movie')}${cmdItem('new-flipbook', 'flipbook', 'New flipbook')}${cmdItem('open', 'folderOpen', 'Open')}
      <div class="cv-home-nav-foot"><button class="cv-home-nav-item cv-home-back" type="button" data-back hidden>${icon('chevronLeft', 16)}<span>Back to Movie</span></button>${cmdItem('settings', 'settings', 'Preferences')}${cmdItem('help', 'info', 'Help')}</div>
    </nav>
    <div class="cv-home-main">
      <div class="cv-home-narrow">${navItem('projects', 'folder', 'Movies')}${navItem('recent', 'history', 'Recent')}${navItem('start', 'film', 'Start')}${navItem('outputs', 'download', 'Exports')}${navItem('trash', 'delete', 'Recently Deleted')}</div>
      <div class="cv-home-page" data-page="start">
        <div class="cv-home-head"><div><h1 class="cv-home-title"></h1><p class="cv-home-sub">Open a movie, or start a new movie or flipbook.</p></div></div>
        <div class="cv-home-hero">
          <span class="cv-home-hero-icon">${icon('film', 26)}</span>
          <div class="cv-home-hero-text"><div class="cv-home-hero-title">Start an animation</div>
            <div class="cv-home-hero-sub">Drop pictures, video or sound anywhere in the window to bring them into a movie. Movies open with every track, drawing and keyframe still editable.</div>
            <div class="cv-home-formats">${formats}</div></div>
          <div class="cv-home-hero-actions">
            <button class="cv-home-action is-primary" type="button" data-cmd="new">${icon('newFile', 16)}<span class="cv-home-label">New movie...</span>${key('N')}</button>
            <button class="cv-home-action" type="button" data-cmd="open">${icon('folderOpen', 16)}<span class="cv-home-label">Open...</span>${key('O')}</button>
            <button class="cv-home-action is-ghost" type="button" data-cmd="new-flipbook">${icon('flipbook', 16)}<span class="cv-home-label">New flipbook</span></button>
          </div>
        </div>
        <section class="cv-home-section"><div class="cv-home-section-head"><h2 class="cv-home-section-title">Recent</h2><button class="cv-btn cv-btn-ghost" type="button" data-v="recent">See all</button></div><div class="cv-home-slot" data-slot="start"></div></section>
        <div data-slot="examples"></div>
        <section class="cv-home-section"><div class="cv-home-section-head"><h2 class="cv-home-section-title">New movie</h2><button class="cv-btn cv-btn-ghost" type="button" data-cmd="new">More sizes...</button></div><div class="cv-home-sizes">${sizes}</div></section>
      </div>
      <div class="cv-home-page" data-page="recent" hidden><div class="cv-home-head"><div><h1 class="cv-home-title">Recent</h1><p class="cv-home-sub">Movies you opened or saved, newest first.</p></div></div><div class="cv-home-slot" data-slot="recent"></div></div>
      <div class="cv-home-page" data-page="projects" hidden><div class="cv-home-head"><div><h1 class="cv-home-title">Movies</h1><p class="cv-home-sub">Everything in the movie library folder.</p></div></div><div class="cv-home-slot" data-slot="projects"></div></div>
      <div class="cv-home-page" data-page="outputs" hidden><div class="cv-home-head"><div><h1 class="cv-home-title">Exports</h1><p class="cv-home-sub">Videos, GIFs and frames you exported, newest first.</p></div></div><div class="cv-home-slot" data-slot="outputs"></div></div>
      <div class="cv-home-page" data-page="trash" hidden><div class="cv-home-head"><div><h1 class="cv-home-title">Recently Deleted</h1><p class="cv-home-sub">Deleted movies and exports, kept for 30 days.</p></div></div><div class="cv-home-slot" data-slot="trash"></div></div>
    </div>`;
    this.back = this.root.querySelector('[data-back]') as HTMLElement;
    const deps = { recent: d.recent, openRecent: d.openRecent, openPath: d.openPath, removeRecent: d.removeRecent, openName: d.openName };
    const count = (v: Page | 'trash') => (n: number): void => { for (const c of Array.from(this.root.querySelectorAll(`[data-v="${v}"] .cv-home-count`))) { setText(c, String(n)); setHidden(c as HTMLElement, n === 0); } };
    const mount = (slot: Page, files: HomeFiles): void => { (this.root.querySelector(`[data-slot="${slot}"]`) as HTMLElement).appendChild(files.root); this.pages.set(slot, files); };
    mount('start', new HomeFiles(deps, { fixed: 'recent', limit: 8, compact: true, onCount: count('recent') }));
    mount('recent', new HomeFiles(deps, { fixed: 'recent', onCount: count('recent') }));
    mount('projects', new HomeFiles(deps, { fixed: 'projects', onCount: count('projects') }));
    mount('outputs', new HomeFiles(deps, { fixed: 'outputs', onCount: count('outputs') }));
    this.examples = new ExamplesRow((name) => d.openRecent(name));
    (this.root.querySelector('[data-slot="examples"]') as HTMLElement).appendChild(this.examples.root);
    document.addEventListener('fm:library-changed', () => { if (!this.root.hidden) this.fill(); });
    this.trash = new HomeTrash(count('trash'), () => this.fill());
    (this.root.querySelector('[data-slot="trash"]') as HTMLElement).appendChild(this.trash.root);
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-back]')) { this.forced = false; this.sync(); return; }
      const v =(t.closest('[data-v]') as HTMLElement | null)?.dataset.v as Page | undefined;
      if (v) { this.show(v); return; }
      if (t.closest('[data-cmd]')) return;   // the window's own button[data-cmd] handler runs the command
      const size = (t.closest('[data-size]') as HTMLElement | null)?.dataset.size;
      const p = size !== undefined ? PRESETS[Number(size)] : undefined;
      if (p) this.d.engine.newDocument(p.w, p.h, 'Untitled Movie', p.fps, false);
    });
    const brandPop = new Popover('fm-brand-menu', 220);
    const brandRows: Array<[string, string]> = [['about', 'About formmorpheus'], ['whats-new', "What's New"], ['help-center', 'Help Center'], ['reset-examples', 'Reset Examples']];
    for (const [cmd, label] of brandRows) {
      const r = popRow(null, label);
      r.el.addEventListener('click', () => { brandPop.hide(); document.dispatchEvent(new CustomEvent('fm:command', { detail: cmd })); });
      brandPop.body.appendChild(r.el);
    }
    const brandBtn = this.root.querySelector('[data-brand]') as HTMLElement;
    brandBtn.addEventListener('click', () => brandPop.showFor(brandBtn, 'below'));
    this.wireTop();
    // G06: Gallery (the poster wall) or Library (the file manager look: a standing sidebar, filter and sort, kind and age)
    const applyLayout = (): void => { setClass(this.root, 'is-library', theaterLayout() === 'library'); };
    applyLayout();
    document.addEventListener('fm:theater-layout', applyLayout);
    document.addEventListener('fm:show-exports', () => { this.show('outputs'); });
    mountStorageButton(this.root.querySelector('[data-storage]') as HTMLElement);
    if (platform.kind === 'ipad') (this.root.querySelector('[data-cloud]') as HTMLElement).hidden = true;
    else mountCloudButton(this.root.querySelector('[data-cloud]') as HTMLElement);
    host.appendChild(this.root);
    d.engine.on('projects', () => this.sync());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.forced && d.engine.projects.length) { this.forced = false; this.sync(); } });
    this.paint();
    this.sync();
  }

  /** The top bar: the sidebar toggle (closed at first, remembered), the quiet tools row, and Select, which is the Theater's own Select button. */
  private wireTop(): void {
    const NAV = 'formmorpheus.theaterNav';
    const get = (k: string): boolean => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
    const put = (k: string, v: boolean): void => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* this session only */ } };
    const toggle = this.root.querySelector('[data-toggle]') as HTMLElement;
    const tools = this.root.querySelector('[data-tools]') as HTMLElement;
    const pick = this.root.querySelector('[data-select]') as HTMLElement;
    const nav = (on: boolean): void => { setClass(this.root, 'is-nav-open', on); toggle.setAttribute('aria-expanded', String(on)); put(NAV, on); };
    nav(get(NAV));
    toggle.addEventListener('click', () => nav(!this.root.classList.contains('is-nav-open')));
    // choosing a page or a command from the sidebar puts it away again, so the wall stays a wall
    this.root.querySelector('.cv-home-nav')?.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-v], [data-cmd], [data-storage], [data-cloud], [data-back]')) nav(false); });
    tools.addEventListener('click', () => { const on = !this.root.classList.contains('show-tools'); setClass(this.root, 'show-tools', on); tools.setAttribute('aria-pressed', String(on)); });
    const inner = this.root.querySelector('[data-page="projects"] .cv-th-select') as HTMLElement | null;
    if (!inner) return;
    pick.addEventListener('click', () => inner.click());
    const mirror = (): void => { const on = inner.getAttribute('aria-pressed') === 'true'; setClass(pick, 'is-active', on); pick.setAttribute('aria-pressed', String(on)); setText(pick, on ? 'Done' : 'Select'); };
    new MutationObserver(mirror).observe(inner, { attributes: true, attributeFilter: ['aria-pressed'] });
  }

  /** The chosen page shown, the others hidden, its nav item marked; attribute writes only. */
  private paint(): void {
    setHidden(this.root.querySelector('[data-select]') as HTMLElement, this.page !== 'projects');
    setHidden(this.root.querySelector('[data-tools]') as HTMLElement, this.page === 'start' || this.page === 'trash');
    for (const n of Array.from(this.root.querySelectorAll<HTMLElement>('.cv-home-page'))) setHidden(n, n.dataset.page !== this.page);
    for (const n of Array.from(this.root.querySelectorAll<HTMLElement>('.cv-home-nav-item[data-v]'))) setClass(n, 'is-active', n.dataset.v === this.page);
    const h = new Date().getHours();
    setText(this.root.querySelector('[data-page="start"] .cv-home-title'), h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
  }

  /** Reads the files of the page shown and the counts of the others. */
  private fill(): void {
    void this.pages.get(this.page)?.refresh();
    void this.trash.refresh();
    void this.examples.refresh();
    for (const [p, f] of this.pages) if (p !== this.page && p !== 'start' && !(p === 'recent' && this.page === 'start')) void f.refresh();
  }

  get isShown(): boolean { return !this.root.hidden; }

  /** Closes a Home that was opened over a movie (or by the Help tour). */
  hide(): void { this.forced = false; this.sync(); }

  /** The Home button: shows the Home screen over whatever is open, at `page` when given. */
  show(page?: Page): void {
    // the Theater opens on the Movies grid unless a page is asked for
    if (!page && this.root.hidden) page = 'projects';
    if (page && page !== this.page) { this.page = page; this.paint(); if (!this.root.hidden) this.fill(); }
    this.forced = true;
    this.sync();
  }

  /** Shown while forced (until a document opens or Esc); with no document open, at launch when "at launch" is on and
   *  after a document has been open when "when the last document closes" is on. */
  sync(): void {
    const n = this.d.engine.projects.length;
    // a document opening hides a forced Home, also when it replaces the open one (the count stays 1)
    const first = this.d.engine.projects[0] as { id?: string } | undefined;
    const id = first?.id ?? null;
    if (n > this.lastCount || (id !== null && id !== this.lastId)) this.forced = false;
    this.lastCount = n;
    this.lastId = id;
    if (n > 0) this.hadDocument = true;
    const on = this.forced || (n === 0 && (this.hadDocument ? this.d.afterClose() : this.d.autoShow()));
    if (on && this.root.hidden) { this.paint(); this.fill(); }
    setHidden(this.root, !on);
    setHidden(this.back, n === 0);
  }
}

type Page = 'start' | 'recent' | 'projects' | 'outputs' | 'trash';

const PRESETS: Array<{ name: string; w: number; h: number; fps: number }> = [
  { name: 'Wide screen 4K', w: 3840, h: 2160, fps: 24 },
  { name: 'Wide screen HD', w: 1920, h: 1080, fps: 24 },
  { name: 'Ultrawide', w: 2560, h: 1097, fps: 24 },
  { name: 'Social', w: 1080, h: 1920, fps: 30 },
  { name: 'Square', w: 1080, h: 1080, fps: 30 },
  { name: 'Frame by frame', w: 1920, h: 1080, fps: 12 },
  { name: 'Anime', w: 1920, h: 1080, fps: 15 },
  { name: 'Smooth 60', w: 1920, h: 1080, fps: 60 },
];
