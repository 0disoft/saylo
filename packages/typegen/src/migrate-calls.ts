import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { lstat, open, readFile, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import type { ParserPlugin } from '@babel/parser';
import { assertSafePath } from './catalog-io.js';
import { CatalogOutputError } from './catalog-output.js';
import { replaceGenerated } from './replace.js';

interface AstNode {
  readonly type: string;
  readonly start: number | null;
  readonly end: number | null;
  readonly [key: string]: any;
}

export interface CallRewriteIssue {
  readonly code: string;
  readonly file: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface CallRewriteChange {
  readonly file: string;
  readonly before: string;
  readonly after: string;
  readonly line: number;
  readonly column: number;
}

export interface CallRewriteGuard {
  readonly file: string;
  readonly relativeFile: string;
  readonly before: string;
  readonly after: string;
  readonly sourceHash: string;
}

export interface CallRewriteCheckpoint {
  readonly format: 'saylo-call-rewrite-checkpoint/v1';
  readonly entries: readonly {
    readonly file: string;
    readonly sourceHash: string;
    readonly changeCount: number;
    readonly status: 'ready' | 'written';
  }[];
}

export interface CallRewritePlan {
  readonly format: 'saylo-call-rewrite/v1';
  readonly sourceDir: string;
  readonly namespace: string;
  readonly dryRun: boolean;
  readonly blocked: boolean;
  readonly changes: readonly CallRewriteChange[];
  readonly issues: readonly CallRewriteIssue[];
  readonly checkpoint: CallRewriteCheckpoint;
  readonly writtenFiles: readonly string[];
  readonly guards: readonly CallRewriteGuard[];
}

export interface CallRewriteOptions {
  readonly sourceDir: string;
  readonly namespace: string;
  readonly targets: readonly string[];
  readonly signal?: AbortSignal;
}

export interface CallRewriteApplyOptions {
  readonly signal?: AbortSignal;
  readonly replace?: typeof replaceGenerated;
}

export class CallRewriteApplyError extends CatalogOutputError {
  constructor(message: string, writtenFiles: readonly string[], cause: unknown) {
    super(message, writtenFiles, cause);
  }
}

const skippedDirectories = new Set(['.git', '.next', '.svelte-kit', 'build', 'coverage', 'dist', 'node_modules']);
const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const ignoredNodeKeys = new Set(['comments', 'errors', 'extra', 'innerComments', 'leadingComments', 'loc', 'tokens', 'trailingComments']);
const unsafeCallOptions = new Set([
  'context', 'defaultNS', 'defaultValue', 'escapeValue', 'fallbackKey', 'fallbackLng', 'interpolation',
  'joinArrays', 'keyPrefix', 'keySeparator', 'lng', 'lngs', 'ns', 'nsMode', 'nsSeparator', 'ordinal',
  'postProcess', 'replace', 'returnDetails', 'returnEmptyString', 'returnNull', 'returnObjects',
  'shouldUnescape', 'skipInterpolation', 'tDescription', 'value',
]);

function hash(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function isNode(value: unknown): value is AstNode {
  return Boolean(value) && typeof value === 'object' && typeof (value as AstNode).type === 'string';
}

function walk(value: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit);
    return;
  }
  if (!isNode(value)) return;
  visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (!ignoredNodeKeys.has(key)) walk(child, visit);
  }
}

function patternNames(node: AstNode | undefined, names: string[]): void {
  if (!node) return;
  if (node.type === 'Identifier') {
    names.push(node.name);
    return;
  }
  if (node.type === 'ObjectPattern') {
    for (const property of node.properties as AstNode[]) {
      if (property.type === 'ObjectProperty') patternNames(property.value, names);
      else patternNames(property.argument, names);
    }
    return;
  }
  if (node.type === 'ArrayPattern') {
    for (const element of node.elements as Array<AstNode | null>) patternNames(element ?? undefined, names);
    return;
  }
  if (node.type === 'TSParameterProperty') {
    patternNames(node.parameter, names);
    return;
  }
  if (node.type === 'AssignmentPattern') {
    patternNames(node.left, names);
    return;
  }
  if (node.type === 'RestElement') patternNames(node.argument, names);
}

function importName(node: AstNode): string | undefined {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  return undefined;
}

