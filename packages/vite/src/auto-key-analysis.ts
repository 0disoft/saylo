import { node, sourceTrees, visit } from './auto-key-sources.js';
import type { SourceNode } from './auto-key-sources.js';
import { namespaceId, memberId, moduleId, localId, linkNamespaceImports } from './auto-key-modules.js';

type Reference = string | true | undefined;
interface Call { callee: Reference; arguments: Reference[]; key: string | undefined; pieces: (string | null)[] | undefined }
export interface SourceFacts {
  readonly file: string;
  readonly edges: [string, string][];
  readonly seeds: string[];
  readonly literals: Set<string>;
  readonly escapes: Reference[];
  readonly calls: Call[];
  readonly namespaceImports: { specifier: string; token: string }[];
  readonly exports: [string, Reference][];
  readonly namedImports: { specifier: string; imported: string; local: string }[];
}
const wrappers = new Set(['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSSatisfiesExpression',
  'TSInstantiationExpression', 'TypeCastExpression', 'ParenthesizedExpression']);
// Stored callbacks escape local alias tracking, including public/private class fields.
const storedValueParents = new Set(['ObjectProperty', 'ClassProperty', 'ClassPrivateProperty']);
/** Type-only wrappers do not change the runtime value or break translator aliases. */
const expression = (value: unknown): SourceNode | undefined => {
  let current = node(value);
  while (current && wrappers.has(current.type)) current = node(current.expression);
  return current;
};
const identifier = (value: unknown) => { const current = expression(value); return current?.type === 'Identifier' ? current.name as string : undefined; };
const literal = (value: unknown): string | undefined => {
  const current = expression(value);
  if (current?.type === 'StringLiteral') return current.value as string;
  if (current?.type === 'TemplateLiteral' && Array.isArray(current.expressions) && !current.expressions.length)
    return (current.quasis as { value: { cooked: string } }[])[0]?.value.cooked;
  return;
};
const property = (value: unknown) => { const current = expression(value); return current?.computed ? literal(current.property) : identifier(current?.property); };
const callable = (value: unknown, namespaces: ReadonlyMap<string, string>): Reference => {
  const current = expression(value), name = property(current);
  if (['t', 'tParts'].includes(name ?? '')) return true;
  const owner = namespaces.get(identifier(current?.object) ?? '');
  if (owner) return name === undefined ? owner : memberId(owner, name);
  const direct = identifier(current);
  return namespaces.get(direct ?? '') ?? direct;
};
const reference = (value: unknown, namespaces: ReadonlyMap<string, string>): Reference => {
  const direct = callable(value, namespaces);
  if (direct !== undefined) return direct;
  const current = expression(value);
  const callee = current?.type === 'CallExpression' || current?.type === 'OptionalCallExpression' ? expression(current.callee) : undefined;
  return property(callee) === 'bind' ? reference(callee?.object, namespaces) : undefined;
};

