import { describe, expect, it, vi } from 'vitest';

const table = vi.hoisted((): Record<string, string> => ({
  Paste: 'Coller',
  'Add {n} files': 'Ajouter {n} fichiers',
  'Add {name} keyframe': 'Ajouter une cle {name}',
  'Clear {name}': 'Effacer {name}',
  'Delete {name}': 'Supprimer {name}',
  '{name} keyframe': 'Cle {name}',
  'Record {name}': 'Enregistrer {name}',
  'Add {name}': 'Ajouter {name}',
  Opacity: 'Opacite',
  photo: 'PHOTO',
}));

vi.mock('@src/ui/i18n', () => ({ t: (s: string): string => table[s] ?? s }));

import { historyLabel } from '@src/ui/history-label';

describe('historyLabel', () => {
  it('returns an empty label unchanged', () => {
    expect(historyLabel('')).toBe('');
  });

  it('uses the entry of a fixed label as a whole', () => {
    expect(historyLabel('Paste')).toBe('Coller');
  });

  it('puts the file count into the count pattern', () => {
    expect(historyLabel('Add 3 files')).toBe('Ajouter 3 fichiers');
    expect(historyLabel('Add 120 files')).toBe('Ajouter 120 fichiers');
  });

  it('translates a kind name inside a composed label', () => {
    expect(historyLabel('Clear Opacity')).toBe('Effacer Opacite');
    expect(historyLabel('Opacity keyframe')).toBe('Cle Opacite');
  });

  it('keeps a kind name without a translation as typed', () => {
    expect(historyLabel('Delete Glow Ring')).toBe('Supprimer Glow Ring');
  });

  it('prefers the keyframe pattern over the plain Add pattern', () => {
    expect(historyLabel('Add Opacity keyframe')).toBe('Ajouter une cle Opacite');
  });

  it('keeps a user name as typed in patterns that are not kind names', () => {
    expect(historyLabel('Add photo')).toBe('Ajouter photo');
    expect(historyLabel('Record Opacity')).toBe('Enregistrer Opacity');
  });

  it('keeps a word Add that is not followed by a number of files in the name pattern', () => {
    expect(historyLabel('Add many files')).toBe('Ajouter many files');
  });

  it('returns the label unchanged when its pattern has no translation', () => {
    expect(historyLabel('Opacity option')).toBe('Opacity option');
    expect(historyLabel('Opacity performance')).toBe('Opacity performance');
  });

  it('returns a label that matches no pattern unchanged', () => {
    expect(historyLabel('Nudge')).toBe('Nudge');
  });
});
