import { createReviewBaseline } from './catalog-review.js';
import { planCatalogSync } from './catalog-sync.js';
import type { CatalogInspection } from './catalog-files.js';
import type { CatalogCheckReport } from './catalog-audit.js';

export interface TranslationWorkEntry {
  readonly locale: string;
  readonly namespace: string;
  readonly id: string;
  readonly reason: 'add' | 'review';
  readonly source: string;
  readonly sourceHash: string;
  readonly originalTranslation: string | null;
  readonly translation: string | null;
}
export interface TranslationWorkfile {
  readonly format: 'saylo-translation-work/v1';
  readonly baseLocale: string;
  readonly entries: readonly TranslationWorkEntry[];
}

/** A separate translator document; null is a pending task, never a runtime catalog value. */
export function createTranslationWorkfile(input: CatalogInspection, report: CatalogCheckReport): TranslationWorkfile {
  const plan = planCatalogSync(input, report);
  if (plan.blocked) throw new Error('Invalid catalogs block translation export. Run saylo check.');
  const hashes = createReviewBaseline(input, report.baseLocale).messages;
  return { format: 'saylo-translation-work/v1', baseLocale: report.baseLocale,
    entries: plan.changes.filter(change => change.action !== 'retain').map(change => ({
      locale: change.locale, namespace: change.namespace, id: change.id, reason: change.action as 'add' | 'review',
      source: change.baseSource!, sourceHash: hashes[`${change.namespace}:${change.id}`]!,
      originalTranslation: change.translation, translation: change.translation,
    })) };
}
