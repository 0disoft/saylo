import { parseArgs } from 'node:util';

export const catalogHelp = `Usage: saylo <check|sync|snapshot|export|import|approve|refresh> [--config saylo.config.json] [--json]

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
export class CatalogUsageError extends Error {}

const commands = ['check', 'sync', 'snapshot', 'export', 'import', 'approve', 'refresh'] as const;
export type CatalogCommand = typeof commands[number];

/** Validate usage before config/catalog I/O, preserving the command error precedence. */
export function parseCatalogArguments(args: readonly string[]) {
  const { values, positionals } = parseArgs({ args: [...args], allowPositionals: true, options: {
    config: { type: 'string' }, 'locales-dir': { type: 'string' }, 'base-locale': { type: 'string' },
    locales: { type: 'string' }, json: { type: 'boolean' }, diff: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    baseline: { type: 'string' }, reviews: { type: 'string' }, 'dry-run': { type: 'boolean' },
    file: { type: 'string' }, apply: { type: 'boolean' }, 'with-context': { type: 'boolean' }, 'out-file': { type: 'string' },
  } });
  if (values.help) return { kind: 'help' as const, values };
  const command = positionals[0] as CatalogCommand | undefined;
  if (positionals.length !== 1 || !command || !commands.includes(command))
    throw new CatalogUsageError('Choose a command: saylo check, sync --dry-run, snapshot, export, import, approve, or refresh.');
  if (command === 'sync' && !values['dry-run']) throw new CatalogUsageError('sync requires --dry-run; applying changes is not supported.');
  if (values.diff && (command !== 'import' || !values['dry-run'] || values.apply))
    throw new CatalogUsageError('--diff is only supported with import --dry-run.');
  if (values['with-context'] && !['export', 'refresh'].includes(command))
    throw new CatalogUsageError('--with-context is only supported with export or refresh.');
  if (values['out-file'] !== undefined && !['export', 'snapshot', 'refresh'].includes(command))
    throw new CatalogUsageError('--out-file is only supported with export, snapshot or refresh.');
  if (values['out-file'] !== undefined && (!values['out-file'].trim() || !values['out-file'].endsWith('.json')))
    throw new CatalogUsageError('--out-file must name a new .json file.');
  const usesWorkfile = ['import', 'approve'].includes(command);
  if (!['sync', 'import', 'approve'].includes(command) && values['dry-run']) throw new CatalogUsageError('--dry-run is only supported with sync, import or approve.');
  if (usesWorkfile && (!values.file || !!values.apply === !!values['dry-run']))
    throw new CatalogUsageError(`${command} requires --file and exactly one of --dry-run or --apply.`);
  if (command === 'refresh' && !values.file) throw new CatalogUsageError('refresh requires --file.');
  if (!usesWorkfile && values.apply) throw new CatalogUsageError('--apply is only supported with import or approve.');
  if (!usesWorkfile && command !== 'refresh' && values.file !== undefined) throw new CatalogUsageError('--file is only supported with import, approve or refresh.');
  if (usesWorkfile && values.baseline) throw new CatalogUsageError(`${command} uses workfile checkpoints; --baseline is not supported.`);
  if (['import', 'snapshot'].includes(command) && values.reviews) throw new CatalogUsageError('--reviews is supported with check, sync, export, approve or refresh.');
  if (command === 'snapshot' && values.baseline) throw new CatalogUsageError('snapshot prints a new checkpoint; --baseline is a comparison input, not an output path.');
  return { kind: 'command' as const, command, values,
    writesFiles: (usesWorkfile && values.apply === true) || values['out-file'] !== undefined };
}
