import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movie } from '@src/engine/types';

vi.mock('@src/media/fonts', () => ({
  BUNDLED_FONTS: ['Inter'],
  GENERIC_FONTS: ['serif', 'sans-serif', 'monospace'],
  ensureTextFont: vi.fn(),
  fontCatalog: vi.fn(() => []),
  loadTextFonts: vi.fn(),
}));

vi.mock('@src/io/fonts-library', () => ({
  libraryFamilies: (): string[] => ['Library Face'],
  libraryReady: (): Promise<void> => Promise.resolve(),
}));

const { fontAvailable, substitutedFonts } = await import('@src/ui/fonts-missing');

const ctx = {
  font: '',
  measureText: (): { width: number } => ({ width: ctx.font.includes('"Installed Face"') ? 140 : 100 }),
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
});

type Txt = { font: string; runs?: { font?: string }[] };

const text = (id: string, start: number, duration: number, t: Txt): Record<string, unknown> => ({ kind: 'text', id, start, duration, text: t });

const movie = (content: Record<string, unknown>[], assets: Record<string, unknown> = {}): Movie =>
  ({ tracks: [{ content }], assets }) as unknown as Movie;

describe('fontAvailable', () => {
  it('accepts bundled, generic and library families', () => {
    const m = movie([]);
    expect(fontAvailable(m, 'Inter')).toBe(true);
    expect(fontAvailable(m, 'serif')).toBe(true);
    expect(fontAvailable(m, 'Library Face')).toBe(true);
  });

  it('accepts a family embedded in the movie as a font asset', () => {
    const m = movie([], { f1: { kind: 'font', family: 'Embedded Face' } });
    expect(fontAvailable(m, 'Embedded Face')).toBe(true);
  });

  it('ignores an asset of another kind that carries the same family name', () => {
    const m = movie([], { i1: { kind: 'image', family: 'Ghost Face' } });
    expect(fontAvailable(m, 'Ghost Face')).toBe(false);
  });

  it('accepts a family the system draws under its own name', () => {
    expect(fontAvailable(movie([]), 'Installed Face')).toBe(true);
  });

  it('refuses a family that measures like every fallback', () => {
    expect(fontAvailable(movie([]), 'Ghost Face')).toBe(false);
  });
});

describe('substitutedFonts', () => {
  it('lists each missing family once across the text and its runs', () => {
    const m = movie([
      text('t1', 0, 10, { font: 'Ghost Face', runs: [{ font: 'Other Ghost' }, { font: 'Inter' }, {}] }),
      text('t2', 0, 10, { font: 'Ghost Face' }),
    ]);
    expect(substitutedFonts(m, 0, 10).sort()).toEqual(['Ghost Face', 'Other Ghost']);
  });

  it('only looks at text that overlaps the half open frame range', () => {
    const m = movie([text('t1', 10, 5, { font: 'Ghost Face' })]);
    expect(substitutedFonts(m, 0, 10)).toEqual([]);
    expect(substitutedFonts(m, 15, 20)).toEqual([]);
    expect(substitutedFonts(m, 14, 15)).toEqual(['Ghost Face']);
    expect(substitutedFonts(m, 0, 11)).toEqual(['Ghost Face']);
  });

  it('walks into groups', () => {
    const m = movie([{ kind: 'group', id: 'g', start: 0, duration: 10, tracks: [{ content: [text('t1', 0, 10, { font: 'Deep Ghost' })] }] }]);
    expect(substitutedFonts(m, 0, 10)).toEqual(['Deep Ghost']);
  });

  it('leaves out families that can be found and content that is not text', () => {
    const m = movie(
      [
        text('t1', 0, 10, { font: 'Embedded Face', runs: [{ font: 'Installed Face' }, { font: 'Library Face' }] }),
        { kind: 'image', id: 'i1', start: 0, duration: 10 },
      ],
      { f1: { kind: 'font', family: 'Embedded Face' } },
    );
    expect(substitutedFonts(m, 0, 10)).toEqual([]);
  });
});
