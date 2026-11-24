import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async (): Promise<(text: string | null) => void> => {
  vi.resetModules();
  return (await import('@src/ui/paint-hint')).paintHint;
};

const bar = (text: string): HTMLElement => {
  const h = document.createElement('div');
  h.className = 'cv-st-hint';
  h.textContent = text;
  document.body.appendChild(h);
  return h;
};

afterEach(() => { document.body.innerHTML = ''; });

describe('paintHint', () => {
  it('does nothing when the status bar has no hint', async () => {
    const paintHint = await load();
    expect(() => { paintHint('Track 1'); paintHint(null); }).not.toThrow();
  });

  it('shows the text and gives the shell its own text back', async () => {
    const paintHint = await load();
    const h = bar('shell hint');
    paintHint('Track 1, frame 3');
    expect(h.textContent).toBe('Track 1, frame 3');
    paintHint(null);
    expect(h.textContent).toBe('shell hint');
  });

  it('restores the first text after several updates', async () => {
    const paintHint = await load();
    const h = bar('shell hint');
    paintHint('frame 1');
    paintHint('frame 2');
    paintHint('frame 3');
    expect(h.textContent).toBe('frame 3');
    paintHint(null);
    expect(h.textContent).toBe('shell hint');
  });

  it('leaves the shell text alone when nothing was swapped', async () => {
    const paintHint = await load();
    const h = bar('shell hint');
    paintHint(null);
    expect(h.textContent).toBe('shell hint');
  });

  it('captures the current shell text again after a restore', async () => {
    const paintHint = await load();
    const h = bar('first');
    paintHint('frame 1');
    paintHint(null);
    h.textContent = 'second';
    paintHint('frame 2');
    paintHint(null);
    expect(h.textContent).toBe('second');
  });
});
