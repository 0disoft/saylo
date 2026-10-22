import { randomUUID } from 'node:crypto';
import { link, lstat, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertSafePath } from './catalog-io.js';

export class CatalogOutputError extends Error {
  constructor(message: string, readonly writtenFiles: readonly string[], cause: unknown) { super(message, { cause }); }
}
export interface CatalogOutputOptions {
  readonly localesDir: string;
  readonly protectedFiles?: readonly string[];
  readonly signal?: AbortSignal;
  readonly publish?: typeof link;
}
const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
};

/** Publish a complete new JSON artifact without ever replacing an existing path. */
export async function writeCatalogOutput(filename: string, value: unknown, options: CatalogOutputOptions): Promise<readonly string[]> {
  const writtenFiles: string[] = [];
  let temp: string | undefined, owned = false, failure: unknown, failed = false;
  const cleanupErrors: unknown[] = [];
  try {
    options.signal?.throwIfAborted();
    if (!filename.trim() || !filename.endsWith('.json')) throw new Error('--out-file must name a new .json file.');
    const target = path.resolve(filename), directory = path.dirname(target), parent = await realpath(directory);
    if (path.relative(directory, parent)) throw new Error('Output parent must be an existing, non-symlink directory.');
    const locales = await realpath(options.localesDir);
    if (inside(locales, target) || inside(path.resolve(options.localesDir), target))
      throw new Error('Output must be outside the locales directory.');
    if (options.protectedFiles?.some(file => !path.relative(path.resolve(file), target)))
      throw new Error('Output must not replace an input file.');
    assertSafePath(parent, target);
    try { await lstat(target); throw new Error(`Output already exists: ${target}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const source = JSON.stringify(value, null, 2);
    if (source === undefined) throw new Error('Output must be JSON serializable.');
    options.signal?.throwIfAborted();
    temp = path.join(parent, `.${path.basename(target)}.saylo-output-${randomUUID()}.tmp`);
    const handle = await open(temp, 'wx', 0o666);
    owned = true;
    const errors: unknown[] = [];
    try { options.signal?.throwIfAborted(); await handle.writeFile(source + '\n'); } catch (error) { errors.push(error); }
    try { await handle.close(); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Output staging and handle cleanup failed', { cause: errors[0] });
    options.signal?.throwIfAborted();
    assertSafePath(parent, temp); assertSafePath(parent, target);
    // Same-directory hard link creates the final name exclusively; rename could overwrite a racing writer.
    await (options.publish ?? link)(temp, target);
    writtenFiles.push(target);
  } catch (error) { failed = true; failure = error; }
  if (owned) try { await rm(temp!); } catch (error) { cleanupErrors.push(error); }
  if (failed || cleanupErrors.length) {
    const cause = cleanupErrors.length ? new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Output cleanup failed') : failure;
    throw new CatalogOutputError(`Catalog output failed: ${failure instanceof Error ? failure.message : 'Resource cleanup failed'}`, writtenFiles, cause);
  }
  return writtenFiles;
}
