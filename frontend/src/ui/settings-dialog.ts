import { capabilities } from '../io/api';
import { Dialog, confirmAction } from './dialogs';
import { el, q, setClass, setHidden, setText, setValue } from './dom';
import { gesturePrefs, setFingerPaints } from './gestures';
import { icon } from './icons';
import { languages, onLanguage, setLanguage, t, type Lang } from './i18n';
import { checkRow, colorRow, selectRow, sliderRow } from './panels/controls';
import { SCRUB_SPEEDS, UI_FONT_SIZES, UI_SCALES, UNDO_CHOICES, loadPrefs, savePrefs, setUiScale, uiScaleChoice, type Prefs, type ScrubSpeed, type UiFontSize } from './prefs';
import { LibraryFolderDialog } from './library-folder';
import { THEMES, readChoice, setAccent, setIntensity, setTheme, themeSwatchesHtml } from './themes';

const RAIL_KEY = 'formmorpheus.prefsRailCollapsed';
const AUTOSAVE_CHOICES: ReadonlyArray<readonly [string, string]> = [['0', 'Off'], ['10', '10 s'], ['30', '30 s'], ['60', '1 min'], ['300', '5 min']];
const NOTICE_CHOICES: ReadonlyArray<readonly [string, string]> = [['0', 'Automatic'], ['3', '3 seconds'], ['5', '5 seconds'], ['10', '10 seconds'], ['20', '20 seconds']];
const SECTION_ORDER = ['General', 'Interface', 'Timeline'];

export class SettingsDialog extends Dialog {
  private readonly grid = el('<div class="nm-theme-grid" role="group" aria-label="Theme"></div>');
  private readonly nav = el('<div class="cv-prefs-nav" role="tablist"></div>');
  private readonly sections = new Map<string, HTMLElement>();
  private readonly dataPath = el<HTMLInputElement>('<input class="cv-input" type="text" dir="ltr" readonly spellcheck="false" aria-label="Settings folder">');
  private readonly libraryPath = el<HTMLInputElement>('<input class="cv-input" type="text" dir="ltr" readonly spellcheck="false" aria-label="Library folder">');
  private readonly libraryBtn = el<HTMLButtonElement>('<button class="cv-btn" type="button">Change Library Folder...</button>');
  private libraryDialog: LibraryFolderDialog | null = null;
  private pagesEl: HTMLElement | null = null;
  private shell: { frame: HTMLElement; rail: HTMLElement; port: HTMLElement; shade: SVGPathElement; line: SVGPathElement } | null = null;
  private current = '';
  private wireRaf = 0;
  private spyRaf = 0;
  private spyMuted = 0;
  private wireD = '';
  private portY = Number.NaN;
  private prefs: Prefs = loadPrefs();

