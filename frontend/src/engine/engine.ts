import { strayPixels } from './asset-gc';
import { Emitter } from './events';
import { History, type RecoveryPoint } from './history';
import { content as makeContent, contentEnd, end, flipTrack, kindName, locate, newMovie, type NewMovieOptions } from './model';
import * as ops from './ops';
import * as groupInner from './group-inner-ops';
import { findGroup } from './group-inner-ops';
import { groupCtx } from './group-ctx';
import type { Asset, Content, ContentKind, Mode, Movie, Selection } from './types';
import { HIGHLIGHTS } from './types';

export interface Notice { text: string; kind: 'info' | 'error' }
export interface EngineJob { id: number; name: string; done: number; total: number; cancelled?: boolean }

export interface EngineEvents {
  movie: Movie;
  selection: Selection;
  time: number;
  mode: Mode;
  history: void;
  playing: boolean;
  /** Playback jumped (loop back to the start, or a ping pong turn): sound restarts from here. */
  wrap: { frame: number; direction: 1 | -1 };
  projects: void;
  notice: Notice;
  progress: void;
  saved: void;
}

export interface Ticker {
  now(): number;
  request(fn: () => void): number;
  cancel(id: number): void;
}

const defaultTicker: Ticker = {
  now: () => performance.now(),
  request: (fn) => setTimeout(fn, 16) as unknown as number,
  cancel: (id) => clearTimeout(id),
};

type OpResult = Movie | { movie: Movie; select?: string[] };

export class Engine extends Emitter<EngineEvents> {
  movie: Movie | null = null;
  readonly history = new History();
  readonly assets = new Map<string, Blob>();
  selection: Selection = { content: [], track: null };
  frame = 0;
  mode: Mode = 'compose';
  playing = false;
  libraryName: string | null = null;
  modified = false;
  revision = 0;
  jobs: EngineJob[] = [];
  private clipboard: Content[] = Engine.loadClip();
  private static readonly CLIP_KEY = 'fm.clipboard.v1';

  /** The copied blocks of the last session, so a reload keeps the clipboard (blocks only: pictures and sounds come back by their ids when the same movie opens). */
  private static loadClip(): Content[] {
    try {
      const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(Engine.CLIP_KEY);
      const v = raw ? (JSON.parse(raw) as unknown) : null;
      return Array.isArray(v) ? (v as Content[]) : [];
    } catch { return []; }
  }

  private saveClip(): void {
    try {
      const raw = JSON.stringify(this.clipboard);
      if (raw.length < 2_000_000) localStorage.setItem(Engine.CLIP_KEY, raw); else localStorage.removeItem(Engine.CLIP_KEY);
    } catch { /* storage blocked or full: the clipboard still works this session */ }
  }
  private ticker: Ticker = defaultTicker;
  private tick = 0;
  private playFrom = 0;
  private playStart = 0;
  private direction: 1 | -1 = 1;
  private nextJob = 1;
  private region: (() => { from: number; to: number } | null) | null = null;

  get projects(): readonly Movie[] {
    return this.movie ? [this.movie] : [];
  }

  setTicker(t: Ticker): void {
    this.ticker = t;
  }

  newDocument(width: number, height: number, name: string, fps: number, flipbook: boolean): void {
    this.open(newMovie({ width, height, name, fps, flipbook }), null);
  }

  create(opts: NewMovieOptions): void {
    this.open(newMovie(opts), null);
  }

  open(movie: Movie, libraryName: string | null, assets?: Map<string, Blob>, past: { label: string; movie: Movie }[] = [], recovery: RecoveryPoint[] = []): void {
    this.stop();
    this.movie = movie;
    this.libraryName = libraryName;
    this.assets.clear();
    if (assets) for (const [k, v] of assets) this.assets.set(k, v);
    this.history.clear();
    this.history.past = past;
    this.history.recovery = recovery;
    this.selection = { content: [], track: movie.tracks[0]?.id ?? null };
    this.frame = 0;
    this.mode = 'compose';
    this.modified = false;
    this.revision++;
    this.emit('projects', undefined);
    this.emit('movie', movie);
    this.emit('selection', this.selection);
    this.emit('time', this.frame);
    this.emit('mode', this.mode);
    this.emit('history', undefined);
  }

  close(): void {
    this.stop();
    this.movie = null;
    this.libraryName = null;
    this.assets.clear();
    this.history.clear();
    this.selection = { content: [], track: null };
    this.modified = false;
    this.emit('projects', undefined);
  }