function location(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const line = before.split(/\r\n|\r|\n/).length;
  const lastBreak = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
  return { line, column: offset - lastBreak };
}
function declarationOffsets(node: AstNode, name: string): number[] {
  const offsets: number[] = [];
  if ((node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier' ||
      node.type === 'ImportNamespaceSpecifier') && node.local?.name === name) {
    offsets.push(node.start ?? 0);
    return offsets;
  }
  if (node.type === 'VariableDeclarator') {
    const names: string[] = [];
    patternNames(node.id, names);
    if (names.includes(name)) offsets.push(node.start ?? 0);
  } else if (['FunctionDeclaration', 'FunctionExpression', 'ClassDeclaration', 'ClassExpression',
    'TSDeclareFunction', 'TSEnumDeclaration', 'TSImportEqualsDeclaration', 'TSModuleDeclaration'].includes(node.type)) {
    if (node.id?.type === 'Identifier' && node.id.name === name) offsets.push(node.start ?? 0);
  }
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod',
    'TSDeclareFunction'].includes(node.type)) {
    for (const parameter of (node.params as AstNode[] | undefined) ?? []) {
      const names: string[] = [];
      patternNames(parameter, names);
      if (names.includes(name)) offsets.push(parameter.start ?? node.start ?? 0);
    }
  } else if (node.type === 'CatchClause') {
    const names: string[] = [];
    patternNames(node.param, names);
    if (names.includes(name)) offsets.push(node.start ?? 0);
  }
  return offsets;
}

function assignsName(node: AstNode, name: string): boolean {
  if (node.type === 'AssignmentExpression') {
    const names: string[] = [];
    patternNames(node.left, names);
    return names.includes(name);
  }
  return node.type === 'UpdateExpression' && node.argument?.type === 'Identifier' && node.argument.name === name;
}

function issueFor(source: string, file: string, offset: number, code: string, message: string): CallRewriteIssue {
  return { code, file, message, ...location(source, offset) };
}

function hookBinding(node: AstNode, useTranslationImported: boolean): { safe: boolean; namespace: string | undefined; offset: number; message?: string } | undefined {
  if (!useTranslationImported || node.type !== 'VariableDeclarator' || node.id?.type !== 'ObjectPattern') return undefined;
  const properties = (node.id.properties as AstNode[]).filter(property =>
    property.type === 'ObjectProperty' && !property.computed &&
    ((property.key?.type === 'Identifier' && property.key.name === 't') ||
      (property.key?.type === 'StringLiteral' && property.key.value === 't')));
  if (properties.length !== 1) return undefined;
  const property = properties[0]!;
  if (property.value?.type !== 'Identifier' || property.value.name !== 't') {
    return { safe: false, namespace: undefined, offset: node.start ?? 0, message: 'Aliased useTranslation t bindings require manual call-site migration.' };
  }
  const init = node.init as AstNode | undefined;
  if (init?.type !== 'CallExpression' || init.callee?.type !== 'Identifier' || init.callee.name !== 'useTranslation') {
    return { safe: false, namespace: undefined, offset: node.start ?? 0, message: 'The t binding is not a direct useTranslation() destructure.' };
  }
  const args = init.arguments as AstNode[];
  if (args.length === 0) return { safe: true, namespace: undefined, offset: node.start ?? 0 };
  if (args.length === 1 && args[0]!.type === 'StringLiteral') {
    return { safe: true, namespace: args[0]!.value as string, offset: node.start ?? 0 };
  }
  return { safe: false, namespace: undefined, offset: node.start ?? 0, message: 'useTranslation namespace selection must be omitted or one string literal.' };
}

function parserPlugins(extension: string): ParserPlugin[] {
  if (extension === '.ts') return ['typescript'];
  if (extension === '.mts' || extension === '.cts') return ['typescript'];
  if (extension === '.tsx') return ['typescript', 'jsx'];
  return ['jsx'];
}

async function sourceFiles(root: string, issues: CallRewriteIssue[]): Promise<string[]> {
  const resolved = path.resolve(root);
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('--source-dir must be an existing, non-symlink directory.');
  const actual = await realpath(resolved);
  if (path.relative(resolved, actual)) throw new Error('--source-dir must not traverse a symlink or junction.');
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        issues.push({ code: 'UNSAFE_SYMLINK', file, message: 'Call rewrite refuses symbolic links and junctions.' });
        continue;
      }
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) await visit(file);
        continue;
      }
      if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(file);
    }
  }
  await visit(resolved);
  return files.sort();
}

