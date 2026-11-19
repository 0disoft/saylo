import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
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
  readonly readDirectory?: (directory: string) => Promise<readonly Dirent[]>;
  readonly readSource?: (file: string, signal?: AbortSignal) => Promise<string>;
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
const MAX_TRANSLATION_CALL_ARGUMENTS = 2;

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

function sourceLocation(source: string) {
  let lineStarts: number[] | undefined;
  return (offset: number) => {
    if (!lineStarts) {
      lineStarts = [0];
      for (const newline of source.matchAll(/\r\n?|\n/g)) lineStarts.push(newline.index + newline[0].length);
    }
    // A prefix ending between CR and LF already counts the CR as a line break.
    const end = source[offset] === '\n' && source[offset - 1] === '\r' ? offset + 1 : offset;
    let low = 0, high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle]! <= end) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: end - lineStarts[low]! + 1 };
  };
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
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod',
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

async function sourceFiles(root: string, issues: CallRewriteIssue[], signal?: AbortSignal,
  readDirectory: NonNullable<CallRewriteOptions['readDirectory']> = directory => readdir(directory, { withFileTypes: true })): Promise<string[]> {
  signal?.throwIfAborted();
  const resolved = path.resolve(root);
  const info = await lstat(resolved);
  signal?.throwIfAborted();
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('--source-dir must be an existing, non-symlink directory.');
  const actual = await realpath(resolved);
  if (path.relative(resolved, actual)) throw new Error('--source-dir must not traverse a symlink or junction.');
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    signal?.throwIfAborted();
    const entries = await readDirectory(directory);
    for (const entry of entries) {
      signal?.throwIfAborted();
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
  signal?.throwIfAborted();
  return files.sort();
}

type IssueAt = (offset: number, code: string, message: string) => CallRewriteIssue;
type SafeBinding = { readonly offset: number; readonly namespace?: string };
type Replacement = { readonly start: number; readonly end: number; readonly target: string };

function* translationImports(node: AstNode) {
  const moduleName = node.source?.value;
  if (moduleName !== 'i18next' && moduleName !== 'react-i18next') return;
  const name = moduleName === 'i18next' ? 't' : 'useTranslation';
  for (const specifier of node.specifiers as readonly AstNode[]) {
    if (specifier.type !== 'ImportSpecifier' || importName(specifier.imported) !== name) continue;
    yield { moduleName, aliased: specifier.local?.name !== name, offset: specifier.start ?? node.start ?? 0 };
  }
}

function collectCalls(ast: AstNode, issueFor: IssueAt) {
  let tFromI18next = false, useTranslationImported = false;
  const tDeclarations: number[] = [], useTranslationDeclarations: number[] = [];
  const safeBindings: SafeBinding[] = [];
  const calls: AstNode[] = [];
  const issues: CallRewriteIssue[] = [];
  let tAssigned = false, useTranslationAssigned = false;

  walk(ast, node => {
    tDeclarations.push(...declarationOffsets(node, 't'));
    useTranslationDeclarations.push(...declarationOffsets(node, 'useTranslation'));
    if (node.type === 'ImportDeclaration' && typeof node.source?.value === 'string') {
      for (const { moduleName, aliased, offset } of translationImports(node)) {
        if (aliased) {
          issues.push(issueFor(offset, 'CALL_IMPORT_ALIAS', moduleName === 'i18next'
            ? 'Aliased i18next t imports require manual call-site migration.'
            : 'Aliased react-i18next useTranslation imports require manual call-site migration.'));
          continue;
        }
        if (moduleName === 'i18next') {
          tFromI18next = true;
          safeBindings.push({ offset: node.start ?? 0 });
        } else useTranslationImported = true;
      }
      return;
    }
    if (assignsName(node, 't')) tAssigned = true;
    if (assignsName(node, 'useTranslation')) useTranslationAssigned = true;
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 't') calls.push(node);
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' &&
        node.callee.property?.type === 'Identifier' && node.callee.property.name === 't') {
      issues.push(issueFor(node.start ?? 0, 'CALL_MEMBER_UNSUPPORTED',
        'Member .t() calls require manual call-site migration.'));
    }
    if (node.type === 'OptionalCallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 't') {
      issues.push(issueFor(node.start ?? 0, 'CALL_OPTIONAL_UNSUPPORTED', 'Optional t() calls require manual migration.'));
    }
  });

  return { tFromI18next, useTranslationImported, tDeclarations, useTranslationDeclarations, safeBindings, calls, issues,
    tAssigned, useTranslationAssigned };
}

