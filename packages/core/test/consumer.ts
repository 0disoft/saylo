import { CatalogError, createBaseSchema, parseCatalog, validateTranslation } from '@saylo/core';
import type { ArgumentType, CatalogSchema, ParsedCatalog } from '@saylo/core';

const parsed: ParsedCatalog = parseCatalog('{"x":"{n, number}"}', { locale: 'ko', namespace: 'cart' });
const base: CatalogSchema = createBaseSchema(parsed);
validateTranslation(base, parseCatalog('{"x":"{n}"}', { locale: 'en', namespace: 'cart' }));
const accepted: readonly ArgumentType[] = base.keys.x!.n!.acceptedTypes;
void accepted;
const error = new CatalogError([]);
void error.diagnostics;

// @ts-expect-error source must be JSON text
parseCatalog({}, { locale: 'ko', namespace: 'cart' });
// @ts-expect-error required namespace
parseCatalog('{}', { locale: 'ko' });
// @ts-expect-error base schema is not a parsed catalog
validateTranslation(parsed, parsed);
// @ts-expect-error immutable catalog
parsed.locale = 'en';
// @ts-expect-error immutable AST
parsed.messages.x!.ast.push({ type: 0, value: 'changed' });
// @ts-expect-error immutable argument types
base.keys.x!.n!.acceptedTypes.push('string');
