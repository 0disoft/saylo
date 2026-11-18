import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { inspectProject } from './catalog-audit.js';
import { applyReviewApprovals, readReviewApprovals } from './catalog-approvals.js';
import { createTranslationWorkfile } from './catalog-workfile.js';
import { planTranslationImport } from './catalog-import.js';
import { applyTranslationImport } from './catalog-apply.js';
import { planReviewApproval } from './catalog-approve.js';
import { writeReviewApproval } from './review-write.js';
import { readTranslationMetadata } from './translation-metadata.js';
import { reviewPage } from './review-page.js';
import { planCatalogSync } from './catalog-sync.js';
import type { SayloProjectConfig } from './config.js';
import type { CatalogScanOptions } from './catalog-files.js';
import type { CatalogCheckReport } from './catalog-audit.js';
import type { TranslationWorkfile } from './catalog-workfile.js';

const REVIEW_LIMITS = {
  bodyBytes: 256 * 1024,
  pendingRequests: 32,
  pageSize: 200,
  queryLength: 200,
  requestTimeoutMs: 10_000,
  headersTimeoutMs: 15_000,
  keepAliveTimeoutMs: 3_000,
} as const;
const TOKEN_BYTES = 32, CSP_NONCE_BYTES = 16;
type ReviewAction = 'state' | 'preview' | 'save' | 'approve';

class RequestError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new RequestError(415, 'Use application/json.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size <= REVIEW_LIMITS.bodyBytes) chunks.push(bytes);
  }
  if (size > REVIEW_LIMITS.bodyBytes) throw new RequestError(413, 'Draft request is too large.');
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400, 'Invalid draft request.');
  return value as Record<string, unknown>;
}
const identity = (entry: { locale: unknown; namespace: unknown; id: unknown }) => JSON.stringify([entry.locale, entry.namespace, entry.id]);

function authorizeReviewApi(headers: IncomingMessage['headers'], expected: Buffer, origin: string,
  method: string | undefined, pathname: string): ReviewAction {
  const supplied = Buffer.from(headers.authorization ?? '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new RequestError(403, 'Review authorization required.');
  if (headers.origin !== undefined && headers.origin !== origin) throw new RequestError(403, 'Invalid review origin.');
  if (method === 'GET' && pathname === '/api/state') return 'state';
  if (method !== 'POST' || (pathname !== '/api/preview' && pathname !== '/api/save' && pathname !== '/api/approve'))
    throw new RequestError(404, 'Unknown review endpoint.');
  if (headers.origin !== origin) throw new RequestError(403, 'Review writes require the same origin.');
  return pathname === '/api/preview' ? 'preview' : pathname === '/api/save' ? 'save' : 'approve';
}

function reviewStateResponse(revision: string, work: TranslationWorkfile | undefined,
  diagnostics: CatalogCheckReport['diagnostics'], rawQuery: string) {
  const query = rawQuery.slice(0, REVIEW_LIMITS.queryLength).toLowerCase();
  const issues = new Map<string, string>();
  for (const issue of diagnostics) {
    if (issue.id !== undefined) issues.set(identity({ ...issue, id: issue.id }), issue.code);
  }
  const rows: (TranslationWorkfile['entries'][number] & { status: string })[] = [];
  let total = 0;
  for (const entry of work?.entries ?? []) {
    if (query && !`${entry.locale} ${entry.namespace}:${entry.id} ${entry.source} ${entry.originalTranslation ?? ''}`.toLowerCase().includes(query)) continue;
    total++;
    if (rows.length === REVIEW_LIMITS.pageSize) continue;
    const status = entry.originalTranslation === null ? 'untranslated' : issues.get(identity(entry)) ?? 'approved';
    rows.push({ ...entry, status });
  }
  return { revision, rows, total, diagnostics: diagnostics.slice(0, REVIEW_LIMITS.pageSize) };
}

function prepareReviewDraft(body: Readonly<Record<string, unknown>> | undefined, revision: string,
  work: TranslationWorkfile | undefined): TranslationWorkfile {
  if (!body || body.revision !== revision) throw new RequestError(409, 'Catalogs, metadata or approvals changed. Refresh before saving.');
  const input = body.entry;
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('locale' in input) || !('namespace' in input) || !('id' in input) ||
      !('translation' in input) || typeof input.translation !== 'string') throw new RequestError(400, 'Invalid translation draft.');
  const original = work?.entries.find(entry => identity(entry) === identity(input));
  if (!original || !work) throw new RequestError(409, 'The selected message is no longer available.');
  return { ...work, entries: [{ ...original, translation: input.translation }] };
}

