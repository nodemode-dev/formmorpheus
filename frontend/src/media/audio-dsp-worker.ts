// Worker side of the audio effect chain: runs the pure DSP of audio-dsp.ts off the page's thread. The same
// applyFx the page would run inline, so a result from here is sample for sample the one the page computes.
import { applyFx } from './audio-dsp';
import type { AudioFx } from '../engine/audio-fx';

export interface FxJob { id: number; chs: Float32Array[]; sr: number; fx: AudioFx }
export interface FxDone { id: number; chs: Float32Array[] | null }

const ctx = self as unknown as { postMessage(m: FxDone, t?: Transferable[]): void; onmessage: ((e: MessageEvent<FxJob>) => void) | null };

ctx.onmessage = (e: MessageEvent<FxJob>): void => {
  const { id, chs, sr, fx } = e.data;
  try {
    const out = applyFx(chs, sr, fx);
    ctx.postMessage({ id, chs: out }, out.map((c) => c.buffer as ArrayBuffer));
  } catch {
    ctx.postMessage({ id, chs: null });
  }
};
