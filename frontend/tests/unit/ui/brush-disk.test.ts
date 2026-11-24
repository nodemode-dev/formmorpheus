import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/ui/brush-thumb', () => ({ brushThumb: () => '' }));
vi.mock('@src/ui/toast', () => ({ toast: () => undefined }));
vi.mock('@src/io/brush-export', () => ({ exportBrush: () => new Uint8Array() }));

import { cleanSegment } from '@src/ui/brush-disk';

describe('cleanSegment', () => {
  it('keeps a plain name as it is', () => {
    expect(cleanSegment('Soft Round', 'x')).toBe('Soft Round');
  });

  it('replaces path separators so a name cannot climb folders', () => {
    expect(cleanSegment('../../etc/passwd', 'x')).toBe('-..-etc-passwd');
    expect(cleanSegment('a\\b', 'x')).toBe('a-b');
  });

  it('replaces characters that file systems refuse', () => {
    expect(cleanSegment('a:b*c?d"e<f>g|h', 'x')).toBe('a-b-c-d-e-f-g-h');
  });

  it('replaces control characters', () => {
    expect(cleanSegment('a\u0001b\nc', 'x')).toBe('a-b-c');
  });

  it('strips leading and trailing dots and spaces', () => {
    expect(cleanSegment('  ..Ink.. ', 'x')).toBe('Ink');
  });

  it('falls back when nothing is left', () => {
    expect(cleanSegment('', 'Untitled')).toBe('Untitled');
    expect(cleanSegment(' ... ', 'Untitled')).toBe('Untitled');
    expect(cleanSegment('..', 'Untitled')).toBe('Untitled');
  });

  it('renames reserved device names in any case', () => {
    expect(cleanSegment('con', 'x')).toBe('con brush');
    expect(cleanSegment('NUL', 'x')).toBe('NUL brush');
    expect(cleanSegment('Com3', 'x')).toBe('Com3 brush');
    expect(cleanSegment('lpt9', 'x')).toBe('lpt9 brush');
  });

  it('renames a reserved name before its first dot and keeps the rest', () => {
    expect(cleanSegment('aux.brush', 'x')).toBe('aux brush.brush');
  });

  it('renames a reserved name that only had trailing dots or spaces', () => {
    expect(cleanSegment('prn. ', 'x')).toBe('prn brush');
  });

  it('leaves names that only look like device names', () => {
    expect(cleanSegment('com0', 'x')).toBe('com0');
    expect(cleanSegment('console', 'x')).toBe('console');
    expect(cleanSegment('my con', 'x')).toBe('my con');
  });

  it('cuts a long name to one hundred characters', () => {
    expect(cleanSegment('a'.repeat(300), 'x')).toHaveLength(100);
  });

  it('strips a space or dot left at the cut', () => {
    expect(cleanSegment(`${'a'.repeat(98)}. b`, 'x')).toBe('a'.repeat(98));
  });
});
