import { describe, expect, it } from 'vitest';
import { ru } from '@src/ui/i18n/ru';

const ONE = '{n} day left';
const OTHER = '{n} days left';
const num = (n: number): string => new Intl.NumberFormat('ru').format(n);

describe('Russian plural forms', () => {
  it('holds a few and a many form for the days left phrase, each keeping the number', () => {
    for (const k of [ONE, `${OTHER}#few`, `${OTHER}#many`]) expect(ru[k]).toContain('{n}');
    expect(ru[`${OTHER}#few`]).not.toBe(ru[`${OTHER}#many`]);
  });

  it('picks the form the Russian rules choose for each number', async () => {
    const i18n = await import('@src/ui/i18n');
    await i18n.setLanguage('ru');
    expect(i18n.tn(1, ONE, OTHER)).toBe(ru[ONE].replace('{n}', num(1)));
    expect(i18n.tn(21, ONE, OTHER)).toBe(ru[ONE].replace('{n}', num(21)));
    expect(i18n.tn(3, ONE, OTHER)).toBe(ru[`${OTHER}#few`].replace('{n}', num(3)));
    expect(i18n.tn(24, ONE, OTHER)).toBe(ru[`${OTHER}#few`].replace('{n}', num(24)));
    expect(i18n.tn(5, ONE, OTHER)).toBe(ru[`${OTHER}#many`].replace('{n}', num(5)));
    expect(i18n.tn(11, ONE, OTHER)).toBe(ru[`${OTHER}#many`].replace('{n}', num(11)));
    expect(i18n.tn(12000, ONE, OTHER)).toBe(ru[`${OTHER}#many`].replace('{n}', num(12000)));
    await i18n.setLanguage('en');
    expect(i18n.tn(5, ONE, OTHER)).toBe('5 days left');
  });
});
