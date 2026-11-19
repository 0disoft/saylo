import type { ParsedMessage } from '@0disoft/saylo-core';
import { reviewSourceHash } from './catalog-review.js';
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
const REMOVAL_DIAGNOSTICS = new Set(['UNKNOWN_MESSAGE', 'NAMESPACE_MISMATCH']);
type Keyed<T> = readonly [key: string, value: T];

function orderedValues<T>(items: Keyed<T>[]): T[] {
  items.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return items.map(([, value]) => value);
}

function checkpointConflict(previous: TranslationWorkEntry, current: TranslationWorkEntry): TranslationRefreshConflict['code'] | undefined {
  if (current.source !== previous.source || current.sourceHash !== previous.sourceHash) return 'SOURCE_CONFLICT';
  const translation = current.originalTranslation;
  if (translation !== previous.originalTranslation && (previous.translation === null || translation !== previous.translation))
    return 'TRANSLATION_CONFLICT';
}

/** Preserve drafts only across matching checkpoints; unresolved conflicts never enter the candidate. */
export function refreshTranslationWorkfile(input: CatalogInspection, report: CatalogCheckReport,
  previous: TranslationWorkfile, options: TranslationWorkOptions = {}): TranslationRefreshReport {
  const result = { format: 'saylo-translation-refresh/v1' as const, report };
  // Removed source keys/namespaces commonly leave orphan translations. Retain their diagnostics
  // in the report, but let refresh describe the removal instead of blocking before draft comparison.
  const planningReport = { ...report, diagnostics: report.diagnostics.filter(issue =>
    !REMOVAL_DIAGNOSTICS.has(issue.code)) };
  if (planCatalogSync(input, planningReport).blocked)
    return { ...result, blocked: true, workfile: null, conflicts: [], alreadyApplied: [] };
  const withContext = options.withContext === true || previous.format !== 'saylo-translation-work/v1';
  const withMetadata = options.metadata !== undefined || previous.format === 'saylo-translation-work/v3';
  const fresh = createTranslationWorkfile(input, planningReport, { ...options, withContext, withMetadata });
  const entries = new Map(fresh.entries.map(entry => [identity(entry), entry]));
  const bases = new Map(input.files.filter(file => file.catalog.locale === report.baseLocale).map(file => [file.catalog.namespace, file.catalog]));
  const translations = new Map(input.files.map(file => [pair(file.catalog.locale, file.catalog.namespace), file.catalog]));
  const targets = new Set(report.locales.filter(locale => locale !== report.baseLocale));
  const fallbackHashes = new Map<ParsedMessage, string>();
  const conflicts: Keyed<TranslationRefreshConflict>[] = [], alreadyApplied: Keyed<TranslationWorkEntry>[] = [];
  for (const entry of previous.entries) {
    const key = identity(entry);
    const freshHash = entries.get(key)?.sourceHash;
    entries.delete(key); // A fresh export must not silently replace a conflicting draft.
    const targetExists = targets.has(entry.locale);
    const source = targetExists ? bases.get(entry.namespace)?.messages[entry.id] : undefined;
    if (!source) {
      conflicts.push([key, { code: targetExists ? 'SOURCE_REMOVED' : 'UNKNOWN_TARGET', previous: structuredClone(entry), current: null }]);
      continue;
    }
    // Fresh tasks already carry a hash of the current source. Memoize only fallback hashes.
    let sourceHash = freshHash ?? fallbackHashes.get(source);
    if (sourceHash === undefined) {
      sourceHash = reviewSourceHash(source);
      fallbackHashes.set(source, sourceHash);
    }
    const translation = translations.get(pair(entry.locale, entry.namespace))?.messages[entry.id]?.source ?? null;
    const current: TranslationWorkEntry = {
      locale: entry.locale, namespace: entry.namespace, id: entry.id, reason: translation === null ? 'add' : 'review',
      source: source.source, sourceHash,
      originalTranslation: translation, translation: null,
      ...(withContext ? { context: createTranslationWorkContext(source, withMetadata
        ? options.metadata?.messages[`${entry.namespace}:${entry.id}`] ?? (options.metadata ? null : entry.context?.metadata ?? null) : undefined) } : {}),
    };
    const code = checkpointConflict(entry, current);
    if (code) { conflicts.push([key, { code, previous: structuredClone(entry), current }]); continue; }
    if (entry.translation !== null && entry.translation !== entry.originalTranslation && translation === entry.translation)
      alreadyApplied.push([key, structuredClone(entry)]);
    entries.set(key, { ...current, translation: entry.translation });
  }
  return { ...result, blocked: conflicts.length > 0, workfile: { ...fresh, entries: orderedValues([...entries]) },
    conflicts: orderedValues(conflicts), alreadyApplied: orderedValues(alreadyApplied) };
}
