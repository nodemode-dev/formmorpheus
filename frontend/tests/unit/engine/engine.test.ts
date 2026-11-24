import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine, type Ticker } from '@src/engine/engine';
import { content, track } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import type { Asset, Content, Movie } from '@src/engine/types';

class ManualTicker implements Ticker {
  t = 0;
  private pending: (() => void) | null = null;
  cancelled = 0;
  now(): number { return this.t; }
  request(fn: () => void): number { this.pending = fn; return 1; }
  cancel(): void { this.pending = null; this.cancelled++; }
  advance(ms: number): void {
    this.t += ms;
    const fn = this.pending;
    this.pending = null;
    if (fn) fn();
  }
}

function fresh(seconds = 1): { engine: Engine; ticker: ManualTicker } {
  const engine = new Engine();
  const ticker = new ManualTicker();
  engine.setTicker(ticker);
  engine.create({ fps: 24, seconds, width: 640, height: 360, name: 'Test' });
  return { engine, ticker };
}

function withBlocks(engine: Engine, n: number): Content[] {
  const items = Array.from({ length: n }, (_, i) => content('solid', i * 2, 4, { name: `S${i}` }));
  engine.run('Seed', (m) => ({ ...m, tracks: [track('A', items)] }));
  return items;
}

function movieOf(engine: Engine): Movie {
  if (!engine.movie) throw new Error('no movie');
  return engine.movie;
}

function pixels(id: string): Asset {
  return { id, kind: 'pixels', name: id, mime: 'image/png', width: 4, height: 4, frames: 1, size: 10 };
}

beforeEach(() => {
  localStorage.clear();
});

describe('Engine documents', () => {
  it('opens a new movie at frame zero, unmodified and in compose mode', () => {
    const { engine } = fresh();
    expect(engine.movie?.name).toBe('Test');
    expect(engine.frame).toBe(0);
    expect(engine.modified).toBe(false);
    expect(engine.mode).toBe('compose');
    expect(engine.projects).toHaveLength(1);
    expect(engine.history.canUndo).toBe(false);
  });

  it('selects the first track of an opened movie', () => {
    const { engine } = fresh();
    const m = { ...movieOf(engine), tracks: [track('A'), track('B')] };
    engine.open(m, 'lib');
    expect(engine.selection).toEqual({ content: [], track: m.tracks[0].id });
    expect(engine.libraryName).toBe('lib');
  });

  it('forgets the movie, the blobs and the history on close', () => {
    const { engine } = fresh();
    engine.addAsset(pixels('p1'), new Blob(['x']));
    engine.close();
    expect(engine.movie).toBeNull();
    expect(engine.projects).toHaveLength(0);
    expect(engine.assets.size).toBe(0);
    expect(engine.history.canUndo).toBe(false);
    expect(engine.modified).toBe(false);
  });

  it('renames the movie without adding an undo step', () => {
    const { engine } = fresh();
    const seen: string[] = [];
    engine.on('movie', (m) => seen.push(m.name));
    engine.nameMovie('Renamed');
    engine.nameMovie('Renamed');
    expect(seen).toEqual(['Renamed']);
    expect(engine.history.canUndo).toBe(false);
  });

  it('clears the modified flag when marked saved', () => {
    const { engine } = fresh();
    withBlocks(engine, 1);
    expect(engine.modified).toBe(true);
    const saved = vi.fn();
    engine.on('saved', saved);
    engine.markSaved('file-a');
    expect(engine.modified).toBe(false);
    expect(engine.libraryName).toBe('file-a');
    expect(saved).toHaveBeenCalledTimes(1);
  });
});