/** Loopback-only, authenticated local editor; all writes reuse guarded CLI import/approval plans. */
export async function startReviewServer(config: SayloProjectConfig,
  options: { readonly port?: number; readonly metadataFile?: string; readonly signal?: AbortSignal;
    readonly readCatalog?: CatalogScanOptions['read'] } = {}) {
  options.signal?.throwIfAborted();
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const expected = Buffer.from('Bearer ' + token);
  const controller = new AbortController();
  const reviews = config.reviews ?? path.join(path.dirname(config.localesDir), '.saylo-reviews.json');
  let queue = Promise.resolve(), pending = 0, origin = '';
  const load = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    const inspected = await inspectProject(config, { signal, ...(options.readCatalog ? { read: options.readCatalog } : {}) });
    signal.throwIfAborted();
    const ledger = await readReviewApprovals(reviews, config.baseLocale, true);
    signal.throwIfAborted();
    const metadata = options.metadataFile === undefined ? undefined : await readTranslationMetadata(options.metadataFile);
    signal.throwIfAborted();
    const report = applyReviewApprovals(inspected.inspection, inspected.report, ledger.approvals);
    // An empty ledger enumerates all current messages, including already-approved translations.
    const all = applyReviewApprovals(inspected.inspection, inspected.report, { ...ledger.approvals, entries: [] });
    const work = planCatalogSync(inspected.inspection, all).blocked ? undefined
      : createTranslationWorkfile(inspected.inspection, all, { withContext: true, ...(metadata ? { metadata } : {}) });
    const revision = createHash('sha256').update(JSON.stringify([inspected.inspection.files.map(file => [file.file, file.source]),
      report.locales, ledger.source, metadata ?? null])).digest('hex');
    return { ...inspected, report, ledger, work, revision };
  };

  const runReviewAction = async (action: ReviewAction, body: Record<string, unknown> | undefined,
    url: URL, signal: AbortSignal) => {
    signal.throwIfAborted();
    const current = await load(signal);
    if (action === 'state')
      return reviewStateResponse(current.revision, current.work, current.report.diagnostics, url.searchParams.get('q') ?? '');

    const work = prepareReviewDraft(body, current.revision, current.work);
    if (action === 'approve') {
      if (typeof body?.reviewer !== 'string') throw new RequestError(400, 'A reviewer name is required.');
      const plan = planReviewApproval(current.inspection, current.report, work, current.ledger,
        { reviewer: body.reviewer, reviewedAt: new Date().toISOString() });
      if (plan.report.blocked) return plan.report;
      return await writeReviewApproval(plan, { signal });
    }

    const plan = planTranslationImport(current.inspection, current.report, config, work);
    if (action === 'preview' || plan.report.blocked) return plan.report;
    return await applyTranslationImport(plan, { signal });
  };

  const server = createServer(async (request, response) => {
    const send = (status: number, value: unknown) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    const aborted = new AbortController();
    const abort = () => { if (!response.writableEnded) aborted.abort(new Error('Review client disconnected.')); };
    request.once('aborted', abort); response.once('close', abort);
    let admitted = false;
    try {
      if (request.headers.host !== new URL(origin).host) throw new RequestError(403, 'Invalid review host.');
      const url = new URL(request.url ?? '/', origin);
      if (request.method === 'GET' && url.pathname === '/') {
        const nonce = randomBytes(CSP_NONCE_BYTES).toString('hex');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
          'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` });
        response.end(reviewPage(token, nonce)); return;
      }
      const action = authorizeReviewApi(request.headers, expected, origin, request.method, url.pathname);
      if (pending >= REVIEW_LIMITS.pendingRequests) throw new RequestError(503, 'Review queue is busy.');
      pending++; admitted = true;
      const body = action === 'state' ? undefined : await readBody(request);
      const signal = AbortSignal.any([controller.signal, aborted.signal]);
      const result = queue.then(() => runReviewAction(action, body, url, signal));
      queue = result.then(() => undefined, () => undefined);
      send(200, await result);
    } catch (error) { send(error instanceof RequestError ? error.status : 400, { error: error instanceof Error ? error.message : String(error) }); }
    finally { if (admitted) pending--; request.off('aborted', abort); response.off('close', abort); }
  });
  server.requestTimeout = REVIEW_LIMITS.requestTimeoutMs;
  server.headersTimeout = REVIEW_LIMITS.headersTimeoutMs;
  server.keepAliveTimeout = REVIEW_LIMITS.keepAliveTimeoutMs;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    controller.abort(new Error('Review server stopped.'));
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    await queue;
    options.signal?.removeEventListener('abort', onAbort);
  })();
  const onAbort = () => { void close(); };
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') { await close(); throw new Error('Cannot resolve review address.'); }
  origin = `http://127.0.0.1:${address.port}`;
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) { await close(); options.signal.throwIfAborted(); }
  return { url: origin, close };
}
