# Development schema recovery

Source checkout addition; not included in published `0.1.0-alpha.9` packages.

`createStore` and `createI18n` accept optional `devSchemaRecovery`. Omitting it,
or passing `false`, keeps strict rendering as the default. The option is meant
for development clients while editing catalogs and their call sites together.

```ts
const i18n = createI18n<AppSchema>({
  catalogSource,
  locale: initialLocale,
  initialNamespaces,
  initialCatalogs,
  devSchemaRecovery: import.meta.env.DEV ? {
    maxEntries: 128,
    onDiagnostic(event) {
      // Update a development status panel; no input values or copy are supplied.
      console.info(event.status, event.reason, event.locale, event.key, event.surface);
    },
  } : false,
});
```

The same option works on an eager `createStore({ baseLocale, locale, catalogs,
devSchemaRecovery: ... })`. React, Svelte and Vue adapters use their underlying
store's behavior. `createTranslator` remains strict unless an existing error
policy is provided; it does not maintain live recovery history.

## What is retained

After a successful `snapshot.t()` or `snapshot.tParts()` call, the instance can
remember its parsed message and argument contract. If a later catalog edit
deletes that key or adds a required argument which the old call does not yet
provide, the previous message is formatted with the **current** argument values.

For example, changing `Hello {name}` to `Hello {name}, {title}` keeps rendering
`Hello Ada` for the old `{ name: 'Ada' }` call. Changing the input to `Lin` then
renders `Hello Lin`. Once the caller provides `title`, the new message renders
normally. Restoring a deleted key also uses its current message on the next
successful call.

Rich parts retain their previous tag structure; interpolated values remain text.
This lets adapters keep existing input, link and modal elements mounted. ICU
formatting and pseudo-localization still apply to the recovered message.
Recovery does not prevent application remounts or errors elsewhere in the app.

History is isolated by requested locale, base locale, time zone, message key and
text/parts surface. The default limit is 128 successful message/surface records
per instance; `maxEntries` must be a positive safe integer. Older entries are
evicted as successful calls update the history. The instance retains parsed
messages, not input values, formatted output or entire previous catalogs.
Old immutable snapshots retain their own view and cannot teach the current
instance future history or overwrite a repaired message.

## Errors and diagnostics

The following still fail without an explicit existing error policy:

- A key or surface which has never rendered successfully, or whose entry was evicted.
- An unloaded or deleted namespace.
- A wrong existing argument type, or an invalid value supplied for a new argument.
- A retained message that cannot format the current arguments.
- Unrelated ICU, rich-text or formatting errors.

Catalog validation, quarantine, schema fingerprints and type generation continue
to use the new schema immediately. Recovery does not make invalid catalogs valid
or suppress TypeScript errors in updated generated declarations.

`onDiagnostic` receives `status: 'retained' | 'resolved'`,
`reason: 'required-argument-added' | 'key-deleted'`, `key`, `locale`,
`surface: 'text' | 'parts'`, and the original error. Repeated recovery for the
same problem is deduplicated; a successful current call reports `resolved`.
Notifications run in a microtask after translation, so callbacks can update a
framework status panel. Without a callback, retained messages produce a console
warning. Disposal drops history and cancels pending notifications.

Existing `onMissingKey` and `onFormatError` policies still handle failures when
recovery does not apply. Lazy calls rejected before reaching a loaded namespace
continue to follow their existing missing-key policy.

## Client and SSR boundaries

Saylo does not detect development automatically. Guard the option with your
bundler's development flag as above. Boot serialization carries neither history,
diagnostics, input values nor this configuration. A client restored from a boot
snapshot is strict unless its own creation options opt in. Avoid enabling history
on a shared server instance; use request-scoped instances for SSR as usual.

## Try the demos

Run `npm run dev:react` or `npm run dev`. Both demos enable recovery only in
Vite development and show a correction hint while retaining previous copy.
Enter a name, open the dialog, then edit
`examples/vanilla/locales/ko/demo.json`: append ` {previewExtra}` to `heading`
or `rich`, or delete either key. Keep editing the input to check that recovered
messages use its current value, then restore the catalog.

The focused real Chrome check runs against temporary catalog copies:

```sh
node scripts/verify-demo-recovery.mjs --framework react --schema
```

It checks argument addition, key deletion, current input escaping, rich-node
identity, open-dialog and input preservation, focus/selection, and repair.
Production demo builds leave recovery disabled.
