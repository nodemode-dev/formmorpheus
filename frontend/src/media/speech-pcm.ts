// Prepares a block's sound for listening: the whole asset as a 16 kHz mono 16-bit WAV, the format the
// speech model reads. Times a listening gives are seconds inside the asset.

import { Input, BlobSource, ALL_FORMATS, AudioBufferSink } from 'mediabunny';
import type { Engine } from '../engine/engine';
import type { TimedLine } from '../engine/subtitles';
import { locate } from '../engine/model';
import { encodeWav } from './recorder';

export interface SoundForSpeech { wav: Blob; seconds: number; lines(heard: TimedLine[]): TimedLine[] }

const RATE = 16000;

/** Decodes with the browser first, then with the demuxer for containers it refuses (the app's own order). */
async function decode(blob: Blob, ctx: AudioContext): Promise<AudioBuffer | null> {
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    /* fall through to the demuxer */
  }
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    const parts: AudioBuffer[] = [];
    let frames = 0;
    for await (const w of new AudioBufferSink(track).buffers()) { parts.push(w.buffer); frames += w.buffer.length; }
    if (!parts.length) return null;
    const first = parts[0];
    const out = ctx.createBuffer(first.numberOfChannels, frames, first.sampleRate);
    let at = 0;
    for (const p of parts) {
      for (let ch = 0; ch < out.numberOfChannels; ch++) out.getChannelData(ch).set(p.getChannelData(Math.min(ch, p.numberOfChannels - 1)), at);
      at += p.length;
    }
    return out;
  } finally {
    input.dispose();
  }
}

/** Average of all channels into one new array. */
function mixDown(buf: AudioBuffer): Float32Array {
  const n = buf.length, nch = buf.numberOfChannels;
  const out = new Float32Array(n);
  for (let c = 0; c < nch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i];
  }
  if (nch > 1) for (let i = 0; i < n; i++) out[i] /= nch;
  return out;
}

/** Linear resampling, for runtimes without OfflineAudioContext. */
function linear(src: Float32Array, from: number): Float32Array {
  const n = Math.max(1, Math.round(src.length * RATE / from));
  const out = new Float32Array(n);
  const step = from / RATE;
  for (let i = 0; i < n; i++) {
    const p = i * step, j = Math.floor(p), f = p - j;
    const a = src[Math.min(j, src.length - 1)], b = src[Math.min(j + 1, src.length - 1)];
    out[i] = a + (b - a) * f;
  }
  return out;
}

/** The browser's own resampler through an offline render of the mono mix; null when it fails. */
async function viaOffline(mono: Float32Array, from: number): Promise<Float32Array | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  try {
    const n = Math.max(1, Math.round(mono.length * RATE / from));
    const off = new OfflineAudioContext(1, n, RATE);
    const b = off.createBuffer(1, mono.length, from);
    b.getChannelData(0).set(mono);
    const src = off.createBufferSource();
    src.buffer = b;
    src.connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
  } catch {
    return null;
  }
}

export async function soundForSpeech(engine: Engine, contentId: string): Promise<SoundForSpeech | null> {
  const m = engine.movie;
  if (!m) return null;
  const c = locate(m, contentId)?.content;
  if (!c || !c.asset) return null;
  const a = m.assets[c.asset];
  if (!a) return null;
  if (c.kind === 'video' ? !a.hasAudio : c.kind !== 'audio') return null;
  const blob = engine.assets.get(c.asset);
  if (!blob) return null;
  if (typeof AudioContext === 'undefined') return null;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    const buf = await decode(blob, ctx);
    if (!buf || buf.length === 0 || !(buf.sampleRate > 0)) return null;
    const mono = mixDown(buf);
    const pcm = buf.sampleRate === RATE ? mono : (await viaOffline(mono, buf.sampleRate)) ?? linear(mono, buf.sampleRate);
    // encodeWav writes every sample in one pass into a single preallocated buffer
    const wav = encodeWav({ channels: [pcm], sampleRate: RATE, seconds: pcm.length / RATE });
    return { wav, seconds: buf.length / buf.sampleRate, lines: (heard) => heard };
  } catch {
    return null;
  } finally {
    if (ctx) void ctx.close().catch(() => undefined);
  }
}
