import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createBaseSchema, createStore } from '@saylo/core';
import { isGeneratedFile, TypeGenerator } from '@saylo/typegen';
import type { Plugin, ViteDevServer } from 'vite';
import { scanCatalogs } from './catalog-files.js';
import type { CatalogFile } from './catalog-files.js';
import { LiveRegistry } from './live-registry.js';
import { DIAGNOSTIC_EVENT, REQUEST_EVENT, SNAPSHOT_EVENT, isSnapshotRequest } from './types.js';
import type { EagerCatalogUpdate, LiveDiagnostic, SayloViteOptions } from './types.js';

const VIRTUAL = 'virtual:saylo';
const RESOLVED = `\0${VIRTUAL}`;

export default function saylo(options: SayloViteOptions): Plugin {
  const baseLocale = Intl.getCanonicalLocales(options.baseLocale)[0];
  if (!baseLocale) throw new RangeError('baseLocale must not be empty.');
  const initialLocale = Intl.getCanonicalLocales(options.initialLocale ?? baseLocale)[0]!;
  const timeZone = options.timeZone ?? 'UTC';
  const sessionId = randomUUID();
  let root = '';
  let files = new Map<string, CatalogFile>();
  let revision = 0;
  let server: ViteDevServer | undefined;
  let live: LiveRegistry | undefined;
  let typegen: TypeGenerator | undefined;
  let generatedOut: string | undefined;
  const isTypegenFile = (file: string) => generatedOut !== undefined && isGeneratedFile(generatedOut, file);
  let diagnostic: LiveDiagnostic = { message: '', diagnostics: [] };
  const snapshot = () => ({ sessionId, revision, baseLocale, catalogs: [...files.values()].map(f => f.catalog) });
  const request: Parameters<ViteDevServer['ws']['on']>[1] = (data, client) => {
    if (!isSnapshotRequest(data)) {
      client.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: { message: 'Invalid eager snapshot request.', diagnostics: [] } });
      return;
    }
    client.send({ type: 'custom', event: SNAPSHOT_EVENT, data: { ...snapshot(), kind: 'snapshot', request: data } });
    client.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: { ...diagnostic, request: data } });
  };
  const onFile = (file: string) => { void live?.enqueue(file); };
  function detachLive() {
    live?.stop();
    server?.watcher.off('add', onFile);
    server?.watcher.off('unlink', onFile);
    server?.ws.off(REQUEST_EVENT, request);
    server?.httpServer?.off('close', cleanup);
  }
  async function cleanup() {
    detachLive();
    const generator = typegen;
    typegen = undefined;
    await generator?.stop();
  }
  return {
    name: 'saylo',
    enforce: 'pre',
    config(config) {
      generatedOut = options.typegen ? path.resolve(config.root ?? process.cwd(), options.typegen.outFile) : undefined;
      return { optimizeDeps: { exclude: ['@saylo/vite/client'] },
        ...(generatedOut ? { server: { watch: { ignored: [(file: string) => isTypegenFile(file)] } } } : {}) };
    },
    async configResolved(config) {
      const scanned = await scanCatalogs(path.resolve(config.root, options.localesDir));
      root = scanned.root;
      files = new Map(scanned.files.map(f => [f.file, f]));
      // Fresh strict validation for startup and builds, using the same core contracts.
      createStore({ baseLocale, locale: initialLocale, catalogs: snapshot().catalogs, timeZone }).dispose();
      if (options.typegen) {
        generatedOut = path.resolve(config.root, options.typegen.outFile);
        typegen = new TypeGenerator(generatedOut);
        try { await typegen.update(snapshot().catalogs.filter(c => c.locale === baseLocale).map(createBaseSchema)); }
        catch (error) { await cleanup(); throw error; }
      }
    },
    resolveId(id) { if (id === VIRTUAL) return RESOLVED; },
    load(id) {
      if (id !== RESOLVED) return;
      const catalogs = JSON.stringify(snapshot().catalogs).replace(/</g, '\\u003c');
      return `import { freezeCatalogs } from '@saylo/vite/client';
export const initialCatalogs = freezeCatalogs(${catalogs});
export const baseLocale = ${JSON.stringify(baseLocale)};
export const initialLocale = ${JSON.stringify(snapshot().catalogs.some(c => c.locale === initialLocale) ? initialLocale : baseLocale)};
export const timeZone = ${JSON.stringify(timeZone)};`;
    },
    configureServer(devServer) {
      detachLive();
      server = devServer;
      live = new LiveRegistry(root, [...files.values()], baseLocale, (next, changed, nextDiagnostic) => {
        if (changed) {
          files = new Map(next.map(f => [f.file, f]));
          revision++;
          const update: EagerCatalogUpdate = { ...snapshot(), kind: 'update', baseRevision: revision - 1 };
          server?.ws.send({ type: 'custom', event: SNAPSHOT_EVENT, data: update });
          const generator = typegen;
          if (generator) void generator.update(live!.getAcceptedSchemas()).catch(error => {
            if (typegen === generator) server?.config.logger.warn(`[saylo:typegen] ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        if (JSON.stringify(diagnostic) !== JSON.stringify(nextDiagnostic)) {
          diagnostic = nextDiagnostic;
          server?.ws.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: diagnostic });
          if (diagnostic.message) server?.config.logger.warn(`[saylo] ${diagnostic.message}`);
        }
      });
      server.watcher.add(root);
      server.watcher.on('add', onFile);
      server.watcher.on('unlink', onFile);
      server.ws.on(REQUEST_EVENT, request);
      server.httpServer?.once('close', cleanup);
    },
    async hotUpdate(context) {
      const file = path.resolve(context.file);
      if (isTypegenFile(file)) return [];
      if (!live?.owns(file)) return;
      if (this.environment && this.environment.name !== 'client') return [];
      if (context.modules.length) context.server.config.logger.warn(`[saylo] Managed catalog is directly imported: ${file}. Use virtual:saylo.`);
      await live.enqueue(file, context.type === 'update' ? context.read : undefined);
      return [];
    },
    closeBundle: cleanup,
  };
}

export type { SayloViteOptions, LiveDiagnostic, EagerCatalogSnapshot, EagerCatalogUpdate, EagerCatalogEvent, EagerSnapshotRequest } from './types.js';