function rewriteFile(source: string, file: string, namespace: string, targets: ReadonlyMap<string, string>): {
  changes: CallRewriteChange[];
  issues: CallRewriteIssue[];
  nextSource: string | undefined;
} {
  if (!/from\s+['"](?:react-i18next|i18next)['"]/.test(source)) return { changes: [], issues: [], nextSource: undefined };
  let ast: AstNode;
  try {
    ast = parse(source, { sourceType: 'unambiguous', plugins: parserPlugins(path.extname(file)), attachComment: false }) as unknown as AstNode;
  } catch (error) {
    return { changes: [], issues: [{
      code: 'CALL_SOURCE_PARSE', file,
      message: 'Source could not be parsed safely: ' + (error instanceof Error ? error.message : String(error)),
      line: 1, column: 1,
    }], nextSource: undefined };
  }
  let tFromI18next = false, useTranslationImported = false;
  const tDeclarations: number[] = [], useTranslationDeclarations: number[] = [];
  const safeBindings: { kind: 'i18next' | 'hook'; offset: number; namespace?: string }[] = [];
  const calls: AstNode[] = [];
  const issues: CallRewriteIssue[] = [];
  let tAssigned = false, useTranslationAssigned = false;

  walk(ast, node => {
    tDeclarations.push(...declarationOffsets(node, 't'));
    useTranslationDeclarations.push(...declarationOffsets(node, 'useTranslation'));
    if (node.type === 'ImportDeclaration' && typeof node.source?.value === 'string') {
      const moduleName = node.source.value as string;
      for (const specifier of node.specifiers as AstNode[]) {
        if (specifier.type !== 'ImportSpecifier') continue;
        const imported = importName(specifier.imported);
        const local = specifier.local?.name as string | undefined;
        if (moduleName === 'i18next' && imported === 't' && local !== 't') {
          issues.push(issueFor(source, file, specifier.start ?? node.start ?? 0, 'CALL_IMPORT_ALIAS',
            'Aliased i18next t imports require manual call-site migration.'));
        }
        if (moduleName === 'react-i18next' && imported === 'useTranslation' && local !== 'useTranslation') {
          issues.push(issueFor(source, file, specifier.start ?? node.start ?? 0, 'CALL_IMPORT_ALIAS',
            'Aliased react-i18next useTranslation imports require manual call-site migration.'));
        }
        if (moduleName === 'i18next' && imported === 't' && local === 't') {
          tFromI18next = true;
          safeBindings.push({ kind: 'i18next', offset: node.start ?? 0 });
        }
        if (moduleName === 'react-i18next' && imported === 'useTranslation' && local === 'useTranslation') {
          useTranslationImported = true;
        }
      }
      return;
    }
    if (assignsName(node, 't')) tAssigned = true;
    if (assignsName(node, 'useTranslation')) useTranslationAssigned = true;
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 't') calls.push(node);
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' &&
        node.callee.property?.type === 'Identifier' && node.callee.property.name === 't') {
      issues.push(issueFor(source, file, node.start ?? 0, 'CALL_MEMBER_UNSUPPORTED',
        'Member .t() calls require manual call-site migration.'));
    }
    if (node.type === 'OptionalCallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 't') {
      issues.push(issueFor(source, file, node.start ?? 0, 'CALL_OPTIONAL_UNSUPPORTED', 'Optional t() calls require manual migration.'));
    }
  });

  if (!tFromI18next && !useTranslationImported) return { changes: [], issues, nextSource: undefined };
  walk(ast, node => {
    const binding = hookBinding(node, useTranslationImported);
    if (!binding) return;
    if (!binding.safe) {
      issues.push(issueFor(source, file, binding.offset, 'CALL_HOOK_MANUAL', binding.message!));
      return;
    }
    if (!safeBindings.some(item => item.kind === 'hook' && item.offset === binding.offset))
      safeBindings.push({ kind: 'hook', offset: binding.offset, ...(binding.namespace === undefined ? {} : { namespace: binding.namespace }) });
  });
  if (tAssigned) issues.push(issueFor(source, file, 0, 'CALL_BINDING_ASSIGNED', 'The t binding is reassigned and cannot be rewritten safely.'));
  if (useTranslationImported && (useTranslationAssigned || useTranslationDeclarations.length > 1))
    issues.push(issueFor(source, file, useTranslationDeclarations[1] ?? 0, 'CALL_USE_TRANSLATION_SHADOWED',
      'useTranslation is shadowed or reassigned and cannot be rewritten safely.'));
  if (tDeclarations.length > 1) issues.push(issueFor(source, file, tDeclarations[1]!, 'CALL_BINDING_SHADOWED',
    'Multiple t bindings require manual disambiguation.'));
  if (calls.length && safeBindings.length === 0) issues.push(issueFor(source, file, calls[0]!.start ?? 0, 'CALL_BINDING_UNSAFE', 'Direct t() calls require an unambiguous i18next or useTranslation binding.'));
  if (safeBindings.length > 1) issues.push(issueFor(source, file, safeBindings[1]!.offset, 'CALL_BINDING_AMBIGUOUS', 'Multiple safe-looking t bindings require manual disambiguation.'));
  for (const binding of safeBindings) {
    if (binding.namespace !== undefined && binding.namespace !== namespace)
      issues.push(issueFor(source, file, binding.offset, 'CALL_HOOK_NAMESPACE', 'useTranslation namespace ' + binding.namespace + ' does not match --namespace ' + namespace + '.'));
  }

  const changes: CallRewriteChange[] = [];
  if (!issues.length && tDeclarations.length === 1 && safeBindings.length === 1) {
    for (const call of calls) {
      const argument = call.arguments?.[0] as AstNode | undefined;
      const callArguments = call.arguments as AstNode[] | undefined;
      if (!argument || argument.type === 'SpreadElement') {
        issues.push(issueFor(source, file, call.start ?? 0, 'CALL_KEY_DYNAMIC', 't() without one literal key requires manual migration.'));
        continue;
      }
      if (argument.type !== 'StringLiteral') {
        issues.push(issueFor(source, file, call.start ?? 0, 'CALL_KEY_DYNAMIC', 'Dynamic t() keys require manual migration.'));
        continue;
      }
      if ((callArguments?.length ?? 0) > 1) {
        const value = callArguments?.[1];
        const unsafe = !value || value.type !== 'ObjectExpression' ||
          (value.properties as AstNode[]).some(property => {
            if (property.type !== 'ObjectProperty' || property.computed) return true;
            const option = property.key?.type === 'Identifier' ? property.key.name as string
              : property.key?.type === 'StringLiteral' ? property.key.value as string : undefined;
            return option === undefined || unsafeCallOptions.has(option) || option.startsWith('defaultValue');
          });
        if (unsafe) {
          issues.push(issueFor(source, file, argument.end ?? call.start ?? 0, 'CALL_ARGUMENTS_UNSUPPORTED',
            't() options can change key or namespace semantics; only an inline object with interpolation values is safe.'));
          continue;
        }
        if ((callArguments?.length ?? 0) > 2) {
          issues.push(issueFor(source, file, argument.end ?? call.start ?? 0, 'CALL_ARGUMENTS_UNSUPPORTED',
            't() with defaultValue and options requires manual call-site migration.'));
          continue;
        }
      }
      const key = argument.value as string;
      const prefix = namespace + ':';
      const already = key.startsWith(prefix);
      const target = already ? (targets.get(key.slice(prefix.length)) === undefined ? undefined : key) : targets.get(key);
      if (!target) {
        issues.push(issueFor(source, file, argument.start ?? call.start ?? 0, 'CALL_KEY_UNMAPPED',
          'Key ' + key + ' has no converted message in namespace ' + namespace + '.'));
        continue;
      }
      if (target === key) continue;
      changes.push({ file, before: key, after: target, ...location(source, argument.start ?? call.start ?? 0) });
    }
  }
  if (issues.length || !changes.length) return { changes: [], issues, nextSource: undefined };
  let nextSource = source;
  const replacements: { start: number; end: number; target: string }[] = [];
  walk(ast, node => {
    if (node.type !== 'CallExpression' || node.callee?.type !== 'Identifier' || node.callee.name !== 't') return;
    const argument = node.arguments?.[0] as AstNode | undefined;
    if (!argument || argument.type !== 'StringLiteral' || argument.start === null || argument.end === null) return;
    const key = argument.value as string;
    const target = targets.get(key);
    if (target && target !== key) replacements.push({ start: argument.start, end: argument.end, target });
  });
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    nextSource = nextSource.slice(0, replacement.start) + JSON.stringify(replacement.target) + nextSource.slice(replacement.end);
  return { changes, issues: [], nextSource };
}

