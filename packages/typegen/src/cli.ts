#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createBaseSchema, createStore } from '@saylo/core';
import { scanCatalogs } from './catalog-files.js';
import { renderTypes } from './render.js';
import { writeGenerated } from './write.js';

try {
  const { values } = parseArgs({ options: {
    'locales-dir': { type: 'string' }, 'base-locale': { type: 'string' }, 'out-file': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) console.log('saylo-typegen --locales-dir <directory> --base-locale <locale> --out-file <file.d.ts>');
  else {
    if (!values['locales-dir'] || !values['base-locale'] || !values['out-file']) throw new Error('--locales-dir, --base-locale and --out-file are required.');
    const baseLocale = Intl.getCanonicalLocales(values['base-locale'])[0]!;
    const { files } = await scanCatalogs(path.resolve(values['locales-dir']));
    const catalogs = files.map(f => f.catalog);
    createStore({ baseLocale, locale: baseLocale, catalogs }).dispose();
    const source = renderTypes(catalogs.filter(c => c.locale === baseLocale).map(createBaseSchema));
    const result = await writeGenerated(values['out-file'], source);
    console.log(`[saylo:typegen] ${result}: ${values['out-file']}`);
  }
} catch (error) {
  console.error(`[saylo:typegen] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
