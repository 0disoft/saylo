import { applyReviewApprovals, readReviewApprovals } from './catalog-approvals.js';
import { reportIssues } from './catalog-audit.js';
import type { CatalogIssue } from './catalog-audit.js';
import type { CatalogFile } from './catalog-files.js';

export class TranslationReviewError extends Error {
  constructor(readonly diagnostics: readonly CatalogIssue[]) {
    super(diagnostics.map(issue => `${issue.sourceName} [${issue.id}]: ${issue.code}: ${issue.message}`).join('\n'));
    this.name = 'TranslationReviewError';
  }
}

/** Check the same parsed catalogs that will be built; completeness is the caller's separate prerequisite. */
export async function requireReviewedTranslations(files: readonly CatalogFile[], baseLocale: string, reviews: string): Promise<void> {
  const ledger = await readReviewApprovals(reviews, baseLocale);
  const locales = [...new Set(files.map(file => file.catalog.locale))].sort();
  const report = applyReviewApprovals({ files }, reportIssues(baseLocale, locales, []), ledger.approvals);
  if (report.diagnostics.length) throw new TranslationReviewError(report.diagnostics);
}
