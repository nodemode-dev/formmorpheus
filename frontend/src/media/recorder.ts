// Microphone capture for voice-overs. Samples are taken straight from the input with an AudioWorklet
// (ScriptProcessor where a worklet cannot load) into Float32 chunks and written as 16-bit PCM WAV.
// WAV is stored, not Opus in WebM: it is exact (a take can be cut to the sample and lines up with the
// movie), every webview decodes it (a WebM Opus recorder is missing in some desktop webviews), the engine's
// ffmpeg and the exporter read it without a codec, and a voice take is small (mono 48 kHz is about 5.5 MB a minute).

export interface InputDevice { id: string; label: string }

export class MicError extends Error {
  constructor(readonly code: 'denied' | 'none' | 'busy' | 'insecure' | 'other', message: string) {
    super(message);
  }
}

export function micError(e: unknown): MicError {
  if (e instanceof MicError) return e;
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (!navigator.mediaDevices?.getUserMedia) return new MicError('insecure', 'This page cannot reach a microphone. Recording needs the desktop app or a secure (https or localhost) page.');
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new MicError('denied', 'FormMorpheus is not allowed to use the microphone. Allow microphone access for FormMorpheus in your system settings (or the browser’s site settings), then press Try again.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return new MicError('none', 'No microphone was found. Plug one in or pick another input, then press Try again.');
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return new MicError('busy', 'The microphone is busy or unavailable: another app may be using it. Close it, then press Try again.');
  return new MicError('other', `The microphone could not be opened${e instanceof Error && e.message ? `: ${e.message}` : '.'}`);
}

/** Inputs the system offers; names appear only after the microphone was allowed once. */
export async function listInputs(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  const out: InputDevice[] = [];
  for (const d of all) {
    if (d.kind !== 'audioinput') continue;
    out.push({ id: d.deviceId, label: d.label || `Input ${out.length + 1}` });
  }
  return out;
}

const WORKLET = `class Cap extends AudioWorkletProcessor {
  constructor() { super(); this.n = 0; this.buf = null; this.ch = 0; }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const ch = Math.min(2, inp.length);
    if (!this.buf || this.ch !== ch) { this.ch = ch; this.buf = []; for (let c = 0; c < ch; c++) this.buf.push(new Float32Array(2048)); this.n = 0; }
    const len = inp[0].length;
    for (let c = 0; c < ch; c++) this.buf[c].set(inp[c], this.n);
    this.n += len;
    if (this.n + 128 > 2048) { this.port.postMessage(this.buf.map((b) => b.slice(0, this.n))); this.n = 0; }
    return true;
  }
}
registerProcessor('fm-capture', Cap);`;

export interface Take {
  channels: Float32Array[];
  sampleRate: number;
  /** Seconds of the capture. */
  seconds: number;
}

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sink: AudioNode | null = null;
  private chunks: Float32Array[][] = [];
  private capturing = false;
  private frames = 0;
  private scratch: Float32Array<ArrayBuffer> = new Float32Array(1024);
  /** Peak since the last call to `level`, held for the meter. */
  private peakHold = 0;
  deviceId = '';

  get sampleRate(): number { return this.ctx?.sampleRate ?? 48000; }
  get open(): boolean { return this.ctx !== null; }
  get isCapturing(): boolean { return this.capturing; }
  /** Seconds captured since `start`. */
  get seconds(): number { return this.frames / this.sampleRate; }

  /** Seconds between a sound leaving the speakers and it being heard back in a take: input path plus output path. */
  latency(): number {
    const c = this.ctx;
    if (!c) return 0;
    const out = (c as AudioContext & { outputLatency?: number }).outputLatency || c.baseLatency || 0;
    const inp = (this.stream?.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined)?.latency ?? 0;
    return Math.min(0.5, Math.max(0, out + inp));
  }

  async openInput(deviceId = ''): Promise<void> {
    this.close();
    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new MicError('insecure', '');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          // a voice-over is kept as spoken: no echo cancelling, noise gate or automatic level
          echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 },
        },
      });
    } catch (e) {
      throw micError(e);
    }
    this.stream = stream;
    this.deviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(ctx.destination);
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      const node = new AudioWorkletNode(ctx, 'fm-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'max' });
      node.port.onmessage = (ev: MessageEvent<Float32Array[]>) => this.take(ev.data);
      this.source.connect(node);
      node.connect(mute);
      this.sink = node;
    } catch {
      const sp = ctx.createScriptProcessor(2048, 2, 2);
      sp.onaudioprocess = (ev) => {
        const n = ev.inputBuffer.numberOfChannels;
        const chs: Float32Array[] = [];
        for (let c = 0; c < Math.min(2, n); c++) chs.push(ev.inputBuffer.getChannelData(c).slice());
        this.take(chs);
      };
      this.source.connect(sp);
      sp.connect(mute);
      this.sink = sp;
    }
  }

  private take(chs: Float32Array[]): void {
    if (!this.capturing || !chs.length) return;
    this.chunks.push(chs);
    this.frames += chs[0].length;
  }

  /** Peak (0..1) of the input since the last call, and whether it reached full scale. */
  level(): { peak: number; clip: boolean } {
    const a = this.analyser;
    if (!a) return { peak: 0, clip: false };
    if (this.scratch.length !== a.fftSize) this.scratch = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(this.scratch);
    let p = 0;
    for (let i = 0; i < this.scratch.length; i++) { const v = Math.abs(this.scratch[i]); if (v > p) p = v; }
    this.peakHold = Math.max(p, this.peakHold * 0.92);
    return { peak: Math.min(1, this.peakHold), clip: p >= 0.99 };
  }

  start(): void {
    this.chunks = [];
    this.frames = 0;
    this.capturing = true;
  }

  /** Ends the capture and returns what was heard, or null when nothing was captured. */
  finish(): Take | null {
    this.capturing = false;
    const chunks = this.chunks;
    this.chunks = [];
    const total = this.frames;
    this.frames = 0;
    if (!chunks.length || total === 0) return null;
    const nch = chunks[0].length;
    const channels: Float32Array[] = [];
    for (let c = 0; c < nch; c++) {
      const out = new Float32Array(total);
      let at = 0;
      for (const ch of chunks) { const part = ch[Math.min(c, ch.length - 1)]; out.set(part, at); at += part.length; }
      channels.push(out);
    }
    return { channels, sampleRate: this.sampleRate, seconds: total / this.sampleRate };
  }

  cancel(): void {
    this.capturing = false;
    this.chunks = [];
    this.frames = 0;
  }

  /** A short tick for the count-in. */
  beep(high: boolean): void {
    const c = this.ctx;
    if (!c) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    const t = c.currentTime;
    osc.frequency.value = high ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  close(): void {
    this.capturing = false;
    this.chunks = [];
    this.frames = 0;
    this.sink?.disconnect();
    this.source?.disconnect();
    if (this.sink instanceof AudioWorkletNode) this.sink.port.onmessage = null;
    this.sink = null;
    this.source = null;
    this.analyser = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    const c = this.ctx;
    this.ctx = null;
    if (c) void c.close().catch(() => {});
  }
}

/** The part of a take from `from` to `to` seconds (clamped), as new arrays. */
export function cut(take: Take, from: number, to: number): Take {
  const a = Math.max(0, Math.round(from * take.sampleRate));
  const b = Math.min(take.channels[0].length, Math.max(a, Math.round(to * take.sampleRate)));
  const channels = take.channels.map((c) => c.slice(a, b));
  return { channels, sampleRate: take.sampleRate, seconds: (b - a) / take.sampleRate };
}

/** 16-bit PCM WAV, channels interleaved. */
export function encodeWav(take: Take): Blob {
  const nch = take.channels.length;
  const n = take.channels[0]?.length ?? 0;
  const bytes = new ArrayBuffer(44 + n * nch * 2);
  const dv = new DataView(bytes);
  const str = (at: number, s: string): void => { for (let i = 0; i < s.length; i++) dv.setUint8(at + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * nch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, nch, true);
  dv.setUint32(24, take.sampleRate, true);
  dv.setUint32(28, take.sampleRate * nch * 2, true);
  dv.setUint16(32, nch * 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, n * nch * 2, true);
  let at = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-1, Math.min(1, take.channels[c][i]));
      dv.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      at += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
