import { Worker } from 'node:worker_threads';
import type { CatalogSchema } from '@0disoft/saylo-core';
import { writeGenerated } from './write.js';

interface Job { generation: number; key: string; schemas: readonly CatalogSchema[] }
interface Waiter { resolve: () => void; reject: (error: Error) => void }
export interface TypegenWorker {
  on(event: 'message', listener: (result: { generation: number; source?: string; error?: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  ref(): unknown;
  unref(): unknown;
  postMessage(value: unknown): void;
  terminate(): Promise<number>;
}
export interface TypeGeneratorOperations {
  readonly createWorker?: () => TypegenWorker;
  readonly write?: typeof writeGenerated;
}

/** One active worker job and one latest desired generation. Intermediate jobs are coalesced. */
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

  constructor(readonly outFile: string, private operations: TypeGeneratorOperations = {}) {
    if (!outFile.endsWith('.d.ts')) throw new Error('typegen outFile must end in .d.ts.');
  }
  /** Await at startup/build; live publication schedules without awaiting this promise. */
  update(schemas: readonly CatalogSchema[]): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Type generator is stopped.'));
    const key = JSON.stringify([...schemas].map(s => [s.namespace, s.fingerprint]).sort((a, b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
    if (key !== this.desired?.key) this.desired = { generation: ++this.generation, key, schemas };
    const promise = new Promise<void>((resolve, reject) => this.waiters.add({ resolve, reject }));
    try { this.start(); } catch (error) { this.fail(error); }
    return promise;
  }
  private start() {
    if (this.active || !this.desired || this.stopped) return;
    this.active = this.desired;
    if (this.active.key === this.successKey && this.successSource !== undefined) {
      // Recheck the output through the same serialized writer without rerendering in the worker.
      this.queueResult({ generation: this.active.generation, source: this.successSource });
      return;
    }
    if (!this.worker) {
      const worker = this.operations.createWorker ? this.operations.createWorker() : new Worker(new URL('./worker.js', import.meta.url));
      this.worker = worker;
      worker.on('message', (result: { generation: number; source?: string; error?: string }) => {
        if (this.worker === worker) this.queueResult(result);
      });
      worker.on('error', error => { if (this.worker === worker) this.fail(error); });
      worker.on('exit', code => { if (this.worker === worker && !this.stopped) this.fail(new Error(`Typegen worker exited (${code}).`)); });
    }
    this.worker.ref();
    this.worker.postMessage({ generation: this.active.generation, schemas: this.active.schemas.map(s => ({ namespace: s.namespace, keys: s.keys })) });
  }
  private queueResult(result: { generation: number; source?: string; error?: string }) {
    const epoch = this.epoch;
    this.completion = this.completion.then(() => {
      if (epoch === this.epoch) return this.complete(result, epoch);
    }).catch(error => { if (epoch === this.epoch) this.fail(error); });
  }
  private async complete(result: { generation: number; source?: string; error?: string }, epoch: number) {
    const job = this.active;
    if (!job || this.stopped || result.generation !== job.generation) return;
    if (job.generation === this.desired?.generation) {
      if (result.error || typeof result.source !== 'string') throw new Error(result.error ?? 'Invalid typegen worker result.');
      const status = await (this.operations.write ?? writeGenerated)(this.outFile, result.source,
        () => !this.stopped && epoch === this.epoch && job.generation === this.desired?.generation);
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
    this.epoch++;
    const worker = this.worker;
    this.worker = undefined;
    this.active = undefined;
    if (worker) { try { void worker.terminate().catch(() => {}); } catch { /* Preserve the original failure. */ } }
    for (const waiter of this.waiters) waiter.reject(failure);
    this.waiters.clear();
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.epoch++;
    for (const waiter of this.waiters) waiter.reject(new Error('Type generator is stopped.'));
    this.waiters.clear();
    const worker = this.worker;
    this.worker = undefined;
    this.stopping = Promise.all([worker?.terminate(), this.completion]).then(() => {});
    return this.stopping;
  }
}
