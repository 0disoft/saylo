import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import type { NamespaceNotLoadedError, UnknownMessageError } from './translation-errors.js';

export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

export type ArgumentType = 'string' | 'number' | 'date';

export interface ArgumentSchema {
  readonly required: true;
  readonly acceptedTypes: readonly ArgumentType[];
}

export type MessageSchema = Readonly<Record<string, ArgumentSchema>>;

export interface CatalogOptions {
  readonly locale: string;
  readonly namespace: string;
  readonly sourceName?: string;
  /** Opt-in rich message IDs and allowed tags, e.g. { terms: ['link'] }. Other messages remain literal. */
  readonly richText?: Readonly<Record<string, readonly string[]>> | undefined;
}

export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface ParsedMessage {
  readonly source: string;
  readonly position: SourcePosition;
  readonly ast: DeepReadonly<MessageFormatElement[]>;
  readonly arguments: MessageSchema;
  /** Presence opts this message into acceptance-time rich text validation, including an empty allowlist. */
  readonly richTextTags?: readonly string[];
}

/** Parser output, before render records, versions, or store state are added. */
export interface ParsedCatalog {
  readonly locale: string;
  readonly namespace: string;
  readonly sourceName: string;
  readonly messages: Readonly<Record<string, ParsedMessage>>;
}

export interface CatalogSchema {
  readonly baseLocale: string;
  readonly namespace: string;
  /** SHA-256 of namespace, keys, arguments and optional rich contracts, independent of message text. */
  readonly fingerprint: string;
  readonly keys: Readonly<Record<string, MessageSchema>>;
  readonly richTextTags?: Readonly<Record<string, readonly string[]>>;
}

export type DiagnosticCode =
  | 'INVALID_LOCALE' | 'INVALID_NAMESPACE' | 'INVALID_JSON'
  | 'INVALID_CATALOG' | 'INVALID_ID' | 'DUPLICATE_ID'
  | 'INVALID_ICU' | 'INVALID_RICH_TEXT' | 'ARGUMENT_CONFLICT' | 'NAMESPACE_MISMATCH'
  | 'UNKNOWN_MESSAGE' | 'UNKNOWN_ARGUMENT' | 'ARGUMENT_TYPE_NARROWING'
  | 'MISSING_MESSAGE' | 'MISSING_NAMESPACE'
  | 'DUPLICATE_CATALOG' | 'LOCALE_MISMATCH';

export type Schema = Record<string, Record<string, unknown>>;

export type TypedCall<S extends Schema> = {
  [K in keyof S & string]: keyof S[K] extends never ? [key: K] : [key: K, args: S[K]]
}[keyof S & string];

export type Translate<S extends Schema> = string extends keyof S
  ? (key: string, args?: Record<string, unknown>) => string
  : (...call: TypedCall<S>) => string;

export type RichTextPart =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'tag'; readonly name: string; readonly children: readonly RichTextPart[] };

export type TranslateParts<S extends Schema> = string extends keyof S
  ? (key: string, args?: Record<string, unknown>) => readonly RichTextPart[]
  : (...call: TypedCall<S>) => readonly RichTextPart[];

export type TranslationErrorSurface = 'text' | 'parts';

export interface TranslationErrorContext<E extends Error = Error> {
  /** The original error thrown by translation. */
  readonly error: E;
  readonly key: string;
  readonly locale: string;
  readonly baseLocale: string;
  readonly namespace?: string;
  readonly messageId?: string;
  readonly surface: TranslationErrorSurface;
}

export interface MissingKeyErrorContext extends TranslationErrorContext<UnknownMessageError | NamespaceNotLoadedError> {}

export interface FormatErrorContext extends TranslationErrorContext {
  readonly argument?: string;
}

export type MissingKeyHandler = (context: MissingKeyErrorContext) => string | undefined;
export type FormatErrorHandler = (context: FormatErrorContext) => string | undefined;

export interface TranslationErrorPolicy {
  readonly onMissingKey?: MissingKeyHandler;
  readonly onFormatError?: FormatErrorHandler;
}

export interface LocaleFallbackOptions {
  /** Opt-in parent locales, tried in order after the selected locale and before `baseLocale`. */
  readonly fallbackLocales?: readonly string[];
}

/** A synchronous translator bound to one set of immutable parsed catalogs. */
export interface TranslatorOptions extends TranslationErrorPolicy, LocaleFallbackOptions {
  readonly locale: string;
  readonly baseCatalogs: readonly ParsedCatalog[];
  /** Catalogs for the selected locale or configured fallback locales. */
  readonly translations?: readonly ParsedCatalog[];
  readonly timeZone?: string;
}

export interface Translator<S extends Schema = Schema> {
  readonly locale: string;
  readonly baseLocale: string;
  readonly timeZone: string;
  readonly t: Translate<S>;
  readonly tParts: TranslateParts<S>;
}

/** Shared UI snapshot. Lazy instances can load a subset of the namespace manifest. */
export interface StoreSnapshot<S extends Schema = Schema> extends Translator<S> {
  readonly stateRevision: number;
  readonly availableLocales: readonly string[];
  readonly availableNamespaces: readonly string[];
  readonly loadedNamespaces: readonly string[];
}

export interface StoreOptions extends TranslationErrorPolicy, LocaleFallbackOptions {
  readonly baseLocale: string;
  readonly locale: string;
  readonly catalogs: readonly ParsedCatalog[];
  readonly timeZone?: string;
}

export interface Store<S extends Schema = Schema> {
  /** Reads the latest committed snapshot; snapshot.t stays bound to that snapshot. */
  readonly t: Translate<S>;
  readonly tParts: TranslateParts<S>;
  getSnapshot(): StoreSnapshot<S>;
  subscribe(listener: (snapshot: StoreSnapshot<S>) => void): () => void;
  /** Adapters register owned resource cleanup; removing the listener is idempotent. */
  onDispose(listener: () => void): () => void;
  /** Replaces the whole eager registry. Invalid candidates leave the current state intact. */
  replaceCatalogs(catalogs: readonly ParsedCatalog[]): void;
  setLocale(locale: string): void;
  dispose(): void;
}

export interface CatalogDiagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly sourceName: string;
  readonly locale: string;
  readonly namespace: string;
  readonly id?: string;
  readonly argument?: string;
  readonly position?: SourcePosition;
}
