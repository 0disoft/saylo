import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { CatalogError } from '@0disoft/saylo-core';
import type { CatalogDiagnostic } from '@0disoft/saylo-core';
import type { CatalogFile } from './catalog-files.js';

/** Snapshot direct plugin options as well as JSON-config inputs. */
export function readCheckLocales(value: readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError('checkLocales must be an array.');
  const locales = value.map(locale => {
    if (typeof locale !== 'string' || !locale.trim()) throw new TypeError('checkLocales must contain valid BCP 47 locales.');
    return Intl.getCanonicalLocales(locale)[0]!;
  });
  if (new Set(locales).size !== locales.length) throw new TypeError('checkLocales contains duplicate entries.');
  return Object.freeze(locales);
}

/** Runs after ordinary schema validation, before chunk or type generation. */
export async function requireCompleteTranslations(root: string, files: readonly CatalogFile[],
  baseLocale: string, initialLocale: string, checkLocales?: readonly string[],
): Promise<void> {
  const bases = files.filter(file => file.catalog.locale === baseLocale)
    .map(({ catalog }) => ({ catalog, ids: Object.keys(catalog.messages).sort() }))
    .sort((a, b) => a.catalog.namespace < b.catalog.namespace ? -1 : a.catalog.namespace > b.catalog.namespace ? 1 : 0);
  const translations = new Map<string, Map<string, CatalogFile>>();
  for (const file of files) {
    let namespaces = translations.get(file.catalog.locale);
    if (!namespaces) { namespaces = new Map(); translations.set(file.catalog.locale, namespaces); }
    namespaces.set(file.catalog.namespace, file);
  }
  // Include empty locale directories, keeping their actual spelling in file hints.
  // scanCatalogs already validated directory aliases and symlink containment.
  const directories = new Map<string, string>();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory() && !(entry.isSymbolicLink() && (await stat(path.join(root, entry.name))).isDirectory())) continue;
    directories.set(Intl.getCanonicalLocales(entry.name)[0]!, entry.name);
  }
  const targets = new Set([...(checkLocales ?? directories.keys()), initialLocale]);
  const diagnostics: CatalogDiagnostic[] = [];
  for (const locale of [...targets].sort()) {
    if (locale === baseLocale) continue;
    for (const { catalog: base, ids } of bases) {
      const namespace = base.namespace;
      const translation = translations.get(locale)?.get(namespace)?.catalog;
      const sourceName = translation?.sourceName ?? `${directories.get(locale) ?? locale}/${namespace}.json`;
      const context = { locale, namespace, sourceName };
      if (!translation) {
        diagnostics.push({ ...context, code: 'MISSING_NAMESPACE',
          message: `Missing namespace ${JSON.stringify(namespace)} for locale ${JSON.stringify(locale)}. Create this file with every key from ${base.sourceName}.` });
        continue;
      }
      for (const id of ids) if (!Object.hasOwn(translation.messages, id)) {
        diagnostics.push({ ...context, id, code: 'MISSING_MESSAGE',
          message: `Missing translation ${JSON.stringify(`${namespace}:${id}`)} for locale ${JSON.stringify(locale)} (base: ${base.sourceName}).` });
      }
    }
  }
  if (diagnostics.length) throw new CatalogError(diagnostics);
}
