// The page's side of the export worker: starts an export in export-worker.ts when the content allows and
// keeps the old main-thread exporter as the fallback. Worker exports use the same Renderer and the same Run
// code, so a file comes out byte for byte as it would on this thread.
//
// Stays on this thread (fallback): a browser without Worker or OffscreenCanvas, a movie the worker cannot be handed, a
// GPU-composed page whose worker cannot get WebGL2, and a worker that fails to start.
import type { Content, Movie, Track } from '../engine/types';
import { memory } from '../platform/ipad-memory';
import { loadTextFonts } from '../media/fonts';
import { scriptFamilies } from '../media/font-bundle';
import { normalise, startExport, type Deps } from './run';
import { drawDelivery, loadWatermark, type ReadyWatermark } from './reframe';
import type { ExportJob, ExportOptions, ExportProgress, ExportResult, Watermark } from './types';
import type { FaceRule, FontLoad, FromWorker, StartMsg, ToWorker } from './worker-protocol';

function abortError(): Error {
  return new DOMException('Export cancelled', 'AbortError');
}

function eachContent(tracks: Track[], fn: (c: Content) => void): void {
  for (const t of tracks) for (const c of t.content) { fn(c); if (c.kind === 'group') eachContent(c.tracks ?? [], fn); }
}

/** Why a movie cannot render in the worker, or '' when it can. */
export function workerBlocker(movie: Movie): string {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return 'no worker';
  return '';
}

/** The page's own @font-face rules for the families a movie's Text can draw in. */
function collectFaces(wanted: Set<string>): FaceRule[] {
  const out: FaceRule[] = [];
  const unq = (s: string): string => s.trim().replace(/^["']|["']$/g, '');
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list: CSSRuleList): void => {
      for (const r of Array.from(list)) {
        if (r instanceof CSSFontFaceRule) {
          const family = unq(r.style.getPropertyValue('font-family'));
          if (!wanted.has(family) && !family.startsWith('Noto Sans')) continue;
          const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(r.style.getPropertyValue('src'));
          if (!m) continue;
          out.push({
            family, url: new URL(m[1], sheet.href ?? document.baseURI).href,
            weight: r.style.getPropertyValue('font-weight') || '400', style: r.style.getPropertyValue('font-style') || 'normal',
            unicodeRange: r.style.getPropertyValue('unicode-range'), stretch: r.style.getPropertyValue('font-stretch'),
          });
        } else if ('cssRules' in r) walk((r as CSSGroupingRule).cssRules);
      }
    };
    walk(rules);
  }
  return out;
}

/** Everything the worker needs to draw Text and pictures: stored files, font faces, and which faces to load. */
async function prepare(deps: Deps): Promise<Pick<StartMsg, 'movie' | 'blobs' | 'faces' | 'loads' | 'gpu'>> {
  const { movie, renderer } = deps;
  // the faces load on this thread first (bundled families are fetched lazily); the worker then finds them in cache
  await loadTextFonts(movie).catch(() => undefined);
  const blobs: Record<string, Blob> = {};
  for (const a of Object.values(movie.assets)) {
    if (a.kind !== 'image' && a.kind !== 'pixels' && a.kind !== 'font' && a.kind !== 'video') continue;
    const b = renderer.assetBlob(a.id);
    if (b) blobs[a.id] = b;
  }
  const wanted = new Set<string>(['Inter']);
  const loads: FontLoad[] = [];
  eachContent(movie.tracks, (c) => {
    const s = c.kind === 'text' ? c.text : null;
    if (!s) return;
    const text = s.text || 'Aa';
    wanted.add(s.font);
    loads.push({ spec: `${s.italic ? 'italic ' : ''}${s.weight} 32px "${s.font}"`, text });
    loads.push({ spec: `${s.weight} 32px "Inter"`, text });
    for (const f of scriptFamilies(text)) { wanted.add(f); loads.push({ spec: `${s.weight} 32px "${f}"`, text }); }
  });
  return { movie, blobs, faces: loads.length ? collectFaces(wanted) : [], loads, gpu: renderer.gpuActive, ...(memory.kind === 'ipad' ? { memTier: memory.tier } : {}) };
}

function spawn(): Worker {
  return new Worker(new URL('./export-worker.ts', import.meta.url), { type: 'module' });
}

