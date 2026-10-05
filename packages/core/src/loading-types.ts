import type { ParsedCatalog, Schema, StoreSnapshot, Translate } from './types.js';
import type { BootSnapshot } from './boot.js';

export interface CatalogKey {
  readonly locale: string;
  readonly namespace: string;
}

/** Includes missing tombstones so an old load cannot resurrect a deleted catalog. */
export type CatalogMetadata = { readonly key: CatalogKey; readonly catalogVersion: number } & (
  | { readonly status: 'present'; readonly namespaceSchemaFingerprint: string }
  | { readonly status: 'missing' }
);

export interface CatalogManifest {
  readonly sessionId: string;
  readonly registryRevision: number;
  readonly baseLocale: string;
  readonly availableLocales: readonly string[];
  readonly availableNamespaces: readonly string[];
  /** Complete known pair metadata; never-seen missing pairs have version zero. */
  readonly catalogs: readonly CatalogMetadata[];
}

/** Versioned parsed catalogs shared by development, production chunks and SSR boot data. */
export type CatalogOutcome = { readonly sessionId: string } & (
  | { readonly status: 'present'; readonly key: CatalogKey; readonly catalogVersion: number;
      readonly namespaceSchemaFingerprint: string; readonly catalog: ParsedCatalog }
  | { readonly status: 'missing'; readonly key: CatalogKey; readonly catalogVersion: number }
);

export type CatalogLoadResult = CatalogOutcome | { readonly status: 'failed'; readonly code: string; readonly message: string };

export interface CatalogSource {
  readManifest(): CatalogManifest;
  /** An ignored AbortSignal is still guarded by core timeout and disposal. */
  loadCatalog(locale: string, namespace: string, signal?: AbortSignal): Promise<CatalogLoadResult>;
}

interface SharedI18nOptions {
  readonly catalogSource: CatalogSource;
  readonly timeZone?: string;
  /** Per-catalog timeout, defaults to 5000ms. */
  readonly requestTimeoutMs?: number;
  /** Subscriber errors from automatic manifest adoption without a pending API caller. */
  readonly onError?: (error: AggregateError) => void;
}

export type CreateI18nOptions = SharedI18nOptions & (
  | { readonly locale: string; readonly initialNamespaces: readonly string[];
      readonly initialCatalogs: readonly CatalogOutcome[]; readonly initialSnapshot?: never }
  | { readonly initialSnapshot: BootSnapshot; readonly locale?: never; readonly initialNamespaces?: never;
      readonly initialCatalogs?: never }
);

export interface I18n<S extends Schema = Schema> {
  readonly t: Translate<S>;
  getSnapshot(): StoreSnapshot<S>;
  /** Immutable initial snapshot for server rendering and client hydration. */
  getServerSnapshot(): StoreSnapshot<S>;
  /** Exact committed scope and pair stamps; excludes in-flight desired state. */
  getBootSnapshot(): BootSnapshot;
  getLocales(): readonly string[];
  getNamespaces(): readonly string[];
  subscribe(listener: (snapshot: StoreSnapshot<S>) => void): () => void;
  onDispose(listener: () => void): () => void;
  setLocale(locale: string): Promise<void>;
  loadNamespace(namespace: string): Promise<void>;
  /** Adapter hook: refresh current desired scope after a manifest/version change. */
  refresh(): Promise<void>;
  dispose(): void;
}
