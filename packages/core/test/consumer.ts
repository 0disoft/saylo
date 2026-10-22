import { CatalogError, createBaseSchema, createI18n, createStore, createTranslator, parseCatalog, validateTranslation } from '@0disoft/saylo-core';
import type { ArgumentType, CatalogOutcome, CatalogSchema, CatalogSource, ParsedCatalog, RichTextPart } from '@0disoft/saylo-core';
import { createI18n as createRuntimeI18n, freezeCatalogs } from '@0disoft/saylo-core/runtime';

const runtimeFactory: typeof createI18n = createRuntimeI18n;
void runtimeFactory;
// @ts-expect-error the AST runtime entry does not expose the string parser
import { parseCatalog as runtimeParser } from '@0disoft/saylo-core/runtime';

const parsed: ParsedCatalog = parseCatalog('{"x":"{n, number}"}', { locale: 'ko', namespace: 'cart' });
const frozenCatalogs: readonly ParsedCatalog[] = freezeCatalogs([parsed]);
// @ts-expect-error frozen catalog list is readonly
frozenCatalogs.push(parsed);
// @ts-expect-error the transport helper accepts catalogs, not schema records
freezeCatalogs([{ baseLocale: 'ko' }]);
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
const parts: readonly RichTextPart[] = typed.tParts('cart:items', { count: 3 });
// @ts-expect-error parts are immutable
parts.push({ type: 'text', value: 'mutation' });
// @ts-expect-error rich calls retain required base args
typed.tParts('cart:items');
// @ts-expect-error rich calls reject unknown keys
typed.tParts('cart:unknown');
// @ts-expect-error rich calls reject argument type mismatches
typed.tParts('cart:items', { count: '3' });
// @ts-expect-error unknown key
typed.t('cart:unknown');
// @ts-expect-error required args
typed.t('cart:items');
// @ts-expect-error wrong number
typed.t('cart:items', { count: '3' });
declare const key: 'cart:title' | 'cart:items';
// @ts-expect-error rich union keys also require narrowing
typed.tParts(key, { count: 3 });
// @ts-expect-error union key may require args
typed.t(key);
// @ts-expect-error union key and args have no proven correlation
typed.t(key, { count: 3 });
if (key === 'cart:items') typed.t(key, { count: 3 }); else typed.t(key);
const untyped = createTranslator({ locale: 'ko', baseCatalogs: [parsed] });
untyped.t('dynamic:key', { value: 3 });

const store = createStore<AppSchema>({ baseLocale: 'ko', locale: 'ko', catalogs: [appCatalog] });
store.t('cart:items', { count: 3 });
store.tParts('cart:items', { count: 3 });
store.getSnapshot().tParts('cart:title');
store.getSnapshot().t('cart:title');
const unsubscribe = store.subscribe(snapshot => {
  snapshot.t('cart:items', { count: 3 });
  // @ts-expect-error snapshot preserves argument types
  snapshot.t('cart:items');
});
unsubscribe();
// @ts-expect-error live store preserves argument types
store.t('cart:items', { count: '3' });
// @ts-expect-error union key still needs narrowing
store.t(key);
// @ts-expect-error immutable snapshot
store.getSnapshot().stateRevision = 10;

const bootPair: CatalogOutcome = { status: 'present', sessionId: 'initial', key: { locale: 'ko', namespace: 'cart' },
  catalogVersion: 1, namespaceSchemaFingerprint: createBaseSchema(appCatalog).fingerprint, catalog: appCatalog };
const source: CatalogSource = {
  readManifest: () => ({ sessionId: 'initial', registryRevision: 0, baseLocale: 'ko',
    availableLocales: ['ko', 'en'], availableNamespaces: ['cart'], catalogs: [bootPair] }),
  loadCatalog: async (locale, namespace, signal) => {
    void signal?.aborted;
    return { status: 'missing', sessionId: 'initial', key: { locale, namespace }, catalogVersion: 0 };
  },
};
const lazy = createI18n<AppSchema>({ catalogSource: source, locale: 'ko', initialNamespaces: ['cart'], initialCatalogs: [bootPair] });
const transition: Promise<void> = lazy.setLocale('en');
const namespace: Promise<void> = lazy.loadNamespace('cart');
const scope: Promise<void> = lazy.setNamespaces(['cart'] as const, { signal: new AbortController().signal });
void scope;
// @ts-expect-error scope must be a list of namespace names
lazy.setNamespaces('cart');
const refresh: Promise<void> = lazy.refresh();
const requestOptions = { signal: new AbortController().signal };
const cancellable: Promise<void>[] = [lazy.setLocale('en', requestOptions), lazy.loadNamespace('cart', requestOptions), lazy.refresh(requestOptions)];
void cancellable;
// @ts-expect-error cancellation requires an AbortSignal
lazy.refresh({ signal: 'abort' });
void transition; void namespace; void refresh;
lazy.t('cart:items', { count: 3 });
lazy.tParts('cart:items', { count: 3 });
// @ts-expect-error lazy parts preserve argument types
lazy.tParts('cart:items', { count: '3' });
lazy.getSnapshot().t('cart:at', { at: new Date(0) });
// @ts-expect-error lazy callers preserve required args
lazy.t('cart:items');
// @ts-expect-error lazy callers preserve value types
lazy.t('cart:items', { count: '3' });
// @ts-expect-error lazy union keys still require narrowing
lazy.t(key);
// @ts-expect-error loading requires a namespace name
lazy.loadNamespace(3);
// @ts-expect-error explicit missing has no payload
const missing: CatalogOutcome = { status: 'missing', sessionId: 'initial', key: { locale: 'en', namespace: 'cart' }, catalogVersion: 0, catalog: appCatalog };
void missing;

const serverSnapshot = lazy.getServerSnapshot();
serverSnapshot.t('cart:items', { count: 1 });
const bootSnapshot = lazy.getBootSnapshot();
const restored = createI18n<AppSchema>({ catalogSource: source, initialSnapshot: bootSnapshot });
restored.t('cart:items', { count: 1 });
// @ts-expect-error SSR boot and parsed initial scope are mutually exclusive
createI18n({ catalogSource: source, initialSnapshot: bootSnapshot, locale: 'ko', initialNamespaces: [], initialCatalogs: [] });
