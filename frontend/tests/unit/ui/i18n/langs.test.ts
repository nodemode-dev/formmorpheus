import { describe, expect, it } from 'vitest';
import { LANG_CODES, LANG_NAMES, LANG_PARENT, RTL_LANGS, isLang, type Lang } from '@src/ui/i18n/langs';
import { ar } from '@src/ui/i18n/ar';
import { cs } from '@src/ui/i18n/cs';
import { da } from '@src/ui/i18n/da';
import { de } from '@src/ui/i18n/de';
import { el } from '@src/ui/i18n/el';
import { es } from '@src/ui/i18n/es';
import { esMX } from '@src/ui/i18n/es-MX';
import { fi } from '@src/ui/i18n/fi';
import { fr } from '@src/ui/i18n/fr';
import { frCA } from '@src/ui/i18n/fr-CA';
import { hi } from '@src/ui/i18n/hi';
import { hu } from '@src/ui/i18n/hu';
import { id } from '@src/ui/i18n/id';
import { it as itTable } from '@src/ui/i18n/it';
import { ja } from '@src/ui/i18n/ja';
import { ko } from '@src/ui/i18n/ko';
import { nb } from '@src/ui/i18n/nb';
import { nl } from '@src/ui/i18n/nl';
import { pl } from '@src/ui/i18n/pl';
import { ptBR } from '@src/ui/i18n/pt-BR';
import { ru } from '@src/ui/i18n/ru';
import { srLatn } from '@src/ui/i18n/sr-Latn';
import { sv } from '@src/ui/i18n/sv';
import { th } from '@src/ui/i18n/th';
import { tr } from '@src/ui/i18n/tr';
import { uk } from '@src/ui/i18n/uk';
import { vi } from '@src/ui/i18n/vi';
import { zhCN } from '@src/ui/i18n/zh-CN';
import { zhTW } from '@src/ui/i18n/zh-TW';

type Table = Record<string, string>;

const TABLES: Record<Exclude<Lang, 'en'>, Table> = {
  ar, cs, da, de, el, es, 'es-MX': esMX, fi, fr, 'fr-CA': frCA, hi, hu, id, it: itTable, ja, ko, nb, nl, pl,
  'pt-BR': ptBR, ru, 'sr-Latn': srLatn, sv, th, tr, uk, vi, 'zh-CN': zhCN, 'zh-TW': zhTW,
};

const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const placeholders = (s: string): string[] => [...new Set(s.match(PLACEHOLDER) ?? [])].sort();
const entries = (): Array<[Lang, string, string]> =>
  (Object.entries(TABLES) as Array<[Lang, Table]>).flatMap(([lang, table]) =>
    Object.entries(table).map(([k, v]): [Lang, string, string] => [lang, k, v]));

describe('language list', () => {
  it('starts with English as the default source language', () => {
    expect(LANG_CODES[0]).toBe('en');
  });

  it('lists every code exactly once', () => {
    expect(new Set(LANG_CODES).size).toBe(LANG_CODES.length);
  });

  it('names every code exactly once, in the same order as the codes', () => {
    expect(LANG_NAMES.map(([code]) => code)).toEqual([...LANG_CODES]);
  });

  it('gives every language a non-empty name of its own', () => {
    for (const [, name] of LANG_NAMES) expect(name.trim().length).toBeGreaterThan(0);
    expect(new Set(LANG_NAMES.map(([, name]) => name)).size).toBe(LANG_NAMES.length);
  });

  it('marks Arabic as right to left and leaves the others left to right', () => {
    expect(RTL_LANGS.has('ar')).toBe(true);
    expect(RTL_LANGS.has('en')).toBe(false);
    expect(RTL_LANGS.has('he' as Lang)).toBe(false);
    for (const code of RTL_LANGS) expect(LANG_CODES).toContain(code);
  });

  it('falls regional variants back to a listed parent that has no parent itself', () => {
    expect(LANG_PARENT['es-MX']).toBe('es');
    expect(LANG_PARENT['fr-CA']).toBe('fr');
    for (const [child, parent] of Object.entries(LANG_PARENT) as Array<[Lang, Lang]>) {
      expect(LANG_CODES).toContain(child);
      expect(LANG_CODES).toContain(parent);
      expect(parent).not.toBe(child);
      expect(LANG_PARENT[parent]).toBeUndefined();
    }
    expect(LANG_PARENT.es).toBeUndefined();
    expect(LANG_PARENT.en).toBeUndefined();
  });
});