  nameMovie(name: string): void {
    const m = this.movie;
    if (!m || m.name === name) return;
    this.movie = { ...m, name };
    this.emit('movie', this.movie);
  }

  markSaved(name: string): void {
    this.libraryName = name;
    this.modified = false;
    this.emit('saved', undefined);
    this.emit('projects', undefined);
  }

  notice(text: string, kind: Notice['kind'] = 'info'): void {
    this.emit('notice', { text, kind });
  }

  run(label: string, fn: (m: Movie) => OpResult, merge: string | null = null): boolean {
    const before = this.movie;
    if (!before) return false;
    let result: OpResult;
    try {
      result = fn(before);
    } catch (e) {
      if (e instanceof ops.OpError) { this.notice(e.message, 'error'); return false; }
      throw e;
    }
    const next = 'movie' in result && !('tracks' in result) ? result.movie : (result as Movie);
    const select = 'select' in result ? result.select : undefined;
    if (next === before) return false;
    this.history.record(before, label, merge);
    this.apply(next);
    if (select) this.select(select);
    else this.pruneSelection();
    return true;
  }

  /** A change of view state only (a lane opened or closed): shown at once, saved with the movie, never an undo step. */
  view(fn: (m: Movie) => Movie): boolean {
    const before = this.movie;
    if (!before) return false;
    const next = fn(before);
    if (next === before) return false;
    this.apply(next);
    return true;
  }

  endGesture(): void {
    this.history.endGesture();
  }

  private apply(next: Movie): void {
    this.movie = next;
    this.modified = true;
    this.revision++;
    if (this.frame >= next.duration) this.seek(next.duration - 1);
    this.emit('movie', next);
    this.emit('history', undefined);
    this.emit('projects', undefined);
  }

  undo(): void {
    if (!this.movie) return;
    const step = this.history.undo(this.movie);
    if (!step) return;
    this.apply(step.movie);
    this.pruneSelection();
    this.notice(`Undo ${step.label}`);
  }

  redo(): void {
    if (!this.movie) return;
    const step = this.history.redo(this.movie);
    if (!step) return;
    this.apply(step.movie);
    this.pruneSelection();
    this.notice(`Redo ${step.label}`);
  }

  restoreRecovery(id: string): void {
    const point = this.history.recovery.find((r) => r.id === id);
    if (!point || !this.movie) return;
    this.history.record(this.movie, 'Restore Recovery Point', null);
    this.apply(point.movie);
    this.pruneSelection();
  }

  private strays = new Set<string>();

  /**
   * Lets go of picture blobs no state (movie, undo, redo, recovery points, clipboard) uses. A blob must be unused on two
   * calls in a row, so one a paint save has just written and not yet linked into the movie is never taken.
   */
  collectAssets(): number {
    const m = this.movie;
    if (!m) { this.strays.clear(); return 0; }
    const all = [...this.history.past, ...this.history.future, ...this.history.recovery].map((s) => s.movie);
    const now = strayPixels(m, all, this.clipboard);
    const drop = now.filter((id) => this.strays.has(id));
    this.strays = new Set(now);
    for (const id of drop) this.assets.delete(id);
    return drop.length;
  }

  setUndoDepth(depth: number, recentPercent = this.history.recentPercent): void {
    this.history.recentPercent = Math.max(10, Math.min(100, Math.round(recentPercent)));
    this.history.setDepth(depth);
    this.emit('history', undefined);
  }

  select(ids: string[], track: string | null = null): void {
    const m = this.movie;
    // many ids (select all) are checked against one pass over the movie, not one search per id
    let valid: string[] = [];
    if (m && ids.length > 8) {
      const have = new Set<string>();
      const walk = (ts: typeof m.tracks): void => { for (const t of ts) for (const c of t.content) have.add(c.id); };
      walk(m.tracks);
      valid = ids.filter((id) => have.has(id));
    } else if (m) valid = ids.filter((id) => !!locate(m, id));
    const t = track ?? (valid.length && m ? locate(m, valid[valid.length - 1])?.track.id ?? null : this.selection.track);
    const same = valid.length === this.selection.content.length && valid.every((id, i) => id === this.selection.content[i]) && t === this.selection.track;
    if (same) return;
    this.selection = { content: valid, track: t };
    this.emit('selection', this.selection);
  }

  toggleSelect(id: string): void {
    const has = this.selection.content.includes(id);
    this.select(has ? this.selection.content.filter((x) => x !== id) : [...this.selection.content, id]);
  }

