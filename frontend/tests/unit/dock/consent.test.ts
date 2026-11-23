import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConsentChoice, ConsentHost, ConsentRequest, StoredChoiceState } from '@src/dock/adapter';
import { Consent } from '@src/dock/consent';

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

interface Rig { consent: Consent; add(r: ConsentRequest): void; answer: ReturnType<typeof vi.fn>; changes: boolean[] }

function rig(stored?: () => Promise<StoredChoiceState>): Rig {
  let add: (r: ConsentRequest) => void = () => undefined;
  const answer = vi.fn(async (_id: string, _choice: ConsentChoice): Promise<void> => undefined);
  const host: ConsentHost = {
    words: { app: 'App', noun: 'scene', lead: 'lead', example: 'ex' },
    t: (key: string) => `${key} [{agent}] [{what}] [{n}/{total}]`,
    classes: { iconButton: 'ib', button: 'b', primaryButton: 'pb', input: 'i', select: 's', note: 'n' },
    consent: { subscribe: (a) => { add = a; }, answer },
    storedChoice: stored ? { get: stored, set: async () => undefined } : undefined,
  };
  const consent = new Consent(host);
  const changes: boolean[] = [];
  consent.onChange = (open) => changes.push(open);
  return { consent, add: (r) => add(r), answer, changes };
}

const req = (id: string, extra: Partial<ConsentRequest> = {}): ConsentRequest => ({ id, agent: 'Bot', what: `act-${id}`, offers: ['deny', 'once', 'always'], always: 'agent', ...extra });
const dialog = (): HTMLDialogElement => document.querySelector('dialog.ft-consent') as HTMLDialogElement;
const part = <T extends HTMLElement = HTMLElement>(sel: string): T => dialog().querySelector(sel) as T;

afterEach(() => { document.body.innerHTML = ''; });

describe('Consent', () => {
  it('opens a modal for the first request naming the agent and the action', async () => {
    const r = rig();
    r.add(req('a'));
    await flush();
    expect(r.consent.isOpen()).toBe(true);
    expect(r.changes).toEqual([true]);
    expect(part('.ft-consent-title').textContent).toContain('[Bot]');
    expect(part('.ft-consent-what').textContent).toContain('[act-a]');
  });

  it('ignores a repeated request id and counts the queue', async () => {
    const r = rig();
    r.add(req('a'));
    r.add(req('a'));
    r.add(req('b'));
    await flush();
    expect(r.consent.waiting).toBe(2);
    expect(part('.ft-consent-count').textContent).toContain('[1/2]');
    expect(part('.ft-consent-count').classList.contains('is-one')).toBe(false);
  });

  it('shows only the choices the request offers and refuses the others', async () => {
    const r = rig();
    r.add(req('a', { offers: ['deny', 'once'] }));
    await flush();
    expect(part('.ft-consent-always').hidden).toBe(true);
    expect(part('.ft-consent-deny').hidden).toBe(false);
    part<HTMLButtonElement>('.ft-consent-always').click();
    await flush();
    expect(r.answer).not.toHaveBeenCalled();
    expect(r.consent.waiting).toBe(1);
  });

  it('answers the front request and moves on, closing when the queue is empty', async () => {
    const r = rig();
    r.add(req('a'));
    r.add(req('b'));
    await flush();
    part<HTMLButtonElement>('.ft-consent-once').click();
    await flush();
    expect(r.answer).toHaveBeenLastCalledWith('a', 'once');
    expect(part('.ft-consent-what').textContent).toContain('[act-b]');
    part<HTMLButtonElement>('.ft-consent-always').click();
    await flush();
    expect(r.answer).toHaveBeenLastCalledWith('b', 'always');
    expect(r.consent.waiting).toBe(0);
    expect(r.consent.isOpen()).toBe(false);
    expect(r.changes).toEqual([true, false]);
  });

  it('closes when the only request is withdrawn and ignores unknown ids', async () => {
    const r = rig();
    r.add(req('a'));
    await flush();
    r.consent.withdraw('nope');
    expect(r.consent.waiting).toBe(1);
    r.consent.withdraw('a');
    await flush();
    expect(r.consent.isOpen()).toBe(false);
    expect(r.answer).not.toHaveBeenCalled();
  });

  it('treats escape as deny when the request asks for it', async () => {
    const r = rig();
    r.add(req('a', { escape: 'deny' }));
    await flush();
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    await flush();
    expect(r.answer).toHaveBeenCalledWith('a', 'deny');
    expect(r.consent.waiting).toBe(0);
  });

  it('drops the request on escape without answering when escape is not deny', async () => {
    const r = rig();
    r.add(req('a'));
    await flush();
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    await flush();
    expect(r.answer).not.toHaveBeenCalled();
    expect(r.consent.waiting).toBe(0);
  });

  it('never shows a request that has already expired', async () => {
    const r = rig();
    r.add(req('old', { expires: 1 }));
    await flush();
    expect(r.consent.waiting).toBe(0);
    expect(r.consent.isOpen()).toBe(false);
  });

  it('shows the changed elsewhere notice only when the stored choice says so', async () => {
    const yes = rig(async () => ({ value: 'ask', changedOutside: true }));
    yes.add(req('a'));
    await flush();
    expect(part('.ft-consent-notice').hidden).toBe(false);
    document.body.innerHTML = '';
    const broken = rig(async () => { throw new Error('down'); });
    broken.add(req('b'));
    await flush();
    expect(broken.consent.isOpen()).toBe(true);
    expect(part('.ft-consent-notice').hidden).toBe(true);
  });

  it('renders note lines and hides leftovers for a request with fewer notes', async () => {
    const r = rig();
    r.add(req('a', { notes: ['one', 'two'] }));
    r.add(req('b', { notes: ['only'] }));
    await flush();
    const visible = (): string[] => [...part('.ft-consent-notes').children].filter((c) => !(c as HTMLElement).hidden).map((c) => c.textContent ?? '');
    expect(visible()).toEqual(['one', 'two']);
    part<HTMLButtonElement>('.ft-consent-deny').click();
    await flush();
    expect(visible()).toEqual(['only']);
  });
});
