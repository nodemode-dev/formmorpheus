// Page-side probes for the iPad: what this web view really offers (secure context, Pencil data, codecs, workers, storage,
// WebGL limits, memory headroom, input latency). The owner runs them on the device; the results go to the shell as one
// `diag` message, and the shell adds device facts and saves the file. Nothing here changes the app.
//
// Messages to the shell:
//   diag          the full report once the probes finish (and again when a Pencil test ends after it)
//                 { schema, startedAt, finishedAt, platform, probes: [...], pencil }
//   diagProgress  one note per memory ramp step, for a shell that wants to log how far a killed web view got
//                 { partial: true, probe: 'memoryRamp', allocatedMB, step, ms }
// The shell answers a report with `diagSaved { ok, name }`.
// The ramp also keeps its last step in localStorage, so a launch that follows a killed web view can tell how far it got.
import { platform } from './index';
import type { BridgePayload, PlatformInfo } from './types';

// The probes read many optional browser features whose types are not all in the DOM library.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const G = globalThis as Any;

export type ProbeStatus = 'ok' | 'warn' | 'fail' | 'skip';
export interface ProbeResult { id: string; title: string; status: ProbeStatus; ms: number; summary: string; data: Record<string, unknown> }
export interface Range { min: number; max: number; varies: boolean; present: boolean }
export interface PencilResult {
  ran: boolean;
  seconds: number;
  pointerTypes: Record<string, number>;
  /** Pen contact: every sample (coalesced ones included) with a distinct timestamp. */
  penSamples: number;
  penEvents: number;
  strokes: number;
  sampleRateHz: number;
  medianIntervalMs: number;
  eventRateHz: number;
  coalescedPerEventMax: number;
  predictedPerEventMax: number;
  hoverMoves: number;
  rawUpdates: number;
  pressure: Range & { distinct: number };
  tiltX: Range;
  tiltY: Range;
  twist: Range;
  altitudeAngle: Range;
  azimuthAngle: Range;
  latencyMs: { n: number; mean: number; p50: number; p95: number; max: number };
  frameMs: { n: number; mean: number; p95: number };
}
export interface DiagReport { schema: 1; startedAt: string; finishedAt: string; platform: PlatformInfo; probes: ProbeResult[]; pencil: PencilResult | null;
  /** true on the full report (the shell opens its share sheet); false on a Pencil follow-up (saved quietly). */
  final?: boolean }

export interface DiagOptions {
  /** Where the memory ramp stops, in megabytes; 0 leaves the ramp out. Default 1536 (1.5 GB). */
  memoryCapMB?: number;
  /** The Pencil test's result when the pad has been used. */
  pencil?: () => PencilResult | null;
  onProbe?: (id: string, state: 'running' | 'done', result?: ProbeResult) => void;
  signal?: AbortSignal;
}

const now = (): number => performance.now();
const turn = (): Promise<void> => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); });
const errText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const q = (v: number[], p: number): number => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0);
const r2 = (v: number): number => Math.round(v * 100) / 100;

interface Out { status: ProbeStatus; summary: string; data: Record<string, unknown> }
interface Probe { id: string; title: string; run(o: DiagOptions): Promise<Out> }

// -- page and context ----------------------------------------------------------------------------------------------

async function probeContext(): Promise<Out> {
  const nav = navigator as Any;
  const mm = (s: string): boolean => { try { return matchMedia(s).matches; } catch { return false; } };
  const data = {
    isSecureContext: window.isSecureContext,
    origin: location.origin,
    href: location.href,
    protocol: location.protocol,
    crossOriginIsolated: !!G.crossOriginIsolated,
    userAgent: navigator.userAgent,
    language: navigator.language,
    devicePixelRatio: window.devicePixelRatio,
    inner: [window.innerWidth, window.innerHeight],
    screen: [screen.width, screen.height],
    visualViewport: window.visualViewport ? [window.visualViewport.width, window.visualViewport.height, window.visualViewport.scale] : null,
    maxTouchPoints: navigator.maxTouchPoints,
    media: { anyPointerFine: mm('(any-pointer: fine)'), pointerFine: mm('(pointer: fine)'), anyHover: mm('(any-hover: hover)'), hover: mm('(hover: hover)'), colorGamutP3: mm('(color-gamut: p3)'), dynamicRangeHigh: mm('(dynamic-range: high)'), reducedMotion: mm('(prefers-reduced-motion: reduce)') },
    bridge: platform.bridge.available,
    bridgeInfo: platform.info,
    serviceWorker: 'serviceWorker' in navigator,
    webgpu: !!nav.gpu,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    webAudio: typeof AudioContext !== 'undefined' || typeof G.webkitAudioContext !== 'undefined',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    clipboardWrite: !!navigator.clipboard?.write,
  };
  return { status: window.isSecureContext ? 'ok' : 'fail', summary: `secure=${window.isSecureContext} dpr=${window.devicePixelRatio} touch=${navigator.maxTouchPoints}`, data };
}

