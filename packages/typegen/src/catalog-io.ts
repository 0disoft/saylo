import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { ImportGuard } from './catalog-import.js';

export function assertSafePath(root: string, file: string): void {
  const relative = path.relative(root, file);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`) ||
      path.relative(root, realpathSync(root))) throw new Error(`Import path escapes catalog root: ${file}`);
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`Import refuses a symlink or junction: ${current}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}
export function assertCurrent(root: string, guards: readonly ImportGuard[], signal?: AbortSignal): void {
  signal?.throwIfAborted();
  for (const guard of guards) {
    assertSafePath(root, guard.file);
    let current: string | null;
    try { current = readFileSync(guard.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; current = null; }
    if (current !== guard.source) throw new Error(`Catalog changed during import: ${guard.file}`);
  }
}
