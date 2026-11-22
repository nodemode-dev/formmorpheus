// Memory budgets. One table of limits per tier; desktop keeps today's values exactly. On iPad the web view's content
// process is killed when it holds too much and the limit is not published, so a tier is chosen at start and lowered
// live. Caches read their limit from `memory.get(key)` where they decide, and register a trim callback with
// `memory.watch(key, fn)`. Pure module: no document access at import, safe in workers and in the paint core.

import type { Bridge } from './types';

export type TierName = 'desktop' | 'high' | 'mid' | 'low' | 'floor';

export type BudgetKey =
  | 'gpuTexture' | 'gpuPoolIdle' | 'bitmaps' | 'preload' | 'frameStore'
  | 'videoFrames' | 'videoThumbs' | 'videoLanes'
  | 'paintHistory' | 'paintDense' | 'paintMirror' | 'tipCache'
  | 'audioBus' | 'audioFx'
  | 'undoDepth' | 'undoFloor' | 'paintUndoDepth'
  | 'onionFrames' | 'onionGhosts' | 'exportAhead' | 'flatArea' | 'gifMemory' | 'decodeBytes';

type Table = Record<BudgetKey, number>;

const MiB = 1024 * 1024;

/** Today's values. Infinity means "no cap of its own". */
const DESKTOP: Table = {
  gpuTexture: 512 * MiB, gpuPoolIdle: 64 * MiB, bitmaps: 1024 * MiB, preload: 384 * MiB, frameStore: 384 * MiB,
  videoFrames: 768 * MiB, videoThumbs: 48 * MiB, videoLanes: 4,
  paintHistory: 1024 * MiB, paintDense: 512 * MiB, paintMirror: 768 * MiB, tipCache: 96 * MiB,
  audioBus: 96_000_000, audioFx: 48_000_000,
  undoDepth: Infinity, undoFloor: Infinity, paintUndoDepth: Infinity,
  onionFrames: 12, onionGhosts: 24, exportAhead: 4, flatArea: 48 * MiB, gifMemory: 1.5 * 1024 * MiB, decodeBytes: 512 * MiB,
};

const row = (v: number[]): Table => ({
  gpuTexture: v[0] * MiB, gpuPoolIdle: v[1] * MiB, bitmaps: v[2] * MiB, preload: v[3] * MiB, frameStore: v[4] * MiB,
  videoFrames: v[5] * MiB, videoThumbs: v[6] * MiB, videoLanes: v[7],
  paintHistory: v[8] * MiB, paintDense: v[9] * MiB, paintMirror: v[10] * MiB, tipCache: v[11] * MiB,
  audioBus: v[12] * 1_000_000, audioFx: v[13] * 1_000_000,
  undoDepth: v[14], undoFloor: v[15], paintUndoDepth: v[16],
  onionFrames: v[17], onionGhosts: v[18], exportAhead: v[19], flatArea: v[20] * MiB, gifMemory: v[21] * MiB, decodeBytes: v[22] * MiB,
});

//                         tex pool bmp pre  fs  vid thm ln  phist dense mir tip bus fx  undo flr pundo onion ghost exp flat gif dec
const TABLES: Record<TierName, Table> = {
  desktop: DESKTOP,
  high:  row([256, 48, 512, 192, 192, 320, 32, 3, 512, 320, 384, 48, 48, 24, 250, 40, 120, 6, 12, 3, 32, 768, 256]),
  mid:   row([160, 32, 320, 128, 112, 192, 24, 2, 320, 224, 256, 32, 32, 16, 100, 25, 80, 4, 8, 2, 24, 512, 192]),
  low:   row([96, 24, 192, 64, 64, 112, 16, 2, 192, 160, 160, 24, 24, 12, 50, 15, 50, 3, 6, 2, 16, 384, 128]),
  floor: row([48, 16, 96, 32, 32, 64, 8, 1, 96, 96, 96, 16, 12, 6, 20, 8, 20, 1, 2, 1, 8, 256, 96]),
};

const ORDER: TierName[] = ['high', 'mid', 'low', 'floor'];

export type TrimReason = 'tier' | 'warning' | 'kill';
export type TrimFn = (limit: number, reason: TrimReason) => void;
export type PressureFn = (level: 'warning' | 'tier' | 'kill') => void;

