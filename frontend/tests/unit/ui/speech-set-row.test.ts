import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetState, SetTask } from '@src/media/speech/models';
import { SpeechSetRow } from '@src/ui/speech-set-row';

const WORDS = { about: 'About', remove: 'Remove', confirmTitle: 'Remove', confirmText: 'Remove?' };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const task = (state: SetTask['state'], done = 0): SetTask => ({ state, done, total: 100, error: '' });
const set = (t: SetTask, installed = false): SetState => ({ installed, bytes: 100, files: 2, licence: 'Apache-2.0', task: t });
const sets = (voice: SetState): unknown => ({ sets: { voice, listen: set(task('idle')) } });

type Answer = Response | Error;
let seen: string[] = [];
let answers: Answer[] = [];
let last: Answer = json(sets(set(task('idle'))));

const hidden = (row: SpeechSetRow, sel: string): boolean => (row.root.querySelector(sel) as HTMLElement).hidden;
const settle = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); };
const poll = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(500); };

beforeEach(() => {
  seen = [];
  answers = [];
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    seen.push(`${init?.method ?? 'GET'} ${String(input)}`);
    last = answers.shift() ?? last;
    return last instanceof Error ? Promise.reject(last) : Promise.resolve(last.clone());
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the download row while a download runs', () => {
  it('keeps asking after one status request fails, and shows the download, not a failure', async () => {
    answers = [json(sets(set(task('downloading', 10)))), new TypeError('Failed to fetch'), json(sets(set(task('downloading', 60)))), json(sets(set(task('idle', 100), true)))];
    const row = new SpeechSetRow('voice', WORDS, () => undefined);
    row.start();
    await settle();
    expect(hidden(row, '.fm-ss-prog')).toBe(false);
    await poll();
    // the failed request: the progress stays, no failure is shown, and the asking goes on
    expect(hidden(row, '.fm-ss-prog')).toBe(false);
    expect(hidden(row, '.fm-ss-fail')).toBe(true);
    await poll();
    expect(row.root.querySelector('.fm-ss-progtext')?.textContent).toContain('0.0');
    await poll();
    expect(row.installed).toBe(true);
    expect(seen).toHaveLength(4);
    row.halt();
  });

  it('gives up with the failure after the engine stays silent', async () => {
    answers = [json(sets(set(task('downloading', 10)))), new TypeError('Failed to fetch')];
    const row = new SpeechSetRow('voice', WORDS, () => undefined);
    row.start();
    await settle();
    for (let i = 0; i < 12; i++) await poll();
    expect(hidden(row, '.fm-ss-fail')).toBe(false);
    expect(hidden(row, '.fm-ss-prog')).toBe(true);
    const asked = seen.length;
    expect(asked).toBeGreaterThan(2);
    expect(asked).toBeLessThan(10);
    await poll();
    expect(seen).toHaveLength(asked);
    row.halt();
  });

  it('reads the status again when Download is refused because one is already running', async () => {
    answers = [json(sets(set(task('idle')))), json({ detail: 'These speech models are already being downloaded.' }, 409), json(sets(set(task('downloading', 40))))];
    const row = new SpeechSetRow('voice', WORDS, () => undefined);
    row.start();
    await settle();
    (row.root.querySelector('.fm-ss-get') as HTMLButtonElement).click();
    await settle();
    expect(seen).toEqual(['GET /api/speech-models', 'POST /api/speech-models/voice/download', 'GET /api/speech-models']);
    expect(hidden(row, '.fm-ss-fail')).toBe(true);
    expect(hidden(row, '.fm-ss-prog')).toBe(false);
    row.halt();
  });

  it('still shows a failure of Download that is not a 409', async () => {
    answers = [json(sets(set(task('idle')))), json({ detail: 'The data folder is inside the app.' }, 400)];
    const row = new SpeechSetRow('voice', WORDS, () => undefined);
    row.start();
    await settle();
    (row.root.querySelector('.fm-ss-get') as HTMLButtonElement).click();
    await settle();
    expect(hidden(row, '.fm-ss-fail')).toBe(false);
    expect(row.root.querySelector('.fm-ss-failtext')?.textContent).toBe('The data folder is inside the app.');
    row.halt();
  });
});
