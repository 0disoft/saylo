import { parse } from '@formatjs/icu-messageformat-parser';
import { CatalogError, freeze, freezeMessageAst, freezeOwnedMessageMap, createPositionLocator, isDeepFrozen } from './diagnostics.js';
import { messageOffset } from './json.js';
import { hasSameCatalogSource, readCatalogJson, rememberCatalogJson } from './catalog-json.js';
import { inferArguments } from './schema.js';
import { createSimplePositionPool, parseSimpleMessage } from './simple-message.js';
import type { CatalogDiagnostic, CatalogOptions, MessageSchema, ParsedCatalog, ParsedMessage } from './types.js';

/** An immutable previous catalog lets live readers reuse unchanged ICU messages. */
export function parseCatalog(source: string, options: CatalogOptions, previous?: ParsedCatalog): ParsedCatalog {
  const context = { ...options, sourceName: options.sourceName ?? '<catalog>' };
  if (typeof options.namespace !== 'string' || !options.namespace || options.namespace === '.' || options.namespace === '..' || /[:/\\\x00-\x1f]/.test(options.namespace)) {
    throw new CatalogError([{ ...context, code: 'INVALID_NAMESPACE', message: 'Namespace must be a nonempty filename without colons or path separators.' }]);
  }
  try {
    context.locale = Intl.getCanonicalLocales(options.locale)[0]!;
    if (!context.locale) throw new RangeError('Empty locale');
  } catch {
    throw new CatalogError([{ ...context, code: 'INVALID_LOCALE', message: 'Locale must be a valid BCP 47 language tag.' }]);
  }
  if (hasSameCatalogSource(source, context, previous)) return previous!;
  const entries = readCatalogJson(source, context, previous);
  const positionAt = createPositionLocator(source);
  const diagnostics: CatalogDiagnostic[] = [];
  const messages: Record<string, ParsedMessage> = Object.create(null);
  const locale = new Intl.Locale(context.locale);
  const argumentSchemas = new Map<string, MessageSchema>();
  const simplePosition = createSimplePositionPool();
  const reusable = previous && isDeepFrozen(previous) && previous.locale === context.locale &&
    previous.namespace === context.namespace && previous.sourceName === context.sourceName ? previous.messages : undefined;
  for (const entry of entries) {
    if (entry.id.length === 0 || entry.id.includes(':')) {
      diagnostics.push({ ...context, id: entry.id, code: 'INVALID_ID', position: positionAt(entry.keyOffset), message: 'Message IDs must be nonempty and cannot contain colons. Dots are literal.' });
      continue;
    }
    // Most live entries are immutable reuse hits. Build diagnostic context only
    // for messages that actually need parsing, avoiding a spread per cached ID.
    const before = reusable && Object.hasOwn(reusable, entry.id) ? reusable[entry.id] : undefined;
    if (before?.source === entry.value) {
      const position = positionAt(entry.valueOffset);
      messages[entry.id] = before.position.offset === position.offset && before.position.line === position.line &&
        before.position.column === position.column ? before : freeze({ ...before, position });
      continue;
    }
    const details = { ...context, id: entry.id };
    try {
      const ast = parseSimpleMessage(entry.value, simplePosition) ?? parse(entry.value, { ignoreTag: true, captureLocation: true, requiresOtherClause: true, locale });
      const argumentsSchema = inferArguments(ast, (argument, offset) => ({ ...details, argument, code: 'ARGUMENT_CONFLICT',
        position: positionAt(messageOffset(entry, offset)), message: `Argument ${JSON.stringify(argument)} has incompatible uses in the same message.` }), argumentSchemas);
      messages[entry.id] = freeze({ source: entry.value, position: positionAt(entry.valueOffset), ast: freezeMessageAst(ast), arguments: argumentsSchema });
    } catch (error) {
      if (error instanceof CatalogError) diagnostics.push(...error.diagnostics);
      else {
        const offset = error instanceof Error && 'location' in error
          ? (error.location as { start?: { offset?: number } })?.start?.offset ?? 0 : 0;
        diagnostics.push({ ...details, code: 'INVALID_ICU', position: positionAt(messageOffset(entry, offset)),
          message: `Invalid ICU message: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
  if (diagnostics.length) throw new CatalogError(diagnostics);
  const catalog = freeze({ ...context, messages: freezeOwnedMessageMap(messages) });
  rememberCatalogJson(catalog, source, entries);
  return catalog;
}
