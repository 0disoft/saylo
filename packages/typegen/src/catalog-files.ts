import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseCatalog } from '@0disoft/saylo-core';
import type { CatalogOptions, ParsedCatalog } from '@0disoft/saylo-core';
import { mapFileTasks } from './file-tasks.js';
export { mapFileTasks, FileTaskQueue, FILE_IO_CONCURRENCY } from './file-tasks.js';

export interface CatalogFile {
  readonly file: string;
  readonly source: string;
  readonly catalog: ParsedCatalog;
}

/** Only direct locale/namespace JSON files are owned by Saylo. */
export function catalogLocation(root: string, file: string): { locale: string; namespace: string } | undefined {
  const parts = path.relative(root, path.resolve(file)).split(path.sep);
  if (parts.length !== 2 || parts.some(part => !part || part.startsWith('.')) || !parts[1]!.endsWith('.json')) return;
  return { locale: parts[0]!, namespace: parts[1]!.slice(0, -5) };
}

export async function assertInside(root: string, file: string): Promise<void> {
  const relative = path.relative(root, await realpath(file));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Catalog path escapes locales root: ${file}`);
  }
}

export async function readCatalogFile(root: string, file: string, locale: string, namespace: string, read: () => string | Promise<string> = () => readFile(file, 'utf8'), previous?: ParsedCatalog,
  options: Pick<CatalogOptions, 'richText'> = {}): Promise<CatalogFile> {
  await assertInside(root, file);
  const source = await read();
  const catalog = parseCatalog(source, { ...options, locale, namespace, sourceName: path.relative(root, file).split(path.sep).join('/') }, previous);
  return { file, source, catalog };
}

export async function scanCatalogs(directory: string, richText?: Readonly<Record<string, NonNullable<CatalogOptions['richText']>>>): Promise<{ root: string; files: CatalogFile[] }> {
  const root = await realpath(directory);
  const files: CatalogFile[] = [];
  const locales = new Set<string>();
  const directories = await readdir(root, { withFileTypes: true });
  directories.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of directories) {
    if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
    const directory = path.join(root, entry.name);
    await assertInside(root, directory);
    if (!(await stat(directory)).isDirectory()) continue;
    const locale = Intl.getCanonicalLocales(entry.name)[0];
    if (!locale) throw new Error(`Invalid locale directory: ${entry.name}`);
    if (locales.has(locale)) throw new Error(`Duplicate canonical locale directory: ${entry.name}`);
    locales.add(locale);
    const names = (await readdir(directory)).sort().filter(name => !name.startsWith('.') && name.endsWith('.json'));
    const loaded = await mapFileTasks(names, async name => {
      const file = path.join(directory, name);
      if (!(await stat(file)).isFile()) throw new Error(`Catalog is not a file: ${file}`);
      const namespace = name.slice(0, -5);
      return readCatalogFile(root, file, locale, namespace, undefined, undefined,
        { richText: richText && Object.hasOwn(richText, namespace) ? richText[namespace] : undefined });
    });
    for (const file of loaded) files.push(file);
  }
  return { root, files };
}