  private readonly homeRow = checkRow('Show Home screen at launch', (v) => this.change({ autoShowHome: v }));
  private readonly homeCloseRow = checkRow('Show Home screen when the last movie closes', (v) => this.change({ homeOnLastClose: v }));
  private readonly whatsNewRow = checkRow('Show What\'s New after an update', (v) => this.change({ whatsNewAuto: v }));
  private readonly autosaveRow = selectRow('Autosave every', AUTOSAVE_CHOICES, (v) => this.change({ autosaveSeconds: Number(v) }));
  private readonly accentRow = colorRow('Accent', (v) => { setAccent(v); this.sync(); });
  private readonly intensityRow = sliderRow('Accent intensity (%)', 0, 150, 5, (v) => setIntensity(v / 100));
  private readonly themeAutoRow = checkRow('Match System Appearance', (v) => this.change({ themeAuto: v }));
  private readonly themeLightRow = selectRow('Light theme', Object.entries(THEMES).filter(([, th]) => th.light).map(([k, th]) => [k, th.label] as const), (v) => this.change({ themeLight: v }));
  private readonly themeDarkRow = selectRow('Dark theme', Object.entries(THEMES).filter(([, th]) => !th.light).map(([k, th]) => [k, th.label] as const), (v) => this.change({ themeDark: v }));
  private readonly languageRow = selectRow('Language', languages(), (v) => { this.change({ language: v as Lang }); void setLanguage(v as Lang); });
  private readonly fontSizeRow = selectRow('Text size', UI_FONT_SIZES, (v) => this.change({ uiFontSize: v as UiFontSize }));
  private readonly scaleRow = selectRow('Interface scale', UI_SCALES, (v) => setUiScale(v));
  private readonly animationsRow = checkRow('Animations', (v) => this.change({ animations: v }));
  private readonly gpuRow = checkRow('GPU compositing', (v) => this.change({ gpu: v }));
  private readonly noticeRow = selectRow('Notice time', NOTICE_CHOICES, (v) => this.change({ noticeSeconds: Number(v) }));
  private readonly undoRow = selectRow('Undo steps', UNDO_CHOICES, (v) => this.change({ undoDepth: Number(v) }));
  private readonly scrubRow = selectRow('Scrub speed', SCRUB_SPEEDS, (v) => this.change({ scrubSpeed: v as ScrubSpeed }));
  private readonly recentRow = sliderRow('Recent undo steps (%)', 10, 100, 5, (v) => this.change({ recentUndo: v }));
  private readonly stageUndoRow = checkRow('Undo and Redo buttons on the Stage', (v) => this.change({ stageUndoButtons: v }));
  private readonly keysBtn = el<HTMLButtonElement>('<button class="cv-btn" type="button">Keyboard Shortcuts...</button>');
  private readonly gesturesRow = checkRow('Two-finger tap undoes and three-finger tap redoes', (v) => this.change({ undoGestures: v }));
  private readonly rotatePinchRow = checkRow('Rotate the Stage with pinch zoom', (v) => this.change({ rotatePinch: v }));
  private readonly secondFingerRow = checkRow('A second finger held while dragging snaps (Shift) and Free Trims (Alt)', (v) => this.change({ secondFinger: v }));
  private readonly touchHoldRow = checkRow('Touch and hold opens the context menu', (v) => this.change({ touchHold: v }));
  private readonly penHoverRow = checkRow('Pen hover scrubs the Timeline', (v) => this.change({ penHover: v }));
  private readonly penRollRow = checkRow('Rotate while performing with a twisting pen', (v) => this.change({ penRoll: v }));
  private readonly penPlayRow = checkRow('Pen button plays and pauses', (v) => this.change({ penPlay: v }));
  private readonly fingerPaintRow = checkRow('Paint with finger', (v) => setFingerPaints(v));
  private readonly confirmDeleteRow =checkRow('Ask before deleting content', (v) => this.change({ confirmDelete: v }));

