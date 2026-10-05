import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';

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
  /** SHA-256 of the canonical namespace/key/argument schema, independent of message text. */
  readonly fingerprint: string;
  readonly keys: Readonly<Record<string, MessageSchema>>;
}

export type DiagnosticCode =
  | 'INVALID_LOCALE' | 'INVALID_NAMESPACE' | 'INVALID_JSON'
  | 'INVALID_CATALOG' | 'INVALID_ID' | 'DUPLICATE_ID'
  | 'INVALID_ICU' | 'ARGUMENT_CONFLICT' | 'NAMESPACE_MISMATCH'
  | 'UNKNOWN_MESSAGE' | 'UNKNOWN_ARGUMENT' | 'ARGUMENT_TYPE_NARROWING'
  | 'DUPLICATE_CATALOG' | 'LOCALE_MISMATCH';

export type Schema = Record<string, Record<string, unknown>>;

export type TypedCall<S extends Schema> = {
  [K in keyof S & string]: keyof S[K] extends never ? [key: K] : [key: K, args: S[K]]
}[keyof S & string];

export type Translate<S extends Schema> = string extends keyof S
  ? (key: string, args?: Record<string, unknown>) => string
  : (...call: TypedCall<S>) => string;

/** A synchronous translator bound to one set of immutable parsed catalogs. */
export interface TranslatorOptions {
  readonly locale: string;
  readonly baseCatalogs: readonly ParsedCatalog[];
  /** Only catalogs for the selected locale; missing namespaces fall back to base. */
  readonly translations?: readonly ParsedCatalog[];
  readonly timeZone?: string;
}

export interface Translator<S extends Schema = Schema> {
  readonly locale: string;
  readonly baseLocale: string;
  readonly timeZone: string;
  readonly t: Translate<S>;
}

/** Shared UI snapshot. Lazy instances can load a subset of the namespace manifest. */
export interface StoreSnapshot<S extends Schema = Schema> extends Translator<S> {
  readonly stateRevision: number;
  readonly availableLocales: readonly string[];
  readonly availableNamespaces: readonly string[];
  readonly loadedNamespaces: readonly string[];
}

export interface StoreOptions {
  readonly baseLocale: string;
  readonly locale: string;
  readonly catalogs: readonly ParsedCatalog[];
  readonly timeZone?: string;
}

export interface Store<S extends Schema = Schema> {
  /** Reads the latest committed snapshot; snapshot.t stays bound to that snapshot. */
  readonly t: Translate<S>;
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
