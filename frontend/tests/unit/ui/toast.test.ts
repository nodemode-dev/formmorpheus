import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNoticeHistory, noticeHistory, onNoticeHistory, toast } from '@src/ui/toast';

let root: HTMLElement;

beforeAll(() => {
  root = document.createElement('div');
  root.id = 'toast-root';
  document.body.appendChild(root);
});

beforeEach(() => {
  localStorage.clear();
  clearNoticeHistory();
  root.replaceChildren();
  if (!root.isConnected) document.body.appendChild(root);
});

afterEach(() => {
  vi.useRealTimers();
});

const texts = (): string[] => Array.from(root.querySelectorAll('.cv-toast-text')).map((n) => n.textContent ?? '');

describe('notice history', () => {
  it('records a notice even when there is no place to show it', () => {
    root.remove();
    const close = toast('saved');
    expect(noticeHistory().map((r) => r.text)).toEqual(['saved']);
    expect(() => close()).not.toThrow();
  });

  it('folds the same text and kind shown twice in a row into one entry with a count', () => {
    toast('saved');
    toast('saved');
    toast('saved');
    expect(noticeHistory()).toHaveLength(1);
    expect(noticeHistory()[0].count).toBe(3);
  });

  it('keeps the same text with a different kind as a separate entry', () => {
    toast('disk full', 'info');
    toast('disk full', 'error');
    expect(noticeHistory().map((r) => r.kind)).toEqual(['info', 'error']);
  });

  it('does not fold a repeat that is not directly after the first', () => {
    toast('a');
    toast('b');
    toast('a');
    expect(noticeHistory().map((r) => r.text)).toEqual(['a', 'b', 'a']);
  });

  it('keeps only the last one hundred notices, oldest first', () => {
    for (let i = 0; i < 105; i++) toast(`n${i}`, 'info', { ms: 0 });
    const h = noticeHistory();
    expect(h).toHaveLength(100);
    expect(h[0].text).toBe('n5');
    expect(h[99].text).toBe('n104');
  });

  it('gives each new entry a larger id than the one before', () => {
    toast('first');
    toast('second');
    const [a, b] = noticeHistory();
    expect(b.id).toBeGreaterThan(a.id);
  });

  it('tells watchers about new notices and about clearing, until they unsubscribe', () => {
    const fn = vi.fn();
    const off = onNoticeHistory(fn);
    toast('one');
    clearNoticeHistory();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(noticeHistory()).toHaveLength(0);
    off();
    toast('two');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('notices on screen', () => {
  it('shows the text and marks an error notice', () => {
    toast('broken', 'error');
    const node = root.querySelector('.cv-toast');
    expect(node?.classList.contains('is-error')).toBe(true);
    expect(texts()).toEqual(['broken']);
  });

  it('shows markup in the text as plain text', () => {
    toast('<b>bold</b>');
    expect(root.querySelector('b')).toBeNull();
    expect(texts()).toEqual(['<b>bold</b>']);
  });

  it('does not stack the same text a second time', () => {
    toast('same');
    toast('same');
    expect(root.children).toHaveLength(1);
  });

  it('stacks the same text when the kind differs', () => {
    toast('same', 'info');
    toast('same', 'error');
    expect(root.children).toHaveLength(2);
  });

  it('keeps at most four notices, dropping the oldest', () => {
    for (const s of ['a', 'b', 'c', 'd', 'e', 'f']) toast(s);
    expect(texts()).toEqual(['c', 'd', 'e', 'f']);
  });

  it('removes an information notice after its default time', () => {
    vi.useFakeTimers();
    toast('brief');
    vi.advanceTimersByTime(3599);
    expect(root.children).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(root.children).toHaveLength(0);
  });

  it('keeps an error notice longer than an information notice', () => {
    vi.useFakeTimers();
    toast('bad', 'error');
    vi.advanceTimersByTime(5999);
    expect(root.children).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(root.children).toHaveLength(0);
  });

  it('keeps a notice with a time of zero until it is dismissed', () => {
    vi.useFakeTimers();
    const close = toast('sticky', 'info', { ms: 0 });
    vi.advanceTimersByTime(600000);
    expect(root.children).toHaveLength(1);
    close();
    expect(root.children).toHaveLength(0);
  });

  it('restarts the clock when the same text is shown again', () => {
    vi.useFakeTimers();
    toast('again', 'info', { ms: 1000 });
    vi.advanceTimersByTime(800);
    toast('again', 'info', { ms: 1000 });
    vi.advanceTimersByTime(800);
    expect(root.children).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(root.children).toHaveLength(0);
  });

  it('follows the notice time set in the preferences', () => {
    vi.useFakeTimers();
    localStorage.setItem('formmorpheus.prefs', JSON.stringify({ noticeSeconds: 2 }));
    toast('pref');
    vi.advanceTimersByTime(1999);
    expect(root.children).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(root.children).toHaveLength(0);
  });

  it('keeps a notice with actions for ten seconds by default', () => {
    vi.useFakeTimers();
    toast('undo?', 'info', { actions: [{ label: 'Undo', run: () => undefined }] });
    vi.advanceTimersByTime(9999);
    expect(root.children).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(root.children).toHaveLength(0);
  });

  it('runs the clicked action and removes the notice', () => {
    const first = vi.fn(), second = vi.fn();
    toast('choose', 'info', { ms: 0, actions: [{ label: 'One', run: first }, { label: 'Two', run: second }] });
    const buttons = root.querySelectorAll<HTMLButtonElement>('.cv-toast-action');
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual(['One', 'Two']);
    buttons[1].click();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(root.children).toHaveLength(0);
  });

  it('removes a notice from its close button without running any action', () => {
    const run = vi.fn();
    toast('closable', 'info', { ms: 0, actions: [{ label: 'Go', run }] });
    root.querySelector<HTMLButtonElement>('.cv-toast-close')!.click();
    expect(root.children).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('stacks a notice with actions even when the same text is showing', () => {
    toast('pick', 'info', { ms: 0 });
    toast('pick', 'info', { ms: 0, actions: [{ label: 'Go', run: () => undefined }] });
    expect(root.children).toHaveLength(2);
  });
});
