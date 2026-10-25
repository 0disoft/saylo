import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { link, lstat, mkdir, open, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { assertSafePath } from './catalog-io.js';
import { readInitFile } from './init.js';
import type { InitPlan } from './init.js';
import { InitApplyError } from './init-error.js';

/** Serialize initializers and publish each complete file atomically; report partial progress on failure. */
export async function applyInit(plan: InitPlan, signal?: AbortSignal): Promise<readonly string[]> {
  const writtenFiles: string[] = [];
  const lock = path.join(plan.root, '.saylo-init.lock');
  let locked = false, temp: string | undefined, failure: unknown;
  const errors: unknown[] = [];
  const current = () => {
    signal?.throwIfAborted();
    for (const guard of plan.guards) {
      const expected = writtenFiles.includes(guard.file) ? plan.changes.find(change => change.file === guard.file)!.after : guard.source;
      if (readInitFile(plan.root, guard.file) !== expected) throw new Error(`File changed during init: ${guard.file}. Review the files and rerun the preview.`);
    }
  };
  try {
    signal?.throwIfAborted();
    assertSafePath(plan.root, lock);
    try { mkdirSync(lock); locked = true; }
    catch (cause) { throw new Error(`init is locked at ${lock}. Stop the other initializer before retrying.`, { cause }); }
    current();
    for (const change of plan.changes) {
      const target = path.join(plan.root, change.file);
      current();
      assertSafePath(plan.root, target);
      await mkdir(path.dirname(target), { recursive: true });
      assertSafePath(plan.root, target);
      const staged = path.join(path.dirname(target), `.${path.basename(target)}.saylo-init-${randomUUID()}.tmp`);
      const mode = change.before === null ? undefined : (await lstat(target)).mode & 0o777;
      const handle = await open(staged, 'wx', mode ?? 0o666);
      temp = staged;
      const stagingErrors: unknown[] = [];
      try { if (mode !== undefined) await handle.chmod(mode); await handle.writeFile(change.after); }
      catch (error) { stagingErrors.push(error); }
      try { await handle.close(); } catch (error) { stagingErrors.push(error); }
      if (stagingErrors.length === 1) throw stagingErrors[0];
      if (stagingErrors.length > 1) throw new AggregateError(stagingErrors, 'init staging and close failed', { cause: stagingErrors[0] });
      current();
      assertSafePath(plan.root, target);
      if (change.before === null) await link(staged, target);
      else { await rename(staged, target); temp = undefined; }
      writtenFiles.push(change.file);
      if (temp) { await rm(temp); temp = undefined; }
    }
    signal?.throwIfAborted();
  } catch (error) { failure = error; errors.push(error); }
  if (temp) try { await rm(temp); } catch (error) { errors.push(error); }
  if (locked) try { await rmdir(lock); } catch (error) { errors.push(error); }
  if (errors.length) throw new InitApplyError(
    `init failed: ${failure instanceof Error ? failure.message : 'Resource cleanup failed'}`,
    writtenFiles, errors.length === 1 ? errors[0] : new AggregateError(errors, 'init failed during writing or cleanup'));
  return writtenFiles;
}
