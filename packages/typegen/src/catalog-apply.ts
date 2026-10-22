import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { mkdir, open, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { replaceGenerated } from './replace.js';
import { assertSafePath, assertCurrent } from './catalog-io.js';
import type { TranslationImportPlan, TranslationImportReport } from './catalog-import.js';

/** Atomic per file, not a multi-file transaction. Always report commits made before an I/O failure. */
export class TranslationApplyError extends Error {
  constructor(message: string, readonly writtenFiles: readonly string[], cause: unknown) { super(message, { cause }); }
}

export interface TranslationApplyOptions {
  readonly signal?: AbortSignal;
  readonly replace?: typeof replaceGenerated;
}

/** The root lock serializes Saylo imports; byte checks detect edits by non-cooperating editors. */
export async function applyTranslationImport(plan: TranslationImportPlan, options: TranslationApplyOptions = {}): Promise<TranslationImportReport> {
  if (plan.report.blocked) throw new Error('Cannot apply a blocked translation import.');
  if (!plan.files.length) return { ...plan.report, dryRun: false };
  const writtenFiles: string[] = [], temps = new Set<string>(), directories = new Set<string>();
  const guards = new Map(plan.guards.map(guard => [guard.file, guard]));
  const staged: { temp: string; index: number }[] = [];
  const lockFile = path.join(plan.root, '.saylo-import.lock');
  assertSafePath(plan.root, lockFile);
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let failed = false, failure: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    options.signal?.throwIfAborted();
    try { lock = await open(lockFile, 'wx', 0o600); }
    catch (cause) { throw new Error(`Cannot acquire import lock: ${lockFile}. Verify its owner has stopped before removing a stale lock.`, { cause }); }
    options.signal?.throwIfAborted();
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    assertCurrent(plan.root, plan.guards, options.signal);
    for (const [index, file] of plan.files.entries()) {
      options.signal?.throwIfAborted();
      const directory = path.dirname(file.file);
      try { await mkdir(directory); directories.add(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      options.signal?.throwIfAborted();
      assertSafePath(plan.root, file.file);
      const temp = path.join(directory, `.${path.basename(file.file)}.saylo-import-${randomUUID()}.tmp`);
      const mode = file.source === null ? 0o666 : lstatSync(file.file).mode & 0o777;
      const handle = await open(temp, 'wx', mode);
      temps.add(temp);
      const errors: unknown[] = [];
      try { options.signal?.throwIfAborted(); await handle.writeFile(file.nextSource); } catch (error) { errors.push(error); }
      try { await handle.close(); } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Import staging and handle cleanup failed', { cause: errors[0] });
      staged.push({ temp, index });
    }
    assertCurrent(plan.root, plan.guards, options.signal);
    for (const { temp, index } of staged) {
      const file = plan.files[index]!;
      const current = () => { assertCurrent(plan.root, [guards.get(file.baseFile)!, file], options.signal); return true; };
      if (await (options.replace ?? replaceGenerated)(temp, file.file, current, undefined, options.signal) !== 'written')
        throw new Error(`Translation import cancelled before committing ${file.sourceName}`);
      temps.delete(temp);
      writtenFiles.push(file.sourceName);
    }
  } catch (error) { failed = true; failure = error; }
  for (const temp of temps) try { await rm(temp, { force: true }); } catch (error) { cleanupErrors.push(error); }
  for (const directory of [...directories].reverse()) try { await rmdir(directory); }
  catch (error) { if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) cleanupErrors.push(error); }
  if (lock) {
    try { await lock.close(); } catch (error) { cleanupErrors.push(error); }
    try { await rm(lockFile); } catch (error) { cleanupErrors.push(error); }
  }
  if (failed || cleanupErrors.length) {
    const cause = cleanupErrors.length ? new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Import cleanup failed') : failure;
    throw new TranslationApplyError(`Translation import failed: ${failure instanceof Error ? failure.message : 'Resource cleanup failed'}`, writtenFiles, cause);
  }
  return { ...plan.report, dryRun: false, writtenFiles };
}
