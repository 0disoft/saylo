import { InvalidArgumentError } from './translation-errors.js';
import type {
  FormatErrorContext, FormatErrorHandler, MissingKeyErrorContext, MissingKeyHandler,
  RichTextPart, TranslationErrorPolicy, TranslationErrorSurface,
} from './types.js';

interface CapturedTranslationErrorPolicy {
  readonly onMissingKey?: MissingKeyHandler;
  readonly onFormatError?: FormatErrorHandler;
}

/** Read callbacks once so later option mutation cannot change a bound snapshot. */
export function captureErrorPolicy(options: TranslationErrorPolicy): CapturedTranslationErrorPolicy | undefined {
  const onMissingKey = options.onMissingKey;
  const onFormatError = options.onFormatError;
  if (!onMissingKey && !onFormatError) return undefined;
  return Object.freeze({
    ...(onMissingKey ? { onMissingKey } : {}),
    ...(onFormatError ? { onFormatError } : {}),
  });
}

function address(key: string): { namespace?: string; messageId?: string } {
  const separator = key.indexOf(':');
  if (separator <= 0 || separator === key.length - 1 || key.indexOf(':', separator + 1) !== -1) return {};
  return { namespace: key.slice(0, separator), messageId: key.slice(separator + 1) };
}

function context<E extends Error>(error: E, key: string,
  locale: string, baseLocale: string, surface: TranslationErrorSurface): { error: E; key: string; locale: string;
    baseLocale: string; namespace?: string; messageId?: string; surface: TranslationErrorSurface } {
  return { error, key, locale, baseLocale, surface, ...address(key) };
}

function fallback(value: unknown, name: 'onMissingKey' | 'onFormatError',
  surface: TranslationErrorSurface): string | readonly RichTextPart[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new TypeError(`${name} must return a string or undefined.`);
  if (surface === 'parts') return Object.freeze([Object.freeze({ type: 'text' as const, value })]);
  return value;
}

export function missingKeyFallback(policy: CapturedTranslationErrorPolicy | undefined, error: MissingKeyErrorContext['error'],
  key: string, locale: string, baseLocale: string, surface: TranslationErrorSurface): string | readonly RichTextPart[] | undefined {
  if (!policy?.onMissingKey) return undefined;
  const callbackContext: MissingKeyErrorContext = context(error, key, locale, baseLocale, surface);
  return fallback(policy.onMissingKey(callbackContext), 'onMissingKey', surface);
}

export function formatErrorFallback(policy: CapturedTranslationErrorPolicy | undefined, error: Error,
  key: string, locale: string, baseLocale: string, surface: TranslationErrorSurface): string | readonly RichTextPart[] | undefined {
  if (!policy?.onFormatError) return undefined;
  const base = context(error, key, locale, baseLocale, surface);
  const callbackContext: FormatErrorContext = error instanceof InvalidArgumentError && error.argument !== undefined
    ? { ...base, argument: error.argument } : base;
  return fallback(policy.onFormatError(callbackContext), 'onFormatError', surface);
}
