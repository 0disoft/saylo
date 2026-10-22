#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadProjectConfig, resolveProjectConfig } from './config.js';
import { inspectProject } from './catalog-audit.js';
import type { CatalogCheckReport } from './catalog-audit.js';
import { compareReviewBaseline, createReviewBaseline, readReviewBaseline } from './catalog-review.js';
import { isBlockingIssue, planCatalogSync } from './catalog-sync.js';
import { createTranslationWorkfile, readTranslationWorkfile } from './catalog-workfile.js';
import { planTranslationImport } from './catalog-import.js';
import { createImportDiff } from './catalog-diff.js';
import { applyTranslationImport, TranslationApplyError } from './catalog-apply.js';
import { applyReviewApprovals, readReviewApprovals } from './catalog-approvals.js';
import { planReviewApproval } from './catalog-approve.js';
import { writeReviewApproval, ReviewApprovalWriteError } from './review-write.js';
import { refreshTranslationWorkfile } from './catalog-refresh.js';
import { CommandInterruptedError, createCliCancellation } from './cli-cancellation.js';
import { CatalogOutputError, writeCatalogOutput } from './catalog-output.js';

const help = `Usage: saylo <check|sync|snapshot|export|import|approve|refresh> [--config saylo.config.json] [--json]

Commands:
  check                     Validate catalogs, contracts and translation completeness; never writes files.
  sync --dry-run            Preview missing keys, review work and retained orphan translations; never writes files.
  snapshot                  Print a JSON source-hash comparison checkpoint; optionally save with --out-file.
  export                    Print missing/review translation tasks as editable JSON to stdout.
  import --file <work.json>  Validate completed translations; requires --dry-run or --apply.
  approve --file <work.json> Approve current source/translation pairs; requires --reviews and --dry-run or --apply.
  refresh --file <work.json> Print a refreshed workfile and conflict report as JSON; optionally save with --out-file.

Options:
  --config <file.json>       Defaults to saylo.config.json in cwd when present.
  --locales-dir <directory>  Override catalog path relative to cwd.
  --base-locale <locale>     Override the base BCP 47 locale.
  --locales <en,fr>          Completeness targets; otherwise configured/discovered locales.
  --baseline <file.json>     Compare base text/rich contracts with a saved snapshot.
  --reviews <file.json>      Track explicit approvals per locale and message.
  --dry-run                 Preview sync, import or approval without writing files.
  --diff                    Show a unified file diff; only with import --dry-run (optional --json).
  --apply                   Apply import (atomic per file) or atomically update approval JSON.
  --file <work.json>         Translation workfile input; supported with import, approve or refresh.
  --with-context            Export/refresh v2 workfiles with advisory argument types and allowed tags.
  --out-file <new.json>      Save export/snapshot/refresh JSON exclusively; stdout reports writtenFiles.
  --json                    Emit one machine-readable JSON result on stdout.
  --help, -h                Show help without reading files.

Exit codes: check 0 clean/1 issues; sync/export/import/approve/refresh 0 ready/1 blocked; snapshot 0 valid/1 invalid catalogs.
All commands use exit 2 for usage/config/filesystem failures. Only import --apply writes catalogs.
approve --apply writes only the reviews ledger. Import/snapshot never approve translations.
Apply/--out-file commands wait for cleanup on SIGINT/SIGTERM, then exit 130/143 and report already written files.`;
class UsageError extends Error {}
let json = process.argv.includes('--json');
let cancellation: ReturnType<typeof createCliCancellation> | undefined;

