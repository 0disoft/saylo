import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertSafePath, assertCurrent } from './catalog-io.js';
import { replaceGenerated } from './replace.js';
import type { ApprovalPlan, ApprovalReport } from './catalog-approve.js';

export class ReviewApprovalWriteError extends Error {
  constructor(message: string, readonly writtenFiles: readonly string[], cause: unknown) { super(message, { cause }); }
}
export interface ReviewWriteOptions {
  readonly signal?: AbortSignal;
  readonly replace?: typeof replaceGenerated;
}

/** Serialize approvals for this ledger and atomically replace only its JSON, with fresh catalog guards. */
export async function writeReviewApproval(plan: ApprovalPlan, options: ReviewWriteOptions = {}): Promise<ApprovalReport> {
  if (plan.report.blocked) throw new Error('Cannot apply blocked review approval.');
  const absolute = path.resolve(plan.ledger.file), parent = await realpath(path.dirname(absolute));
  if (!absolute.endsWith('.json') || path.relative(path.dirname(absolute), parent))
    throw new Error('Review approvals require a .json path with an existing, non-symlink parent directory.');
  const target = path.join(parent, path.basename(absolute));
  const relative = path.relative(plan.root, target);
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
    throw new Error('Review approvals must be outside the locales directory.');
  assertSafePath(parent, target);
  if (!plan.report.changes.length) return { ...plan.report, dryRun: false };
  const ledgerGuard = [{ file: target, source: plan.ledger.source }];
  const current = () => {
    assertCurrent(plan.root, plan.guards, options.signal);
    assertCurrent(parent, ledgerGuard, options.signal);
    return true;
  };
  const lockFile = path.join(parent, `.${path.basename(target)}.saylo-review.lock`);
  const temp = path.join(parent, `.${path.basename(target)}.saylo-review-${randomUUID()}.tmp`);
  let lock: Awaited<ReturnType<typeof open>> | undefined, owned = false, written = false;
  let failed = false, failure: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    options.signal?.throwIfAborted();
    try { lock = await open(lockFile, 'wx', 0o600); }
    catch (cause) { throw new Error(`Cannot acquire review lock: ${lockFile}. Verify its owner has stopped before removing a stale lock.`, { cause }); }
    options.signal?.throwIfAborted();
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    current();
    const handle = await open(temp, 'wx', plan.ledger.source === null ? 0o666 : lstatSync(target).mode & 0o777);
    owned = true;
    const errors: unknown[] = [];
    try { options.signal?.throwIfAborted(); await handle.writeFile(JSON.stringify(plan.approvals, null, 2) + '\n'); } catch (error) { errors.push(error); }
    try { await handle.close(); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Review staging and cleanup failed', { cause: errors[0] });
    if (await (options.replace ?? replaceGenerated)(temp, target, current, undefined, options.signal) !== 'written')
      throw new Error('Review approval cancelled before commit.');
    written = true;
  } catch (error) { failed = true; failure = error; }
  if (owned && !written) try { await rm(temp, { force: true }); } catch (error) { cleanupErrors.push(error); }
  if (lock) {
    try { await lock.close(); } catch (error) { cleanupErrors.push(error); }
    try { await rm(lockFile); } catch (error) { cleanupErrors.push(error); }
  }
  if (failed || cleanupErrors.length) {
    const cause = cleanupErrors.length ? new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Review cleanup failed') : failure;
    throw new ReviewApprovalWriteError(`Review approval failed: ${failure instanceof Error ? failure.message : 'Resource cleanup failed'}`,
      written ? [target] : [], cause);
  }
  return { ...plan.report, dryRun: false, writtenFiles: [target] };
}
