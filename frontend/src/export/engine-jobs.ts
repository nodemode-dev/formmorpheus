// Engine exports (Phase 10): formats the browser cannot encode. Each frame is drawn offscreen, sent to the
// engine as a PNG with the sound as a WAV, and the engine's own ffmpeg turns them into ProRes or HEVC.
import type { Movie } from '../engine/types';
import type { Renderer, View } from '../engine/render';
import type { AudioEngine } from '../media/audio';
import type { ExportJob, ExportOptions, ExportProgress, ExportResult } from './types';

type Deps = { movie: Movie; renderer: Renderer; audio: AudioEngine | null };
export type EngineTarget = 'prores' | 'prores4444' | 'hevc' | 'h264';

export interface TargetInfo { available: boolean; encoder: string; reason: string; encoders?: string[] }
export interface JobCapabilities { ffmpeg: boolean; path: string; version: string; gpl: boolean; aac: boolean; targets: Record<EngineTarget, TargetInfo> }

const BASE = '/api/jobs';
const UPLOADS = 4;
const POLL_MS = 150;

export async function jobCapabilities(): Promise<JobCapabilities | null> {
  try {
    const res = await fetch(`${BASE}/capabilities`);
    return res.ok ? ((await res.json()) as JobCapabilities) : null;
  } catch { return null; }
}

function abortError(): Error {
  return new DOMException('Export cancelled', 'AbortError');
}

function safeName(name: string): string {
  // match the engine's clean_name: no leading or trailing dots, at most 200 bytes w/ the extension's room left
  let s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().replace(/^\.+|\.+$/g, '').trim();
  const enc = new TextEncoder();
  while (s && enc.encode(s).length > 180) s = s.slice(0, -1).trim();
  return s || 'movie';
}

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

function frameAt(i: number, from: number, to: number): number {
  const n = to - from;
  return i < n ? from + i : to - 2 - (i - n);
}

/** 16 bit PCM WAV of `buf`, followed by silence up to `length` sample frames. */
export function encodeWav(buf: AudioBuffer, length: number): Blob {
  const ch = buf.numberOfChannels, rate = buf.sampleRate;
  const total = Math.max(length, buf.length);
  const head = new DataView(new ArrayBuffer(44));
  const dataBytes = total * ch * 2;
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) head.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); head.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, ch, true);
  head.setUint32(24, rate, true); head.setUint32(28, rate * ch * 2, true); head.setUint16(32, ch * 2, true); head.setUint16(34, 16, true);
  str(36, 'data'); head.setUint32(40, dataBytes, true);
  const parts: BlobPart[] = [head.buffer];
  const chunk = 1 << 16;
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  for (let start = 0; start < total; start += chunk) {
    const n = Math.min(chunk, total - start);
    const out = new Int16Array(n * ch);
    for (let i = 0; i < n; i++) {
      const at = start + i;
      if (at >= buf.length) break;
      for (let c = 0; c < ch; c++) {
        const v = Math.max(-1, Math.min(1, data[c][at]));
        out[i * ch + c] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
    }
    parts.push(out.buffer);
  }
  return new Blob(parts, { type: 'audio/wav' });
}

