import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createStore } from '@saylo/core';
import type { Plugin, ViteDevServer } from 'vite';
import { scanCatalogs } from './catalog-files.js';
import type { CatalogFile } from './catalog-files.js';
import { LiveRegistry } from './live-registry.js';
import { DIAGNOSTIC_EVENT, REQUEST_EVENT, SNAPSHOT_EVENT } from './types.js';
import type { EagerCatalogSnapshot, LiveDiagnostic, SayloViteOptions } from './types.js';

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
  let diagnostic: LiveDiagnostic = { message: '', diagnostics: [] };
  const snapshot = (): EagerCatalogSnapshot => ({ sessionId, revision, baseLocale, catalogs: [...files.values()].map(f => f.catalog) });
  const request: Parameters<ViteDevServer['ws']['on']>[1] = (_data, client) => {
    client.send({ type: 'custom', event: SNAPSHOT_EVENT, data: snapshot() });
    client.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: diagnostic });
  };
  const onFile = (file: string) => { void live?.enqueue(file); };
  function cleanup() {
    live?.stop();
    server?.watcher.off('add', onFile);
    server?.watcher.off('unlink', onFile);
    server?.ws.off(REQUEST_EVENT, request);
    server?.httpServer?.off('close', cleanup);
  }
  return {
    name: 'saylo',
    enforce: 'pre',
    config: () => ({ optimizeDeps: { exclude: ['@saylo/vite/client'] } }),
    async configResolved(config) {
      const scanned = await scanCatalogs(path.resolve(config.root, options.localesDir));
      root = scanned.root;
      files = new Map(scanned.files.map(f => [f.file, f]));
      // Fresh strict validation for startup and builds, using the same core contracts.
      createStore({ baseLocale, locale: initialLocale, catalogs: snapshot().catalogs, timeZone }).dispose();
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
      cleanup();
      server = devServer;
      live = new LiveRegistry(root, [...files.values()], baseLocale, (next, changed, nextDiagnostic) => {
        if (changed) {
          files = new Map(next.map(f => [f.file, f]));
          revision++;
          server?.ws.send({ type: 'custom', event: SNAPSHOT_EVENT, data: snapshot() });
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
      if (!live?.owns(file)) return;
      if (this.environment && this.environment.name !== 'client') return [];
      if (context.modules.length) context.server.config.logger.warn(`[saylo] Managed catalog is directly imported: ${file}. Use virtual:saylo.`);
      await live.enqueue(file, context.type === 'update' ? context.read : undefined);
      return [];
    },
    closeBundle: cleanup,
  };
}

export type { SayloViteOptions, LiveDiagnostic, EagerCatalogSnapshot } from './types.js';
