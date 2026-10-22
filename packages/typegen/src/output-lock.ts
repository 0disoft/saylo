import { mkdirSync, realpathSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { rm, rmdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';

export interface OutputLock {
  readonly target: string;
  readonly active: boolean;
  release(): Promise<void>;
}

function canonicalTarget(outFile: string): string {
  const resolved = path.resolve(outFile);
  const target = path.join(realpathSync(path.dirname(resolved)), path.basename(resolved));
  return process.platform === 'win32' ? target.toLowerCase() : target;
}

export function assertOutputLock(lock: OutputLock, outFile: string): void {
  if (!lock.active || lock.target !== canonicalTarget(outFile)) throw new Error('Typegen output lock is inactive or belongs to another file.');
}

/** Fail closed on contention: never queue a precomputed schema behind another writer. */
export function acquireOutputLock(outFile: string): OutputLock {
  const resolved = path.resolve(outFile);
  if (!resolved.endsWith('.d.ts')) throw new Error('typegen outFile must end in .d.ts.');
  mkdirSync(path.dirname(resolved), { recursive: true });
  const target = canonicalTarget(resolved);
  const directory = path.join(path.dirname(target), `.${path.basename(target)}.saylo-typegen.lock`);
  try { mkdirSync(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error;
    throw Object.assign(new Error(`Typegen output is locked: ${target}. Stop its generator before retrying. After a forced process exit, verify the owner in ${directory} is no longer running before removing that lock.`), { code: 'OUTPUT_LOCKED' });
  }
  let active = true;
  let releasing: Promise<void> | undefined;
  const lock: OutputLock = {
    target, get active() { return active; },
    release() {
      active = false;
      return releasing ??= (async () => {
        try { await rm(path.join(directory, 'owner.json'), { force: true }); }
        finally {
          try { await rmdir(directory); }
          catch (error) { if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error; }
        }
      })();
    },
  };
  try { writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname(), target })); }
  catch (error) {
    try { rmSync(path.join(directory, 'owner.json'), { force: true }); rmdirSync(directory); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Typegen lock creation and cleanup failed.', { cause: error }); }
    throw error;
  }
  return lock;
}

export async function withOutputLock<T>(outFile: string, action: (lock: OutputLock) => Promise<T>,
  acquire: (outFile: string) => OutputLock = acquireOutputLock): Promise<T> {
  const lock = acquire(outFile);
  let failed = false, failure: unknown;
  try { return await action(lock); }
  catch (error) { failed = true; failure = error; throw error; }
  finally {
    try { await lock.release(); }
    catch (error) {
      if (failed) throw new AggregateError([failure, error], 'Typegen operation and lock cleanup failed.', { cause: failure });
      throw error;
    }
  }
}