export function startEngineExport(deps: Deps, opts: ExportOptions & { target: EngineTarget }): ExportJob {
  const listeners: ((p: ExportProgress) => void)[] = [];
  const abort = new AbortController();
  let cancelled = false;
  let jobId = '';
  const job: ExportJob = {
    onProgress: (cb) => { listeners.push(cb); },
    cancel: () => {
      cancelled = true;
      abort.abort();
      // the engine kills ffmpeg and removes its temp files
      if (jobId) void fetch(`${BASE}/${jobId}`, { method: 'DELETE' }).catch(() => {});
    },
    result: Promise.resolve(null as never),
  };
  const progress = (stage: ExportProgress['stage'], done: number, total: number): void => {
    const p = { stage, done, total };
    for (const cb of listeners) cb(p);
  };
  const check = (): void => { if (cancelled) throw abortError(); };

  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    check();
    let res: Response;
    try { res = await fetch(`${BASE}${path}`, { ...init, signal: abort.signal }); } catch (e) {
      if (cancelled) throw abortError();
      throw new Error('The formmorpheus engine is not answering.', { cause: e });
    }
    if (!res.ok) {
      let detail = '';
      try { const b = (await res.json()) as { detail?: unknown }; if (typeof b?.detail === 'string') detail = b.detail; } catch { /* not JSON */ }
      throw new Error(detail || `The engine refused the request (${res.status}).`);
    }
    return res;
  };

  const go = async (): Promise<ExportResult> => {
    const { movie, renderer, audio } = deps;
    const o = opts;
    const width = Math.max(2, Math.round(o.width) & ~1), height = Math.max(2, Math.round(o.height) & ~1);
    const from = Math.max(0, Math.round(o.from)), to = Math.max(from + 1, Math.round(o.to));
    const n = to - from;
    const total = o.pingpong && n >= 3 ? n + (n - 2) : n;
    const warnings: string[] = [];
    const profile = o.proresProfile ?? (o.target === 'prores4444' ? '4444' : 'hq');
    const carries = (o.target === 'prores' || o.target === 'prores4444') && (profile === '4444' || profile === '4444xq');
    const keepAlpha = o.alpha && carries && movie.transparent;
    if (o.alpha && !carries && movie.transparent) warnings.push('Only ProRes 4444 carries transparency here, so the background is filled.');

    check();
    // sound first: the mixdown decides whether the job has an audio track
    let wav: Blob | null = null;
    if (o.includeAudio && audio) {
      progress('audio', 0, 1);
      const forward = await audio.mixdown(movie, from, to);
      progress('audio', 1, 1);
      check();
      if (forward) wav = encodeWav(forward, Math.round((total / movie.fps) * forward.sampleRate));
    }

    const made = await (await call('/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: o.target, fps: movie.fps, width, height, frames: total, has_audio: wav !== null, alpha: keepAlpha,
        quality: o.quality, container: o.format === 'hevc-mov' || o.format === 'h264-mov' ? 'mov' : 'mp4', name: safeName(movie.name),
        audio_codec: o.audioCodec ?? 'aac', profile: o.target === 'prores' || o.target === 'prores4444' ? profile : '',
      }),
    })).json() as { id: string };
    jobId = made.id;
    check();

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const scale = Math.min(width / movie.width, height / movie.height);
    const view: View = { scale, ox: (width - movie.width * scale) / 2, oy: (height - movie.height * scale) / 2, width, height };

    // render in order, upload up to UPLOADS PNGs at once (convertToBlob copies the canvas when called)
    const inflight = new Set<Promise<void>>();
    let sent = 0;
    let failure: unknown = null;
    for (let i = 0; i < total; i++) {
      check();
      if (failure) throw failure;
      await renderer.prepareFrame(movie, frameAt(i, from, to));
      renderer.drawFrame(ctx, movie, frameAt(i, from, to), view, { backstage: false, background: movie.background, transparentChecker: null, keepAlpha, exact: true });
      const blobP = canvas.convertToBlob({ type: 'image/png' });
      const index = i;
      const p: Promise<void> = blobP
        .then((blob) => call(`/${jobId}/frames/${index}`, { method: 'PUT', body: blob }))
        .then(() => { progress('frames', ++sent, total); }, (e: unknown) => { failure ??= e; })
        .finally(() => { inflight.delete(p); });
      inflight.add(p);
      if (inflight.size >= UPLOADS) await Promise.race(inflight);
      await yieldTurn();
    }
    await Promise.all(inflight);
    if (failure) throw failure;
    if (wav) await call(`/${jobId}/audio`, { method: 'PUT', body: wav });

    await call(`/${jobId}/run`, { method: 'POST' });
    progress('encoding', 0, total);
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      check();
      const s = await (await call(`/${jobId}`)).json() as { state: string; progress: number; output: string; error: string; encoder: string };
      if (s.state === 'encoding') { progress('encoding', Math.round(s.progress * total), total); continue; }
      if (s.state === 'done') {
        progress('finishing', 0, 1);
        const res = await fetch(`/api/exports/${encodeURIComponent(s.output)}`, { signal: abort.signal });
        if (!res.ok) throw new Error('The finished file could not be read back from Exports.');
        const blob = await res.blob();
        progress('finishing', 1, 1);
        const mime = s.output.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
        return { blob: blob.slice(0, blob.size, mime), name: s.output, mime, warnings, kept: true };
      }
      if (s.state === 'cancelled') throw abortError();
      throw new Error(s.error || 'The engine could not encode the movie.');
    }
  };

  const result = go().catch(async (e: unknown) => {
    // a failed or stopped job leaves nothing behind in the engine
    if (jobId) await fetch(`${BASE}/${jobId}`, { method: 'DELETE' }).catch(() => {});
    if (cancelled) throw abortError();
    throw e;
  });
  result.catch(() => {});
  (job as { result: Promise<ExportResult> }).result = result;
  return job;
}
