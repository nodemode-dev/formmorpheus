import '../styles/tutorials.css';
import { Dialog } from './dialogs';
import { el, q, setClass, setHidden, setText } from './dom';
import { HelpView } from './help-view';
import { icon } from './icons';
import { t } from './i18n';
import { HELP_LINKS, openExternal } from './external-link';
import { toast } from './toast';
import { tutorialsDone, type TutorialCoach } from './tutorials';

/** The in-app Help Center: Getting started, guided Tutorials, the searchable Manual, Send an idea and Shortcuts and news,
 *  all inside the app (no outside link). Built once; opening a tab only toggles hidden and classes. */
type Tab = 'start' | 'tutorials' | 'manual' | 'idea' | 'more';
const TABS: ReadonlyArray<readonly [Tab, string]> = [['start', 'Getting started'], ['tutorials', 'Tutorials'], ['manual', 'Manual'], ['idea', 'Send an idea'], ['more', 'Shortcuts and news']];

const GETTING_STARTED: ReadonlyArray<readonly [string, string]> = [
  ['Make a movie', 'Open File, then New Movie. A movie is a Stage on top and a Timeline below.'],
  ['Add something', 'Press the plus button on the Timeline: a Drawing, a Flipbook, text, a picture, a video or a sound.'],
  ['Move it', 'Click a block to select it and drag it on the Stage. Drag along the ruler to move the Playhead.'],
  ['Animate it', 'Switch to Keyframe, move the Playhead, and drag the block. Or switch to Perform and drag while the movie plays.'],
  ['Share it', 'File, then Export, makes a video, an animated picture or a set of frames.'],
];

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ['Mod+N', 'New Movie'], ['Mod+E', 'Export'], ['Mod+W', 'Close Movie'], ['Mod+Z', 'Undo'], ['Shift+Mod+T', 'New Track'], ['F1', 'The manual'],
];

