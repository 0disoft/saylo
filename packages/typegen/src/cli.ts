#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createBaseSchema, createStore } from '@0disoft/saylo-core';
import { scanCatalogs } from './catalog-files.js';
import { renderTypes } from './render.js';
import { writeGenerated } from './write.js';
import { withOutputLock } from './output-lock.js';
import { assertRichTextKeys, loadProjectConfig } from './config.js';

const help = `Usage: saylo-typegen --locales-dir <directory> --base-locale <locale> --out-file <file.d.ts>

Required options:
  --locales-dir <directory>  Directory containing locale/namespace.json catalogs.
  --base-locale <locale>     Base BCP 47 locale, for example ko or en-US.
  --out-file <file.d.ts>     Generated declaration file; must end in .d.ts.

  --config <file.json>      Shared project settings; explicit flags override their paths relative to cwd.

  --help, -h                Show this help without reading or writing files.

Example:
  saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts

All catalogs are validated before writing. Invalid catalogs leave existing output unchanged.`;
class CliUsageError extends Error {}

try {
  const { values } = parseArgs({ options: {
    'locales-dir': { type: 'string' }, 'base-locale': { type: 'string' }, 'out-file': { type: 'string' }, help: { type: 'boolean', short: 'h' },
    config: { type: 'string' },
  } });
  if (values.help) console.log(help);
  else {
    const config = values.config ? loadProjectConfig(values.config) : undefined;
    const localesDir = values['locales-dir'] ?? config?.localesDir;
    const configuredBase = values['base-locale'] ?? config?.baseLocale;
    const outFile = values['out-file'] ?? config?.typegen?.outFile;
    if (!localesDir || !configuredBase || !outFile) throw new CliUsageError('--locales-dir, --base-locale and --out-file are required.');
    if (!outFile.endsWith('.d.ts')) throw new CliUsageError('--out-file must end in .d.ts.');
    let baseLocale: string;
    try { baseLocale = Intl.getCanonicalLocales(configuredBase)[0]!; }
    catch { throw new CliUsageError('--base-locale must be a valid BCP 47 locale, for example ko or en-US.'); }
    const result = await withOutputLock(outFile, async lock => {
      const { files } = await scanCatalogs(path.resolve(localesDir), config?.richText);
      const catalogs = files.map(f => f.catalog);
      createStore({ baseLocale, locale: baseLocale, catalogs }).dispose();
      assertRichTextKeys(catalogs, baseLocale, config?.richText);
      const source = renderTypes(catalogs.filter(c => c.locale === baseLocale).map(createBaseSchema));
      return writeGenerated(outFile, source, undefined, { lock });
    });
    console.log(`[saylo:typegen] ${result}: ${outFile}`);
  }
} catch (error) {
  console.error(`[saylo:typegen] ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof CliUsageError || (error instanceof Error && 'code' in error
    && String(error.code).startsWith('ERR_PARSE_ARGS'))) console.error('Run saylo-typegen --help for options and an example.');
  process.exitCode = 1;
}
