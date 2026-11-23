import { describe, expect, it } from 'vitest';
import type { Engine } from '@src/engine/engine';
import { movieLabel } from '@src/ui/title-name';
import { t } from '@src/ui/i18n';

const engineWith = (movie: { name: string } | null, libraryName: string | null = null): Engine =>
  ({ movie, libraryName } as unknown as Engine);

describe('movieLabel', () => {
  it('is empty when no movie is open', () => {
    expect(movieLabel(engineWith(null))).toBe('');
  });

  it('reads as untitled for a default movie that has no library name', () => {
    const label = movieLabel(engineWith({ name: 'Untitled Movie' }));
    expect(label).toBe(t('Untitled'));
    expect(label).not.toBe('Untitled Movie');
  });

  it('keeps the default name once the movie has a library name', () => {
    expect(movieLabel(engineWith({ name: 'Untitled Movie' }, 'Untitled Movie'))).toBe('Untitled Movie');
  });

  it('shows the name of a named movie', () => {
    expect(movieLabel(engineWith({ name: 'Walk Cycle' }))).toBe('Walk Cycle');
    expect(movieLabel(engineWith({ name: 'Walk Cycle' }, 'Walk Cycle 2'))).toBe('Walk Cycle');
  });
});
