import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/engine/keys', () => ({ kindSpec: (k: string) => ({ label: k.replace(/^fx:/, '').toUpperCase() }) }));

import { ActionGroups, type ActionGroup } from '@src/ui/action-groups';
import type { KeyKind } from '@src/engine/types';

function row(kind: KeyKind): HTMLElement {
  const d = document.createElement('div');
  d.dataset.kind = kind;
  return d;
}

function build(groups: ActionGroup[], kinds: string[]): { g: ActionGroups; list: HTMLElement } {
  const g = new ActionGroups();
  const list = document.createElement('div');
  g.fill(list, groups, kinds as KeyKind[], row);
  return { g, list };
}

function layout(list: HTMLElement): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = [];
  const kids = Array.from(list.children) as HTMLElement[];
  for (let i = 0; i < kids.length; i += 2) {
    out.push([kids[i].textContent ?? '', Array.from(kids[i + 1].children).map((c) => (c as HTMLElement).dataset.kind ?? '')]);
  }
  return out;
}

function type(g: ActionGroups, text: string): void {
  const input = g.search.querySelector('input') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

const GROUPS: ActionGroup[] = [
  { title: 'Move', kinds: ['move', 'warp'] },
  { title: 'Filters', kinds: ['blur', 'noise'] },
  { title: 'More', kinds: ['glow'], rest: true },
];

describe('ActionGroups.fill', () => {
  it('files rows under their headings in the group order', () => {
    const { list } = build(GROUPS, ['noise', 'warp', 'move', 'blur', 'glow']);
    expect(layout(list)).toEqual([
      ['Move', ['move', 'warp']],
      ['Filters', ['blur', 'noise']],
      ['More', ['glow']],
    ]);
  });

  it('matches registry effects by their bare id and keeps the lane kind on the row', () => {
    const { list } = build(GROUPS, ['fx:blur', 'move']);
    expect(layout(list)).toEqual([['Move', ['move']], ['Filters', ['fx:blur']]]);
  });

  it('puts kinds no group names under the rest group after its own', () => {
    const { list } = build(GROUPS, ['glow', 'fx:sparkle', 'move']);
    expect(layout(list)).toEqual([['Move', ['move']], ['More', ['glow', 'fx:sparkle']]]);
  });

  it('puts unnamed kinds under the first group when none is the rest group', () => {
    const groups: ActionGroup[] = [{ title: 'A', kinds: ['move'] }, { title: 'B', kinds: ['time'] }];
    const { list } = build(groups, ['time', 'odd']);
    expect(layout(list)).toEqual([['A', ['odd']], ['B', ['time']]]);
  });

  it('leaves out a heading with no rows', () => {
    const { list } = build(GROUPS, ['blur']);
    expect(layout(list)).toEqual([['Filters', ['blur']]]);
  });
});

describe('ActionGroups search', () => {
  it('marks rows that miss the search and hides headings left empty', () => {
    const { g, list } = build(GROUPS, ['move', 'warp', 'blur']);
    type(g, '  BL ');
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-kind]'));
    expect(rows.filter((r) => !r.classList.contains('is-miss')).map((r) => r.dataset.kind)).toEqual(['blur']);
    const heads = Array.from(list.children).filter((_, i) => i % 2 === 0) as HTMLElement[];
    expect(heads.map((h) => h.hidden)).toEqual([true, false]);
    expect(g.emptyNote.hidden).toBe(true);
  });

  it('shows the empty note when nothing matches', () => {
    const { g } = build(GROUPS, ['move', 'blur']);
    type(g, 'zzz');
    expect(g.emptyNote.hidden).toBe(false);
  });

  it('counts a hidden row as not shown', () => {
    const { g, list } = build(GROUPS, ['move', 'blur']);
    (list.querySelector('[data-kind="blur"]') as HTMLElement).hidden = true;
    g.refresh();
    const heads = Array.from(list.children).filter((_, i) => i % 2 === 0) as HTMLElement[];
    expect(heads.map((h) => h.hidden)).toEqual([false, true]);
  });

  it('clears the search on reset and shows every row again', () => {
    const { g, list } = build(GROUPS, ['move', 'blur']);
    type(g, 'zzz');
    g.reset();
    expect((g.search.querySelector('input') as HTMLInputElement).value).toBe('');
    expect(list.querySelectorAll('.is-miss')).toHaveLength(0);
    expect(g.emptyNote.hidden).toBe(true);
  });

  it('keeps typed keys from reaching the stage shortcuts but lets Escape through', () => {
    const { g } = build(GROUPS, ['move']);
    document.body.appendChild(g.search);
    const outer = vi.fn();
    document.body.addEventListener('keydown', outer);
    const input = g.search.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(outer).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(outer).toHaveBeenCalledTimes(1);
    document.body.removeEventListener('keydown', outer);
    g.search.remove();
  });
});
