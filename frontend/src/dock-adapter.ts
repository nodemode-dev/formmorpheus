import type { ConsentChoice, ConsentRequest, DockAdapter, DockAgentStatus, DockChannel, DockProgram, DockState, DockTerminal, PtyKind, StoredChoice, StoredChoiceState } from './dock/adapter';
import { socketUrl, windowKey } from './io/window-key';
import { isMac } from './ui/dom';
import { t } from './ui/i18n';

export const DOCK_KEY = 'formmorpheus.dock';
export const DOCK_SIZES = { minHeight: 140, maxHeightShare: 0.7, defaultHeight: 280, minWidth: 460, maxWidthShare: 0.6, defaultWidth: 460, keepWidth: 440 };
const RIGHT_FROM = 900;
const KEY_HEADER = 'X-Formmorpheus-Window-Key';
export type OwnKind = 'antigravity';
const KINDS: Array<PtyKind | OwnKind> = ['shell', 'claude', 'codex', 'cursor', 'antigravity', 'agent'];
const NOTES = ['You can turn this off any time in Preferences, Agents.'];

export interface DockHost {
  context(): string;
  openSettings(): void;
  layerOpen(): boolean;
  firstRun(): boolean;
}

export class DockError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    const said = (await r.json().catch(() => ({}))) as { detail?: unknown };
    throw new DockError(typeof said.detail === 'string' ? said.detail : r.statusText, r.status);
  }
  return r.json() as Promise<T>;
}

export function reserveDock(none: boolean): void {
  const html = document.documentElement;
  let s: Partial<DockState> = {};
  try {
    const raw = localStorage.getItem(DOCK_KEY);
    const own: unknown = raw ? JSON.parse(raw) : null;
    s = own && typeof own === 'object' ? own as Partial<DockState> : {};
  } catch { s = {}; }
  const z = DOCK_SIZES;
  const maxW = Math.min(window.innerWidth * z.maxWidthShare, window.innerWidth - z.keepWidth);
  const h = Math.round(Math.max(z.minHeight, Math.min(window.innerHeight * z.maxHeightShare, typeof s.h === 'number' ? s.h : z.defaultHeight)));
  const w = Math.round(Math.max(z.minWidth, Math.min(maxW, typeof s.w === 'number' ? s.w : z.defaultWidth)));
  const right = s.side === 'right' && window.innerWidth >= RIGHT_FROM && maxW >= z.minWidth;
  const want: Array<[string, string]> = [['data-ft-dock', s.open === true && !none ? 'open' : 'closed'], ['data-ft-dock-side', right ? 'right' : 'bottom'], ['data-ft-dock-h', String(h)], ['data-ft-dock-w', String(w)]];
  for (const [name, value] of want) if (html.getAttribute(name) !== value) html.setAttribute(name, value);
  const sizes: Array<[string, string]> = [['--ft-dock-size', `${h}px`], ['--ft-dock-wsize', `${w}px`]];
  for (const [name, value] of sizes) if (html.style.getPropertyValue(name) !== value) html.style.setProperty(name, value);
}

const waiting = new Map<string, ConsentRequest>();
const adders: Array<(r: ConsentRequest) => void> = [];
const withdrawers: Array<(id: string) => void> = [];
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
let choice: StoredChoice = 'ask';

export const outsideAgents = {
  show(asked: ConsentRequest): void {
    if (waiting.has(asked.id)) return;
    const request: ConsentRequest = { ...asked, what: asked.what || t('create and change movies'), notes: NOTES.map((n) => t(n)) };
    waiting.set(request.id, request);
    for (const add of adders) add(request);
  },
  gone(id: string): void {
    if (!waiting.delete(id)) return;
    for (const withdraw of withdrawers) withdraw(id);
  },
  subscribe(add: (r: ConsentRequest) => void, withdraw: (id: string) => void): void {
    adders.push(add);
    withdrawers.push(withdraw);
    for (const request of waiting.values()) add(request);
  },
  async answer(id: string, answer: ConsentChoice): Promise<void> {
    if (!waiting.delete(id)) return;
    await call(`/api/agents/consent/${encodeURIComponent(id)}`, 'POST', { choice: answer }).catch(() => undefined);
    if (answer === 'always') choice = 'allowed';
  },
  async restore(): Promise<void> {
    try {
      const had = await call<{ requests?: ConsentRequest[] }>('/api/agents/consent');
      for (const request of had.requests ?? []) outsideAgents.show(request);
    } catch { return; }
  },
  async get(): Promise<StoredChoiceState> {
    try {
      const s = await call<{ choice?: unknown; changedOutside?: unknown }>('/api/agents');
      choice = s.choice === 'blocked' || s.choice === 'allowed' ? s.choice : 'ask';
      return { value: choice, changedOutside: s.changedOutside === true };
    } catch { return { value: choice, changedOutside: false }; }
  },
  async set(value: StoredChoice): Promise<void> {
    await call('/api/agents/choice', 'POST', { value });
    choice = value;
    if (value === 'blocked') for (const id of [...waiting.keys()]) outsideAgents.gone(id);
  },
  waiting: (): number => waiting.size,
};

function socketChannel(socket: WebSocket): DockChannel {
  let data = (_chunk: string | Uint8Array): void => undefined;
  let exit = (): void => undefined;
  let closed = (): void => undefined;
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('message', (msg) => {
    if (typeof msg.data === 'string') { data(msg.data); return; }
    try { if ((JSON.parse(new TextDecoder().decode(msg.data as ArrayBuffer)) as { type?: string }).type === 'exit') exit(); } catch { return; }
  });
  socket.addEventListener('close', () => closed());
  const send = (frame: string): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(frame);
    else if (socket.readyState === WebSocket.CONNECTING) socket.addEventListener('open', () => socket.send(frame), { once: true });
  };
  return {
    send: (chunk) => send(JSON.stringify({ type: 'input', data: chunk })),
    resize: (cols, rows) => send(JSON.stringify({ type: 'resize', cols, rows })),
    onData: (handler) => { data = handler; },
    onExit: (handler) => { exit = handler; },
    onClose: (handler) => { closed = handler; },
    close: () => socket.close(),
  };
}

