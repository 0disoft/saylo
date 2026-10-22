import type { CatalogInspection } from './catalog-files.js';
import type { CatalogCheckReport } from './catalog-audit.js';

export interface CatalogSyncChange {
  readonly action: 'add' | 'review' | 'retain';
  readonly reason: string;
  readonly locale: string;
  readonly namespace: string;
  readonly id: string;
  readonly sourceName: string;
  readonly baseSource?: string;
  /** Null means untranslated; never copy base text into a catalog and label it complete. */
  readonly translation: string | null;
}
export interface CatalogSyncPlan {
  readonly format: 'saylo-sync-plan/v1';
  readonly dryRun: true;
  readonly blocked: boolean;
  readonly report: CatalogCheckReport;
  readonly changes: readonly CatalogSyncChange[];
}
export const isBlockingIssue = (code: string) => !['MISSING_MESSAGE', 'MISSING_NAMESPACE', 'SOURCE_CHANGED', 'SOURCE_ADDED'].includes(code);

/** Build a plan only. No writer, type generator, lock, or directory creation is reachable here. */
export function planCatalogSync(input: CatalogInspection, report: CatalogCheckReport): CatalogSyncPlan {
  const bases = new Map(input.files.filter(file => file.catalog.locale === report.baseLocale).map(file => [file.catalog.namespace, file.catalog]));
  const changes: CatalogSyncChange[] = [];
  const missingPairs = new Set(report.diagnostics.filter(issue => issue.code === 'MISSING_NAMESPACE')
    .map(issue => JSON.stringify([issue.locale, issue.namespace])));
  const pairs = new Map(input.files.map(file => [JSON.stringify([file.catalog.locale, file.catalog.namespace]), file.catalog]));
  for (const locale of report.locales) {
    if (locale === report.baseLocale) continue;
    for (const [namespace, base] of bases) {
      const pair = JSON.stringify([locale, namespace]);
      const translated = pairs.get(pair);
      if (!translated && !missingPairs.has(pair)) continue; // Invalid catalogs are never proposed for replacement.
      for (const [id, message] of Object.entries(base.messages)) if (!translated || !Object.hasOwn(translated.messages, id)) {
        changes.push({ action: 'add', reason: translated ? 'MISSING_MESSAGE' : 'MISSING_NAMESPACE', locale, namespace, id,
          sourceName: translated?.sourceName ?? `${input.localeDirectories.get(locale) ?? locale}/${namespace}.json`,
          baseSource: message.source, translation: null });
      }
    }
  }
  for (const issue of report.diagnostics) {
    const catalog = pairs.get(JSON.stringify([issue.locale, issue.namespace]));
    if (!catalog) continue;
    const ids = issue.code === 'NAMESPACE_MISMATCH' ? Object.keys(catalog.messages) : issue.id === undefined ? [] : [issue.id];
    for (const id of ids) {
      if (!['UNKNOWN_MESSAGE', 'NAMESPACE_MISMATCH', 'SOURCE_CHANGED', 'SOURCE_ADDED'].includes(issue.code)) continue;
      const original = bases.get(issue.namespace)?.messages[id];
      changes.push({ action: issue.code.startsWith('SOURCE_') ? 'review' : 'retain', reason: issue.code,
        locale: issue.locale, namespace: issue.namespace, id, sourceName: catalog.sourceName,
        ...(original ? { baseSource: original.source } : {}), translation: catalog.messages[id]!.source });
    }
  }
  changes.sort((a, b) => {
    const left = JSON.stringify([a.locale, a.namespace, a.id, a.action]);
    const right = JSON.stringify([b.locale, b.namespace, b.id, b.action]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return { format: 'saylo-sync-plan/v1', dryRun: true,
    blocked: report.diagnostics.some(issue => issue.severity === 'error' && isBlockingIssue(issue.code)), report, changes };
}
