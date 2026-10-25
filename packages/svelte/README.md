# @0disoft/saylo-svelte

On Svelte 5, subscribe to Saylo's immutable snapshot with `$i18n`. The package provides ESM JavaScript and TypeScript declaration files. This README describes `0.1.0-alpha.7` (dist-tag `alpha`). See the [release record](../../releases/0.1.0-alpha.7.md) for publication and registry verification. Svelte has been included since `0.1.0-alpha.2`. Both selector APIs below are included in the `0.1.0-alpha.4` release.

## Direct subscription

```js
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSvelteStore } from '@0disoft/saylo-svelte';

const catalog = parseCatalog('{"title":"Cart"}', { locale: 'en', namespace: 'cart' });
const instance = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
const i18n = createSvelteStore(instance);
const unsubscribe = i18n.subscribe(snapshot => console.log(snapshot.t('cart:title')));
unsubscribe();
instance.dispose();
```

In a component, declare `const i18n = createSvelteStore(instance)` and use `{$i18n.t('cart:title')}`. The key and argument types from `createStore<AppSchema>` or `createI18n<AppSchema>` are preserved through the adapter. The synchronous or asynchronous return of `setLocale` and `loadNamespace` on a lazy instance are forwarded as well.

## Passing through context

Create a typed factory once in an application module.

```ts
import { createSayloSvelte } from '@0disoft/saylo-svelte';
import type { AppSchema } from './generated';

export const { setSayloContext, getI18n } = createSayloSvelte<AppSchema>();
```

Call `setSayloContext(instance)` during initialization of a parent component. A child component receives it with `const i18n = getI18n()` from the same factory and renders `{$i18n.t('cart:items', { count: 3 })}`. Keep the parent's instance stable for the duration of the mount. Reading the context of a different factory throws a clear error.

## Selector subscriptions (selectSvelteStore and getI18nSelector)

`selectSvelteStore` creates a `Readable` that picks out only the values needed from the store. `createSayloSvelte<S>()` passes the same selector through context.

```ts
import { selectSvelteStore } from '@0disoft/saylo-svelte';

const title = selectSvelteStore(i18n, snapshot => snapshot.t('cart:title'));
```

```ts
export const { setSayloContext, getI18n, getI18nSelector } = createSayloSvelte<AppSchema>();

// 자식 컴포넌트 초기화 중
const title = getI18nSelector(snapshot => snapshot.t('cart:title'));
```

The contract is as follows.

- The signature is `selectSvelteStore<S, T>(source: SayloSvelteStore<S>, selector: (snapshot: SayloSvelteSnapshot<S>) => T, options?: SayloSelectorOptions): Readable<T>`.
- `createSayloSvelte<S>()` provides `getI18nSelector<T>(selector, options?: SayloSelectorOptions): Readable<T>` and must be called during initialization in the same factory context.
- `SayloSelectorOptions` has one property, `readonly onError?: (error: unknown) => void`.
- Results are compared with `Object.is` and forwarded through a value box `{ value }` to Svelte's `derived` notifications. The same object reference and `NaN` skip the notification, while `+0` and `-0` are delivered as different values.
- The source and shared context keep the existing single core subscription and its final release; after an SSR render ends, the core subscription count is 0.
- The first subscription and resubscriptions deliver the latest value synchronously and keep the snapshot-bound `t` and `setLocale`/`loadNamespace`.
- The existing `createSvelteStore` and `getI18n` remain unchanged.

Exceptions thrown by a selector are handled differently depending on when they occur. A failure during the first subscription or a resubscribe disposes the new subscription and then synchronously rethrows the value the selector threw (even if it is not an Error or is `undefined`), and `onError` is not called in this case. It does not return a previous successful value instead. If a failure occurs while an active subscription is updating a snapshot, the last successful value is kept, and the selector is tried again on the next snapshot without an invalidate or notification. This failure is reported through `onError`, or with `console.error('[saylo:svelte] selector failed', error)` when `onError` is not specified. If `onError` itself throws, Saylo reports it with `console.error('[saylo:svelte] selector error reporter failed', reportingError)` and Svelte notifications continue. `options` is included in the `0.1.0-alpha.4` release.

```ts
const title = selectSvelteStore(i18n, snapshot => snapshot.t('cart:title'), {
  onError: error => console.error('selector failed', error),
});
```

The constraints are as follows. Keep the selector a pure computation. If the selector captures props, changes to props alone produce no source notification, so it is not re-selected automatically. If the selector returns a new object or array every time, `Object.is` differs and a notification fires for every snapshot. Combine dynamic component arguments with the existing `$i18n` and Svelte `$derived`.

