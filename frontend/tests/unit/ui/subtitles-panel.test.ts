import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '@src/engine/engine';
import { content as makeContent } from '@src/engine/model';
import * as ops from '@src/engine/ops';
import { SUBTITLE_DEFAULTS, readSubtitles, subtitleTrack, writeSubtitles } from '@src/engine/subtitles';
import type { Content, Movie } from '@src/engine/types';
import type { AudioEngine } from '@src/media/audio';
import type { HeardWord, ListenOptions } from '@src/media/speech/listen';

interface Call { opts: ListenOptions; resolve: (w: HeardWord[]) => void; reject: (e: unknown) => void }
const calls: Call[] = [];
const features = vi.hoisted(() => ({ speech: true }));

vi.mock('@src/platform', () => ({ platform: { kind: 'desktop', features } }));
vi.mock('@src/media/speech/listen', () => ({
  listen: (_s: Float32Array, _rate: number, opts: ListenOptions): Promise<HeardWord[]> => new Promise((resolve, reject) => { calls.push({ opts, resolve, reject }); }),
}));

import { SubtitlesPanel } from '@src/ui/subtitles-panel';

const set = (installed: boolean): unknown => ({ installed, bytes: 1, files: 1, licence: 'Apache-2.0', task: { state: 'idle', done: 0, total: 0, error: '' } });
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const WORDS: HeardWord[] = [{ text: 'Hello', start: 0, end: 0.4 }, { text: 'there.', start: 0.4, end: 0.9 }];

let engine: Engine;
let fetched: string[] = [];

const root = (): HTMLElement => document.querySelector('.fm-st') as HTMLElement;
const status = (): string => root().querySelector('.fm-st-status')?.textContent ?? '';
const rows = (): HTMLElement[] => Array.from(root().querySelectorAll<HTMLElement>('.fm-st-line'));
const field = (row: HTMLElement, name: string): HTMLInputElement => row.querySelector(`[data-f="${name}"]`) as HTMLInputElement;
const texts = (): string[] => readSubtitles(engine.movie as Movie).lines.map((l) => l.text);
const button = (label: string): HTMLButtonElement => Array.from(root().querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('change'));
}

/** A sound block of two seconds at frame 24, selected, on a movie with one line under it. */
function withSound(): Content {
  const block = makeContent('audio', 24, 48, { name: 'Take', asset: 'a1' });
  engine.run('Sound', (m) => {
    const added = ops.addTrack(m, 0, 'Sound');
    return { movie: ops.placeContent(added.movie, added.track.id, block).movie, select: [block.id] };
  });
  return block;
}

async function open(): Promise<SubtitlesPanel> {
  const audio = { decode: async () => ({ sampleRate: 16000, length: 160000, numberOfChannels: 1, getChannelData: () => new Float32Array(160000).fill(0.1) }) };
  const panel = new SubtitlesPanel(engine, () => audio as unknown as AudioEngine);
  panel.show();
  await flush();
  return panel;
}

async function hear(): Promise<Call> {
  button('Make subtitles from this sound').click();
  await flush();
  return calls[calls.length - 1];
}

beforeEach(() => {
  calls.length = 0;
  fetched = [];
  features.speech = true;
  document.body.innerHTML = '';
  localStorage.clear();
  // the test window has no Option constructor
  vi.stubGlobal('Option', function Option(text: string, value: string): HTMLOptionElement {
    const o = document.createElement('option');
    o.text = text;
    o.value = value;
    return o;
  });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    return new Response(JSON.stringify({ sets: { voice: set(true), listen: set(true) } }), { status: 200 });
  });
  engine = new Engine();
  engine.create({ name: 'First', width: 1280, height: 720, fps: 24, seconds: 10 });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Make subtitles from this sound', () => {
  it('writes the heard lines under the sound block', async () => {
    withSound();
    await open();
    const call = await hear();
    call.resolve(WORDS);
    await flush();
    expect(readSubtitles(engine.movie as Movie).lines).toEqual([{ start: 1, end: 1.917, text: 'Hello there.' }]);
    expect(status()).toBe('1 line added.');
  });

  it('stops when another movie is opened, and writes nothing into that movie', async () => {
    withSound();
    await open();
    const call = await hear();
    engine.create({ name: 'Second', width: 1280, height: 720, fps: 24, seconds: 10 });
    expect(call.opts.signal?.aborted).toBe(true);
    call.resolve(WORDS);
    await flush();
    expect(engine.movie?.name).toBe('Second');
    expect(subtitleTrack(engine.movie as Movie)).toBeNull();
    expect(status()).toBe('Another movie was opened, so no lines were added.');
  });

  it('writes nothing when the block was moved while it was heard', async () => {
    const block = withSound();
    await open();
    const call = await hear();
    engine.run('Move', (m) => ops.updateContent(m, block.id, (c) => ({ ...c, start: 120 })));
    call.resolve(WORDS);
    await flush();
    expect(subtitleTrack(engine.movie as Movie)).toBeNull();
    expect(status()).toBe('The sound block was changed or removed while it was heard, so no lines were added.');
  });

  it('writes nothing when the block was deleted while it was heard', async () => {
    const block = withSound();
    await open();
    const call = await hear();
    engine.run('Delete', (m) => ops.deleteContent(m, [block.id]));
    call.resolve(WORDS);
    await flush();
    expect(subtitleTrack(engine.movie as Movie)).toBeNull();
    expect(status()).toBe('The sound block was changed or removed while it was heard, so no lines were added.');
  });

  it('still writes when something else in the movie changed', async () => {
    withSound();
    await open();
    const call = await hear();
    engine.run('Background', (m) => ({ ...m, background: '#101010' }));
    call.resolve(WORDS);
    await flush();
    expect(texts()).toEqual(['Hello there.']);
  });

  it('refuses a frozen block and one that plays backward with a sentence, before listening', async () => {
    const block = withSound();
    await open();
    engine.run('Freeze', (m) => ops.updateContent(m, block.id, (c) => ({ ...c, speed: 0 })));
    await hear();
    expect(calls).toHaveLength(0);
    expect(status()).toBe('This sound block is frozen, so it plays no words to hear.');
    engine.run('Reverse', (m) => ops.updateContent(m, block.id, (c) => ({ ...c, speed: 1, reverse: true })));
    await hear();
    expect(calls).toHaveLength(0);
    expect(status()).toBe('This sound block plays backward, so its words cannot be heard.');
  });

  it('shows a figure when there is one and a working bar when there is none', async () => {
    withSound();
    await open();
    const call = await hear();
    const meter = root().querySelector('.fm-st-meter') as HTMLElement;
    call.opts.onProgress?.(0.3);
    expect(status()).toBe('Listening: 30%');
    expect(meter.getAttribute('aria-valuenow')).toBe('30');
    expect(meter.classList.contains('is-unknown')).toBe(false);
    call.opts.onProgress?.(null);
    expect(status()).toBe('Listening...');
    expect(meter.hasAttribute('aria-valuenow')).toBe(false);
    expect(meter.classList.contains('is-unknown')).toBe(true);
    call.resolve([]);
    await flush();
  });
});

