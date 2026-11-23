import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/ui/i18n', () => ({ t: (s: string) => s }));

import type { Reading } from '@src/export/progress-meter';
import { ExportChip } from '@src/ui/export-chip';

const reading = (r: { frac: number; done: number; total: number; etaMs: number | null; elapsedMs: number }): Reading => r as unknown as Reading;

function make(): { chip: ExportChip; root: HTMLElement; show: () => void; cancel: () => void } {
  const show = vi.fn();
  const cancel = vi.fn();
  const chip = new ExportChip({ show, cancel });
  const root = document.body.querySelector<HTMLElement>('.fm-exchip');
  if (!root) throw new Error('chip not mounted');
  return { chip, root, show, cancel };
}

const part = (root: HTMLElement, sel: string): HTMLElement => {
  const e = root.querySelector<HTMLElement>(sel);
  if (!e) throw new Error(`missing ${sel}`);
  return e;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('ExportChip', () => {
  it('starts hidden and shows and hides on request', () => {
    const { chip, root } = make();
    expect(chip.visible).toBe(false);
    expect(root.hidden).toBe(true);
    chip.set(true);
    expect(chip.visible).toBe(true);
    expect(root.hidden).toBe(false);
    chip.set(false);
    expect(root.hidden).toBe(true);
  });

  it('calls the show and cancel handlers from its buttons', () => {
    const { root, show, cancel } = make();
    part(root, '[data-act="show"]').click();
    expect(show).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    part(root, '[data-act="cancel"]').click();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('counts frames when there is more than one', () => {
    const { chip, root } = make();
    chip.paint('Movie', 'Encoding', reading({ frac: 0.5, done: 12, total: 24, etaMs: 1000, elapsedMs: 1000 }));
    expect(part(root, '.fm-exchip-count').textContent).toBe('12 / 24');
  });

  it('shows a rounded percentage for a single item', () => {
    const { chip, root } = make();
    chip.paint('Movie', 'Encoding', reading({ frac: 0.426, done: 0, total: 1, etaMs: 1000, elapsedMs: 1000 }));
    expect(part(root, '.fm-exchip-count').textContent).toBe('43%');
    expect(part(root, '.fm-exchip-bar').getAttribute('aria-valuenow')).toBe('43');
    expect(root.title).toBe('43%');
  });

  it('names the movie and the stage', () => {
    const { chip, root } = make();
    chip.paint('Holiday', 'Muxing', reading({ frac: 0, done: 0, total: 1, etaMs: null, elapsedMs: 0 }));
    const name = part(root, '.fm-exchip-name').textContent ?? '';
    expect(name).toContain('Holiday');
    expect(name).toContain('Muxing');
    expect(name.indexOf('Muxing')).toBeLessThan(name.indexOf('Holiday'));
  });

  it('marks itself late only when no estimate exists after four seconds', () => {
    const { chip, root } = make();
    chip.paint('M', 'S', reading({ frac: 0.1, done: 0, total: 1, etaMs: null, elapsedMs: 3000 }));
    expect(root.classList.contains('is-late')).toBe(false);
    chip.paint('M', 'S', reading({ frac: 0.1, done: 0, total: 1, etaMs: null, elapsedMs: 5000 }));
    expect(root.classList.contains('is-late')).toBe(true);
    chip.paint('M', 'S', reading({ frac: 0.1, done: 0, total: 1, etaMs: 2000, elapsedMs: 6000 }));
    expect(root.classList.contains('is-late')).toBe(false);
  });

  it('adds the time left only when there is an estimate', () => {
    const { chip, root } = make();
    chip.paint('M', 'S', reading({ frac: 0.1, done: 0, total: 1, etaMs: null, elapsedMs: 1000 }));
    const without = part(root, '.fm-exchip-time').textContent ?? '';
    chip.paint('M', 'S', reading({ frac: 0.1, done: 0, total: 1, etaMs: 60000, elapsedMs: 1000 }));
    const withEta = part(root, '.fm-exchip-time').textContent ?? '';
    expect(withEta.startsWith(without)).toBe(true);
    expect(withEta.length).toBeGreaterThan(without.length);
  });
});
