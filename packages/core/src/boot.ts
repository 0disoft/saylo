import { freeze } from './diagnostics.js';
import { createTextFormatter } from './formatters.js';
import { CatalogLoadError } from './loading-errors.js';
import { acceptOutcome, canonicalLocale, createLoadedSnapshot, keyId, manifestMembership, readManifest, scopeKeys } from './loading-registry.js';
import { createBaseSchema } from './schema.js';
import type { CatalogManifest, CatalogOutcome } from './loading-types.js';
import type { CatalogSchema } from './types.js';

/** Versioned wire data from the same trusted parser/build as CatalogSource. No functions or Maps. */
export interface BootSnapshot {
  readonly format: 'saylo-boot-v1';
  readonly manifest: CatalogManifest;
  readonly locale: string;
  readonly timeZone: string;
  readonly stateRevision: number;
  readonly loadedNamespaces: readonly string[];
  readonly baseSchemas: readonly CatalogSchema[];
  /** Every loaded base+target pair, including explicit versioned missing outcomes. */
  readonly catalogOutcomes: readonly CatalogOutcome[];
}

export type BootSnapshotInput = Omit<BootSnapshot, 'format' | 'baseSchemas'>;

export function createBootSnapshot(input: BootSnapshotInput): BootSnapshot {
  const manifest = readManifest(input.manifest);
  const locale = canonicalLocale(input.locale);
  if (locale !== input.locale || !manifestMembership(manifest).locales.has(locale) ||
      !Number.isSafeInteger(input.stateRevision) || input.stateRevision < 0 ||
      !Array.isArray(input.loadedNamespaces) || !Array.isArray(input.catalogOutcomes))
    throw new CatalogLoadError('INVALID_BOOT', 'Invalid boot locale, revision or loaded scope.');
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).resolvedOptions().timeZone;
  if (typeof input.timeZone !== 'string' || timeZone !== input.timeZone)
    throw new CatalogLoadError('INVALID_BOOT', 'Boot timeZone must be explicit and resolved.');
  const namespaces = [...input.loadedNamespaces].sort();
  if (new Set(namespaces).size !== namespaces.length || namespaces.some(n => !manifestMembership(manifest).namespaces.has(n)))
    throw new CatalogLoadError('INVALID_BOOT', 'Boot namespaces must be unique and available.');
  const keys = scopeKeys(manifest, locale, namespaces);
  const keyIndex = new Map(keys.map(key => [keyId(key), key]));
  const supplied = new Map<string, CatalogOutcome>();
  for (const outcome of input.catalogOutcomes) {
    const key = outcome?.key && keyIndex.get(keyId(outcome.key));
    if (!key || supplied.has(keyId(key))) throw new CatalogLoadError('INVALID_BOOT', 'Unexpected or duplicate boot pair.');
    supplied.set(keyId(key), acceptOutcome(manifest, key, outcome));
  }
  if (supplied.size !== keys.length) throw new CatalogLoadError('INVALID_BOOT', 'Boot must explicitly include every base and target outcome.');
  const outcomes = keys.map(k => supplied.get(keyId(k))!);
  // Reuse atomic schema/translation validation and formatter contracts, without reparsing message text.
  createLoadedSnapshot(manifest, locale, namespaces, outcomes, timeZone, createTextFormatter(timeZone), input.stateRevision);
  const baseSchemas = outcomes.flatMap(o => o.status === 'present' && o.key.locale === manifest.baseLocale
    ? [createBaseSchema(o.catalog)] : []);
  return freeze({ format: 'saylo-boot-v1', manifest, locale, timeZone, stateRevision: input.stateRevision,
    loadedNamespaces: namespaces, baseSchemas, catalogOutcomes: outcomes });
}

/** HTML-safe JSON text for a script[type=application/json]; does not emit a script element. */
export function serializeBootSnapshot(snapshot: BootSnapshot): string {
  return JSON.stringify(validateBootSnapshot(snapshot)).replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function decodeBootSnapshot(json: string): BootSnapshot {
  try { return validateBootSnapshot(JSON.parse(json) as BootSnapshot); }
  catch (cause) { throw new CatalogLoadError('INVALID_BOOT', 'Unable to decode Saylo boot snapshot.', { cause }); }
}

export function validateBootSnapshot(input: BootSnapshot): BootSnapshot {
  if (!input || input.format !== 'saylo-boot-v1' || !Array.isArray(input.baseSchemas))
    throw new CatalogLoadError('INVALID_BOOT', 'Unsupported or malformed Saylo boot snapshot.');
  const accepted = createBootSnapshot(input);
  const schemas = new Map(input.baseSchemas.map(schema => [schema?.namespace, schema]));
  // Compare canonical schemas, including actual keys and accepted argument types, rather than just a supplied stamp.
  if (input.baseSchemas.length !== accepted.baseSchemas.length || accepted.baseSchemas.some(schema => {
    const supplied = schemas.get(schema.namespace);
    return !supplied || supplied.baseLocale !== schema.baseLocale || supplied.fingerprint !== schema.fingerprint ||
      JSON.stringify(supplied.keys) !== JSON.stringify(schema.keys) ||
      JSON.stringify(supplied.richTextTags) !== JSON.stringify(schema.richTextTags);
  })) throw new CatalogLoadError('INVALID_BOOT', 'Boot base schemas do not match their catalogs.');
  return accepted;
}
