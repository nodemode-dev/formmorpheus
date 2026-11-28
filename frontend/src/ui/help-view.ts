// The Help window: the manual (docs/MANUAL.md, bundled at build time) with a section list and search.
// The Markdown is turned into DOM nodes once; search and the section list only toggle hidden and classes.

import manual from '../../../docs/MANUAL.md?raw';
import '../styles/help.css';
import { Dialog } from './dialogs';
import { el, q, setClass, setHidden, setText } from './dom';
import { figure, pictureLine } from './help-figures';
import { icon } from './icons';
import { onLanguage, t } from './i18n';
import { tf } from './i18n-fill';
import { RELEASES } from './whats-new-data';

// ---------------------------------------------------------------- Markdown to DOM

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** Inline spans: `code`, **bold**, [text](url). Only http(s) links become anchors. */
function inline(parent: HTMLElement, src: string): void {
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > at) parent.appendChild(document.createTextNode(src.slice(at, m.index)));
    if (m[1] !== undefined) parent.appendChild(node('code', 'fm-help-code', m[1]));
    else if (m[2] !== undefined) parent.appendChild(node('strong', undefined, m[2]));
    else if (/^https?:\/\//.test(m[4])) {
      const a = node('a', 'fm-help-link', m[3]);
      a.href = m[4];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parent.appendChild(a);
    } else parent.appendChild(document.createTextNode(m[3]));
    at = m.index + m[0].length;
  }
  if (at < src.length) parent.appendChild(document.createTextNode(src.slice(at)));
}

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** Headings, paragraphs, lists (bulleted and numbered), tables and fenced code. */
export function renderMarkdown(src: string, into: ParentNode): void {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const pic = pictureLine(line);
    if (pic) {
      const fig = figure(pic.name, pic.alt);
      if (fig) into.appendChild(fig);
      i++;
      continue;
    }
    const fence = /^```/.exec(line);
    if (fence) {
      const out: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) out.push(lines[i]);
      i++;
      const pre = node('pre', 'fm-help-pre');
      pre.appendChild(node('code', undefined, out.join('\n')));
      into.appendChild(pre);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const n = node(`h${Math.min(4, h[1].length + 1)}` as 'h2', `fm-help-h fm-help-h${h[1].length}`);
      inline(n, h[2]);
      into.appendChild(n);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const wrap = node('div', 'fm-help-table');
      const table = node('table');
      const head = node('tr');
      for (const c of cells(line)) { const th = node('th'); inline(th, c); head.appendChild(th); }
      table.appendChild(node('thead')).appendChild(head);
      const body = node('tbody');
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
        const tr = node('tr');
        for (const c of cells(lines[i])) { const td = node('td'); inline(td, c); tr.appendChild(td); }
        body.appendChild(tr);
      }
      table.appendChild(body);
      wrap.appendChild(table);
      into.appendChild(wrap);
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const list = node(ordered ? 'ol' : 'ul', 'fm-help-list');
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        const item = node('li');
        let text = m[3];
        for (i++; i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) text += ` ${lines[i].trim()}`;
        inline(item, text);
        list.appendChild(item);
      }
      into.appendChild(list);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*\||\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) { para.push(line.trim()); i++; }
    const p = node('p', 'fm-help-p');
    inline(p, para.join(' '));
    into.appendChild(p);
  }
}

// ---------------------------------------------------------------- the window

interface Section { title: string; body: HTMLElement; item: HTMLButtonElement; text: string }

/** What one version added: its release highlights plus the manual's "New in" notes, shown under that version's tab. */
interface VersionSection { ver: string; body: HTMLElement; text: string }

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The CSS Custom Highlight API marks matches without touching the DOM (no flash); absent, search still filters. */
interface HighlightApi { set(name: string, h: unknown): void; delete(name: string): void }
const highlights = (): HighlightApi | null => ((window as unknown as { CSS?: { highlights?: HighlightApi } }).CSS?.highlights ?? null);
const makeHighlight = (ranges: Range[]): unknown | null => {
  const H = (window as unknown as { Highlight?: new (...r: Range[]) => { priority: number } }).Highlight;
  return H ? new H(...ranges) : null;
};

export class HelpView extends Dialog {
  private readonly sections: Section[] = [];
  private readonly search = el<HTMLInputElement>('<input class="cv-input fm-help-search" type="search" placeholder="Search the manual" aria-label="Search the manual" spellcheck="false">');
  // The manual is written in English only: its section names and text stay whole rather than half translated word by word.
  private readonly list = el('<nav class="fm-help-nav" aria-label="Manual sections" data-no-i18n></nav>');
  private readonly page = el('<div class="fm-help-page" tabindex="0" data-no-i18n></div>');
  private readonly empty = el('<p class="fm-help-empty" hidden></p>');
  private readonly tabBar = el('<div class="fm-help-tabs" role="tablist" data-no-i18n></div>');
  private readonly count = el('<div class="fm-help-count" role="status" aria-live="polite"></div>');
  private readonly note = el('<p class="fm-help-vnote" hidden></p>');
  private readonly tabs = new Map<string, HTMLButtonElement>();
  private readonly versions: VersionSection[] = [];
  private view = 'all';
  private hits: Range[] = [];
  private at = -1;
  private current = 0;

  constructor(private readonly run: (command: string) => void = () => undefined) {
    super('FormMorpheus Manual', 920);
    q<HTMLElement>(this.scrim, '.cv-dialog').classList.add('fm-help-dlg');
    q<HTMLElement>(this.scrim, '.cv-dialog-head').prepend(el(`<span class="fm-help-headicon">${icon('info', 16)}</span>`));

    const title = /^#\s+(.*)$/m.exec(manual)?.[1] ?? 'FormMorpheus Manual';
    const parts = manual.replace(/^#\s+.*$/m, '').split(/^##\s+/m);
    const intro = parts.shift() ?? '';
    const side = el('<aside class="fm-help-side"></aside>');
    const more = el(`<div class="fm-help-more">
      <button class="cv-btn cv-btn-ghost" type="button" data-c="whats-new">What's New...</button>
      <button class="cv-btn cv-btn-ghost" type="button" data-c="tour">Take the Tour</button>
      <button class="cv-btn cv-btn-ghost" type="button" data-c="about">About FormMorpheus</button>
    </div>`);
    more.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c;
      if (c) { this.close(); this.run(c); }
    });
    side.append(this.search, this.count, this.note, this.list, more);
    const shell = el('<div class="fm-help"></div>');
    const main = el('<div class="fm-help-main"></div>');
    main.append(this.tabBar, this.page);
    shell.append(side, main);
    this.body.appendChild(shell);

    const first = node('section', 'fm-help-sec');
    first.appendChild(node('h2', 'fm-help-h fm-help-h1', title));
    renderMarkdown(intro, first);
    this.add('Welcome', first, `${title} ${intro}`);
    for (const part of parts) {
      const nl = part.indexOf('\n');
      const name = (nl < 0 ? part : part.slice(0, nl)).trim();
      const sec = node('section', 'fm-help-sec');
      sec.id = `help-${slug(name)}`;
      sec.appendChild(node('h2', 'fm-help-h fm-help-h1', name));
      renderMarkdown(nl < 0 ? '' : part.slice(nl + 1), sec);
      this.add(name, sec, `${name} ${part}`);
    }
    this.buildVersions(parts);
    this.page.appendChild(this.empty);
    this.relabelHelp();
    onLanguage(() => this.relabelHelp());

    this.tabBar.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest<HTMLElement>('[data-v]')?.dataset.v;
      if (v) this.setView(v);
    });
    this.tabBar.addEventListener('keydown', (e) => {
      const order = Array.from(this.tabs.keys());
      const i = order.indexOf(this.view);
      const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : -1;
      if (to < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const v = order[(to + order.length) % order.length];
      this.setView(v);
      this.tabs.get(v)?.focus();
    });
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
      if (b) this.pick(Number(b.dataset.i));
    });
    this.search.addEventListener('input', () => this.filter());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.search.value) { e.stopPropagation(); this.search.value = ''; this.filter(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
    });
    this.pick(0);
    // a closed manual leaves no ranges registered
    this.onClose = () => { const api = highlights(); this.hits = []; this.at = -1; if (api) { api.delete('fm-help-hit'); api.delete('fm-help-cur'); } };
  }

  /** One tab per release, newest first, after All; each tab's page is built once here. */
  private buildVersions(parts: string[]): void {
    const addTab = (v: string, label: string, tip: string): void => {
      const b = node('button', 'fm-help-tab', label);
      b.type = 'button';
      b.dataset.v = v;
      b.setAttribute('role', 'tab');
      if (tip) b.title = tip;
      this.tabBar.appendChild(b);
      this.tabs.set(v, b);
    };
    addTab('all', 'All', '');
    for (const rel of RELEASES) {
      addTab(rel.version, rel.version, rel.name);
      const sec = node('section', 'fm-help-sec');
      sec.hidden = true;
      sec.appendChild(node('h2', 'fm-help-h fm-help-h1', `${rel.version} · ${rel.name}`));
      const ul = node('ul', 'fm-help-list');
      let text = `${rel.version} ${rel.name}`;
      for (const a of rel.additions) {
        const li = node('li');
        li.appendChild(node('strong', undefined, a.title));
        li.appendChild(document.createTextNode(` ${a.text}`));
        ul.appendChild(li);
        text += ` ${a.title} ${a.text}`;
      }
      sec.appendChild(ul);
      const notes = parts.find((p) => p.startsWith(`New in ${rel.version}`));
      if (notes) {
        const nl = notes.indexOf('\n');
        const rest = nl < 0 ? '' : notes.slice(nl + 1);
        sec.appendChild(node('h3', 'fm-help-h fm-help-h3', 'Details from the manual'));
        renderMarkdown(rest, sec);
        text += ` ${rest}`;
      }
      this.page.appendChild(sec);
      this.versions.push({ ver: rel.version, body: sec, text: text.toLowerCase() });
    }
  }

  /** The tab bar and search box take the current language; the manual itself stays English. */
  private relabelHelp(): void {
    const all = this.tabs.get('all');
    if (all) setText(all, t('All'));
    this.tabBar.setAttribute('aria-label', t('What each version added'));
    this.search.placeholder = t('Search the manual');
    this.search.setAttribute('aria-label', t('Search the manual'));
    this.syncTabs();
    this.filter();
  }

  private syncTabs(): void {
    for (const [v, b] of this.tabs) {
      const on = v === this.view;
      setClass(b, 'is-current', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  private setView(v: string): void {
    if (!this.tabs.has(v)) return;
    this.view = v;
    this.syncTabs();
    this.tabs.get(v)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.filter();
    this.page.scrollTop = 0;
  }

  /** Puts a highlight on every match in the showing sections; the current match is marked apart. */
  private mark(words: string[]): void {
    const api = highlights();
    this.hits = [];
    this.at = -1;
    if (api) { api.delete('fm-help-hit'); api.delete('fm-help-cur'); }
    if (!words.length || !api) return;
    const bodies = this.view === 'all' ? this.sections.filter((s) => !s.body.hidden).map((s) => s.body) : this.versions.filter((v) => !v.body.hidden).map((v) => v.body);
    for (const body of bodies) {
      const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const low = (n.nodeValue ?? '').toLowerCase();
        const found: Array<[number, number]> = [];
        for (const w of words) for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + w.length)) found.push([i, i + w.length]);
        found.sort((a, b) => a[0] - b[0]);
        for (const [a, b] of found) { const r = document.createRange(); r.setStart(n, a); r.setEnd(n, b); this.hits.push(r); }
      }
    }
    const all = makeHighlight(this.hits);
    if (all && this.hits.length) api.set('fm-help-hit', all);
  }

  /** Enter and Shift+Enter: the next or previous match, scrolled to the middle of the page. */
  private step(dir: number): void {
    const n = this.hits.length;
    if (!n) return;
    this.at = this.at < 0 ? (dir > 0 ? 0 : n - 1) : (this.at + dir + n) % n;
    const api = highlights();
    const h = makeHighlight([this.hits[this.at]]) as { priority: number } | null;
    if (api && h) { h.priority = 1; api.set('fm-help-cur', h); }
    const r = this.hits[this.at].getBoundingClientRect();
    this.page.scrollTop += r.top - this.page.getBoundingClientRect().top - this.page.clientHeight / 3;
    setText(this.count, tf('Match {i} of {n}', { i: this.at + 1, n }));
  }

  private add(title: string, body: HTMLElement, text: string): void {
    const i = this.sections.length;
    const item = node('button', 'fm-help-item', title);
    item.type = 'button';
    item.dataset.i = String(i);
    this.list.appendChild(item);
    this.page.appendChild(body);
    this.sections.push({ title, body, item, text: text.toLowerCase() });
  }

  /** Shows one section, or with a search every matching section in order. */
  private pick(i: number): void {
    this.current = i;
    this.filter();
    this.page.scrollTop = 0;
  }

  private filter(): void {
    const words = this.search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const searching = words.length > 0;
    let hits = 0;
    const all = this.view === 'all';
    this.sections.forEach((s, i) => {
      const match = !searching || words.every((w) => s.text.includes(w));
      if (all && match) hits++;
      setHidden(s.item, !match);
      setClass(s.item, 'is-current', !searching ? i === this.current : false);
      setHidden(s.body, !all || (searching ? !match : i !== this.current));
    });
    for (const v of this.versions) {
      const match = v.ver === this.view && (!searching || words.every((w) => v.text.includes(w)));
      if (match) hits++;
      setHidden(v.body, !match);
    }
    setHidden(this.list, !all);
    setHidden(this.note, all);
    if (!all) setText(this.note, tf('Showing what {version} added. Choose All for the whole manual.', { version: this.view }));
    setHidden(this.empty, hits > 0);
    setText(this.empty, searching && !hits ? t('Nothing in the manual matches that.') : '');
    this.mark(words);
    if (!searching || !hits) setText(this.count, searching ? t('No matches') : '');
    else if (this.hits.length) this.step(1);
    else setText(this.count, t('No matches'));
  }

  /** Opens the manual, at a section when its name is given. */
  show(section?: string): void {
    if (section) {
      const at = this.sections.findIndex((s) => s.title.toLowerCase() === section.toLowerCase());
      if (at >= 0) { this.search.value = ''; this.view = 'all'; this.syncTabs(); this.pick(at); }
    }
    this.open(this.search);
  }
}
