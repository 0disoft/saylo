import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createBaseSchema, createStore } from '@0disoft/saylo-core';
import { isGeneratedFile, TypeGenerator } from '@0disoft/saylo-typegen';
import type { Plugin, ViteDevServer, WebSocketClient } from 'vite';
import { CatalogRegistry } from './catalog-registry.js';
import { encodeCatalogResult } from './catalog-wire.js';
import { readCatalogFile, scanCatalogs } from './catalog-files.js';
import type { CatalogFile } from './catalog-files.js';
import { LiveRegistry } from './live-registry.js';
import { diagnosticMessage } from './diagnostic-observers.js';
import { catalogId } from './catalog-outcome.js';
import { createAstFormatter } from './ast-formatter.js';
import { requireCompleteTranslations } from './complete-translations.js';
import { readIncludedKeys, selectBuildCatalogs } from './build-keys.js';
import { findIncludedKeys, readAutoKeys } from './auto-keys.js';
import { CatalogPushSubscriptions } from './catalog-push.js';
import type { CatalogOutcome, ParsedCatalog } from '@0disoft/saylo-core';
import { registerServerSource } from './server-source.js';
import { CATALOG_EVENT, CATALOG_PUSH_EVENT, CATALOG_SCOPE_EVENT, CATALOG_REQUEST_EVENT, DIAGNOSTIC_EVENT, MANIFEST_EVENT, MANIFEST_REQUEST_EVENT,
  REQUEST_EVENT, SNAPSHOT_EVENT, isCatalogRequest, isSnapshotRequest } from './types.js';
import type { EagerCatalogUpdate, LiveDiagnostic, SayloViteOptions } from './types.js';

const VIRTUAL = 'virtual:saylo';
const RESOLVED = `\0${VIRTUAL}`;
const LAZY = 'virtual:saylo/lazy';
const RESOLVED_LAZY = `\0${LAZY}`;
const SERVER = 'virtual:saylo/server';
const RESOLVED_SERVER = `\0${SERVER}`;
const CHUNK = 'virtual:saylo/catalog/';
const encode = (value: unknown) => {
  const json = JSON.stringify(value).replace(/</g, '\\u003c');
  // A literal __proto__ property sets an object's prototype in emitted JS.
  // JSON parsing preserves it as an own message key without ICU reparsing.
  return json.includes('"__proto__":') ? `JSON.parse(${JSON.stringify(json)})` : json;
};

