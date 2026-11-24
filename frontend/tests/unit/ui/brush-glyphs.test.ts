import { describe, expect, it } from 'vitest';
import { GLYPH_COUNT, setGlyph } from '@src/ui/brush-glyphs';

describe('setGlyph', () => {
  it('returns an inline svg drawn in the current colour', () => {
    const svg = setGlyph('Pencil');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('stroke="currentColor"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('finds a set whatever its case and surrounding spaces', () => {
    expect(setGlyph('  WATERCOLOR ')).toBe(setGlyph('watercolor'));
    expect(setGlyph('Comic Ink')).toBe(setGlyph('comic ink'));
  });

  it('gives sets that do the same thing the same glyph', () => {
    expect(setGlyph('Graphite')).toBe(setGlyph('Pencil'));
    expect(setGlyph('Wet Media')).toBe(setGlyph('Watercolor'));
    expect(setGlyph('Graffiti')).toBe(setGlyph('Spray'));
  });

  it('gives different kinds of set different glyphs', () => {
    expect(setGlyph('Pencil')).not.toBe(setGlyph('Watercolor'));
    expect(setGlyph('Spray')).not.toBe(setGlyph('Nature'));
  });

  it('gives a set the person made the tray, distinct from every starter glyph', () => {
    const own = setGlyph('My Favourites');
    expect(own).toBe(setGlyph(''));
    for (const name of ['pencil', 'watercolor', 'spray', 'nature', 'charcoal']) expect(setGlyph(name)).not.toBe(own);
  });

  it('gives the recent list the clock whatever the name', () => {
    const clock = setGlyph('anything', true);
    expect(setGlyph('pencil', true)).toBe(clock);
    expect(setGlyph('Printmaking')).toBe(clock);
    expect(clock).not.toBe(setGlyph('anything'));
  });

  it('has at least fourteen glyphs', () => {
    expect(GLYPH_COUNT).toBeGreaterThanOrEqual(14);
  });
});
