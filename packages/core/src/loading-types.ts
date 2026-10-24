import type { ParsedCatalog, Schema, StoreSnapshot, Translate, TranslateParts } from './types.js';
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
  /** At most eight unsettled calls per i18n instance. Ignored aborts retain their slots. */
  loadCatalog(locale: string, namespace: string, signal?: AbortSignal): Promise<CatalogLoadResult>;
}

/** Must defer callbacks and return an idempotent timer cancellation function. */
export type CatalogSchedule = (milliseconds: number, callback: () => void) => () => void;

export interface I18nRequestOptions {
  /** Cancels this caller's wait; the shared desired state and catalog load continue. */
  readonly signal?: AbortSignal;
}

interface SharedI18nOptions {
  readonly catalogSource: CatalogSource;
  readonly timeZone?: string;
  /** Per-catalog timeout including queue wait, defaults to 5000ms. */
  readonly requestTimeoutMs?: number;
  /** Optional per-instance scheduler; defaults to setTimeout/clearTimeout. */
  readonly schedule?: CatalogSchedule;
  /** Aborting the instance lifetime disposes its owned loads and subscriptions. */
  readonly signal?: AbortSignal;
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
  readonly tParts: TranslateParts<S>;
  getSnapshot(): StoreSnapshot<S>;
  /** Immutable initial snapshot for server rendering and client hydration. */
  getServerSnapshot(): StoreSnapshot<S>;
  /** Exact committed scope and pair stamps; excludes in-flight desired state. */
  getBootSnapshot(): BootSnapshot;
  getLocales(): readonly string[];
  getNamespaces(): readonly string[];
  subscribe(listener: (snapshot: StoreSnapshot<S>) => void): () => void;
  onDispose(listener: () => void): () => void;
  setLocale(locale: string, options?: I18nRequestOptions): Promise<void>;
  loadNamespace(namespace: string, options?: I18nRequestOptions): Promise<void>;
  /** Replace required namespaces atomically; cached catalogs remain reusable. Cancels superseded scope waits. */
  setNamespaces(namespaces: readonly string[], options?: I18nRequestOptions): Promise<void>;
  /** Adapter hook: refresh current desired scope after a manifest/version change. */
  refresh(options?: I18nRequestOptions): Promise<void>;
  dispose(): void;
}
