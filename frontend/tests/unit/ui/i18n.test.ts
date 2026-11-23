import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/ui/prefs', () => ({ loadPrefs: () => ({ language: 'en' }) }));
vi.mock('@src/ui/i18n/fr', () => ({
  fr: { Save: 'Enregistrer', Size: 'Taille', '{n} record': '{n} enregistrement', '{n} records': '{n} enregistrements' },
}));
vi.mock('@src/ui/i18n/es', () => ({ es: { Save: 'Guardar' } }));

type I18n = typeof import('@src/ui/i18n');

async function load(): Promise<I18n> {
  vi.resetModules();
  return import('@src/ui/i18n');
}

describe('t', () => {
  it('returns the English text while English is the language', async () => {
    const m = await load();
    expect(m.language()).toBe('en');
    expect(m.t('Save')).toBe('Save');
  });

  it('looks the text up in the chosen language and keeps unknown text as it is', async () => {
    const m = await load();
    await m.setLanguage('fr');
    expect(m.t('Save')).toBe('Enregistrer');
    expect(m.t('Not in the table')).toBe('Not in the table');
  });

  it('shares one entry between a label and its forms ending in three dots or a colon', async () => {
    const m = await load();
    await m.setLanguage('fr');
    expect(m.t('Save...')).toBe('Enregistrer...');
    expect(m.t('Size:')).toBe('Taille:');
    expect(m.t('Size::')).toBe('Size::');
  });
});

describe('setLanguage', () => {
  it('marks the page language and direction and tells the listeners', async () => {
    const m = await load();
    const heard = vi.fn();
    const stop = m.onLanguage(heard);
    await m.setLanguage('fr');
    expect(m.language()).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(document.documentElement.dir).toBe('ltr');
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    await m.setLanguage('es');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('does not tell the listeners again when the language is already current', async () => {
    const m = await load();
    await m.setLanguage('fr');
    const heard = vi.fn();
    m.onLanguage(heard);
    await m.setLanguage('fr');
    expect(heard).not.toHaveBeenCalled();
  });

  it('lets the later of two overlapping calls win', async () => {
    const m = await load();
    await Promise.all([m.setLanguage('fr'), m.setLanguage('es')]);
    expect(m.language()).toBe('es');
    expect(m.t('Save')).toBe('Guardar');
  });
});

describe('tn', () => {
  it('picks the English singular only for one and groups large numbers', async () => {
    const m = await load();
    expect(m.tn(1, '{n} record', '{n} records')).toBe('1 record');
    expect(m.tn(0, '{n} record', '{n} records')).toBe('0 records');
    expect(m.tn(1200, '{n} record', '{n} records')).toBe('1,200 records');
  });

  it('follows the plural rules of the chosen language', async () => {
    const m = await load();
    await m.setLanguage('fr');
    expect(m.tn(0, '{n} record', '{n} records')).toBe('0 enregistrement');
    expect(m.tn(2, '{n} record', '{n} records')).toBe('2 enregistrements');
  });

  it('falls back to the English forms when the language has no entry', async () => {
    const m = await load();
    await m.setLanguage('fr');
    expect(m.tn(3, '{n} file', '{n} files')).toBe('3 files');
  });
});
