import { Worker } from 'node:worker_threads';
import type { CatalogSchema } from '@0disoft/saylo-core';
import type { WriteResult } from './write.js';
import { writeGenerated } from './write.js';
import { acquireOutputLock } from './output-lock.js';
import type { OutputLock } from './output-lock.js';
import { deadlineError, schedule, timeoutDuration, withinDeadline } from './deadline.js';
import type { Schedule } from './deadline.js';
import { restoreFailure } from './worker-errors.js';
import type { WorkerFailure } from './worker-errors.js';

interface Job { generation: number; key: string; schemas: readonly CatalogSchema[] }
interface Waiter { resolve: () => void; reject: (error: Error) => void }
interface WorkerResult { generation: number; source?: string; error?: string; failure?: WorkerFailure }
export interface TypegenWorker {
  on(event: 'message', listener: (result: WorkerResult) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  ref(): unknown;
  unref(): unknown;
  postMessage(value: unknown): void;
  terminate(): Promise<number>;
}
export interface TypeGeneratorOperations {
  readonly timeoutMs?: number;
  readonly schedule?: Schedule;
  readonly createWorker?: () => TypegenWorker;
  readonly write?: typeof writeGenerated;
  readonly acquireLock?: (outFile: string) => OutputLock;
}

/** One output owner until stop(), with one active worker job and one latest desired generation. */
export class TypeGenerator {
  private worker: ReturnType<NonNullable<TypeGeneratorOperations['createWorker']>> | undefined;
  private active: Job | undefined;
  private desired: Job | undefined;
  private generation = 0;
  private successKey: string | undefined;
  private successSource: string | undefined;
  private waiters = new Set<Waiter>();
  private stopped = false;
  private completion = Promise.resolve();
  private stopping: Promise<void> | undefined;
  private epoch = 0;
  private lock: OutputLock | undefined;
  private readonly timeoutMs: number;
  private workerTimer: (() => void) | undefined;
  private writerAbort: AbortController | undefined;
  private writeBlocked: Error | undefined;
  private terminations = new Set<Promise<void>>();
  private cleanupErrors: unknown[] = [];
  private failureCause: Error | undefined;