describe('the lines list', () => {
  const lines = [{ start: 1, end: 3, text: 'One' }, { start: 4, end: 5, text: 'Two' }];
  const lock = (): void => { engine.run('Lock', (m) => ({ ...m, tracks: m.tracks.map((t) => (t.subtitles ? { ...t, locked: true as const } : t)) })); };

  it('focuses the line under the playhead instead of adding one over it', async () => {
    engine.run('Lines', (m) => writeSubtitles(m, lines, SUBTITLE_DEFAULTS));
    await open();
    for (const frame of [24, 48]) {
      engine.seek(frame);
      button('Add a line at the playhead').click();
      expect(readSubtitles(engine.movie as Movie).lines).toEqual(lines);
      expect(document.activeElement).toBe(field(rows()[0], 'text'));
      (document.activeElement as HTMLElement).blur();
    }
  });

  it('adds an empty line where the playhead is clear, and focuses it', async () => {
    engine.run('Lines', (m) => writeSubtitles(m, lines, SUBTITLE_DEFAULTS));
    await open();
    engine.seek(144);
    button('Add a line at the playhead').click();
    expect(texts()).toEqual(['One', 'Two', '']);
    expect(document.activeElement).toBe(field(rows()[2], 'text'));
  });

  it('shows the kept time, not the typed one, when a time is held by its neighbour', async () => {
    engine.run('Lines', (m) => writeSubtitles(m, lines, SUBTITLE_DEFAULTS));
    await open();
    const end = field(rows()[0], 'end');
    end.focus();
    type(end, '9');
    expect(readSubtitles(engine.movie as Movie).lines[0]).toEqual({ start: 1, end: 4, text: 'One' });
    expect(end.value).toBe('4.0');
  });

  it('puts the fields back to what the movie holds when an edit is refused', async () => {
    engine.run('Lines', (m) => writeSubtitles(m, lines, SUBTITLE_DEFAULTS));
    lock();
    await open();
    const row = rows()[0];
    for (const [name, typed, kept] of [['start', '2', '1.0'], ['end', '3.5', '3.0'], ['text', 'Changed', 'One']] as const) {
      const input = field(row, name);
      input.focus();
      type(input, typed);
      expect(input.value).toBe(kept);
    }
    expect(readSubtitles(engine.movie as Movie).lines).toEqual(lines);
  });
});

describe('importing a subtitles file', () => {
  const pick = async (file: File): Promise<void> => {
    const input = root().querySelector('.fm-st-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flush();
  };

  it('refuses a file over 5 MB without reading it', async () => {
    await open();
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.srt');
    const read = vi.spyOn(big, 'text');
    await pick(big);
    expect(read).not.toHaveBeenCalled();
    expect(status()).toBe('That file is larger than 5 MB, so it was not read as a subtitles file.');
    expect(subtitleTrack(engine.movie as Movie)).toBeNull();
  });

  it('reads a file of ordinary size', async () => {
    await open();
    await pick(new File(['1\n00:00:01,000 --> 00:00:02,000\nHello\n'], 'small.srt'));
    expect(texts()).toEqual(['Hello']);
    expect(status()).toBe('1 line imported.');
  });
});

describe('where the engine has no speech routes', () => {
  it('leaves the From sound part off the card, asks the engine nothing, and keeps typed lines and files', async () => {
    features.speech = false;
    await open();
    expect(Array.from(root().querySelectorAll('.fm-st-sec')).map((n) => n.textContent)).toEqual(['Style', 'Lines', 'File']);
    expect(button('Make subtitles from this sound')).toBeUndefined();
    expect(root().querySelector('.fm-ss')).toBeNull();
    expect(fetched).toEqual([]);
    button('Add a line at the playhead').click();
    expect(texts()).toEqual(['']);
    expect(root().querySelector('.fm-st-status')).not.toBeNull();
  });

  it('has the From sound part on a computer', async () => {
    await open();
    expect(Array.from(root().querySelectorAll('.fm-st-sec')).map((n) => n.textContent)).toEqual(['Style', 'Lines', 'From sound', 'File']);
    expect(fetched).toEqual(['/api/speech-models']);
  });
});
