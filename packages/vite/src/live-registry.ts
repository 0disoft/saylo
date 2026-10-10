import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CatalogError, createBaseSchema, validateTranslation } from '@0disoft/saylo-core';
import type { CatalogSchema, ParsedCatalog } from '@0disoft/saylo-core';
import { catalogLocation, readCatalogFile } from './catalog-files.js';
import type { CatalogFile } from './catalog-files.js';
import type { LiveDiagnostic } from './types.js';
import { quarantineTranslation } from './translation-quarantine.js';
import { DiskRechecks, diskStamp } from './disk-rechecks.js';

type Read = () => string | Promise<string>;
const QUIET_MS = 40;
const MAX_WAIT_MS = 200;

/** Incremental disk candidate + bounded quiet window, without owning Vite's watcher. */
export class LiveRegistry {
  private desired: Map<string, CatalogFile>;
  private accepted: Map<string, CatalogFile>;
  private lastGoodTranslations: Map<string, CatalogFile>;
  private knownNamespaces: Set<string>;
  private schemas = new WeakMap<ParsedCatalog, CatalogSchema>();
  private validated = new WeakMap<ParsedCatalog, string>();
  private errors = new Map<string, LiveDiagnostic>();
  private queued = new Map<string, Read | undefined>();
  private waiters: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstQueued = 0;
  private settleDisk = false;
  private generation = 0;
  private stopped = false;
  private running = Promise.resolve();
  // A verified metadata change needs an immediate read, not the add/unlink
  // quiet window. ENOENT during this read still takes the atomic-save retry.
  private rechecks = new DiskRechecks(file => { void this.enqueue(file, () => readFile(file, 'utf8')); });

  constructor(
    private root: string,
    files: readonly CatalogFile[],
    private baseLocale: string,
    private publish: (files: readonly CatalogFile[], changed: boolean, diagnostic: LiveDiagnostic) => void,
  ) {
    this.desired = new Map(files.map(f => [f.file, f]));
    this.accepted = new Map(this.desired);
    this.lastGoodTranslations = new Map(files.filter(f => f.catalog.locale !== baseLocale).map(f => [f.file, f]));
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

  private prepareTranslations(files: readonly CatalogFile[]) {
    const bases = new Map(files.filter(f => f.catalog.locale === this.baseLocale)
      .map(f => [f.catalog.namespace, createBaseSchema(f.catalog)]));
    const errors = new Map(this.errors);
    const translations = new Map(this.lastGoodTranslations);
    for (const key of errors.keys()) if (key.startsWith('schema:')) errors.delete(key);
    for (const file of translations.keys()) if (!this.desired.has(file)) translations.delete(file);
    const active = files.flatMap(item => {
      if (item.catalog.locale === this.baseLocale) return [item];
      const schema = bases.get(item.catalog.namespace);
      if (!schema) {
        errors.set(`schema:${item.file}`, this.failure(new CatalogError([{ sourceName: item.catalog.sourceName, locale: item.catalog.locale,
          namespace: item.catalog.namespace, code: 'NAMESPACE_MISMATCH', message: 'Every translation namespace needs a base catalog.' }])));
        // Keep the file in desired so creating its baseline can activate it without another save.
        translations.delete(item.file);
        return [];
      }
      try {
        if (this.validated.get(item.catalog) !== schema.fingerprint) {
          validateTranslation(schema, item.catalog);
          this.validated.set(item.catalog, schema.fingerprint);
        }
        translations.set(item.file, item);
        return [item];
      } catch (error) {
        if (!(error instanceof CatalogError)) throw error;
        errors.set(`schema:${item.file}`, this.failure(error));
        const previous = translations.get(item.file);
        if (!previous) return [];
        const catalog = quarantineTranslation(schema, previous.catalog);
        return [catalog === previous.catalog ? previous : { ...previous, catalog }];
      }
    });
    return { active, translations, errors };
  }

  getAcceptedSchemas(): readonly CatalogSchema[] {
    return [...this.accepted.values()].filter(f => f.catalog.locale === this.baseLocale).map(f => this.schemas.get(f.catalog)!);
  }

  diagnostic(): LiveDiagnostic {
    return { message: [...this.errors.values()].map(d => d.message).join('\n'),
      diagnostics: [...this.errors.values()].flatMap(d => d.diagnostics) };
  }

  enqueue(file: string, read?: Read): Promise<void> {
    if (this.stopped || !this.owns(file)) return Promise.resolve();
    const resolved = path.resolve(file);
    this.rechecks.reset(resolved);
    this.queued.set(resolved, read);
    this.generation++;
    this.schedule();
    return new Promise(resolve => this.waiters.push(resolve));
  }

  private schedule() {
    if (!this.firstQueued) this.firstQueued = Date.now();
    // Vite supplies a guarded reader for ordinary updates. Coalesce those on
    // the next turn; disk add/unlink and superseded reads still need settling.
    // Keep the longer window even if a later reader replaces the same path.
    for (const read of this.queued.values()) if (!read) { this.settleDisk = true; break; }
    const quietMs = this.settleDisk ? QUIET_MS : 0;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.drain(), Math.max(0, Math.min(quietMs, MAX_WAIT_MS - (Date.now() - this.firstQueued))));
  }

