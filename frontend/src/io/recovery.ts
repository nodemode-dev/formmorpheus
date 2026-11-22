import type { Engine } from '../engine/engine';
import { el, q, setText } from '../ui/dom';
import { Dialog } from '../ui/dialogs';
import { toast } from '../ui/toast';
import { t, tn } from '../ui/i18n';
import { tf } from '../ui/i18n-fill';
import { memory } from '../platform/ipad-memory';
import { platform } from '../platform';
import { api, serviceReady } from './api';
import { socketUrl } from './window-key';

export interface RecoveryEntry { session: string; name: string; library: string | null; time: number; alive?: number; idle?: number; size: number; gone?: boolean; wait?: number }

// the web view's content process can be killed without warning on iPad, so the beat is shorter there
const EVERY_MS = memory.kind === 'ipad' ? 30_000 : 60_000;
const BEAT_MS = 20_000;
const FIRST_EDIT_MS = 5_000;
const MIN_GAP_MS = 5_000;
/**
 * A snapshot is a crash only when its window has not beaten for this long. A hidden tab's timers are throttled
 * (about one tick a minute, more after a long while), so the threshold is several of those, and the owning window
 * also beats on every visibility change.
 */
const DEAD_AFTER_S = 240;
/** How often a running session looks again for snapshots whose window has since died. */
const RECHECK_MS = 120_000;
/** One id per page load: a snapshot from any other id belongs to a session that did not finish. */
const SESSION = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const base = (session: string): string => `/api/recovery/${encodeURIComponent(session)}`;

async function listSnapshots(): Promise<RecoveryEntry[]> {
  if (!(await serviceReady())) return [];
  try {
    const res = await fetch('/api/recovery');
    return res.ok ? ((await res.json()) as { items: RecoveryEntry[] }).items : [];
  } catch { return []; }
}

/** The small question at start: Recover opens what was lost, Discard deletes it. Closing it keeps the snapshots for next time. */
class RecoverDialog extends Dialog {
  private readonly question = el<HTMLElement>('<p class="cv-save-q"></p>');
  private readonly names = el<HTMLElement>('<p class="cv-note"></p>');
  private readonly recover: HTMLButtonElement;
  private resolve: ((v: 'recover' | 'discard' | 'later') => void) | null = null;

  constructor() {
    super('Recover Movies', 460);
    q<HTMLElement>(this.scrim, '.cv-dialog').classList.add('cv-savechanges');
    this.body.append(this.question, this.names);
    this.button('Discard', 'ghost', () => this.finish('discard')).classList.add('cv-btn-apart');
    this.recover = this.button('Recover', 'primary', () => this.finish('recover'));
    this.onClose = () => this.finish('later');
  }

  ask(items: RecoveryEntry[]): Promise<'recover' | 'discard' | 'later'> {
    const n = items.length;
    setText(this.question, `${t('formmorpheus quit before it finished writing.')} ${tn(n, 'Bring back the last steps of {n} movie?', 'Bring back the last steps of {n} movies?')}`);
    const shown = items.slice(0, 4).map((i) => i.name).join(', ');
    setText(this.names, `${shown}${n > 4 ? `, ${tn(n - 4, 'and {n} more', 'and {n} more')}` : ''}. ${t('Each one is added to the Theater as a new movie with "(Recovered)" after its name; the original stays as it was.')}`);
    this.open(this.recover);
    return new Promise((r) => { this.resolve = r; });
  }

  private finish(v: 'recover' | 'discard' | 'later'): void {
    const r = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    r?.(v);
  }
}

export interface RecoveryHost {
  engine: Engine;
  /** Packs the open movie as a `.fmo` without history or poster; null when nothing is open. */
  pack(): Promise<Blob | null>;
  /** Opens a recovered file as an unsaved movie with this name. */
  openRecovered(blob: Blob, name: string): Promise<void>;
  /** Saves a recovered file into the library under this name (movies beyond the first). */
  saveRecovered(blob: Blob, name: string): Promise<void>;
}

/** Crash recovery: a background snapshot of the open movie while it has unsaved changes. */
export class Recovery {
  private inFlight = false;
  private written = false;
  private dialog: RecoverDialog | null = null;
  private timer = 0;
  private beat = 0;
  private recheck = 0;
  private clean = true;
  /** A recovered movie is snapshotted even before its first new edit. */
  private forced = false;
  private soon = 0;
  private lastAt = 0;
  /** What the last written snapshot was made from: an unchanged movie is not written again. */
  private lastMovie: unknown = null;
  private lastAssets: unknown = null;
  /** Sessions the person has already been asked about (so the periodic look only raises new ones). */
  private asked = new Set<string>();

