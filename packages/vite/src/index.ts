import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createBaseSchema, createStore } from '@0disoft/saylo-core';
import { isGeneratedFile, TypeGenerator } from '@0disoft/saylo-typegen';
import { assertRichTextKeys } from '@0disoft/saylo-typegen/config';
import { requireReviewedTranslations } from '@0disoft/saylo-typegen/review-check';
import type { Plugin, ViteDevServer, WebSocketClient } from 'vite';
import { CatalogRegistry } from './catalog-registry.js';
import { encodeCatalogResult } from './catalog-wire.js';
import { readCatalogFile, scanCatalogs } from './catalog-files.js';
import type { CatalogFile } from './catalog-files.js';
import { LiveRegistry } from './live-registry.js';
import { diagnosticMessage } from './diagnostic-observers.js';
import { VIRTUAL, RESOLVED, LAZY, RESOLVED_LAZY, SERVER, RESOLVED_SERVER, CHUNK,
  renderCatalogChunk, renderVirtualModule } from './virtual-modules.js';
import { createAstFormatter } from './ast-formatter.js';
import { readCheckLocales, requireCompleteTranslations } from './complete-translations.js';
import { readIncludedKeys, selectBuildCatalogs } from './build-keys.js';
import { findIncludedKeys, readAutoKeys } from './auto-keys.js';
import { catalogCacheLimit } from './cache-policy.js';
import type { ImportResolver } from './auto-key-modules.js';
import { CatalogPushSubscriptions } from './catalog-push.js';
import type { CatalogOutcome, ParsedCatalog } from '@0disoft/saylo-core';
import { registerServerSource } from './server-source.js';
import { CATALOG_EVENT, CATALOG_PUSH_EVENT, CATALOG_SCOPE_EVENT, CATALOG_REQUEST_EVENT, DIAGNOSTIC_EVENT, MANIFEST_EVENT, MANIFEST_REQUEST_EVENT,
  REQUEST_EVENT, SNAPSHOT_EVENT, isCatalogRequest, isSnapshotRequest } from './types.js';
import type { EagerCatalogUpdate, LiveDiagnostic, SayloViteOptions } from './types.js';

