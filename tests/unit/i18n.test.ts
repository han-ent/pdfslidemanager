import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { ko as koCatalog } from '../../src/i18n/ko';
import {
  LOCALE_STORAGE_KEY,
  getLocale,
  ko,
  localeFromLanguage,
  resetLocaleForTests,
  resolveLocale,
  setLocale,
} from '../../src/i18n';

afterEach(() => {
  resetLocaleForTests();
  document.documentElement.lang = 'ko';
  document.title = '';
});

describe('locale selection', () => {
  it('maps ko and ko-* to Korean and every other tag to English', () => {
    expect(localeFromLanguage('ko')).toBe('ko');
    expect(localeFromLanguage('ko-KR')).toBe('ko');
    expect(localeFromLanguage('KO-kp')).toBe('ko');
    expect(localeFromLanguage('en')).toBe('en');
    expect(localeFromLanguage('en-US')).toBe('en');
    expect(localeFromLanguage('ja')).toBe('en');
    expect(localeFromLanguage('kok')).toBe('en');
    expect(localeFromLanguage('')).toBe('en');
    expect(localeFromLanguage(undefined)).toBe('en');
  });

  it('prefers a stored choice over the browser language', () => {
    expect(resolveLocale('en-US', 'ko')).toBe('ko');
    expect(resolveLocale('ko-KR', 'en')).toBe('en');
    expect(resolveLocale('ko-KR', 'fr')).toBe('ko');
    expect(resolveLocale('en-US', null)).toBe('en');
  });

  it('remembers an explicit choice in localStorage and updates the document', () => {
    expect(getLocale()).toBe('ko');
    setLocale('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(getLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('PDF Slide Splitter');
    expect(ko.appTitle).toBe(en.appTitle);
    expect(ko.dropTitle).toBe('Drop a lecture PDF to split it into slides');

    resetLocaleForTests();
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(getLocale()).toBe('en');
  });
});

describe('message catalogs', () => {
  it('uses the same keys and value kinds in Korean and English', () => {
    const koreanKeys = Object.keys(koCatalog).sort();
    const englishKeys = Object.keys(en).sort();
    expect(englishKeys).toEqual(koreanKeys);

    for (const key of koreanKeys) {
      const korean = koCatalog[key as keyof typeof koCatalog];
      const english = en[key as keyof typeof en];
      expect(typeof english).toBe(typeof korean);
      if (typeof korean === 'function' && typeof english === 'function') {
        expect(english.length).toBe(korean.length);
      }
    }
  });
});