  private pruneSelection(): void {
    const m = this.movie;
    if (!m) return;
    let keep = this.selection.content;
    if (keep.length > 8) {
      const have = new Set<string>();
      for (const t of m.tracks) for (const c of t.content) have.add(c.id);
      keep = keep.filter((id) => have.has(id));
    } else keep = keep.filter((id) => !!locate(m, id));
    const track = this.selection.track && m.tracks.some((t) => t.id === this.selection.track) ? this.selection.track : m.tracks[0]?.id ?? null;
    if (keep.length !== this.selection.content.length || track !== this.selection.track) {
      this.selection = { content: keep, track };
      this.emit('selection', this.selection);
    }
  }

  get selected(): Content[] {
    const m = this.movie;
    if (!m) return [];
    return this.selection.content.map((id) => locate(m, id)?.content).filter((c): c is Content => !!c);
  }

  seek(frame: number): void {
    const m = this.movie;
    if (!m) return;
    const f = Math.max(0, Math.min(Math.max(0, m.duration - 1), Math.round(frame)));
    if (f === this.frame) return;
    this.frame = f;
    this.emit('time', f);
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.emit('mode', mode);
  }

  /** The Timeline lends its visible frames; playback loops inside them while the movie asks for it. */
  setRegion(fn: (() => { from: number; to: number } | null) | null): void {
    this.region = fn;
  }

  /** First and last frame playback runs between: the visible region when the movie loops it, else the whole movie. */
  playSpan(): { lo: number; last: number } {
    const m = this.movie;
    const whole = { lo: 0, last: Math.max(0, (m?.duration ?? 1) - 1) };
    if (m && m.loopFrom !== undefined && m.loopTo !== undefined && m.loopTo >= m.loopFrom) {
      const lo = Math.max(0, Math.min(whole.last, Math.floor(m.loopFrom)));
      return { lo, last: Math.max(lo, Math.min(whole.last, Math.floor(m.loopTo))) };
    }
    const r = m?.loopVisible ? this.region?.() : null;
    if (!r) return whole;
    const lo = Math.max(0, Math.min(whole.last, Math.floor(r.from)));
    const last = Math.max(lo, Math.min(whole.last, Math.floor(r.to)));
    return { lo, last };
  }

  play(): void {
    const m = this.movie;
    if (!m || this.playing) return;
    const span = this.playSpan();
    if ((m.loopVisible || m.loopFrom !== undefined) && (this.frame < span.lo || this.frame > span.last)) this.seek(span.lo);
    else if (m.playback === 'oneshot' && this.frame >= span.last) this.seek(span.lo);
    this.playing = true;
    this.direction = 1;
    this.playFrom = this.frame;
    this.playStart = this.ticker.now();
    this.emit('playing', true);
    this.loop();
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.ticker.cancel(this.tick);
    this.tick = 0;
    this.reportDrops();
    this.emit('playing', false);
  }