/** Plan an opt-in, literal-only call rewrite without changing imports or hook/provider wiring. */
export async function planCallRewrite(options: CallRewriteOptions): Promise<CallRewritePlan> {
  if (!options.namespace.trim() || options.namespace.includes(':'))
    throw new Error('--namespace must be one nonempty namespace without a colon.');
  const issues: CallRewriteIssue[] = [];
  const root = path.resolve(options.sourceDir);
  const files = await sourceFiles(root, issues);
  const targetMap = new Map(options.targets.map(target => [target, options.namespace + ':' + target]));
  const changes: CallRewriteChange[] = [];
  const guards: CallRewriteGuard[] = [];
  for (const file of files) {
    options.signal?.throwIfAborted();
    const source = await readFile(file, 'utf8');
    const result = rewriteFile(source, file, options.namespace, targetMap);
    issues.push(...result.issues);
    if (result.nextSource !== undefined) {
      changes.push(...result.changes);
      guards.push({ file, relativeFile: path.relative(root, file), before: source, after: result.nextSource, sourceHash: hash(source) });
    }
  }
  return {
    format: 'saylo-call-rewrite/v1', sourceDir: root, namespace: options.namespace,
    dryRun: true, blocked: issues.length > 0, changes, issues,
    checkpoint: { format: 'saylo-call-rewrite-checkpoint/v1', entries: guards.map(guard => ({
      file: guard.relativeFile, sourceHash: guard.sourceHash,
      changeCount: changes.filter(change => change.file === guard.file).length, status: 'ready' as const,
    })) },
    writtenFiles: [], guards,
  };
}

