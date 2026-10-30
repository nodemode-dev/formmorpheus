// The Help window: the manual (docs/MANUAL.md, bundled at build time) with a section list and search.
// The Markdown is turned into DOM nodes once; search and the section list only toggle hidden and classes.

import manual from '../../../docs/MANUAL.md?raw';
import '../styles/help.css';
import { Dialog } from './dialogs';
import { el, q, setClass, setHidden, setText } from './dom';
import { icon } from './icons';
import { t } from './i18n';

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

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export class HelpView extends Dialog {
  private readonly sections: Section[] = [];
  private readonly search = el<HTMLInputElement>('<input class="cv-input fm-help-search" type="search" placeholder="Search the manual" aria-label="Search the manual" spellcheck="false">');
  // The manual is written in English only: its section names and text stay whole rather than half translated word by word.
  private readonly list = el('<nav class="fm-help-nav" aria-label="Manual sections" data-no-i18n></nav>');
  private readonly page = el('<div class="fm-help-page" tabindex="0" data-no-i18n></div>');
  private readonly empty = el('<p class="fm-help-empty" hidden></p>');
  private current = 0;

  constructor() {
    super('formmorpheus Manual', 920);
    q<HTMLElement>(this.scrim, '.cv-dialog').classList.add('fm-help-dlg');
    q<HTMLElement>(this.scrim, '.cv-dialog-head').prepend(el(`<span class="fm-help-headicon">${icon('info', 16)}</span>`));

    const title = /^#\s+(.*)$/m.exec(manual)?.[1] ?? 'formmorpheus Manual';
    const parts = manual.replace(/^#\s+.*$/m, '').split(/^##\s+/m);
    const intro = parts.shift() ?? '';
    const side = el('<aside class="fm-help-side"></aside>');
    side.append(this.search, this.list);
    const shell = el('<div class="fm-help"></div>');
    shell.append(side, this.page);
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
    this.page.appendChild(this.empty);

    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
      if (b) this.pick(Number(b.dataset.i));
    });
    this.search.addEventListener('input', () => this.filter());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.search.value) { e.stopPropagation(); this.search.value = ''; this.filter(); }
    });
    this.pick(0);
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
    this.sections.forEach((s, i) => {
      const match = !searching || words.every((w) => s.text.includes(w));
      if (match) hits++;
      setHidden(s.item, !match);
      setClass(s.item, 'is-current', !searching ? i === this.current : false);
      setHidden(s.body, searching ? !match : i !== this.current);
    });
    setHidden(this.empty, hits > 0);
    setText(this.empty, searching && !hits ? t('Nothing in the manual matches that.') : '');
  }

  /** Opens the manual, at a section when its name is given. */
  show(section?: string): void {
    if (section) {
      const at = this.sections.findIndex((s) => s.title.toLowerCase() === section.toLowerCase());
      if (at >= 0) { this.search.value = ''; this.pick(at); }
    }
    this.open(this.search);
  }
}