function printCheckReport(report: CatalogCheckReport): string {
  const lines = report.diagnostics.map(issue => `${issue.severity} ${issue.code} ${issue.sourceName}${issue.id === undefined ? '' : ` [${issue.id}]`}: ${issue.message}`);
  lines.push(`[saylo:check] ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`);
  if (report.reviewTracking === 'not-configured') lines.push('Source change review is unavailable without --baseline or --reviews.');
  return lines.join('\n');
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string' }, 'locales-dir': { type: 'string' }, 'base-locale': { type: 'string' },
    locales: { type: 'string' }, json: { type: 'boolean' }, diff: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    baseline: { type: 'string' }, reviews: { type: 'string' }, 'dry-run': { type: 'boolean' },
    file: { type: 'string' }, apply: { type: 'boolean' }, 'with-context': { type: 'boolean' }, 'out-file': { type: 'string' },
  } });
  json = values.json ?? false;
  if (values.help) console.log(help);
  else {
    const command = positionals[0];
    if (positionals.length !== 1 || !command || !['check', 'sync', 'snapshot', 'export', 'import', 'approve', 'refresh'].includes(command))
      throw new UsageError('Choose a command: saylo check, sync --dry-run, snapshot, export, import, approve, or refresh.');
    if (command === 'sync' && !values['dry-run']) throw new UsageError('sync requires --dry-run; applying changes is not supported.');
    if (values.diff && (command !== 'import' || !values['dry-run'] || values.apply))
      throw new UsageError('--diff is only supported with import --dry-run.');
    if (values['with-context'] && !['export', 'refresh'].includes(command))
      throw new UsageError('--with-context is only supported with export or refresh.');
    if (values['out-file'] !== undefined && !['export', 'snapshot', 'refresh'].includes(command))
      throw new UsageError('--out-file is only supported with export, snapshot or refresh.');
    if (values['out-file'] !== undefined && (!values['out-file'].trim() || !values['out-file'].endsWith('.json')))
      throw new UsageError('--out-file must name a new .json file.');
    const usesWorkfile = ['import', 'approve'].includes(command);
    if (!['sync', 'import', 'approve'].includes(command) && values['dry-run']) throw new UsageError('--dry-run is only supported with sync, import or approve.');
    if (usesWorkfile && (!values.file || !!values.apply === !!values['dry-run']))
      throw new UsageError(`${command} requires --file and exactly one of --dry-run or --apply.`);
    if (command === 'refresh' && !values.file) throw new UsageError('refresh requires --file.');
    if (!usesWorkfile && values.apply) throw new UsageError('--apply is only supported with import or approve.');
    if (!usesWorkfile && command !== 'refresh' && values.file !== undefined) throw new UsageError('--file is only supported with import, approve or refresh.');
    if (usesWorkfile && values.baseline) throw new UsageError(`${command} uses workfile checkpoints; --baseline is not supported.`);
    if (['import', 'snapshot'].includes(command) && values.reviews) throw new UsageError('--reviews is supported with check, sync, export, approve or refresh.');
    if (command === 'snapshot' && values.baseline) throw new UsageError('snapshot prints a new checkpoint; --baseline is a comparison input, not an output path.');
    if ((usesWorkfile && values.apply) || values['out-file'] !== undefined) cancellation = createCliCancellation();
    json ||= ['snapshot', 'export', 'refresh'].includes(command);
    const filename = values.config ?? (existsSync('saylo.config.json') ? 'saylo.config.json' : undefined);
    const loaded = filename === undefined ? {} : loadProjectConfig(filename);
    const config = resolveProjectConfig({ ...loaded,
      ...(values['locales-dir'] === undefined ? {} : { localesDir: values['locales-dir'] }),
      ...(values['base-locale'] === undefined ? {} : { baseLocale: values['base-locale'] }),
      ...(values.locales === undefined ? {} : { checkLocales: values.locales.split(',') }),
      ...(values.baseline === undefined ? {} : { baseline: values.baseline }),
      ...(values.reviews === undefined ? {} : { reviews: values.reviews }),
    });
    if (command === 'approve' && !config.reviews) throw new UsageError('approve requires --reviews <file.json> or config.reviews.');
    const baseline = !['snapshot', 'import', 'approve'].includes(command) && config.baseline ? await readReviewBaseline(config.baseline, config.baseLocale) : undefined;
    const inspected = await inspectProject(config);
    const compared = baseline ? compareReviewBaseline(inspected.inspection, inspected.report, baseline) : inspected.report;
    const approvals = ['check', 'sync', 'export', 'approve', 'refresh'].includes(command) && config.reviews
      ? await readReviewApprovals(config.reviews, config.baseLocale, ['export', 'approve', 'refresh'].includes(command)) : undefined;
    const report = approvals && command !== 'approve' ? applyReviewApprovals(inspected.inspection, compared, approvals.approvals) : compared;
    cancellation?.throwIfCancelled();
    const emitJson = async (value: unknown, blocked: boolean, canSave: boolean) => {
      if (values['out-file'] === undefined || !canSave) { cancellation?.throwIfCancelled(); console.log(JSON.stringify(value)); return; }
      const protectedFiles = [filename, values.file, command === 'snapshot' ? undefined : config.baseline, approvals?.file]
        .filter((file): file is string => file !== undefined);
      const writtenFiles = await writeCatalogOutput(values['out-file'], value,
        { localesDir: config.localesDir, protectedFiles, signal: cancellation!.signal });
      cancellation!.throwIfCancelled(writtenFiles);
      console.log(JSON.stringify({ format: 'saylo-file-output/v1', command, writtenFiles, blocked }));
    };
    if (command === 'refresh') {
      const work = await readTranslationWorkfile(values.file!, config.baseLocale);
      const result = refreshTranslationWorkfile(inspected.inspection, report, work, { withContext: values['with-context'] === true });
      await emitJson(result, result.blocked, result.workfile !== null);
      process.exitCode = result.blocked ? 1 : 0;
    } else if (command === 'approve') {
      const work = await readTranslationWorkfile(values.file!, config.baseLocale);
      cancellation?.throwIfCancelled();
      const plan = planReviewApproval(inspected.inspection, report, work, approvals!);
      const result = values.apply && !plan.report.blocked ? await writeReviewApproval(plan, { signal: cancellation!.signal }) : plan.report;
      cancellation?.throwIfCancelled(result.writtenFiles);
      console.log(json ? JSON.stringify(result) : `${result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join('\n')}\n[saylo:approve] ${result.blocked ? 'blocked' : result.dryRun ? 'dry-run' : 'approved'}; ${result.changes.length} approval(s); ${result.writtenFiles.length} ledger file(s) written.`);
      process.exitCode = result.blocked ? 1 : 0;
    } else if (command === 'import') {
      const work = await readTranslationWorkfile(values.file!, config.baseLocale);
      cancellation?.throwIfCancelled();
      const plan = planTranslationImport(inspected.inspection, report, config, work);
      const result = values.apply && !plan.report.blocked ? await applyTranslationImport(plan, { signal: cancellation!.signal }) : plan.report;
      cancellation?.throwIfCancelled(result.writtenFiles);
      const diff = values.diff ? createImportDiff(plan) : undefined;
      if (json) console.log(JSON.stringify(values.diff ? { ...result, diff } : result));
      else if (typeof diff === 'string') process.stdout.write(diff);
      else console.log(`${result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join('\n')}\n[saylo:import] ${result.blocked ? 'blocked' : result.dryRun ? 'dry-run' : 'applied'}; ${result.changes.length} message(s); ${result.writtenFiles.length} file(s) written.`);
      process.exitCode = result.blocked ? 1 : 0;
    } else if (command === 'export') {
      const plan = planCatalogSync(inspected.inspection, report);
      await emitJson(plan.blocked ? report : createTranslationWorkfile(inspected.inspection, report, { withContext: values['with-context'] === true }), plan.blocked, !plan.blocked);
      process.exitCode = plan.blocked ? 1 : 0;
    } else if (command === 'snapshot') {
      const blocked = report.diagnostics.some(issue => issue.severity === 'error' && isBlockingIssue(issue.code));
      await emitJson(blocked ? report : createReviewBaseline(inspected.inspection, config.baseLocale), blocked, !blocked);
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
  const interrupted = cancellation?.signal.reason instanceof CommandInterruptedError ? cancellation.signal.reason : undefined;
  const writtenFiles = error instanceof TranslationApplyError || error instanceof ReviewApprovalWriteError || error instanceof CommandInterruptedError || error instanceof CatalogOutputError
    ? error.writtenFiles : interrupted ? [] : undefined;
  if (json) console.log(JSON.stringify({ format: 'saylo-command-error/v1', error: { message,
    ...(writtenFiles ? { writtenFiles } : {}), ...(interrupted ? { cancelled: true, signal: interrupted.signalName } : {}) } }));
  else console.error(`[saylo] ${message}${writtenFiles ? `\nAlready written: ${writtenFiles.join(', ') || '(none)'}` : ''}${interrupted ? '' : '\nRun saylo --help for options.'}`);
  process.exitCode = interrupted?.exitCode ?? 2;
} finally { cancellation?.dispose(); }
