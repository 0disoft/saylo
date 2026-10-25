import type { CatalogOutcome, ParsedCatalog } from '@0disoft/saylo-core';
import { encodeCatalog } from '@0disoft/saylo-core';
import { gzipSync } from 'node:zlib';
import type { CatalogRegistry } from './catalog-registry.js';
import { catalogId } from './catalog-outcome.js';

export const VIRTUAL = 'virtual:saylo';
export const RESOLVED = `\0${VIRTUAL}`;
export const LAZY = 'virtual:saylo/lazy';
export const RESOLVED_LAZY = `\0${LAZY}`;
export const SERVER = 'virtual:saylo/server';
export const RESOLVED_SERVER = `\0${SERVER}`;
export const CHUNK = 'virtual:saylo/catalog/';

interface VirtualModuleContext {
  readonly production: boolean;
  readonly compactCatalogs?: boolean;
  readonly sessionId: string;
  readonly baseLocale: string;
  readonly initialLocale: string;
  readonly timeZone: string;
  readonly initialNamespaces: readonly string[] | undefined;
  readonly registry: Pick<CatalogRegistry, 'manifest' | 'load'>;
  readonly chunks: ReadonlyMap<string, CatalogOutcome>;
  readonly catalogs: readonly ParsedCatalog[];
  readonly buildCatalogs: readonly ParsedCatalog[] | undefined;
}

function encode(value: unknown): string {
  const json = JSON.stringify(value).replace(/</g, '\\u003c');
  // A literal __proto__ property sets an object's prototype in emitted JS.
  // JSON parsing preserves it as an own message key without ICU reparsing.
  return json.includes('"__proto__":') ? `JSON.parse(${JSON.stringify(json)})` : json;
}

const COMPACTION_POLICY = Object.freeze({ minimumRawSaving: 16 * 1024, decoderGzipBudget: 2048 });
const rendered = new WeakMap<ReturnType<typeof encodeCatalog>, { source: string; compact: boolean }>();

function catalogExpression(catalog: ParsedCatalog, enabled: boolean) {
  if (!enabled) return { source: encode(catalog), compact: false };
  const packed = encodeCatalog(catalog), previous = rendered.get(packed);
  if (previous) return previous;
  const expanded = encode(catalog);
  const compact = encode(packed);
  const worthwhile = Buffer.byteLength(expanded) - Buffer.byteLength(compact) >= COMPACTION_POLICY.minimumRawSaving
    && gzipSync(expanded).byteLength - gzipSync(compact).byteLength > COMPACTION_POLICY.decoderGzipBudget;
  const result = { source: worthwhile ? `decodeCatalog(${compact})` : expanded, compact: worthwhile };
  rendered.set(packed, result);
  return result;
}

export function renderCatalogChunk(outcome: CatalogOutcome, compact = true): string {
  if (outcome.status !== 'present') return `export default ${encode(outcome)};`;
  const catalog = catalogExpression(outcome.catalog, compact);
  return `${catalog.compact ? "import { decodeCatalog } from '@0disoft/saylo-core/runtime';\n" : ''}export default { ...${encode(outcomeMetadata(outcome))}, catalog: ${catalog.source} };`;
}

function outcomeMetadata(outcome: Extract<CatalogOutcome, { status: 'present' }>) {
  const { catalog, ...metadata } = outcome;
  return metadata;
}

function outcomeExpressions(outcomes: readonly CatalogOutcome[], enabled: boolean) {
  let compact = false;
  const source = `[${outcomes.map(outcome => {
    if (outcome.status !== 'present') return encode(outcome);
    const catalog = catalogExpression(outcome.catalog, enabled);
    compact ||= catalog.compact;
    return `{ ...${encode(outcomeMetadata(outcome))}, catalog: ${catalog.source} }`;
  }).join(',')}]`;
  return { source, compact };
}

