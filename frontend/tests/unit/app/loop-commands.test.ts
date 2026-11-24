import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/ui/toast', () => ({ toast: vi.fn() }));

import { loopCommands } from '@src/app/loop-commands';
import { toast } from '@src/ui/toast';
import type { Engine } from '@src/engine/engine';
import type { Command } from '@src/ui/commands';

interface FakeMovie { duration: number; loopFrom?: number; loopTo?: number }
interface FakeEngine { movie: FakeMovie | null; frame: number; labels: string[]; run: (label: string, fn: (m: FakeMovie) => FakeMovie) => void }

function makeEngine(movie: FakeMovie | null, frame: number): FakeEngine {
  const engine: FakeEngine = {
    movie, frame, labels: [],
    run(label, fn) { engine.labels.push(label); if (engine.movie) engine.movie = fn(engine.movie); },
  };
  return engine;
}

function cmd(engine: FakeEngine, id: string): Command {
  const found = loopCommands(engine as unknown as Engine).find((c) => c.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe('loopCommands', () => {
  beforeEach(() => { vi.mocked(toast).mockClear(); });

  it('offers loop start, loop end and clear with unique ids', () => {
    const ids = loopCommands(makeEngine(null, 0) as unknown as Engine).map((c) => c.id);
    expect(ids).toEqual(['loop-in', 'loop-out', 'loop-clear']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is disabled when no movie is open', () => {
    const e = makeEngine(null, 0);
    for (const c of loopCommands(e as unknown as Engine)) expect(c.enabled?.()).toBe(false);
  });

  it('sets the loop start at the Playhead and the end at the last frame', () => {
    const e = makeEngine({ duration: 100 }, 5);
    cmd(e, 'loop-in').run();
    expect(e.movie).toMatchObject({ loopFrom: 5, loopTo: 99 });
    expect(e.labels).toEqual(['Set Loop Start']);
  });

  it('keeps an existing loop end that lies after the new start', () => {
    const e = makeEngine({ duration: 100, loopFrom: 0, loopTo: 20 }, 10);
    cmd(e, 'loop-in').run();
    expect(e.movie).toMatchObject({ loopFrom: 10, loopTo: 20 });
  });

  it('pushes the loop end forward when the start passes it', () => {
    const e = makeEngine({ duration: 100, loopFrom: 0, loopTo: 20 }, 40);
    cmd(e, 'loop-in').run();
    expect(e.movie).toMatchObject({ loopFrom: 40, loopTo: 40 });
  });

  it('sets the loop end at the Playhead and the start at frame zero', () => {
    const e = makeEngine({ duration: 100 }, 30);
    cmd(e, 'loop-out').run();
    expect(e.movie).toMatchObject({ loopFrom: 0, loopTo: 30 });
  });

  it('pulls the loop start back when the end is set before it', () => {
    const e = makeEngine({ duration: 100, loopFrom: 50, loopTo: 80 }, 25);
    cmd(e, 'loop-out').run();
    expect(e.movie).toMatchObject({ loopFrom: 25, loopTo: 25 });
  });

  it('announces the loop range counted from one', () => {
    const e = makeEngine({ duration: 100 }, 5);
    cmd(e, 'loop-in').run();
    expect(toast).toHaveBeenCalledTimes(1);
    const msg = String(vi.mocked(toast).mock.calls[0][0]);
    expect(msg).toContain('6');
    expect(msg).toContain('100');
  });

  it('clears both loop marks and is enabled only while a loop exists', () => {
    const e = makeEngine({ duration: 100 }, 0);
    expect(cmd(e, 'loop-clear').enabled?.()).toBe(false);
    e.movie = { duration: 100, loopFrom: 3, loopTo: 9 };
    const clear = cmd(e, 'loop-clear');
    expect(clear.enabled?.()).toBe(true);
    clear.run();
    expect(e.movie).toEqual({ duration: 100 });
    expect('loopFrom' in (e.movie ?? {})).toBe(false);
    expect(clear.enabled?.()).toBe(false);
  });
});
