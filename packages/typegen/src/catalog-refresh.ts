import { createReviewBaseline } from './catalog-review.js';
import { planCatalogSync } from './catalog-sync.js';
import { createTranslationWorkfile } from './catalog-workfile.js';
import type { CatalogCheckReport } from './catalog-audit.js';
import type { CatalogInspection } from './catalog-files.js';
import type { TranslationWorkEntry, TranslationWorkfile, TranslationWorkOptions } from './catalog-workfile.js';
import { createTranslationWorkContext } from './catalog-work-context.js';

export interface TranslationRefreshConflict {
  readonly code: 'UNKNOWN_TARGET' | 'SOURCE_REMOVED' | 'SOURCE_CONFLICT' | 'TRANSLATION_CONFLICT';
  readonly previous: TranslationWorkEntry;
  /** A fresh checkpoint with no proposed translation, or null for a removed source/target. */
  readonly current: TranslationWorkEntry | null;
}
export interface TranslationRefreshReport {
  readonly format: 'saylo-translation-refresh/v1';
  readonly blocked: boolean;
  readonly workfile: TranslationWorkfile | null;
  readonly conflicts: readonly TranslationRefreshConflict[];
  readonly alreadyApplied: readonly TranslationWorkEntry[];
  readonly report: CatalogCheckReport;
}
const identity = (entry: TranslationWorkEntry) => JSON.stringify([entry.locale, entry.namespace, entry.id]);
const pair = (locale: string, namespace: string) => JSON.stringify([locale, namespace]);
const byIdentity = (a: TranslationWorkEntry, b: TranslationWorkEntry) => identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0;

/** Preserve drafts only across matching checkpoints; unresolved conflicts never enter the candidate. */
export function refreshTranslationWorkfile(input: CatalogInspection, report: CatalogCheckReport,
  previous: TranslationWorkfile, options: TranslationWorkOptions = {}): TranslationRefreshReport {
  const result = { format: 'saylo-translation-refresh/v1' as const, report };
  // Removed source keys/namespaces commonly leave orphan translations. Retain their diagnostics
  // in the report, but let refresh describe the removal instead of blocking before draft comparison.
  const planningReport = { ...report, diagnostics: report.diagnostics.filter(issue =>
    !['UNKNOWN_MESSAGE', 'NAMESPACE_MISMATCH'].includes(issue.code)) };
  if (planCatalogSync(input, planningReport).blocked)
    return { ...result, blocked: true, workfile: null, conflicts: [], alreadyApplied: [] };
  const withContext = options.withContext === true || previous.format === 'saylo-translation-work/v2';
  const fresh = createTranslationWorkfile(input, planningReport, { withContext });
  const entries = new Map(fresh.entries.map(entry => [identity(entry), entry]));
  const bases = new Map(input.files.filter(file => file.catalog.locale === report.baseLocale).map(file => [file.catalog.namespace, file.catalog]));
  const translations = new Map(input.files.map(file => [pair(file.catalog.locale, file.catalog.namespace), file.catalog]));
  const targets = new Set(report.locales.filter(locale => locale !== report.baseLocale));
  const hashes = createReviewBaseline(input, report.baseLocale).messages;
  const conflicts: TranslationRefreshConflict[] = [], alreadyApplied: TranslationWorkEntry[] = [];
  for (const entry of previous.entries) {
    const key = identity(entry);
    entries.delete(key); // A fresh export must not silently replace a conflicting draft.
    const source = bases.get(entry.namespace)?.messages[entry.id];
    const translation = translations.get(pair(entry.locale, entry.namespace))?.messages[entry.id]?.source ?? null;
    const current: TranslationWorkEntry | null = !source || !targets.has(entry.locale) ? null : {
      locale: entry.locale, namespace: entry.namespace, id: entry.id, reason: translation === null ? 'add' : 'review',
      source: source.source, sourceHash: hashes[`${entry.namespace}:${entry.id}`]!,
      originalTranslation: translation, translation: null,
      ...(withContext ? { context: createTranslationWorkContext(source) } : {}),
    };
    let code: TranslationRefreshConflict['code'] | undefined;
    if (!targets.has(entry.locale)) code = 'UNKNOWN_TARGET';
    else if (!source) code = 'SOURCE_REMOVED';
    else if (source.source !== entry.source || current!.sourceHash !== entry.sourceHash) code = 'SOURCE_CONFLICT';
    else if (translation !== entry.originalTranslation && (entry.translation === null || translation !== entry.translation)) code = 'TRANSLATION_CONFLICT';
    if (code) { conflicts.push({ code, previous: structuredClone(entry), current }); continue; }
    if (entry.translation !== null && entry.translation !== entry.originalTranslation && translation === entry.translation)
      alreadyApplied.push(structuredClone(entry));
    entries.set(key, { ...current!, translation: entry.translation });
  }
  conflicts.sort((a, b) => byIdentity(a.previous, b.previous));
  alreadyApplied.sort(byIdentity);
  return { ...result, blocked: conflicts.length > 0, workfile: { ...fresh, entries: [...entries.values()].sort(byIdentity) },
    conflicts, alreadyApplied };
}
