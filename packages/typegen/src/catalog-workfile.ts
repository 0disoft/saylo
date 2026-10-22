import { createReviewBaseline } from './catalog-review.js';
import { planCatalogSync } from './catalog-sync.js';
import type { CatalogInspection } from './catalog-files.js';
import type { CatalogCheckReport } from './catalog-audit.js';
import { readFile } from 'node:fs/promises';

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
      value.format !== 'saylo-translation-work/v1' || value.baseLocale !== baseLocale || !Array.isArray(value.entries))
    throw new TypeError('Invalid translation workfile format or base locale.');
  const identities = new Set<string>();
  for (const entry of value.entries) {
    if (!record(entry) || !exactFields(entry, ['locale', 'namespace', 'id', 'reason', 'source', 'sourceHash', 'originalTranslation', 'translation']) ||
        !canonical(entry.locale) || entry.locale === baseLocale || typeof entry.namespace !== 'string' || !entry.namespace ||
        entry.namespace.startsWith('.') || /[:/\\\x00-\x1f]/.test(entry.namespace) ||
        typeof entry.id !== 'string' || !entry.id || entry.id.includes(':') || !['add', 'review'].includes(String(entry.reason)) ||
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
  try { return parseTranslationWorkfile(await readFile(filename, 'utf8'), baseLocale); }
  catch (cause) { throw new Error(`Unable to read translation workfile: ${filename}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
}
