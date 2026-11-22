// Where an export runs. Video the window cannot encode (no VideoEncoder, or no supported configuration) goes to the
// engine's ffmpeg by itself, after asking what the engine can do; if it cannot either, the message says what to install.
import { canEncodeVideo, QUALITY_HIGH, QUALITY_LOW, QUALITY_MEDIUM, QUALITY_VERY_HIGH, type Quality, type VideoCodec } from 'mediabunny';
import { t } from '../ui/i18n';
import { tf } from '../ui/i18n-fill';
import { jobCapabilities, startEngineExport } from './engine-jobs';
import { startExportAuto } from './worker-host';
import type { Deps } from './run';
import type { ExportJob, ExportOptions, ExportProgress, ExportResult } from './types';

const QUALITY: Record<ExportOptions['quality'], Quality> = { low: QUALITY_LOW, medium: QUALITY_MEDIUM, high: QUALITY_HIGH, 'very-high': QUALITY_VERY_HIGH };

/** True when this window has a video encoder that can make `fmt` at this size. */
export async function browserEncodesVideo(fmt: 'mp4' | 'webm' | 'mov', o: Pick<ExportOptions, 'width' | 'height' | 'quality'>, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  const order: VideoCodec[] = fmt === 'webm' ? ['vp9', 'av1', 'vp8'] : ['avc', 'hevc', 'av1', 'vp9'];
  for (const codec of order) {
    try { if (await canEncodeVideo(codec, { width: o.width, height: o.height, quality: QUALITY[o.quality], frameRate: fps })) return true; } catch { /* next codec */ }
  }
  return false;
}

/** Why the engine cannot encode H.264 either, in a sentence that names the fix; '' when it can. */
export async function engineVideoBlocker(): Promise<string> {
  const caps = await jobCapabilities();
  if (!caps) return t('The FormMorpheus engine is not answering, so it cannot encode the video either. Start it with ./formmorpheus.');
  if (!caps.ffmpeg) return t('The FormMorpheus engine has no ffmpeg, so it cannot encode the video either. Install ffmpeg with the H.264 encoder (libx264), or set FORMMORPHEUS_FFMPEG to its path.');
  if (!caps.targets.h264?.available) return t('The engine\'s ffmpeg has no H.264 encoder (libx264), so it cannot encode the video either. Install an ffmpeg build that includes libx264.');
  return '';
}

/** Same contract as startExportAuto; video the window cannot encode is handed to the engine. */
export function startExportRouted(deps: Deps, opts: ExportOptions): ExportJob {
  const fmt = opts.format;
  if (fmt !== 'mp4' && fmt !== 'webm' && fmt !== 'mov') return startExportAuto(deps, opts);
  const listeners: ((p: ExportProgress) => void)[] = [];
  let inner: ExportJob | null = null;
  let cancelled = false;
  const job: ExportJob = {
    onProgress: (cb) => { listeners.push(cb); },
    cancel: () => { cancelled = true; inner?.cancel(); },
    result: Promise.resolve(null as never),
  };
  const attach = (j: ExportJob): void => { inner = j; j.onProgress((p) => { for (const cb of listeners) cb(p); }); if (cancelled) j.cancel(); };
  const go = async (): Promise<ExportResult> => {
    const fps = opts.fps && opts.fps > 0 ? opts.fps : deps.movie.fps;
    if (await browserEncodesVideo(fmt, opts, fps)) {
      const j = startExportAuto(deps, opts);
      attach(j);
      return j.result;
    }
    const name = fmt.toUpperCase();
    if (cancelled) throw new DOMException('Export cancelled', 'AbortError');
    // the engine writes MP4 and MOV (H.264); it has no WebM target
    if (fmt === 'webm') throw new Error(t('This system cannot encode WebM video, and the engine does not make WebM. Choose MP4 and the engine will encode it.'));
    const why = await engineVideoBlocker();
    if (why) throw new Error(`${tf('This system cannot encode {name} video at {w} x {h}.', { name, w: opts.width, h: opts.height })} ${why}`);
    const j = startEngineExport(deps as Parameters<typeof startEngineExport>[0], { ...opts, format: fmt === 'mov' ? 'h264-mov' : 'h264-mp4', target: 'h264' });
    attach(j);
    const res = await j.result;
    return { ...res, warnings: [tf('This system cannot encode {name} video itself, so the engine\'s encoder was used.', { name }), ...res.warnings] };
  };
  const result = go();
  result.catch(() => {});
  (job as { result: Promise<ExportResult> }).result = result;
  return job;
}
