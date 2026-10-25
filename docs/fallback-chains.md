# Message fallback chains

This guide describes the explicit fallback API included in the alpha.8 build. Version labels for the starter templates remain unchanged.

Saylo resolves a message from the selected locale, then from an optional ordered list of fallback locales, and finally from the base locale catalog. Existing instances keep the default selected-locale-then-base behavior. Parent languages are not inferred automatically.

```ts
const i18n = createI18n({
  locale: 'en-GB',
  fallbackLocales: ['en'],
  catalogSource,
  initialNamespaces: ['common'],
  initialCatalogs,
});
```

Here the lookup order for a missing message is `en-GB`, `en`, then the base locale. A fallback is considered only when the message is absent from the earlier catalog. Empty translated text counts as present. Argument contracts still come from the base catalog, and ICU values are formatted with the locale of the catalog that supplied the message.

The same option is accepted by `createTranslator`, `createStore`, `createI18n`, and `createServerI18n`. `virtual:saylo/server` forwards it through the partial options of `createRequestI18n`.

## Chain rules

- Entries are canonicalized with `Intl.getCanonicalLocales`. Two entries that become the same canonical tag are rejected, such as `en` and `EN`.
- Explicit order is priority order. `['de', 'en']` tries German before English.
- An entry equal to the selected locale is already satisfied and does not add another lookup.
- An entry equal to the base locale is ignored because the base locale is always terminal.
- Each usable locale contributes at most one catalog lookup per namespace, so the chain is bounded by unique available locales rather than repeated tags.
- A fallback locale must be available in the eager registry or catalog manifest. Removing one of them from a later manifest keeps the previous lazy snapshot and rejects the transition.
- Missing namespaces and missing message IDs both continue to the next catalog. Catalog parse, schema validation, load, timeout, and source failures do not.

These options can be combined with the translation error policy. With no matching message in any catalog, the existing missing-key behavior remains: `UnknownMessageError` is thrown unless `onMissingKey` supplies a bounded fallback.

## Snapshots, loading, and SSR

Eager stores capture the normalized fallback list when the store is created and use it for locale changes and catalog replacement. Lazy instances load every base, selected, and fallback pair in the current scope as one reconciliation. A stale or canceled caller cannot publish a partial chain, and an unchanged signature keeps the existing snapshot.

Boot snapshots include the configured `fallbackLocales` list and the loaded pair outcomes for the full chain. The field is additive to the existing v1 and v2 wire formats. Payloads without the field continue to decode with the default selected-then-base behavior. Hydration uses the chain recorded in its boot snapshot; a caller-provided chain must match it.

The static catalog source already accepts locale-neutral keys, so fallback pairs use the same manifest metadata, generated chunks, timeout, cancellation, and in-flight sharing as selected pairs.
