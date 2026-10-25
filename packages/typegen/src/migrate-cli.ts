import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseCatalog } from '@0disoft/saylo-core';
import { CatalogUsageError } from './catalog-cli-options.js';
import { CatalogOutputError, writeCatalogOutput } from './catalog-output.js';
import { createCliCancellation } from './cli-cancellation.js';
import { migrateI18next } from './migrate-i18next.js';

export async function runMigration(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: {
    from: { type: 'string' }, file: { type: 'string' }, locale: { type: 'string' }, namespace: { type: 'string' },
    'base-file': { type: 'string' }, 'base-locale': { type: 'string' }, 'escape-value': { type: 'string' },
    'out-file': { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log(`Usage: saylo migrate --from i18next --file namespace.json --locale en --namespace common [--escape-value false] [--out-file new.json] [--json]
Read-only by default. Converts JSON-v4 nested keys, simple interpolation and cardinal plurals.
--escape-value false confirms the source app disables HTML escaping; otherwise escaped interpolation blocks conversion.
--base-file <saylo.json> --base-locale <locale> optionally validate against an existing Saylo base contract.
--out-file exclusively writes a new catalog when no issues remain. Existing parents are required.
Context selection, ordinal/legacy plurals, nesting, arrays and custom formatters require manual migration.
Application call sites are not rewritten. Available since 0.1.0-alpha.7. Install @0disoft/saylo-typegen@alpha; latest remains a registration placeholder.`);
    return;
  }
  if (values.from !== 'i18next' || !values.file || !values.locale || !values.namespace)
    throw new CatalogUsageError('migrate requires --from i18next --file --locale --namespace.');
  if (values['escape-value'] !== undefined && values['escape-value'] !== 'false') throw new CatalogUsageError('Only --escape-value false is supported.');
  if (values['out-file'] !== undefined && (!values['out-file'].trim() || !values['out-file'].endsWith('.json')))
    throw new CatalogUsageError('--out-file must name a new .json file.');
  if (!!values['base-file'] !== !!values['base-locale']) throw new CatalogUsageError('--base-file and --base-locale must be specified together.');
  const cancellation = values['out-file'] ? createCliCancellation() : undefined;
  try {
    const source = await readFile(values.file, 'utf8');
    const baseCatalog = values['base-file'] ? parseCatalog(await readFile(values['base-file'], 'utf8'),
      { locale: values['base-locale']!, namespace: values.namespace, sourceName: values['base-file'] }) : undefined;
    const result = migrateI18next(source, { locale: values.locale, namespace: values.namespace,
      ...(values['escape-value'] === 'false' ? { escapeValue: false } : {}), ...(baseCatalog ? { baseCatalog } : {}) });
    cancellation?.throwIfCancelled();
    const writtenFiles = values['out-file'] && result.catalog ? await writeCatalogOutput(values['out-file'], result.catalog,
      { protectedFiles: [path.resolve(values.file), ...(values['base-file'] ? [path.resolve(values['base-file'])] : [])], signal: cancellation!.signal }) : [];
    cancellation?.throwIfCancelled(writtenFiles);
    console.log(values.json ? JSON.stringify({ ...result, writtenFiles }) : JSON.stringify({ ...result, writtenFiles }, null, 2));
    process.exitCode = result.blocked ? 1 : 0;
  } catch (error) {
    cancellation?.throwIfCancelled(error instanceof CatalogOutputError ? error.writtenFiles : []);
    throw error;
  } finally { cancellation?.dispose(); }
}
