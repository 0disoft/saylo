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

interface EagerRegistry {
  readonly sessionId: string;
  readonly revision: number;
  readonly baseLocale: string;
  readonly catalogs: readonly ParsedCatalog[];
}

/** Request identity is client-owned; registry revisions are server-owned. */
export interface EagerSnapshotRequest {
  readonly scope: 'eager';
  readonly requestId: string;
  readonly generation: number;
  readonly locale: string;
  readonly namespaces: readonly string[];
}

/** Whole-registry replacement until lazy catalog transport is introduced. */
export interface EagerCatalogSnapshot extends EagerRegistry {
  readonly kind: 'snapshot';
  readonly request: EagerSnapshotRequest;
}

export interface EagerCatalogUpdate extends EagerRegistry {
  readonly kind: 'update';
  readonly baseRevision: number;
}

export type EagerCatalogEvent = EagerCatalogSnapshot | EagerCatalogUpdate;

export function isSnapshotRequest(value: unknown): value is EagerSnapshotRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as EagerSnapshotRequest;
  if (request.scope !== 'eager' || typeof request.requestId !== 'string' || !request.requestId ||
      !Number.isSafeInteger(request.generation) || request.generation < 1 ||
      typeof request.locale !== 'string' || !request.locale || !Array.isArray(request.namespaces) ||
      !request.namespaces.every(n => typeof n === 'string' && n.length > 0) ||
      new Set(request.namespaces).size !== request.namespaces.length) return false;
  try { return Intl.getCanonicalLocales(request.locale)[0] === request.locale; }
  catch { return false; }
}

export interface LiveDiagnostic {
  readonly message: string;
  readonly diagnostics: readonly CatalogDiagnostic[];
  readonly request?: EagerSnapshotRequest;
}

export const SNAPSHOT_EVENT = 'saylo:eager-snapshot';
export const REQUEST_EVENT = 'saylo:request-eager-snapshot';
export const DIAGNOSTIC_EVENT = 'saylo:eager-diagnostic';