function renderDevServer({ sessionId, initialLocale, timeZone, initialNamespaces }: VirtualModuleContext): string {
  return `import { getServerCatalogSource } from '@0disoft/saylo-vite/server';
import { createServerI18n } from '@0disoft/saylo-core';
export const catalogSource = getServerCatalogSource(${encode(sessionId)});
export const createRequestI18n = (options = {}) => createServerI18n({
  locale: ${encode(initialLocale)}, timeZone: ${encode(timeZone)},
  initialNamespaces: ${initialNamespaces ? encode(initialNamespaces) : 'catalogSource.readManifest().availableNamespaces'},
  ...options, catalogSource });`;
}

function renderLazyModule(context: VirtualModuleContext, server: boolean): string {
  const { registry, baseLocale, initialLocale, initialNamespaces, chunks, production, timeZone } = context;
  const manifest = registry.manifest();
  const locale = manifest.availableLocales.includes(initialLocale) ? initialLocale : baseLocale;
  const namespaces = [...new Set(initialNamespaces ?? manifest.availableNamespaces)].sort();
  if (namespaces.length !== (initialNamespaces?.length ?? namespaces.length) || namespaces.some(n => !manifest.availableNamespaces.includes(n)))
    throw new RangeError('initialNamespaces must be unique available base namespaces.');
  const outcomes = namespaces.flatMap(namespace => [...new Set([baseLocale, locale])].map(locale => registry.load(locale, namespace)));
  const bootPairs = new Set(outcomes.map(outcome => catalogId(outcome.key)));
  const loaders = [...chunks].filter(([, outcome]) => !bootPairs.has(catalogId(outcome.key)))
    .map(([moduleId, outcome]) => `{ key: ${encode(outcome.key)}, load: () => import(${encode(moduleId)}).then(module => module.default) }`);
  const boot = production ? outcomeExpressions(outcomes, context.compactCatalogs !== false) : { source: encode(outcomes), compact: false };
  return `import { ${production ? 'createStaticCatalogSource' : 'createDevCatalogSource'} } from '@0disoft/saylo-vite/client';
${boot.compact ? "import { decodeCatalog } from '@0disoft/saylo-core/runtime';" : ''}
export const initialCatalogs = ${boot.source};
export const initialLocale = ${encode(locale)};
export const initialNamespaces = ${encode(namespaces)};
export const timeZone = ${encode(timeZone)};
export const catalogSource = ${production ? `createStaticCatalogSource(${encode(manifest)}, initialCatalogs, [${loaders.join(',\n')}])`
    : `createDevCatalogSource(${encode(manifest)}, initialCatalogs, { hot: import.meta.hot, push: true })`};
${server ? `import { createServerI18n } from '@0disoft/saylo-core';
export const createRequestI18n = (options = {}) => createServerI18n({ locale: initialLocale, timeZone,
  initialNamespaces, ...options, catalogSource });` : ''}`;
}

/** Source generation owns no watcher, worker, transport or Vite plugin lifetime. */
export function renderVirtualModule(id: string, context: VirtualModuleContext): string | undefined {
  if (id === RESOLVED_SERVER && !context.production) return renderDevServer(context);
  if (id === RESOLVED_LAZY || id === RESOLVED_SERVER) return renderLazyModule(context, id === RESOLVED_SERVER);
  if (id !== RESOLVED) return;
  const { catalogs, buildCatalogs, baseLocale, initialLocale, timeZone } = context;
  const expressions = context.production ? (buildCatalogs ?? catalogs).map(catalog => catalogExpression(catalog, context.compactCatalogs !== false)) : [];
  return `import { freezeCatalogs } from '@0disoft/saylo-vite/client';
${expressions.some(catalog => catalog.compact) ? "import { decodeCatalog } from '@0disoft/saylo-core/runtime';" : ''}
export const initialCatalogs = freezeCatalogs(${context.production ? `[${expressions.map(catalog => catalog.source).join(',')}]` : encode(buildCatalogs ?? catalogs)});
export const baseLocale = ${JSON.stringify(baseLocale)};
export const initialLocale = ${JSON.stringify(catalogs.some(c => c.locale === initialLocale) ? initialLocale : baseLocale)};
export const timeZone = ${JSON.stringify(timeZone)};`;
}