export default function saylo(options: SayloViteOptions): Plugin {
  const checkLocales = readCheckLocales(options.checkLocales);
  const maxCachedCatalogs = catalogCacheLimit(options.maxCachedCatalogs);
  if (options.compactCatalogs !== undefined && typeof options.compactCatalogs !== 'boolean') throw new TypeError('compactCatalogs must be a boolean.');
  const autoKeys = readAutoKeys(options.includeKeys);
  const includeKeys = autoKeys ? undefined : readIncludedKeys(options.includeKeys);
  const richText = options.richText === undefined ? undefined : structuredClone(options.richText);
  if (options.requireCompleteTranslations !== undefined && typeof options.requireCompleteTranslations !== 'boolean') {
    throw new TypeError('requireCompleteTranslations must be a boolean.');
  }
  if (options.requireReviewedTranslations !== undefined && typeof options.requireReviewedTranslations !== 'boolean')
    throw new TypeError('requireReviewedTranslations must be a boolean.');
  if (options.reviews !== undefined && (typeof options.reviews !== 'string' || !options.reviews.trim()))
    throw new TypeError('reviews must be a nonempty string.');
  const reviewedBuild = options.requireReviewedTranslations === true;
  if (reviewedBuild && options.reviews === undefined)
    throw new TypeError('requireReviewedTranslations requires a reviews file.');
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
  let reviewsFile: string | undefined;
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
  async function prepareBuild(resolveImport?: ImportResolver) {
    keySources.clear();
    assertRichTextKeys(snapshot().catalogs, baseLocale, richText);
    const selectedKeys = production && autoKeys ? await findIncludedKeys(buildRoot,
      snapshot().catalogs, baseLocale, autoKeys, file => keySources.add(file), resolveImport) : includeKeys;
    buildCatalogs = production ? selectBuildCatalogs(snapshot().catalogs, baseLocale, selectedKeys) : undefined;
    registry = new CatalogRegistry(sessionId, baseLocale, buildCatalogs ?? snapshot().catalogs);
    chunks.clear();
    if (production) for (const meta of registry.manifest().catalogs) {
      if (meta.status === 'present') chunks.set(`${CHUNK}${encodeURIComponent(meta.key.locale)}/${encodeURIComponent(meta.key.namespace)}`,
        registry.load(meta.key.locale, meta.key.namespace));
    }
  }
  async function validateCatalogs() {
    const strictBuild = production && (options.requireCompleteTranslations === true || reviewedBuild);
    // Missing locales are reported by completeness, rather than by createStore's locale range check.
    createStore({ baseLocale, locale: strictBuild ? baseLocale : initialLocale, catalogs: snapshot().catalogs, timeZone }).dispose();
    if (strictBuild) await requireCompleteTranslations(root, [...files.values()], baseLocale, initialLocale, checkLocales);
    if (production && reviewedBuild) await requireReviewedTranslations([...files.values()], baseLocale, reviewsFile!);
  }
  let buildRoot = '';
  let isAliased = (_specifier: string) => false;
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
      const aliases = config.resolve?.alias ?? [];
      isAliased = specifier => aliases.some(({ find }) => typeof find === 'string'
        ? specifier === find || specifier.startsWith(`${find}/`)
        : new RegExp(find.source, find.flags).test(specifier));
      const scanned = await scanCatalogs(path.resolve(config.root, options.localesDir), richText);
      root = scanned.root;
      files = new Map(scanned.files.map(f => [f.file, f]));
      production = config.command === 'build';
      reviewsFile = options.reviews === undefined ? undefined : path.resolve(buildRoot, options.reviews);
      await validateCatalogs();
      // Automatic analysis needs Vite's plugin resolver, available during buildStart.
      if (!production || !autoKeys) await prepareBuild();
      if (options.typegen) {
        generatedOut = path.resolve(config.root, options.typegen.outFile);
        // Config-only consumers (svelte-kit sync, svelte-check) never run closeBundle.
        // Validate the target here, but acquire resources only for a server/build lifetime.
        typegen = new TypeGenerator(generatedOut);
      }
    },
    async buildStart() {
      if (!production) return;
      this.addWatchFile?.(root);
      if (reviewedBuild) this.addWatchFile?.(reviewsFile!);
      for (const file of files.keys()) {
        this.addWatchFile?.(path.dirname(file));
        this.addWatchFile?.(file);
      }
      if (builds++ > 0) {
        const scanned = await scanCatalogs(root, richText);
        files = new Map(scanned.files.map(file => [file.file, file]));
      }
      // Re-read approvals on every build, including ledger-only watch rebuilds and failed-build recovery.
      if (builds > 1) await validateCatalogs();
      else if (reviewedBuild) await requireReviewedTranslations([...files.values()], baseLocale, reviewsFile!);
      if (builds > 1 || autoKeys) await prepareBuild(async (specifier, importer) => {
        // Framework/runtime imports are translator seeds, not app-owned alias modules.
        if (/^@0disoft\/saylo-(?:core|react|svelte|vue|vite)(?:\/|$)/.test(specifier) ||
            /^virtual:saylo(?:\/|$)/.test(specifier) || !isAliased(specifier)) return;
        const resolved = await this.resolve(specifier, importer, { skipSelf: true });
        if (!resolved || resolved.external) throw new Error(`[saylo:auto-keys] Cannot resolve aliased import ${JSON.stringify(specifier)} in ${importer}. Use an explicit includeKeys list or correct the Vite alias.`);
        return resolved.id;
      });
      if (options.typegen) {
        const generator = typegen ??= new TypeGenerator(generatedOut!);
        const errors: unknown[] = [];
        try { await generator.update(snapshot().catalogs.filter(catalog => catalog.locale === baseLocale).map(createBaseSchema)); }
        catch (error) { errors.push(error); }
        // SvelteKit can start a client build inside SSR writeBundle, before closeBundle.
        // A production generation owns the output only until its physical write settles.
        try { await generator.stop(); } catch (error) { errors.push(error); }
        if (typegen === generator) typegen = undefined;
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, 'Build type generation and cleanup failed', { cause: errors[0] });
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
      if (chunk) return renderCatalogChunk(chunk, production && options.compactCatalogs !== false);
      if (id === RESOLVED_SERVER && this.environment?.name === 'client') throw new Error('virtual:saylo/server is a server-only entry.');
      if (![RESOLVED, RESOLVED_LAZY, RESOLVED_SERVER].includes(id)) return;
      return renderVirtualModule(id, { production, sessionId, baseLocale, initialLocale, timeZone,
        compactCatalogs: options.compactCatalogs !== false,
        ...(maxCachedCatalogs === undefined ? {} : { maxCachedCatalogs }),
        initialNamespaces: options.initialNamespaces, registry, chunks, catalogs: snapshot().catalogs, buildCatalogs });
    },
    async configureServer(devServer) {
      if (options.typegen) {
        typegen ??= new TypeGenerator(generatedOut!);
        try { await typegen.update(snapshot().catalogs.filter(c => c.locale === baseLocale).map(createBaseSchema)); }
        catch (error) { await cleanup(); throw error; }
      }
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
      // Watch-only nodes (for example CSS content scans) have no resolved import ID.
      const directlyImported = context.modules.some(module => module.id !== null && module.file !== null && path.resolve(module.file) === file);
      if (directlyImported) context.server.config.logger.warn(`[saylo] Managed catalog is directly imported: ${file}. Use virtual:saylo.`);
      if (context.type === 'create') await live.enqueueAdded(file);
      else await live.enqueue(file, context.type === 'update' ? context.read : undefined);
      return [];
    },
    closeBundle: cleanup,
  };
}

export type { SayloViteOptions, LiveDiagnostic, EagerCatalogSnapshot, EagerCatalogUpdate, EagerCatalogEvent, EagerSnapshotRequest } from './types.js';
export type { AutoIncludeKeys } from './auto-keys.js';
export { loadProjectConfig } from '@0disoft/saylo-typegen/config';
