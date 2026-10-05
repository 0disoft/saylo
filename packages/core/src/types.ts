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
  /** Canonical schema encoding: exact equality, independent of message text. */
  readonly fingerprint: string;
  readonly keys: Readonly<Record<string, MessageSchema>>;
}

export type DiagnosticCode =
  | 'INVALID_LOCALE' | 'INVALID_NAMESPACE' | 'INVALID_JSON'
  | 'INVALID_CATALOG' | 'INVALID_ID' | 'DUPLICATE_ID'
  | 'INVALID_ICU' | 'ARGUMENT_CONFLICT' | 'NAMESPACE_MISMATCH'
  | 'UNKNOWN_MESSAGE' | 'UNKNOWN_ARGUMENT' | 'ARGUMENT_TYPE_NARROWING';

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
