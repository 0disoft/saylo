import { parseArgs } from 'node:util';
import { CatalogUsageError } from './catalog-cli-options.js';
import { createCliCancellation } from './cli-cancellation.js';
import { planInit } from './init.js';
import { applyInit } from './init-write.js';
import { InitApplyError } from './init-error.js';

const help = `Usage: saylo init [--framework vite|sveltekit] [--base-locale en] [--dry-run | --apply] [--json]

Preview by default. --apply creates catalogs, types, a per-owner store factory,
and connects a static ESM Vite config. Existing integration files are never replaced.
Requires package.json, src/, and one vite.config.ts/mts/js/mjs. Dynamic configs
and config spreads require manual integration. No dependencies are installed;
the result lists package-manager commands and the remaining UI wiring steps.
Each file is published atomically; failures report already written files.
--framework sveltekit adds an isolated /saylo SSR route with context, hydration,
locale selection and persistence. Requires standard src/routes and a server adapter.
The SvelteKit preset is source-only until the next npm release.
Available since 0.1.0-alpha.7. Install @0disoft/saylo-typegen@alpha; latest remains a registration placeholder.`;

export async function runInit(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: {
    'base-locale': { type: 'string' }, 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' },
    framework: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); return; }
  if (values.apply && values['dry-run']) throw new CatalogUsageError('Choose --dry-run or --apply, not both.');
  if (values.framework !== undefined && values.framework !== 'vite' && values.framework !== 'sveltekit')
    throw new CatalogUsageError('init framework must be vite or sveltekit.');
  const plan = planInit(process.cwd(), values['base-locale'],
    values.framework === undefined ? {} : { framework: values.framework });
  const cancellation = values.apply ? createCliCancellation() : undefined;
  try {
    const writtenFiles = values.apply ? await applyInit(plan, cancellation!.signal) : [];
    cancellation?.throwIfCancelled(writtenFiles);
    const report = { format: 'saylo-init/v1', dryRun: !values.apply, changes: plan.changes, writtenFiles, nextSteps: plan.nextSteps };
    console.log(values.json ? JSON.stringify(report) : [
      `[saylo:init] ${report.dryRun ? 'dry-run' : 'applied'}; ${plan.changes.length} planned file(s); ${writtenFiles.length} written.`,
      ...plan.changes.map(change => `${change.before === null ? 'create' : 'update'} ${change.file}`),
      ...plan.nextSteps,
    ].join('\n'));
  } catch (error) {
    cancellation?.throwIfCancelled(error instanceof InitApplyError ? error.writtenFiles : []);
    throw error;
  } finally { cancellation?.dispose(); }
}