const mod = (): string => (/Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl');
const keyText = (k: string): string => k.replace('Mod', mod());

interface Saved { name: string; path: string; modified: number; size: number; text: string }

async function ideasCall<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(`/api/ideas${path}`, init); } catch { throw new Error(t('The formmorpheus engine service is not running. Start it with ./formmorpheus.')); }
  if (!res.ok) {
    let detail = '';
    try { const b = (await res.json()) as { detail?: unknown }; if (typeof b.detail === 'string') detail = b.detail; } catch { /* not JSON */ }
    throw new Error(detail || res.statusText);
  }
  return (await res.json()) as T;
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* falls back to a hidden field */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export class HelpCenter extends Dialog {
  private readonly panes = new Map<Tab, HTMLElement>();
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly ticks = new Map<string, HTMLElement>();
  private tab: Tab = 'start';
  private manual: HelpView | null = null;
  private readonly note = el<HTMLTextAreaElement>('<textarea class="cv-input" rows="6" maxlength="20000" spellcheck="true" aria-label="Your note" placeholder="Tell us what would make formmorpheus better, or what went wrong."></textarea>');
  private readonly kind = el<HTMLSelectElement>('<select class="cv-input" aria-label="What kind of note"><option value="Idea">An idea</option><option value="Problem">Something that went wrong</option><option value="Question">A question</option></select>');
  private readonly status = el('<span class="fm-hc-note"></span>');
  private readonly where = el('<div class="fm-hc-path" hidden></div>');
  private readonly savedBox = el('<div class="fm-hc-saved"></div>');
  private readonly savedHead = el('<h3 class="fm-hc-h" hidden>Saved notes</h3>');
  private lastSaved: Saved | null = null;
  private loaded = false;

  constructor(private readonly coach: TutorialCoach, private readonly run: (command: string) => void) {
    super('Help Center', 880);
    q<HTMLElement>(this.scrim, '.cv-dialog').classList.add('fm-hc-dlg');
    q<HTMLElement>(this.scrim, '.cv-dialog-head').prepend(el(`<span class="fm-help-headicon">${icon('info', 16)}</span>`));
    const shell = el('<div class="fm-hc"></div>');
    const nav = el('<nav class="fm-hc-nav" aria-label="Help Center sections" role="tablist"></nav>');
    const host = el('<div class="fm-hc-main"></div>');
    for (const [id, label] of TABS) {
      const b = el<HTMLButtonElement>(`<button class="fm-hc-tab" type="button" role="tab" data-tab="${id}"></button>`);
      setText(b, label);
      nav.appendChild(b);
      this.tabs.set(id, b);
      const p = el(`<div class="fm-hc-pane" role="tabpanel" hidden></div>`);
      this.panes.set(id, p);
      host.appendChild(p);
    }
    shell.append(nav, host);
    this.body.appendChild(shell);
    nav.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (id) this.pick(id);
    });
    this.buildStart();
    this.buildTutorials();
    this.buildIdea();
    this.buildMore();
    coach.onChange = () => this.syncTicks();
    this.pick('start');
  }

  private pane(id: Tab): HTMLElement { return this.panes.get(id) as HTMLElement; }

  /** A command from a button in the center: close first so the window that opens is the only one. */
  private go(command: string): void { this.close(); this.run(command); }

  private lead(text: string): HTMLElement { const p = el('<p class="fm-hc-lead"></p>'); setText(p, text); return p; }
  private head(text: string): HTMLElement { const h = el('<h3 class="fm-hc-h"></h3>'); setText(h, text); return h; }
  private btn(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = el<HTMLButtonElement>(`<button class="cv-btn${primary ? ' cv-btn-primary' : ''}" type="button"></button>`);
    setText(b, label);
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------------------------------------------------------------- Getting started
  private buildStart(): void {
    const p = this.pane('start');
    p.appendChild(this.lead('Welcome. Five steps take you from an empty movie to a finished video. The tutorials walk you through each one inside the app, on a practice movie.'));
    const ol = el('<ol class="fm-hc-steps"></ol>');
    for (const [title, text] of GETTING_STARTED) {
      const li = el('<li></li>');
      const b = el('<b></b>'); setText(b, title);
      li.append(b, document.createTextNode(' '));
      const s = el('<span></span>'); setText(s, text);
      li.appendChild(s);
      ol.appendChild(li);
    }
    p.appendChild(ol);
    p.appendChild(this.head('Where to go next'));
    const row = el('<div class="fm-hc-links"></div>');
    row.append(
      this.btn('Start the first tutorial', () => this.runTutorial('keyframes'), true),
      this.btn('Take the Tour', () => this.go('tour')),
      this.btn('Open the example movies', () => { this.close(); this.run('home'); }),
    );
    p.appendChild(row);
    p.appendChild(this.head('On the web'));
    p.appendChild(this.lead('The handbook, the community and the tutorial videos open in your web browser.'));
    const web = el('<div class="fm-hc-links"></div>');
    web.append(
      this.btn('Handbook on the web', () => openExternal(HELP_LINKS.handbook)),
      this.btn('Community', () => openExternal(HELP_LINKS.community)),
      this.btn('Video tutorials', () => openExternal(HELP_LINKS.tutorials)),
      this.btn('Education and learning', () => openExternal(HELP_LINKS.education)),
      this.btn('Idea board', () => openExternal(HELP_LINKS.ideas)),
    );
    p.appendChild(web);
  }

  // ---------------------------------------------------------------- Tutorials
  private buildTutorials(): void {
    const p = this.pane('tutorials');
    p.appendChild(this.lead('Each tutorial opens a practice movie, points at the real controls one step at a time and waits for you to use them. Nothing is saved unless you save it. Stop at any time.'));
    const list = el('<div class="fm-hc-list"></div>');
    // the step lists are built per start; this list only needs their titles
    for (const tut of this.coach.catalog()) {
      const card = el(`<div class="fm-hc-card"><div><div class="fm-hc-card-title"><span class="fm-hc-tick" hidden>${icon('check', 14)}</span><span class="fm-hc-name"></span></div><div class="fm-hc-card-note"></div></div></div>`);
      setText(q(card, '.fm-hc-name'), t(tut.title));
      setText(q(card, '.fm-hc-card-note'), `${t(tut.blurb)} · ${tut.minutes} ${t('min')}`);
      card.appendChild(this.btn('Start', () => this.runTutorial(tut.id), true));
      this.ticks.set(tut.id, q(card, '.fm-hc-tick'));
      list.appendChild(card);
    }
    p.appendChild(list);
    this.syncTicks();
  }

  private syncTicks(): void {
    const done = tutorialsDone();
    for (const [id, n] of this.ticks) setHidden(n, !done.includes(id));
  }

  private runTutorial(id: string): void {
    this.close();
    void this.coach.start(id);
  }

  // ---------------------------------------------------------------- Send an idea
  private buildIdea(): void {
    const p = this.pane('idea');
    p.appendChild(this.lead('Write an idea, a problem or a question. It is saved as a small text file on this computer; nothing is sent anywhere. Share the file or copy the text wherever you like.'));
    const form = el('<div class="fm-hc-idea"></div>');
    const row = el('<div class="fm-hc-idea-row"></div>');
    const gap = el('<span class="fm-hc-gap"></span>');
    const save = this.btn('Save note', () => { void this.saveNote(); }, true);
    const copy = this.btn('Copy to clipboard', () => { void this.copyNote(); });
    row.append(this.kind, gap, copy, save);
    form.append(this.note, row, this.status, this.where);
    p.appendChild(form);
    p.append(this.savedHead, this.savedBox);
    this.note.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void this.saveNote(); } });
    this.note.addEventListener('input', () => setText(this.status, ''));
  }

  private async saveNote(): Promise<void> {
    const text = this.note.value.trim();
    if (!text) { setText(this.status, t('Write something first.')); this.note.focus(); return; }
    try {
      const kind = this.kind.value;
      const item = await ideasCall<Saved>('', { method: 'POST', body: JSON.stringify({ text, kind }), headers: { 'Content-Type': 'application/json' } });
      this.lastSaved = item;
      this.note.value = '';
      setText(this.status, t('Saved. Share this file, or copy its text from the list below.'));
      setText(this.where, item.path);
      setHidden(this.where, false);
      this.addSaved(item, true);
    } catch (err) { setText(this.status, (err as Error).message); }
  }

  private async copyNote(): Promise<void> {
    const text = this.note.value.trim() || this.lastSaved?.text || '';
    if (!text) { setText(this.status, t('Write something first.')); return; }
    setText(this.status, (await copyText(text)) ? t('Copied.') : t('Copy did not work here: select the text and copy it by hand.'));
  }

  private addSaved(item: Saved, top: boolean): void {
    const box = el('<div class="fm-hc-saved-item"></div>');
    const pre = el('<pre class="fm-hc-saved-text"></pre>');
    pre.textContent = item.text;
    const row = el('<div class="fm-hc-idea-row"></div>');
    const note = el('<span class="fm-hc-path"></span>'); note.textContent = item.name;
    row.append(note, el('<span class="fm-hc-gap"></span>'),
      this.btn('Copy text', () => { void copyText(item.text).then((ok) => toast(ok ? 'Copied.' : 'Copy did not work here.')); }),
      this.btn('Copy file location', () => { void copyText(item.path).then((ok) => toast(ok ? 'Copied.' : 'Copy did not work here.')); }),
      this.btn('Delete', () => {
        void ideasCall(`/${encodeURIComponent(item.name)}`, { method: 'DELETE' }).then(() => { box.remove(); setHidden(this.savedHead, !this.savedBox.children.length); }, (e: Error) => toast(e.message, 'error'));
      }));
    box.append(pre, row);
    if (top) this.savedBox.prepend(box); else this.savedBox.appendChild(box);
    setHidden(this.savedHead, false);
  }

  private async loadSaved(): Promise<void> {
    if (this.loaded) return;
    try {
      const r = await ideasCall<{ folder: string; items: Saved[] }>('');
      this.loaded = true;
      for (const it of r.items) this.addSaved(it, false);
      if (r.items.length) { setText(this.where, r.folder); setHidden(this.where, false); }
    } catch { /* the engine is not running: the form says so when saving */ }
  }

  // ---------------------------------------------------------------- Shortcuts and news
  private buildMore(): void {
    const p = this.pane('more');
    p.appendChild(this.head('Keyboard shortcuts'));
    const dl = el('<dl class="fm-hc-keys"></dl>');
    for (const [k, what] of KEYS) {
      const dt = el('<dt></dt>'); dt.textContent = keyText(k);
      const dd = el('<dd></dd>'); setText(dd, what);
      dl.append(dt, dd);
    }
    p.appendChild(dl);
    const a = el('<div class="fm-hc-links"></div>');
    a.append(this.btn('All Keyboard Shortcuts...', () => this.go('shortcuts')), this.btn('Search commands', () => this.go('search')));
    p.appendChild(a);
    p.appendChild(this.head('What is new'));
    p.appendChild(this.lead('See what each release added, with a button that shows you where it is.'));
    const b = el('<div class="fm-hc-links"></div>');
    b.append(
      this.btn("What's New...", () => this.go('whats-new')),
      this.btn('Take the Tour', () => this.go('tour')),
      this.btn('About formmorpheus', () => this.go('about')),
      this.btn('Reset Examples...', () => this.go('reset-examples')),
    );
    p.appendChild(b);
  }

  // ---------------------------------------------------------------- the manual, mounted once
  private mountManual(): void {
    if (this.manual) return;
    const hv = new HelpView((c) => { this.go(c); });
    this.manual = hv;
    const shell = hv.body.firstElementChild;
    const p = this.pane('manual');
    if (shell) p.appendChild(shell);
    setClass(p, 'is-flush', true);
  }

  private pick(id: Tab): void {
    this.tab = id;
    if (id === 'manual') this.mountManual();
    if (id === 'idea') void this.loadSaved();
    for (const [k, b] of this.tabs) { setClass(b, 'is-current', k === id); b.setAttribute('aria-selected', String(k === id)); }
    for (const [k, p] of this.panes) setHidden(p, k !== id);
  }

  /** Opens the Help Center at a tab (the first by default). */
  show(tab?: Tab): void {
    this.pick(tab ?? this.tab);
    this.open(this.tabs.get(this.tab));
  }
}
