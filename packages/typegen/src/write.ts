import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { replaceGenerated } from './replace.js';

export type WriteResult = 'written' | 'unchanged' | 'cancelled';
interface TemporaryFile { writeFile(source: string): Promise<void>; close(): Promise<void> }

export interface WriteOperations {
  readonly read: (file: string) => Promise<string>;
  readonly mkdir: (directory: string) => Promise<unknown>;
  readonly create: (file: string) => Promise<TemporaryFile>;
  readonly remove: (file: string) => Promise<void>;
  readonly replace: (temp: string, target: string, isCurrent: () => boolean, signal?: AbortSignal) => Promise<'written' | 'cancelled'>;
  readonly createId: () => string;
}
export interface WriteOptions {
  readonly signal?: AbortSignal;
  readonly operations?: Partial<WriteOperations>;
}
const defaults: WriteOperations = {
  read: file => readFile(file, 'utf8'), mkdir: directory => mkdir(directory, { recursive: true }),
  create: file => open(file, 'wx'), remove: file => rm(file, { force: true }), createId: randomUUID,
  replace: (temp, target, isCurrent, signal) => replaceGenerated(temp, target, isCurrent, undefined, signal),
};
export function isGeneratedFile(outFile: string, file: string): boolean {
  const target = path.resolve(outFile);
  const current = path.resolve(file);
  return current === target || (path.dirname(current) === path.dirname(target)
    && path.basename(current).startsWith(`.${path.basename(target)}.saylo-typegen-`) && current.endsWith('.tmp'));
}

/** A completed file is swapped into place only if this generation is still current. */
export async function writeGenerated(outFile: string, source: string, isCurrent: () => boolean = () => true,
  options: WriteOptions = {}): Promise<WriteResult> {
  const current = () => !options.signal?.aborted && isCurrent();
  if (!current()) return 'cancelled';
  const operations = { ...defaults, ...options.operations };
  const target = path.resolve(outFile);
  if (!target.endsWith('.d.ts')) throw new Error('typegen outFile must end in .d.ts.');
  let existing: string | undefined;
  try { existing = await operations.read(target); }
  catch (error) { if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error; }
  if (!current()) return 'cancelled';
  if (existing === source) return 'unchanged';
  await operations.mkdir(path.dirname(target));
  if (!current()) return 'cancelled';
  const identity = operations.createId();
  if (typeof identity !== 'string' || !/^[a-zA-Z0-9-]+$/.test(identity)) throw new Error('Invalid typegen temporary file identity.');
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.saylo-typegen-${identity}.tmp`);
  let handle: TemporaryFile | undefined, owned = false, failed = false;
  let failure: unknown, result: WriteResult = 'cancelled';
  try {
    handle = await operations.create(temp); owned = true;
    if (current()) await handle.writeFile(source);
    await handle.close(); handle = undefined;
    if (current()) result = await operations.replace(temp, target, current, options.signal);
  } catch (error) { failed = true; failure = error; }
  // Exclusive creation establishes ownership even if the following write fails.
  // A successful rename already removed the temp and is the commit point.
  if (handle) {
    try { await handle.close(); } catch (error) { if (!failed) { failed = true; failure = error; } }
  }
  if (owned && result !== 'written') {
    try { await operations.remove(temp); } catch (error) { if (!failed) { failed = true; failure = error; } }
  }
  if (failed) throw failure;
  return result;
}
