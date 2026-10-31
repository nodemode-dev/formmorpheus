// What the Flipbook tools (exposure sheet, reference underlay) borrow from the app: the engine, and the sound peaks.
// Set once by the app; the tools work without it (the sheet then has no waveform).
import type { Engine } from '../engine/engine';
import type { Peaks } from '../media/audio';

export const flipServices: {
  engine: Engine | null;
  peaks: (assetId: string) => Peaks | null;
  decode: (assetId: string) => Promise<unknown>;
} = { engine: null, peaks: () => null, decode: () => Promise.resolve() };

export function setFlipServices(engine: Engine, peaks: (assetId: string) => Peaks | null, decode: (assetId: string) => Promise<unknown>): void {
  flipServices.engine = engine;
  flipServices.peaks = peaks;
  flipServices.decode = decode;
}
