import { CatalogError, createBaseSchema, validateTranslation } from '@0disoft/saylo-core';
import type { CatalogDiagnostic, DiagnosticCode } from '@0disoft/saylo-core';
import { inspectCatalogs } from './catalog-files.js';
import type { CatalogInspection } from './catalog-files.js';
import type { SayloProjectConfig } from './config.js';

export type CatalogIssue = Omit<CatalogDiagnostic, 'code'> & {
  readonly code: DiagnosticCode | 'MISSING_BASE_CATALOG' | 'UNKNOWN_RICH_POLICY' | 'SOURCE_CHANGED' | 'SOURCE_ADDED';
  readonly severity: 'error' | 'warning';
};
export interface CatalogCheckReport {
  readonly format: 'saylo-check/v1';
  readonly baseLocale: string;
  readonly locales: readonly string[];
  readonly summary: { readonly errors: number; readonly warnings: number };
  readonly diagnostics: readonly CatalogIssue[];
}

export function reportIssues(baseLocale: string, locales: readonly string[], diagnostics: readonly CatalogIssue[]): CatalogCheckReport {
  const issues = [...diagnostics].sort((a, b) => {
    const left = JSON.stringify([a.sourceName, a.id ?? '', a.code, a.argument ?? '']);
    const right = JSON.stringify([b.sourceName, b.id ?? '', b.code, b.argument ?? '']);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return { format: 'saylo-check/v1', baseLocale, locales,
    summary: { errors: issues.filter(issue => issue.severity === 'error').length,
      warnings: issues.filter(issue => issue.severity === 'warning').length }, diagnostics: issues };
}

/** Pure schema/completeness analysis over one consistent, read-only disk inspection. */
export function analyzeCatalogs(config: SayloProjectConfig, input: CatalogInspection): CatalogCheckReport {
  const baseLocale = config.baseLocale;
  const diagnostics: CatalogIssue[] = input.diagnostics.map(diagnostic => ({ ...diagnostic, severity: 'error' }));
  const bases = new Map(input.files.filter(file => file.catalog.locale === baseLocale).map(file => [file.catalog.namespace, file.catalog]));
  const schemas = new Map([...bases].map(([namespace, catalog]) => [namespace, createBaseSchema(catalog)]));
  const pairs = new Map(input.files.map(file => [JSON.stringify([file.catalog.locale, file.catalog.namespace]), file.catalog]));
  const invalid = new Set(input.invalidCatalogs.map(file => JSON.stringify([file.locale, file.namespace])));
  const targets = [...new Set([...(config.checkLocales ?? input.localeDirectories.keys()), ...(config.initialLocale ? [config.initialLocale] : [])])]
    .filter(locale => locale !== baseLocale).sort();
  if (!bases.size && !input.invalidCatalogs.some(file => file.locale === baseLocale)) {
    diagnostics.push({ code: 'MISSING_BASE_CATALOG', severity: 'error', locale: baseLocale, namespace: '',
      sourceName: input.localeDirectories.get(baseLocale) ?? baseLocale, message: 'The base locale must contain at least one catalog.' });
  }
  for (const [namespace, messages] of Object.entries(config.richText ?? {})) {
    if (invalid.has(JSON.stringify([baseLocale, namespace]))) continue;
    const base = bases.get(namespace);
    if (!base) {
      diagnostics.push({ code: 'UNKNOWN_RICH_POLICY', severity: 'error', locale: baseLocale, namespace,
        sourceName: `${input.localeDirectories.get(baseLocale) ?? baseLocale}/${namespace}.json`,
        message: 'Rich text policy references a namespace absent from the base catalogs.' });
      continue;
    }
    for (const id of Object.keys(messages)) if (!Object.hasOwn(base.messages, id)) {
      diagnostics.push({ code: 'UNKNOWN_RICH_POLICY', severity: 'error', locale: baseLocale, namespace, id,
        sourceName: `${input.localeDirectories.get(baseLocale) ?? baseLocale}/${namespace}.json`,
        message: 'Rich text policy references a message absent from the base catalogs.' });
    }
  }
  for (const { catalog } of input.files) {
    if (catalog.locale === baseLocale || invalid.has(JSON.stringify([baseLocale, catalog.namespace]))) continue;
    const schema = schemas.get(catalog.namespace);
    if (!schema) {
      diagnostics.push({ code: 'NAMESPACE_MISMATCH', severity: 'error', locale: catalog.locale, namespace: catalog.namespace,
        sourceName: catalog.sourceName, message: 'Translation namespace has no base catalog.' });
      continue;
    }
    try { validateTranslation(schema, catalog); }
    catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      diagnostics.push(...error.diagnostics.map(diagnostic => ({ ...diagnostic, severity: 'error' as const })));
    }
  }
  for (const locale of targets) for (const [namespace, base] of bases) {
    const pair = JSON.stringify([locale, namespace]);
    if (invalid.has(pair)) continue; // An invalid file is not an invitation to overwrite it with new keys.
    const translation = pairs.get(pair);
    const sourceName = `${input.localeDirectories.get(locale) ?? locale}/${namespace}.json`;
    if (!translation) {
      diagnostics.push({ code: 'MISSING_NAMESPACE', severity: 'error', locale, namespace, sourceName,
        message: 'Translation namespace is missing.' });
      continue;
    }
    for (const id of Object.keys(base.messages)) if (!Object.hasOwn(translation.messages, id)) {
      diagnostics.push({ code: 'MISSING_MESSAGE', severity: 'error', locale, namespace, sourceName, id,
        message: 'Translation message is missing.' });
    }
  }
  return reportIssues(baseLocale, [baseLocale, ...targets], diagnostics);
}

export async function inspectProject(config: SayloProjectConfig): Promise<{ inspection: CatalogInspection; report: CatalogCheckReport }> {
  const inspection = await inspectCatalogs(config.localesDir, config.richText);
  return { inspection, report: analyzeCatalogs(config, inspection) };
}