  constructor(private readonly host: RecoveryHost) {
    const check = (): void => {
      if (!host.engine.movie || !host.engine.modified) { this.clean = true; this.forced = false; }
      if (this.written && (!host.engine.movie || !host.engine.modified)) void this.clear();
    };
    host.engine.on('saved', check);
    host.engine.on('projects', check);
    // the first edit after a save or open is snapshotted soon (the 60 s beat covers the rest), so a crash loses seconds
    host.engine.on('history', () => {
      if (!this.clean || !host.engine.modified) return;
      this.clean = false;
      this.later(FIRST_EDIT_MS);
    });
    // a window sent to the background may be closed or killed from there: write what is unwritten now
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.later(0); });
    // the app sent to the background may be ended from there: write at once, past the minimum gap
    memory.onAppState((active) => { if (!active) { this.lastAt = 0; void this.snapshot(); } });
    this.timer = window.setInterval(() => { host.engine.collectAssets(); void this.snapshot(); }, EVERY_MS);
    // this window's snapshot stays "alive" while the window lives, so another window does not take it for a crash
    const beat = (): void => {
      if (this.written) void fetch(`${base(SESSION)}/alive`, { method: 'POST' }).catch(() => undefined);
      // iPad: no socket, so the engine's lease (renewed here) says this window lives
      if (!platform.features.liveRecoverySocket) void fetch(`${base(SESSION)}/live`, { method: 'POST' }).catch(() => undefined);
    };
    this.beat = window.setInterval(beat, BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    // no socket on iPad: the 20 s beat above renews the engine's lease, and it is sent again whenever the app comes back
    if (!platform.features.liveRecoverySocket) { platform.bridge.on('appState', () => beat()); beat(); }
    // an open stream tells the engine this window is alive; when the window dies the stream closes and its snapshot is offered at once
    void this.keepLive();
    window.addEventListener('pageshow', (e) => { if (e.persisted) void this.keepLive(); });
    this.recheck = window.setInterval(() => { if (!document.hidden) void this.offer('new'); }, RECHECK_MS);
    // a normal quit: nothing was lost, so nothing is kept
    window.addEventListener('pagehide', (e) => {
      if (e.persisted) return;
      try { void fetch(base(SESSION), { method: 'DELETE', keepalive: true }); } catch { /* the engine is gone */ }
      if (!platform.features.liveRecoverySocket) { try { void fetch(`${base(SESSION)}/live`, { method: 'DELETE', keepalive: true }); } catch { /* the engine is gone */ } }
    });
  }

  private liveRun = 0;
  private liveSock: WebSocket | null = null;

  /** One open socket; resolves when it closes, with whether it ever opened. A socket holds none of the six HTTP connections per host. */
  private async hold(): Promise<boolean> {
    const url = await socketUrl(`${base(SESSION)}/live`);
    return new Promise((resolve) => {
      let opened = false;
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { resolve(false); return; }
      this.liveSock = ws;
      ws.onopen = () => { opened = true; };
      ws.onclose = () => resolve(opened);
      ws.onerror = () => { try { ws.close(); } catch { /* already closed */ } };
    });
  }

  /** Holds the live socket open, reopening it with a growing pause if it drops, until the page goes away. Stops when an engine that is up never accepts it (an older engine). */
  private async keepLive(): Promise<void> {
    if (!platform.features.liveRecoverySocket) return;
    const run = ++this.liveRun;
    this.liveSock?.close();
    let fails = 0;
    while (run === this.liveRun) {
      if (await serviceReady()) {
        const opened = await this.hold();
        if (run !== this.liveRun) return;
        fails = opened ? 0 : fails + 1;
        if (fails >= 5) return;
      }
      await new Promise((r) => window.setTimeout(r, Math.min(30_000, 1500 * 2 ** Math.max(0, fails - 1))));
    }
  }

  dispose(): void { this.liveRun++; this.liveSock?.close(); window.clearInterval(this.timer); window.clearInterval(this.beat); window.clearInterval(this.recheck); }

  /** A snapshot after `ms`, never sooner than MIN_GAP_MS after the last one; one wait at a time. */
  private later(ms: number): void {
    if (this.soon) return;
    const wait = Math.max(ms, this.lastAt + MIN_GAP_MS - Date.now());
    this.soon = window.setTimeout(() => { this.soon = 0; void this.snapshot(); }, wait);
  }

  /** Writes one snapshot now if the movie has unsaved changes and none is being written. */
  async snapshot(): Promise<void> {
    const { engine } = this.host;
    if (this.inFlight || !engine.movie || !engine.modified) return;
    // no edit yet: the movie is its library file (a just-made movie is marked modified only so that it gets written), so a
    // snapshot would be an empty movie that a crash then offers back as a new "Untitled Movie"
    if (!this.forced && engine.history.past.length === 0) return;
    if (engine.movie === this.lastMovie && engine.assets === this.lastAssets) return;
    if (Date.now() - this.lastAt < MIN_GAP_MS) { this.later(0); return; }
    this.inFlight = true;
    this.lastAt = Date.now();
    try {
      const at = { movie: engine.movie, assets: engine.assets };
      const blob = await this.host.pack();
      const m = engine.movie;
      if (!blob || !m || !engine.modified) return;
      if (!(await serviceReady())) return;
      const params = new URLSearchParams({ name: m.name });
      if (engine.libraryName) params.set('library', engine.libraryName);
      const res = await fetch(`${base(SESSION)}?${params}`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/octet-stream' } });
      if (res.ok) { this.written = true; this.lastMovie = at.movie; this.lastAssets = at.assets; }
      // a save or a close may have landed while this was writing
      if (!engine.movie || !engine.modified) await this.clear();
    } catch { /* recovery is best effort and never interrupts the work */ } finally {
      this.inFlight = false;
    }
  }

  /**
   * Opens the newest snapshot of any other session, dead or not (the killed page cannot say it is gone), as a new
   * movie with a notice. Does nothing when a movie is already open or there is no snapshot.
   */
  private async openAfterKill(): Promise<void> {
    const items = (await listSnapshots()).filter((i) => i.session !== SESSION).sort((a, b) => b.time - a.time);
    const latest = items[0];
    if (!latest || this.host.engine.movie) return;
    try {
      const res = await fetch(base(latest.session));
      if (!res.ok) return;
      const blob = await res.blob();
      if (this.host.engine.movie) return;
      const name = `${latest.name} (Recovered)`;
      await this.host.openRecovered(blob, name);
      this.clean = false;
      this.forced = true;
      await this.snapshot();
      await fetch(base(latest.session), { method: 'DELETE' });
      toast(tf('The web view restarted to free memory, so your last snapshot of "{name}" was opened.', { name: latest.name }), 'info');
    } catch { /* the snapshot stays for the usual question */ }
  }

  /** Removes this session's snapshot. */
  async clear(): Promise<void> {
    this.written = false;
    this.lastMovie = null;
    this.lastAssets = null;
    try { await fetch(base(SESSION), { method: 'DELETE' }); } catch { /* the engine is gone */ }
  }

  /**
   * Offers the snapshots left by sessions that did not finish: at start, from the Edit menu (all of them), and
   * while the session runs ('new': only those not asked about yet, e.g. a window that died after this one began).
   */
  async offer(mode: 'start' | 'menu' | 'new' = 'start'): Promise<void> {
    if (this.dialog?.isOpen) return;
    // iPad: the web view was killed and reloaded, so the newest snapshot opens by itself instead of the usual question
    if (mode === 'start' && memory.kind === 'ipad' && (await memory.afterKill())) await this.openAfterKill();
    const all = await listSnapshots();
    // a window whose stream closed a moment ago may only be reconnecting: look again when its grace ends
    const wait = Math.max(0, ...all.filter((i) => i.session !== SESSION && !i.gone).map((i) => i.wait ?? 0));
    if (wait > 0) window.setTimeout(() => { void this.offer(mode); }, wait * 1000 + 400);
    const dead = all.filter((i) => i.session !== SESSION && (i.gone ?? (i.idle ?? Infinity) > DEAD_AFTER_S) && !(mode === 'new' && this.asked.has(i.session)));
    const items = dead;
    if (!items.length) {
      if (mode === 'menu') toast(t('No lost movies were found.'), 'info');
      return;
    }
    for (const i of items) this.asked.add(i.session);
    this.dialog ??= new RecoverDialog();
    const answer = await this.dialog.ask(items);
    if (answer === 'later') return;
    if (answer === 'discard') {
      await Promise.all(items.map((i) => fetch(base(i.session), { method: 'DELETE' }).catch(() => undefined)));
      return;
    }
    let opened = false;
    for (const i of items.slice().sort((a, b) => b.time - a.time)) {
      try {
        const res = await fetch(base(i.session));
        if (!res.ok) { toast(t('Could not recover "{name}".').replace('{name}', i.name), 'error'); continue; }
        const blob = await res.blob();
        const name = `${i.name} (Recovered)`;
        // a movie the person opened while the engine was starting is never replaced: the snapshot goes to the library
        if (!opened && !this.host.engine.movie) {
          await this.host.openRecovered(blob, name);
          opened = true;
          this.clean = false;   // the recovered steps are unsaved work: protected at once
          this.forced = true;
          await this.snapshot();   // protected under this session before the old snapshot goes
        } else await this.host.saveRecovered(blob, await freeName(name));
        await fetch(base(i.session), { method: 'DELETE' });
      } catch { toast(t('Could not recover "{name}". It stays for the next start.').replace('{name}', i.name), 'error'); }
    }
  }
}

async function freeName(name: string): Promise<string> {
  const taken = new Set((await api.library().catch(() => [])).map((i) => i.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`;
}
