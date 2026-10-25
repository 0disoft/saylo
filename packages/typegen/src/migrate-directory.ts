import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { assertSafePath } from './catalog-io.js';
import { CatalogOutputError, writeCatalogOutput } from './catalog-output.js';
import { migrateI18next } from './migrate-i18next.js';
import type { MigrationIssue } from './migrate-i18next.js';

export interface DirectoryMigrationIssue {
  readonly code: string;
  readonly file?: string;
  readonly message: string;
}

export interface DirectoryMigrationFile {
  readonly locale: string;
  readonly localeDirectory: string;
  readonly namespace: string;
  readonly sourceFile: string;
  readonly targetFile: string;
  readonly sourceHash: string;
  readonly catalogHash: string | null;
  readonly blocked: boolean;
  readonly catalog: Readonly<Record<string, string>> | null;
  readonly issues: readonly MigrationIssue[];
  readonly mappings: readonly { readonly sourceKeys: readonly string[]; readonly targetKey: string }[];
}

export interface DirectoryMigrationCheckpointEntry {
  readonly sourceFile: string;
  readonly targetFile: string;
  readonly sourceHash: string;
  readonly catalogHash: string | null;
  readonly status: 'ready' | 'blocked' | 'written';
}

export interface DirectoryMigrationCheckpoint {
  readonly format: 'saylo-directory-checkpoint/v1';
  readonly entries: readonly DirectoryMigrationCheckpointEntry[];
}

export interface DirectoryMigrationPlan {
  readonly format: 'saylo-directory-migration/v1';
  readonly from: 'i18next-json-v4';
  readonly fromDir: string;
  readonly outDir: string;
  readonly dryRun: true;
  readonly blocked: boolean;
  readonly files: readonly DirectoryMigrationFile[];
  readonly issues: readonly DirectoryMigrationIssue[];
  readonly checkpoint: DirectoryMigrationCheckpoint;
  readonly writtenFiles: readonly string[];
}

export interface DirectoryMigrationReport extends Omit<DirectoryMigrationPlan, 'dryRun'> {
  readonly dryRun: false;
  readonly checkpoint: DirectoryMigrationCheckpoint;
  readonly writtenFiles: readonly string[];
}

export interface DirectoryMigrationOptions {
  readonly fromDir: string;
  readonly outDir: string;
  readonly escapeValue?: false;
  readonly signal?: AbortSignal;
}

export interface DirectoryMigrationApplyOptions {
  readonly signal?: AbortSignal;
  readonly write?: typeof writeCatalogOutput;
}

export class DirectoryMigrationApplyError extends CatalogOutputError {
  constructor(message: string, writtenFiles: readonly string[], cause: unknown,
    readonly report: DirectoryMigrationReport) {
    super(message, writtenFiles, cause);
  }
}

