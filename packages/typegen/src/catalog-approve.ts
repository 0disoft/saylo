import { createReviewBaseline } from './catalog-review.js';
import { approvalIdentity, translationHash, validReviewAttribution } from './catalog-approvals.js';
import type { ApprovalFile, ReviewApproval, ReviewApprovals } from './catalog-approvals.js';
import type { CatalogInspection } from './catalog-files.js';
import type { CatalogCheckReport } from './catalog-audit.js';
import type { ImportGuard } from './catalog-import.js';
import type { TranslationWorkfile } from './catalog-workfile.js';
import path from 'node:path';

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

/** The workfile pins the human-reviewed text; approval never edits a translation or a source baseline. */
export function planReviewApproval(input: CatalogInspection, checked: CatalogCheckReport, work: TranslationWorkfile, ledger: ApprovalFile,
  attribution: { readonly reviewer?: string; readonly reviewedAt?: string } = {}): ApprovalPlan {
  if (!validReviewAttribution(attribution)) throw new TypeError('Review attribution requires reviewer and a canonical ISO reviewedAt timestamp.');
  const diagnostics: { code: string; message: string }[] = checked.diagnostics.filter(issue => issue.severity === 'error' &&
    !['MISSING_MESSAGE', 'MISSING_NAMESPACE', 'UNKNOWN_MESSAGE', 'NAMESPACE_MISMATCH'].includes(issue.code))
    .map(issue => ({ code: issue.code, message: `${issue.sourceName}: ${issue.message}` }));
  const changes: ReviewApproval[] = [], guards = new Map<string, ImportGuard>();
  const relative = path.relative(input.root, path.resolve(ledger.file));
  if (!ledger.file.endsWith('.json') || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)))
    diagnostics.push({ code: 'INVALID_REVIEW_PATH', message: 'Review approvals require a .json file outside the locales directory.' });
  const hashes = createReviewBaseline(input, checked.baseLocale).messages;
  const bases = new Map(input.files.filter(file => file.catalog.locale === checked.baseLocale).map(file => [file.catalog.namespace, file]));
  const pairs = new Map(input.files.map(file => [JSON.stringify([file.catalog.locale, file.catalog.namespace]), file]));
  const entries = new Map(ledger.approvals.entries.map(entry => [approvalIdentity(entry), entry]));
  for (const entry of work.entries) {
    if (entry.translation === null) continue;
    const key = `${entry.namespace}:${entry.id}`, sourceHash = hashes[key];
    const base = bases.get(entry.namespace);
    const fail = (code: string, message: string) => diagnostics.push({ code, message: `${entry.locale} ${key}: ${message}` });
    if (!checked.locales.includes(entry.locale)) { fail('UNKNOWN_TARGET', 'Locale is not a current review target.'); continue; }
    if (!base || !sourceHash || entry.sourceHash !== sourceHash || base.catalog.messages[entry.id]?.source !== entry.source) {
      fail('SOURCE_CONFLICT', 'Source or rich contract differs from the reviewed workfile. Export fresh work.'); continue;
    }
    const target = pairs.get(JSON.stringify([entry.locale, entry.namespace]));
    const message = target?.catalog.messages[entry.id];
    if (!message || message.source !== entry.translation) {
      fail('TRANSLATION_CONFLICT', 'Current translation differs from the reviewed workfile. Import or export fresh work first.'); continue;
    }
    const approved: ReviewApproval = { locale: entry.locale, namespace: entry.namespace, id: entry.id,
      sourceHash, translationHash: translationHash(message), ...attribution };
    const identity = approvalIdentity(approved), previous = entries.get(identity);
    if (previous?.sourceHash === approved.sourceHash && previous.translationHash === approved.translationHash) continue;
    entries.set(identity, approved); changes.push(approved);
    guards.set(base.file, { file: base.file, source: base.source });
    guards.set(target!.file, { file: target!.file, source: target!.source });
  }
  const sorted = [...entries.values()].sort((a, b) => approvalIdentity(a) < approvalIdentity(b) ? -1 : approvalIdentity(a) > approvalIdentity(b) ? 1 : 0);
  return { root: input.root, ledger, guards: [...guards.values()],
    approvals: { format: 'saylo-review-approvals/v1', baseLocale: checked.baseLocale, entries: sorted },
    report: { format: 'saylo-review-approval/v1', dryRun: true, blocked: diagnostics.length > 0, changes, diagnostics, writtenFiles: [] } };
}