function collectHookBindings(ast: AstNode, issueFor: IssueAt) {
  const bindings: SafeBinding[] = [], issues: CallRewriteIssue[] = [];
  const offsets = new Set<number>();
  walk(ast, node => {
    const binding = hookBinding(node, true);
    if (!binding) return;
    if (!binding.safe) { issues.push(issueFor(binding.offset, 'CALL_HOOK_MANUAL', binding.message!)); return; }
    if (offsets.has(binding.offset)) return;
    offsets.add(binding.offset);
    bindings.push({ offset: binding.offset, ...(binding.namespace === undefined ? {} : { namespace: binding.namespace }) });
  });
  return { bindings, issues };
}

function bindingIssues(collected: ReturnType<typeof collectCalls>, safeBindings: readonly SafeBinding[], namespace: string,
  issueFor: IssueAt): CallRewriteIssue[] {
  const { tAssigned, useTranslationImported, useTranslationAssigned, useTranslationDeclarations, tDeclarations, calls } = collected;
  const issues: CallRewriteIssue[] = [];
  if (tAssigned) issues.push(issueFor(0, 'CALL_BINDING_ASSIGNED', 'The t binding is reassigned and cannot be rewritten safely.'));
  if (useTranslationImported && (useTranslationAssigned || useTranslationDeclarations.length > 1))
    issues.push(issueFor(useTranslationDeclarations[1] ?? 0, 'CALL_USE_TRANSLATION_SHADOWED',
      'useTranslation is shadowed or reassigned and cannot be rewritten safely.'));
  if (tDeclarations.length > 1) issues.push(issueFor(tDeclarations[1]!, 'CALL_BINDING_SHADOWED',
    'Multiple t bindings require manual disambiguation.'));
  if (calls.length && safeBindings.length === 0) issues.push(issueFor(calls[0]!.start ?? 0, 'CALL_BINDING_UNSAFE', 'Direct t() calls require an unambiguous i18next or useTranslation binding.'));
  if (safeBindings.length > 1) issues.push(issueFor(safeBindings[1]!.offset, 'CALL_BINDING_AMBIGUOUS', 'Multiple safe-looking t bindings require manual disambiguation.'));
  for (const binding of safeBindings) {
    if (binding.namespace !== undefined && binding.namespace !== namespace)
      issues.push(issueFor(binding.offset, 'CALL_HOOK_NAMESPACE', 'useTranslation namespace ' + binding.namespace + ' does not match --namespace ' + namespace + '.'));
  }
  return issues;
}

function isSafeInterpolationOptions(node: AstNode | undefined): boolean {
  if (node?.type !== 'ObjectExpression') return false;
  return (node.properties as AstNode[]).every(property => {
    if (property.type !== 'ObjectProperty' || property.computed) return false;
    const option = property.key ? importName(property.key) : undefined;
    return option !== undefined && !unsafeCallOptions.has(option) && !option.startsWith('defaultValue');
  });
}

function classifyCall(call: AstNode, namespace: string, targets: ReadonlyMap<string, string>, issueFor: IssueAt) {
  const args = (call.arguments as readonly AstNode[] | undefined) ?? [];
  const argument = args[0];
  const callStart = call.start ?? 0;
  if (!argument || argument.type === 'SpreadElement')
    return { issue: issueFor(callStart, 'CALL_KEY_DYNAMIC', 't() without one literal key requires manual migration.') };
  if (argument.type !== 'StringLiteral')
    return { issue: issueFor(callStart, 'CALL_KEY_DYNAMIC', 'Dynamic t() keys require manual migration.') };
  const optionsOffset = argument.end ?? callStart;
  if (args.length > 1 && !isSafeInterpolationOptions(args[1]))
    return { issue: issueFor(optionsOffset, 'CALL_ARGUMENTS_UNSUPPORTED',
      't() options can change key or namespace semantics; only an inline object with interpolation values is safe.') };
  if (args.length > MAX_TRANSLATION_CALL_ARGUMENTS)
    return { issue: issueFor(optionsOffset, 'CALL_ARGUMENTS_UNSUPPORTED',
      't() with defaultValue and options requires manual call-site migration.') };
  const key = argument.value as string;
  const prefix = namespace + ':';
  const replacement = targets.get(key);
  const target = key.startsWith(prefix) ? (targets.has(key.slice(prefix.length)) ? key : undefined) : replacement;
  if (!target)
    return { issue: issueFor(argument.start ?? callStart, 'CALL_KEY_UNMAPPED',
      'Key ' + key + ' has no converted message in namespace ' + namespace + '.') };
  return { key, target, argument, replacement };
}

