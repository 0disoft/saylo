import { stat } from 'node:fs/promises';
import path from 'node:path';
import { CatalogError, createBaseSchema, validateTranslation } from '@saylo/core';
import type { CatalogSchema, ParsedCatalog } from '@saylo/core';
import { catalogLocation, readCatalogFile } from './catalog-files.js';
import type { CatalogFile } from './catalog-files.js';
import type { LiveDiagnostic } from './types.js';

type Read = () => string | Promise<string>;
const QUIET_MS = 40;
const MAX_WAIT_MS = 200;

/** Incremental disk candidate + bounded quiet window, without owning Vite's watcher. */
export class LiveRegistry {
  private desired: Map<string, CatalogFile>;
  private accepted: Map<string, CatalogFile>;
  private knownNamespaces: Set<string>;
  private schemas = new WeakMap<ParsedCatalog, CatalogSchema>();
  private validated = new WeakMap<ParsedCatalog, string>();
  private errors = new Map<string, LiveDiagnostic>();
  private queued = new Map<string, Read | undefined>();
  private waiters: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstQueued = 0;
  private generation = 0;
  private stopped = false;
  private running = Promise.resolve();

  constructor(
    private root: string,
    files: readonly CatalogFile[],
    private baseLocale: string,
    private publish: (files: readonly CatalogFile[], changed: boolean, diagnostic: LiveDiagnostic) => void,
  ) {
    this.desired = new Map(files.map(f => [f.file, f]));
    this.accepted = new Map(this.desired);
    this.knownNamespaces = new Set(files.filter(f => f.catalog.locale === baseLocale).map(f => f.catalog.namespace));
    this.validate(files);
  }

  private validate(files: readonly CatalogFile[]) {
    const schemas = new Map<string, CatalogSchema>();
    for (const { catalog } of files) {
      if (catalog.locale !== this.baseLocale) continue;
      let schema = this.schemas.get(catalog);
      if (!schema) { schema = createBaseSchema(catalog); this.schemas.set(catalog, schema); }
      schemas.set(catalog.namespace, schema);
    }
    for (const { catalog } of files) {
      if (catalog.locale === this.baseLocale) continue;
      const schema = schemas.get(catalog.namespace);
      if (!schema) throw new CatalogError([{ sourceName: catalog.sourceName, locale: catalog.locale,
        namespace: catalog.namespace, code: 'NAMESPACE_MISMATCH', message: 'Every translation namespace needs a base catalog.' }]);
      if (this.validated.get(catalog) !== schema.fingerprint) {
        validateTranslation(schema, catalog);
        this.validated.set(catalog, schema.fingerprint);
      }
    }
  }

  owns(file: string) { return catalogLocation(this.root, file) !== undefined; }

  diagnostic(): LiveDiagnostic {
    return { message: [...this.errors.values()].map(d => d.message).join('\n'),
      diagnostics: [...this.errors.values()].flatMap(d => d.diagnostics) };
  }

  enqueue(file: string, read?: Read): Promise<void> {
    if (this.stopped || !this.owns(file)) return Promise.resolve();
    this.queued.set(path.resolve(file), read);
    this.generation++;
    this.schedule();
    return new Promise(resolve => this.waiters.push(resolve));
  }

  private schedule() {
    if (!this.firstQueued) this.firstQueued = Date.now();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.drain(), Math.max(0, Math.min(QUIET_MS, MAX_WAIT_MS - (Date.now() - this.firstQueued))));
  }

  private drain() {
    const batch = this.queued;
    const waiters = this.waiters;
    const generation = this.generation;
    this.queued = new Map();
    this.waiters = [];
    this.firstQueued = 0;
    this.timer = undefined;
    this.running = this.running.then(async () => {
      if (this.stopped) return;
      const candidate = new Map(this.desired);
      const errors = new Map(this.errors);
      for (const [file, read] of batch) {
        const location = catalogLocation(this.root, file)!;
        try {
          // Read the final filesystem state, rather than trusting an earlier unlink/add label.
          const changed = await readCatalogFile(this.root, file, location.locale, location.namespace, read);
          candidate.set(file, changed);
          errors.delete(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            candidate.delete(file);
            errors.delete(file);
          } else errors.set(file, this.failure(error));
        }
      }
      if (this.stopped) return;
      // A save arrived while reading: discard this attempt and re-read the affected paths.
      if (generation !== this.generation) {
        for (const file of batch.keys()) if (!this.queued.has(file)) this.queued.set(file, undefined);
        this.schedule();
        return;
      }
      this.desired = candidate;
      this.errors = errors;
      try {
        const directories = new Map<string, string>();
        for (const item of candidate.values()) {
          const directory = path.dirname(item.file);
          const previous = directories.get(item.catalog.locale);
          if (previous && previous !== directory) throw new Error(`Duplicate canonical locale directory: ${directory}`);
          directories.set(item.catalog.locale, directory);
        }
        const bases = [...candidate.values()].filter(f => f.catalog.locale === this.baseLocale);
        if (!bases.length) throw new Error('The base locale must retain at least one catalog on disk.');
        // Do not accept a ghost baseline if its unlink event is still in flight.
        if (!(await Promise.all(bases.map(f => stat(f.file).then(s => s.isFile(), () => false)))).some(Boolean)) {
          throw new Error('The base locale must retain at least one catalog on disk.');
        }
        const namespaces = new Set(bases.map(f => f.catalog.namespace));
        // Removing a baseline namespace removes it from the active registry. Its secondary
        // files stay cached on disk and rejoin if that baseline namespace is restored.
        const active = [...candidate.values()].filter(f => namespaces.has(f.catalog.namespace) || !this.knownNamespaces.has(f.catalog.namespace));
        this.validate(active);
        if (generation !== this.generation || this.stopped) {
          if (!this.stopped) { for (const file of batch.keys()) if (!this.queued.has(file)) this.queued.set(file, undefined); this.schedule(); }
          return;
        }
        const changed = active.length !== this.accepted.size || active.some(f => this.accepted.get(f.file)?.source !== f.source);
        this.accepted = new Map(active.map(f => [f.file, f]));
        for (const namespace of namespaces) this.knownNamespaces.add(namespace);
        this.errors.delete('<registry>');
        this.publish(active, changed, this.diagnostic());
      } catch (error) {
        if (this.stopped) return;
        if (generation !== this.generation) {
          for (const file of batch.keys()) if (!this.queued.has(file)) this.queued.set(file, undefined);
          this.schedule();
          return;
        }
        this.errors.set('<registry>', this.failure(error));
        this.publish([...this.accepted.values()], false, this.diagnostic());
      }
    }).finally(() => { for (const resolve of waiters) resolve(); });
  }

  private failure(error: unknown): LiveDiagnostic {
    return { message: error instanceof Error ? error.message : String(error), diagnostics: error instanceof CatalogError ? error.diagnostics : [] };
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.queued.clear();
    for (const resolve of this.waiters) resolve();
    this.waiters = [];
  }
}
