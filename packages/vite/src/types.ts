import type { CatalogDiagnostic, ParsedCatalog } from '@saylo/core';

export interface SayloViteOptions {
  /** Relative to Vite root: <localesDir>/<locale>/<namespace>.json. */
  readonly localesDir: string;
  readonly baseLocale: string;
  readonly initialLocale?: string;
  readonly timeZone?: string;
  /** Declaration file relative to Vite root. Startup awaits it; live updates do not. */
  readonly typegen?: { readonly outFile: string };
}

/** Temporary eager transport, before the partial-update protocol in docs/08. */
export interface EagerCatalogSnapshot {
  readonly sessionId: string;
  readonly revision: number;
  readonly baseLocale: string;
  readonly catalogs: readonly ParsedCatalog[];
}

export interface LiveDiagnostic {
  readonly message: string;
  readonly diagnostics: readonly CatalogDiagnostic[];
}

export const SNAPSHOT_EVENT = 'saylo:eager-snapshot';
export const REQUEST_EVENT = 'saylo:request-eager-snapshot';
export const DIAGNOSTIC_EVENT = 'saylo:eager-diagnostic';