async function probeDisplay(): Promise<Out> {
  const stamps: number[] = [];
  await new Promise<void>((resolve) => {
    const tick = (t: number): void => { stamps.push(t); if (stamps.length < 91) requestAnimationFrame(tick); else resolve(); };
    requestAnimationFrame(tick);
    window.setTimeout(resolve, 3000);
  });
  const d: number[] = [];
  for (let i = 1; i < stamps.length; i++) d.push(stamps[i] - stamps[i - 1]);
  d.sort((a, b) => a - b);
  const med = q(d, 0.5);
  const hz = med > 0 ? Math.round(1000 / med) : 0;
  return { status: hz ? 'ok' : 'warn', summary: `refresh~${hz} Hz median=${r2(med)} ms`, data: { frames: stamps.length, medianMs: r2(med), p95Ms: r2(q(d, 0.95)), maxMs: r2(d[d.length - 1] ?? 0), approxHz: hz } };
}

// -- pointer features ----------------------------------------------------------------------------------------------

async function probePointer(): Promise<Out> {
  const has = typeof PointerEvent !== 'undefined';
  const proto = has ? (PointerEvent.prototype as Any) : {};
  const props = ['pressure', 'tangentialPressure', 'tiltX', 'tiltY', 'twist', 'altitudeAngle', 'azimuthAngle', 'width', 'height', 'pointerType', 'isPrimary', 'persistentDeviceId'];
  const present: Record<string, boolean> = {};
  for (const p of props) present[p] = p in proto;
  const data = {
    PointerEvent: has,
    properties: present,
    getCoalescedEvents: has && typeof proto.getCoalescedEvents === 'function',
    getPredictedEvents: has && typeof proto.getPredictedEvents === 'function',
    onpointerrawupdate: 'onpointerrawupdate' in window,
    onpointerrawupdateDocument: 'onpointerrawupdate' in document,
    touchEvents: 'ontouchstart' in window,
    gestureEvents: 'ongesturestart' in window,
    hoverPointerNote: 'Hover with the Pencil is judged by the Pencil test: pen pointermove events with no buttons down.',
  };
  const need = present.pressure && present.tiltX && present.tiltY && present.twist && data.getCoalescedEvents;
  return { status: need ? 'ok' : 'warn', summary: `pressure=${present.pressure} tilt=${present.tiltX} twist=${present.twist} altitude=${present.altitudeAngle} coalesced=${data.getCoalescedEvents} predicted=${data.getPredictedEvents} raw=${data.onpointerrawupdate}`, data };
}

async function probePencil(o: DiagOptions): Promise<Out> { return pencilOut(o); }
async function probeLatency(o: DiagOptions): Promise<Out> { return latencyOut(o); }

function pencilOut(o: DiagOptions): Out {
  const r = o.pencil?.() ?? null;
  if (!r || !r.ran) return { status: 'skip', summary: 'not run', data: { note: 'Use the Pencil test area, then run again or send the results.' } };
  const pen = (r.pointerTypes.pen ?? 0) > 0;
  const good = pen && r.pressure.varies && r.tiltX.varies;
  return { status: pen ? (good ? 'ok' : 'warn') : 'fail', summary: `rate=${r.sampleRateHz} Hz pressure=${r2(r.pressure.min)}..${r2(r.pressure.max)} tilt=${r.tiltX.varies} twist=${r.twist.varies} altitude=${r.altitudeAngle.varies}`, data: r as unknown as Record<string, unknown> };
}

function latencyOut(o: DiagOptions): Out {
  const r = o.pencil?.() ?? null;
  if (!r || !r.ran || !r.latencyMs.n) return { status: 'skip', summary: 'not run', data: { note: 'Measured while the Pencil test runs.' } };
  return { status: r.latencyMs.p95 < 40 ? 'ok' : 'warn', summary: `mean=${r.latencyMs.mean} ms p95=${r.latencyMs.p95} ms n=${r.latencyMs.n}`, data: { ...r.latencyMs, frame: r.frameMs, note: 'From the pointer event time stamp to the start of the next animation frame.' } };
}

// -- codecs --------------------------------------------------------------------------------------------------------

const VIDEO_CODECS = [
  { name: 'avc1', hd: 'avc1.640028', uhd: 'avc1.640033' },
  { name: 'hvc1', hd: 'hvc1.1.6.L120.B0', uhd: 'hvc1.1.6.L150.B0' },
  { name: 'vp09', hd: 'vp09.00.40.08', uhd: 'vp09.00.50.08' },
  { name: 'av01', hd: 'av01.0.08M.08', uhd: 'av01.0.12M.08' },
];

