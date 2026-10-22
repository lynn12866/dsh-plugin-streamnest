import { t, type TranslationKey, type TranslationValues } from './i18n';
import { readBusinessMessage, type BusinessMessage } from '../../shared/src/messages';
import { BUSINESS_KEYS } from './business-messages';

export interface LocalizedMessage {
  key: TranslationKey;
  values: TranslationValues;
}

export type DisplayMessage = string | LocalizedMessage | BusinessMessage;

export function message(key: TranslationKey, values: TranslationValues = {}): LocalizedMessage {
  return { key, values };
}

export class LocalizedError extends Error {
  readonly localizedMessage: LocalizedMessage;

  constructor(key: TranslationKey, values: TranslationValues = {}) {
    super(key);
    this.name = 'LocalizedError';
    this.localizedMessage = message(key, values);
  }
}

export class ApiBusinessError extends Error {
  constructor(readonly businessMessage: BusinessMessage) {
    super(businessMessage.message);
    this.name = 'ApiBusinessError';
  }
}

export function messageFromError(error: unknown): DisplayMessage {
  if (error instanceof LocalizedError) return error.localizedMessage;
  if (error instanceof ApiBusinessError) return error.businessMessage;
  const business = readBusinessMessage(error);
  if (business) return business;

  return error instanceof Error ? error.message : String(error);
}

export function displayMessage(value: DisplayMessage): string {
  if (typeof value === 'string') return value;
  if ('key' in value) return t(value.key, value.values);

  const key = Object.hasOwn(BUSINESS_KEYS, value.code)
    ? BUSINESS_KEYS[value.code as keyof typeof BUSINESS_KEYS]
    : undefined;
  return key ? t(key, value.params) : value.message;
}