function rewriteLiterals(source: string, replacements: readonly Replacement[]): string {
  const chunks: string[] = [];
  let cursor = 0;
  // Literal token ranges are disjoint, even when their calls are nested.
  for (const { start, end, target } of [...replacements].sort((a, b) => a.start - b.start)) {
    chunks.push(source.slice(cursor, start), JSON.stringify(target));
    cursor = end;
  }
  chunks.push(source.slice(cursor));
  return chunks.join('');
}

function rewriteFile(source: string, file: string, namespace: string, targets: ReadonlyMap<string, string>) {
  if (!/from\s+['"](?:react-i18next|i18next)['"]/.test(source)) return { changes: [], issues: [], nextSource: undefined };
  let ast: AstNode;
  try {
    ast = parse(source, { sourceType: 'unambiguous', plugins: parserPlugins(path.extname(file)), attachComment: false }) as unknown as AstNode;
  } catch (error) {
    return { changes: [], issues: [{ code: 'CALL_SOURCE_PARSE', file,
      message: 'Source could not be parsed safely: ' + (error instanceof Error ? error.message : String(error)),
      line: 1, column: 1 }], nextSource: undefined };
  }
  const location = sourceLocation(source);
  const issueFor: IssueAt = (offset, code, message) => ({ code, file, message, ...location(offset) });
  const collected = collectCalls(ast, issueFor);
  const { calls, issues, safeBindings, tDeclarations, tFromI18next, useTranslationImported } = collected;
  if (!tFromI18next && !useTranslationImported) return { changes: [], issues, nextSource: undefined };
  const hooks = useTranslationImported ? collectHookBindings(ast, issueFor) : undefined;
  const bindings = hooks ? [...safeBindings, ...hooks.bindings] : safeBindings;
  if (hooks) issues.push(...hooks.issues);
  issues.push(...bindingIssues(collected, bindings, namespace, issueFor));
  if (issues.length || tDeclarations.length !== 1 || bindings.length !== 1)
    return { changes: [], issues, nextSource: undefined };

  const changes: CallRewriteChange[] = [], replacements: Replacement[] = [];
  for (const call of calls) {
    const result = classifyCall(call, namespace, targets, issueFor);
    if (result.issue) { issues.push(result.issue); continue; }
    const { argument, key, target, replacement } = result;
    if (target !== key) changes.push({ file, before: key, after: target, ...location(argument.start ?? call.start ?? 0) });
    if (replacement && replacement !== key && argument.start !== null && argument.end !== null)
      replacements.push({ start: argument.start, end: argument.end, target: replacement });
  }
  if (issues.length || !changes.length) return { changes: [], issues, nextSource: undefined };
  return { changes, issues, nextSource: rewriteLiterals(source, replacements) };
}

/** Plan an opt-in, literal-only call rewrite without changing imports or hook/provider wiring. */
export async function planCallRewrite(options: CallRewriteOptions): Promise<CallRewritePlan> {
  if (!options.namespace.trim() || options.namespace.includes(':'))
    throw new Error('--namespace must be one nonempty namespace without a colon.');
  const { signal, readSource = (file, activeSignal) =>
    readFile(file, activeSignal ? { encoding: 'utf8', signal: activeSignal } : 'utf8') } = options;
  const issues: CallRewriteIssue[] = [];
  const root = path.resolve(options.sourceDir);
  const files = await sourceFiles(root, issues, signal, options.readDirectory);
  const targetMap = new Map(options.targets.map(target => [target, options.namespace + ':' + target]));
  const changes: CallRewriteChange[] = [];
  const guards: CallRewriteGuard[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    let source: string;
    try { source = await readSource(file, signal); }
    catch (error) {
      signal?.throwIfAborted();
      throw error;
    }
    signal?.throwIfAborted();
    const result = rewriteFile(source, file, options.namespace, targetMap);
    issues.push(...result.issues);
    if (result.nextSource !== undefined) {
      changes.push(...result.changes);
      guards.push({ file, relativeFile: path.relative(root, file), before: source, after: result.nextSource, sourceHash: hash(source) });
    }
  }
  signal?.throwIfAborted();
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
