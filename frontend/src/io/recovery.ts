import type { Engine } from '../engine/engine';
import { el, q, setText } from '../ui/dom';
import { Dialog } from '../ui/dialogs';
import { api, serviceReady } from './api';

export interface RecoveryEntry { session: string; name: string; library: string | null; time: number; size: number }

const EVERY_MS = 60_000;
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
    setText(this.question, `formmorpheus quit unexpectedly. Recover ${n} ${n === 1 ? 'movie' : 'movies'}?`);
    const shown = items.slice(0, 4).map((i) => i.name).join(', ');
    setText(this.names, `${shown}${n > 4 ? `, and ${n - 4} more` : ''}. Recovered movies open as unsaved copies.`);
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

  constructor(private readonly host: RecoveryHost) {
    const check = (): void => { if (this.written && (!host.engine.movie || !host.engine.modified)) void this.clear(); };
    host.engine.on('saved', check);
    host.engine.on('projects', check);
    this.timer = window.setInterval(() => { void this.snapshot(); }, EVERY_MS);
    // a normal quit: nothing was lost, so nothing is kept
    window.addEventListener('pagehide', (e) => {
      if (e.persisted) return;
      try { void fetch(base(SESSION), { method: 'DELETE', keepalive: true }); } catch { /* the engine is gone */ }
    });
  }

  dispose(): void { window.clearInterval(this.timer); }

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

  /** At start: offers the snapshots left by sessions that did not finish. */
  async offer(): Promise<void> {
    const items = (await listSnapshots()).filter((i) => i.session !== SESSION);
    if (!items.length) return;
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
        if (!res.ok) continue;
        const blob = await res.blob();
        const name = `${i.name} (Recovered)`;
        // a movie the person opened while the engine was starting is never replaced: the snapshot goes to the library
        if (!opened && !this.host.engine.movie) {
          await this.host.openRecovered(blob, name);
          opened = true;
          await this.snapshot();   // protected under this session before the old snapshot goes
        } else await this.host.saveRecovered(blob, await freeName(name));
        await fetch(base(i.session), { method: 'DELETE' });
      } catch { /* leave this snapshot for the next start */ }
    }
  }
}

async function freeName(name: string): Promise<string> {
  const taken = new Set((await api.library().catch(() => [])).map((i) => i.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`;
}