function assertCallSourceCurrent(guard: CallRewriteGuard): void {
  const info = lstatSync(guard.file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Call rewrite source changed type: ' + guard.file);
  if (hash(readFileSync(guard.file, 'utf8')) !== guard.sourceHash) throw new Error('Call rewrite source changed after preview: ' + guard.file);
}

/** Apply staged source edits atomically per file under a source-root lock. */
export async function applyCallRewrite(plan: CallRewritePlan, options: CallRewriteApplyOptions = {}): Promise<CallRewritePlan> {
  if (plan.blocked) throw new Error('Cannot apply a blocked call rewrite.');
  if (!plan.guards.length) return { ...plan, dryRun: false };
  const writtenFiles: string[] = [], temps = new Set<string>();
  const staged = new Map<string, string>();
  const lockFile = path.join(plan.sourceDir, '.saylo-migrate-calls.lock');
  assertSafePath(plan.sourceDir, lockFile);
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let failure: unknown, failed = false;
  const cleanupErrors: unknown[] = [];
  try {
    options.signal?.throwIfAborted();
    try { lock = await open(lockFile, 'wx', 0o600); }
    catch (cause) { throw new Error('Cannot acquire call rewrite lock: ' + lockFile + '. Verify its owner has stopped before removing a stale lock.', { cause }); }
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    for (const guard of plan.guards) assertCallSourceCurrent(guard);
    for (const guard of plan.guards) {
      options.signal?.throwIfAborted();
      const directory = path.dirname(guard.file);
      const temp = path.join(directory, '.' + path.basename(guard.file) + '.saylo-migrate-' + randomUUID() + '.tmp');
      const handle = await open(temp, 'wx', lstatSync(guard.file).mode & 0o777);
      temps.add(temp);
      staged.set(guard.file, temp);
      const errors: unknown[] = [];
      try { options.signal?.throwIfAborted(); await handle.writeFile(guard.after); } catch (error) { errors.push(error); }
      try { await handle.close(); } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Call rewrite staging and handle cleanup failed', { cause: errors[0] });
    }
    for (const guard of plan.guards) assertCallSourceCurrent(guard);
    for (const guard of plan.guards) {
      options.signal?.throwIfAborted();
      const temp = staged.get(guard.file)!;
      const result = await (options.replace ?? replaceGenerated)(temp, guard.file,
        () => { assertCallSourceCurrent(guard); return true; }, undefined, options.signal);
      if (result !== 'written') throw new Error('Call rewrite cancelled before committing ' + guard.file);
      temps.delete(temp);
      staged.delete(guard.file);
      writtenFiles.push(guard.file);
    }
  } catch (error) { failed = true; failure = error; }
  for (const temp of temps) try { await rm(temp, { force: true }); } catch (error) { cleanupErrors.push(error); }
  if (lock) {
    try { await lock.close(); } catch (error) { cleanupErrors.push(error); }
    try { await rm(lockFile, { force: true }); } catch (error) { cleanupErrors.push(error); }
  }
  if (failed || cleanupErrors.length) {
    const cause = cleanupErrors.length ? new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], 'Call rewrite cleanup failed')
      : failure;
    throw new CallRewriteApplyError('Call rewrite failed: ' + (failure instanceof Error ? failure.message : 'Resource cleanup failed'),
      writtenFiles, cause);
  }
  return {
    ...plan, dryRun: false, writtenFiles,
    checkpoint: { ...plan.checkpoint, entries: plan.checkpoint.entries.map(entry => ({ ...entry, status: 'written' as const })) },
  };
}
