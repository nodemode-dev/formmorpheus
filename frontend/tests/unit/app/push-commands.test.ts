import { beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock('@src/engine/ops', () => ({
  trimContent: (m: unknown, id: string, edge: string, d: number, ripple: boolean) => { log.calls.push(['trim', id, edge, d, ripple]); return m; },
}));
vi.mock('@src/engine/push-ops', () => ({
  pushContent: (m: unknown, ids: string[], d: number) => { log.calls.push(['push', ids, d]); return m; },
  keepInside: (m: unknown) => { log.calls.push(['keepInside']); return m; },
}));
vi.mock('@src/engine/flip-order', () => ({
  flipOrder: (m: unknown, ids: string[]) => { log.calls.push(['flip', ids]); return m; },
}));

import { pushCommands } from '@src/app/push-commands';
import type { Engine } from '@src/engine/engine';
import type { Command } from '@src/ui/commands';

interface FakeEngine {
  movie: object | null;
  selected: Array<{ id: string }>;
  selection: { content: string[] };
  over: Set<string>;
  labels: string[];
  isOver: (c: { id: string }) => boolean;
  run: (label: string, fn: (m: object) => object) => void;
}

function setup(ids: string[], over: string[] = []): { e: FakeEngine; cmds: Record<string, Command> } {
  const e: FakeEngine = {
    movie: {}, selected: ids.map((id) => ({ id })), selection: { content: ids.slice() }, over: new Set(over), labels: [],
    isOver: (c) => e.over.has(c.id),
    run(label, fn) { e.labels.push(label); if (e.movie) e.movie = fn(e.movie); },
  };
  const cmds: Record<string, Command> = {};
  for (const c of pushCommands(e as unknown as Engine)) cmds[c.id] = c;
  return { e, cmds };
}

describe('pushCommands', () => {
  beforeEach(() => { log.calls.length = 0; });

  it('binds each command to its own key', () => {
    const { cmds } = setup([]);
    const keys = Object.values(cmds).flatMap((c) => c.keys ?? []);
    expect(keys.length).toBe(4);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('disables pushing without a selection or without a movie', () => {
    const { e, cmds } = setup([]);
    expect(cmds['push-content-left'].enabled?.()).toBe(false);
    e.selection.content = ['a'];
    expect(cmds['push-content-left'].enabled?.()).toBe(true);
    e.movie = null;
    expect(cmds['push-content-right'].enabled?.()).toBe(false);
  });

  it('enables flipping order only with two or more selected', () => {
    const { e, cmds } = setup(['a']);
    expect(cmds['flip-order'].enabled?.()).toBe(false);
    e.selection.content = ['a', 'b'];
    expect(cmds['flip-order'].enabled?.()).toBe(true);
    cmds['flip-order'].run();
    expect(log.calls).toEqual([['flip', ['a', 'b']]]);
  });

  it('pushes the selection one frame earlier or later', () => {
    const { e, cmds } = setup(['a', 'b']);
    cmds['push-content-left'].run();
    cmds['push-content-right'].run();
    expect(log.calls).toEqual([['push', ['a', 'b'], -1], ['push', ['a', 'b'], 1]]);
    expect(e.labels).toEqual(['Push Content', 'Push Content']);
  });

  it('extends the selected content under the Playhead and keeps the rest inside', () => {
    const { e, cmds } = setup(['a', 'b', 'c'], ['b', 'c']);
    cmds['extend-push'].run();
    expect(log.calls).toEqual([['trim', 'b', 'end', 1, true], ['trim', 'c', 'end', 1, true], ['keepInside']]);
    expect(e.labels).toEqual(['Extend and Push']);
  });

  it('contracts without the keep inside pass', () => {
    const { cmds } = setup(['a'], ['a']);
    cmds['contract-pull'].run();
    expect(log.calls).toEqual([['trim', 'a', 'end', -1, true]]);
  });

  it('falls back to the first selected content when none is under the Playhead', () => {
    const { cmds } = setup(['a', 'b'], []);
    cmds['contract-pull'].run();
    expect(log.calls).toEqual([['trim', 'a', 'end', -1, true]]);
  });
});
