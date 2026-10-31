// Grouping and search for the Action menu lists: Transform and Time under Move; Filters, Color, Blur, Stylize and Keying under Live Filters.
// The rows are made once by the caller; this only files them under headings and toggles classes, so nothing is rebuilt.
import { kindSpec } from '../engine/keys';
import type { KeyKind } from '../engine/types';
import { el, q, setHidden, setText } from './dom';
import '../styles/fx-stack.css';

export interface ActionGroup { title: string; kinds: string[] }

export const MOTION_GROUPS: ActionGroup[] = [
  { title: 'Transform', kinds: ['move', 'warp', 'distort', 'bones'] },
  { title: 'Time', kinds: ['time', 'textanim'] },
];

/** Filters is also where a kind with no entry lands. */
export const FILTER_GROUPS: ActionGroup[] = [
  { title: 'Filters', kinds: ['opacity', 'noise', 'boil'] },
  { title: 'Color', kinds: ['hsb', 'colorcorrect', 'vignette'] },
  { title: 'Blur', kinds: ['blur', 'sharpen', 'lensblur', 'dirblur', 'radblur', 'motionblur'] },
  { title: 'Stylize', kinds: ['glow', 'shadow', 'pixelate', 'chromatic', 'mirror'] },
  { title: 'Keying', kinds: ['chromakey', 'lumakey'] },
];

interface Sub { head: HTMLElement; rows: Array<{ kind: KeyKind; wrap: HTMLElement }> }

export class ActionGroups {
  readonly search: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly empty: HTMLElement;
  private readonly subs: Sub[] = [];

  constructor() {
    this.search = el('<div class="fm-ka-search"><input type="search" autocomplete="off" spellcheck="false"></div>');
    this.input = q(this.search, 'input');
    this.input.placeholder = 'Search actions';
    this.input.setAttribute('aria-label', 'Search actions');
    this.empty = el('<div class="fm-ka-empty" hidden></div>');
    setText(this.empty, 'Nothing matches');
    this.input.addEventListener('input', () => this.refresh());
    // keys typed here must not reach the Stage shortcuts
    this.input.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  }

  get emptyNote(): HTMLElement { return this.empty; }

  /** Files the rows of `kinds` into `list` under the headings of `groups`; kinds no group names go under the first one. */
  fill(list: HTMLElement, groups: ActionGroup[], kinds: KeyKind[], rowFor: (kind: KeyKind) => HTMLElement): void {
    // registry effects are lane kinds `fx:<id>`; the groups name the bare id
    const byId = new Map<string, string>(kinds.map((k) => [k.replace(/^fx:/, ''), k]));
    const named = new Set(groups.flatMap((g) => g.kinds));
    groups.forEach((g, gi) => {
      const mine = g.kinds.filter((k) => byId.has(k)).map((k) => byId.get(k)!);
      if (gi === 0) for (const [id, k] of byId) if (!named.has(id)) mine.push(k);
      if (!mine.length) return;
      const head = el('<div class="fm-ka-shead"></div>');
      setText(head, g.title);
      const sub = el('<div class="fm-ka-sub"></div>');
      const rows = mine.map((k) => ({ kind: k as KeyKind, wrap: rowFor(k as KeyKind) }));
      for (const r of rows) sub.appendChild(r.wrap);
      list.append(head, sub);
      this.subs.push({ head, rows });
    });
  }

  reset(): void {
    if (this.input.value) { this.input.value = ''; }
    this.refresh();
  }

  /** Applies the search text and hides headings that have no row left to show. */
  refresh(): void {
    const needle = this.input.value.trim().toLowerCase();
    let any = false;
    for (const s of this.subs) {
      let vis = false;
      for (const r of s.rows) {
        const miss = needle !== '' && !kindSpec(r.kind).label.toLowerCase().includes(needle);
        r.wrap.classList.toggle('is-miss', miss);
        if (!miss && !r.wrap.hidden) vis = true;
      }
      setHidden(s.head, !vis);
      any = any || vis;
    }
    setHidden(this.empty, any);
  }
}
