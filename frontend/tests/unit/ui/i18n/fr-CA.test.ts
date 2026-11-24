import { describe, expect, it } from 'vitest';
import { fr } from '@src/ui/i18n/fr';
import { frCA } from '@src/ui/i18n/fr-CA';
import { LANG_PARENT } from '@src/ui/i18n/langs';

const resolve = (k: string): string => frCA[k] ?? fr[k] ?? k;

describe('Canadian French table', () => {
  it('falls back to the French table', () => {
    expect(LANG_PARENT['fr-CA']).toBe('fr');
  });

  it('resolves a regional word from its own table and the rest from French', () => {
    expect(resolve('Settings')).toBe(frCA.Settings);
    expect(resolve('Settings')).not.toBe(fr.Settings);
    const inherited = Object.keys(fr).find((k) => !(k in frCA));
    expect(inherited).toBeDefined();
    if (inherited) expect(resolve(inherited)).toBe(fr[inherited]);
    expect(resolve('A label nobody translated')).toBe('A label nobody translated');
  });

  it('keeps the app placeholder in both the variant and the parent', () => {
    const key = 'The Outside agents setting was changed outside {app}, so {app} asks again.';
    expect(frCA[key]).toContain('{app}');
    expect(frCA[key]).not.toContain('FormMorpheus');
  });

  it('has no blank values', () => {
    expect(Object.entries(frCA).filter(([, v]) => v.trim() === '')).toEqual([]);
  });
});
