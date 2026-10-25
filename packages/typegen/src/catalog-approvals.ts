import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ParsedMessage } from '@0disoft/saylo-core';
import { createReviewBaseline } from './catalog-review.js';
import { reportIssues } from './catalog-audit.js';
import type { CatalogCheckReport, CatalogIssue } from './catalog-audit.js';
import type { CatalogInspection } from './catalog-files.js';

export interface ReviewApproval {
  readonly locale: string;
  readonly namespace: string;
  readonly id: string;
  readonly sourceHash: string;
  readonly translationHash: string;
  /** Operator-supplied audit context; not an authenticated identity. */
  readonly reviewer?: string;
  readonly reviewedAt?: string;
}
export interface ReviewApprovals {
  readonly format: 'saylo-review-approvals/v1';
  readonly baseLocale: string;
  readonly entries: readonly ReviewApproval[];
}
export interface ApprovalFile {
  readonly file: string;
  readonly source: string | null;
  readonly approvals: ReviewApprovals;
}
export const approvalIdentity = (entry: Pick<ReviewApproval, 'locale' | 'namespace' | 'id'>) => JSON.stringify([entry.locale, entry.namespace, entry.id]);
export const translationHash = (message: ParsedMessage) =>
  createHash('sha256').update(JSON.stringify([message.source, message.richTextTags ?? null])).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function parseReviewApprovals(source: string, baseLocale: string): ReviewApprovals {
  const value: unknown = JSON.parse(source.replace(/^\uFEFF/, ''));
  if (!record(value) || !fields(value, ['format', 'baseLocale', 'entries']) ||
      value.format !== 'saylo-review-approvals/v1' || value.baseLocale !== baseLocale || !Array.isArray(value.entries))
    throw new TypeError('Invalid review approvals format or base locale.');
  const identities = new Set<string>();
  for (const entry of value.entries) {
    if (!record(entry) || !fields(entry, ['locale', 'namespace', 'id', 'sourceHash', 'translationHash',
      ...(Object.hasOwn(entry, 'reviewer') ? ['reviewer'] : []), ...(Object.hasOwn(entry, 'reviewedAt') ? ['reviewedAt'] : [])]) ||
        !validReviewAttribution(entry) ||
        typeof entry.locale !== 'string' || !entry.locale || Intl.getCanonicalLocales(entry.locale)[0] !== entry.locale || entry.locale === baseLocale ||
        typeof entry.namespace !== 'string' || !entry.namespace || entry.namespace.startsWith('.') || /[:/\\\x00-\x1f]/.test(entry.namespace) ||
        typeof entry.id !== 'string' || !entry.id || entry.id.includes(':') || !hash(entry.sourceHash) || !hash(entry.translationHash))
      throw new TypeError('Invalid review approval entry.');
    const identity = approvalIdentity(entry as unknown as ReviewApproval);
    if (identities.has(identity)) throw new TypeError(`Duplicate review approval: ${identity}`);
    identities.add(identity);
  }
  return value as unknown as ReviewApprovals;
}

export function validReviewAttribution(value: { readonly reviewer?: unknown; readonly reviewedAt?: unknown }): boolean {
  if (value.reviewer === undefined && value.reviewedAt === undefined) return true;
  if (typeof value.reviewer !== 'string' || !value.reviewer.trim() || value.reviewer.length > 200 || /[\x00-\x1f]/.test(value.reviewer) ||
      typeof value.reviewedAt !== 'string') return false;
  try { return new Date(value.reviewedAt).toISOString() === value.reviewedAt; } catch { return false; }
}

export async function readReviewApprovals(file: string, baseLocale: string, allowMissing = false): Promise<ApprovalFile> {
  let source: string;
  try { source = await readFile(file, 'utf8'); }
  catch (cause) {
    if (allowMissing && (cause as NodeJS.ErrnoException).code === 'ENOENT')
      return { file, source: null, approvals: { format: 'saylo-review-approvals/v1', baseLocale, entries: [] } };
    throw new Error(`Unable to read review approvals: ${file}`, { cause });
  }
  try { return { file, source, approvals: parseReviewApprovals(source, baseLocale) }; }
  catch (cause) { throw new Error(`Invalid review approvals: ${file}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
}

/** Opt-in approval tracking is per locale/key and cannot be reset by replacing a global baseline. */
export function applyReviewApprovals(input: Pick<CatalogInspection, 'files'>, report: CatalogCheckReport, approvals: ReviewApprovals): CatalogCheckReport {
  const sourceIssues = new Map(report.diagnostics.filter(issue => ['SOURCE_CHANGED', 'SOURCE_ADDED'].includes(issue.code))
    .map(issue => [approvalIdentity({ ...issue, id: issue.id! }), issue]));
  const diagnostics: CatalogIssue[] = report.diagnostics.filter(issue => !['SOURCE_CHANGED', 'SOURCE_ADDED'].includes(issue.code));
  const records = new Map(approvals.entries.map(entry => [approvalIdentity(entry), entry]));
  const hashes = createReviewBaseline(input, report.baseLocale).messages;
  const targets = new Set(report.locales.filter(locale => locale !== report.baseLocale));
  for (const { catalog } of input.files) {
    if (!targets.has(catalog.locale)) continue;
    for (const [id, message] of Object.entries(catalog.messages)) {
      const sourceHash = hashes[`${catalog.namespace}:${id}`];
      if (!sourceHash) continue; // Existing missing/unknown catalog diagnostics remain authoritative.
      const identity = approvalIdentity({ locale: catalog.locale, namespace: catalog.namespace, id });
      const approved = records.get(identity);
      if (approved?.sourceHash === sourceHash && approved.translationHash === translationHash(message)) continue;
      const code = approved ? approved.sourceHash !== sourceHash ? 'SOURCE_CHANGED' : 'TRANSLATION_CHANGED'
        : sourceIssues.get(identity)?.code ?? 'REVIEW_REQUIRED';
      diagnostics.push({ code, severity: 'warning', locale: catalog.locale, namespace: catalog.namespace, id,
        sourceName: catalog.sourceName, position: message.position, message: 'Current source and translation need explicit review approval.' });
    }
  }
  return { ...reportIssues(report.baseLocale, report.locales, diagnostics),
    reviewTracking: report.reviewTracking === 'baseline' ? 'baseline-and-approvals' : 'approvals' };
}
