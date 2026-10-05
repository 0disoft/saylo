import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type WriteResult = 'written' | 'unchanged' | 'cancelled';
export function isGeneratedFile(outFile: string, file: string): boolean {
  const target = path.resolve(outFile);
  const current = path.resolve(file);
  return current === target || (path.dirname(current) === path.dirname(target)
    && path.basename(current).startsWith(`.${path.basename(target)}.saylo-typegen-`) && current.endsWith('.tmp'));
}

/** A completed file is swapped into place only if this generation is still current. */
export async function writeGenerated(outFile: string, source: string, isCurrent: () => boolean = () => true): Promise<WriteResult> {
  if (!isCurrent()) return 'cancelled';
  const target = path.resolve(outFile);
  if (!target.endsWith('.d.ts')) throw new Error('typegen outFile must end in .d.ts.');
  let existing: string | undefined;
  try { existing = await readFile(target, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!isCurrent()) return 'cancelled';
  if (existing === source) return 'unchanged';
  await mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.saylo-typegen-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, source, { encoding: 'utf8', flag: 'wx' });
    if (!isCurrent()) return 'cancelled';
    await rename(temp, target);
    return 'written';
  } finally { await rm(temp, { force: true }); }
}