async function supports(codec: string, w: number, h: number, hw: string): Promise<{ supported: boolean; hardware: string; error?: string }> {
  try {
    const cfg: Any = { codec, width: w, height: h, bitrate: w >= 3840 ? 60_000_000 : 20_000_000, framerate: 30, hardwareAcceleration: hw };
    if (codec.startsWith('avc1')) cfg.avc = { format: 'avc' };
    if (codec.startsWith('hvc1')) cfg.hevc = { format: 'hevc' };
    const r = await G.VideoEncoder.isConfigSupported(cfg);
    return { supported: !!r.supported, hardware: String(r.config?.hardwareAcceleration ?? hw) };
  } catch (e) { return { supported: false, hardware: hw, error: errText(e) }; }
}

async function probeWebCodecs(): Promise<Out> {
  const data: Record<string, unknown> = { VideoEncoder: typeof G.VideoEncoder !== 'undefined', VideoDecoder: typeof G.VideoDecoder !== 'undefined', AudioEncoder: typeof G.AudioEncoder !== 'undefined', AudioDecoder: typeof G.AudioDecoder !== 'undefined', VideoFrame: typeof G.VideoFrame !== 'undefined' };
  if (!data.VideoEncoder) return { status: 'fail', summary: 'VideoEncoder missing', data };
  const video: Record<string, unknown> = {};
  const line: string[] = [];
  for (const c of VIDEO_CODECS) {
    for (const [label, codec, w, h] of [['1080p', c.hd, 1920, 1080], ['4k', c.uhd, 3840, 2160]] as const) {
      const row: Record<string, unknown> = { codec };
      for (const hw of ['no-preference', 'prefer-hardware', 'prefer-software']) row[hw] = await supports(codec, w, h, hw);
      video[`${c.name}-${label}`] = row;
      line.push(`${c.name}/${label}=${(row['no-preference'] as { supported: boolean }).supported ? 'yes' : 'no'}`);
    }
  }
  data.video = video;
  const audio: Record<string, unknown> = {};
  if (data.AudioEncoder) {
    for (const [name, codec] of [['opus', 'opus'], ['aac', 'mp4a.40.2']] as const) {
      try { const r = await G.AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }); audio[name] = { codec, supported: !!r.supported }; } catch (e) { audio[name] = { codec, supported: false, error: errText(e) }; }
    }
  }
  data.audio = audio;
  for (const k of Object.keys(audio)) line.push(`${k}=${(audio[k] as { supported: boolean }).supported ? 'yes' : 'no'}`);
  const hd = video['avc1-1080p'] as { 'no-preference': { supported: boolean } };
  return { status: hd['no-preference'].supported ? 'ok' : 'warn', summary: line.join(' '), data };
}

/** Encodes 60 frames of 1080p H.264 to see the real speed, not only whether the configuration is accepted. */
async function probeEncodeSpeed(): Promise<Out> {
  if (typeof G.VideoEncoder === 'undefined' || typeof G.VideoFrame === 'undefined') return { status: 'skip', summary: 'no WebCodecs', data: {} };
  const w = 1920, h = 1080, frames = 60;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return { status: 'skip', summary: 'no canvas', data: {} };
  let chunks = 0, bytes = 0, fault = '';
  const enc = new G.VideoEncoder({ output: (c: Any) => { chunks++; bytes += c.byteLength; }, error: (e: unknown) => { fault = errText(e); } });
  try {
    enc.configure({ codec: 'avc1.640028', width: w, height: h, bitrate: 20_000_000, framerate: 30, avc: { format: 'avc' } });
    const t0 = now();
    for (let i = 0; i < frames; i++) {
      g.fillStyle = `hsl(${i * 6} 70% 50%)`;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.fillRect((i * 31) % w, (i * 17) % h, 200, 200);
      const f = new G.VideoFrame(canvas, { timestamp: i * 33333 });
      enc.encode(f, { keyFrame: i === 0 });
      f.close();
      while (enc.encodeQueueSize > 4) await turn();
    }
    await enc.flush();
    const ms = now() - t0;
    enc.close();
    if (fault) return { status: 'fail', summary: fault, data: { error: fault } };
    return { status: 'ok', summary: `${r2((frames * 1000) / ms)} fps at 1080p`, data: { frames, ms: Math.round(ms), fps: r2((frames * 1000) / ms), chunks, bytes } };
  } catch (e) {
    try { enc.close(); } catch { /* already closed */ }
    return { status: 'fail', summary: errText(e), data: { error: errText(e) } };
  }
}