function hash(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return Boolean(relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function fileIssue(code: string, file: string, message: string): DirectoryMigrationIssue {
  return { code, file, message };
}

async function assertRootDirectory(value: string, label: string): Promise<string> {
  const resolved = path.resolve(value);
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(label + ' must be an existing, non-symlink directory.');
  const actual = await realpath(resolved);
  if (path.relative(resolved, actual)) throw new Error(label + ' must not traverse a symlink or junction.');
  return actual;
}

function catalogText(catalog: Readonly<Record<string, string>>): string {
  return JSON.stringify(catalog, null, 2) + '\n';
}

async function outputIssue(outDir: string, targetFile: string): Promise<DirectoryMigrationIssue | undefined> {
  if (!inside(outDir, targetFile)) return fileIssue('TARGET_OUTSIDE_ROOT', targetFile, 'Target path escapes --out-dir.');
  const directory = path.dirname(targetFile);
  try {
    assertSafePath(outDir, targetFile);
  } catch (error) {
    return fileIssue('UNSAFE_OUTPUT_PATH', targetFile, error instanceof Error ? error.message : String(error));
  }
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      return fileIssue('UNSAFE_OUTPUT_DIRECTORY', directory, 'Output locale path must be a non-symlink directory.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return fileIssue('OUTPUT_CHECK', directory,
      error instanceof Error ? error.message : String(error));
  }
  try {
    await lstat(targetFile);
    return fileIssue('TARGET_EXISTS', targetFile, 'Output already exists; directory migration never overwrites files.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return fileIssue('OUTPUT_CHECK', targetFile,
      error instanceof Error ? error.message : String(error));
  }
  return undefined;
}

function emptyFile(locale: string, localeDirectory: string, namespace: string, sourceFile: string,
  targetFile: string, source: string, issues: readonly MigrationIssue[]): DirectoryMigrationFile {
  return {
    locale, localeDirectory, namespace, sourceFile, targetFile, sourceHash: hash(source), catalogHash: null,
    blocked: true, catalog: null, issues, mappings: [],
  };
}

/** Read and validate every directory input before any output path is written. */
export async function planDirectoryMigration(options: DirectoryMigrationOptions): Promise<DirectoryMigrationPlan> {
  const fromDir = await assertRootDirectory(options.fromDir, '--from-dir');
  const outDir = await assertRootDirectory(options.outDir, '--out-dir');
  const issues: DirectoryMigrationIssue[] = [];
  const sources: { localeDirectory: string; namespace: string; sourceFile: string }[] = [];
  const localeNames = new Map<string, string>();
  const targetNames = new Map<string, string>();

  const localeEntries = (await readdir(fromDir, { withFileTypes: true }))
    .filter(entry => !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const localeEntry of localeEntries) {
    const localePath = path.join(fromDir, localeEntry.name);
    if (localeEntry.isSymbolicLink()) {
      issues.push(fileIssue('UNSAFE_SYMLINK', localePath, 'Directory migration refuses symbolic links and junctions.'));
      continue;
    }
    if (!localeEntry.isDirectory()) {
      issues.push(fileIssue('INVALID_LAYOUT', localePath, 'Expected <from-dir>/<locale>/<namespace>.json.'));
      continue;
    }
    const namespaceEntries = (await readdir(localePath, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const namespaceEntry of namespaceEntries) {
      const sourceFile = path.join(localePath, namespaceEntry.name);
      if (namespaceEntry.isSymbolicLink()) {
        issues.push(fileIssue('UNSAFE_SYMLINK', sourceFile, 'Directory migration refuses symbolic links and junctions.'));
        continue;
      }
      if (namespaceEntry.isDirectory()) {
        issues.push(fileIssue('INVALID_LAYOUT', sourceFile, 'Nested directories are not part of the namespace layout.'));
        continue;
      }
      if (!namespaceEntry.isFile() || path.extname(namespaceEntry.name) !== '.json') continue;
      const namespace = path.basename(namespaceEntry.name, '.json');
      if (!namespace || namespace.includes(':')) {
        issues.push(fileIssue('INVALID_NAMESPACE', sourceFile, 'Namespace file names must be nonempty and cannot contain colons.'));
        continue;
      }
      sources.push({ localeDirectory: localeEntry.name, namespace, sourceFile });
    }
  }
  if (!sources.length) issues.push({ code: 'NO_INPUT_FILES', message: 'No <locale>/<namespace>.json inputs were found.' });

  const files: DirectoryMigrationFile[] = [];
  for (const source of sources) {
    options.signal?.throwIfAborted();
    let sourceText = '';
    try { sourceText = await readFile(source.sourceFile, 'utf8'); }
    catch (error) {
      issues.push(fileIssue('READ_FAILED', source.sourceFile, error instanceof Error ? error.message : String(error)));
      files.push(emptyFile(source.localeDirectory, source.localeDirectory, source.namespace, source.sourceFile,
        path.join(outDir, source.localeDirectory, source.namespace + '.json'), '',
        [{ code: 'READ_FAILED', key: '', message: 'Input could not be read.' }]));
      continue;
    }
    let canonicalLocale = source.localeDirectory;
    try {
      const canonical = Intl.getCanonicalLocales(source.localeDirectory)[0];
      if (!canonical) throw new Error('Locale directory must be a BCP 47 locale.');
      canonicalLocale = canonical;
      const previous = localeNames.get(canonical);
      if (previous && previous !== source.localeDirectory)
        issues.push(fileIssue('LOCALE_COLLISION', source.localeDirectory,
          'Locale directories ' + previous + ' and ' + source.localeDirectory + ' canonicalize to ' + canonical + '.'));
      else localeNames.set(canonical, source.localeDirectory);
    } catch (error) {
      issues.push(fileIssue('INVALID_LOCALE', source.localeDirectory, error instanceof Error ? error.message : String(error)));
    }
    const targetFile = path.join(outDir, source.localeDirectory, source.namespace + '.json');
    const targetKey = process.platform === 'win32' ? targetFile.toLowerCase() : targetFile;
    const previousTarget = targetNames.get(targetKey);
    if (previousTarget && previousTarget !== source.sourceFile)
      issues.push(fileIssue('TARGET_COLLISION', targetFile, 'Two inputs target the same output file.'));
    targetNames.set(targetKey, source.sourceFile);
    const targetProblem = await outputIssue(outDir, targetFile);
    if (targetProblem) issues.push(targetProblem);
    try {
      const result = migrateI18next(sourceText, {
        locale: canonicalLocale, namespace: source.namespace,
        ...(options.escapeValue === false ? { escapeValue: false } : {}),
      });
      const catalog = result.catalog as Readonly<Record<string, string>> | null;
      files.push({
        locale: result.locale, localeDirectory: source.localeDirectory, namespace: result.namespace,
        sourceFile: source.sourceFile, targetFile, sourceHash: hash(sourceText),
        catalogHash: catalog ? hash(catalogText(catalog)) : null,
        blocked: result.blocked || Boolean(targetProblem), catalog,
        issues: result.issues, mappings: result.mappings,
      });
    } catch (error) {
      files.push(emptyFile(canonicalLocale, source.localeDirectory, source.namespace, source.sourceFile, targetFile,
        sourceText, [{ code: 'CATALOG_PARSE', key: '', message: error instanceof Error ? error.message : String(error) }]));
    }
  }
  const blocked = issues.length > 0 || files.some(file => file.blocked);
  return {
    format: 'saylo-directory-migration/v1', from: 'i18next-json-v4', fromDir, outDir,
    dryRun: true, blocked, files, issues,
    checkpoint: { format: 'saylo-directory-checkpoint/v1', entries: files.map(file => ({
      sourceFile: file.sourceFile, targetFile: file.targetFile, sourceHash: file.sourceHash,
      catalogHash: file.catalogHash, status: file.blocked ? 'blocked' : 'ready',
    })) },
    writtenFiles: [],
  };
}

async function assertSourcesCurrent(plan: DirectoryMigrationPlan, signal?: AbortSignal): Promise<void> {
  for (const file of plan.files) {
    signal?.throwIfAborted();
    const info = await lstat(file.sourceFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Input changed type after preflight: ' + file.sourceFile);
    if (hash(await readFile(file.sourceFile, 'utf8')) !== file.sourceHash)
      throw new Error('Input changed after preflight: ' + file.sourceFile);
  }
}

async function ensureOutputDirectories(plan: DirectoryMigrationPlan): Promise<readonly string[]> {
  const created: string[] = [];
  const directories = [...new Set(plan.files.map(file => path.dirname(file.targetFile)))].sort();
  for (const directory of directories) {
    assertSafePath(plan.outDir, path.join(directory, '.probe'));
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Output locale path is not a safe directory: ' + directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { await mkdir(directory); created.push(directory); }
      catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError; }
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Output locale path is not a safe directory: ' + directory);
    }
  }
  return created;
}

function reportFor(plan: DirectoryMigrationPlan, writtenFiles: readonly string[]): DirectoryMigrationReport {
  return {
    ...plan, dryRun: false, writtenFiles,
    checkpoint: { ...plan.checkpoint, entries: plan.checkpoint.entries.map(entry => ({
      ...entry, status: writtenFiles.includes(entry.targetFile) ? 'written' as const : entry.status,
    })) },
  };
}

/** Write all catalogs after a fresh preflight; per-file commits are reported if a later write fails. */
export async function applyDirectoryMigration(plan: DirectoryMigrationPlan,
  options: DirectoryMigrationApplyOptions = {}): Promise<DirectoryMigrationReport> {
  if (plan.blocked) throw new Error('Cannot apply a blocked directory migration.');
  const outDir = await assertRootDirectory(plan.outDir, '--out-dir');
  const lockFile = path.join(outDir, '.saylo-migrate.lock');
  assertSafePath(outDir, lockFile);
  const writtenFiles: string[] = [];
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let created: readonly string[] = [];
  let failed = false, failure: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    options.signal?.throwIfAborted();
    try { lock = await open(lockFile, 'wx', 0o600); }
    catch (cause) { throw new Error('Cannot acquire directory migration lock: ' + lockFile + '. Verify its owner has stopped before removing a stale lock.', { cause }); }
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    await assertSourcesCurrent(plan, options.signal);
    for (const file of plan.files) {
      const problem = await outputIssue(outDir, file.targetFile);
      if (problem) throw new Error(problem.message + ' ' + (problem.file ?? file.targetFile));
    }
    created = await ensureOutputDirectories(plan);
    const sourceFiles = plan.files.map(file => file.sourceFile);
    for (const file of plan.files) {
      options.signal?.throwIfAborted();
      try {
        writtenFiles.push(...await (options.write ?? writeCatalogOutput)(file.targetFile, file.catalog!, {
          protectedFiles: sourceFiles, ...(options.signal === undefined ? {} : { signal: options.signal }),
        }));
      } catch (error) {
        if (error instanceof CatalogOutputError)
          for (const written of error.writtenFiles) if (!writtenFiles.includes(written)) writtenFiles.push(written);
        throw error;
      }
    }
  } catch (error) { failed = true; failure = error; }
  if (lock) {
    try { await lock.close(); } catch (error) { cleanupErrors.push(error); }
    try { await rm(lockFile, { force: true }); } catch (error) { cleanupErrors.push(error); }
  }
  if (failed) for (const directory of [...created].reverse()) try { await rmdir(directory); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) cleanupErrors.push(error); }
  if (failed || cleanupErrors.length) {
    const cause = cleanupErrors.length ? new AggregateError([...(failed ? [failure] : []), ...cleanupErrors],
      'Directory migration cleanup failed') : failure;
    throw new DirectoryMigrationApplyError('Directory migration failed: ' +
      (failure instanceof Error ? failure.message : 'Resource cleanup failed'), writtenFiles, cause, reportFor(plan, writtenFiles));
  }
  return reportFor(plan, writtenFiles);
}
