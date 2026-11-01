// Sound-only export: the movie's mix (or one file per track, "stems") as WAV, AAC in M4A, or Opus in WebM / OGG.
// The sound comes from AudioEngine.mixdown, the very graph playback builds, so the file equals what is heard.
import {
  AudioSample, AudioSampleSource, BufferTarget, Mp4OutputFormat, OggOutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, canEncodeAudio,
  type AudioCodec,
} from 'mediabunny';
import { zipSync } from 'fflate';
import type { Movie } from '../engine/types';
import type { AudioEngine } from '../media/audio';
import type { ExportResult } from './types';

export type AudioFormat = 'wav16' | 'wav24' | 'm4a' | 'webm-opus' | 'ogg-opus' | 'mp3';

export interface AudioExportOptions {
  format: AudioFormat;
  /** Movie frames [from, to). */
  from: number;
  to: number;
  /** One file per track, zipped, instead of one mix. */
  stems: boolean;
  /** WAV only: 44100 or 48000 (the lossy formats use 48000). */
  sampleRate: number;
  /** Bring the mix (each stem, with stems) to this integrated loudness in LUFS. */
  lufs?: number;
  /** MP3 only: 96 to 320 kilobits per second (default 192). */
  mp3Kbps?: number;
}

/** MP3 has no encoder in the browser: the WAV mixdown goes to the engine, whose ffmpeg (libmp3lame) sends the MP3 back. */
async function encodeMp3(buf: AudioBuffer, kbps: number): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const wav = wavBytes(chs, buf.sampleRate, 16);
  let res: Response;
  try {
    res = await fetch(`/api/audio-encode/mp3?kbps=${kbps}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: new Blob([wav.slice()], { type: 'audio/wav' }) });
  } catch (e) { throw new Error('MP3 needs the formmorpheus engine and its ffmpeg, and the engine is not answering.', { cause: e }); }
  if (!res.ok) {
    let detail = '';
    try { const b = (await res.json()) as { detail?: unknown }; if (typeof b?.detail === 'string') detail = b.detail; } catch { /* not JSON */ }
    throw new Error(detail || `The engine could not make the MP3 (${res.status}).`);
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: 'audio/mpeg', ext: 'mp3' };
}

function normNote(audio: AudioEngine, lufs: number | undefined, warnings: string[]): void {
  const r = audio.lastNormalize;
  if (lufs === undefined || !r) return;
  if (!Number.isFinite(r.measured)) warnings.push('The sound is too quiet to measure, so it was not normalized.');
  else if (r.limited) warnings.push(`Normalizing to ${lufs} LUFS was held back so the peaks stay under -1 dBFS (measured ${r.measured.toFixed(1)} LUFS).`);
}

export const AUDIO_FORMATS: { id: AudioFormat; label: string; ext: string }[] = [
  { id: 'wav16', label: 'WAV 16-bit', ext: 'wav' }, { id: 'wav24', label: 'WAV 24-bit', ext: 'wav' },
  { id: 'm4a', label: 'AAC in M4A', ext: 'm4a' }, { id: 'mp3', label: 'MP3 (engine ffmpeg)', ext: 'mp3' }, { id: 'webm-opus', label: 'Opus in WebM', ext: 'webm' }, { id: 'ogg-opus', label: 'Opus in OGG', ext: 'ogg' },
];

const safe = (s: string): string => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim() || 'sound';

/** PCM WAV bytes of planar channels. */
export function wavBytes(chs: Float32Array[], sampleRate: number, bits: 16 | 24): Uint8Array {
  const ch = chs.length, n = chs[0]?.length ?? 0, bps = bits / 8;
  const data = n * ch * bps;
  // the RIFF sizes are 32 bit: a larger sound would write a file that reads back short, so it is refused with a reason
  if (data + 36 > 0xffffffff) throw new Error('This sound is longer than a WAV file can hold (4 GB). Export a shorter range, one track at a time, or use AAC or Opus.');
  const out = new Uint8Array(44 + data);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + data, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * ch * bps, true); dv.setUint16(32, ch * bps, true); dv.setUint16(34, bits, true);
  str(36, 'data'); dv.setUint32(40, data, true);
  let at = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chs[c][i]));
      if (bits === 16) { dv.setInt16(at, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true); at += 2; } else {
        const s = Math.round(v < 0 ? v * 0x800000 : v * 0x7fffff);
        dv.setUint8(at, s & 255); dv.setUint8(at + 1, (s >> 8) & 255); dv.setUint8(at + 2, (s >> 16) & 255); at += 3;
      }
    }
  }
  return out;
}

async function encodeLossy(buf: AudioBuffer, format: AudioFormat, warnings: string[]): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  const rate = buf.sampleRate, channels = buf.numberOfChannels;
  let codec: AudioCodec = 'opus';
  let container: Mp4OutputFormat | WebMOutputFormat | OggOutputFormat;
  let mime: string, ext: string;
  if (format === 'm4a') {
    container = new Mp4OutputFormat();
    ext = 'm4a'; mime = 'audio/mp4';
    if (await canEncodeAudio('aac', { numberOfChannels: channels, sampleRate: rate, bitrate: 192000 })) codec = 'aac';
    else warnings.push('This browser has no AAC encoder, so the M4A holds Opus sound. Use WAV or Opus in WebM for a plain file.');
  } else if (format === 'webm-opus') { container = new WebMOutputFormat(); ext = 'webm'; mime = 'audio/webm'; } else { container = new OggOutputFormat(); ext = 'ogg'; mime = 'audio/ogg'; }
  if (!(await canEncodeAudio(codec, { numberOfChannels: channels, sampleRate: rate, bitrate: 192000 }))) throw new Error('This browser cannot encode that sound format.');
  const target = new BufferTarget();
  const output = new Output({ format: container, target });
  const source = new AudioSampleSource({ codec, bitrate: QUALITY_HIGH });
  output.addAudioTrack(source);
  await output.start();
  const per = Math.floor((48000 * 5) / channels);
  for (let at = 0; at < buf.length; at += per) {
    const n = Math.min(per, buf.length - at);
    const data = new Float32Array(channels * n);
    for (let c = 0; c < channels; c++) data.set(buf.getChannelData(c).subarray(at, at + n), c * n);
    const sample = new AudioSample({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: channels, timestamp: at / rate, data });
    try { await source.add(sample); } finally { sample.close(); }
  }
  source.close();
  await output.finalize();
  if (!target.buffer) throw new Error('The encoder produced no data.');
  return { bytes: new Uint8Array(target.buffer), mime, ext };
}

async function encodeOne(buf: AudioBuffer, o: AudioExportOptions, warnings: string[]): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  if (o.format === 'wav16' || o.format === 'wav24') {
    const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    return { bytes: wavBytes(chs, buf.sampleRate, o.format === 'wav24' ? 24 : 16), mime: 'audio/wav', ext: 'wav' };
  }
  if (o.format === 'mp3') return encodeMp3(buf, o.mp3Kbps ?? 192);
  return encodeLossy(buf, o.format, warnings);
}

/** The movie's sound as one file, or as a zip of one file per track. Rejects when the movie has no sound in the range. */
export async function exportAudio(audio: AudioEngine, movie: Movie, opts: AudioExportOptions, onProgress?: (done: number, total: number) => void): Promise<ExportResult> {
  const warnings: string[] = [];
  const rate = opts.format === 'wav16' || opts.format === 'wav24' ? (opts.sampleRate === 44100 ? 44100 : 48000) : 48000;
  const base = safe(movie.name);
  if (!opts.stems) {
    onProgress?.(0, 1);
    const buf = await audio.mixdown(movie, opts.from, opts.to, rate, undefined, opts.lufs);
    if (!buf) throw new Error('There is no sound in that range.');
    normNote(audio, opts.lufs, warnings);
    const r = await encodeOne(buf, opts, warnings);
    onProgress?.(1, 1);
    return { blob: new Blob([r.bytes.slice()], { type: r.mime }), name: `${base}.${r.ext}`, mime: r.mime, warnings };
  }
  const tracks = audio.stemTracks(movie);
  if (!tracks.length) throw new Error('There is no sound to export.');
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  let n = 0;
  for (const tr of tracks) {
    onProgress?.(n, tracks.length);
    const buf = await audio.mixdown(movie, opts.from, opts.to, rate, tr.id, opts.lufs);
    n++;
    if (!buf) continue;
    normNote(audio, opts.lufs, warnings);
    const r = await encodeOne(buf, opts, warnings);
    let name = safe(tr.name), k = 2;
    while (used.has(name)) name = `${safe(tr.name)} ${k++}`;
    used.add(name);
    files[`${base}/${String(used.size).padStart(2, '0')} ${name}.${r.ext}`] = r.bytes;
  }
  if (!used.size) throw new Error('There is no sound in that range.');
  onProgress?.(tracks.length, tracks.length);
  const zip = zipSync(files, { level: 0 });
  return { blob: new Blob([zip.slice()], { type: 'application/zip' }), name: `${base} stems.zip`, mime: 'application/zip', warnings: [...new Set(warnings)] };
}
