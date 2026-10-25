import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseCatalog } from '@0disoft/saylo-core';
import { CatalogUsageError } from './catalog-cli-options.js';
import { CatalogOutputError, writeCatalogOutput } from './catalog-output.js';
import { createCliCancellation } from './cli-cancellation.js';
import { migrateI18next } from './migrate-i18next.js';
import {
  DirectoryMigrationApplyError, applyDirectoryMigration, planDirectoryMigration,
} from './migrate-directory.js';
import type { DirectoryMigrationFile, DirectoryMigrationIssue, DirectoryMigrationReport } from './migrate-directory.js';
import { CallRewriteApplyError, applyCallRewrite, planCallRewrite } from './migrate-calls.js';
import type { CallRewritePlan } from './migrate-calls.js';

const help = [
  'Usage:',
  '  saylo migrate --from i18next --file namespace.json --locale en --namespace common [--escape-value false] [--out-file new.json] [--json]',
  '  saylo migrate --from i18next --from-dir <locales> --out-dir <root> [--escape-value false] [--apply | --dry-run] [--json]',
  '      [--rewrite-calls --source-dir <src> --namespace <namespace>]',
  'Read-only by default. Converts JSON-v4 nested keys, simple interpolation and cardinal plurals.',
  '--escape-value false confirms the source app disables HTML escaping; otherwise escaped interpolation blocks conversion.',
  'The single-file form preserves --file/--locale/--namespace and uses --out-file for one exclusive write.',
  'Directory mode reads <from-dir>/<locale>/<namespace>.json, preflights every target, and never overwrites output.',
  '--rewrite-calls only rewrites literal t() keys on i18next or direct useTranslation bindings; imports, hooks and providers stay manual.',
  'Context selection, ordinal/legacy plurals, nesting, arrays and custom formatters require manual migration.',
  'Single-file migration is included in 0.1.0-alpha.7; install @0disoft/saylo-typegen@alpha.',
  'Directory mode and --rewrite-calls are source-checkout additions until a later release includes them.',
].join('\n');

function callPlanReport(plan: CallRewritePlan, writtenFiles: readonly string[] = plan.writtenFiles) {
  return {
    format: plan.format, sourceDir: plan.sourceDir, namespace: plan.namespace,
    dryRun: writtenFiles.length === 0 && plan.dryRun, blocked: plan.blocked || (plan.dryRun && writtenFiles.length > 0),
    changes: plan.changes, issues: plan.issues,
    checkpoint: { ...plan.checkpoint, entries: plan.checkpoint.entries.map(entry => ({
      ...entry,
      status: writtenFiles.includes(path.join(plan.sourceDir, entry.file)) ? 'written' as const : entry.status,
    })) },
    writtenFiles,
  };
}

interface DirectoryCliReport {
  readonly dryRun: boolean;
  readonly blocked: boolean;
  readonly files: readonly DirectoryMigrationFile[];
  readonly issues: readonly DirectoryMigrationIssue[];
  readonly checkpoint: { readonly entries: readonly { readonly status: string }[] };
  readonly writtenFiles: readonly string[];
  readonly calls?: ReturnType<typeof callPlanReport>;
}

function printDirectoryReport(report: DirectoryCliReport): void {
  const lines = [
    '[saylo:migrate] ' + (report.dryRun ? 'dry-run' : 'applied') + '; ' + report.files.length +
      ' catalog(s); blocked=' + report.blocked + '.',
  ];
  for (const issue of report.issues)
    lines.push('issue ' + issue.code + (issue.file ? ' ' + issue.file : '') + ': ' + issue.message);
  for (const file of report.files) {
    lines.push('catalog ' + file.localeDirectory + '/' + file.namespace + '.json' + (file.blocked ? ' blocked' : '') +
      ': ' + file.sourceFile + ' -> ' + file.targetFile);
    for (const issue of file.issues)
      lines.push('  ' + issue.code + (issue.key ? ' [' + issue.key + ']' : '') + ': ' + issue.message);
    for (const mapping of file.mappings)
      lines.push('  ' + mapping.sourceKeys.join(', ') + ' -> ' + mapping.targetKey);
  }
  if (report.calls) {
    lines.push('calls ' + (report.calls.dryRun ? 'dry-run' : 'applied') + '; ' +
      report.calls.changes.length + ' literal key(s); blocked=' + report.calls.blocked + '.');
    for (const issue of report.calls.issues)
      lines.push('  ' + issue.code + ' ' + issue.file + ':' + (issue.line ?? 1) + ': ' + issue.message);
    for (const change of report.calls.changes)
      lines.push('  ' + change.file + ':' + change.line + ' ' + change.before + ' -> ' + change.after);
  }
  if (report.writtenFiles.length) lines.push('written ' + report.writtenFiles.join(', '));
  console.log(lines.join('\n'));
}