```svelte
<script lang="ts">
  let { name }: { name: string } = $props();
  const i18n = getI18n();
  const greeting = $derived($i18n.t('demo:greeting', { name }));
</script>
<p>{greeting}</p>
```

## Snapshots and ownership

- The first subscription delivers the current value synchronously. While subscribers exist, they share a single core subscription; when the last subscription ends, the core subscription and disposal listener are released.
- Catalogs that change while there are no subscribers are read on the next subscription. `t` from an earlier snapshot keeps the earlier translations.
- Svelte disposes a component's `$i18n` subscription. The caller that created the instance is responsible for `dispose()`. The adapter does not discard the instance.
- In SSR, create an instance per request and pass it to the parent context. Factories can be shared, but do not share an instance across the server. Create the first server and client instances from the same core boot snapshot, and start the live connection after mount.

Run verification with `npm run test --workspace=@0disoft/saylo-svelte` and `npm run typecheck:consumers --workspace=@0disoft/saylo-svelte`. The covered scope includes SSR requests and nested context isolation, hydration of matching SSR markup, unsubscription, snapshot-bound translation, JS/TS consumers, and preservation of input, focus, cursor, dialog, and state in compiled components. The [Svelte demo](https://github.com/0disoft/saylo/tree/main/examples/svelte) and [implementation notes](https://github.com/0disoft/saylo/blob/main/docs/38-svelte-adapter.md) describe how to connect it and the real browser verification.

## Rich text component (RichText.svelte)

Renders parts returned by core `tParts` as a Svelte 5 component. The root entry keeps the store API and exports only the `RichTextProps` and `RichTextRenderers` types; the component is imported separately as a default import. The root import works in Node SSR without compiling Svelte.

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { RichTextPart } from '@0disoft/saylo-core';
  import RichText from '@0disoft/saylo-svelte/RichText.svelte';

  let { parts }: { parts: readonly RichTextPart[] } = $props();
</script>

{#snippet strong(children: Snippet)}
  <strong>{@render children()}</strong>
{/snippet}

{#snippet link(children: Snippet)}
  <a href="#order-form">{@render children()}</a>
{/snippet}

<RichText {parts} renderers={{ strong, link }} />
```

The props are `parts: readonly RichTextPart[]` and an optional `renderers?: Readonly<Record<string, Snippet<[Snippet]>>>`. A renderers value is a snippet that receives one child renderer, and the app calls `{@render children()}` to render the inner parts at that position.

The contract is as follows.

- Text parts become template text and Svelte escapes them. The component does not use `{@html}`.
- A tag part is rendered with a snippet only when its name is an own property of renderers and the value is a snippet. If it is missing or not a snippet, no tag is created and only the children are rendered.
- Lookup checks own properties only. Names inherited from the prototype, such as `constructor` and `toString`, render only their children.
- Saylo does not create arbitrary DOM tags, HTML, attributes, or URLs from names that come from the catalog. Links and attributes are added only to names the app puts in renderers.
- Keys are the tag name plus an occurrence number (`tag:link:0`, `tag:link:1`). Node identity is preserved after copy edits or literal insertions.
- A renderers snippet must keep the same type for the same tag. If the type changes, the node is recreated and input, focus, and state are lost.

`dist/RichText.svelte` is published as source and compiled by the consumer's Svelte 5 compiler. It ships with the helper JS and type declarations and is used with the existing Svelte 5 and `@sveltejs/vite-plugin-svelte` 7 setup. To SSR the component in Node, the consumer compiles it with the Svelte compiler.

The contract, key rules, demo, and verification status are described in [80-svelte-rich-text.md](https://github.com/0disoft/saylo/blob/main/docs/80-svelte-rich-text.md). This component is in local commit `010a600` and is not in the `0.1.0-alpha.4` release.

## Questions and security reports

Send general questions, feature proposals, and bugs to [rodisoft1@gmail.com](mailto:rodisoft1@gmail.com). Include the package and version, the environment, expected and actual behavior, and a minimal reproduction built from synthetic data. Report security issues privately to the same email with a `Saylo security` subject. Do not send tokens, keys, cookies, or real user data.

If you installed the Vite package, you can read the fuller guidance in `node_modules/@0disoft/saylo-vite/docs/support.md` and `security.md`. These guides and the package contact metadata are included in alpha.5. Earlier alpha.4 tarballs do not contain them.

Licensed under Apache-2.0, and the tarball includes `LICENSE` and `NOTICE`.
