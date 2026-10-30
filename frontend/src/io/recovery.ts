import type { Engine } from '../engine/engine';
import { el, q, setText } from '../ui/dom';
import { Dialog } from '../ui/dialogs';
import { toast } from '../ui/toast';
import { t, tn } from '../ui/i18n';
import { api, serviceReady } from './api';

export interface RecoveryEntry { session: string; name: string; library: string | null; time: number; alive?: number; idle?: number; size: number; gone?: boolean; wait?: number }

const EVERY_MS = 60_000;
const BEAT_MS = 20_000;
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
    setText(this.question, `${t('formmorpheus quit unexpectedly.')} ${tn(n, 'Recover {n} movie?', 'Recover {n} movies?')}`);
    const shown = items.slice(0, 4).map((i) => i.name).join(', ');
    setText(this.names, `${shown}${n > 4 ? `, ${tn(n - 4, 'and {n} more', 'and {n} more')}` : ''}. ${t('Recovered movies open as unsaved copies.')}`);
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
  /** Sessions the person has already been asked about (so the periodic look only raises new ones). */
  private asked = new Set<string>();

  constructor(private readonly host: RecoveryHost) {
    const check = (): void => { if (this.written && (!host.engine.movie || !host.engine.modified)) void this.clear(); };
    host.engine.on('saved', check);
    host.engine.on('projects', check);
    this.timer = window.setInterval(() => { void this.snapshot(); }, EVERY_MS);
    // this window's snapshot stays "alive" while the window lives, so another window does not take it for a crash
    const beat = (): void => { if (this.written) void fetch(`${base(SESSION)}/alive`, { method: 'POST' }).catch(() => undefined); };
    this.beat = window.setInterval(beat, BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    // an open stream tells the engine this window is alive; when the window dies the stream closes and its snapshot is offered at once
    void this.keepLive();
    window.addEventListener('pageshow', (e) => { if (e.persisted) void this.keepLive(); });
    this.recheck = window.setInterval(() => { if (!document.hidden) void this.offer('new'); }, RECHECK_MS);
    // a normal quit: nothing was lost, so nothing is kept
    window.addEventListener('pagehide', (e) => {
      if (e.persisted) return;
      try { void fetch(base(SESSION), { method: 'DELETE', keepalive: true }); } catch { /* the engine is gone */ }
    });
  }

  private liveRun = 0;
  private liveAbort: AbortController | null = null;

  /** Holds the live stream open, reopening it if it drops, until the page goes away. */
  private async keepLive(): Promise<void> {
    const run = ++this.liveRun;
    this.liveAbort?.abort();
    while (run === this.liveRun) {
      const ac = new AbortController();
      this.liveAbort = ac;
      try {
        if (await serviceReady()) {
          const res = await fetch(`${base(SESSION)}/live`, { signal: ac.signal, cache: 'no-store' });
          const reader = res.body?.getReader();
          if (reader) while (!(await reader.read()).done) { /* only the connection matters */ }
        }
      } catch { /* dropped or aborted */ }
      if (run !== this.liveRun) return;
      await new Promise((r) => window.setTimeout(r, 1500));
    }
  }

  dispose(): void { this.liveRun++; this.liveAbort?.abort(); window.clearInterval(this.timer); window.clearInterval(this.beat); window.clearInterval(this.recheck); }

  /** Writes one snapshot now if the movie has unsaved changes and none is being written. */
  async snapshot(): Promise<void> {
    const { engine } = this.host;
    if (this.inFlight || !engine.movie || !engine.modified) return;
    this.inFlight = true;
    try {
      const blob = await this.host.pack();
      const m = engine.movie;
      if (!blob || !m || !engine.modified) return;
      if (!(await serviceReady())) return;
      const params = new URLSearchParams({ name: m.name });
      if (engine.libraryName) params.set('library', engine.libraryName);
      const res = await fetch(`${base(SESSION)}?${params}`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/octet-stream' } });
      if (res.ok) this.written = true;
      // a save or a close may have landed while this was writing
      if (!engine.movie || !engine.modified) await this.clear();
    } catch { /* recovery is best effort and never interrupts the work */ } finally {
      this.inFlight = false;
    }
  }

  /** Removes this session's snapshot. */
  async clear(): Promise<void> {
    this.written = false;
    try { await fetch(base(SESSION), { method: 'DELETE' }); } catch { /* the engine is gone */ }
  }

  /**
   * Offers the snapshots left by sessions that did not finish: at start, from the Edit menu (all of them), and
   * while the session runs ('new': only those not asked about yet, e.g. a window that died after this one began).
   */
  async offer(mode: 'start' | 'menu' | 'new' = 'start'): Promise<void> {
    if (this.dialog?.isOpen) return;
    const all = await listSnapshots();
    // a window whose stream closed a moment ago may only be reconnecting: look again when its grace ends
    const wait = Math.max(0, ...all.filter((i) => i.session !== SESSION && !i.gone).map((i) => i.wait ?? 0));
    if (wait > 0) window.setTimeout(() => { void this.offer(mode); }, wait * 1000 + 400);
    const items = all.filter((i) => i.session !== SESSION && (i.gone ?? (i.idle ?? Infinity) > DEAD_AFTER_S) && !(mode === 'new' && this.asked.has(i.session)));
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
