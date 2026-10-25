#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { catalogHelp, CatalogUsageError, parseCatalogArguments } from './catalog-cli-options.js';
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
import { CatalogOutputError, writeCatalogOutput, writeCatalogTextOutput } from './catalog-output.js';
import { InitApplyError } from './init-error.js';
import { readTranslationMetadata } from './translation-metadata.js';
import { serializeTranslationPo } from './catalog-po.js';
import type { TranslationWorkfile } from './catalog-workfile.js';

let json = process.argv.includes('--json');
let cancellation: ReturnType<typeof createCliCancellation> | undefined;

function printCheckReport(report: CatalogCheckReport): string {
  const lines = report.diagnostics.map(issue => `${issue.severity} ${issue.code} ${issue.sourceName}${issue.id === undefined ? '' : ` [${issue.id}]`}: ${issue.message}`);
  lines.push(`[saylo:check] ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`);
  if (report.reviewTracking === 'not-configured') lines.push('Source change review is unavailable without --baseline or --reviews.');
  return lines.join('\n');
}

async function runCatalog(args: readonly string[]): Promise<void> {
  const invocation = parseCatalogArguments(args);
  const { values } = invocation;
  json = values.json ?? false;
  if (invocation.kind === 'help') console.log(catalogHelp);
  else {
    const { command, writesFiles } = invocation;
    if (writesFiles) cancellation = createCliCancellation();
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
    if (command === 'approve' && !config.reviews) throw new CatalogUsageError('approve requires --reviews <file.json> or config.reviews.');
    const baseline = !['snapshot', 'import', 'approve'].includes(command) && config.baseline ? await readReviewBaseline(config.baseline, config.baseLocale) : undefined;
    const inspected = await inspectProject(config);
    const compared = baseline ? compareReviewBaseline(inspected.inspection, inspected.report, baseline) : inspected.report;
    const approvals = ['check', 'sync', 'export', 'approve', 'refresh'].includes(command) && config.reviews
      ? await readReviewApprovals(config.reviews, config.baseLocale, ['export', 'approve', 'refresh'].includes(command)) : undefined;
    const report = approvals && command !== 'approve' ? applyReviewApprovals(inspected.inspection, compared, approvals.approvals) : compared;
    const metadata = values.metadata === undefined ? undefined : await readTranslationMetadata(values.metadata);
    const workOptions = { withContext: values['with-context'] === true, ...(metadata ? { metadata } : {}) };
    cancellation?.throwIfCancelled();
    const emitJson = async (value: unknown, blocked: boolean, canSave: boolean) => {
      const po = command === 'export' && values.format === 'po' && canSave;
      const output = po ? serializeTranslationPo(value as TranslationWorkfile) : value;
      if (values['out-file'] === undefined || !canSave) { cancellation?.throwIfCancelled(); console.log(po ? output : JSON.stringify(output)); return; }
      const protectedFiles = [filename, values.file, values.metadata, command === 'snapshot' ? undefined : config.baseline, approvals?.file]
        .filter((file): file is string => file !== undefined);
      const writtenFiles = await (po ? writeCatalogTextOutput : writeCatalogOutput)(values['out-file'], output as string,
        { localesDir: config.localesDir, protectedFiles, signal: cancellation!.signal });
      cancellation!.throwIfCancelled(writtenFiles);
      console.log(JSON.stringify({ format: 'saylo-file-output/v1', command, writtenFiles, blocked }));
    };
    if (command === 'refresh') {
      const work = await readTranslationWorkfile(values.file!, config.baseLocale);
      const result = refreshTranslationWorkfile(inspected.inspection, report, work, workOptions);
      await emitJson(result, result.blocked, result.workfile !== null);
      process.exitCode = result.blocked ? 1 : 0;
    } else if (command === 'approve') {
      const work = await readTranslationWorkfile(values.file!, config.baseLocale);
      cancellation?.throwIfCancelled();
      const plan = planReviewApproval(inspected.inspection, report, work, approvals!, values.reviewer === undefined ? {} : {
        reviewer: values.reviewer, reviewedAt: values['reviewed-at'] ?? new Date().toISOString() });
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
      await emitJson(plan.blocked ? report : createTranslationWorkfile(inspected.inspection, report, workOptions), plan.blocked, !plan.blocked);
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
}

try {
  const args = process.argv.slice(2);
  if (args[0] === 'init') await (await import('./init-cli.js')).runInit(args.slice(1));
  else if (args[0] === 'migrate') await (await import('./migrate-cli.js')).runMigration(args.slice(1));
  else if (args[0] === 'review') await (await import('./review-cli.js')).runReview(args.slice(1));
  else await runCatalog(args);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const interrupted = error instanceof CommandInterruptedError ? error
    : cancellation?.signal.reason instanceof CommandInterruptedError ? cancellation.signal.reason : undefined;
  const writtenFiles = error instanceof TranslationApplyError || error instanceof ReviewApprovalWriteError || error instanceof CommandInterruptedError || error instanceof CatalogOutputError || error instanceof InitApplyError
    ? error.writtenFiles : interrupted ? [] : undefined;
  if (json) console.log(JSON.stringify({ format: 'saylo-command-error/v1', error: { message,
    ...(writtenFiles ? { writtenFiles } : {}), ...(interrupted ? { cancelled: true, signal: interrupted.signalName } : {}) } }));
  else console.error(`[saylo] ${message}${writtenFiles ? `\nAlready written: ${writtenFiles.join(', ') || '(none)'}` : ''}${interrupted ? '' : '\nRun saylo --help for options.'}`);
  process.exitCode = interrupted?.exitCode ?? 2;
} finally { cancellation?.dispose(); }
