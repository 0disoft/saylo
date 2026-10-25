import { CatalogError, createBaseSchema, createI18n, createServerI18n, createStore, createTranslator, parseCatalog, validateTranslation } from '@0disoft/saylo-core';
import type { CatalogCacheOptions } from '@0disoft/saylo-core';
import type { ArgumentType, CatalogOutcome, CatalogSchema, CatalogSource, FormatErrorContext, FormatErrorHandler, LocaleFallbackOptions,
  MissingKeyErrorContext, MissingKeyHandler, ParsedCatalog, RichTextPart, ServerI18nOptions, SharedI18nOptions,
  TranslationErrorPolicy } from '@0disoft/saylo-core';
import { createI18n as createRuntimeI18n, freezeCatalogs, resolveLocale, resolveAcceptLanguage, parseAcceptLanguage } from '@0disoft/saylo-core/runtime';
import type { LanguagePreference } from '@0disoft/saylo-core';
import { encodeCatalog, decodeCatalog, serializeBootSnapshot } from '@0disoft/saylo-core/runtime';
import type { BootSnapshot, CompactCatalog } from '@0disoft/saylo-core/runtime';
const compactContract = (catalog: ParsedCatalog, boot: BootSnapshot) => {
  const wire: CompactCatalog = encodeCatalog(catalog);
  const restored: ParsedCatalog = decodeCatalog(wire);
  const html: string = serializeBootSnapshot(boot, { compact: true });
  // @ts-expect-error compact wire catalog messages are readonly
  wire.messages.push([]);
  // @ts-expect-error compact is a boolean policy
  serializeBootSnapshot(boot, { compact: 'yes' });
  return { restored, html };
};
void compactContract;

const selectedLocale: string = resolveLocale(['en-GB'] as const, ['ko', 'en'] as const, 'ko');
const httpLocale: string = resolveAcceptLanguage(null, ['ko', 'en'], 'ko');
const preferences: readonly LanguagePreference[] = parseAcceptLanguage('en;q=0.8');
void selectedLocale; void httpLocale;
// @ts-expect-error parsed language preferences are readonly
preferences.push({ range: 'ko', quality: 0 });
// @ts-expect-error preference quality is readonly
preferences[0]!.quality = 0;
// @ts-expect-error locale candidates must be strings
resolveLocale([42], ['ko'], 'ko');

const runtimeFactory: typeof createI18n = createRuntimeI18n;
void runtimeFactory;
// @ts-expect-error the AST runtime entry does not expose the string parser
import { parseCatalog as runtimeParser } from '@0disoft/saylo-core/runtime';

const parsed: ParsedCatalog = parseCatalog('{"x":"{n, number}"}', { locale: 'ko', namespace: 'cart' });
parseCatalog('{"terms":"<link>Terms</link>"}', { locale: 'ko', namespace: 'cart', richText: { terms: ['link'] } });
// @ts-expect-error rich contracts require arrays of allowed tag names
parseCatalog('{}', { locale: 'ko', namespace: 'cart', richText: { terms: 'link' } });
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
const onMissingKey: MissingKeyHandler = (context: MissingKeyErrorContext) => {
  const error: Error = context.error;
  const namespace: string | undefined = context.namespace;
  const messageId: string | undefined = context.messageId;
  const surface: 'text' | 'parts' = context.surface;
  void error; void namespace; void messageId; void surface;
  return context.key === 'cart:missing' ? '' : undefined;
};
const onFormatError: FormatErrorHandler = (context: FormatErrorContext) => {
  const argument: string | undefined = context.argument;
  const locale: string = context.locale;
  const baseLocale: string = context.baseLocale;
  void argument; void locale; void baseLocale;
  return undefined;
};
const policy: TranslationErrorPolicy = { onMissingKey, onFormatError };
const fallbackOptions: LocaleFallbackOptions = { fallbackLocales: ['en'] as const };
const cacheOptions: CatalogCacheOptions = { maxCachedCatalogs: 4 };
// @ts-expect-error handlers must return a string or undefined
const invalidMissingHandler: MissingKeyHandler = () => 3;
void invalidMissingHandler;
const appCatalog = parseCatalog('{"title":"Cart","items":"{count, number}","at":"{at, date}"}', { locale: 'ko', namespace: 'cart' });
const policyTyped = createTranslator<AppSchema>({ locale: 'ko', baseCatalogs: [appCatalog], ...policy });
policyTyped.t('cart:title');
policyTyped.tParts('cart:title');
const typed = createTranslator<AppSchema>({ locale: 'ko', baseCatalogs: [appCatalog] });
const fallbackTyped = createTranslator<AppSchema>({ locale: 'en-GB', baseCatalogs: [appCatalog], ...fallbackOptions });
fallbackTyped.t('cart:title');
// @ts-expect-error fallback locales must be strings
createTranslator({ locale: 'en-GB', baseCatalogs: [appCatalog], fallbackLocales: [3] });
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

const store = createStore<AppSchema>({ baseLocale: 'ko', locale: 'ko', catalogs: [appCatalog], ...policy, ...fallbackOptions });
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
const sharedPolicy: SharedI18nOptions = { catalogSource: source, ...policy, ...fallbackOptions, ...cacheOptions };
const lazy = createI18n<AppSchema>({ ...sharedPolicy, locale: 'ko', initialNamespaces: ['cart'], initialCatalogs: [bootPair] });
const serverPolicy: ServerI18nOptions = { catalogSource: source, locale: 'ko', initialNamespaces: ['cart'], ...policy, ...fallbackOptions, ...cacheOptions };
const request = createServerI18n<AppSchema>(serverPolicy);
void request;
// @ts-expect-error cache budgets are numbers
createServerI18n({ ...serverPolicy, maxCachedCatalogs: '4' });
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
const fallbackMetadata: readonly string[] | undefined = bootSnapshot.fallbackLocales;
void fallbackMetadata;
// @ts-expect-error boot fallback metadata is readonly
bootSnapshot.fallbackLocales?.push('en');
const restored = createI18n<AppSchema>({ catalogSource: source, initialSnapshot: bootSnapshot });
restored.t('cart:items', { count: 1 });
// @ts-expect-error SSR boot and parsed initial scope are mutually exclusive
createI18n({ catalogSource: source, initialSnapshot: bootSnapshot, locale: 'ko', initialNamespaces: [], initialCatalogs: [] });
