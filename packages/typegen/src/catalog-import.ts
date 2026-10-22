import path from 'node:path';
import { CatalogError, createBaseSchema, parseCatalog, validateTranslation } from '@0disoft/saylo-core';
import { createReviewBaseline } from './catalog-review.js';
import type { CatalogInspection } from './catalog-files.js';
import type { CatalogCheckReport } from './catalog-audit.js';
import type { SayloProjectConfig } from './config.js';
import type { TranslationWorkfile } from './catalog-workfile.js';

export interface ImportGuard { readonly file: string; readonly source: string | null }
export interface ImportFile extends ImportGuard { readonly nextSource: string; readonly sourceName: string; readonly baseFile: string }
export interface TranslationImportReport {
  readonly format: 'saylo-translation-import/v1';
  readonly dryRun: boolean;
  readonly blocked: boolean;
  readonly changes: readonly { readonly locale: string; readonly namespace: string; readonly id: string;
    readonly previousTranslation: string | null; readonly translation: string }[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly id?: string }[];
  readonly writtenFiles: readonly string[];
}
export interface TranslationImportPlan {
  readonly root: string;
  readonly files: readonly ImportFile[];
  readonly guards: readonly ImportGuard[];
  readonly report: TranslationImportReport;
}
const pair = (locale: string, namespace: string) => JSON.stringify([locale, namespace]);

/** Validate the entire candidate before any I/O mutation; merge only explicit completed translations. */
export function planTranslationImport(input: CatalogInspection, checked: CatalogCheckReport,
  config: SayloProjectConfig, work: TranslationWorkfile): TranslationImportPlan {
  const diagnostics: { code: string; message: string; id?: string }[] = checked.diagnostics
    .filter(issue => issue.severity === 'error' && !['MISSING_MESSAGE', 'MISSING_NAMESPACE', 'UNKNOWN_MESSAGE', 'NAMESPACE_MISMATCH'].includes(issue.code))
    .map(issue => ({ code: issue.code, message: `${issue.sourceName}: ${issue.message}` }));
  const report: TranslationImportReport = { format: 'saylo-translation-import/v1', dryRun: true,
    blocked: false, changes: [], diagnostics, writtenFiles: [] };
  const changes: { locale: string; namespace: string; id: string; previousTranslation: string | null; translation: string }[] = [];
  const files: ImportFile[] = [], guards = new Map<string, ImportGuard>();
  const bases = new Map(input.files.filter(file => file.catalog.locale === config.baseLocale).map(file => [file.catalog.namespace, file]));
  const pairs = new Map(input.files.map(file => [pair(file.catalog.locale, file.catalog.namespace), file]));
  const hashes = createReviewBaseline(input, config.baseLocale).messages;
  const patches = new Map<string, { locale: string; namespace: string; values: Record<string, string> }>();
  for (const entry of work.entries) {
    if (entry.translation === null || entry.translation === entry.originalTranslation) continue;
    const base = bases.get(entry.namespace), key = `${entry.namespace}:${entry.id}`;
    const fail = (code: string, message: string) => diagnostics.push({ code, id: key, message: `${entry.locale} ${key}: ${message}` });
    if (!checked.locales.includes(entry.locale)) { fail('UNKNOWN_TARGET', 'Locale is not a current translation target.'); continue; }
    if (!base || !Object.hasOwn(base.catalog.messages, entry.id) || hashes[key] !== entry.sourceHash || base.catalog.messages[entry.id]!.source !== entry.source) {
      fail('SOURCE_CONFLICT', 'Base text or rich contract changed; export fresh work.'); continue;
    }
    const current = pairs.get(pair(entry.locale, entry.namespace));
    const previous = current?.catalog.messages[entry.id]?.source ?? null;
    if (previous === entry.translation) continue; // Reimporting already applied work is a no-op.
    if (previous !== entry.originalTranslation) { fail('TRANSLATION_CONFLICT', 'Translation changed since export; export fresh work.'); continue; }
    guards.set(base.file, { file: base.file, source: base.source });
    const identity = pair(entry.locale, entry.namespace);
    let patch = patches.get(identity);
    if (!patch) { patch = { locale: entry.locale, namespace: entry.namespace, values: Object.create(null) }; patches.set(identity, patch); }
    patch.values[entry.id] = entry.translation;
    changes.push({ locale: entry.locale, namespace: entry.namespace, id: entry.id, previousTranslation: previous, translation: entry.translation });
  }
  for (const [identity, patch] of patches) {
    const current = pairs.get(identity), base = bases.get(patch.namespace)!;
    const sourceName = `${input.localeDirectories.get(patch.locale) ?? patch.locale}/${patch.namespace}.json`;
    const values: Record<string, string> = Object.create(null);
    for (const [id, message] of Object.entries(current?.catalog.messages ?? {})) values[id] = message.source;
    Object.assign(values, patch.values);
    const source = JSON.stringify(values, null, 2) + '\n';
    const options = { locale: patch.locale, namespace: patch.namespace, sourceName,
      richText: config.richText?.[patch.namespace] };
    try {
      parseCatalog(source, options); // Also check the merged JSON/ICU/rich catalog, preserving orphan keys.
      validateTranslation(createBaseSchema(base.catalog), parseCatalog(JSON.stringify(patch.values), options));
    } catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      diagnostics.push(...error.diagnostics.map(issue => ({ code: issue.code, message: `${sourceName}: ${issue.message}`,
        ...(issue.id === undefined ? {} : { id: issue.id }) })));
    }
    const file = path.join(input.root, ...sourceName.split('/'));
    guards.set(file, { file, source: current?.source ?? null });
    files.push({ file, sourceName, baseFile: base.file, source: current?.source ?? null,
      nextSource: current?.source.includes('\r\n') ? source.replace(/\n/g, '\r\n') : source });
  }
  return { root: input.root, files, guards: [...guards.values()], report: { ...report, changes, blocked: diagnostics.length > 0 } };
}
