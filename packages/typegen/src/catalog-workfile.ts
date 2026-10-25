import { createReviewBaseline } from './catalog-review.js';
import { planCatalogSync } from './catalog-sync.js';
import type { CatalogInspection } from './catalog-files.js';
import type { CatalogCheckReport } from './catalog-audit.js';
import { readFile } from 'node:fs/promises';
import { createTranslationWorkContext, isTranslationWorkContext } from './catalog-work-context.js';
import type { TranslationWorkContext } from './catalog-work-context.js';
import type { TranslationMetadata } from './translation-metadata.js';

export interface TranslationWorkEntry {
  readonly locale: string;
  readonly namespace: string;
  readonly id: string;
  readonly reason: 'add' | 'review';
  readonly source: string;
  readonly sourceHash: string;
  readonly originalTranslation: string | null;
  readonly translation: string | null;
  /** Present only in v2. Never used as an authoritative contract. */
  readonly context?: TranslationWorkContext;
}
export interface TranslationWorkfile {
  readonly format: 'saylo-translation-work/v1' | 'saylo-translation-work/v2' | 'saylo-translation-work/v3';
  readonly baseLocale: string;
  readonly entries: readonly TranslationWorkEntry[];
}
export interface TranslationWorkOptions { readonly withContext?: boolean; readonly metadata?: TranslationMetadata; readonly withMetadata?: boolean }

/** A separate translator document; null is a pending task, never a runtime catalog value. */
export function createTranslationWorkfile(input: CatalogInspection, report: CatalogCheckReport, options: TranslationWorkOptions = {}): TranslationWorkfile {
  const plan = planCatalogSync(input, report);
  if (plan.blocked) throw new Error('Invalid catalogs block translation export. Run saylo check.');
  const hashes = createReviewBaseline(input, report.baseLocale).messages;
  const withMetadata = options.metadata !== undefined || options.withMetadata === true;
  for (const key of Object.keys(options.metadata?.messages ?? {}))
    if (!Object.hasOwn(hashes, key)) throw new RangeError(`Unknown source key in translation metadata: ${key}`);
  const bases = options.withContext || withMetadata ? new Map(input.files.filter(file => file.catalog.locale === report.baseLocale)
    .map(file => [file.catalog.namespace, file.catalog])) : undefined;
  return { format: withMetadata ? 'saylo-translation-work/v3' : options.withContext ? 'saylo-translation-work/v2' : 'saylo-translation-work/v1', baseLocale: report.baseLocale,
    entries: plan.changes.filter(change => change.action !== 'retain').map(change => ({
      locale: change.locale, namespace: change.namespace, id: change.id, reason: change.action as 'add' | 'review',
      source: change.baseSource!, sourceHash: hashes[`${change.namespace}:${change.id}`]!,
      originalTranslation: change.translation, translation: change.translation,
      ...(bases ? { context: createTranslationWorkContext(bases.get(change.namespace)!.messages[change.id]!,
        withMetadata ? options.metadata?.messages[`${change.namespace}:${change.id}`] ?? null : undefined) } : {}),
    })) };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactFields = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
function canonical(value: unknown): value is string {
  try { return typeof value === 'string' && !!value && Intl.getCanonicalLocales(value)[0] === value; }
  catch { return false; }
}

/** Paths never come from this document. Namespace/locale identities are validated before planning. */
export function parseTranslationWorkfile(source: string, baseLocale: string): TranslationWorkfile {
  const value: unknown = JSON.parse(source.replace(/^\uFEFF/, ''));
  if (!record(value) || !exactFields(value, ['format', 'baseLocale', 'entries']) ||
      typeof value.format !== 'string' || !['saylo-translation-work/v1', 'saylo-translation-work/v2', 'saylo-translation-work/v3'].includes(value.format) || value.baseLocale !== baseLocale || !Array.isArray(value.entries))
    throw new TypeError('Invalid translation workfile format or base locale.');
  const withContext = value.format !== 'saylo-translation-work/v1';
  const fields = ['locale', 'namespace', 'id', 'reason', 'source', 'sourceHash', 'originalTranslation', 'translation', ...(withContext ? ['context'] : [])];
  const identities = new Set<string>();
  for (const entry of value.entries) {
    if (!record(entry) || !exactFields(entry, fields) || (withContext && !isTranslationWorkContext(entry.context)) ||
        (value.format === 'saylo-translation-work/v3' && !Object.hasOwn(entry.context as object, 'metadata')) ||
        (value.format === 'saylo-translation-work/v2' && Object.hasOwn(entry.context as object, 'metadata')) ||
        !canonical(entry.locale) || entry.locale === baseLocale || typeof entry.namespace !== 'string' || !entry.namespace ||
        entry.namespace.startsWith('.') || /[:/\\\x00-\x1f]/.test(entry.namespace) ||
        typeof entry.id !== 'string' || !entry.id || entry.id.includes(':') || (entry.reason !== 'add' && entry.reason !== 'review') ||
        typeof entry.source !== 'string' || typeof entry.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sourceHash) ||
        !(entry.originalTranslation === null || typeof entry.originalTranslation === 'string') ||
        !(entry.translation === null || typeof entry.translation === 'string')) throw new TypeError('Invalid translation workfile entry.');
    const identity = JSON.stringify([entry.locale, entry.namespace, entry.id]);
    if (identities.has(identity)) throw new TypeError(`Duplicate translation workfile entry: ${identity}`);
    identities.add(identity);
  }
  return value as unknown as TranslationWorkfile;
}

export async function readTranslationWorkfile(filename: string, baseLocale: string): Promise<TranslationWorkfile> {
  try {
    const source = await readFile(filename, 'utf8');
    return filename.endsWith('.po') ? (await import('./catalog-po.js')).parseTranslationPo(source, baseLocale)
      : parseTranslationWorkfile(source, baseLocale);
  }
  catch (cause) { throw new Error(`Unable to read translation workfile: ${filename}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
}