  private drain() {
    const batch = this.queued;
    const checks = new Map([...batch.keys()].map(file => [file, this.rechecks.token(file)]));
    const stamps = new Map<string, string>();
    const waiters = this.waiters;
    const generation = this.generation;
    this.queued = new Map();
    this.waiters = [];
    this.firstQueued = 0;
    this.settleDisk = false;
    this.timer = undefined;
    this.running = this.running.then(async () => {
      if (this.stopped) return;
      const candidate = new Map(this.desired);
      const errors = new Map(this.errors);
      let settleMissing = false;
      for (const [file, read] of batch) {
        const location = catalogLocation(this.root, file)!;
        try {
          // Read the final filesystem state, rather than trusting an earlier unlink/add label.
          const changed = await readCatalogFile(this.root, file, location.locale, location.namespace, async () => {
            // Capture before reading: a suppressed write during the read must
            // not be mistaken for the version represented by the old text.
            stamps.set(file, await diskStamp(file));
            return read ? read() : readFile(file, 'utf8');
          }, candidate.get(file)?.catalog);
          candidate.set(file, changed);
          errors.delete(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            // An update reader can race an atomic replacement before its
            // unlink/add events arrive. Confirm removal only after disk settling.
            if (read) settleMissing = true;
            else { candidate.delete(file); errors.delete(file); }
          } else errors.set(file, this.failure(error));
        }
      }
      if (this.stopped) return;
      // A save arrived while reading: discard this attempt and re-read the affected paths.
      if (generation !== this.generation || settleMissing) {
        if (settleMissing) this.settleDisk = true;
        for (const file of batch.keys()) if (!this.queued.has(file)) this.requeue(file);
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
        const prepared = this.prepareTranslations([...candidate.values()]
          .filter(f => namespaces.has(f.catalog.namespace) || !this.knownNamespaces.has(f.catalog.namespace)));
        const { active } = prepared;
        this.validate(active);
        if (generation !== this.generation || this.stopped) {
          if (!this.stopped) { for (const file of batch.keys()) if (!this.queued.has(file)) this.requeue(file); this.schedule(); }
          return;
        }
        const changed = active.length !== this.accepted.size || active.some(f => {
          const previous = this.accepted.get(f.file);
          if (!previous || previous.source !== f.source) return true;
          if (previous.catalog === f.catalog) return false;
          return Object.keys(previous.catalog.messages).length !== Object.keys(f.catalog.messages).length ||
            Object.keys(f.catalog.messages).some(id => previous.catalog.messages[id] !== f.catalog.messages[id]);
        });
        this.accepted = new Map(active.map(f => [f.file, f]));
        this.lastGoodTranslations = prepared.translations;
        this.errors = prepared.errors;
        for (const namespace of namespaces) this.knownNamespaces.add(namespace);
        this.errors.delete('<registry>');
        this.publish(active, changed, this.diagnostic());
      } catch (error) {
        if (this.stopped) return;
        if (generation !== this.generation) {
          for (const file of batch.keys()) if (!this.queued.has(file)) this.requeue(file);
          this.schedule();
          return;
        }
        this.errors.set('<registry>', this.failure(error));
        this.publish([...this.accepted.values()], false, this.diagnostic());
      }
    }).finally(() => {
      for (const [file, check] of checks) this.rechecks.finish(file, check, stamps.get(file));
      for (const resolve of waiters) resolve();
    });
  }

  private requeue(file: string) {
    this.rechecks.reset(file);
    this.queued.set(file, undefined);
  }

  private failure(error: unknown): LiveDiagnostic {
    return { message: error instanceof Error ? error.message : String(error), diagnostics: error instanceof CatalogError ? error.diagnostics : [] };
  }

  stop() {
    this.stopped = true;
    this.rechecks.stop();
    clearTimeout(this.timer);
    this.queued.clear();
    for (const resolve of this.waiters) resolve();
    this.waiters = [];
  }
}
