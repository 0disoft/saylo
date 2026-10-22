import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCatalog } from '@0disoft/saylo-core';
import type { CatalogOptions, ParsedCatalog } from '@0disoft/saylo-core';

export type RichTextPolicies = Readonly<Record<string, NonNullable<CatalogOptions['richText']>>>;

/** JSON-only project settings. Paths resolve from the config file's directory, never Vite root. */
export interface SayloProjectConfig {
  readonly localesDir: string;
  readonly baseLocale: string;
  readonly initialLocale?: string;
  readonly initialNamespaces?: readonly string[];
  readonly timeZone?: string;
  readonly richText?: RichTextPolicies;
  readonly requireCompleteTranslations?: boolean;
  readonly typegen?: { readonly outFile: string };
  /** Completeness targets for the catalog CLI; omitted means discovered locales. */
  readonly checkLocales?: readonly string[];
  /** Optional source comparison checkpoint for catalog review. */
  readonly baseline?: string;
}

const fields = new Set(['format', 'localesDir', 'baseLocale', 'initialLocale', 'initialNamespaces', 'timeZone',
  'richText', 'requireCompleteTranslations', 'typegen', 'checkLocales', 'baseline']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonempty string.`);
  return value;
}
function locale(value: unknown, name: string): string {
  try {
    const result = Intl.getCanonicalLocales(string(value, name))[0];
    if (result) return result;
  } catch { /* Report the config field rather than an engine-dependent Intl message. */ }
  throw new TypeError(`${name} must be a valid BCP 47 locale.`);
}
function namespace(value: unknown): string {
  const result = string(value, 'namespace');
  if (result === '.' || result === '..' || /[:/\\\x00-\x1f]/.test(result)) throw new TypeError('Invalid namespace.');
  return result;
}
function list(value: unknown, name: string, read: (value: unknown, name: string) => string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
  const result = value.map(item => read(item, name));
  if (new Set(result).size !== result.length) throw new TypeError(`${name} contains duplicate entries.`);
  return Object.freeze(result);
}

/** Normalize a caller-owned object without retaining or freezing its nested values. */
export function resolveProjectConfig(input: unknown, directory = process.cwd()): SayloProjectConfig {
  if (!record(input)) throw new TypeError('Saylo config must be an object.');
  for (const name of Object.keys(input)) if (!fields.has(name)) throw new TypeError(`Unknown Saylo config field: ${name}.`);
  if (input.format !== undefined && input.format !== 'saylo-project/v1') throw new TypeError('Unsupported Saylo config format.');
  const baseLocale = locale(input.baseLocale, 'baseLocale');
  const localesDir = path.resolve(directory, string(input.localesDir, 'localesDir'));
  let richText: RichTextPolicies | undefined;
  if (input.richText !== undefined) {
    if (!record(input.richText)) throw new TypeError('richText must be a namespace policy object.');
    const policies: Record<string, NonNullable<CatalogOptions['richText']>> = Object.create(null);
    for (const [name, policy] of Object.entries(input.richText)) {
      if (!record(policy)) throw new TypeError('Each richText namespace must map message IDs to allowed tag arrays.');
      // Reuse the core's exact ID, namespace and allowed-tag rules, including empty allowlists.
      const probe = parseCatalog(JSON.stringify(Object.fromEntries(Object.keys(policy).map(id => [id, '']))),
        { locale: baseLocale, namespace: name, richText: policy as NonNullable<CatalogOptions['richText']> });
      policies[name] = Object.freeze(Object.fromEntries(Object.entries(probe.messages).map(([id, message]) => [id, message.richTextTags!])));
    }
    richText = Object.freeze(policies);
  }
  let typegen: SayloProjectConfig['typegen'];
  if (input.typegen !== undefined) {
    if (!record(input.typegen) || Object.keys(input.typegen).some(name => name !== 'outFile')) throw new TypeError('typegen only accepts outFile.');
    const outFile = string(input.typegen.outFile, 'typegen.outFile');
    if (!outFile.endsWith('.d.ts')) throw new TypeError('typegen.outFile must end in .d.ts.');
    typegen = Object.freeze({ outFile: path.resolve(directory, outFile) });
  }
  if (input.requireCompleteTranslations !== undefined && typeof input.requireCompleteTranslations !== 'boolean')
    throw new TypeError('requireCompleteTranslations must be a boolean.');
  const timeZone = input.timeZone === undefined ? undefined : string(input.timeZone, 'timeZone');
  if (timeZone !== undefined) new Intl.DateTimeFormat('en', { timeZone });
  return Object.freeze({ localesDir, baseLocale,
    ...(input.initialLocale === undefined ? {} : { initialLocale: locale(input.initialLocale, 'initialLocale') }),
    ...(input.initialNamespaces === undefined ? {} : { initialNamespaces: list(input.initialNamespaces, 'initialNamespaces', namespace) }),
    ...(timeZone === undefined ? {} : { timeZone }), ...(richText === undefined ? {} : { richText }),
    ...(typegen === undefined ? {} : { typegen }),
    ...(input.requireCompleteTranslations === undefined ? {} : { requireCompleteTranslations: input.requireCompleteTranslations as boolean }),
    ...(input.checkLocales === undefined ? {} : { checkLocales: list(input.checkLocales, 'checkLocales', locale) }),
    ...(input.baseline === undefined ? {} : { baseline: path.resolve(directory, string(input.baseline, 'baseline')) }),
  });
}

/** Synchronous for use directly inside vite.config; never imports or executes config code. */
export function loadProjectConfig(filename: string): SayloProjectConfig {
  const file = path.resolve(string(filename, 'config path'));
  let input: unknown;
  try { input = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (cause) { throw new Error(`Unable to read Saylo JSON config: ${file}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
  return resolveProjectConfig(input, path.dirname(file));
}

/** Catch misspelled policy declarations before generation or production projection. */
export function assertRichTextKeys(catalogs: readonly ParsedCatalog[], baseLocale: string, richText?: RichTextPolicies): void {
  if (richText === undefined) return;
  const bases = new Map(catalogs.filter(catalog => catalog.locale === baseLocale).map(catalog => [catalog.namespace, catalog]));
  for (const [name, messages] of Object.entries(richText ?? {})) {
    const base = bases.get(name);
    if (!base) throw new RangeError(`Rich text namespace ${JSON.stringify(name)} is absent from the base catalogs.`);
    for (const id of Object.keys(messages)) if (!Object.hasOwn(base.messages, id))
      throw new RangeError(`Rich text key ${JSON.stringify(`${name}:${id}`)} is absent from the base catalogs.`);
  }
}
