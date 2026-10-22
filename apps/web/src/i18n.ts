import { useSyncExternalStore } from 'react';

import chinese from './locale/zh.json';
import english from './locale/en.json';

export type Language = 'system' | 'zh-CN' | 'en-US';
export type TranslationKey = keyof typeof chinese;
export type TranslationValues = Readonly<Record<string, string | number>>;

const catalogs: Record<Exclude<Language, 'system'>, Record<TranslationKey, string>> = {
  'zh-CN': chinese,
  'en-US': english,
};
const listeners = new Set<() => void>();
let language: Language = 'system';

export function resolvedLanguage(): Exclude<Language, 'system'> {
  if (language !== 'system') return language;

  const hostLanguage =
    (typeof document !== 'undefined' && document.documentElement.lang) ||
    (typeof navigator !== 'undefined' && navigator.language) ||
    'zh-CN';
  return hostLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function setLanguage(value: Language = 'system'): void {
  if (language === value) return;

  language = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('languagechange', listener);
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  return () => {
    listeners.delete(listener);
    window.removeEventListener('languagechange', listener);
    observer.disconnect();
  };
}

export function useLanguage(): Exclude<Language, 'system'> {
  return useSyncExternalStore(subscribe, resolvedLanguage, resolvedLanguage);
}

export function t(key: TranslationKey, values: TranslationValues = {}): string {
  const template = catalogs[resolvedLanguage()][key] ?? chinese[key] ?? key;

  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}
