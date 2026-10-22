#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadProjectConfig, resolveProjectConfig } from './config.js';
import { inspectProject } from './catalog-audit.js';
import type { CatalogCheckReport } from './catalog-audit.js';
import { compareReviewBaseline, createReviewBaseline, readReviewBaseline } from './catalog-review.js';
import { isBlockingIssue, planCatalogSync } from './catalog-sync.js';
import { createTranslationWorkfile } from './catalog-workfile.js';

const help = `Usage: saylo <check|sync|snapshot|export> [--config saylo.config.json] [--json]

Commands:
  check                     Validate catalogs, contracts and translation completeness; never writes files.
  sync --dry-run            Preview missing keys, review work and retained orphan translations; never writes files.
  snapshot                  Print a JSON source-hash comparison checkpoint to stdout; never writes files.
  export                    Print missing/review translation tasks as editable JSON to stdout.

Options:
  --config <file.json>       Defaults to saylo.config.json in cwd when present.
  --locales-dir <directory>  Override catalog path relative to cwd.
  --base-locale <locale>     Override the base BCP 47 locale.
  --locales <en,fr>          Completeness targets; otherwise configured/discovered locales.
  --baseline <file.json>     Compare base text/rich contracts with a saved snapshot.
  --dry-run                 Required for sync. Applying changes is not supported.
  --json                    Emit one machine-readable JSON result on stdout.
  --help, -h                Show help without reading files.

Exit codes: check 0 clean/1 issues; sync 0 preview ready/1 blocked; snapshot 0 valid/1 invalid catalogs.
All commands use exit 2 for usage/config/filesystem failures. Missing baseline means review status is unknown.`;
class UsageError extends Error {}
let json = process.argv.includes('--json');

function printCheckReport(report: CatalogCheckReport): string {
  const lines = report.diagnostics.map(issue => `${issue.severity} ${issue.code} ${issue.sourceName}${issue.id === undefined ? '' : ` [${issue.id}]`}: ${issue.message}`);
  lines.push(`[saylo:check] ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`);
  if (report.reviewTracking === 'not-configured') lines.push('Source change review is unavailable without --baseline (or config.baseline).');
  return lines.join('\n');
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string' }, 'locales-dir': { type: 'string' }, 'base-locale': { type: 'string' },
    locales: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    baseline: { type: 'string' }, 'dry-run': { type: 'boolean' },
  } });
  json = values.json ?? false;
  if (values.help) console.log(help);
  else {
    const command = positionals[0];
    if (positionals.length !== 1 || !command || !['check', 'sync', 'snapshot', 'export'].includes(command))
      throw new UsageError('Choose a command: saylo check, sync --dry-run, snapshot, or export.');
    if (command === 'sync' && !values['dry-run']) throw new UsageError('sync requires --dry-run; applying changes is not supported.');
    if (command !== 'sync' && values['dry-run']) throw new UsageError('--dry-run is only supported with sync.');
    if (command === 'snapshot' && values.baseline) throw new UsageError('snapshot prints a new checkpoint; --baseline is a comparison input, not an output path.');
    json ||= command === 'snapshot' || command === 'export';
    const filename = values.config ?? (existsSync('saylo.config.json') ? 'saylo.config.json' : undefined);
    const loaded = filename === undefined ? {} : loadProjectConfig(filename);
    const config = resolveProjectConfig({ ...loaded,
      ...(values['locales-dir'] === undefined ? {} : { localesDir: values['locales-dir'] }),
      ...(values['base-locale'] === undefined ? {} : { baseLocale: values['base-locale'] }),
      ...(values.locales === undefined ? {} : { checkLocales: values.locales.split(',') }),
      ...(values.baseline === undefined ? {} : { baseline: values.baseline }),
    });
    const baseline = command !== 'snapshot' && config.baseline ? await readReviewBaseline(config.baseline, config.baseLocale) : undefined;
    const inspected = await inspectProject(config);
    const report = baseline ? compareReviewBaseline(inspected.inspection, inspected.report, baseline) : inspected.report;
    if (command === 'export') {
      const plan = planCatalogSync(inspected.inspection, report);
      console.log(JSON.stringify(plan.blocked ? report : createTranslationWorkfile(inspected.inspection, report)));
      process.exitCode = plan.blocked ? 1 : 0;
    } else if (command === 'snapshot') {
      const blocked = report.diagnostics.some(issue => issue.severity === 'error' && isBlockingIssue(issue.code));
      console.log(JSON.stringify(blocked ? report : createReviewBaseline(inspected.inspection, config.baseLocale)));
      process.exitCode = blocked ? 1 : 0;
    } else if (command === 'sync') {
      const plan = planCatalogSync(inspected.inspection, report);
      console.log(json ? JSON.stringify(plan) : `${printCheckReport(report)}\n${plan.changes.map(change =>
        `${change.action} ${change.sourceName} [${change.id}]: ${change.reason}`).join('\n')}\n[saylo:sync] dry-run; ${plan.changes.length} planned item(s); blocked=${plan.blocked}.`);
      process.exitCode = plan.blocked ? 1 : 0;
    } else {
      console.log(json ? JSON.stringify(report) : printCheckReport(report));
      process.exitCode = report.diagnostics.length ? 1 : 0;
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (json) console.log(JSON.stringify({ format: 'saylo-command-error/v1', error: { message } }));
  else console.error(`[saylo] ${message}\nRun saylo --help for options.`);
  process.exitCode = 2;
}
