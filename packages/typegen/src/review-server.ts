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

const MAX_BODY_BYTES = 256 * 1024, MAX_PENDING_REQUESTS = 32, PAGE_SIZE = 200;
class RequestError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new RequestError(415, 'Use application/json.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size <= MAX_BODY_BYTES) chunks.push(bytes);
  }
  if (size > MAX_BODY_BYTES) throw new RequestError(413, 'Draft request is too large.');
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400, 'Invalid draft request.');
  return value as Record<string, unknown>;
}
const identity = (entry: { locale: unknown; namespace: unknown; id: unknown }) => JSON.stringify([entry.locale, entry.namespace, entry.id]);

/** Loopback-only, authenticated local editor; all writes reuse guarded CLI import/approval plans. */
export async function startReviewServer(config: SayloProjectConfig,
  options: { readonly port?: number; readonly metadataFile?: string; readonly signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from('Bearer ' + token);
  const controller = new AbortController();
  const reviews = config.reviews ?? path.join(path.dirname(config.localesDir), '.saylo-reviews.json');
  let queue = Promise.resolve(), pending = 0, origin = '';
  const load = async () => {
    controller.signal.throwIfAborted();
    const inspected = await inspectProject(config);
    const ledger = await readReviewApprovals(reviews, config.baseLocale, true);
    const metadata = options.metadataFile === undefined ? undefined : await readTranslationMetadata(options.metadataFile);
    const report = applyReviewApprovals(inspected.inspection, inspected.report, ledger.approvals);
    // An empty ledger enumerates all current messages, including already-approved translations.
    const all = applyReviewApprovals(inspected.inspection, inspected.report, { ...ledger.approvals, entries: [] });
    const work = planCatalogSync(inspected.inspection, all).blocked ? undefined
      : createTranslationWorkfile(inspected.inspection, all, { withContext: true, ...(metadata ? { metadata } : {}) });
    const revision = createHash('sha256').update(JSON.stringify([inspected.inspection.files.map(file => [file.file, file.source]),
      report.locales, ledger.source, metadata ?? null])).digest('hex');
    return { ...inspected, report, ledger, work, revision };
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
        const nonce = randomBytes(16).toString('hex');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
          'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` });
        response.end(reviewPage(token, nonce)); return;
      }
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new RequestError(403, 'Review authorization required.');
      if (request.headers.origin !== undefined && request.headers.origin !== origin) throw new RequestError(403, 'Invalid review origin.');
      const reading = request.method === 'GET' && url.pathname === '/api/state';
      if (!reading && (request.method !== 'POST' || !['/api/preview', '/api/save', '/api/approve'].includes(url.pathname)))
        throw new RequestError(404, 'Unknown review endpoint.');
      if (!reading && request.headers.origin !== origin) throw new RequestError(403, 'Review writes require the same origin.');
      if (pending >= MAX_PENDING_REQUESTS) throw new RequestError(503, 'Review queue is busy.');
      pending++; admitted = true;
      const body = reading ? undefined : await readBody(request);
      const signal = AbortSignal.any([controller.signal, aborted.signal]);
      const result = queue.then(async () => {
        signal.throwIfAborted();
        const current = await load();
        if (reading) {
          const query = (url.searchParams.get('q') ?? '').slice(0, 200).toLowerCase();
          const issues = new Map(current.report.diagnostics.filter(issue => issue.id !== undefined)
            .map(issue => [identity({ ...issue, id: issue.id }), issue.code]));
          const rows = (current.work?.entries ?? []).map(entry => ({ ...entry,
            status: entry.originalTranslation === null ? 'untranslated' : issues.get(identity(entry)) ?? 'approved' }))
            .filter(entry => `${entry.locale} ${entry.namespace}:${entry.id} ${entry.source} ${entry.originalTranslation ?? ''}`.toLowerCase().includes(query));
          return { revision: current.revision, rows: rows.slice(0, PAGE_SIZE), total: rows.length, diagnostics: current.report.diagnostics.slice(0, PAGE_SIZE) };
        }
        if (!body || body.revision !== current.revision) throw new RequestError(409, 'Catalogs, metadata or approvals changed. Refresh before saving.');
        const input = body.entry;
        if (!input || typeof input !== 'object' || Array.isArray(input) || !('locale' in input) || !('namespace' in input) || !('id' in input) ||
            !('translation' in input) || typeof input.translation !== 'string') throw new RequestError(400, 'Invalid translation draft.');
        const original = current.work?.entries.find(entry => identity(entry) === identity(input));
        if (!original || !current.work) throw new RequestError(409, 'The selected message is no longer available.');
        const work = { ...current.work, entries: [{ ...original, translation: input.translation }] };
        if (url.pathname === '/api/approve') {
          if (typeof body.reviewer !== 'string') throw new RequestError(400, 'A reviewer name is required.');
          const plan = planReviewApproval(current.inspection, current.report, work, current.ledger,
            { reviewer: body.reviewer, reviewedAt: new Date().toISOString() });
          return plan.report.blocked ? plan.report : await writeReviewApproval(plan, { signal });
        }
        const plan = planTranslationImport(current.inspection, current.report, config, work);
        return url.pathname === '/api/save' && !plan.report.blocked ? await applyTranslationImport(plan, { signal }) : plan.report;
      });
      queue = result.then(() => undefined, () => undefined);
      send(200, await result);
    } catch (error) { send(error instanceof RequestError ? error.status : 400, { error: error instanceof Error ? error.message : String(error) }); }
    finally { if (admitted) pending--; request.off('aborted', abort); response.off('close', abort); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 15000; server.keepAliveTimeout = 3000;
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
