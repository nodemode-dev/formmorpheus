import { describe, expect, it } from 'vitest';
import { ar } from '@src/ui/i18n/ar';

const ONE = '{n} day left';
const OTHER = '{n} days left';
const num = (n: number): string => new Intl.NumberFormat('ar').format(n);

describe('Arabic plural forms', () => {
  it('holds a form for each of the six Arabic plural categories', () => {
    expect(ar[ONE]).toBeTruthy();
    expect(ar[OTHER]).toContain('{n}');
    for (const cat of ['zero', 'two', 'few', 'many']) expect(ar[`${OTHER}#${cat}`]?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it('picks the dual form for two and the few and many forms with the number in local digits', async () => {
    const i18n = await import('@src/ui/i18n');
    await i18n.setLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(i18n.tn(1, ONE, OTHER)).toBe(ar[ONE].replace('{n}', num(1)));
    expect(i18n.tn(2, ONE, OTHER)).toBe(ar[`${OTHER}#two`].replace('{n}', num(2)));
    expect(i18n.tn(0, ONE, OTHER)).toBe(ar[`${OTHER}#zero`].replace('{n}', num(0)));
    expect(i18n.tn(3, ONE, OTHER)).toBe(ar[`${OTHER}#few`].replace('{n}', num(3)));
    expect(i18n.tn(11, ONE, OTHER)).toBe(ar[`${OTHER}#many`].replace('{n}', num(11)));
    expect(i18n.tn(100, ONE, OTHER)).toBe(ar[OTHER].replace('{n}', num(100)));
  });
});
