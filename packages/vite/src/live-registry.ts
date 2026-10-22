import { DEV_DISK_POLICY } from './dev-policy.js';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CatalogError, createBaseSchema, validateTranslation } from '@0disoft/saylo-core';
import type { CatalogSchema, ParsedCatalog } from '@0disoft/saylo-core';
import { catalogLocation, readCatalogFile, mapFileTasks, FileTaskQueue } from './catalog-files.js';
import type { CatalogFile } from './catalog-files.js';
import type { LiveDiagnostic } from './types.js';
import { quarantineTranslation } from './translation-quarantine.js';
import { DiskRechecks, diskStamp } from './disk-rechecks.js';
import type { DiskRecheckOperations } from './disk-rechecks.js';
import { diagnosticMessage } from './diagnostic-observers.js';
import { schedule, timeoutDuration } from './scheduling.js';

type Read = () => string | Promise<string>;

type Checks = ReadonlyMap<string, ReturnType<DiskRechecks['token']>>;

function baseCatalogs(files: readonly CatalogFile[], baseLocale: string) {
  const directories = new Map<string, string>();
  for (const item of files) {
    const directory = path.dirname(item.file);
    const previous = directories.get(item.catalog.locale);
    if (previous && previous !== directory) throw new Error(`Duplicate canonical locale directory: ${directory}`);
    directories.set(item.catalog.locale, directory);
  }
  const bases = files.filter(f => f.catalog.locale === baseLocale);
  if (!bases.length) throw new Error('The base locale must retain at least one catalog on disk.');
  return bases;
}

function acceptedChanged(previous: ReadonlyMap<string, CatalogFile>, active: readonly CatalogFile[]): boolean {
  return active.length !== previous.size || active.some(f => {
    const before = previous.get(f.file);
    if (!before || before.source !== f.source) return true;
    if (before.catalog === f.catalog) return false;
    return Object.keys(before.catalog.messages).length !== Object.keys(f.catalog.messages).length ||
      Object.keys(f.catalog.messages).some(id => before.catalog.messages[id] !== f.catalog.messages[id]);
  });
}

