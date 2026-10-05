import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { CatalogError, createBaseSchema, createStore, validateTranslation } from '@saylo/core';
import type { Plugin, ViteDevServer } from 'vite';
import { readCatalogFile, scanCatalogs } from './catalog-files.js';
import type { CatalogFile } from './catalog-files.js';
import { DIAGNOSTIC_EVENT, REQUEST_EVENT, SNAPSHOT_EVENT } from './types.js';
import type { EagerCatalogSnapshot, LiveDiagnostic, SayloViteOptions } from './types.js';

const VIRTUAL = 'virtual:saylo';
const RESOLVED = `\0${VIRTUAL}`;

export default function saylo(options: SayloViteOptions): Plugin {
  const baseLocale = Intl.getCanonicalLocales(options.baseLocale)[0];
  if (!baseLocale) throw new RangeError('baseLocale must not be empty.');
  const initialLocale = options.initialLocale ?? baseLocale;
  const timeZone = options.timeZone ?? 'UTC';
  const sessionId = randomUUID();
  let root = '';
  let files = new Map<string, CatalogFile>();
  let revision = 0;
  let server: ViteDevServer | undefined;
  const diagnostics = new Map<string, LiveDiagnostic>();
  const diagnostic = (): LiveDiagnostic => ({
    message: [...diagnostics.values()].map(d => d.message).join('\n'),
    diagnostics: [...diagnostics.values()].flatMap(d => d.diagnostics),
  });
  let pending = Promise.resolve();
  let stopped = false;
  const snapshot = (): EagerCatalogSnapshot => ({ sessionId, revision, baseLocale, catalogs: [...files.values()].map(f => f.catalog) });
  const request: Parameters<ViteDevServer['ws']['on']>[1] = (_data, client) => {
    client.send({ type: 'custom', event: SNAPSHOT_EVENT, data: snapshot() });
    if (diagnostics.size) client.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: diagnostic() });
  };
  function cleanup() {
    stopped = true;
    server?.ws.off(REQUEST_EVENT, request);
    server?.httpServer?.off('close', cleanup);
  }
  async function refresh(file: string, read: () => string | Promise<string>) {
    if (stopped) return;
    const previous = files.get(file);
    if (!previous) return;
    try {
      const changed = await readCatalogFile(root, file, previous.catalog.locale, previous.catalog.namespace, read);
      if (stopped) return;
      if (changed.source !== previous.source) {
        const candidate = new Map(files);
        candidate.set(file, changed);
        const namespace = changed.catalog.namespace;
        const base = [...candidate.values()].find(f => f.catalog.locale === baseLocale && f.catalog.namespace === namespace)!;
        const schema = createBaseSchema(base.catalog);
        if (changed.catalog.locale === baseLocale) {
          if (schema.fingerprint !== createBaseSchema(previous.catalog).fingerprint) {
            for (const item of candidate.values()) {
              if (item.catalog.namespace === namespace && item.catalog.locale !== baseLocale) validateTranslation(schema, item.catalog);
            }
          }
        } else validateTranslation(schema, changed.catalog);
        files = candidate;
        revision++;
        server?.ws.send({ type: 'custom', event: SNAPSHOT_EVENT, data: snapshot() });
      }
      if (diagnostics.delete(file)) {
        server?.ws.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: diagnostic() });
      }
    } catch (error) {
      const failure = { message: error instanceof Error ? error.message : String(error), diagnostics: error instanceof CatalogError ? error.diagnostics : [] };
      diagnostics.set(file, failure);
      server?.ws.send({ type: 'custom', event: DIAGNOSTIC_EVENT, data: diagnostic() });
      server?.config.logger.warn(`[saylo] ${failure.message}`);
    }
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
export const initialLocale = ${JSON.stringify(initialLocale)};
export const timeZone = ${JSON.stringify(timeZone)};`;
    },
    configureServer(devServer) {
      server = devServer;
      stopped = false;
      server.watcher.add([...files.keys()]);
      server.ws.on(REQUEST_EVENT, request);
      server.httpServer?.once('close', cleanup);
    },
    async handleHotUpdate(context) {
      const file = path.resolve(context.file);
      if (!files.has(file)) return;
      if (context.modules.length) context.server.config.logger.warn(`[saylo] Managed catalog is directly imported: ${file}. Use virtual:saylo.`);
      pending = pending.then(() => refresh(file, context.read));
      await pending;
      return [];
    },
    closeBundle: cleanup,
  };
}

export type { SayloViteOptions, LiveDiagnostic, EagerCatalogSnapshot } from './types.js';
