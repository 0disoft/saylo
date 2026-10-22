import { node, sourceTrees, visit } from './auto-key-sources.js';
import type { SourceNode } from './auto-key-sources.js';

type Reference = string | true | undefined;
interface Call { callee: Reference; arguments: Reference[]; key: string | undefined; pieces: (string | null)[] | undefined }
export interface SourceFacts {
  readonly file: string;
  readonly edges: [string, string][];
  readonly seeds: string[];
  readonly literals: Set<string>;
  readonly escapes: Reference[];
  readonly calls: Call[];
}
const identifier = (value: unknown) => { const current = node(value); return current?.type === 'Identifier' ? current.name as string : undefined; };
const literal = (value: unknown): string | undefined => {
  const current = node(value);
  if (current?.type === 'StringLiteral') return current.value as string;
  if (current?.type === 'TemplateLiteral' && Array.isArray(current.expressions) && !current.expressions.length)
    return (current.quasis as { value: { cooked: string } }[])[0]?.value.cooked;
  return;
};
const property = (value: unknown) => { const current = node(value); return current?.computed ? literal(current.property) : identifier(current?.property); };
const callable = (value: unknown): Reference => ['t', 'tParts'].includes(property(value) ?? '') ? true : identifier(value);
const reference = (value: unknown): Reference => {
  const direct = callable(value);
  if (direct !== undefined) return direct;
  const current = node(value), callee = current?.type === 'CallExpression' ? node(current.callee) : undefined;
  return property(callee) === 'bind' ? callable(callee?.object) : undefined;
};

/** Extract only string relationships and key usage; no AST node escapes this file's analysis. */
export function analyzeSource(source: string, file: string, available: ReadonlySet<string>): SourceFacts {
  const facts: SourceFacts = { file, edges: [], seeds: [], literals: new Set(), escapes: [], calls: [] };
  const bindings = new WeakSet<SourceNode>();
  const alias = (from: Reference, to: string | undefined) => {
    if (!to || from === undefined) return;
    if (from === true) facts.seeds.push(to); else facts.edges.push([from, to]);
  };
  for (const tree of sourceTrees(source, file)) visit(tree, (current, parent) => {
    if (current.type === 'ExportSpecifier') alias(identifier(current.local), identifier(current.exported));
    if (current.type === 'ImportSpecifier') alias(identifier(current.imported), identifier(current.local));
    if (current.type === 'VariableDeclarator' || current.type === 'AssignmentExpression') {
      const left = node(current.id ?? current.left), right = node(current.init ?? current.right);
      alias(reference(right), identifier(left));
      if (left?.type === 'ObjectPattern') for (const value of left.properties as SourceNode[]) {
        bindings.add(value);
        if (['t', 'tParts'].includes(identifier(value.key) ?? literal(value.key) ?? '')) {
          const binding = node(value.value);
          alias(true, identifier(binding?.type === 'AssignmentPattern' ? binding.left : binding));
        }
      }
    }
    const ref = reference(current);
    if (ref !== undefined && parent && (
      parent.type === 'ReturnStatement' || parent.type === 'ExportDefaultDeclaration' || parent.type === 'ArrayExpression' ||
      parent.type === 'ConditionalExpression' || parent.type === 'ArrowFunctionExpression' && parent.body === current ||
      parent.type === 'ObjectProperty' && parent.value === current && !bindings.has(parent) ||
      parent.type === 'AssignmentExpression' && parent.right === current && node(parent.left)?.type !== 'Identifier')) facts.escapes.push(ref);
    const value = literal(current);
    if (value !== undefined && available.has(value)) facts.literals.add(value);
    if (current.type !== 'CallExpression' && current.type !== 'OptionalCallExpression') return;
    const callee = node(current.callee), target = node(callee?.object);
    let calleeRef = callable(callee), argument = (current.arguments as unknown[])[0];
    if (['call', 'apply'].includes(property(callee) ?? '') && callable(target) !== undefined) {
      calleeRef = callable(target); argument = (current.arguments as unknown[])[1];
      if (property(callee) === 'apply') argument = (node(argument)?.elements as unknown[] | undefined)?.[0];
    }
    const arguments_ = (current.arguments as unknown[]).map(reference).filter(ref => ref !== undefined);
    if (calleeRef === undefined && !arguments_.length) return;
    const template = node(argument);
    facts.calls.push({ callee: calleeRef, arguments: arguments_, key: literal(argument),
      pieces: template?.type === 'TemplateLiteral' ? (template.quasis as { value: { cooked: string | null } }[]).map(q => q.value.cooked) : undefined });
  });
  return facts;
}

/** Each newly discovered alias visits its dependents once, including reverse chains and cycles. */
export function resolveAliases(sources: readonly SourceFacts[]): ReadonlySet<string> {
  const dependents = new Map<string, Set<string>>(), aliases = new Set(['t', 'tParts', '$t']);
  for (const source of sources) {
    for (const seed of source.seeds) aliases.add(seed);
    for (const [from, to] of source.edges) {
      let targets = dependents.get(from);
      if (!targets) { targets = new Set(); dependents.set(from, targets); }
      targets.add(to);
    }
  }
  const queue = [...aliases];
  for (let index = 0; index < queue.length; index++) for (const target of dependents.get(queue[index]!) ?? []) {
    if (aliases.has(target)) continue;
    aliases.add(target); queue.push(target);
  }
  return aliases;
}

export const isTranslator = (reference: Reference, aliases: ReadonlySet<string>) => reference === true ||
  (typeof reference === 'string' && aliases.has(reference));