interface EngineTerminal { id: string; title: string; kind?: string; alive?: boolean; tip?: unknown; status?: unknown }
const record = (x: EngineTerminal): DockTerminal<OwnKind> => ({
  id: x.id, title: x.title, alive: x.alive !== false, kind: KINDS.find((k) => k === x.kind) ?? 'shell',
  ...(text(x.tip) ? { tip: text(x.tip) } : {}), ...(text(x.status) ? { status: text(x.status) } : {}),
});
const mod = (e: KeyboardEvent): boolean => (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
const inDock = (e: KeyboardEvent): boolean => e.target instanceof Element && e.target.closest('.ft-dock') !== null;
const path = (id: string): string => `/api/terminal/${encodeURIComponent(id)}`;

export function formmorpheusDock(host: DockHost): DockAdapter<OwnKind> {
  return {
    words: { app: 'FormMorpheus', noun: t('movie'), example: t('make the title fade in over the first second'), start: './formmorpheus', lead: 'Ask Claude Code about this movie' },
    strings: {
      tourPanelBody: 'This panel runs a terminal, and Claude Code and other AI programs that can work on your {noun} for you. It stays out of the way until you open it.',
      empty: 'No terminal is open. Start a shell with the plus button, or Claude Code with the agent button.',
      tourChatBody: 'Type what you want in this line, for example "{example}", and press Enter. Claude Code opens in a new tab and does it in {app}.',
    },
    placement: {
      mode: 'own',
      storage: { key: DOCK_KEY },
      sizes: DOCK_SIZES,
      canDockRight: () => window.innerWidth >= RIGHT_FROM,
    },
    isDockChord: (e) => mod(e) && !e.altKey && !e.shiftKey && e.code === 'Backquote' && !(host.layerOpen() && !inDock(e)),
    chordLabel: () => `${isMac ? 'Cmd' : 'Ctrl'}+\``,
    passKey: (e) => mod(e) && e.shiftKey && !e.altKey && e.code === 'Backquote',
    tabs: () => ({ builtin: ['shell', 'claude', 'codex', 'cursor', 'antigravity'] }),
    classes: { iconButton: 'cv-tt-btn', button: 'cv-btn', primaryButton: 'cv-btn-primary', input: 'cv-input', select: 'cv-input', note: 'cv-note' },
    t: (_key, english) => t(english),
    onTheme: (handler) => { document.addEventListener('nm:ui-settings-changed', handler); },
    keyHeaders: (): Record<string, string> => (windowKey() ? { [KEY_HEADER]: windowKey() } : {}),
    errors: {
      message: (err) => (err instanceof DockError ? err.message : null),
      kind: (err) => {
        if (err instanceof TypeError) return 'unreachable';
        if (!(err instanceof DockError)) return null;
        if (err.status === 403) return 'refused';
        if (err.status === 409) return 'notInstalled';
        if (err.status === 404 || err.status === 405) return 'oldEngine';
        return err.status === 502 || err.status === 503 || err.status === 504 ? 'unreachable' : null;
      },
    },
    firstRun: () => host.firstRun(),
    terminal: {
      list: async () => (await call<{ terminals: EngineTerminal[] }>('/api/terminal')).terminals.map(record),
      open: async (kind, o) => {
        const size = { cols: o.cols, rows: o.rows };
        if (kind === 'shell') return record(await call<EngineTerminal>('/api/terminal', 'POST', size));
        if (kind !== 'claude') return record(await call<EngineTerminal>(`/api/agent/${kind}/open`, 'POST', size));
        const extra = o.prompt ? host.context() : '';
        const prompt = o.prompt && extra ? `${o.prompt} (${extra})` : o.prompt;
        return record(await call<EngineTerminal>('/api/agent/claude/open', 'POST', { ...size, ...(prompt ? { prompt } : {}), ...(o.resume ? { resume: o.resume } : {}) }));
      },
      restart: async (id) => { await call<EngineTerminal>(`${path(id)}/restart`, 'POST', {}); },
      close: async (id) => { await call<{ ok: boolean }>(path(id), 'DELETE'); },
      channel: async (id) => socketChannel(new WebSocket(await socketUrl(`${path(id)}/stream`))),
    },
    agentStatus: async () => {
      let said: Partial<Record<DockProgram | OwnKind, { installed?: unknown; version?: unknown; install?: unknown; signedIn?: unknown; said?: unknown }>>;
      try { said = await call('/api/agent/status'); } catch { return null; }
      const out: DockAgentStatus<OwnKind> = {};
      for (const kind of ['claude', 'codex', 'cursor', 'antigravity'] as const) {
        const s = said[kind];
        if (s) out[kind] = { installed: s.installed === true, version: text(s.version) || null, install: text(s.install), signedIn: typeof s.signedIn === 'boolean' ? s.signedIn : null, ...(s.installed !== true && text(s.said) ? { note: text(s.said) } : {}) };
      }
      return out;
    },
    consent: { subscribe: (add, withdraw) => outsideAgents.subscribe(add, withdraw), answer: (id, answer) => outsideAgents.answer(id, answer) },
    storedChoice: { get: () => outsideAgents.get(), set: (value) => outsideAgents.set(value) },
    openSettings: () => host.openSettings(),
  };
}