// -- workers and bitmaps -------------------------------------------------------------------------------------------

async function probeWorkers(): Promise<Out> {
  const data: Record<string, unknown> = {};
  let status: ProbeStatus = 'ok';
  const ask = (w: Worker, ms: number): Promise<Record<string, unknown>> => new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ ok: false, error: 'no answer' }), ms);
    w.onmessage = (e: MessageEvent) => { window.clearTimeout(timer); resolve(e.data as Record<string, unknown>); };
    w.onerror = (e: ErrorEvent) => { window.clearTimeout(timer); resolve({ ok: false, error: e.message || 'worker error' }); };
    w.postMessage({});
  });
  try {
    const url = new URL('./diag-worker.ts', import.meta.url);
    data.moduleWorkerUrl = url.href;
    const w = new Worker(url, { type: 'module' });
    data.moduleWorker = await ask(w, 8000);
    w.terminate();
    if (data.moduleWorker && (data.moduleWorker as { ok?: boolean }).ok !== true) status = 'fail';
  } catch (e) { data.moduleWorker = { ok: false, error: errText(e) }; status = 'fail'; }
  try {
    const src = 'self.onmessage=()=>{self.postMessage({ok:true,offscreen:typeof OffscreenCanvas!=="undefined"})}';
    const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(blobUrl);
    data.blobWorker = await ask(w, 4000);
    w.terminate();
    URL.revokeObjectURL(blobUrl);
  } catch (e) { data.blobWorker = { ok: false, error: errText(e) }; }
  const mw = data.moduleWorker as { canvas?: { context2d?: boolean }; webgl?: { webgl2?: boolean } } | undefined;
  if (status === 'ok' && (!mw?.canvas?.context2d || !mw?.webgl?.webgl2)) status = 'warn';
  return { status, summary: `module=${(data.moduleWorker as { ok?: boolean })?.ok === true} offscreen2d=${!!mw?.canvas?.context2d} offscreenGL2=${!!mw?.webgl?.webgl2}`, data };
}

async function probeBitmaps(): Promise<Out> {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 30;
  const g = c.getContext('2d');
  if (g) { g.fillStyle = 'rgba(255,0,0,0.5)'; g.fillRect(0, 0, 40, 30); }
  const png: Blob = await new Promise((res) => c.toBlob((b) => res(b ?? new Blob()), 'image/png'));
  const tries: Array<[string, ImageBitmapOptions]> = [
    ['plain', {}],
    ['resize', { resizeWidth: 20, resizeHeight: 15, resizeQuality: 'high' }],
    ['resizePixelated', { resizeWidth: 20, resizeHeight: 15, resizeQuality: 'pixelated' }],
    ['premultiply', { premultiplyAlpha: 'premultiply' }],
    ['premultiplyNone', { premultiplyAlpha: 'none' }],
    ['colorSpaceNone', { colorSpaceConversion: 'none' }],
    ['orientationFlipY', { imageOrientation: 'flipY' }],
    ['orientationFromImage', { imageOrientation: 'from-image' }],
  ];
  const data: Record<string, unknown> = { createImageBitmap: typeof createImageBitmap === 'function' };
  const rows: Record<string, unknown> = {};
  let failed = 0;
  for (const [name, opt] of tries) {
    try {
      const b = await createImageBitmap(png, opt);
      rows[name] = { ok: true, size: [b.width, b.height], honoredResize: opt.resizeWidth ? b.width === opt.resizeWidth : null };
      b.close();
    } catch (e) { failed++; rows[name] = { ok: false, error: errText(e) }; }
  }
  data.options = rows;
  const dec: Record<string, unknown> = { ImageDecoder: typeof G.ImageDecoder !== 'undefined' };
  if (dec.ImageDecoder) {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/heic']) {
      try { dec[t] = await G.ImageDecoder.isTypeSupported(t); } catch (e) { dec[t] = errText(e); }
    }
  }
  data.imageDecoder = dec;
  return { status: failed ? 'warn' : 'ok', summary: `options failed=${failed}/${tries.length} ImageDecoder=${dec.ImageDecoder}`, data };
}

// -- storage -------------------------------------------------------------------------------------------------------