interface NativeInfo { physicalMemory: number; availableMemory: number; terminations: number }

const LS_RAMP = 'fm.diag.ramp';
const LS_FORCE = 'fm-memory-tier';
const LS_KILL = 'fm-memory-kill';
const LS_KILLS_SEEN = 'fm-memory-kills-seen';
const WARN_WINDOW_MS = 30_000;
const KILL_MEMORY_MS = 24 * 3600 * 1000;

function ls(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
function lsGet(k: string): string | null { try { return ls()?.getItem(k) ?? null; } catch { return null; } }
function lsSet(k: string, v: string): void { try { ls()?.setItem(k, v); } catch { /* storage is optional */ } }

type G = { __FM_PLATFORM__?: { kind?: string }; __fmNative?: { receive?: (j: unknown) => unknown; __fmMem?: boolean }; webkit?: { messageHandlers?: { fm?: { postMessage(m: unknown): void } } } };
const g = (): G => globalThis as unknown as G;

class Memory {
  /** 'ipad' when the shell says so or a tier is forced for testing; 'desktop' otherwise (and then nothing here ever changes). */
  kind: 'desktop' | 'ipad' = 'desktop';
  private index = -1;   // -1 = desktop; 0..3 = ORDER
  private base = 0;
  private drop = 0;
  private penalty = 0;
  private info: NativeInfo | null = null;
  private ramp: number | null = null;
  private warns: number[] = [];
  private killed = false;
  private killWaiters: Array<(v: boolean) => void> = [];
  private readonly watchers = new Map<BudgetKey, Set<TrimFn>>();
  private readonly pressure = new Set<PressureFn>();
  private readonly meters = new Map<string, { key: BudgetKey; used: () => number }>();
  private readonly appListeners = new Set<(active: boolean) => void>();
  private readonly changeListeners = new Set<() => void>();
  warnings = 0;

  constructor() {
    const forced = lsGet(LS_FORCE);
    const isIpad = g().__FM_PLATFORM__?.kind === 'ipad';
    if (forced && (ORDER as string[]).includes(forced)) { this.kind = 'ipad'; this.index = ORDER.indexOf(forced as TierName); this.base = this.index; return; }
    if (forced === 'desktop') return;
    if (isIpad) {
      this.kind = 'ipad';
      this.readSaved();
      this.pick();
    }
  }

  get tier(): TierName { return this.index < 0 ? 'desktop' : ORDER[this.index]; }

  /** The limit now. */
  get(key: BudgetKey): number { return TABLES[this.tier][key]; }

  /** The limit one tier down: what a single warning trims to (the lowest tier stays where it is). */
  lower(key: BudgetKey): number {
    if (this.index < 0) return DESKTOP[key];
    return TABLES[ORDER[Math.min(ORDER.length - 1, this.index + 1)]][key];
  }

  /** Calls `fn` with the new limit when the tier changes and with the lower tier's limit on a warning. Returns the unregister function. */
  watch(key: BudgetKey, fn: TrimFn): () => void {
    let set = this.watchers.get(key);
    if (!set) { set = new Set(); this.watchers.set(key, set); }
    set.add(fn);
    return () => { set?.delete(fn); };
  }

  /** Called on every warning, tier change and kill (releases that are not a number: decoded video frames, ghost canvases). */
  onPressure(fn: PressureFn): () => void {
    this.pressure.add(fn);
    return () => { this.pressure.delete(fn); };
  }

  /** What a cache holds now, for the budget report; `id` is unique per cache instance kind. */
  meter(id: string, key: BudgetKey, used: () => number): () => void {
    this.meters.set(id, { key, used });
    return () => { if (this.meters.get(id)?.used === used) this.meters.delete(id); };
  }

  /** Limits and usage of every metered cache (Diagnostics and the measurement scripts read it). */
  report(): { tier: TierName; warnings: number; items: Array<{ id: string; key: BudgetKey; limit: number; used: number }> } {
    const items: Array<{ id: string; key: BudgetKey; limit: number; used: number }> = [];
    for (const [id, m] of this.meters) { let used = 0; try { used = m.used(); } catch { used = 0; } items.push({ id, key: m.key, limit: this.get(m.key), used }); }
    return { tier: this.tier, warnings: this.warnings, items };
  }

  onAppState(fn: (active: boolean) => void): () => void {
    this.appListeners.add(fn);
    return () => { this.appListeners.delete(fn); };
  }

  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => { this.changeListeners.delete(fn); };
  }

  /** Adopts a tier chosen elsewhere (the export worker gets the page's tier in its start message). */
  adopt(tier: TierName): void {
    if (tier === 'desktop') { if (this.kind === 'ipad') return; return; }
    if (this.kind === 'desktop') this.kind = 'ipad';
    this.setIndex(ORDER.indexOf(tier), 'tier', false);
  }

  /** Native told us about the device: memory sizes and how many times the content process has been killed. */
  setNativeInfo(i: Partial<NativeInfo>): void {
    if (this.kind !== 'ipad') return;
    const prev = this.info;
    this.info = { physicalMemory: Number(i.physicalMemory) || prev?.physicalMemory || 0, availableMemory: Number(i.availableMemory) || prev?.availableMemory || 0, terminations: Number(i.terminations) || prev?.terminations || 0 };
    const seen = Number(lsGet(LS_KILLS_SEEN) ?? '0') || 0;
    if (this.info.terminations > seen) { lsSet(LS_KILLS_SEEN, String(this.info.terminations)); this.noteKill(false); }
    else if (!this.killed && this.killWaiters.length) this.settleKill(false);
    const before = this.index;
    this.pick();
    if (this.index !== before) this.broadcastTier('tier');
  }

  /** The system warned the app: trim every cache to its lower tier at once; a second warning inside 30 s lowers the tier for the session. */
  warn(): void {
    if (this.kind !== 'ipad') return;
    const now = Date.now();
    this.warnings++;
    this.warns = this.warns.filter((t) => now - t < WARN_WINDOW_MS);
    this.warns.push(now);
    if (this.warns.length >= 2) {
      this.warns = [];
      this.drop++;
      this.setIndex(this.wanted(), 'warning', true);
      return;
    }
    for (const key of this.watchers.keys()) this.fire(key, this.lower(key), 'warning');
    this.firePressure('warning');
  }

  /** The web view's content process was killed and the page reloaded: one tier down for the session and the next day. */
  noteKill(fromMessage = true): void {
    if (this.kind !== 'ipad') return;
    if (this.killed) { this.settleKill(true); return; }
    this.killed = true;
    lsSet(LS_KILL, String(Date.now()));
    this.penalty = Math.min(3, this.penalty + 1);
    this.settleKill(true);
    this.setIndex(this.wanted(), 'kill', true);
    void fromMessage;
  }

  /** Resolves true as soon as a kill is known (this load followed one), false once native says it did not or after `ms`. Desktop: false at once. */
  afterKill(ms = 1500): Promise<boolean> {
    if (this.kind !== 'ipad' || this.killed) return Promise.resolve(this.killed);
    if (this.info && !this.killWaiters.length) return Promise.resolve(false);
    return new Promise((res) => {
      this.killWaiters.push(res);
      setTimeout(() => this.settleKill(false), ms);
    });
  }

  get wasKilled(): boolean { return this.killed; }

  /** One message from native, already parsed. */
  handle(type: string, payload: Record<string, unknown>): void {
    if (this.kind !== 'ipad') return;
    if (type === 'memoryWarning') this.warn();
    else if (type === 'memoryInfo') this.setNativeInfo({ physicalMemory: Number(payload.physicalMemory), availableMemory: Number(payload.availableMemory), terminations: Number(payload.terminations) });
    else if (type === 'contentProcessRecovered') this.noteKill();
    else if (type === 'appState') {
      const v = String(payload.state ?? payload.value ?? payload.phase ?? payload.name ?? '').toLowerCase();
      const active = typeof payload.active === 'boolean' ? payload.active : v === 'active';
      for (const fn of this.appListeners) { try { fn(active); } catch { /* a listener must not stop the others */ } }
    }
  }

  private attached = false;

  /**
   * Listens through the platform bridge (it owns `__fmNative.receive` and the replay of early messages, so nothing is
   * wrapped here). The platform index calls this with its bridge: importing the index from here would pull the page's
   * stylesheets into the paint worker bundle, whose first statement then touches `document` and kills the worker.
   */
  attach(bridge: Bridge): void {
    if (this.kind !== 'ipad' || this.attached || typeof window === 'undefined') return;
    this.attached = true;
    for (const type of ['memoryWarning', 'memoryInfo', 'contentProcessRecovered', 'appState']) bridge.on(type, (p) => { this.handle(type, p); });
    bridge.post('memoryInfoRequest', {});
  }

  /** Page to native, same channel the platform layer uses. */
  send(type: string, payload: Record<string, unknown>): void {
    try { g().webkit?.messageHandlers?.fm?.postMessage({ type, payload }); } catch { /* no native side */ }
  }

  private readSaved(): void {
    try {
      // the Diagnostics memory ramp (platform/diagnostics.ts): megabytes held, how it stopped, and whether it finished
      const raw = lsGet(LS_RAMP);
      if (raw) {
        const r = JSON.parse(raw) as { allocatedMB?: number; stop?: string; finished?: boolean };
        const mb = Number(r.allocatedMB);
        const void_ = r.stop === 'cancelled' || r.stop === 'noContext';
        if (mb > 0 && !void_) this.ramp = r.finished && r.stop === 'cap' ? Infinity : mb;
      }
    } catch { /* an unreadable report is ignored */ }
    const k = Number(lsGet(LS_KILL) ?? '0');
    if (k > 0 && Date.now() - k < KILL_MEMORY_MS) this.penalty = 1;
  }

  /** The tier the evidence so far asks for, before any session drop. */
  private wanted(): number {
    let i = this.base;
    i = Math.min(ORDER.length - 1, i + this.penalty + this.drop);
    return i;
  }

  private pick(): void {
    let i = 2;
    const phys = this.info?.physicalMemory ?? 0;
    const GiB = 1024 * MiB;
    const fromPhysical = (): number => (phys >= 11.5 * GiB ? 0 : phys >= 7.5 * GiB ? 1 : 2);
    // a ramp that stopped early (a warning or a kill) says how much one page could hold; one that reached its cap says nothing more
    if (this.ramp !== null && isFinite(this.ramp)) i = this.ramp >= 1000 ? 1 : this.ramp >= 600 ? 2 : 3;
    else if (phys > 0) i = fromPhysical();
    else if (this.ramp === Infinity) i = 1;
    else {
      const dm = (globalThis as unknown as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory;
      if (dm && dm > 0) i = dm >= 8 ? 1 : 2;
    }
    const avail = this.info?.availableMemory ?? 0;
    if (avail > 0) i = Math.max(i, avail < 1.5 * GiB ? 2 : avail < 3 * GiB ? 1 : 0);
    this.base = i;
    this.index = this.wanted();
  }

  private setIndex(i: number, reason: TrimReason, always: boolean): void {
    const next = Math.max(0, Math.min(ORDER.length - 1, i));
    if (next === this.index && !always) return;
    this.index = next;
    this.broadcastTier(reason);
  }

  private broadcastTier(reason: TrimReason): void {
    for (const key of this.watchers.keys()) this.fire(key, this.get(key), reason);
    this.firePressure(reason === 'warning' ? 'warning' : reason === 'kill' ? 'kill' : 'tier');
    for (const fn of this.changeListeners) { try { fn(); } catch (e) { console.warn('formmorpheus: a memory listener failed', e); } }
  }

  private fire(key: BudgetKey, limit: number, reason: TrimReason): void {
    const set = this.watchers.get(key);
    if (!set) return;
    for (const fn of [...set]) { try { fn(limit, reason); } catch { /* one cache failing must not stop the rest */ } }
  }

  private firePressure(level: 'warning' | 'tier' | 'kill'): void {
    for (const fn of [...this.pressure]) { try { fn(level); } catch (e) { console.warn('formmorpheus: a memory pressure listener failed', e); } }
  }

  private settleKill(v: boolean): void {
    const w = this.killWaiters.splice(0);
    for (const r of w) r(v);
  }
}

export const memory = new Memory();

if (lsGet('fm-memory-debug') === '1') (globalThis as unknown as { __fmMemory?: Memory }).__fmMemory = memory;
