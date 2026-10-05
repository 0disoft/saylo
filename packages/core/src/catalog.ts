import { parse } from '@formatjs/icu-messageformat-parser';
import { CatalogError, freeze, createPositionLocator } from './diagnostics.js';
import { messageOffset, readJson } from './json.js';
import { inferArguments } from './schema.js';
import type { CatalogDiagnostic, CatalogOptions, ParsedCatalog, ParsedMessage } from './types.js';

export function parseCatalog(source: string, options: CatalogOptions): ParsedCatalog {
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
  const entries = readJson(source, context);
  const positionAt = createPositionLocator(source);
  const diagnostics: CatalogDiagnostic[] = [];
  const messages: Record<string, ParsedMessage> = Object.create(null);
  for (const entry of entries) {
    const details = { ...context, id: entry.id };
    if (entry.id.length === 0 || entry.id.includes(':')) {
      diagnostics.push({ ...details, code: 'INVALID_ID', position: positionAt(entry.keyOffset), message: 'Message IDs must be nonempty and cannot contain colons. Dots are literal.' });
      continue;
    }
    try {
      const ast = parse(entry.value, { ignoreTag: true, captureLocation: true, requiresOtherClause: true, locale: new Intl.Locale(context.locale) });
      const argumentsSchema = inferArguments(ast, (argument, offset) => ({ ...details, argument, code: 'ARGUMENT_CONFLICT',
        position: positionAt(messageOffset(entry, offset)), message: `Argument ${JSON.stringify(argument)} has incompatible uses in the same message.` }));
      messages[entry.id] = freeze({ source: entry.value, position: positionAt(entry.valueOffset), ast, arguments: argumentsSchema });
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
  return freeze({ ...context, messages });
}