const SESSION = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function idb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('fm-diagnostics', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('kv'); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { run(open.result).then((v) => { open.result.close(); resolve(v); }, (e) => { open.result.close(); reject(e); }); };
  });
}
const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function probeStorage(): Promise<Out> {
  const data: Record<string, unknown> = {};
  let status: ProbeStatus = 'ok';
  try {
    const prev = await idb((db) => req(db.transaction('kv').objectStore('kv').get('launch')));
    data.indexedDBPreviousLaunch = prev ?? null;
    await idb((db) => req(db.transaction('kv', 'readwrite').objectStore('kv').put({ id: SESSION, at: new Date().toISOString() }, 'launch')).then(() => undefined));
    const echo = await idb(async (db) => {
      const payload = new Uint8Array(1024 * 1024).fill(7);
      await req(db.transaction('kv', 'readwrite').objectStore('kv').put(payload, 'blob'));
      const back = (await req(db.transaction('kv').objectStore('kv').get('blob'))) as Uint8Array | undefined;
      return back?.length ?? 0;
    });
    data.indexedDBRoundTripBytes = echo;
    if (echo !== 1024 * 1024) status = 'fail';
  } catch (e) { data.indexedDBError = errText(e); status = 'fail'; }
  try {
    const prev = localStorage.getItem('fm.diag.launch');
    data.localStoragePreviousLaunch = prev;
    localStorage.setItem('fm.diag.launch', JSON.stringify({ id: SESSION, at: new Date().toISOString() }));
    data.localStorageWorks = localStorage.getItem('fm.diag.launch') !== null;
  } catch (e) { data.localStorageError = errText(e); status = 'fail'; }
  try {
    const est = await navigator.storage?.estimate?.();
    data.estimate = est ? { quotaMB: Math.round((est.quota ?? 0) / 1048576), usageMB: Math.round((est.usage ?? 0) / 1048576) } : null;
    data.persisted = (await navigator.storage?.persisted?.()) ?? null;
    data.originPrivateFileSystem = typeof navigator.storage?.getDirectory === 'function';
  } catch (e) { data.estimateError = errText(e); }
  data.note = 'Run again after quitting and reopening the app: a previous launch id here means storage survived.';
  return { status, summary: `idb=${data.indexedDBRoundTripBytes === 1048576} ls=${data.localStorageWorks === true} quota=${(data.estimate as { quotaMB?: number } | null)?.quotaMB ?? '?'} MB`, data };
}

// -- WebGL 2 -------------------------------------------------------------------------------------------------------

async function probeWebGL(): Promise<Out> {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
  if (!gl) return { status: 'fail', summary: 'no WebGL 2', data: { webgl2: false } };
  const get = (p: number): unknown => { const v = gl.getParameter(p); return v instanceof Int32Array || v instanceof Float32Array ? Array.from(v) : v; };
  const ext = gl.getSupportedExtensions() ?? [];
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const data: Record<string, unknown> = {
    webgl2: true,
    version: get(gl.VERSION),
    renderer: info ? get(info.UNMASKED_RENDERER_WEBGL) : get(gl.RENDERER),
    vendor: info ? get(info.UNMASKED_VENDOR_WEBGL) : get(gl.VENDOR),
    MAX_TEXTURE_SIZE: get(gl.MAX_TEXTURE_SIZE),
    MAX_RENDERBUFFER_SIZE: get(gl.MAX_RENDERBUFFER_SIZE),
    MAX_VIEWPORT_DIMS: get(gl.MAX_VIEWPORT_DIMS),
    MAX_3D_TEXTURE_SIZE: get(gl.MAX_3D_TEXTURE_SIZE),
    MAX_DRAW_BUFFERS: get(gl.MAX_DRAW_BUFFERS),
    MAX_COLOR_ATTACHMENTS: get(gl.MAX_COLOR_ATTACHMENTS),
    MAX_SAMPLES: get(gl.MAX_SAMPLES),
    MAX_TEXTURE_IMAGE_UNITS: get(gl.MAX_TEXTURE_IMAGE_UNITS),
    extensions: ext.filter((e) => /float|half|linear|blend|compress|bptc|astc|etc|s3tc|anisotropic/i.test(e)),
  };
  const renderable = (internal: number, type: number, label: string): void => {
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, gl.RGBA, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    data[label] = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
  };
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_color_buffer_half_float');
  renderable(gl.RGBA16F, gl.HALF_FLOAT, 'renderableRGBA16F');
  renderable(gl.RGBA32F, gl.FLOAT, 'renderableRGBA32F');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const side = Number(data.MAX_TEXTURE_SIZE);
  return { status: side >= 8192 && data.renderableRGBA16F === true ? 'ok' : 'warn', summary: `maxTexture=${side} rgba16f=${data.renderableRGBA16F} rgba32f=${data.renderableRGBA32F}`, data };
}

// -- memory --------------------------------------------------------------------------------------------------------

const RAMP_KEY = 'fm.diag.ramp';

