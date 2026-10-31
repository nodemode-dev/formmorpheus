// The export worker: renders (OffscreenCanvas, the same Renderer as the window) and encodes off the main thread.
// 'file' mode runs the ordinary exporter (run.ts) here; 'frames' mode sends one PNG per frame for the engine jobs.
// Sound is mixed on the page and arrives as PCM. Video blocks are never sent here (the page keeps those exports).
import { Renderer, type View } from '../engine/render';
import { Run, type PcmMix } from './run';
import type { FaceRule, FromWorker, StartMsg, ToWorker } from './worker-protocol';

const scope = self as unknown as {
  postMessage(m: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  fonts: FontFaceSet;
};
const post = (m: FromWorker): void => { scope.postMessage(m); };

let cancelled = false;
let onCancel: (() => void) | null = null;
let consumed = 0;
let wake: (() => void) | null = null;

/** Weight and style from the OpenType OS/2 table, as the page reads them (media/fonts.ts). */
function faceStyle(b: Uint8Array): FontFaceDescriptors {
  const tag = (o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 12 || !(b[0] === 0 || tag(0) === 'OTTO' || tag(0) === 'true')) return {};
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i++) {
      const r = 12 + i * 16;
      if (tag(r) !== 'OS/2') continue;
      const off = dv.getUint32(r + 8);
      const weight = dv.getUint16(off + 4);
      const italic = (dv.getUint16(off + 62) & 1) === 1;
      return { weight: String(Math.max(1, Math.min(1000, weight || 400))), style: italic ? 'italic' : 'normal' };
    }
  } catch { /* a short or odd table: defaults */ }
  return {};
}

async function setupFonts(m: StartMsg): Promise<void> {
  const fonts = scope.fonts;
  const jobs: Promise<unknown>[] = [];
  for (const a of Object.values(m.movie.assets)) {
    const blob = m.blobs[a.id];
    if (a.kind !== 'font' || !a.family || !blob) continue;
    jobs.push((async () => {
      const data = await blob.arrayBuffer();
      const face = new FontFace(a.family as string, data, faceStyle(new Uint8Array(data)));
      await face.load();
      fonts.add(face);
    })().catch(() => undefined));
  }
  await Promise.all(jobs);
  for (const r of m.faces as FaceRule[]) {
    try {
      const d: FontFaceDescriptors = { weight: r.weight, style: r.style };
      if (r.unicodeRange) d.unicodeRange = r.unicodeRange;
      if (r.stretch) d.stretch = r.stretch;
      fonts.add(new FontFace(r.family, `url("${r.url}")`, d));
    } catch { /* an odd rule: that face is skipped */ }
  }
  await Promise.all(m.loads.map((l) => fonts.load(l.spec, l.text).catch(() => undefined)));
}

function pcmOf(a: NonNullable<StartMsg['audio']>): PcmMix | null {
  if (!a.channels?.length) return null;
  const ch = a.channels;
  return { numberOfChannels: ch.length, sampleRate: a.sampleRate, length: ch[0].length, getChannelData: (c) => ch[c] };
}

async function runFile(m: StartMsg, renderer: Renderer): Promise<void> {
  const pcm = m.audio ? pcmOf(m.audio) : null;
  const audio = m.audio?.present ? { mixdown: async (): Promise<PcmMix | null> => pcm } : null;
  const run = new Run({ movie: m.movie, renderer, audio }, m.opts,
    (stage, done, total) => post({ t: 'progress', p: { stage, done, total } }),
    () => cancelled, (fn) => { onCancel = fn; });
  const r = await run.go();
  post({ t: 'done', blob: r.blob, name: r.name, mime: r.mime, warnings: r.warnings });
}

async function runFrames(m: StartMsg, renderer: Renderer): Promise<void> {
  const o = m.opts;
  const movie = m.movie;
  const canvas = new OffscreenCanvas(o.width, o.height);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const scale = Math.min(o.width / movie.width, o.height / movie.height);
  const view: View = { scale, ox: (o.width - movie.width * scale) / 2, oy: (o.height - movie.height * scale) / 2, width: o.width, height: o.height };
  const unpin = renderer.pinGpu();
  try {
    const list = m.frameList ?? [];
    for (let i = 0; i < list.length; i++) {
      // stay at most a few frames ahead of what the page has taken
      while (i >= consumed + 4 && !cancelled) await new Promise<void>((res) => { wake = res; });
      if (cancelled) throw new DOMException('Export cancelled', 'AbortError');
      await renderer.prepareFrame(movie, list[i]);
      renderer.drawFrame(ctx, movie, list[i], view, { backstage: false, background: movie.background, transparentChecker: null, keepAlpha: m.keepAlpha === true, exact: true });
      post({ t: 'frame', index: i, blob: await canvas.convertToBlob({ type: 'image/png' }) });
    }
  } finally { unpin(); }
}

async function start(m: StartMsg): Promise<void> {
  const blobs = new Map(Object.entries(m.blobs));
  const renderer = new Renderer((id) => blobs.get(id), () => undefined);
  if (m.gpu && !renderer.useGpu(true)) { post({ t: 'error', message: 'No GPU in the worker.', abort: false, fallback: true }); return; }
  await setupFonts(m);
  post({ t: 'ready' });
  if (m.mode === 'frames') await runFrames(m, renderer); else await runFile(m, renderer);
}

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.t === 'cancel') { cancelled = true; onCancel?.(); wake?.(); return; }
  if (m.t === 'consumed') { consumed = m.count; wake?.(); return; }
  start(m).catch((err: unknown) => {
    const abort = cancelled || (err instanceof DOMException && err.name === 'AbortError');
    post({ t: 'error', message: err instanceof Error ? err.message : String(err), abort, fallback: false });
  });
};