/** Exports in a worker where the content allows, otherwise on this thread (same job contract either way). */
export function startExportAuto(deps: Deps, opts: ExportOptions): ExportJob {
  const o = normalise(opts);
  if (workerBlocker(deps.movie)) return startExport(deps, o);
  const listeners: ((p: ExportProgress) => void)[] = [];
  let cancelled = false;
  let worker: Worker | null = null;
  let delegate: ExportJob | null = null;
  const emit = (p: ExportProgress): void => { for (const cb of listeners) cb(p); };
  const job: ExportJob = {
    onProgress: (cb) => { listeners.push(cb); },
    cancel: () => {
      cancelled = true;
      delegate?.cancel();
      worker?.postMessage({ t: 'cancel' } satisfies ToWorker);
    },
    result: Promise.resolve(null as never),
  };
  const local = (): Promise<ExportResult> => {
    delegate = startExport(deps, o);
    delegate.onProgress(emit);
    if (cancelled) delegate.cancel();
    return delegate.result;
  };

  const go = async (): Promise<ExportResult> => {
    const video = o.format === 'mp4' || o.format === 'webm' || o.format === 'mov';
    const base = await prepare(deps);
    if (cancelled) throw abortError();
    // sound is mixed here (OfflineAudioContext is not in workers) and sent over as PCM
    let audio: StartMsg['audio'];
    const transfer: Transferable[] = [];
    if (video && o.includeAudio && deps.audio) {
      emit({ stage: 'audio', done: 0, total: 1 });
      const mix = await deps.audio.mixdown(deps.movie, o.from, o.to, 48000, undefined, o.loudness);
      emit({ stage: 'audio', done: 1, total: 1 });
      if (cancelled) throw abortError();
      const channels = mix ? Array.from({ length: mix.numberOfChannels }, (_, c) => mix.getChannelData(c).slice()) : null;
      channels?.forEach((c) => transfer.push(c.buffer));
      audio = { present: true, sampleRate: mix?.sampleRate ?? 48000, channels };
    }
    let w: Worker;
    try { w = spawn(); } catch { return local(); }
    worker = w;
    return new Promise<ExportResult>((resolve, reject) => {
      let started = false;
      let settled = false;
      const end = (fn: () => void): void => { if (settled) return; settled = true; w.terminate(); worker = null; fn(); };
      const fallBack = (): void => { end(() => { local().then(resolve, reject); }); };
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.t === 'ready') started = true;
        else if (m.t === 'progress') { if (m.p.stage !== 'audio') emit(m.p); }
        else if (m.t === 'done') end(() => resolve({ blob: m.blob, name: m.name, mime: m.mime, warnings: m.warnings, gpuReset: m.gpuReset }));
        else if (m.t === 'error') {
          if (m.fallback && !cancelled) fallBack();
          else end(() => reject(m.abort || cancelled ? abortError() : new Error(m.message)));
        }
      };
      // a worker that dies before it began (a blocked script, no module workers) is not the movie's fault
      w.onerror = (e) => { e.preventDefault(); if (!started && !cancelled) fallBack(); else end(() => reject(cancelled ? abortError() : new Error('The export worker stopped.'))); };
      w.onmessageerror = () => { if (!cancelled) fallBack(); };
      try {
        w.postMessage({ t: 'start', mode: 'file', ...base, opts: o, audio } satisfies StartMsg, transfer);
      } catch { fallBack(); }
    });
  };

  const result = go();
  result.catch(() => {});
  (job as { result: Promise<ExportResult> }).result = result;
  return job;
}

/** One PNG per frame, in order: from the worker where the content allows, otherwise drawn on this thread. */
export interface PngFrames { blob(i: number): Promise<Blob>; close(): void }

export async function openPngFrames(deps: Deps, o: { width: number; height: number; frames: number[]; keepAlpha: boolean; fit?: 'contain' | 'cover' | 'blur'; focus?: { x: number; y: number }; watermark?: Watermark }): Promise<PngFrames> {
  const { movie, renderer } = deps;
  const localFrames = (): PngFrames => {
    const canvas = new OffscreenCanvas(o.width, o.height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    let wm: ReadyWatermark | null = null, wmDone = false;
    return {
      async blob(i) {
        await renderer.prepareFrame(movie, o.frames[i]);
        if (!wmDone) { wm = await loadWatermark(o.watermark); wmDone = true; }
        drawDelivery(renderer, ctx, movie, o.frames[i], o, o.keepAlpha, wm);
        return canvas.convertToBlob({ type: 'image/png' });
      },
      close() { wm?.close(); },
    };
  };
  if (workerBlocker(movie)) return localFrames();
  let w: Worker;
  try { w = spawn(); } catch { return localFrames(); }
  const base = await prepare(deps);
  const ready = new Promise<boolean>((res) => {
    const early = (e: MessageEvent<FromWorker>): void => {
      if (e.data.t === 'ready') res(true);
      else if (e.data.t === 'error') res(false);
    };
    w.addEventListener('message', early);
    w.addEventListener('error', () => { res(false); });
  });
  const waiting = new Map<number, { res: (b: Blob) => void; rej: (e: unknown) => void }>();
  const have = new Map<number, Blob>();
  let failure: Error | null = null;
  w.addEventListener('message', (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.t === 'frame') {
      const p = waiting.get(m.index);
      if (p) { waiting.delete(m.index); p.res(m.blob); } else have.set(m.index, m.blob);
    } else if (m.t === 'error') {
      failure = m.abort ? abortError() : new Error(m.message);
      for (const p of waiting.values()) p.rej(failure);
      waiting.clear();
    }
  });
  w.addEventListener('error', () => {
    failure = new Error('The export worker stopped.');
    for (const p of waiting.values()) p.rej(failure);
    waiting.clear();
  });
  try {
    w.postMessage({
      t: 'start', mode: 'frames', ...base, opts: { width: o.width, height: o.height, fit: o.fit, focus: o.focus, watermark: o.watermark } as ExportOptions, keepAlpha: o.keepAlpha, frameList: o.frames,
    } satisfies StartMsg);
  } catch { w.terminate(); return localFrames(); }
  if (!(await ready)) { w.terminate(); return localFrames(); }
  return {
    blob(i) {
      w.postMessage({ t: 'consumed', count: i + 1 } satisfies ToWorker);
      const b = have.get(i);
      if (b) { have.delete(i); return Promise.resolve(b); }
      if (failure) return Promise.reject(failure);
      return new Promise<Blob>((res, rej) => { waiting.set(i, { res, rej }); });
    },
    close() {
      w.postMessage({ t: 'cancel' } satisfies ToWorker);
      w.terminate();
      failure ??= abortError();
      for (const p of waiting.values()) p.rej(abortError());
      waiting.clear();
    },
  };
}
