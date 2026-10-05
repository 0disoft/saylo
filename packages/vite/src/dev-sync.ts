import { isSnapshotRequest } from './types.js';
import type { EagerCatalogEvent, EagerSnapshotRequest } from './types.js';

interface SyncOptions {
  readonly timeoutMs: number;
  readonly scope: () => Pick<EagerSnapshotRequest, 'locale' | 'namespaces'>;
  readonly send: (request: EagerSnapshotRequest) => void;
  readonly commit: (event: EagerCatalogEvent) => boolean;
  readonly report: (error: unknown) => void;
}

/** Eager handshake coordinator. Keeps the last good UI until a current reply arrives. */
export class EagerSync {
  // getRandomValues also works on HTTP LAN dev hosts where randomUUID is unavailable.
  private readonly id = crypto.getRandomValues(new Uint32Array(4)).join('-');
  private generation = 0;
  private sessionId: string | undefined;
  private revision = -1;
  private readonly retired = new Set<string>();
  private pending: EagerSnapshotRequest | undefined;
  private hint: { sessionId: string; revision: number } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private needsSnapshot = true;
  private disconnected = false;
  private stopped = false;

  constructor(private readonly options: SyncOptions) {}

  start() { this.request(); }

  disconnect() {
    this.disconnected = true;
    this.clearPending();
    this.needsSnapshot = true;
    this.hint = undefined;
    this.attempts = 0;
  }

  reconnect() {
    // The first ws:connect is already covered by Vite's buffered initial request.
    if (this.stopped || (!this.disconnected && (!this.needsSnapshot || this.pending))) return;
    this.disconnected = false;
    this.recover();
  }

  stop() { this.stopped = true; this.clearPending(); }

  acceptsRequest(request: EagerSnapshotRequest) {
    return !this.stopped && !this.disconnected && isSnapshotRequest(request) &&
      request.requestId === `${this.id}:${this.generation}` && request.generation === this.generation;
  }

  receive(event: EagerCatalogEvent) {
    if (this.stopped || this.disconnected) return;
    if (!event || typeof event.sessionId !== 'string' || !event.sessionId ||
        !Number.isSafeInteger(event.revision) || event.revision < 0 || !Array.isArray(event.catalogs) ||
        (event.kind !== 'snapshot' && event.kind !== 'update')) {
      this.options.report(new Error('Invalid eager snapshot envelope.'));
      return;
    }
    if (event.kind === 'snapshot') {
      const request = this.pending;
      if (!request || !this.acceptsRequest(event.request)) return;
      if (event.request.locale !== request.locale ||
          JSON.stringify(event.request.namespaces) !== JSON.stringify(request.namespaces)) {
        this.options.report(new Error('Eager snapshot request scope differs.'));
        return;
      }
      const floor = this.hint ?? (this.sessionId ? { sessionId: this.sessionId, revision: this.revision } : undefined);
      if (this.retired.has(event.sessionId) || (floor &&
          (event.sessionId === floor.sessionId ? event.revision < floor.revision : this.hint !== undefined))) {
        this.retry();
        return;
      }
      if (!this.options.commit(event)) return;
      this.adopt(event);
      this.clearPending();
      this.hint = undefined;
      this.needsSnapshot = false;
      this.attempts = 0;
      return;
    }
    if (!Number.isSafeInteger(event.baseRevision) || event.baseRevision < 0 || event.revision !== event.baseRevision + 1) {
      this.options.report(new Error('Invalid eager update revision.'));
      return;
    }
    if (this.retired.has(event.sessionId) || (event.sessionId === this.sessionId && event.revision <= this.revision)) return;
    if (this.needsSnapshot || this.pending || event.sessionId !== this.sessionId || event.baseRevision !== this.revision) {
      if (!this.hint || event.sessionId !== this.hint.sessionId || event.revision > this.hint.revision)
        this.hint = { sessionId: event.sessionId, revision: event.revision };
      if (!this.pending) this.recover();
      return;
    }
    if (this.options.commit(event)) this.adopt(event);
    else this.recover();
  }

  private adopt(event: EagerCatalogEvent) {
    if (this.sessionId && this.sessionId !== event.sessionId) this.retired.add(this.sessionId);
    this.sessionId = event.sessionId;
    this.revision = event.revision;
  }

  private clearPending() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  private request() {
    this.needsSnapshot = true;
    this.attempts++;
    const generation = ++this.generation;
    const request: EagerSnapshotRequest = { ...this.options.scope(), scope: 'eager',
      requestId: `${this.id}:${generation}`, generation };
    this.pending = request;
    this.timer = setTimeout(() => this.retry(), this.options.timeoutMs);
    this.options.send(request);
  }

  private recover() {
    if (this.stopped || this.disconnected) return;
    this.attempts = 0;
    try { this.request(); }
    catch (error) { this.clearPending(); this.options.report(error); }
  }

  private retry() {
    this.clearPending();
    if (this.stopped || this.disconnected) return;
    if (this.attempts >= 3) {
      this.options.report(new Error('Eager snapshot resync failed after 3 attempts; retaining the last good state.'));
      return;
    }
    try { this.request(); }
    catch (error) { this.clearPending(); this.options.report(error); }
  }
}
