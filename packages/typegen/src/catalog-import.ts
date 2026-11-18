import path from 'node:path';
import { CatalogError, createBaseSchema, parseCatalog, validateTranslation } from '@0disoft/saylo-core';
import type { ParsedMessage } from '@0disoft/saylo-core';
import { reviewSourceHash } from './catalog-review.js';
import { editCatalogJson } from './catalog-json-edit.js';
import type { CatalogFile, CatalogInspection } from './catalog-files.js';
import type { CatalogCheckReport } from './catalog-audit.js';
import type { SayloProjectConfig } from './config.js';
import type { TranslationWorkEntry, TranslationWorkfile } from './catalog-workfile.js';

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
const IMPORT_REPAIRABLE_ISSUES = new Set(['MISSING_MESSAGE', 'MISSING_NAMESPACE', 'UNKNOWN_MESSAGE', 'NAMESPACE_MISMATCH']);
const NEW_CATALOG_INDENT = 2;

type ImportChange = TranslationImportReport['changes'][number];
type ImportDiagnostic = TranslationImportReport['diagnostics'][number];
interface ImportPatch {
  readonly locale: string;
  readonly namespace: string;
  readonly base: CatalogFile;
  readonly current: CatalogFile | undefined;
  readonly values: Record<string, string>;
}

function selectImportChange(entry: TranslationWorkEntry, targets: ReadonlySet<string>, bases: ReadonlyMap<string, CatalogFile>,
  pairs: ReadonlyMap<string, CatalogFile>, sourceHash: (message: ParsedMessage) => string) {
  const { locale, namespace, id, translation, originalTranslation } = entry;
  if (translation === null || translation === originalTranslation) return;
  const key = `${namespace}:${id}`;
  const fail = (code: string, message: string) => ({ error: { code, id: key, message: `${locale} ${key}: ${message}` } });
  if (!targets.has(locale)) return fail('UNKNOWN_TARGET', 'Locale is not a current translation target.');
  const base = bases.get(namespace);
  const message = base && Object.hasOwn(base.catalog.messages, id) ? base.catalog.messages[id] : undefined;
  if (!base || !message || sourceHash(message) !== entry.sourceHash || message.source !== entry.source)
    return fail('SOURCE_CONFLICT', 'Base text or rich contract changed; export fresh work.');
  const identity = pair(locale, namespace);
  const current = pairs.get(identity);
  const previousTranslation = current?.catalog.messages[id]?.source ?? null;
  if (previousTranslation === translation) return; // Reimporting already applied work is a no-op.
  if (previousTranslation !== originalTranslation)
    return fail('TRANSLATION_CONFLICT', 'Translation changed since export; export fresh work.');
  return { base, current, identity, change: { locale, namespace, id, previousTranslation, translation } };
}

function planImportFile(input: CatalogInspection, config: SayloProjectConfig, patch: ImportPatch) {
  const { current, base, locale, namespace, values: updates } = patch;
  const sourceName = `${input.localeDirectories.get(locale) ?? locale}/${namespace}.json`;
  const values: Record<string, string> = Object.create(null);
  for (const [id, message] of Object.entries(current?.catalog.messages ?? {})) values[id] = message.source;
  Object.assign(values, updates);
  const nextSource = current ? editCatalogJson(current.source, updates) : JSON.stringify(values, null, NEW_CATALOG_INDENT) + '\n';
  const file: ImportFile = { file: path.join(input.root, ...sourceName.split('/')), sourceName,
    baseFile: base.file, source: current?.source ?? null, nextSource };
  const options = { locale, namespace, sourceName, richText: config.richText?.[namespace] };
  try {
    const merged = parseCatalog(nextSource, options, current?.catalog);
    if (Object.keys(merged.messages).length !== Object.keys(values).length
      || Object.entries(values).some(([id, value]) => merged.messages[id]?.source !== value)) {
      throw new CatalogError([{ ...options, code: 'INVALID_CATALOG',
        message: 'Catalog edit did not preserve the expected message values; import blocked.' }]);
    }
    // Retained orphan keys passed parsing. Only changed IDs need base validation.
    const messages = Object.fromEntries(Object.keys(updates).map(id => [id, merged.messages[id]!]));
    validateTranslation(createBaseSchema(base.catalog), { ...merged, messages });
    return { file, diagnostics: [] };
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    return { file, diagnostics: error.diagnostics.map(issue => ({ code: issue.code, message: `${sourceName}: ${issue.message}`,
      ...(issue.id === undefined ? {} : { id: issue.id }) })) };
  }
}

/** Validate the entire candidate before any I/O mutation; merge only explicit completed translations. */
export function planTranslationImport(input: CatalogInspection, checked: CatalogCheckReport,
  config: SayloProjectConfig, work: TranslationWorkfile): TranslationImportPlan {
  const diagnostics: ImportDiagnostic[] = checked.diagnostics
    .filter(issue => issue.severity === 'error' && !IMPORT_REPAIRABLE_ISSUES.has(issue.code))
    .map(issue => ({ code: issue.code, message: `${issue.sourceName}: ${issue.message}` }));
  const changes: ImportChange[] = [], files: ImportFile[] = [];
  const guards = new Map<string, ImportGuard>(), patches = new Map<string, ImportPatch>();
  const targets = new Set(checked.locales);
  const bases = new Map(input.files.filter(file => file.catalog.locale === config.baseLocale).map(file => [file.catalog.namespace, file]));
  const pairs = new Map(input.files.map(file => [pair(file.catalog.locale, file.catalog.namespace), file]));
  const hashes = new Map<ParsedMessage, string>();
  const sourceHash = (message: ParsedMessage) => {
    const cached = hashes.get(message);
    if (cached !== undefined) return cached;
    const hash = reviewSourceHash(message);
    hashes.set(message, hash);
    return hash;
  };
  for (const entry of work.entries) {
    const selected = selectImportChange(entry, targets, bases, pairs, sourceHash);
    if (!selected) continue;
    if ('error' in selected) { diagnostics.push(selected.error); continue; }
    const { base, current, identity, change } = selected;
    let patch = patches.get(identity);
    if (!patch) {
      patch = { locale: change.locale, namespace: change.namespace, base, current, values: Object.create(null) };
      patches.set(identity, patch);
    }
    patch.values[change.id] = change.translation;
    guards.set(base.file, { file: base.file, source: base.source });
    changes.push(change);
  }
  for (const patch of patches.values()) {
    const { file, diagnostics: issues } = planImportFile(input, config, patch);
    diagnostics.push(...issues);
    guards.set(file.file, { file: file.file, source: file.source });
    files.push(file);
  }
  return { root: input.root, files, guards: [...guards.values()], report: { format: 'saylo-translation-import/v1', dryRun: true,
    changes, diagnostics, writtenFiles: [], blocked: diagnostics.length > 0 } };
}
