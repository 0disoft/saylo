#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadProjectConfig, resolveProjectConfig } from './config.js';
import { inspectProject } from './catalog-audit.js';
import type { CatalogCheckReport } from './catalog-audit.js';

const help = `Usage: saylo check [--config saylo.config.json] [--json]

Commands:
  check                     Validate catalogs, contracts and translation completeness; never writes files.

Options:
  --config <file.json>       Defaults to saylo.config.json in cwd when present.
  --locales-dir <directory>  Override catalog path relative to cwd.
  --base-locale <locale>     Override the base BCP 47 locale.
  --locales <en,fr>          Completeness targets; otherwise configured/discovered locales.
  --json                    Emit one machine-readable JSON result on stdout.
  --help, -h                Show help without reading files.

Exit codes: 0 clean, 1 catalog issues, 2 usage/config/filesystem failure.`;
class UsageError extends Error {}
let json = process.argv.includes('--json');

function printCheckReport(report: CatalogCheckReport): string {
  const lines = report.diagnostics.map(issue => `${issue.severity} ${issue.code} ${issue.sourceName}${issue.id === undefined ? '' : ` [${issue.id}]`}: ${issue.message}`);
  lines.push(`[saylo:check] ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`);
  return lines.join('\n');
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string' }, 'locales-dir': { type: 'string' }, 'base-locale': { type: 'string' },
    locales: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  json = values.json ?? false;
  if (values.help) console.log(help);
  else {
    if (positionals.length !== 1 || positionals[0] !== 'check') throw new UsageError('Choose a command: saylo check.');
    const filename = values.config ?? (existsSync('saylo.config.json') ? 'saylo.config.json' : undefined);
    const loaded = filename ? loadProjectConfig(filename) : {};
    const config = resolveProjectConfig({ ...loaded,
      ...(values['locales-dir'] === undefined ? {} : { localesDir: path.resolve(values['locales-dir']) }),
      ...(values['base-locale'] === undefined ? {} : { baseLocale: values['base-locale'] }),
      ...(values.locales === undefined ? {} : { checkLocales: values.locales.split(',') }),
    });
    const { report } = await inspectProject(config);
    console.log(json ? JSON.stringify(report) : printCheckReport(report));
    process.exitCode = report.diagnostics.length ? 1 : 0;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (json) console.log(JSON.stringify({ format: 'saylo-command-error/v1', error: { message } }));
  else console.error(`[saylo] ${message}\nRun saylo --help for options.`);
  process.exitCode = 2;
}
