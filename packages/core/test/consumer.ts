import { CatalogError, createBaseSchema, createTranslator, parseCatalog, validateTranslation } from '@saylo/core';
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

type AppSchema = { 'cart:title': {}; 'cart:items': { count: number }; 'cart:at': { at: number | Date } };
const appCatalog = parseCatalog('{"title":"Cart","items":"{count, number}","at":"{at, date}"}', { locale: 'ko', namespace: 'cart' });
const typed = createTranslator<AppSchema>({ locale: 'ko', baseCatalogs: [appCatalog] });
typed.t('cart:title');
typed.t('cart:items', { count: 3 });
typed.t('cart:at', { at: new Date(0) });
// @ts-expect-error unknown key
typed.t('cart:unknown');
// @ts-expect-error required args
typed.t('cart:items');
// @ts-expect-error wrong number
typed.t('cart:items', { count: '3' });
declare const key: 'cart:title' | 'cart:items';
// @ts-expect-error union key may require args
typed.t(key);
// @ts-expect-error union key and args have no proven correlation
typed.t(key, { count: 3 });
if (key === 'cart:items') typed.t(key, { count: 3 }); else typed.t(key);
const untyped = createTranslator({ locale: 'ko', baseCatalogs: [parsed] });
untyped.t('dynamic:key', { value: 3 });
