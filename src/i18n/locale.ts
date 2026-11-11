import { en } from './en';
import { ko as koCatalog, type MessageCatalog } from './ko';

export const LOCALE_STORAGE_KEY = 'pdfslidemanager.locale';

export type LocaleId = 'ko' | 'en';

const catalogs: Record<LocaleId, MessageCatalog> = {
  ko: koCatalog,
  en,
};

let explicitLocale: LocaleId | null = null;
let detectedLocale: LocaleId | null = null;
const listeners = new Set<() => void>();

/** `ko` and `ko-*` are Korean. Every other tag, including a missing one, is English. */
export function localeFromLanguage(language: string | null | undefined): LocaleId {
  const tag = (language ?? '').trim().toLowerCase();
  return tag === 'ko' || tag.startsWith('ko-') ? 'ko' : 'en';
}

export function resolveLocale(language: string | null | undefined, stored: string | null | undefined): LocaleId {
  if (stored === 'ko' || stored === 'en') return stored;
  return localeFromLanguage(language);
}

function readStoredLocale(): LocaleId | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    return value === 'ko' || value === 'en' ? value : null;
  } catch {
    return null;
  }
}

function writeStoredLocale(locale: LocaleId): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Private mode can block storage. The in-memory choice still applies.
  }
}

export function getLocale(): LocaleId {
  if (explicitLocale) return explicitLocale;
  if (detectedLocale) return detectedLocale;
  const language = typeof navigator === 'undefined' ? null : navigator.language;
  detectedLocale = resolveLocale(language, readStoredLocale());
  return detectedLocale;
}

export function setLocale(next: LocaleId): void {
  const previous = getLocale();
  explicitLocale = next;
  detectedLocale = next;
  writeStoredLocale(next);
  applyDocumentLocale();
  if (previous === next) return;
  for (const listener of [...listeners]) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyDocumentLocale(): void {
  if (typeof document === 'undefined') return;
  const messages = catalogs[getLocale()];
  document.documentElement.lang = messages.htmlLang;
  document.title = messages.appTitle;
  document.querySelector('meta[name="description"]')?.setAttribute('content', messages.metaDescription);
}

/** Drops the in-memory choice and the stored language preference. */
export function resetLocaleForTests(): void {
  explicitLocale = null;
  detectedLocale = null;
  try {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    // Ignore storage failures in tests.
  }
}

/** Live catalog. Each property read uses the active locale. */
export const ko: MessageCatalog = new Proxy({} as MessageCatalog, {
  get(_target, property) {
    if (typeof property !== 'string') return undefined;
    return catalogs[getLocale()][property as keyof MessageCatalog];
  },
});
