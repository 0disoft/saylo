import { parseExpression } from '@babel/parser';
import { createBaseSchema, parseCatalog, validateTranslation } from '@0disoft/saylo-core';
import type { ParsedCatalog } from '@0disoft/saylo-core';

export interface MigrationIssue { readonly code: string; readonly key: string; readonly message: string }
export interface MigrationOptions {
  readonly locale: string;
  readonly namespace: string;
  /** Only set false when the source app already disables interpolation escaping. */
  readonly escapeValue?: false;
  readonly baseCatalog?: ParsedCatalog;
}
const categories = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

function readResource(source: string): Record<string, unknown> {
  const resource: unknown = JSON.parse(source);
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) throw new Error('Expected one i18next namespace JSON object.');
  const ast = parseExpression(source);
  const pending = [ast];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type !== 'ObjectExpression') continue;
    const seen = new Set<string>();
    for (const property of node.properties) {
      if (property.type !== 'ObjectProperty' || property.key.type !== 'StringLiteral') throw new Error('Expected strict JSON properties.');
      const key = property.key.value;
      if (seen.has(key)) throw new Error(`Duplicate JSON property: ${key}`);
      seen.add(key);
      pending.push(property.value as typeof ast);
    }
  }
  return resource as Record<string, unknown>;
}

/** Quote literal ICU syntax without altering apostrophes or # inside plural branches. */
function literal(text: string, plural: boolean): string {
  const first = text.search(plural ? /[{}#]/ : /[{}]/);
  return first < 0 ? text.replaceAll("'", "''") : text.slice(0, first).replaceAll("'", "''")
    + "'" + text.slice(first).replaceAll("'", "''") + "'";
}

/** Convert one JSON-v4 namespace only; never run application code or guess formatter behavior. */
export function migrateI18next(source: string, options: MigrationOptions) {
  const locale = Intl.getCanonicalLocales(options.locale)[0];
  if (!locale) throw new Error('locale must be a BCP 47 locale.');
  parseCatalog('{}', { locale, namespace: options.namespace });
  const issues: MigrationIssue[] = [], mappings: { sourceKeys: string[]; targetKey: string }[] = [];
  const entries = new Map<string, unknown>();
  const issue = (key: string, code: string, message: string) => { issues.push({ code, key, message }); };
  function flatten(value: Record<string, unknown>, prefix: string) {
    for (const [part, child] of Object.entries(value)) {
      const key = prefix ? `${prefix}.${part}` : part;
      if (!part || key.includes(':')) { issue(key, 'INVALID_KEY', 'Keys must be nonempty and cannot contain colons.'); continue; }
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        if (!Object.keys(child).length) issue(key, 'UNSUPPORTED_VALUE', 'An empty object is not a string message.');
        else flatten(child as Record<string, unknown>, key);
      }
      else if (entries.has(key)) issue(key, 'KEY_COLLISION', 'Flattened key collides with a literal dotted key.');
      else entries.set(key, child);
    }
  }
  flatten(readResource(source), '');
  function convert(key: string, value: unknown, plural = false): string | undefined {
    if (typeof value !== 'string') { issue(key, 'UNSUPPORTED_VALUE', 'Arrays, null and non-string values require manual conversion.'); return; }
    if (value.includes('$t(') || /_ordinal_|_plural$|_\d+$/.test(key)) {
      issue(key, 'UNSUPPORTED_SYNTAX', 'Nesting, ordinals and legacy plural suffixes require manual conversion.'); return;
    }
    let result = '', cursor = 0;
    for (const match of value.matchAll(/{{([\s\S]*?)}}/g)) {
      result += literal(value.slice(cursor, match.index), plural);
      const argument = /^\s*(-\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(match[1]!);
      if (!argument) { issue(key, 'UNSUPPORTED_INTERPOLATION', 'Nested model paths and custom formatters require manual conversion.'); return; }
      if (!argument[1] && options.escapeValue !== false) {
        issue(key, 'ESCAPING_POLICY', 'Confirm the source uses escapeValue: false with --escape-value false; Saylo returns unescaped text.'); return;
      }
      result += `{${argument[2]}}`;
      cursor = match.index + match[0].length;
    }
    if (value.slice(cursor).includes('{{') || value.slice(cursor).includes('}}')) {
      issue(key, 'UNSUPPORTED_INTERPOLATION', 'Unbalanced interpolation delimiters require manual conversion.'); return;
    }
    return result + literal(value.slice(cursor), plural);
  }
  const groups = new Map<string, Map<string, string>>();
  for (const key of entries.keys()) {
    const match = /^(.*)_(zero|one|two|few|many|other)$/.exec(key);
    if (match && match[1]) {
      let group = groups.get(match[1]);
      if (!group) { group = new Map(); groups.set(match[1], group); }
      group.set(match[2]!, key);
    }
  }
  const catalog: Record<string, string> = Object.create(null);
  const consumed = new Set<string>();
  for (const [key, group] of groups) {
    for (const sourceKey of group.values()) consumed.add(sourceKey);
    const required = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    if (entries.has(key) || !group.has('other') || required.some(category => !group.has(category))) {
      issue(key, 'PLURAL_CONFLICT', 'Plural group needs every locale category including other, and cannot coexist with a plain key.'); continue;
    }
    const branches: string[] = [];
    for (const category of categories) {
      const sourceKey = group.get(category);
      if (!sourceKey) continue;
      const text = convert(sourceKey, entries.get(sourceKey), true);
      if (text === undefined) continue;
      if (category === 'zero') branches.push(`=0 {${text}}`);
      branches.push(`${category} {${text}}`);
    }
    catalog[key] = `{count, plural, ${branches.join(' ')}}`;
    mappings.push({ sourceKeys: [...group.values()].sort(), targetKey: `${options.namespace}:${key}` });
  }
  for (const [key, value] of entries) {
    if (consumed.has(key) || groups.has(key)) continue;
    const text = convert(key, value);
    if (text !== undefined) { catalog[key] = text; mappings.push({ sourceKeys: [key], targetKey: `${options.namespace}:${key}` }); }
  }
  if (!issues.length) {
    try {
      const parsed = parseCatalog(JSON.stringify(catalog), { locale, namespace: options.namespace });
      if (options.baseCatalog) validateTranslation(createBaseSchema(options.baseCatalog), parsed);
    } catch (error) { issue('', 'CATALOG_CONTRACT', error instanceof Error ? error.message : String(error)); }
  }
  return { format: 'saylo-migration/v1' as const, from: 'i18next-json-v4' as const, locale, namespace: options.namespace,
    blocked: issues.length > 0, catalog: issues.length ? null : catalog, issues,
    mappings: mappings.sort((a, b) => a.targetKey < b.targetKey ? -1 : a.targetKey > b.targetKey ? 1 : 0) };
}