describe('Engine commands and undo', () => {
  it('refuses to run a command when no movie is open', () => {
    const engine = new Engine();
    const fn = vi.fn((m: Movie) => m);
    expect(engine.run('Nothing', fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('records nothing when a command returns the same movie', () => {
    const { engine } = fresh();
    const rev = engine.revision;
    expect(engine.run('Noop', (m) => m)).toBe(false);
    expect(engine.history.canUndo).toBe(false);
    expect(engine.modified).toBe(false);
    expect(engine.revision).toBe(rev);
  });

  it('applies a command, marks the movie modified and bumps the revision', () => {
    const { engine } = fresh();
    const rev = engine.revision;
    expect(engine.run('Paint it black', (m) => ({ ...m, background: '#000000' }))).toBe(true);
    expect(engine.movie?.background).toBe('#000000');
    expect(engine.modified).toBe(true);
    expect(engine.revision).toBe(rev + 1);
    expect(engine.history.undoLabel).toBe('Paint it black');
  });

  it('turns an operation error into an error notice and leaves the movie alone', () => {
    const { engine } = fresh();
    const before = engine.movie;
    const notices: { text: string; kind: string }[] = [];
    engine.on('notice', (n) => notices.push(n));
    const ok = engine.run('Fail', () => { throw new OpError('Refused here'); });
    expect(ok).toBe(false);
    expect(notices).toEqual([{ text: 'Refused here', kind: 'error' }]);
    expect(engine.movie).toBe(before);
    expect(engine.history.canUndo).toBe(false);
  });

  it('lets an unexpected error escape', () => {
    const { engine } = fresh();
    expect(() => engine.run('Crash', () => { throw new TypeError('boom'); })).toThrow('boom');
  });

  it('undoes and redoes back to the exact movie objects', () => {
    const { engine } = fresh();
    const first = engine.movie;
    engine.run('Tint', (m) => ({ ...m, background: '#111111' }));
    const second = engine.movie;
    const notices: string[] = [];
    engine.on('notice', (n) => notices.push(n.text));
    engine.undo();
    expect(engine.movie).toBe(first);
    expect(engine.history.canRedo).toBe(true);
    engine.redo();
    expect(engine.movie).toBe(second);
    expect(engine.history.canRedo).toBe(false);
    expect(notices).toEqual(['Undo Tint', 'Redo Tint']);
  });

  it('does nothing on undo and redo with an empty history', () => {
    const { engine } = fresh();
    const before = engine.movie;
    const notice = vi.fn();
    engine.on('notice', notice);
    engine.undo();
    engine.redo();
    expect(engine.movie).toBe(before);
    expect(notice).not.toHaveBeenCalled();
  });

  it('drops the redo steps when a new command runs after an undo', () => {
    const { engine } = fresh();
    engine.run('One', (m) => ({ ...m, background: '#111111' }));
    engine.undo();
    engine.run('Two', (m) => ({ ...m, background: '#222222' }));
    expect(engine.history.canRedo).toBe(false);
    expect(engine.history.undoLabel).toBe('Two');
  });

  it('merges the commands of one gesture into a single undo step', () => {
    const { engine } = fresh();
    const start = engine.movie;
    engine.run('Drag', (m) => ({ ...m, width: 700 }), 'drag');
    engine.run('Drag', (m) => ({ ...m, width: 800 }), 'drag');
    engine.run('Drag', (m) => ({ ...m, width: 900 }), 'drag');
    expect(engine.history.past).toHaveLength(1);
    engine.endGesture();
    engine.run('Drag', (m) => ({ ...m, width: 950 }), 'drag');
    expect(engine.history.past).toHaveLength(2);
    engine.undo();
    expect(engine.movie?.width).toBe(900);
    engine.undo();
    expect(engine.movie).toBe(start);
  });

  it('applies a view change without an undo step', () => {
    const { engine } = fresh();
    expect(engine.view((m) => ({ ...m, loopVisible: false }))).toBe(true);
    expect(engine.movie?.loopVisible).toBe(false);
    expect(engine.history.canUndo).toBe(false);
    expect(engine.view((m) => m)).toBe(false);
  });

  it('pulls the playhead back inside a movie that became shorter', () => {
    const { engine } = fresh(2);
    engine.seek(40);
    engine.run('Shorten', (m) => ({ ...m, duration: 10 }));
    expect(engine.frame).toBe(9);
  });

  it('selects the ids a command asks for', () => {
    const { engine } = fresh();
    const item = content('solid', 0, 5);
    engine.run('Add', (m) => ({ movie: { ...m, tracks: [track('A', [item])] }, select: [item.id] }));
    expect(engine.selection.content).toEqual([item.id]);
    expect(engine.selected.map((c) => c.id)).toEqual([item.id]);
  });

  it('keeps the recent share of undo steps between 10 and 100 percent', () => {
    const { engine } = fresh();
    engine.setUndoDepth(50, 3);
    expect(engine.history.recentPercent).toBe(10);
    engine.setUndoDepth(50, 400);
    expect(engine.history.recentPercent).toBe(100);
  });
});

describe('Engine selection', () => {
  it('ignores ids that are not in the movie', () => {
    const { engine } = fresh();
    const [a, b] = withBlocks(engine, 2);
    engine.select([a.id, 'ghost', b.id]);
    expect(engine.selection.content).toEqual([a.id, b.id]);
    expect(engine.selection.track).toBe(movieOf(engine).tracks[0].id);
  });

  it('filters a long selection the same way as a short one', () => {
    const { engine } = fresh();
    const items = withBlocks(engine, 10);
    engine.select([...items.map((c) => c.id), 'ghost']);
    expect(engine.selection.content).toEqual(items.map((c) => c.id));
  });

  it('stays quiet when the selection does not change', () => {
    const { engine } = fresh();
    const [a] = withBlocks(engine, 1);
    engine.select([a.id]);
    const seen = vi.fn();
    engine.on('selection', seen);
    engine.select([a.id]);
    expect(seen).not.toHaveBeenCalled();
  });

  it('toggles one id in and out of the selection', () => {
    const { engine } = fresh();
    const [a, b] = withBlocks(engine, 2);
    engine.toggleSelect(a.id);
    engine.toggleSelect(b.id);
    expect(engine.selection.content).toEqual([a.id, b.id]);
    engine.toggleSelect(a.id);
    expect(engine.selection.content).toEqual([b.id]);
  });

  it('drops selected content that a command or an undo removed', () => {
    const { engine } = fresh();
    const [a] = withBlocks(engine, 1);
    engine.select([a.id]);
    engine.undo();
    expect(engine.selection.content).toEqual([]);
    expect(engine.selection.track).toBeNull();
  });

  it('reports whether the playhead is over a block with an exclusive end', () => {
    const { engine } = fresh();
    const c = content('solid', 2, 3);
    engine.seek(2);
    expect(engine.isOver(c)).toBe(true);
    engine.seek(4);
    expect(engine.isOver(c)).toBe(true);
    engine.seek(5);
    expect(engine.isOver(c)).toBe(false);
    engine.seek(1);
    expect(engine.isOver(c)).toBe(false);
  });
});

describe('Engine time and playback', () => {
  it('clamps and rounds a seek to the frames of the movie', () => {
    const { engine } = fresh();
    const last = movieOf(engine).duration - 1;
    engine.seek(3.6);
    expect(engine.frame).toBe(4);
    engine.seek(-50);
    expect(engine.frame).toBe(0);
    engine.seek(1e9);
    expect(engine.frame).toBe(last);
  });

  it('emits time only when the frame really changes', () => {
    const { engine } = fresh();
    const seen: number[] = [];
    engine.on('time', (f) => seen.push(f));
    engine.seek(5);
    engine.seek(5.2);
    engine.seek(6);
    expect(seen).toEqual([5, 6]);
  });

  it('emits a mode change once', () => {
    const { engine } = fresh();
    const seen: string[] = [];
    engine.on('mode', (m) => seen.push(m));
    engine.setMode('compose');
    expect(seen).toEqual([]);
  });

  it('advances frames from the clock and the frame rate', () => {
    const { engine, ticker } = fresh();
    engine.play();
    expect(engine.playing).toBe(true);
    ticker.advance(500);
    expect(engine.frame).toBe(12);
    ticker.advance(250);
    expect(engine.frame).toBe(18);
  });

  it('wraps to the start when a looping movie runs past its end', () => {
    const { engine, ticker } = fresh();
    const wraps: { frame: number; direction: number }[] = [];
    engine.on('wrap', (w) => wraps.push(w));
    engine.play();
    ticker.advance(1500);
    expect(engine.frame).toBe(0);
    expect(wraps).toEqual([{ frame: 0, direction: 1 }]);
    ticker.advance(250);
    expect(engine.frame).toBe(6);
    expect(engine.playing).toBe(true);
  });

  it('stops on the last frame of a one-shot movie', () => {
    const { engine, ticker } = fresh();
    engine.view((m) => ({ ...m, playback: 'oneshot' }));
    const last = movieOf(engine).duration - 1;
    const states: boolean[] = [];
    engine.on('playing', (p) => states.push(p));
    engine.play();
    ticker.advance(5000);
    expect(engine.frame).toBe(last);
    expect(engine.playing).toBe(false);
    expect(states).toEqual([true, false]);
  });

  it('restarts a one-shot movie from the start when played at its end', () => {
    const { engine } = fresh();
    engine.view((m) => ({ ...m, playback: 'oneshot' }));
    engine.seek(1e9);
    engine.play();
    expect(engine.frame).toBe(0);
  });

  it('turns round at the end of a ping pong movie and plays backwards', () => {
    const { engine, ticker } = fresh();
    engine.view((m) => ({ ...m, playback: 'pingpong' }));
    const last = movieOf(engine).duration - 1;
    const wraps: { frame: number; direction: number }[] = [];
    engine.on('wrap', (w) => wraps.push(w));
    engine.play();
    ticker.advance(1500);
    expect(engine.frame).toBe(last);
    expect(wraps).toEqual([{ frame: last, direction: -1 }]);
    ticker.advance(250);
    expect(engine.frame).toBe(last - 6);
    ticker.advance(5000);
    expect(engine.frame).toBe(0);
    expect(wraps[1]).toEqual({ frame: 0, direction: 1 });
  });

  it('cancels the pending tick when stopped and ignores a second stop', () => {
    const { engine, ticker } = fresh();
    const states: boolean[] = [];
    engine.on('playing', (p) => states.push(p));
    engine.play();
    engine.play();
    engine.stop();
    engine.stop();
    expect(states).toEqual([true, false]);
    expect(ticker.cancelled).toBe(1);
    ticker.advance(500);
    expect(engine.frame).toBe(0);
  });

  it('stops playback when stepping by frames', () => {
    const { engine } = fresh();
    engine.togglePlay();
    engine.step(3);
    expect(engine.playing).toBe(false);
    expect(engine.frame).toBe(3);
    engine.step(-10);
    expect(engine.frame).toBe(0);
  });

  it('plays the whole movie when nothing limits the span', () => {
    const { engine } = fresh();
    expect(engine.playSpan()).toEqual({ lo: 0, last: movieOf(engine).duration - 1 });
  });

  it('uses the loop range of the movie, clamped to its frames', () => {
    const { engine } = fresh();
    const last = movieOf(engine).duration - 1;
    engine.view((m) => ({ ...m, loopFrom: 5.9, loopTo: 10.2 }));
    expect(engine.playSpan()).toEqual({ lo: 5, last: 10 });
    engine.view((m) => ({ ...m, loopFrom: -4, loopTo: 9999 }));
    expect(engine.playSpan()).toEqual({ lo: 0, last });
  });

  it('falls back to the visible region when the loop range is reversed', () => {
    const { engine } = fresh();
    engine.view((m) => ({ ...m, loopFrom: 12, loopTo: 3 }));
    engine.setRegion(() => ({ from: 2.7, to: 6.9 }));
    expect(engine.playSpan()).toEqual({ lo: 2, last: 6 });
  });

  it('ignores the visible region when the movie does not loop it', () => {
    const { engine } = fresh();
    engine.setRegion(() => ({ from: 2, to: 6 }));
    engine.view((m) => ({ ...m, loopVisible: false }));
    expect(engine.playSpan()).toEqual({ lo: 0, last: movieOf(engine).duration - 1 });
  });

  it('jumps into the loop range before playing and loops inside it', () => {
    const { engine, ticker } = fresh();
    engine.view((m) => ({ ...m, loopFrom: 4, loopTo: 9 }));
    engine.seek(20);
    engine.play();
    expect(engine.frame).toBe(4);
    ticker.advance(125);
    expect(engine.frame).toBe(7);
    ticker.advance(500);
    expect(engine.frame).toBe(4);
  });
});

describe('Engine jobs', () => {
  it('tracks jobs with rising ids and reports progress', () => {
    const { engine } = fresh();
    const progress = vi.fn();
    engine.on('progress', progress);
    const a = engine.startJob('Export', 10);
    const b = engine.startJob('Import', 2);
    expect(b.id).toBe(a.id + 1);
    engine.stepJob(a, 4);
    expect(engine.jobs[0].done).toBe(4);
    expect(engine.cancelJob(b.id)).toBe(true);
    expect(b.cancelled).toBe(true);
    expect(engine.cancelJob(9999)).toBe(false);
    engine.endJob(a);
    expect(engine.jobs).toEqual([b]);
    expect(progress).toHaveBeenCalledTimes(5);
  });
});

describe('Engine assets and clipboard', () => {
  it('stores the blob and records the asset as one undo step', () => {
    const { engine } = fresh();
    const blob = new Blob(['x']);
    engine.addAsset(pixels('p1'), blob);
    expect(engine.assets.get('p1')).toBe(blob);
    expect(engine.movie?.assets.p1.kind).toBe('pixels');
    engine.undo();
    expect(engine.movie?.assets.p1).toBeUndefined();
  });

  it('lets go of an unused picture only after two collections in a row', () => {
    const { engine } = fresh();
    engine.addAsset(pixels('stray'), new Blob(['x']));
    expect(engine.collectAssets()).toBe(0);
    expect(engine.assets.has('stray')).toBe(true);
    expect(engine.collectAssets()).toBe(1);
    expect(engine.assets.has('stray')).toBe(false);
  });

  it('keeps a picture that a layer of the movie still uses', () => {
    const { engine } = fresh();
    engine.addAsset(pixels('used'), new Blob(['x']));
    const base = content('drawing', 0, 5);
    const drawing = { ...base, layers: [{ ...base.layers[0], pixels: 'used' }] };
    engine.run('Draw', (m) => ({ ...m, tracks: [track('A', [drawing])] }));
    engine.collectAssets();
    expect(engine.collectAssets()).toBe(0);
    expect(engine.assets.has('used')).toBe(true);
  });

  it('keeps a picture that only an undo step still uses', () => {
    const { engine } = fresh();
    engine.addAsset(pixels('old'), new Blob(['x']));
    const base = content('drawing', 0, 5);
    const drawing = { ...base, layers: [{ ...base.layers[0], pixels: 'old' }] };
    engine.run('Draw', (m) => ({ ...m, tracks: [track('A', [drawing])] }));
    engine.run('Erase', (m) => ({ ...m, tracks: [track('A', [base])] }));
    engine.collectAssets();
    expect(engine.collectAssets()).toBe(0);
    expect(engine.assets.has('old')).toBe(true);
  });

  it('collects nothing when no movie is open', () => {
    expect(new Engine().collectAssets()).toBe(0);
  });

  it('has an empty clipboard until something selected is copied', () => {
    const { engine } = fresh();
    const [a] = withBlocks(engine, 1);
    engine.copy();
    expect(engine.hasClipboard).toBe(false);
    engine.select([a.id]);
    engine.copy();
    expect(engine.hasClipboard).toBe(true);
  });

  it('removes the selected blocks on cut as an undoable step', () => {
    const { engine } = fresh();
    const [a, b] = withBlocks(engine, 2);
    engine.select([a.id]);
    engine.copy(true);
    expect(movieOf(engine).tracks.flatMap((t) => t.content).map((c) => c.id)).toEqual([b.id]);
    expect(engine.history.undoLabel).toBe('Cut');
    expect(engine.selection.content).toEqual([]);
    engine.undo();
    expect(movieOf(engine).tracks[0].content).toHaveLength(2);
  });

  it('pastes a copy with a new id and selects it', () => {
    const { engine } = fresh();
    const [a] = withBlocks(engine, 1);
    engine.select([a.id]);
    engine.copy();
    engine.paste();
    const all = movieOf(engine).tracks.flatMap((t) => t.content);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((c) => c.id)).size).toBe(2);
    expect(engine.selection.content).toHaveLength(1);
    expect(engine.selection.content[0]).not.toBe(a.id);
    expect(engine.history.undoLabel).toBe('Paste');
  });

  it('leaves out a pasted block whose picture is not in this movie', () => {
    localStorage.setItem('fm.clipboard.v1', JSON.stringify([content('image', 0, 5, { asset: 'missing' })]));
    const { engine } = fresh();
    expect(engine.hasClipboard).toBe(true);
    const notices: { kind: string; vars?: Record<string, string | number> }[] = [];
    engine.on('notice', (n) => notices.push(n));
    engine.paste();
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe('error');
    expect(notices[0].vars).toEqual({ count: 1 });
    expect(movieOf(engine).tracks.flatMap((t) => t.content)).toHaveLength(0);
    expect(engine.history.canUndo).toBe(false);
  });

  it('starts with an empty clipboard when the stored one is malformed', () => {
    localStorage.setItem('fm.clipboard.v1', '{not json');
    expect(new Engine().hasClipboard).toBe(false);
    localStorage.setItem('fm.clipboard.v1', '{"a":1}');
    expect(new Engine().hasClipboard).toBe(false);
  });

  it('inserts a block at the playhead that runs to the end of the movie', () => {
    const { engine } = fresh();
    engine.seek(6);
    const id = engine.insert('solid');
    expect(id).not.toBeNull();
    const c = movieOf(engine).tracks.flatMap((t) => t.content).find((x) => x.id === id);
    expect(c?.start).toBe(6);
    expect(c?.duration).toBe(movieOf(engine).duration - 6);
    expect(engine.selection.content).toEqual([id]);
    expect(engine.insert('solid', {}, 5)).not.toBeNull();
  });

  it('returns null from insert when no movie is open', () => {
    expect(new Engine().insert('solid')).toBeNull();
  });
});
