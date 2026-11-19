import path from 'node:path';
import type { ParsedMessage } from '@0disoft/saylo-core';
import { reviewSourceHash } from './catalog-review.js';
import { approvalIdentity, translationHash, validReviewAttribution } from './catalog-approvals.js';
import type { ApprovalFile, ReviewApproval, ReviewApprovals } from './catalog-approvals.js';
import type { CatalogFile, CatalogInspection } from './catalog-files.js';
import type { CatalogCheckReport } from './catalog-audit.js';
import type { ImportGuard } from './catalog-import.js';
import type { TranslationWorkEntry, TranslationWorkfile } from './catalog-workfile.js';

export interface ApprovalReport {
  readonly format: 'saylo-review-approval/v1';
  readonly dryRun: boolean;
  readonly blocked: boolean;
  readonly changes: readonly ReviewApproval[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
  readonly writtenFiles: readonly string[];
}
export interface ApprovalPlan {
  readonly root: string;
  readonly ledger: ApprovalFile;
  readonly approvals: ReviewApprovals;
  readonly guards: readonly ImportGuard[];
  readonly report: ApprovalReport;
}

type Attribution = Pick<ReviewApproval, 'reviewer' | 'reviewedAt'>;
const APPROVAL_NON_BLOCKING_ISSUES = new Set(['MISSING_MESSAGE', 'MISSING_NAMESPACE', 'UNKNOWN_MESSAGE', 'NAMESPACE_MISMATCH']);
const pairKey = (locale: string, namespace: string) => JSON.stringify([locale, namespace]);

function validApprovalPath(root: string, file: string): boolean {
  const relative = path.relative(root, path.resolve(file));
  return file.endsWith('.json') && (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`));
}

function selectApproval(entry: TranslationWorkEntry, targets: ReadonlySet<string>, bases: ReadonlyMap<string, CatalogFile>,
  pairs: ReadonlyMap<string, CatalogFile>, hashSource: (message: ParsedMessage) => string, attribution: Attribution) {
  const { locale, namespace, id, translation } = entry;
  if (translation === null) return;
  const fail = (code: string, message: string) => ({ error: { code, message: `${locale} ${namespace}:${id}: ${message}` } });
  if (!targets.has(locale)) return fail('UNKNOWN_TARGET', 'Locale is not a current review target.');
  const base = bases.get(namespace);
  const source = base && Object.hasOwn(base.catalog.messages, id) ? base.catalog.messages[id] : undefined;
  if (!base || !source || hashSource(source) !== entry.sourceHash || source.source !== entry.source)
    return fail('SOURCE_CONFLICT', 'Source or rich contract differs from the reviewed workfile. Export fresh work.');
  const target = pairs.get(pairKey(locale, namespace));
  const message = target?.catalog.messages[id];
  if (!target || !message || message.source !== translation)
    return fail('TRANSLATION_CONFLICT', 'Current translation differs from the reviewed workfile. Import or export fresh work first.');
  const approved: ReviewApproval = { locale, namespace, id, sourceHash: entry.sourceHash, translationHash: translationHash(message), ...attribution };
  return { base, target, approved };
}

/** The workfile pins the human-reviewed text; approval never edits a translation or a source baseline. */
export function planReviewApproval(input: CatalogInspection, checked: CatalogCheckReport, work: TranslationWorkfile, ledger: ApprovalFile,
  attribution: Attribution = {}): ApprovalPlan {
  if (!validReviewAttribution(attribution)) throw new TypeError('Review attribution requires reviewer and a canonical ISO reviewedAt timestamp.');
  const diagnostics: { code: string; message: string }[] = checked.diagnostics.filter(issue => issue.severity === 'error' &&
    !APPROVAL_NON_BLOCKING_ISSUES.has(issue.code))
    .map(issue => ({ code: issue.code, message: `${issue.sourceName}: ${issue.message}` }));
  const changes: ReviewApproval[] = [], guards = new Map<string, ImportGuard>();
  if (!validApprovalPath(input.root, ledger.file))
    diagnostics.push({ code: 'INVALID_REVIEW_PATH', message: 'Review approvals require a .json file outside the locales directory.' });
  const targets = new Set(checked.locales);
  const bases = new Map(input.files.filter(file => file.catalog.locale === checked.baseLocale).map(file => [file.catalog.namespace, file]));
  const pairs = new Map(input.files.map(file => [pairKey(file.catalog.locale, file.catalog.namespace), file]));
  const entries = new Map(ledger.approvals.entries.map(entry => [approvalIdentity(entry), entry]));
  const hashes = new Map<ParsedMessage, string>();
  const hashSource = (message: ParsedMessage) => {
    const cached = hashes.get(message);
    if (cached !== undefined) return cached;
    const hash = reviewSourceHash(message);
    hashes.set(message, hash);
    return hash;
  };
  for (const entry of work.entries) {
    const selected = selectApproval(entry, targets, bases, pairs, hashSource, attribution);
    if (!selected) continue;
    if ('error' in selected) { diagnostics.push(selected.error); continue; }
    const { base, target, approved } = selected;
    const identity = approvalIdentity(approved), previous = entries.get(identity);
    if (previous?.sourceHash === approved.sourceHash && previous.translationHash === approved.translationHash) continue;
    entries.set(identity, approved); changes.push(approved);
    guards.set(base.file, { file: base.file, source: base.source });
    guards.set(target.file, { file: target.file, source: target.source });
  }
  const sorted = [...entries.keys()].sort().map(key => entries.get(key)!);
  return { root: input.root, ledger, guards: [...guards.values()],
    approvals: { format: 'saylo-review-approvals/v1', baseLocale: checked.baseLocale, entries: sorted },
    report: { format: 'saylo-review-approval/v1', dryRun: true, blocked: diagnostics.length > 0, changes, diagnostics, writtenFiles: [] } };
}