/** Extract only string relationships and key usage; no AST node escapes this file's analysis. */
export function analyzeSource(source: string, file: string, available: ReadonlySet<string>): SourceFacts {
  const facts: SourceFacts = { file, edges: [], seeds: [], literals: new Set(), escapes: [], calls: [], namespaceImports: [], exports: [], namedImports: [] };
  const bindings = new WeakSet<SourceNode>();
  const trees = sourceTrees(source, file), namespaces = new Map<string, string>();
  // Imports are hoisted: an earlier use must also recognize a later declaration.
  for (const tree of trees) for (const statement of (node(tree.program)?.body as SourceNode[] | undefined) ?? []) {
    if (statement.type === 'ImportDeclaration' && statement.importKind !== 'type') for (const specifier of statement.specifiers as SourceNode[]) {
      const name = identifier(specifier.local);
      if (specifier.type === 'ImportNamespaceSpecifier' && name) {
        const specifier = literal(statement.source)!;
        const token = namespaceId(file, specifier);
        namespaces.set(name, token); facts.namespaceImports.push({ specifier, token });
      }
    }
  }
  if (namespaces.size) {
    const dependents = new Map<string, Set<string>>();
    for (const tree of trees) visit(tree, current => {
      if (current.type !== 'VariableDeclarator' && current.type !== 'AssignmentExpression') return;
      const from = identifier(current.init ?? current.right), to = identifier(current.id ?? current.left);
      if (!from || !to) return;
      let targets = dependents.get(from);
      if (!targets) { targets = new Set(); dependents.set(from, targets); }
      targets.add(to);
    });
    const queue = [...namespaces.keys()];
    for (let index = 0; index < queue.length; index++) for (const target of dependents.get(queue[index]!) ?? []) {
      if (namespaces.has(target)) continue;
      namespaces.set(target, namespaces.get(queue[index]!)!); queue.push(target);
    }
  }
  const alias = (from: Reference, to: string | undefined) => {
    if (!to || from === undefined) return;
    if (from === true) facts.seeds.push(to); else facts.edges.push([from, to]);
  };
  for (const tree of trees) visit(tree, (current, parent) => {
    if (current.type === 'ExportNamedDeclaration') {
      const declaration = node(current.declaration);
      if (declaration?.type === 'VariableDeclaration') for (const binding of declaration.declarations as SourceNode[]) {
        const name = identifier(binding.id);
        if (name) facts.exports.push([name, reference(binding.id, namespaces)]);
        if (namespaces.has(name ?? '')) facts.escapes.push(reference(binding.id, namespaces));
      }
    }
    if (current.type === 'ExportSpecifier') {
      if (current.exportKind === 'type' || parent?.exportKind === 'type') return;
      alias(identifier(current.local), identifier(current.exported));
      const exported = identifier(current.exported) ?? literal(current.exported);
      if (exported) facts.exports.push([exported, reference(current.local, namespaces)]);
      const imported = identifier(current.local), specifier = literal(parent?.source);
      if (imported && specifier) facts.namedImports.push({ specifier, imported, local: imported });
      // Default exports cannot be followed through the named-alias graph.
      if ((identifier(current.exported) ?? literal(current.exported)) === 'default') facts.escapes.push(identifier(current.local));
      if (namespaces.has(identifier(current.local) ?? '')) facts.escapes.push(reference(current.local, namespaces));
    }
    if (current.type === 'ImportSpecifier') {
      if (current.importKind === 'type' || parent?.importKind === 'type') return;
      const imported = identifier(current.imported), local = identifier(current.local), specifier = literal(parent?.source);
      alias(imported, local);
      if (imported && local && specifier) facts.namedImports.push({ specifier, imported, local });
    }
    if (current.type === 'VariableDeclarator' || current.type === 'AssignmentExpression') {
      const left = node(current.id ?? current.left), right = node(current.init ?? current.right);
      if (!namespaces.has(identifier(right) ?? '')) alias(reference(right, namespaces), identifier(left));
    }
    if (current.type === 'ObjectPattern') for (const value of current.properties as SourceNode[]) {
      bindings.add(value);
      if (namespaces.has(identifier(parent?.init ?? parent?.right) ?? '') &&
          (value.type === 'RestElement' || value.computed && literal(value.key) === undefined)) {
        facts.escapes.push(reference(parent?.init ?? parent?.right, namespaces));
      } else if (['t', 'tParts'].includes(identifier(value.key) ?? literal(value.key) ?? '')) {
        const binding = node(value.value);
        alias(true, identifier(binding?.type === 'AssignmentPattern' ? binding.left : binding));
      } else if (namespaces.has(identifier(parent?.init ?? parent?.right) ?? '')) {
        const binding = node(value.value);
        alias(memberId(namespaces.get(identifier(parent?.init ?? parent?.right)!)!, (identifier(value.key) ?? literal(value.key))!),
          identifier(binding?.type === 'AssignmentPattern' ? binding.left : binding));
      }
    }
    const ref = reference(current, namespaces);
    if (ref !== undefined && parent && (
      parent.type === 'ReturnStatement' || parent.type === 'ExportDefaultDeclaration' || parent.type === 'ArrayExpression' ||
      parent.type === 'ConditionalExpression' || parent.type === 'LogicalExpression' || parent.type === 'SequenceExpression' ||
      parent.type === 'JSXExpressionContainer' || parent.type === 'ExpressionStatement' ||
      parent.type === 'AwaitExpression' || parent.type === 'YieldExpression' || parent.type === 'SpreadElement' ||
      parent.type === 'AssignmentPattern' && parent.right === current ||
      parent.type === 'ArrowFunctionExpression' && parent.body === current ||
      storedValueParents.has(parent.type) && parent.value === current && !bindings.has(parent) ||
      parent.type === 'AssignmentExpression' && parent.right === current && node(parent.left)?.type !== 'Identifier')) facts.escapes.push(ref);
    const value = literal(current);
    if (value !== undefined && available.has(value)) facts.literals.add(value);
    if (current.type !== 'CallExpression' && current.type !== 'OptionalCallExpression' && current.type !== 'NewExpression') return;
    const callee = expression(current.callee), target = expression(callee?.object);
    let calleeRef = reference(callee, namespaces), argument = (current.arguments as unknown[])[0];
    if (['call', 'apply'].includes(property(callee) ?? '') && reference(target, namespaces) !== undefined) {
      calleeRef = reference(target, namespaces); argument = (current.arguments as unknown[])[1];
      if (property(callee) === 'apply') argument = (expression(argument)?.elements as unknown[] | undefined)?.[0];
    }
    const arguments_ = (current.arguments as unknown[]).map(value => reference(value, namespaces)).filter(ref => ref !== undefined);
    if (calleeRef === undefined && !arguments_.length) return;
    const template = expression(argument);
    facts.calls.push({ callee: calleeRef, arguments: arguments_, key: literal(argument),
      pieces: template?.type === 'TemplateLiteral' ? (template.quasis as { value: { cooked: string | null } }[]).map(q => q.value.cooked) : undefined });
  });
  return facts;
}

/** Each newly discovered alias visits its dependents once, including reverse chains and cycles. */
export function resolveAliases(sources: readonly SourceFacts[], resolvedImports: ReadonlyMap<string, string> = new Map()): ReadonlySet<string> {
  const dependents = new Map<string, Set<string>>(), aliases = new Set(['t', 'tParts', '$t']);
  const edge = (from: string, to: string) => {
    let targets = dependents.get(from);
    if (!targets) { targets = new Set(); dependents.set(from, targets); }
    targets.add(to);
  };
  for (const source of sources) {
    for (const seed of source.seeds) aliases.add(seed);
    for (const seed of ['t', 'tParts', '$t', ...source.seeds]) aliases.add(localId(source.file, seed));
    for (const [from, to] of source.edges) {
      edge(from, to);
      edge(localId(source.file, from), localId(source.file, to));
    }
    for (const [name, ref] of source.exports) {
      const token = memberId(moduleId(source.file), name);
      if (ref === true) aliases.add(token); else if (typeof ref === 'string') edge(localId(source.file, ref), token);
    }
  }
  linkNamespaceImports(sources, edge, token => { aliases.add(token); }, resolvedImports);
  const queue = [...aliases];
  for (let index = 0; index < queue.length; index++) for (const target of dependents.get(queue[index]!) ?? []) {
    if (aliases.has(target)) continue;
    aliases.add(target); queue.push(target);
  }
  return aliases;
}

export const isTranslator = (reference: Reference, aliases: ReadonlySet<string>) => reference === true ||
  (typeof reference === 'string' && aliases.has(reference));