describe('choosing a language', () => {
  it('turns the window right to left for Arabic and back for German', async () => {
    const i18n = await import('@src/ui/i18n');
    await i18n.setLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(i18n.t('Add track')).toBe(ar['Add track']);
    await i18n.setLanguage('de');
    expect(document.documentElement.dir).toBe('ltr');
    expect(i18n.t('Add track')).toBe(de['Add track']);
    await i18n.setLanguage('en');
    expect(i18n.t('Add track')).toBe('Add track');
  });
});

describe('isLang', () => {
  it('accepts every listed code', () => {
    for (const code of LANG_CODES) expect(isLang(code)).toBe(true);
  });

  it('refuses codes that are not listed, wrongly cased or padded', () => {
    for (const v of ['', 'EN', 'es-mx', 'pt', 'zh', 'fr_CA', ' en', 'en ', 'xx', 'sr-Cyrl']) expect(isLang(v)).toBe(false);
  });

  it('refuses values that are not strings', () => {
    for (const v of [undefined, null, 0, 1, true, {}, ['en'], Symbol('en')]) expect(isLang(v)).toBe(false);
  });
});

describe('translation tables', () => {
  it('has a non-empty table for every listed language except English', () => {
    const codes = LANG_CODES.filter((c) => c !== 'en');
    expect(Object.keys(TABLES).sort()).toEqual([...codes].sort());
    for (const code of codes) expect(Object.keys(TABLES[code]).length).toBeGreaterThan(0);
  });

  it('gives full languages a far larger table than regional variants', () => {
    for (const [child, parent] of Object.entries(LANG_PARENT) as Array<[Exclude<Lang, 'en'>, Exclude<Lang, 'en'>]>) {
      expect(Object.keys(TABLES[child]).length).toBeLessThan(Object.keys(TABLES[parent]).length / 2);
    }
  });

  it('has no empty keys and no empty or blank values', () => {
    const bad = entries().filter(([, k, v]) => k.trim() === '' || typeof v !== 'string' || v.trim() === '');
    expect(bad).toEqual([]);
  });

  it('never invents a placeholder the English text does not have', () => {
    const bad = entries().filter(([, k, v]) => placeholders(v).some((p) => !k.includes(p)));
    expect(bad).toEqual([]);
  });

  it('keeps every named placeholder of the English text in the translation', () => {
    const bad = entries().filter(([, k, v]) => placeholders(k).some((p) => p !== '{n}' && !v.includes(p)));
    expect(bad).toEqual([]);
  });

  it('keeps the number placeholder in every plural form other than one or two', () => {
    const bad = entries().filter(([lang, k, v]) => {
      if (!k.includes('{n}') || v.includes('{n}')) return false;
      const hash = k.lastIndexOf('#');
      const cat = hash >= 0 ? k.slice(hash + 1) : '';
      if (cat === 'one' || cat === 'two' || cat === 'zero') return false;
      return hash >= 0 && new Intl.PluralRules(lang).resolvedOptions().pluralCategories.includes(cat as Intl.LDMLPluralRule);
    });
    expect(bad).toEqual([]);
  });

  it('only uses plural categories that the language actually has', () => {
    const bad: Array<[Lang, string]> = [];
    for (const [lang, k] of entries()) {
      const hash = k.lastIndexOf('#');
      if (hash < 0 || !k.slice(0, hash).includes('{n}')) continue;
      const cat = k.slice(hash + 1);
      const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories as readonly string[];
      if (!cats.includes(cat)) bad.push([lang, k]);
    }
    expect(bad).toEqual([]);
  });

  it('keeps the product name untranslated wherever the English names it', () => {
    const bad = entries().filter(([, k, v]) => k.includes('FormMorpheus') && !v.includes('FormMorphe'));
    expect(bad).toEqual([]);
  });

  it('shares most of its keys with the other full languages', () => {
    const full = (Object.keys(TABLES) as Array<Exclude<Lang, 'en'>>).filter((c) => !LANG_PARENT[c]);
    const keyCount = new Map<string, number>();
    for (const code of full) for (const k of Object.keys(TABLES[code])) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
    const common = [...keyCount.values()].filter((n) => n === full.length).length;
    expect(common).toBeGreaterThan(100);
    expect(TABLES.de['Add track']).toBeDefined();
    for (const code of full) expect(TABLES[code]['Add track']?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
