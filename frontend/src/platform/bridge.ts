// The page's side of the native bridge.
//   page to native: window.webkit.messageHandlers.fm.postMessage({ type, payload })
//   native to page: window.__fmNative.receive(json), json = '{"type":"...","payload":{...}}'
// Messages with no shell around them are dropped, so the same code runs on the desktop and in a browser tab.
import type { Bridge, BridgeHandler, BridgePayload } from './types';

interface Native { receive?: (json: unknown, extra?: unknown) => void }
interface Host { __fmNative?: Native; webkit?: { messageHandlers?: { fm?: { postMessage(m: unknown): void } } } }

const handlers = new Map<string, Set<BridgeHandler>>();
// The shell replays what it queued before the page listened at the moment `receive` is set, when no type has a handler yet.
// Those messages wait here, per type, until the first handler of that type is added (or a few seconds pass).
let early: Array<{ type: string; payload: BridgePayload }> = [];
let replaying = false;
const EARLY_MS = 8000;

function dispatch(type: string, payload: BridgePayload): void {
  if (replaying && !handlers.get(type)?.size) { if (early.length < 200) early.push({ type, payload }); return; }
  for (const fn of Array.from(handlers.get(type) ?? [])) {
    try { fn(payload); } catch { /* one listener's fault never stops the others */ }
  }
}

/** Accepts the JSON string, an object, or the two-argument form (type, payload). */
function receive(raw: unknown, extra?: unknown): void {
  let msg: unknown = raw;
  if (typeof raw === 'string') {
    if (extra !== undefined && !raw.trimStart().startsWith('{')) { dispatch(raw, extra && typeof extra === 'object' ? (extra as BridgePayload) : {}); return; }
    try { msg = JSON.parse(raw); } catch { return; }
  }
  if (!msg || typeof msg !== 'object') return;
  const m = msg as { type?: unknown; payload?: unknown } & BridgePayload;
  if (typeof m.type !== 'string') return;
  if (m.payload && typeof m.payload === 'object') { dispatch(m.type, m.payload as BridgePayload); return; }
  const { type, payload: _p, ...rest } = m;
  void _p;
  dispatch(type as string, rest);
}

export function createBridge(listening: boolean): Bridge {
  const host = window as unknown as Host;
  if (listening) {
    // the shell queues what arrives before the page listens and hands it to the first function set here
    const shim = (host.__fmNative ??= {});
    replaying = true;
    try { shim.receive = (json, extra) => { receive(json, extra); }; } finally { replaying = false; }
    if (early.length) window.setTimeout(() => { early = []; }, EARLY_MS);
  }
  const post = (type: string, payload: BridgePayload = {}): boolean => {
    const h = host.webkit?.messageHandlers?.fm;
    if (!listening || !h) return false;
    try { h.postMessage({ type, payload }); return true; } catch { return false; }
  };
  const on = (type: string, fn: BridgeHandler): (() => void) => {
    let set = handlers.get(type);
    if (!set) handlers.set(type, (set = new Set()));
    set.add(fn);
    // messages the shell sent before this type had a listener
    if (early.length) {
      const mine = early.filter((m) => m.type === type);
      if (mine.length) {
        early = early.filter((m) => m.type !== type);
        for (const m of mine) { try { fn(m.payload); } catch { /* one listener's fault never stops the others */ } }
      }
    }
    return () => { set?.delete(fn); };
  };
  const once = (type: string, accept: (p: BridgePayload) => boolean, ms: number): Promise<BridgePayload | null> =>
    new Promise((resolve) => {
      let timer = 0;
      const off = on(type, (p) => {
        if (!accept(p)) return;
        off();
        window.clearTimeout(timer);
        resolve(p);
      });
      timer = window.setTimeout(() => { off(); resolve(null); }, ms);
    });
  return { get available() { return listening && !!host.webkit?.messageHandlers?.fm; }, post, on, once };
}