export interface LiveRegistryOperations extends DiskRecheckOperations {
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly read?: (file: string) => Promise<string>;
  readonly readCatalog?: typeof readCatalogFile;
  readonly isFile?: (file: string) => Promise<boolean>;
}

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
  // A superseded read cannot publish, but its parsed catalog can accelerate
  // the next read. The new source still passes through the strict parser.
  private pendingParses = new Map<string, ParsedCatalog>();
  private waiters: (() => void)[] = [];
  private timer: (() => void) | undefined;
  private firstQueued: number | undefined;
  private publicationPending = false;
  private settleDisk = false;
  private generation = 0;
  private stopped = false;
  private running = Promise.resolve();
  // A verified metadata change needs an immediate read, not the add/unlink
  // quiet window. ENOENT during this read still takes the atomic-save retry.
  private rechecks: DiskRechecks;
  private readonly lifetime = new AbortController();
  private readonly timeoutMs: number;
  private readonly fileTasks = new FileTaskQueue();
  private readonly cancelOperations = new Set<() => void>();

  constructor(
    private root: string,
    files: readonly CatalogFile[],
    private baseLocale: string,
    private publish: (files: readonly CatalogFile[], changed: boolean, diagnostic: LiveDiagnostic) => void,
    private operations: LiveRegistryOperations = {},
  ) {
    this.timeoutMs = timeoutDuration(operations.timeoutMs ?? DEV_DISK_POLICY.operationTimeoutMs);
    this.rechecks = new DiskRechecks(file => { void this.enqueue(file, () => this.read(file)); }, {
      ...operations, stamp: file => this.bounded(`Catalog stamp: ${file}`,
        signal => this.fileTasks.run(() => (operations.stamp ?? diskStamp)(file), signal)),
    });
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

  enqueueAdded(file: string): Promise<void> {
    const resolved = path.resolve(file);
    // A new path has no accepted state to temporarily remove. Read it on the
    // next turn; known-path replacements and pending unlinks still settle.
    return this.enqueue(resolved, this.desired.has(resolved) || this.accepted.has(resolved)
      ? undefined : () => this.read(resolved));
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
    const now = (this.operations.now ?? (() => performance.now()))();
    this.firstQueued ??= now;
    // Vite supplies a guarded reader for ordinary updates. Coalesce those on
    // the next turn; disk add/unlink and superseded reads still need settling.
    // Keep the longer window even if a later reader replaces the same path.
    for (const read of this.queued.values()) if (!read) { this.settleDisk = true; break; }
    const quietMs = this.settleDisk ? DEV_DISK_POLICY.quietWindowMs : 0;
    this.timer?.();
    this.timer = (this.operations.schedule ?? schedule)(Math.max(0, Math.min(quietMs, DEV_DISK_POLICY.maxQueueWaitMs - (now - this.firstQueued))), () => this.drain());
  }

  private drain() {
    const batch = this.queued;
    const checks = new Map([...batch.keys()].map(file => [file, this.rechecks.token(file)]));
    const stamps = new Map<string, string>();
    const waiters = this.waiters;
    const generation = this.generation;
    this.queued = new Map();
    this.waiters = [];
    this.firstQueued = undefined;
    this.settleDisk = false;
    this.timer = undefined;
    this.running = this.running.then(() => this.processBatch(batch, checks, stamps, generation))
      .catch(error => {
        if (this.stopped) return;
        this.errors.set('<registry>', this.failure(error));
        this.emit([...this.accepted.values()], false);
      }).finally(() => {
        for (const [file, check] of checks) this.rechecks.finish(file, check, stamps.get(file));
        for (const resolve of waiters) resolve();
      });
  }

  private async readBatch(batch: ReadonlyMap<string, Read | undefined>, stamps: Map<string, string>) {
    const candidate = new Map(this.desired);
    const errors = new Map(this.errors);
    const parsed = new Map<string, ParsedCatalog>();
    let settleMissing = false;
    const entries = [...batch];
    const results = await this.bounded('Catalog batch read', signal => mapFileTasks(entries, async ([file, read]) => {
      const location = catalogLocation(this.root, file)!;
      const previous = this.pendingParses.get(file) ?? this.desired.get(file)?.catalog;
      let capturedStamp: string | undefined;
      try {
        // Read the final filesystem state, rather than trusting an earlier unlink/add label.
        const changed = await this.fileTasks.run(() =>
          (this.operations.readCatalog ?? readCatalogFile)(this.root, file, location.locale, location.namespace, async () => {
          // Capture before reading: a suppressed write during the read must
          // not be mistaken for the version represented by the old text.
          capturedStamp = await (this.operations.stamp ?? diskStamp)(file);
          signal.throwIfAborted();
          return read ? read() : this.read(file);
        }, previous), signal);
        return { file, read, changed, capturedStamp, failed: false as const };
      } catch (error) { return { file, read, error, capturedStamp, failed: true as const }; }
    }, { signal }));
    for (const { file, read, capturedStamp, ...result } of results) {
      this.pendingParses.delete(file);
      if (capturedStamp !== undefined) stamps.set(file, capturedStamp);
      if (!result.failed) {
        const changed = result.changed;
        parsed.set(file, changed.catalog);
        candidate.set(file, changed);
        errors.delete(file);
      } else {
        const error = result.error;
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          // An update reader can race an atomic replacement before its
          // unlink/add events arrive. Confirm removal only after disk settling.
          if (read) settleMissing = true;
          else { candidate.delete(file); errors.delete(file); }
        } else errors.set(file, this.failure(error));
      }
    }
    return { candidate, errors, parsed, settleMissing };
  }

  private requeueBatch(batch: ReadonlyMap<string, Read | undefined>, checks: Checks, settleMissing = false) {
    if (settleMissing) this.settleDisk = true;
    for (const file of batch.keys()) {
      if (this.queued.has(file)) continue;
      if (settleMissing || this.rechecks.token(file) === checks.get(file)) this.requeue(file);
    }
    if (this.queued.size) this.schedule();
  }

  private async processBatch(batch: ReadonlyMap<string, Read | undefined>, checks: Checks,
    stamps: Map<string, string>, generation: number) {
    if (this.stopped) return;
    const { candidate, errors, parsed, settleMissing } = await this.readBatch(batch, stamps);
    if (this.stopped) return;
    if (generation !== this.generation || settleMissing) {
      for (const [file, catalog] of parsed) this.pendingParses.set(file, catalog);
      this.requeueBatch(batch, checks, settleMissing);
      return;
    }
    // Remember disk candidates even when validation keeps the last accepted registry active.
    this.desired = candidate;
    this.errors = errors;
    try {
      await this.acceptCandidate(candidate, batch, checks, generation);
    } catch (error) {
      if (this.stopped) return;
      if (generation !== this.generation) { this.requeueBatch(batch, checks); return; }
      this.errors.set('<registry>', this.failure(error));
      this.emit([...this.accepted.values()], false);
    }
  }

  private async acceptCandidate(candidate: ReadonlyMap<string, CatalogFile>,
    batch: ReadonlyMap<string, Read | undefined>, checks: Checks, generation: number) {
    const files = [...candidate.values()];
    const bases = baseCatalogs(files, this.baseLocale);
    // Do not accept a ghost baseline if its unlink event is still in flight.
    const existing = await this.bounded('Base catalog existence check', signal => mapFileTasks(bases, async f => {
      try { return await this.fileTasks.run(() => this.operations.isFile ? this.operations.isFile(f.file) : stat(f.file).then(s => s.isFile()), signal); }
      catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return false;
        throw error;
      }
    }, { signal }));
    if (!existing.some(Boolean)) {
      throw new Error('The base locale must retain at least one catalog on disk.');
    }
    const namespaces = new Set(bases.map(f => f.catalog.namespace));
    // Removing a baseline namespace removes it from the active registry. Its secondary
    // files stay cached on disk and rejoin if that baseline namespace is restored.
    const prepared = this.prepareTranslations(files
      .filter(f => namespaces.has(f.catalog.namespace) || !this.knownNamespaces.has(f.catalog.namespace)));
    const { active } = prepared;
    this.validate(active);
    if (generation !== this.generation || this.stopped) {
      if (!this.stopped) this.requeueBatch(batch, checks);
      return;
    }
    const changed = acceptedChanged(this.accepted, active);
    this.accepted = new Map(active.map(f => [f.file, f]));
    this.lastGoodTranslations = prepared.translations;
    this.errors = prepared.errors;
    for (const namespace of namespaces) this.knownNamespaces.add(namespace);
    this.errors.delete('<registry>');
    this.emit(active, changed);
  }

  private requeue(file: string) {
    this.rechecks.reset(file);
    this.queued.set(file, undefined);
  }

  private failure(error: unknown): LiveDiagnostic {
    return { message: diagnosticMessage(error), diagnostics: error instanceof CatalogError ? error.diagnostics : [] };
  }

  private read(file: string) { return this.operations.read ? this.operations.read(file) : readFile(file, 'utf8'); }

  private bounded<T>(label: string, operation: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
    const controller = new AbortController();
    const parent = this.lifetime.signal;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      let cancelTimer = () => {};
      const finish = (failed: boolean, value: unknown) => {
        if (finished) return;
        finished = true;
        cancelTimer(); this.cancelOperations.delete(abort);
        if (failed) { controller.abort(value); reject(value); } else resolve(value as T);
      };
      const abort = () => finish(true, parent.reason);
      if (parent.aborted) { abort(); return; }
      this.cancelOperations.add(abort);
      cancelTimer = (this.operations.schedule ?? schedule)(this.timeoutMs,
        () => finish(true, new Error(`${label} timed out after ${this.timeoutMs}ms.`, { cause: new Error('Disk operation deadline exceeded.') })));
      void Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal); })
        .then(value => finish(false, value), error => finish(true, error));
    });
  }

  private emit(files: readonly CatalogFile[], changed: boolean) {
    const pending = changed || this.publicationPending;
    this.errors.delete('<publication>');
    try {
      this.publish(files, pending, this.diagnostic());
      this.publicationPending = false;
    } catch (error) {
      this.publicationPending = pending;
      this.errors.set('<publication>', this.failure(error));
    }
  }

  stop() {
    this.stopped = true;
    this.lifetime.abort(new Error('Live registry is stopped.'));
    for (const cancel of this.cancelOperations) cancel();
    this.rechecks.stop();
    this.timer?.();
    this.queued.clear();
    this.pendingParses.clear();
    for (const resolve of this.waiters) resolve();
    this.waiters = [];
  }
}
