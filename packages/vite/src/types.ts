import type { CatalogDiagnostic, CatalogManifest, CatalogMetadata, CatalogOptions, ParsedCatalog } from '@0disoft/saylo-core';
import type { CatalogStamp } from './catalog-patch.js';
import type { CatalogWireResult } from './catalog-wire.js';
import type { AutoIncludeKeys } from './auto-keys.js';

export interface SayloViteOptions {
  /** Relative to Vite root: <localesDir>/<locale>/<namespace>.json. */
  readonly localesDir: string;
  readonly baseLocale: string;
  readonly initialLocale?: string;
  /** Scope exported by virtual:saylo/lazy. Defaults to every base namespace. */
  readonly initialNamespaces?: readonly string[];
  readonly timeZone?: string;
  /** Namespace -> message ID -> allowed rich text tags. E.g. { common: { terms: ['link'] } }. */
  readonly richText?: Readonly<Record<string, NonNullable<CatalogOptions['richText']>>>;
  /** Production-only parser removal scoped to Saylo's AST formatter. Defaults to true. */
  readonly astRuntime?: boolean;
  /** Production-only lossless compaction when savings cover the decoder. Defaults to true. */
  readonly compactCatalogs?: boolean;
  /** Build-only exact namespace:messageId list. Undefined keeps all messages; [] keeps none. */
  readonly includeKeys?: readonly string[] | AutoIncludeKeys;
  /** Build-only: every discovered locale and initialLocale must cover all base namespaces/keys. Defaults to false. */
  readonly requireCompleteTranslations?: boolean;
  /** Build-only: require complete translations and current explicit approvals. Defaults to false. */
  readonly requireReviewedTranslations?: boolean;
  /** Approval ledger relative to Vite root; required when requireReviewedTranslations is true. */
  readonly reviews?: string;
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
  /** Local client operation; server catalog diagnostics leave this unset. */
  readonly operation?: 'handshake' | 'observer';
  readonly request?: EagerSnapshotRequest;
}

export const SNAPSHOT_EVENT = 'saylo:eager-snapshot';
export const REQUEST_EVENT = 'saylo:request-eager-snapshot';
export const DIAGNOSTIC_EVENT = 'saylo:eager-diagnostic';

export type ManifestEvent = { readonly manifest: CatalogManifest } & (
  | { readonly kind: 'snapshot'; readonly request: EagerSnapshotRequest }
  | { readonly kind: 'update'; readonly baseRevision: number }
);
export interface CatalogScope {
  readonly owner: string;
  readonly sessionId: string;
  readonly catalogs: readonly CatalogMetadata[];
}
/** One manifest revision and all changed payloads in an explicitly subscribed scope. */
export interface CatalogPush {
  readonly kind: 'patch';
  readonly owner: string;
  readonly baseRevision: number;
  readonly manifest: CatalogManifest;
  readonly outcomes: readonly CatalogWireResult[];
}
export interface CatalogRequest {
  readonly requestId: string;
  readonly generation: number;
  readonly locale: string;
  readonly namespace: string;
  /** Last accepted present pair. Omit to force a full response. */
  readonly known?: CatalogStamp;
}
export interface CatalogReply {
  readonly request: CatalogRequest;
  readonly result: CatalogWireResult;
}
export function isCatalogRequest(value: unknown): value is CatalogRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as CatalogRequest;
  if (!isSnapshotRequest({ ...request, scope: 'eager', namespaces: [request.namespace] })) return false;
  if (request.known !== undefined && (!request.known || typeof request.known.sessionId !== 'string' || !request.known.sessionId ||
      !Number.isSafeInteger(request.known.catalogVersion) || request.known.catalogVersion < 1)) return false;
  return request.namespace !== '.' && request.namespace !== '..' && !/[:/\\\x00-\x1f]/.test(request.namespace);
}
export const MANIFEST_EVENT = 'saylo:manifest';
export const MANIFEST_REQUEST_EVENT = 'saylo:request-manifest';
export const CATALOG_REQUEST_EVENT = 'saylo:request-catalog';
export const CATALOG_EVENT = 'saylo:catalog';
export const CATALOG_SCOPE_EVENT = 'saylo:catalog-scope';
export const CATALOG_PUSH_EVENT = 'saylo:catalog-push';