  togglePlay(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  private loop(): void {
    const m = this.movie;
    if (!m || !this.playing) return;
    const elapsed = ((this.ticker.now() - this.playStart) / 1000) * m.fps;
    const { lo, last } = this.playSpan();
    let f = this.playFrom + this.direction * Math.floor(elapsed);
    if (f > last || f < lo) {
      if (m.playback === 'oneshot') { this.seek(last); this.stop(); return; }
      if (m.playback === 'pingpong') {
        this.direction = f > last ? -1 : 1;
        this.playFrom = f > last ? last : lo;
      } else {
        this.playFrom = lo;
      }
      this.playStart = this.ticker.now();
      f = this.playFrom;
      this.lastLoopFrame = -1;
      this.emit('wrap', { frame: f, direction: this.direction });
    }
    const jump = Math.abs(f - this.lastLoopFrame) - 1;
    if (this.lastLoopFrame >= 0 && jump > 0 && jump < 30) this.skipped += jump;
    this.shown++;
    this.lastLoopFrame = f;
    this.seek(f);
    this.tick = this.ticker.request(() => this.loop());
  }

  private lastLoopFrame = -1;
  private skipped = 0;
  private shown = 0;

  /** Playback is clock-driven, so a heavy movie drops frames; say so once a run, after it stops. */
  private reportDrops(): void {
    const total = this.skipped + this.shown;
    if (total >= 24 && this.skipped / total > 0.2) {
      this.notice(`Playback skipped ${Math.round((this.skipped / total) * 100)} percent of the frames: this movie is heavy for the Stage. Hide tracks, shrink the movie size, or turn on the GPU in Preferences.`);
    }
    this.skipped = 0;
    this.shown = 0;
    this.lastLoopFrame = -1;
  }

  step(delta: number): void {
    this.stop();
    this.seek(this.frame + delta);
  }

  addAsset(asset: Asset, blob: Blob): void {
    this.assets.set(asset.id, blob);
    this.run(`Add ${asset.name}`, (m) => ({ ...m, assets: { ...m.assets, [asset.id]: asset } }));
  }

  insert(kind: ContentKind, extra: Partial<Content> = {}, at: number = this.frame): string | null {
    const m = this.movie;
    if (!m) return null;
    const start = Math.max(0, Math.min(at, m.duration - 1));
    // a new Flipbook runs two seconds (less where the movie ends) and takes the next of the seven highlight colors, so lanes read at a glance
    const length = kind === 'flipbook' ? Math.max(1, Math.min(m.duration - start, Math.round(m.fps) * 2)) : Math.max(1, m.duration - start);
    const flip = kind === 'flipbook' && !extra.flip ? [flipTrack('Track 1', length)] : undefined;
    const palette = HIGHLIGHTS.filter((h) => h !== 'none');
    const tint = kind === 'flipbook' ? { highlight: palette[m.tracks.reduce((n, t) => n + t.content.filter((c) => c.kind === 'flipbook').length, 0) % palette.length] } : {};
    const item = makeContent(kind, start, extra.duration ?? length, { name: extra.name ?? kindName(kind), ...(flip ? { flip } : {}), ...tint, ...extra });
    // an open group being worked in takes the new block on its own tracks, in the group's frames
    const gid = groupCtx.target();
    const grp = gid ? findGroup(m.tracks, gid) : null;
    if (grp) {
      const local = Math.max(grp.offset, Math.min(grp.offset + grp.duration - 1, at - grp.start + grp.offset));
      const inGroup: Content = { ...item, start: local, duration: Math.max(1, Math.min(item.duration, grp.offset + grp.duration - local)) };
      const ok2 = this.run(`Add ${item.name}`, (mv) => ({ movie: groupInner.placeInGroup(mv, grp.id, inGroup, 0), select: [grp.id] }));
      if (ok2) groupCtx.picked = inGroup.id;
      return ok2 ? inGroup.id : null;
    }
    const trackIndex = this.selection.track ? Math.max(0, m.tracks.findIndex((t) => t.id === this.selection.track)) : 0;
    const ok = this.run(`Add ${item.name}`, (mv) => {
      const placed = ops.placeContent(mv, null, item, trackIndex);
      return { movie: placed.movie, select: [item.id] };
    });
    return ok ? item.id : null;
  }

  copy(cut = false): void {
    const items = this.selected;
    if (!items.length) return;
    this.clipboard = JSON.parse(JSON.stringify(items)) as Content[];
    this.saveClip();
    if (cut) this.run('Cut', (m) => ops.deleteContent(m, items.map((c) => c.id)));
  }

  paste(): void {
    if (!this.clipboard.length) return;
    // a clipboard kept from another movie (or another session) must not paste blocks whose picture or sound this movie lacks
    const have = this.movie?.assets ?? {};
    const items = this.clipboard.filter((c) => !c.asset || have[c.asset]);
    if (!items.length) return;
    this.run('Paste', (m) => {
      const r = ops.pasteContent(m, items, this.frame, this.selection.track);
      return { movie: r.movie, select: r.ids };
    });
  }

  get hasClipboard(): boolean {
    return this.clipboard.length > 0;
  }

  contentEnd(): number {
    return this.movie ? contentEnd(this.movie) : 0;
  }

  startJob(name: string, total: number): EngineJob {
    const job: EngineJob = { id: this.nextJob++, name, done: 0, total };
    this.jobs = [...this.jobs, job];
    this.emit('progress', undefined);
    return job;
  }

  stepJob(job: EngineJob, done: number): void {
    job.done = done;
    this.emit('progress', undefined);
  }

  endJob(job: EngineJob): void {
    this.jobs = this.jobs.filter((j) => j !== job);
    this.emit('progress', undefined);
  }

  cancelJob(id: number): boolean {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return false;
    job.cancelled = true;
    this.emit('progress', undefined);
    return true;
  }

  isOver(c: Content): boolean {
    return this.frame >= c.start && this.frame < end(c);
  }
}
