// A small scheduler for thumbnail-like GETs (posters, hover strips). Browsers allow only 6 HTTP/1.1
// connections per host, shared by every window, so a grid asking for hundreds of pictures at once stalls
// the control calls (library, recovery, trash) behind them. Here at most MAX_IN_FLIGHT run per window,
// the ones whose element is on screen go first, and they ask for the lowest network priority.

const MAX_IN_FLIGHT = 2;

interface Job { url: string; el: Element | null; urgent: boolean; run: () => void }

const queue: Job[] = [];
const visible = new WeakSet<Element>();
let inFlight = 0;
let seen: IntersectionObserver | null = null;

function observe(el: Element): void {
  if (typeof IntersectionObserver === 'undefined') { visible.add(el); return; }
  seen ??= new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); }
  }, { rootMargin: '200px' });
  seen.observe(el);
}

function rank(j: Job): number {
  if (j.urgent) return 0;
  if (!j.el) return 1;
  return visible.has(j.el) ? 1 : 2;
}

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length && rank(queue[best]) > 0; i++) if (rank(queue[i]) < rank(queue[best])) best = i;
    const [job] = queue.splice(best, 1);
    if (job.el && seen && !job.urgent) seen.unobserve(job.el);
    inFlight++;
    job.run();
  }
}

/** GET a picture with lowest priority, two at a time; `el` is the grid cell it belongs to (visible cells first). */
export function lowFetch(url: string, opts: { el?: Element | null; urgent?: boolean } = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const el = opts.el ?? null;
    const run = (): void => {
      const init = { priority: 'low' } as RequestInit;
      fetch(url, init).then(resolve, reject).finally(() => { inFlight--; pump(); });
    };
    if (el && !opts.urgent) observe(el);
    queue.push({ url, el, urgent: !!opts.urgent, run });
    pump();
  });
}
