# Runtime translation error policy

These optional callbacks are included in the alpha.8 build.

Saylo keeps the strict behavior by default: unknown keys, unloaded namespaces, invalid arguments and formatter failures throw their original errors. An app can opt into bounded fallbacks on `createTranslator`, `createStore`, `createI18n` and `createServerI18n`.

```ts
const translator = createTranslator({
  locale: 'en',
  baseCatalogs,
  translations,
  onMissingKey: context => context.key === 'demo:optional' ? '' : undefined,
  onFormatError: context => `[${context.locale}: ${context.argument ?? context.error.name}]`,
});
```

`onMissingKey` handles `UnknownMessageError` and `NamespaceNotLoadedError`. `onFormatError` handles `InvalidArgumentError` and failures raised by `IntlMessageFormat` or native `Intl` formatters while rendering a message. Catalog parsing, translation validation, loading and source failures stay outside this policy and still reject or throw normally.

Both callbacks receive the original error and the call context.

| Field | Meaning |
| --- | --- |
| `error` | The original error object. |
| `key` | The requested message key. |
| `locale` | The selected locale for this translator or snapshot. |
| `baseLocale` | The catalog schema locale. |
| `namespace`, `messageId` | Parsed from a well-formed key when available. |
| `surface` | `text` for `t`, or `parts` for `tParts`. |
| `argument` | The invalid argument name when the error is `InvalidArgumentError`. |

Returning a string supplies the fallback. Returning `undefined` rethrows the identical original error. An exception from a callback propagates as-is, and Saylo does not then try the other callback. A callback that returns a value other than a string or `undefined` raises a `TypeError`.

For `tParts`, a string fallback becomes a frozen single text part. Its contents are literal, so `<strong>` in a fallback is text and is never parsed as rich markup.

```ts
const parts = translator.tParts('demo:optional');
// [{ type: 'text', value: '' }]
```

`createStore` captures these callbacks when the store is created and keeps the same references on later locale and catalog snapshots. `createI18n` does the same for its initial snapshot and later refresh or locale snapshots. `createServerI18n` forwards the callbacks to its request instance. Mutating the original options object does not change an existing instance.

The callbacks are runtime functions. Boot snapshots and `serializeBootSnapshot` contain catalogs, manifests and rendering metadata only; callbacks are never serialized or sent to the client.

Configure matching policies separately on the server and client before hydration so both render the same text.

When neither callback is configured, rendering uses the strict path directly without per-call context objects, handler dispatch or formatter error marking.