export default function saylo(options: SayloViteOptions): Plugin {
  const autoKeys = readAutoKeys(options.includeKeys);
  const includeKeys = autoKeys ? undefined : readIncludedKeys(options.includeKeys);
  const richText = options.richText === undefined ? undefined : structuredClone(options.richText);
  if (options.requireCompleteTranslations !== undefined && typeof options.requireCompleteTranslations !== 'boolean') {
    throw new TypeError('requireCompleteTranslations must be a boolean.');
  }
  const baseLocale = Intl.getCanonicalLocales(options.baseLocale)[0] ?? '';
  if (!baseLocale) throw new RangeError('baseLocale must not be empty.');
  const initialLocale = Intl.getCanonicalLocales(options.initialLocale ?? baseLocale)[0]!;
  if (!initialLocale) throw new RangeError('initialLocale must not be empty.');
  const timeZone = options.timeZone ?? 'UTC';
  const sessionId = randomUUID();
  const astFormatter = createAstFormatter();
  let root = '';
  let files = new Map<string, CatalogFile>();
  let registry: CatalogRegistry;
  let production = false;
  let buildCatalogs: readonly ParsedCatalog[] | undefined;
  const keySources = new Set<string>();
  let builds = 0;
  const chunks = new Map<string, CatalogOutcome>();
  let revision = 0;
  let server: ViteDevServer | undefined;
  let live: LiveRegistry | undefined;
  let typegen: TypeGenerator | undefined;
  let typegenPending = false;
  let typegenRequest = 0;
  let generatedOut: string | undefined;
  let removeServerSource: (() => void) | undefined;
  const isTypegenFile = (file: string) => generatedOut !== undefined && isGeneratedFile(generatedOut, file);
  let diagnostic: LiveDiagnostic = { message: '', diagnostics: [] };
  let eagerClients = new WeakSet<WebSocketClient>();
  const pushes = new CatalogPushSubscriptions();
  const deliverUpdate = (send: () => void) => {
    try { send(); }
    catch (error) {
      try { server?.config.logger.warn(`[saylo:transport] ${diagnosticMessage(error)}`); } catch { /* Logging cannot interrupt another client or typegen. */ }
    }
  };
  const subscribeCatalogs: Parameters<ViteDevServer['ws']['on']>[1] = (data, client) => {
    try { pushes.subscribe(client, data); }
    catch { client.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: { message: 'Invalid catalog push subscription.', diagnostics: [] } }); }
  };
  const snapshot = () => ({ sessionId, revision, baseLocale, catalogs: [...files.values()].map(f => f.catalog) });
  const request: Parameters<ViteDevServer['ws']['on']>[1] = (data, client) => {
    if (!isSnapshotRequest(data)) {
      client.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: { message: 'Invalid eager snapshot request.', diagnostics: [] } });
      return;
    }
    eagerClients.add(client);
    client.send({ type: 'custom', event: SNAPSHOT_EVENT, data: { ...snapshot(), kind: 'snapshot', request: data } });
    client.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: { ...diagnostic, request: data } });
  };
  const requestManifest: Parameters<ViteDevServer['ws']['on']>[1] = (data, client) => {
    if (!isSnapshotRequest(data)) return;
    client.send({ type: 'custom', event: MANIFEST_EVENT, data: { kind: 'snapshot', request: data, manifest: registry.manifest() } });
    client.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: { ...diagnostic, request: data } });
  };
  const requestCatalog: Parameters<ViteDevServer['ws']['on']>[1] = (data, client) => {
    if (!isCatalogRequest(data)) {
      client.send({ type: 'custom', event: CATALOG_EVENT, data: { request: data,
        result: { status: 'failed', code: 'INVALID_REQUEST', message: 'Invalid catalog request.' } } });
      return;
    }
    client.send({ type: 'custom', event: CATALOG_EVENT, data: { request: data,
      result: encodeCatalogResult(registry.loadDelta(data.locale, data.namespace, data.known)) } });
  };
  const onFile = (file: string) => { void live?.enqueue(file); };
  const onAdd = (file: string) => { void live?.enqueueAdded(file); };
  function detachLive() {
    removeServerSource?.(); removeServerSource = undefined;
    live?.stop();
    server?.watcher.off('add', onAdd);
    server?.watcher.off('unlink', onFile);
    server?.ws.off(REQUEST_EVENT, request);
    server?.ws.off(MANIFEST_REQUEST_EVENT, requestManifest);
    server?.ws.off(CATALOG_REQUEST_EVENT, requestCatalog);
    server?.ws.off(CATALOG_SCOPE_EVENT, subscribeCatalogs);
    pushes.clear();
    eagerClients = new WeakSet();
    server?.httpServer?.off('close', cleanup);
  }
  async function cleanup() {
    detachLive();
    const generator = typegen;
    typegen = undefined;
    typegenPending = false;
    typegenRequest++;
    await generator?.stop();
  }
  async function prepareBuild() {
    keySources.clear();
    if (richText !== undefined) {
      const bases = new Map(snapshot().catalogs.filter(catalog => catalog.locale === baseLocale).map(catalog => [catalog.namespace, catalog]));
      for (const [namespace, messages] of Object.entries(richText)) {
        const base = bases.get(namespace);
        if (!base) throw new RangeError(`Rich text namespace ${JSON.stringify(namespace)} is absent from the base catalogs.`);
        for (const id of Object.keys(messages)) if (!Object.hasOwn(base.messages, id))
          throw new RangeError(`Rich text key ${JSON.stringify(`${namespace}:${id}`)} is absent from the base catalogs.`);
      }
    }
    const selectedKeys = production && autoKeys ? await findIncludedKeys(buildRoot,
      snapshot().catalogs, baseLocale, autoKeys, file => keySources.add(file)) : includeKeys;
    buildCatalogs = production ? selectBuildCatalogs(snapshot().catalogs, baseLocale, selectedKeys) : undefined;
    registry = new CatalogRegistry(sessionId, baseLocale, buildCatalogs ?? snapshot().catalogs);
    chunks.clear();
    if (production) for (const meta of registry.manifest().catalogs) {
      if (meta.status === 'present') chunks.set(`${CHUNK}${encodeURIComponent(meta.key.locale)}/${encodeURIComponent(meta.key.namespace)}`,
        registry.load(meta.key.locale, meta.key.namespace));
    }
  }
  let buildRoot = '';
  return {
    name: 'saylo',
    enforce: 'pre',
    config(config, env) {
      generatedOut = options.typegen ? path.resolve(config.root ?? process.cwd(), options.typegen.outFile) : undefined;
      return { optimizeDeps: { exclude: ['@0disoft/saylo-vite/client'] }, ssr: {
        external: ['@0disoft/saylo-vite/server'],
        // Vite matches noExternal against the package name, not its /client subpath.
        ...(env?.command === 'build' ? { noExternal: ['@0disoft/saylo-vite'] } : {}),
      },
        ...(generatedOut ? { server: { watch: { ignored: [(file: string) => isTypegenFile(file)] } } } : {}) };
    },
    async configResolved(config) {
      buildRoot = config.root;
      const scanned = await scanCatalogs(path.resolve(config.root, options.localesDir), richText);
      root = scanned.root;
      files = new Map(scanned.files.map(f => [f.file, f]));
      production = config.command === 'build';
      // Fresh strict validation for startup and builds, using the same core contracts.
      const strictBuild = production && options.requireCompleteTranslations === true;
      // Check catalog schemas even when strict mode's initial locale has no files;
      // the completeness pass then reports its missing paths instead of a range error.
      createStore({ baseLocale, locale: strictBuild ? baseLocale : initialLocale, catalogs: snapshot().catalogs, timeZone }).dispose();
      if (strictBuild) {
        await requireCompleteTranslations(root, [...files.values()], baseLocale, initialLocale);
      }
      await prepareBuild();
      if (options.typegen) {
        generatedOut = path.resolve(config.root, options.typegen.outFile);
        typegen = new TypeGenerator(generatedOut);
        try { await typegen.update(snapshot().catalogs.filter(c => c.locale === baseLocale).map(createBaseSchema)); }
        catch (error) { await cleanup(); throw error; }
      }
    },
    async buildStart() {
      if (!production) return;
      this.addWatchFile?.(root);
      for (const file of files.keys()) {
        this.addWatchFile?.(path.dirname(file));
        this.addWatchFile?.(file);
      }
      if (builds++ === 0) return;
      const scanned = await scanCatalogs(root, richText);
      files = new Map(scanned.files.map(file => [file.file, file]));
      createStore({ baseLocale, locale: options.requireCompleteTranslations ? baseLocale : initialLocale,
        catalogs: snapshot().catalogs, timeZone }).dispose();
      if (options.requireCompleteTranslations) await requireCompleteTranslations(root, [...files.values()], baseLocale, initialLocale);
      await prepareBuild();
      if (options.typegen) {
        typegen ??= new TypeGenerator(generatedOut!);
        await typegen.update(snapshot().catalogs.filter(catalog => catalog.locale === baseLocale).map(createBaseSchema));
      }
    },
    resolveId(id, importer) {
      if (id === VIRTUAL) return RESOLVED;
      if (id === LAZY) return RESOLVED_LAZY;
      if (id === SERVER) return RESOLVED_SERVER;
      if (chunks.has(id)) return `\0${id}`;
      if (production && options.astRuntime !== false) return astFormatter.resolve(id, importer, this);
    },
    load(id) {
      if (production && ([RESOLVED, RESOLVED_LAZY, RESOLVED_SERVER].includes(id) || chunks.has(id.startsWith('\0') ? id.slice(1) : id))) {
        for (const source of keySources) this.addWatchFile?.(source);
        this.addWatchFile?.(root);
        for (const file of files.keys()) {
          this.addWatchFile?.(path.dirname(file));
          this.addWatchFile?.(file);
        }
      }
      if (production && options.astRuntime !== false) {
        const ast = astFormatter.load(id);
        if (ast) return ast;
      }
      const chunk = chunks.get(id.startsWith('\0') ? id.slice(1) : id);
      if (chunk) return `export default ${encode(chunk)};`;
      if (id === RESOLVED_SERVER && this.environment?.name === 'client') throw new Error('virtual:saylo/server is a server-only entry.');
      if (id === RESOLVED_SERVER && !production) return `import { getServerCatalogSource } from '@0disoft/saylo-vite/server';
import { createServerI18n } from '@0disoft/saylo-core';
export const catalogSource = getServerCatalogSource(${encode(sessionId)});
export const createRequestI18n = (options = {}) => createServerI18n({
  locale: ${encode(initialLocale)}, timeZone: ${encode(timeZone)},
  initialNamespaces: ${options.initialNamespaces ? encode(options.initialNamespaces) : 'catalogSource.readManifest().availableNamespaces'},
  ...options, catalogSource });`;
      if (id === RESOLVED_LAZY || id === RESOLVED_SERVER) {
        const manifest = registry.manifest();
        const locale = manifest.availableLocales.includes(initialLocale) ? initialLocale : baseLocale;
        const namespaces = [...new Set(options.initialNamespaces ?? manifest.availableNamespaces)].sort();
        if (namespaces.length !== (options.initialNamespaces?.length ?? namespaces.length) || namespaces.some(n => !manifest.availableNamespaces.includes(n)))
          throw new RangeError('initialNamespaces must be unique available base namespaces.');
        const outcomes = namespaces.flatMap(namespace => [...new Set([baseLocale, locale])].map(locale => registry.load(locale, namespace)));
        const bootPairs = new Set(outcomes.map(outcome => catalogId(outcome.key)));
        const loaders = [...chunks].filter(([, outcome]) => !bootPairs.has(catalogId(outcome.key)))
          .map(([moduleId, outcome]) => `{ key: ${encode(outcome.key)}, load: () => import(${encode(moduleId)}).then(module => module.default) }`);
        return `import { ${production ? 'createStaticCatalogSource' : 'createDevCatalogSource'} } from '@0disoft/saylo-vite/client';
export const initialCatalogs = ${encode(outcomes)};
export const initialLocale = ${encode(locale)};
export const initialNamespaces = ${encode(namespaces)};
export const timeZone = ${encode(timeZone)};
export const catalogSource = ${production ? `createStaticCatalogSource(${encode(manifest)}, initialCatalogs, [${loaders.join(',\n')}])`
          : `createDevCatalogSource(${encode(manifest)}, initialCatalogs, { hot: import.meta.hot, push: true })`};
${id === RESOLVED_SERVER ? `import { createServerI18n } from '@0disoft/saylo-core';
export const createRequestI18n = (options = {}) => createServerI18n({ locale: initialLocale, timeZone,
  initialNamespaces, ...options, catalogSource });` : ''}`;
      }
      if (id !== RESOLVED) return;
      const catalogs = encode(buildCatalogs ?? snapshot().catalogs);
      return `import { freezeCatalogs } from '@0disoft/saylo-vite/client';
export const initialCatalogs = freezeCatalogs(${catalogs});
export const baseLocale = ${JSON.stringify(baseLocale)};
export const initialLocale = ${JSON.stringify(snapshot().catalogs.some(c => c.locale === initialLocale) ? initialLocale : baseLocale)};
export const timeZone = ${JSON.stringify(timeZone)};`;
    },
    configureServer(devServer) {
      detachLive();
      server = devServer;
      removeServerSource = registerServerSource(sessionId, {
        readManifest: () => registry.manifest(),
        loadCatalog: async (locale, namespace) => registry.load(locale, namespace),
      });
      live = new LiveRegistry(root, [...files.values()], baseLocale, (next, changed, nextDiagnostic) => {
        if (changed) {
          files = new Map(next.map(f => [f.file, f]));
          revision++;
          registry.replace(snapshot().catalogs);
          const update: EagerCatalogUpdate = { ...snapshot(), kind: 'update', baseRevision: revision - 1 };
          for (const client of server?.ws.clients ?? []) {
            if (!eagerClients.has(client)) continue;
            deliverUpdate(() => client.send({ type: 'custom', event: SNAPSHOT_EVENT, data: update }));
          }
          for (const client of server?.ws.clients ?? []) for (const push of pushes.updates(client, registry, revision - 1)) {
            deliverUpdate(() => client.send({ type: 'custom', event: CATALOG_PUSH_EVENT, data: push }));
          }
          deliverUpdate(() => server?.ws.send({ type: 'custom', event: MANIFEST_EVENT, data: { kind: 'update', baseRevision: revision - 1, manifest: registry.manifest() } }));
        }
        const generator = typegen;
        // A valid identical save can repair deleted output without publishing a catalog revision.
        if (generator && (changed || typegenPending || nextDiagnostic.message === '')) {
          typegenPending = true;
          const request = ++typegenRequest;
          void generator.update(live!.getAcceptedSchemas()).then(() => {
            if (typegen === generator && request === typegenRequest) typegenPending = false;
          }, error => {
            if (typegen === generator && request === typegenRequest)
              server?.config.logger.warn(`[saylo:typegen] ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        if (JSON.stringify(diagnostic) !== JSON.stringify(nextDiagnostic)) {
          diagnostic = nextDiagnostic;
          deliverUpdate(() => server?.ws.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: diagnostic }));
          if (diagnostic.message) server?.config.logger.warn(`[saylo] ${diagnostic.message}`);
        }
      }, { readCatalog: (directory, file, locale, namespace, read, previous) =>
        readCatalogFile(directory, file, locale, namespace, read, previous,
          { richText: richText && Object.hasOwn(richText, namespace) ? richText[namespace] : undefined }) });
      server.watcher.add(root);
      server.watcher.on('add', onAdd);
      server.watcher.on('unlink', onFile);
      server.ws.on(REQUEST_EVENT, request);
      server.ws.on(MANIFEST_REQUEST_EVENT, requestManifest);
      server.ws.on(CATALOG_REQUEST_EVENT, requestCatalog);
      server.ws.on(CATALOG_SCOPE_EVENT, subscribeCatalogs);
      server.httpServer?.once('close', cleanup);
    },
    async hotUpdate(context) {
      const file = path.resolve(context.file);
      if (isTypegenFile(file)) return [];
      if (!live?.owns(file)) return;
      if (this.environment && this.environment.name !== 'client') return [];
      if (context.modules.length) context.server.config.logger.warn(`[saylo] Managed catalog is directly imported: ${file}. Use virtual:saylo.`);
      if (context.type === 'create') await live.enqueueAdded(file);
      else await live.enqueue(file, context.type === 'update' ? context.read : undefined);
      return [];
    },
    closeBundle: cleanup,
  };
}

export type { SayloViteOptions, LiveDiagnostic, EagerCatalogSnapshot, EagerCatalogUpdate, EagerCatalogEvent, EagerSnapshotRequest } from './types.js';
export type { AutoIncludeKeys } from './auto-keys.js';
