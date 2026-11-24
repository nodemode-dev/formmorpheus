import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installHeldZoom, timelineViewCommands } from '@src/app/timeline-view-commands';
import type { Engine } from '@src/engine/engine';
import type { Command } from '@src/ui/commands';
import type { TimelineView } from '@src/ui/timeline';

function key(type: 'keydown' | 'keyup', k: string, repeat: boolean): void {
  window.dispatchEvent(new KeyboardEvent(type, { key: k, repeat, bubbles: true }));
}

const idOf = (e: KeyboardEvent): string | undefined => (e.key === '=' ? 'timeline-in' : e.key === '-' ? 'timeline-out' : e.key === 'x' ? 'other' : undefined);

describe('installHeldZoom', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'Date'] }); });
  afterEach(() => {
    key('keyup', '=', false);
    vi.advanceTimersByTime(100);
    vi.useRealTimers();
  });

  it('ignores the first press so the command makes the one step', () => {
    const zoom = vi.fn();
    installHeldZoom(idOf, zoom);
    key('keydown', '=', false);
    vi.advanceTimersByTime(200);
    expect(zoom).not.toHaveBeenCalled();
  });

  it('zooms in a little each frame while the key is held', () => {
    const zoom = vi.fn();
    installHeldZoom(idOf, zoom);
    key('keydown', '=', true);
    vi.advanceTimersByTime(160);
    expect(zoom.mock.calls.length).toBeGreaterThan(3);
    for (const [f] of zoom.mock.calls) expect(f).toBeGreaterThan(1);
  });

  it('zooms out with factors below one', () => {
    const zoom = vi.fn();
    installHeldZoom(idOf, zoom);
    key('keydown', '-', true);
    vi.advanceTimersByTime(160);
    expect(zoom.mock.calls.length).toBeGreaterThan(3);
    for (const [f] of zoom.mock.calls) expect(f).toBeLessThan(1);
    key('keyup', '-', false);
  });

  it('stops zooming when the key is released', () => {
    const zoom = vi.fn();
    installHeldZoom(idOf, zoom);
    key('keydown', '=', true);
    vi.advanceTimersByTime(100);
    key('keyup', '=', false);
    vi.advanceTimersByTime(50);
    const n = zoom.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(zoom.mock.calls.length).toBe(n);
  });

  it('ignores held keys that are not zoom commands', () => {
    const zoom = vi.fn();
    installHeldZoom(idOf, zoom);
    key('keydown', 'x', true);
    key('keydown', 'q', true);
    vi.advanceTimersByTime(200);
    expect(zoom).not.toHaveBeenCalled();
  });
});

interface Track { id: string; locked?: boolean; content: unknown[] }
interface FakeEngine {
  movie: { tracks: Track[]; loopFrom?: number } | null;
  selected: Array<{ id: string }>;
  selection: { track?: string };
  labels: string[];
  run: (label: string, fn: (m: unknown) => unknown) => void;
}

function setup(movie: FakeEngine['movie'], view: Partial<TimelineView> | null = null): { e: FakeEngine; cmds: Record<string, Command> } {
  const e: FakeEngine = {
    movie, selected: [], selection: {}, labels: [],
    run(label, fn) { e.labels.push(label); e.movie = fn(e.movie) as FakeEngine['movie']; },
  };
  const cmds: Record<string, Command> = {};
  for (const c of timelineViewCommands(e as unknown as Engine, () => view as TimelineView | null)) cmds[c.id] = c;
  return { e, cmds };
}

describe('timelineViewCommands', () => {
  it('gives every command a unique id and no two commands the same key', () => {
    const { cmds } = setup(null);
    const keys = Object.values(cmds).flatMap((c) => c.keys ?? []);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(cmds)).toHaveLength(timelineViewCommands(setup(null).e as unknown as Engine, () => null).length);
  });

  it('enables zoom to loop only when a loop range exists', () => {
    const { e, cmds } = setup({ tracks: [] });
    expect(cmds['timeline-zoom-loop'].enabled?.()).toBe(false);
    e.movie = { tracks: [], loopFrom: 2 };
    expect(cmds['timeline-zoom-loop'].enabled?.()).toBe(true);
  });

  it('enables zoom to selection only with a selection', () => {
    const { e, cmds } = setup({ tracks: [] });
    expect(cmds['timeline-zoom-selection'].enabled?.()).toBe(false);
    e.selected = [{ id: 'c1' }];
    expect(cmds['timeline-zoom-selection'].enabled?.()).toBe(true);
  });

  it('reports track headers as off when no timeline is shown', () => {
    const { cmds } = setup({ tracks: [] }, null);
    expect(cmds['timeline-headers'].checked?.()).toBe(false);
  });

  it('reports track headers as on when the timeline shows them', () => {
    const { cmds } = setup({ tracks: [] }, { headersMode: () => 'full' } as unknown as Partial<TimelineView>);
    expect(cmds['timeline-headers'].checked?.()).toBe(true);
  });

  it('passes zoom and collapse requests to the timeline', () => {
    const view = { zoomToSelection: vi.fn(), collapseTracks: vi.fn(), expandTracks: vi.fn() };
    const { cmds } = setup({ tracks: [] }, view as unknown as Partial<TimelineView>);
    cmds['timeline-zoom-selection'].run();
    cmds['timeline-collapse'].run();
    cmds['timeline-expand'].run();
    expect(view.zoomToSelection).toHaveBeenCalledTimes(1);
    expect(view.collapseTracks).toHaveBeenCalledTimes(1);
    expect(view.expandTracks).toHaveBeenCalledTimes(1);
  });

  it('flips the snap to seconds setting each time it runs', () => {
    const { cmds } = setup(null);
    const before = cmds['snap-seconds'].checked?.();
    cmds['snap-seconds'].run();
    expect(cmds['snap-seconds'].checked?.()).toBe(!before);
    cmds['snap-seconds'].run();
    expect(cmds['snap-seconds'].checked?.()).toBe(before);
  });

  it('cannot lock a track when nothing is chosen', () => {
    const { cmds } = setup({ tracks: [{ id: 't1', content: [] }] });
    expect(cmds['track-lock'].enabled?.()).toBe(false);
  });

  it('locks the chosen track and unlocks it on the next run', () => {
    const { e, cmds } = setup({ tracks: [{ id: 't1', locked: false, content: [] }, { id: 't2', locked: false, content: [] }] });
    e.selection.track = 't1';
    expect(cmds['track-lock'].enabled?.()).toBe(true);
    cmds['track-lock'].run();
    expect(e.labels).toEqual(['Lock Track']);
    expect(e.movie?.tracks.find((t) => t.id === 't1')?.locked).toBe(true);
    expect(e.movie?.tracks.find((t) => t.id === 't2')?.locked).toBeFalsy();
    cmds['track-lock'].run();
    expect(e.labels).toEqual(['Lock Track', 'Unlock Track']);
    expect(e.movie?.tracks.find((t) => t.id === 't1')?.locked).toBeFalsy();
  });
});