async function probeMemory(o: DiagOptions): Promise<Out> {
  const cap = o.memoryCapMB ?? 1536;
  const nav = navigator as Any;
  const data: Record<string, unknown> = { deviceMemoryGB: nav.deviceMemory ?? null, hardwareConcurrency: navigator.hardwareConcurrency, jsHeap: G.performance?.memory ? { usedMB: Math.round(G.performance.memory.usedJSHeapSize / 1048576), limitMB: Math.round(G.performance.memory.jsHeapSizeLimit / 1048576) } : null, capMB: cap };
  try {
    const last = localStorage.getItem(RAMP_KEY);
    if (last) data.previousRamp = JSON.parse(last);
  } catch { /* storage blocked */ }
  if (cap <= 0) return { status: 'skip', summary: 'ramp off', data };

  const W = 3840, H = 2160, MB = (W * H * 4) / 1048576;
  const held: HTMLCanvasElement[] = [];
  const steps: Array<{ n: number; mb: number; ms: number }> = [];
  let warned = false;
  let stop: string = 'cap';
  const off = platform.bridge.on('memoryWarning', () => { warned = true; });
  try {
    while ((held.length + 1) * MB <= cap) {
      if (o.signal?.aborted) { stop = 'cancelled'; break; }
      if (warned) { stop = 'memoryWarning'; break; }
      const t0 = now();
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: false });
      if (!g) { stop = 'noContext'; break; }
      g.fillStyle = `rgb(${held.length * 7 % 256},120,200)`;
      g.fillRect(0, 0, W, H);
      g.getImageData(0, 0, 1, 1);   // forces the backing store to exist
      held.push(c);
      const ms = Math.round(now() - t0);
      steps.push({ n: held.length, mb: Math.round(held.length * MB), ms });
      const note = { partial: true, probe: 'memoryRamp', step: held.length, allocatedMB: Math.round(held.length * MB), ms };
      try { localStorage.setItem(RAMP_KEY, JSON.stringify({ ...note, at: new Date().toISOString(), finished: false })); } catch { /* storage blocked */ }
      platform.bridge.post('diagProgress', note);
      if (ms > 3000) { stop = 'slow'; break; }
      await turn();
      await new Promise((r) => window.setTimeout(r, 30));
    }
  } catch (e) { stop = `error: ${errText(e)}`; }
  const reachedMB = Math.round(held.length * MB);
  for (const c of held) { c.width = 0; c.height = 0; }   // releases each backing store
  held.length = 0;
  off();
  try { localStorage.setItem(RAMP_KEY, JSON.stringify({ allocatedMB: reachedMB, stop, at: new Date().toISOString(), finished: true })); } catch { /* storage blocked */ }
  data.bufferMB = r2(MB);
  data.buffers = steps.length;
  data.reachedMB = reachedMB;
  data.stop = stop;
  data.steps = steps;
  data.slowestStepMs = steps.reduce((m, s) => Math.max(m, s.ms), 0);
  return { status: stop === 'cap' ? 'ok' : 'warn', summary: `reached=${reachedMB} MB of ${cap} MB stop=${stop}`, data };
}

// -- the list and the runner ---------------------------------------------------------------------------------------

export const PROBES: Probe[] = [
  { id: 'context', title: 'Page and secure context', run: probeContext },
  { id: 'display', title: 'Display refresh', run: probeDisplay },
  { id: 'pointer', title: 'Pointer features', run: probePointer },
  { id: 'pencil', title: 'Pencil test', run: probePencil },
  { id: 'latency', title: 'Input latency', run: probeLatency },
  { id: 'webcodecs', title: 'WebCodecs', run: probeWebCodecs },
  { id: 'encodeSpeed', title: 'Encode speed', run: probeEncodeSpeed },
  { id: 'workers', title: 'Workers and offscreen canvas', run: probeWorkers },
  { id: 'bitmaps', title: 'Bitmaps and image decoding', run: probeBitmaps },
  { id: 'storage', title: 'Storage', run: probeStorage },
  { id: 'webgl', title: 'WebGL 2 limits', run: probeWebGL },
  { id: 'memory', title: 'Memory ramp', run: probeMemory },
];

/** Runs every probe in turn (the memory ramp last), reporting each as it starts and ends. */
export async function runDiagnostics(opts: DiagOptions = {}): Promise<DiagReport> {
  const startedAt = new Date().toISOString();
  const probes: ProbeResult[] = [];
  for (const p of PROBES) {
    if (opts.signal?.aborted) break;
    opts.onProbe?.(p.id, 'running');
    const t0 = now();
    let out: Out;
    try { out = await p.run(opts); } catch (e) { out = { status: 'fail', summary: errText(e), data: { error: errText(e) } }; }
    const result: ProbeResult = { id: p.id, title: p.title, status: out.status, ms: Math.round(now() - t0), summary: out.summary, data: out.data };
    probes.push(result);
    opts.onProbe?.(p.id, 'done', result);
    await turn();
  }
  return { schema: 1, startedAt, finishedAt: new Date().toISOString(), platform: platform.info, probes, pencil: opts.pencil?.() ?? null, final: true };
}