  constructor(readonly outFile: string, private operations: TypeGeneratorOperations = {}) {
    if (!outFile.endsWith('.d.ts')) throw new Error('typegen outFile must end in .d.ts.');
    this.timeoutMs = timeoutDuration(operations.timeoutMs);
  }
  /** Await at startup/build; live publication schedules without awaiting this promise. */
  update(schemas: readonly CatalogSchema[]): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Type generator is stopped.'));
    if (this.writeBlocked) return Promise.reject(this.writeBlocked);
    const key = JSON.stringify([...schemas].map(s => [s.namespace, s.fingerprint]).sort((a, b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
    if (key !== this.desired?.key) this.desired = { generation: ++this.generation, key, schemas };
    const promise = new Promise<void>((resolve, reject) => this.waiters.add({ resolve, reject }));
    try { this.start(); } catch (error) { this.fail(error); }
    return promise;
  }
  private start() {
    if (this.active || !this.desired || this.stopped) return;
    this.lock ??= (this.operations.acquireLock ?? acquireOutputLock)(this.outFile);
    this.active = this.desired;
    if (this.active.key === this.successKey && this.successSource !== undefined) {
      // Recheck the output through the same serialized writer without rerendering in the worker.
      this.queueResult({ generation: this.active.generation, source: this.successSource });
      return;
    }
    if (!this.worker) {
      const worker = this.operations.createWorker ? this.operations.createWorker() : new Worker(new URL('./worker.js', import.meta.url));
      this.worker = worker;
      worker.on('message', (result: WorkerResult) => {
        if (this.worker === worker && result.generation === this.active?.generation) {
          this.clearWorkerTimer();
          this.queueResult(result);
        }
      });
      worker.on('error', error => { if (this.worker === worker) this.fail(error); });
      worker.on('exit', code => { if (this.worker === worker && !this.stopped) this.fail(new Error(`Typegen worker exited (${code}).`)); });
    }
    this.worker.ref();
    this.workerTimer = (this.operations.schedule ?? schedule)(this.timeoutMs,
      () => this.fail(deadlineError('Typegen worker', this.timeoutMs)));
    this.worker.postMessage({ generation: this.active.generation, schemas: this.active.schemas.map(s => ({ namespace: s.namespace, keys: s.keys })) });
  }
  private queueResult(result: WorkerResult) {
    const epoch = this.epoch;
    this.completion = this.completion.then(() => {
      if (epoch === this.epoch) return this.complete(result, epoch);
    }).catch(error => { if (epoch === this.epoch) this.fail(error); });
  }
  private async complete(result: WorkerResult, epoch: number) {
    const job = this.active;
    if (!job || this.stopped || result.generation !== job.generation) return;
    if (job.generation === this.desired?.generation) {
      if (result.failure) throw restoreFailure(result.failure);
      if (result.error || typeof result.source !== 'string') throw new Error(result.error ?? 'Invalid typegen worker result.');
      const controller = new AbortController();
      this.writerAbort = controller;
      const writing = Promise.resolve().then(() => (this.operations.write ?? writeGenerated)(this.outFile, result.source!,
        () => !this.stopped && epoch === this.epoch && job.generation === this.desired?.generation,
        { lock: this.lock!, signal: controller.signal }));
      let status: WriteResult;
      try {
        status = await withinDeadline(writing, this.timeoutMs, this.operations.schedule ?? schedule, 'Typegen write', controller);
      } catch (error) {
        const expired = (error as { code?: string } | null)?.code === 'TIMEOUT';
        if (expired) this.writeBlocked = error as Error;
        if (expired || epoch === this.epoch) this.fail(error);
        // Keep serialization and output ownership until the physical write settles.
        // A reporting deadline cannot cancel an OS filesystem operation.
        await writing.then(() => {}, lateError => {
          if (expired && lateError !== error) this.cleanupErrors.push(new AggregateError([error, lateError],
            'Timed out typegen write also failed while settling.', { cause: error }));
        });
        return;
      } finally {
        if (this.writerAbort === controller) this.writerAbort = undefined;
        this.writeBlocked = undefined;
      }
      if (epoch !== this.epoch) return;
      // A completed replacement describes the disk even if a newer request arrived during it.
      if (status !== 'cancelled') { this.successKey = job.key; this.successSource = result.source; }
    }
    if (this.stopped) return;
    this.active = undefined;
    if (job.generation !== this.desired?.generation || this.successKey !== this.desired?.key) { this.start(); return; }
    this.worker?.unref();
    for (const waiter of this.waiters) waiter.resolve();
    this.waiters.clear();
  }
  private fail(error: unknown) {
    if (this.stopped) return;
    let failure: Error;
    try { failure = error instanceof Error ? error : new Error(String(error)); }
    catch { failure = new Error('Typegen failed with an unreadable error.'); }
    this.failureCause ??= failure;
    this.epoch++;
    this.clearWorkerTimer();
    this.writerAbort?.abort(failure);
    const worker = this.worker;
    this.worker = undefined;
    this.active = undefined;
    if (worker) this.terminate(worker, failure);
    for (const waiter of this.waiters) waiter.reject(failure);
    this.waiters.clear();
  }
  private clearWorkerTimer() { this.workerTimer?.(); this.workerTimer = undefined; }

  private terminate(worker: TypegenWorker, cause?: Error) {
    const pending = withinDeadline(Promise.resolve().then(() => worker.terminate()), this.timeoutMs,
      this.operations.schedule ?? schedule, 'Typegen worker termination').then(() => {}, error => {
      this.cleanupErrors.push(cause ? new AggregateError([cause, error], 'Typegen failed and worker termination also failed.', { cause }) : error);
    });
    this.terminations.add(pending);
    void pending.then(() => { this.terminations.delete(pending); });
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.epoch++;
    this.clearWorkerTimer();
    this.writerAbort?.abort(new Error('Type generator is stopped.'));
    for (const waiter of this.waiters) waiter.reject(new Error('Type generator is stopped.'));
    this.waiters.clear();
    const worker = this.worker;
    this.worker = undefined;
    if (worker) this.terminate(worker);
    this.stopping = (async () => {
      const results = await Promise.allSettled([...this.terminations, this.completion]);
      const errors: unknown[] = [...this.cleanupErrors, ...results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])];
      try { await this.lock?.release(); } catch (error) { errors.push(error); }
      this.lock = undefined;
      if (errors.length && this.failureCause && !errors.some(error => error instanceof AggregateError && error.cause === this.failureCause))
        errors.unshift(this.failureCause);
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'Typegen shutdown failed after releasing owned resources.', { cause: this.failureCause ?? errors[0] });
    })();
    return this.stopping;
  }
}