  constructor(private readonly onPrefs: (p: Prefs) => void) {
    super('Preferences', 620);
    this.libraryBtn.addEventListener('click', () => { this.libraryDialog ??= new LibraryFolderDialog(); void this.libraryDialog.show(() => this.sync()); });
    const swatches = document.createElement('template');
    swatches.innerHTML = themeSwatchesHtml();
    this.grid.append(swatches.content);
    for (const b of Array.from(this.grid.querySelectorAll<HTMLElement>('[data-theme-id]'))) b.style.removeProperty('border-color');
    const pages = el('<div class="cv-prefs-pages"></div>');
    const railIcons: Record<string, string> = { General: 'pfGeneral', Interface: 'pfInterface', Timeline: 'pfHistory' };
    const grp = (label: string, ...content: HTMLElement[]): HTMLElement => {
      const g = el('<section class="cv-prefs-group"><h3 class="cv-prefs-label"></h3></section>');
      const h = q<HTMLElement>(g, '.cv-prefs-label');
      setText(h, t(label));
      onLanguage(() => setText(h, t(label)));
      g.append(...content);
      return g;
    };
    const nt = (text: string): HTMLElement => el(`<p class="cv-note">${text}</p>`);
    const cols = (...content: HTMLElement[]): HTMLElement => { const c = el('<div class="cv-prefs-cols"></div>'); c.append(...content); return c; };
    const add = (name: string, ...content: HTMLElement[]): void => {
      const tab = el<HTMLButtonElement>(`<button class="cv-prefs-railtab" type="button" role="tab"><span class="cv-prefs-tabicon">${icon(railIcons[name] ?? 'pfGeneral', 18)}</span><span class="cv-prefs-tablabel"></span></button>`);
      tab.dataset.section = name;
      const label = q<HTMLElement>(tab, '.cv-prefs-tablabel');
      const paint = (): void => { setText(label, t(name)); tab.title = t(name); };
      paint();
      onLanguage(paint);
      tab.addEventListener('click', () => this.showSection(name, 'smooth'));
      this.nav.appendChild(tab);
      const page = el(`<section class="cv-prefs-page cv-prefs-sec" role="tabpanel"><button class="cv-prefs-sechead" type="button" aria-expanded="true"><span class="cv-prefs-secicon">${icon(railIcons[name] ?? 'pfGeneral', 16)}</span><span class="cv-prefs-seclabel"></span><span class="cv-prefs-chev">${icon('chevronDown', 16)}</span></button><div class="cv-prefs-secbody"></div></section>`);
      page.dataset.section = name;
      const head = q<HTMLButtonElement>(page, '.cv-prefs-sechead'), headLabel = q<HTMLElement>(page, '.cv-prefs-seclabel');
      const paintHead = (): void => setText(headLabel, t(name));
      paintHead();
      onLanguage(paintHead);
      head.addEventListener('click', () => this.foldSection(name));
      q<HTMLElement>(page, '.cv-prefs-secbody').append(...content);
      pages.appendChild(page);
      this.sections.set(name, page);
    };
    const pathRow = (label: string, input: HTMLInputElement): HTMLElement => {
      const row = el('<label class="cv-field"><span></span></label>');
      setText(q(row, 'span'), label);
      row.appendChild(input);
      return row;
    };
    const reset = el<HTMLButtonElement>('<button class="cv-btn cv-btn-danger" type="button">Reset All Preferences...</button>');
    reset.addEventListener('click', () => {
      void confirmAction('Reset all preferences?', 'Every preference and the theme go back to how formmorpheus comes; your movies and library are kept. formmorpheus reloads.', 'Reset', true).then((ok) => {
        if (!ok) return;
        try {
          for (const k of Object.keys(localStorage)) if (k.startsWith('formmorpheus.') || k.startsWith('formmorpheus_') || k === 'nodemode_ui_settings') localStorage.removeItem(k);
        } catch { /* storage blocked */ }
        location.reload();
      });
    });
    add('General',
      grp('Startup', this.homeRow.el, this.homeCloseRow.el, this.whatsNewRow.el, nt('The Home screen covers the stage while no movie is open. What\'s New lists the recent additions and opens once after an update when the third choice is on.')),
      grp('Saving', this.autosaveRow.el, nt('Autosave writes the open movie to its project file at this interval while there are unsaved changes.')),
      grp('Settings Storage', pathRow('Settings folder', this.dataPath), pathRow('Library folder', this.libraryPath), this.libraryBtn, nt('The library is where your movies are kept: on this computer, in iCloud Drive or in a folder of your own. Window preferences such as this page, the theme and the interface scale stay in this window\'s own storage.')),
      grp('Reset', reset));
    add('Interface',
      grp('Theme', this.grid, nt('Right-click a theme to favorite it. Theme and accent are shared with the other Form apps on this device.'), this.accentRow.el, this.intensityRow.el, nt('Intensity sets how strongly the accent tints what it marks; 100% is the design\'s.'), this.themeAutoRow.el, cols(this.themeLightRow.el, this.themeDarkRow.el), nt('Match System Appearance switches between the light and dark theme chosen here when the appearance of the computer changes.')),
      grp('Language, Text and Scale', this.languageRow.el, nt('The language of the whole interface. Names you give movies and layers stay as you wrote them.'), cols(this.fontSizeRow.el, this.scaleRow.el)),
      grp('Motion and Notices', this.animationsRow.el, this.noticeRow.el),
      grp('Performance', this.gpuRow.el, nt('Draws the Stage and exports on the graphics card when it gives the same picture as the processor. Off, or without WebGL 2, everything is drawn on the processor.')));
    add('Timeline',
      grp('History', this.undoRow.el, nt('Undo steps are saved inside the movie file, so more steps make the file larger.'), this.recentRow.el, nt('The newest share of the steps stays one by one; the older rest is thinned so Undo reaches further back. 100% keeps every step.'), this.stageUndoRow.el),
      grp('Keyboard', this.keysBtn, nt('See every command with its keys, change them, and set them back.')),
      grp('Playhead', this.scrubRow.el),
      grp('Gestures', this.gesturesRow.el, this.rotatePinchRow.el, this.secondFingerRow.el, this.touchHoldRow.el, this.penHoverRow.el, this.penRollRow.el, this.penPlayRow.el, this.fingerPaintRow.el),
      grp('Editing', this.confirmDeleteRow.el));
    for (const name of SECTION_ORDER) {
      const tab = this.nav.querySelector<HTMLElement>(`[data-section="${name}"]`), card = this.sections.get(name);
      if (tab?.parentElement) tab.parentElement.appendChild(tab);
      if (card) pages.appendChild(card);
    }
    const wrap = el('<div class="cv-prefs"></div>');
    wrap.append(pages);
    this.body.appendChild(wrap);
    this.pagesEl = pages;
    const frame = q<HTMLElement>(this.scrim, '.cv-dialog');
    frame.classList.add('cv-prefs-dlg');
    q<HTMLElement>(this.scrim, '.cv-dialog-head').prepend(el(`<span class="cv-prefs-headicon">${icon('settings', 16)}</span>`));
    let collapsed = false;
    try { collapsed = localStorage.getItem(RAIL_KEY) === '1'; } catch { collapsed = false; }
    const fold = el<HTMLButtonElement>(`<button class="cv-prefs-fold" type="button">${icon('pfFold', 16)}</button>`);
    const paintRail = (): void => {
      setClass(frame, 'is-rail-collapsed', collapsed);
      fold.title = t(collapsed ? 'Expand tabs' : 'Collapse tabs');
      fold.setAttribute('aria-label', fold.title);
      fold.setAttribute('aria-expanded', String(!collapsed));
    };
    fold.addEventListener('click', () => {
      collapsed = !collapsed;
      try { localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0'); } catch { /* kept for this session only */ }
      paintRail();
      this.queueWire();
    });
    paintRail();
    onLanguage(paintRail);
    const rail = el('<div class="cv-prefs-rail"></div>');
    rail.append(this.nav, fold);
    const wire = el<HTMLElement>('<svg class="cv-prefs-wire" aria-hidden="true"><path class="cv-prefs-wire-shade"></path><path class="cv-prefs-wire-line"></path></svg>') as unknown as SVGSVGElement;
    const port = el('<span class="cv-prefs-port" aria-hidden="true"></span>');
    frame.append(rail, wire, port);
    this.shell = { frame, rail, port, shade: q<SVGPathElement>(wire, '.cv-prefs-wire-shade'), line: q<SVGPathElement>(wire, '.cv-prefs-wire-line') };
    pages.addEventListener('scroll', () => this.queueSpy(), { passive: true });
    new ResizeObserver(() => this.queueWire()).observe(frame);
    window.addEventListener('resize', () => this.queueWire());
    this.button('Done', 'primary', () => this.close());
    this.keysBtn.addEventListener('click', () => document.dispatchEvent(new CustomEvent('fm:open-shortcuts')));
    this.grid.addEventListener('contextmenu', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-theme-id]')?.dataset.themeId;
      if (!id) return;
      e.preventDefault();
      const cur = this.prefs.favouriteThemes;
      this.change({ favouriteThemes: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
      this.sync();
    });
    this.grid.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-theme-id]')?.dataset.themeId;
      if (!id) return;
      setTheme(id);
      this.sync();
    });
    this.showSection('General');
  }

  show(section?: string): void {
    this.prefs = loadPrefs();
    const p = this.prefs;
    this.homeRow.set(p.autoShowHome);
    this.homeCloseRow.set(p.homeOnLastClose);
    this.whatsNewRow.set(p.whatsNewAuto);
    this.autosaveRow.set(String(p.autosaveSeconds));
    this.themeAutoRow.set(p.themeAuto);
    this.themeLightRow.set(p.themeLight);
    this.themeDarkRow.set(p.themeDark);
    this.languageRow.set(p.language);
    this.fontSizeRow.set(p.uiFontSize);
    this.scaleRow.set(uiScaleChoice());
    this.animationsRow.set(p.animations);
    this.gpuRow.set(p.gpu);
    this.noticeRow.set(String(p.noticeSeconds));
    this.undoRow.set(String(p.undoDepth));
    this.recentRow.set(p.recentUndo);
    this.stageUndoRow.set(p.stageUndoButtons);
    this.scrubRow.set(p.scrubSpeed);
    this.gesturesRow.set(p.undoGestures);
    this.rotatePinchRow.set(p.rotatePinch);
    this.secondFingerRow.set(p.secondFinger);
    this.touchHoldRow.set(p.touchHold);
    this.penHoverRow.set(p.penHover);
    this.penRollRow.set(p.penRoll);
    this.penPlayRow.set(p.penPlay);
    this.fingerPaintRow.set(gesturePrefs().fingerPaints);
    this.confirmDeleteRow.set(p.confirmDelete);
    this.sync();
    if (section && this.sections.has(section)) this.showSection(section);
    this.open();
    if (section && this.sections.has(section)) this.scrollToSection(section, 'auto');
    this.queueWire();
  }

  sync(): void {
    void capabilities().then((c) => {
      setValue(this.dataPath, c?.dataDir ?? '');
      setValue(this.libraryPath, c?.libraryDir ?? '');
    });
    const c = readChoice();
    this.accentRow.set(c.accentColor);
    this.intensityRow.set(Math.round((c.intensity ?? 1) * 100));
    for (const b of Array.from(this.grid.querySelectorAll<HTMLElement>('[data-theme-id]'))) {
      const id = b.dataset.themeId ?? '';
      const active = id === c.theme;
      setClass(b, 'is-active', active);
      b.setAttribute('aria-pressed', String(active));
      const fav = this.prefs.favouriteThemes.includes(id);
      setClass(b, 'is-fav', fav);
      const order = fav ? '-1' : '0';
      if (b.style.order !== order) b.style.order = order;
      const title = `${THEMES[id]?.label ?? id}${fav ? ' (favorite, right-click to remove)' : ' (right-click to add to favorites)'}`;
      if (b.title !== title) b.title = title;
    }
  }

  private change(patch: Partial<Prefs>): void {
    const kept = loadPrefs();
    this.prefs = { ...this.prefs, ...patch, dialogValues: kept.dialogValues, whatsNewSeen: kept.whatsNewSeen, recent: kept.recent, shortcuts: kept.shortcuts, menuHidden: kept.menuHidden, menuColors: kept.menuColors, stageShare: kept.stageShare };
    savePrefs(this.prefs);
    this.onPrefs(this.prefs);
  }

  private showSection(name: string, scroll: ScrollBehavior | null = null): void {
    if (!this.sections.has(name)) return;
    this.markSection(name);
    if (scroll) this.scrollToSection(name, scroll);
  }

  private markSection(name: string): void {
    if (this.current === name) return;
    this.current = name;
    for (const [n, page] of this.sections) setClass(page, 'is-current', n === name);
    for (const tab of Array.from(this.nav.children) as HTMLElement[]) {
      const on = tab.dataset.section === name;
      setClass(tab, 'is-active', on);
      tab.setAttribute('aria-selected', String(on));
    }
    this.queueWire();
  }

  private scrollToSection(name: string, behavior: ScrollBehavior): void {
    const sec = this.sections.get(name), pages = this.pagesEl;
    if (!sec || !pages) return;
    if (sec.classList.contains('is-folded')) this.foldSection(name);
    const top = sec.getBoundingClientRect().top - pages.getBoundingClientRect().top + pages.scrollTop - 12;
    this.spyMuted = performance.now() + 700;
    pages.scrollTo({ top, behavior });
  }

  private foldSection(name: string): void {
    const sec = this.sections.get(name);
    if (!sec) return;
    const folded = !sec.classList.contains('is-folded');
    setClass(sec, 'is-folded', folded);
    setHidden(q(sec, '.cv-prefs-secbody'), folded);
    q(sec, '.cv-prefs-sechead').setAttribute('aria-expanded', String(!folded));
    this.queueWire();
    this.queueSpy();
  }

  private queueSpy(): void {
    if (this.spyRaf) return;
    this.spyRaf = requestAnimationFrame(() => {
      this.spyRaf = 0;
      const pages = this.pagesEl;
      if (!pages || !pages.clientHeight || performance.now() < this.spyMuted) return;
      const edge = pages.getBoundingClientRect().top + 24;
      const names = Array.from(this.sections.keys());
      let best = '', bestD = Infinity;
      if (pages.scrollHeight > pages.clientHeight + 4 && pages.scrollTop + pages.clientHeight >= pages.scrollHeight - 2) best = names[names.length - 1] ?? '';
      else for (const [n, sec] of this.sections) {
        const top = sec.getBoundingClientRect().top, d = top <= edge ? edge - top : top - edge + 100000;
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best) this.markSection(best);
    });
  }

  private queueWire(): void {
    if (this.wireRaf) return;
    this.wireRaf = requestAnimationFrame(() => { this.wireRaf = 0; this.drawWire(); });
  }

  private drawWire(): void {
    const s = this.shell;
    if (!s || this.scrim.hidden) return;
    const F = s.frame.getBoundingClientRect();
    const tab = this.nav.querySelector<HTMLElement>('.cv-prefs-railtab.is-active');
    const head = s.frame.querySelector<HTMLElement>('.cv-dialog-head');
    if (!F.width || !tab || !head) return;
    const N = this.nav.getBoundingClientRect();
    let T = tab.getBoundingClientRect();
    if (T.top < N.top || T.bottom > N.bottom) {
      this.nav.scrollTop += T.top < N.top ? T.top - N.top - 6 : T.bottom - N.bottom + 6;
      T = tab.getBoundingClientRect();
    }
    const R = s.rail.getBoundingClientRect(), H = head.getBoundingClientRect();
    const portY = Math.round(H.bottom - F.top), sx = Math.round(T.right - F.left), ty = Math.round(T.top - F.top + T.height / 2);
    const rr = R.right - F.left, trunk = Math.round(rr - rr * 0.45), dy = portY - ty, r = 10, dir = dy > 0 ? 1 : -1;
    const d = Math.abs(dy) < 2 * r ? `M ${sx} ${ty} H ${trunk} V ${portY} H -7` : `M ${sx} ${ty} H ${trunk - r} a ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${r} ${dir * r} V ${portY - dir * r} a ${r} ${r} 0 0 ${dir > 0 ? 0 : 1} ${r} ${dir * r} H -7`;
    if (d !== this.wireD) { this.wireD = d; s.shade.setAttribute('d', d); s.line.setAttribute('d', d); }
    if (portY !== this.portY) { this.portY = portY; s.port.style.transform = `translateY(${portY}px)`; }
  }
}
