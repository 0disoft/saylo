import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CatalogInspection } from './catalog-files.js';
import { reportIssues } from './catalog-audit.js';
import type { CatalogCheckReport, CatalogIssue } from './catalog-audit.js';

/** Explicit comparison checkpoint, not a claim that translations have been approved. */
export interface CatalogReviewBaseline {
  readonly format: 'saylo-review-baseline/v1';
  readonly baseLocale: string;
  readonly messages: Readonly<Record<string, string>>;
}

export function createReviewBaseline(input: Pick<CatalogInspection, 'files'>, baseLocale: string): CatalogReviewBaseline {
  const entries = input.files.filter(file => file.catalog.locale === baseLocale).flatMap(({ catalog }) =>
    Object.entries(catalog.messages).map(([id, message]) => [`${catalog.namespace}:${id}`,
      createHash('sha256').update(JSON.stringify([message.source, message.richTextTags ?? null])).digest('hex')] as const));
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return { format: 'saylo-review-baseline/v1', baseLocale, messages: Object.fromEntries(entries) };
}

export async function readReviewBaseline(filename: string, baseLocale: string): Promise<CatalogReviewBaseline> {
  let value: CatalogReviewBaseline;
  try { value = JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, '')) as CatalogReviewBaseline; }
  catch (cause) { throw new Error(`Unable to read review baseline: ${filename}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
  if (!value || value.format !== 'saylo-review-baseline/v1' || value.baseLocale !== baseLocale ||
      !value.messages || typeof value.messages !== 'object' || Array.isArray(value.messages) ||
      Object.keys(value).some(name => !['format', 'baseLocale', 'messages'].includes(name))) throw new TypeError('Invalid review baseline format or base locale.');
  for (const [key, hash] of Object.entries(value.messages)) {
    const separator = key.indexOf(':');
    const namespace = key.slice(0, separator);
    if (separator <= 0 || separator === key.length - 1 || key.indexOf(':', separator + 1) !== -1 || namespace === '.' || namespace === '..' ||
        /[/\\\x00-\x1f]/.test(namespace) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
      throw new TypeError('Invalid review baseline message hash.');
  }
  return value;
}

export function compareReviewBaseline(input: CatalogInspection, report: CatalogCheckReport, baseline: CatalogReviewBaseline): CatalogCheckReport {
  const current = createReviewBaseline(input, report.baseLocale);
  const targets = new Set(report.locales.filter(locale => locale !== report.baseLocale));
  const diagnostics: CatalogIssue[] = [...report.diagnostics];
  for (const { catalog } of input.files) {
    if (!targets.has(catalog.locale)) continue;
    for (const [id, message] of Object.entries(catalog.messages)) {
      const key = `${catalog.namespace}:${id}`;
      if (!Object.hasOwn(current.messages, key) || baseline.messages[key] === current.messages[key]) continue;
      diagnostics.push({ code: Object.hasOwn(baseline.messages, key) ? 'SOURCE_CHANGED' : 'SOURCE_ADDED', severity: 'warning',
        locale: catalog.locale, namespace: catalog.namespace, id, sourceName: catalog.sourceName, position: message.position,
        message: 'Base text or rich contract differs from the comparison checkpoint; review the existing translation.' });
    }
  }
  return { ...reportIssues(report.baseLocale, report.locales, diagnostics), reviewTracking: 'baseline' };
}
