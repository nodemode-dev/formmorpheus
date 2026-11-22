// Client of the engine's import transcodes (backend/app/routers/transcode.py): a file the browser cannot decode is
// uploaded, converted by the person's own ffmpeg (or pillow-heif for HEIC when installed) and fetched back as
// something the browser plays. Progress is polled. The iPad engine answers the same routes with AVFoundation, for video only.
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { serviceReady } from '../io/api';
import { platform } from '../platform';
import { t } from '../ui/i18n';

export type TranscodeKind = 'video' | 'audio' | 'image';
export interface Transcoded { blob: Blob; mime: string; alpha: boolean }

interface JobState { id: string; state: string; progress: number; error: string; mime: string; alpha: boolean }

const DOWN = 'The formmorpheus engine service is not running, and this file needs it to be converted. Start it with ./formmorpheus.';

async function detail(res: Response, fallback: string): Promise<string> {
  try { const b = (await res.json()) as { detail?: unknown }; if (typeof b?.detail === 'string') return b.detail; } catch { /* not JSON */ }
  return fallback;
}

export async function transcodeViaEngine(file: File, kind: TranscodeKind, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<Transcoded> {
  if (kind === 'audio' && !platform.features.soundConvert) throw new Error(t('This device cannot convert a sound its web view cannot decode. Convert it to WAV, AAC or MP3 first, then import that.'));
  if (kind === 'image' && !platform.features.pictureConvert) throw new Error(t('This device cannot convert this picture. Export it as PNG or JPEG first, then import that.'));
  if (!(await serviceReady())) throw new Error(DOWN);
  let res: Response;
  try {
    res = await fetch(`/api/transcode?kind=${kind}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' }, signal });
  } catch { throw new Error(DOWN); }
  if (!res.ok) throw new Error(await detail(res, `${file.name} could not be converted (${res.status}).`));
  let job = (await res.json()) as JobState;
  const cancel = (): void => { void fetch(`/api/transcode/${job.id}`, { method: 'DELETE' }).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (job.state === 'running') {
      if (signal?.aborted) throw new Error('Import cancelled.');
      onProgress?.(job.progress);
      await new Promise((r) => window.setTimeout(r, 250));
      const poll = await fetch(`/api/transcode/${job.id}`).catch(() => null);
      if (!poll || !poll.ok) throw new Error(DOWN);
      job = (await poll.json()) as JobState;
    }
    if (job.state !== 'done') throw new Error(job.error || `${file.name} could not be converted.`);
    onProgress?.(1);
    const out = await fetch(`/api/transcode/${job.id}/result`, { signal });
    if (!out.ok) throw new Error(await detail(out, `${file.name} could not be converted.`));
    const blob = await out.blob();
    return { blob, mime: job.mime, alpha: job.alpha };
  } finally {
    // the engine's copy goes on every way out (a failed or aborted fetch too), and the listener with it
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}

/** Whether this window decodes the first frame of the video with some see-through pixels; null when it could not tell. */
export async function showsAlpha(file: Blob): Promise<boolean | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const v = await input.getPrimaryVideoTrack();
    if (!v) return null;
    const sink = new CanvasSink(v, { width: 64, height: 64, fit: 'fill', alpha: true });
    const got = await sink.getCanvas(await v.getFirstTimestamp());
    if (!got) return null;
    const c = got.canvas;
    const ctx = c instanceof HTMLCanvasElement ? c.getContext('2d') : c.getContext('2d');
    if (!ctx) return null;
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true;
    return false;
  } catch { return null; } finally { input.dispose(); }
}