/** The same report with the Pencil and latency rows redone from a Pencil test run after it (the other rows are kept). */
export function withPencil(report: DiagReport, pencil: () => PencilResult | null): DiagReport {
  const o: DiagOptions = { pencil };
  const swap = (p: ProbeResult): ProbeResult => {
    const out = p.id === 'pencil' ? pencilOut(o) : p.id === 'latency' ? latencyOut(o) : null;
    return out ? { ...p, status: out.status, summary: out.summary, data: out.data } : p;
  };
  return { ...report, finishedAt: new Date().toISOString(), probes: report.probes.map(swap), pencil: pencil(), final: false };
}

/** Sends a report to the shell, which adds device facts and saves the file; false when no shell listens. */
export function postDiagnostics(report: DiagReport): boolean {
  return platform.bridge.post('diag', report as unknown as BridgePayload);
}

// -- the Pencil test pad -------------------------------------------------------------------------------------------

const span = (vals: number[], eps: number): Range => {
  if (!vals.length) return { min: 0, max: 0, varies: false, present: false };
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return { min: r2(lo), max: r2(hi), varies: hi - lo > eps, present: true };
};

/**
 * Records real Pencil data on one element for a fixed time: sample rate (every coalesced sample counted once by its
 * time stamp), the ranges of pressure, tilt, twist, altitude and azimuth, hover moves, raw updates, and the time from
 * each event to the next animation frame.
 */
export class PencilPad {
  private running = false;
  private startedAt = 0;
  private timer = 0;
  private frame = 0;
  private result: PencilResult | null = null;
  private types: Record<string, number> = {};
  private stamps = new Set<number>();
  private strokeStamps: number[][] = [];
  private cur: number[] | null = null;
  private penEvents = 0;
  private coalMax = 0;
  private predMax = 0;
  private hover = 0;
  private raw = 0;
  private pressure: number[] = [];
  private pressureSet = new Set<number>();
  private tx: number[] = []; private ty: number[] = []; private tw: number[] = []; private alt: number[] = []; private azi: number[] = [];
  private pending: number[] = [];
  private lat: number[] = [];
  private frames: number[] = [];
  private lastFrame = 0;
  private lastPos = new Map<number, [number, number]>();

