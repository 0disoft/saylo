import type { ParsedCatalog } from '@0disoft/saylo-core';
import type { CatalogInspection } from './catalog-files.js';
import type { CatalogCheckReport, CatalogIssue } from './catalog-audit.js';

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
const NON_BLOCKING_ISSUES = new Set(['MISSING_MESSAGE', 'MISSING_NAMESPACE', 'SOURCE_CHANGED', 'SOURCE_ADDED']);
const REVIEW_ISSUES = new Set(['SOURCE_CHANGED', 'SOURCE_ADDED', 'TRANSLATION_CHANGED', 'REVIEW_REQUIRED']);
const RETAIN_ISSUES = new Set(['UNKNOWN_MESSAGE', 'NAMESPACE_MISMATCH']);
const pairKey = (locale: string, namespace: string) => JSON.stringify([locale, namespace]);

export const isBlockingIssue = (code: string) => !NON_BLOCKING_ISSUES.has(code);

function* missingChanges(locale: string, directory: string, bases: ReadonlyMap<string, ParsedCatalog>,
  pairs: ReadonlyMap<string, ParsedCatalog>, missingPairs: ReadonlySet<string>): Iterable<CatalogSyncChange> {
  for (const [namespace, base] of bases) {
    const pair = pairKey(locale, namespace);
    const translated = pairs.get(pair);
    if (!translated && !missingPairs.has(pair)) continue; // Invalid catalogs are never proposed for replacement.
    const sourceName = translated?.sourceName ?? `${directory}/${namespace}.json`;
    const reason = translated ? 'MISSING_MESSAGE' : 'MISSING_NAMESPACE';
    for (const [id, message] of Object.entries(base.messages)) {
      if (translated && Object.hasOwn(translated.messages, id)) continue;
      yield { action: 'add', reason, locale, namespace, id, sourceName, baseSource: message.source, translation: null };
    }
  }
}

function* diagnosticChanges(issue: CatalogIssue, catalog: ParsedCatalog | undefined,
  base: ParsedCatalog | undefined): Iterable<CatalogSyncChange> {
  if (!catalog) return;
  const action = REVIEW_ISSUES.has(issue.code) ? 'review' : RETAIN_ISSUES.has(issue.code) ? 'retain' : undefined;
  if (!action) return;
  const ids = issue.code === 'NAMESPACE_MISMATCH' ? Object.keys(catalog.messages) : issue.id === undefined ? [] : [issue.id];
  for (const id of ids) {
    const original = base?.messages[id];
    yield { action, reason: issue.code, locale: issue.locale, namespace: issue.namespace, id, sourceName: catalog.sourceName,
      ...(original ? { baseSource: original.source } : {}), translation: catalog.messages[id]!.source };
  }
}

function sortChanges(changes: readonly CatalogSyncChange[]): CatalogSyncChange[] {
  // Keep the existing serialized ordering, including escapes and stable ties.
  const keyed = changes.map(change => ({ change, key: JSON.stringify([change.locale, change.namespace, change.id, change.action]) }));
  keyed.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return keyed.map(({ change }) => change);
}

/** Build a plan only. No writer, type generator, lock, or directory creation is reachable here. */
export function planCatalogSync(input: CatalogInspection, report: CatalogCheckReport): CatalogSyncPlan {
  const bases = new Map(input.files.filter(file => file.catalog.locale === report.baseLocale).map(file => [file.catalog.namespace, file.catalog]));
  const changes: CatalogSyncChange[] = [];
  const missingPairs = new Set(report.diagnostics.filter(issue => issue.code === 'MISSING_NAMESPACE')
    .map(issue => pairKey(issue.locale, issue.namespace)));
  const pairs = new Map(input.files.map(file => [pairKey(file.catalog.locale, file.catalog.namespace), file.catalog]));
  for (const locale of report.locales) {
    if (locale === report.baseLocale) continue;
    const directory = input.localeDirectories.get(locale) ?? locale;
    for (const change of missingChanges(locale, directory, bases, pairs, missingPairs)) changes.push(change);
  }
  for (const issue of report.diagnostics) {
    const catalog = pairs.get(pairKey(issue.locale, issue.namespace));
    const base = bases.get(issue.namespace);
    for (const change of diagnosticChanges(issue, catalog, base)) changes.push(change);
  }
  return { format: 'saylo-sync-plan/v1', dryRun: true,
    blocked: report.diagnostics.some(issue => issue.severity === 'error' && isBlockingIssue(issue.code)), report, changes: sortChanges(changes) };
}
