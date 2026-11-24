import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/ui/toast', () => ({ toast: vi.fn() }));
vi.mock('@src/ui/i18n-fill', () => ({ tf: (s: string) => s }));

import { shuttleCommands } from '@src/app/shuttle-commands';
import type { Engine } from '@src/engine/engine';
import type { Command } from '@src/ui/commands';

interface FakeEngine {
  movie: { fps: number; duration: number } | null;
  frame: number;
  playing: boolean;
  seeks: number[];
  playingListeners: Array<(on: boolean) => void>;
  stop: () => void;
  seek: (f: number) => void;
  on: (evt: string, cb: (on: boolean) => void) => void;
}

const engines: FakeEngine[] = [];

function setup(duration: number, frame: number): { e: FakeEngine; cmds: Record<string, Command> } {
  const e: FakeEngine = {
    movie: { fps: 10, duration }, frame, playing: false, seeks: [], playingListeners: [],
    stop() { e.playing = false; },
    seek(f) { e.frame = f; e.seeks.push(f); },
    on(_evt, cb) { e.playingListeners.push(cb); },
  };
  engines.push(e);
  const cmds: Record<string, Command> = {};
  for (const c of shuttleCommands(e as unknown as Engine)) cmds[c.id] = c;
  return { e, cmds };
}

describe('shuttleCommands', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'Date'] }); });
  afterEach(() => {
    for (const e of engines) e.movie = null;
    engines.length = 0;
    vi.useRealTimers();
  });

  it('is disabled without a movie and stop is disabled until shuttling', () => {
    const { e, cmds } = setup(100, 0);
    expect(cmds['shuttle-forward'].enabled?.()).toBe(true);
    expect(cmds['shuttle-pause'].enabled?.()).toBe(false);
    e.movie = null;
    expect(cmds['shuttle-forward'].enabled?.()).toBe(false);
    expect(cmds['shuttle-back'].enabled?.()).toBe(false);
  });

  it('moves the Playhead forward at the movie frame rate', () => {
    const { e, cmds } = setup(1000, 0);
    cmds['shuttle-forward'].run();
    vi.advanceTimersByTime(1000);
    expect(e.frame).toBeGreaterThanOrEqual(9);
    expect(e.frame).toBeLessThanOrEqual(11);
    expect(cmds['shuttle-pause'].enabled?.()).toBe(true);
  });

  it('moves the Playhead backward from where it stands', () => {
    const { e, cmds } = setup(1000, 50);
    cmds['shuttle-back'].run();
    vi.advanceTimersByTime(1000);
    expect(e.frame).toBeGreaterThanOrEqual(39);
    expect(e.frame).toBeLessThanOrEqual(41);
  });

  it('doubles the speed on a second press', () => {
    const { e, cmds } = setup(1000, 0);
    cmds['shuttle-forward'].run();
    cmds['shuttle-forward'].run();
    vi.advanceTimersByTime(1000);
    expect(e.frame).toBeGreaterThanOrEqual(19);
    expect(e.frame).toBeLessThanOrEqual(21);
  });

  it('caps the speed at four times', () => {
    const { e, cmds } = setup(1000, 0);
    for (let i = 0; i < 5; i++) cmds['shuttle-forward'].run();
    vi.advanceTimersByTime(1000);
    expect(e.frame).toBeGreaterThanOrEqual(39);
    expect(e.frame).toBeLessThanOrEqual(41);
  });

  it('stops at the last frame and never seeks past it', () => {
    const { e, cmds } = setup(5, 0);
    cmds['shuttle-forward'].run();
    vi.advanceTimersByTime(3000);
    expect(e.frame).toBe(4);
    expect(Math.max(...e.seeks)).toBe(4);
    expect(cmds['shuttle-pause'].enabled?.()).toBe(false);
  });

  it('stops at frame zero when running backward and never seeks below it', () => {
    const { e, cmds } = setup(100, 3);
    cmds['shuttle-back'].run();
    vi.advanceTimersByTime(3000);
    expect(e.frame).toBe(0);
    expect(Math.min(...e.seeks)).toBe(0);
    expect(cmds['shuttle-pause'].enabled?.()).toBe(false);
  });

  it('halts when stop runs', () => {
    const { e, cmds } = setup(1000, 0);
    cmds['shuttle-forward'].run();
    vi.advanceTimersByTime(500);
    cmds['shuttle-pause'].run();
    const at = e.frame;
    vi.advanceTimersByTime(1000);
    expect(e.frame).toBe(at);
    expect(cmds['shuttle-pause'].enabled?.()).toBe(false);
  });

  it('lets go when something else moves the Playhead', () => {
    const { e, cmds } = setup(1000, 0);
    cmds['shuttle-forward'].run();
    vi.advanceTimersByTime(200);
    e.frame = 500;
    vi.advanceTimersByTime(1000);
    expect(e.frame).toBe(500);
    expect(cmds['shuttle-pause'].enabled?.()).toBe(false);
  });

  it('halts when normal playback starts', () => {
    const { e, cmds } = setup(1000, 0);
    cmds['shuttle-forward'].run();
    for (const cb of e.playingListeners) cb(true);
    expect(cmds['shuttle-pause'].enabled?.()).toBe(false);
  });
});
