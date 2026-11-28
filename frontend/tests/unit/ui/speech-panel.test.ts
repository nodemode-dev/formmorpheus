import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '@src/engine/engine';
import { SUBTITLE_DEFAULTS, readSubtitles, writeSubtitles } from '@src/engine/subtitles';
import type { AudioEngine } from '@src/media/audio';
import type { SpeakOptions, Spoken } from '@src/media/speech/voice';
import { VOICE_TRACK_NAME } from '@src/ui/speech-logic';

interface Call { text: string; opts: SpeakOptions; resolve: (s: Spoken) => void; reject: (e: unknown) => void }
const calls: Call[] = [];
const ended = vi.fn();

vi.mock('@src/media/speech/voice', async (actual) => ({
  ...(await actual<typeof import('@src/media/speech/voice')>()),
  endVoice: () => ended(),
  speak: (text: string, opts: SpeakOptions): Promise<Spoken> => new Promise((resolve, reject) => { calls.push({ text, opts, resolve, reject }); }),
}));

import { SpeechPanel } from '@src/ui/speech-panel';

const set = (installed: boolean): unknown => ({ installed, bytes: 1, files: 1, licence: 'Apache-2.0', task: { state: 'idle', done: 0, total: 0, error: '' } });
const part = (text: string, n: number): Spoken['sentences'][number] => ({ text, samples: new Float32Array(n).fill(0.1), seconds: n / 24000 });
const spoken = (...sentences: Spoken['sentences']): Spoken => ({ sampleRate: 24000, sentences, unknown: [] });
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

let engine: Engine;
let voiceInstalled = true;

const root = (): HTMLElement => document.querySelector('.fm-sp') as HTMLElement;
const status = (): string => root().querySelector('.fm-sp-status')?.textContent ?? '';
const voiceTrack = (): unknown => engine.movie?.tracks.find((t) => t.name === VOICE_TRACK_NAME);

async function generate(text: string): Promise<Call> {
  const area = root().querySelector('.fm-sp-text') as HTMLTextAreaElement;
  area.value = text;
  area.dispatchEvent(new Event('input'));
  (root().querySelector('.fm-sp-go') as HTMLButtonElement).click();
  await flush();
  return calls[calls.length - 1];
}

async function open(): Promise<SpeechPanel> {
  const panel = new SpeechPanel(engine, () => ({ decode: async () => null }) as unknown as AudioEngine);
  panel.show();
  await flush();
  return panel;
}

beforeEach(() => {
  calls.length = 0;
  ended.mockClear();
  voiceInstalled = true;
  document.body.innerHTML = '';
  localStorage.clear();
  // the test window has no Option constructor
  vi.stubGlobal('Option', function Option(text: string, value: string): HTMLOptionElement {
    const o = document.createElement('option');
    o.text = text;
    o.value = value;
    return o;
  });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ sets: { voice: set(voiceInstalled), listen: set(false) } }), { status: 200 }));
  engine = new Engine();
  engine.create({ name: 'First', width: 1280, height: 720, fps: 24, seconds: 4 });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Generate on the built-in voice', () => {
  it('lands the voice and its lines as one undo step', async () => {
    await open();
    const call = await generate('Hello there. Again.');
    call.resolve(spoken(part('Hello there.', 24000), part('Again.', 12000)));
    await flush();
    expect(voiceTrack()).toBeDefined();
    expect(readSubtitles(engine.movie!).lines.map((l) => l.text)).toEqual(['Hello there.', 'Again.']);
    expect(status()).toBe('Voice added: 1.8 s, with subtitles.');
    engine.undo();
    expect(voiceTrack()).toBeUndefined();
    expect(readSubtitles(engine.movie!).lines).toEqual([]);
  });

  it('stops the run when another movie is opened, and adds nothing to that movie', async () => {
    await open();
    const call = await generate('Hello there.');
    engine.create({ name: 'Second', width: 1280, height: 720, fps: 24, seconds: 4 });
    expect(call.opts.signal?.aborted).toBe(true);
    // a voice that comes back all the same must not land in the movie now open
    call.resolve(spoken(part('Hello there.', 24000)));
    await flush();
    expect(engine.movie?.name).toBe('Second');
    expect(voiceTrack()).toBeUndefined();
    expect(engine.assets.size).toBe(0);
    expect(status()).toBe('Another movie was opened, so the voice was not added.');
  });

  it('says the same when the run ends with its cancel after another movie was opened', async () => {
    await open();
    const call = await generate('Hello there.');
    engine.create({ name: 'Second', width: 1280, height: 720, fps: 24, seconds: 4 });
    call.reject(new DOMException('Speaking was cancelled', 'AbortError'));
    await flush();
    expect(voiceTrack()).toBeUndefined();
    expect(status()).toBe('Another movie was opened, so the voice was not added.');
  });

  it('does not stop a run for a change to the movie that is open', async () => {
    await open();
    const call = await generate('Hello there.');
    engine.run('Rename', (m) => ({ ...m, background: '#101010' }));
    expect(call.opts.signal?.aborted).toBe(false);
    call.resolve(spoken(part('Hello there.', 24000)));
    await flush();
    expect(voiceTrack()).toBeDefined();
  });

  it('adds nothing for text with nothing speakable, and says so', async () => {
    await open();
    for (const text of ['...', 'Привет']) {
      const call = await generate(text);
      call.resolve(spoken(part(text, 0)));
      await flush();
      expect(voiceTrack()).toBeUndefined();
      expect(engine.assets.size).toBe(0);
      expect(status()).toBe('There are no words to speak in that text.');
    }
  });

  it('speaks the part that can be spoken, with lines for that part only', async () => {
    await open();
    const call = await generate('Привет. Hello there.');
    call.resolve(spoken(part('Привет.', 0), part('Hello there.', 24000)));
    await flush();
    expect(status()).toBe('Voice added: 1.0 s, with subtitles.');
    expect(readSubtitles(engine.movie!).lines).toEqual([{ start: 0, end: 1, text: 'Hello there.' }]);
  });

  it('keeps a finished voice when the Subtitles track is locked, and says no lines were added', async () => {
    engine.run('Lines', (m) => writeSubtitles(m, [{ start: 0, end: 1, text: 'Kept.' }], SUBTITLE_DEFAULTS));
    engine.run('Lock', (m) => ({ ...m, tracks: m.tracks.map((t) => (t.subtitles ? { ...t, locked: true as const } : t)) }));
    await open();
    const call = await generate('Hello there.');
    call.resolve(spoken(part('Hello there.', 24000)));
    await flush();
    expect(voiceTrack()).toBeDefined();
    expect(engine.assets.size).toBe(1);
    expect(readSubtitles(engine.movie!).lines.map((l) => l.text)).toEqual(['Kept.']);
    expect(status()).toBe('Voice added: 1.0 s. The Subtitles track is locked, so no lines were added.');
  });

  it('ends the voice worker once the voice files are gone', async () => {
    await open();
    expect(ended).not.toHaveBeenCalled();
    voiceInstalled = false;
    await open();
    expect(ended).toHaveBeenCalled();
  });
});
