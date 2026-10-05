import { Worker } from 'node:worker_threads';
import type { CatalogSchema } from '@0disoft/saylo-core';
import { writeGenerated } from './write.js';

interface Job { generation: number; key: string; schemas: readonly CatalogSchema[] }
interface Waiter { resolve: () => void; reject: (error: Error) => void }

/** One active worker job and one latest desired generation. Intermediate jobs are coalesced. */
export class TypeGenerator {
  private worker: Worker | undefined;
  private active: Job | undefined;
  private desired: Job | undefined;
  private generation = 0;
  private successKey: string | undefined;
  private waiters = new Set<Waiter>();
  private stopped = false;
  private completion = Promise.resolve();
  private stopping: Promise<void> | undefined;

  constructor(readonly outFile: string) {
    if (!outFile.endsWith('.d.ts')) throw new Error('typegen outFile must end in .d.ts.');
  }
  /** Await at startup/build; live publication schedules without awaiting this promise. */
  update(schemas: readonly CatalogSchema[]): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Type generator is stopped.'));
    const key = JSON.stringify([...schemas].map(s => [s.namespace, s.fingerprint]).sort((a, b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
    if (!this.active && key === this.successKey) return Promise.resolve();
    if (key !== this.desired?.key) this.desired = { generation: ++this.generation, key, schemas };
    const promise = new Promise<void>((resolve, reject) => this.waiters.add({ resolve, reject }));
    try { this.start(); } catch (error) { this.fail(error); }
    return promise;
  }
  private start() {
    if (this.active || !this.desired || this.stopped) return;
    if (!this.worker) {
      const worker = new Worker(new URL('./worker.js', import.meta.url));
      this.worker = worker;
      worker.on('message', (result: { generation: number; source?: string; error?: string }) => {
        if (this.worker === worker) this.completion = this.complete(result).catch(error => this.fail(error));
      });
      worker.on('error', error => { if (this.worker === worker) this.fail(error); });
      worker.on('exit', code => { if (this.worker === worker && !this.stopped) this.fail(new Error(`Typegen worker exited (${code}).`)); });
    }
    this.active = this.desired;
    this.worker.ref();
    this.worker.postMessage({ generation: this.active.generation, schemas: this.active.schemas.map(s => ({ namespace: s.namespace, keys: s.keys })) });
  }
  private async complete(result: { generation: number; source?: string; error?: string }) {
    const job = this.active;
    if (!job || this.stopped || result.generation !== job.generation) return;
    if (job.generation === this.desired?.generation) {
      if (result.error || typeof result.source !== 'string') throw new Error(result.error ?? 'Invalid typegen worker result.');
      const status = await writeGenerated(this.outFile, result.source, () => !this.stopped && job.generation === this.desired?.generation);
      if (status !== 'cancelled' && job.generation === this.desired?.generation) this.successKey = job.key;
    }
    if (this.stopped) return;
    this.active = undefined;
    if (this.successKey !== this.desired?.key) { this.start(); return; }
    this.worker?.unref();
    for (const waiter of this.waiters) waiter.resolve();
    this.waiters.clear();
  }
  private fail(error: unknown) {
    if (this.stopped) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    const worker = this.worker;
    this.worker = undefined;
    this.active = undefined;
    if (worker) void worker.terminate();
    for (const waiter of this.waiters) waiter.reject(failure);
    this.waiters.clear();
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    for (const waiter of this.waiters) waiter.reject(new Error('Type generator is stopped.'));
    this.waiters.clear();
    const worker = this.worker;
    this.worker = undefined;
    this.stopping = Promise.all([worker?.terminate(), this.completion]).then(() => {});
    return this.stopping;
  }
}