export async function runMigration(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: {
    from: { type: 'string' }, file: { type: 'string' }, locale: { type: 'string' }, namespace: { type: 'string' },
    'base-file': { type: 'string' }, 'base-locale': { type: 'string' }, 'escape-value': { type: 'string' },
    'out-file': { type: 'string' }, 'from-dir': { type: 'string' }, 'out-dir': { type: 'string' },
    'source-dir': { type: 'string' }, 'rewrite-calls': { type: 'boolean' }, apply: { type: 'boolean' },
    'dry-run': { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); return; }
  const directoryMode = values['from-dir'] !== undefined || values['out-dir'] !== undefined ||
    values['source-dir'] !== undefined || values['rewrite-calls'] || values.apply || values['dry-run'];
  if (directoryMode) {
    if (values.from !== 'i18next' || !values['from-dir'] || !values['out-dir'])
      throw new CatalogUsageError('Directory migration requires --from i18next --from-dir <locales> --out-dir <root>.');
    if (values.file || values.locale || values['out-file'] || values['base-file'] || values['base-locale'])
      throw new CatalogUsageError('--file, --locale, --out-file, --base-file and --base-locale are single-file options.');
    if (values['escape-value'] !== undefined && values['escape-value'] !== 'false')
      throw new CatalogUsageError('Only --escape-value false is supported.');
    if (values.apply && values['dry-run']) throw new CatalogUsageError('Choose --apply or --dry-run, not both.');
    if (values['rewrite-calls']) {
      if (!values['source-dir'] || !values.namespace)
        throw new CatalogUsageError('--rewrite-calls requires --source-dir <src> and --namespace <namespace>.');
    } else {
      if (values['source-dir']) throw new CatalogUsageError('--source-dir requires --rewrite-calls.');
      if (values.namespace) throw new CatalogUsageError('Directory --namespace is only used with --rewrite-calls.');
    }
    const apply = Boolean(values.apply);
    const cancellation = apply ? createCliCancellation() : undefined;
    let report: DirectoryCliReport | undefined;
    let callPlan: CallRewritePlan | undefined;
    let directoryResult: DirectoryMigrationReport | undefined;
    let callResult: CallRewritePlan | undefined;
    try {
      const plan = await planDirectoryMigration({
        fromDir: values['from-dir'], outDir: values['out-dir'],
        ...(values['escape-value'] === 'false' ? { escapeValue: false as const } : {}),
        ...(cancellation === undefined ? {} : { signal: cancellation.signal }),
      });
      const extraIssues: DirectoryMigrationIssue[] = [];
      if (values['rewrite-calls'] && !plan.blocked) {
        const selected = plan.files.filter(file => file.namespace === values.namespace && file.catalog !== null);
        const locales = new Set(plan.files.map(file => file.localeDirectory));
        const missingLocales = [...locales].filter(locale =>
          !selected.some(file => file.localeDirectory === locale)).sort();
        if (!selected.length || missingLocales.length) {
          extraIssues.push({ code: 'CALL_NAMESPACE_MISSING',
            message: 'Namespace ' + values.namespace + ' is missing for converted locale(s): ' +
              (missingLocales.join(', ') || '(none).') });
        } else {
          const keySets = selected.map(file => new Set(Object.keys(file.catalog!)));
          const targets = [...keySets[0]!].filter(key => keySets.every(keys => keys.has(key))).sort();
          if (keySets.some(keys => keys.size !== targets.length)) {
            extraIssues.push({ code: 'CALL_NAMESPACE_LAYOUT',
              message: 'Locale catalogs in namespace ' + values.namespace + ' do not share the same keys.' });
          } else {
            callPlan = await planCallRewrite({
              sourceDir: values['source-dir']!, namespace: values.namespace!, targets,
              ...(cancellation === undefined ? {} : { signal: cancellation.signal }),
            });
          }
        }
      }
      const blocked = plan.blocked || extraIssues.length > 0 || Boolean(callPlan?.blocked);
      const issues = [...plan.issues, ...extraIssues];
      const calls = callPlan ? callPlanReport(callPlan) : undefined;
      report = { ...plan, blocked, issues, ...(calls === undefined ? {} : { calls }) };
      if (blocked || !apply) {
        if (values.json) console.log(JSON.stringify(report));
        else printDirectoryReport(report);
        process.exitCode = blocked ? 1 : 0;
        return;
      }
      directoryResult = await applyDirectoryMigration(plan, {
        ...(cancellation === undefined ? {} : { signal: cancellation.signal }),
      });
      if (callPlan) {
        callResult = await applyCallRewrite(callPlan, {
          ...(cancellation === undefined ? {} : { signal: cancellation.signal }),
        });
      }
      const writtenFiles = [...directoryResult.writtenFiles, ...(callResult?.writtenFiles ?? [])];
      cancellation?.throwIfCancelled(writtenFiles);
      const finalCalls = callResult ? callPlanReport(callResult) : undefined;
      const finalReport: DirectoryCliReport = {
        ...directoryResult, blocked: false, issues,
        ...(finalCalls === undefined ? {} : { calls: finalCalls }), writtenFiles,
      };
      if (values.json) console.log(JSON.stringify(finalReport));
      else printDirectoryReport(finalReport);
      process.exitCode = 0;
    } catch (error) {
      const directoryWritten = error instanceof DirectoryMigrationApplyError ? error.writtenFiles
        : directoryResult?.writtenFiles ?? [];
      const callWritten = error instanceof CallRewriteApplyError ? error.writtenFiles : callResult?.writtenFiles ?? [];
      const writtenFiles = [...new Set([...directoryWritten, ...callWritten])];
      cancellation?.throwIfCancelled(writtenFiles);
      const partialCalls = callPlan ? callPlanReport(callPlan, callWritten) : undefined;
      const base = error instanceof DirectoryMigrationApplyError
        ? error.report
        : { ...(report ?? { dryRun: false, blocked: true, files: [], issues: [], checkpoint: { entries: [] } }),
            dryRun: false as const };
      const partial = {
        ...base, dryRun: false, blocked: true, writtenFiles,
        ...(partialCalls === undefined ? {} : { calls: partialCalls }),
        error: { message: error instanceof Error ? error.message : String(error), writtenFiles },
      };
      if (values.json) console.log(JSON.stringify(partial));
      else {
        printDirectoryReport({ ...base, dryRun: false, blocked: true, writtenFiles,
          ...(partialCalls === undefined ? {} : { calls: partialCalls }) });
        console.error('[saylo:migrate] ' + partial.error.message);
      }
      process.exitCode = 2;
    } finally { cancellation?.dispose(); }
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
      { protectedFiles: [path.resolve(values.file), ...(values['base-file'] ? [path.resolve(values['base-file'])] : [])],
        signal: cancellation!.signal }) : [];
    cancellation?.throwIfCancelled(writtenFiles);
    console.log(values.json ? JSON.stringify({ ...result, writtenFiles }) : JSON.stringify({ ...result, writtenFiles }, null, 2));
    process.exitCode = result.blocked ? 1 : 0;
  } catch (error) {
    cancellation?.throwIfCancelled(error instanceof CatalogOutputError ? error.writtenFiles : []);
    throw error;
  } finally { cancellation?.dispose(); }
}
