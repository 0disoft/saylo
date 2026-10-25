# Catalog cache budgets

These cache limits are available in the source checkout and have not been published in `0.1.0-alpha.7`.

Saylo keeps its existing unbounded catalog cache by default. An app can opt into a finite soft limit with `maxCachedCatalogs` on `createI18n`, `createServerI18n`, `createStaticCatalogSource`, or the Vite plugin's production static source.

```ts
const i18n = createI18n({
  catalogSource,
  locale: 'en-GB',
  initialNamespaces: ['common', 'settings'],
  initialCatalogs,
  fallbackLocales: ['en'],
  maxCachedCatalogs: 24,
});
```

```ts
saylo({
  localesDir: 'locales',
  baseLocale: 'ko',
  maxCachedCatalogs: 24,
});
```

The value must be a nonnegative safe integer. Fractional numbers, negative numbers, `NaN`, infinities, nonnumbers and unsafe integers throw a `RangeError` during setup. Omitting the option keeps the previous unbounded behavior.

The limit counts completed catalog outcomes retained in one cache. It is a soft limit, not "this many inactive catalogs in addition to the active scope." Entries required by the active scope can keep the cache above the configured number. In core, the current committed scope, the desired scope, fallback-chain pairs and in-flight loads are protected. In the static source, the inline boot outcomes are pinned permanently because that source does not know the store's current scope. Size a budget for the active scope plus the recent inactive pairs you want to retain.

When the cache is above its limit, core and the static source evict the least recently used unprotected outcome. A cache hit makes that pair the most recent. In core, releasing an old namespace or locale scope makes those pairs eligible; a later request loads them again if they have been evicted. Manifest changes invalidate stale outcomes before the cache is trimmed. Queued physical source slots and cancellation behavior are unchanged, including slots retained after a timed-out load ignores its abort.

`maxCachedCatalogs: 0` disables retention beyond protected entries. Core keeps the current and desired scope, fallback pairs and active flights for correctness. The static source keeps its inline boot outcomes and any import that has not settled, then drops an additional decoded outcome after it is delivered. A later request for that pair invokes its generated import again.

The budgets apply separately to each layer. The core instance and a static catalog source each maintain their own cache. `createServerI18n` accepts the core option for its request instance. Boot snapshots and the SSR wire do not serialize cache controls, so configure matching budgets separately on the server and client.

These controls limit retained decoded outcomes inside Saylo. They do not establish a total browser memory bound: committed store snapshots retain their catalogs, generated dynamic imports may remain in the browser's ESM module cache, and browser storage and rendering retain other data. Re-importing an evicted pair can reuse an already evaluated module, so a reload is not proof that the prior module's memory was released.

A finite budget is most useful for apps that repeatedly move through many namespaces or locales. Measure the active scope and typical revisit pattern before choosing one; an unnecessarily small budget trades memory for repeated cache misses without guaranteeing lower total process memory.