  constructor(private readonly el: HTMLElement, private readonly canvas: HTMLCanvasElement, private readonly onTick: (info: { left: number; live: string }) => void, private readonly onDone: (r: PencilResult) => void, private readonly seconds = 5) {
    el.style.touchAction = 'none';
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) el.addEventListener(t, (e) => this.onPointer(e as PointerEvent));
    el.addEventListener('pointerrawupdate', () => { if (this.running) this.raw++; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get isRunning(): boolean { return this.running; }
  get last(): PencilResult | null { return this.result; }

  start(): void {
    if (this.running) return;
    this.types = {}; this.stamps = new Set(); this.strokeStamps = []; this.cur = null; this.penEvents = 0; this.coalMax = 0; this.predMax = 0; this.hover = 0; this.raw = 0;
    this.pressure = []; this.pressureSet = new Set(); this.tx = []; this.ty = []; this.tw = []; this.alt = []; this.azi = []; this.pending = []; this.lat = []; this.frames = []; this.lastFrame = 0;
    this.lastPos.clear();
    const g = this.canvas.getContext('2d');
    g?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.running = true;
    this.startedAt = now();
    this.frame = requestAnimationFrame((t) => this.tick(t));
    this.timer = window.setTimeout(() => this.finish(), this.seconds * 1000);
  }

  cancel(): void {
    if (!this.running) return;
    this.running = false;
    window.clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
  }

  private tick(t: number): void {
    if (!this.running) return;
    const at = now();
    if (this.lastFrame) this.frames.push(t - this.lastFrame);
    this.lastFrame = t;
    for (const ts of this.pending) this.lat.push(at - ts);
    this.pending.length = 0;
    this.onTick({ left: Math.max(0, this.seconds - (at - this.startedAt) / 1000), live: '' });
    this.frame = requestAnimationFrame((n) => this.tick(n));
  }

  private onPointer(e: PointerEvent): void {
    if (!this.running) return;
    this.types[e.pointerType] = (this.types[e.pointerType] ?? 0) + 1;
    const pen = e.pointerType === 'pen';
    const contact = e.type === 'pointerdown' || (e.type === 'pointermove' && e.buttons > 0) || e.type === 'pointerup';
    if (e.type === 'pointerdown') { try { this.el.setPointerCapture(e.pointerId); } catch { /* not capturable */ } if (pen) { this.cur = []; this.strokeStamps.push(this.cur); } }
    if (e.type === 'pointermove') this.pending.push(e.timeStamp);
    if (pen) {
      this.penEvents++;
      if (e.type === 'pointermove' && e.buttons === 0) this.hover++;
      const co: PointerEvent[] = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const pr: PointerEvent[] = typeof e.getPredictedEvents === 'function' ? e.getPredictedEvents() : [];
      this.coalMax = Math.max(this.coalMax, co.length);
      this.predMax = Math.max(this.predMax, pr.length);
      const list = co.length ? co : [e];
      for (const s of list) {
        const a = s as Any;
        if (contact || s.buttons > 0 || (s.pressure ?? 0) > 0) {
          if (!this.stamps.has(s.timeStamp)) { this.stamps.add(s.timeStamp); this.cur?.push(s.timeStamp); }
          this.pressure.push(s.pressure); this.pressureSet.add(Math.round(s.pressure * 1000));
        }
        this.tx.push(s.tiltX); this.ty.push(s.tiltY); this.tw.push(s.twist);
        if (typeof a.altitudeAngle === 'number') this.alt.push(a.altitudeAngle);
        if (typeof a.azimuthAngle === 'number') this.azi.push(a.azimuthAngle);
      }
    }
    if (e.type === 'pointerup' || e.type === 'pointercancel') { this.cur = null; this.lastPos.delete(e.pointerId); }
    this.draw(e);
  }

  private draw(e: PointerEvent): void {
    const g = this.canvas.getContext('2d');
    if (!g || !(e.type === 'pointermove' ? e.buttons > 0 : e.type === 'pointerdown')) return;
    const box = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * this.canvas.width, y = ((e.clientY - box.top) / box.height) * this.canvas.height;
    const prev = this.lastPos.get(e.pointerId) ?? [x, y];
    g.strokeStyle = getComputedStyle(this.canvas).color || '#f97316';
    g.lineCap = 'round';
    g.lineWidth = 1 + (e.pointerType === 'pen' ? e.pressure : 0.4) * 10;
    g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(x, y); g.stroke();
    this.lastPos.set(e.pointerId, [x, y]);
    this.onTick({ left: Math.max(0, this.seconds - (now() - this.startedAt) / 1000), live: `${e.pointerType} p=${r2(e.pressure)} tilt=${Math.round(e.tiltX)},${Math.round(e.tiltY)} twist=${Math.round(e.twist)}` });
  }

  private finish(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frame);
    // sample rate: samples per second inside each stroke, summed over strokes
    let n = 0, dur = 0;
    const gaps: number[] = [];
    for (const s of this.strokeStamps) {
      if (s.length < 2) continue;
      s.sort((a, b) => a - b);
      n += s.length - 1;
      dur += s[s.length - 1] - s[0];
      for (let i = 1; i < s.length; i++) gaps.push(s[i] - s[i - 1]);
    }
    gaps.sort((a, b) => a - b);
    const lat = this.lat.slice().sort((a, b) => a - b);
    const fr = this.frames.slice().sort((a, b) => a - b);
    const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
    const events = this.types.pen ?? 0;
    const r: PencilResult = {
      ran: true,
      seconds: this.seconds,
      pointerTypes: { ...this.types },
      penSamples: this.stamps.size,
      penEvents: this.penEvents,
      strokes: this.strokeStamps.filter((s) => s.length > 1).length,
      sampleRateHz: dur > 0 ? Math.round((n * 1000) / dur) : 0,
      medianIntervalMs: r2(q(gaps, 0.5)),
      eventRateHz: events ? Math.round(events / this.seconds) : 0,
      coalescedPerEventMax: this.coalMax,
      predictedPerEventMax: this.predMax,
      hoverMoves: this.hover,
      rawUpdates: this.raw,
      pressure: { ...span(this.pressure, 0.01), distinct: this.pressureSet.size },
      tiltX: span(this.tx, 1),
      tiltY: span(this.ty, 1),
      twist: span(this.tw, 1),
      altitudeAngle: span(this.alt, 0.01),
      azimuthAngle: span(this.azi, 0.01),
      latencyMs: { n: lat.length, mean: r2(mean(lat)), p50: r2(q(lat, 0.5)), p95: r2(q(lat, 0.95)), max: r2(lat[lat.length - 1] ?? 0) },
      frameMs: { n: fr.length, mean: r2(mean(fr)), p95: r2(q(fr, 0.95)) },
    };
    this.result = r;
    this.onDone(r);
  }
}
