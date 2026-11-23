import { describe, expect, it } from 'vitest';
import { es } from '@src/ui/i18n/es';
import { esMX } from '@src/ui/i18n/es-MX';
import { LANG_PARENT } from '@src/ui/i18n/langs';

const resolve = (k: string): string => esMX[k] ?? es[k] ?? k;

describe('Mexican Spanish table', () => {
  it('falls back to the Spanish table', () => {
    expect(LANG_PARENT['es-MX']).toBe('es');
  });

  it('overrides words the Spanish table also translates', () => {
    const shared = Object.keys(esMX).filter((k) => k in es);
    expect(shared.length).toBeGreaterThan(Object.keys(esMX).length / 2);
  });

  it('resolves a regional word from its own table and the rest from Spanish', () => {
    expect(resolve('Frame rate')).toBe(esMX['Frame rate']);
    expect(resolve('Frame rate')).not.toBe(es['Frame rate']);
    const inherited = Object.keys(es).find((k) => !(k in esMX));
    expect(inherited).toBeDefined();
    if (inherited) expect(resolve(inherited)).toBe(es[inherited]);
    expect(resolve('A label nobody translated')).toBe('A label nobody translated');
  });

  it('is looked up by the runtime before Spanish, with a trailing ellipsis or colon put back', async () => {
    const i18n = await import('@src/ui/i18n');
    await i18n.setLanguage('es-MX');
    expect(i18n.language()).toBe('es-MX');
    expect(i18n.t('Frame rate')).toBe(esMX['Frame rate']);
    expect(i18n.t('Frame rate...')).toBe(`${esMX['Frame rate']}...`);
    expect(i18n.t('Frame rate:')).toBe(`${esMX['Frame rate']}:`);
    const inherited = Object.keys(es).find((k) => !(k in esMX) && !k.endsWith('...') && !k.endsWith(':')) ?? '';
    expect(i18n.t(inherited)).toBe(es[inherited]);
    expect(i18n.t('A label nobody translated')).toBe('A label nobody translated');
    await i18n.setLanguage('en');
    expect(i18n.t('Frame rate')).toBe('Frame rate');
  });

  it('has no blank values', () => {
    expect(Object.entries(esMX).filter(([, v]) => v.trim() === '')).toEqual([]);
  });
});
