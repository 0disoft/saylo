# @0disoft/saylo-react

The React 19 binding for Saylo. `createSayloReact` creates a typed Provider and the `useI18n` and `useI18nSelector` hooks, both of which subscribe to the store snapshot with `useSyncExternalStore`.

## Status

This README describes `0.1.0-alpha.5` (dist-tag `alpha`). See the [release record](https://github.com/0disoft/saylo/blob/main/releases/0.1.0-alpha.5.md) for publication and registry verification. `0.1.0-alpha.1` was published on 2026-10-06 and `0.1.0-alpha.2` on 2026-10-09. `useI18nSelector` below is included in the `0.1.0-alpha.4` release. You can also use the package from this repository's workspace or from an `npm pack` tarball.

## Installation

```sh
npm install @0disoft/saylo-react@alpha @0disoft/saylo-core@alpha react@19 react-dom@19
```

The `latest` tag of Saylo packages still points to a registration placeholder, so specify `@alpha`. `react` is a peer dependency and the current requirement is React 19. `react-dom` is needed when rendering in an app, and `@0disoft/saylo-core` is a runtime dependency.

## Usage

Create the factory once per module, and take the Provider and hook from the same factory. Pass the instance owned by the app to the Provider; this instance must not change between renders. The example below works with only the core package, without Vite or typegen.

```tsx
import { createRoot } from 'react-dom/client';
import { parseCatalog, createStore } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';

const ko = parseCatalog('{"greeting":"안녕 {name}"}', { locale: 'ko', namespace: 'demo' });
const en = parseCatalog('{"greeting":"Hello {name}"}', { locale: 'en', namespace: 'demo' });

// 기준 로케일에서 만든 타입이다. saylo-typegen이 같은 형태를 생성한다.
type AppSchema = { 'demo:greeting': { name: number | string } };

export const store = createStore<AppSchema>({ baseLocale: 'ko', locale: 'en', catalogs: [ko, en] });
export const { SayloProvider, useI18n } = createSayloReact<AppSchema>();

function Greeting() {
  const { t, locale, setLocale } = useI18n();
  return (
    <button onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}>
      {t('demo:greeting', { name: 'Saylo' })}
    </button>
  );
}

createRoot(document.getElementById('root')!).render(
  <SayloProvider instance={store}>
    <Greeting />
  </SayloProvider>,
);
```

`useI18n` returns the immutable snapshot for that render and `setLocale`. With the same snapshot and instance, the hook result stays stable, and edits to unchanged copy or an inactive locale do not re-render. The Provider does not own the instance's lifetime, so the app cleans it up with `store.dispose()`. With a lazy instance (`createI18n`), `setLocale` returns `Promise<void>` and `loadNamespace` is provided as well.

Applying a saved file immediately, `virtual:saylo`, and SSR hydration are covered by the Vite connection in the related packages below. You can also refer to the repository's [React example](https://github.com/0disoft/saylo/tree/main/examples/react) and [SSR example](https://github.com/0disoft/saylo/tree/main/examples/ssr).

## Selector subscriptions (useI18nSelector)

`createSayloReact<S>()` provides `useI18nSelector` in addition to `useI18n`. The selector receives that render's `SayloReactSnapshot<S>` and picks out only the values it needs.

```tsx
export const { SayloProvider, useI18nSelector } = createSayloReact<AppSchema>();

function Greeting({ name }: { name: string }) {
  const text = useI18nSelector(snapshot => snapshot.t('demo:greeting', { name }));
  return <p>{text}</p>;
}

function LocaleBadge() {
  return <span>{useI18nSelector(snapshot => snapshot.locale)}</span>;
}

function LocaleButton() {
  const setLocale = useI18nSelector(snapshot => snapshot.setLocale);
  return <button onClick={() => setLocale('ko')}>ko</button>;
}
```

The contract is as follows.

- The signature is `useI18nSelector<T>(selector: (snapshot: SayloReactSnapshot<S>) => T): T`.
- Internally it subscribes to the selection result with `useSyncExternalStore`. It caches the selector result for repeated reads with the same instance, selector, and raw snapshot, so a selector that returns a new object does not fall into a repeated read loop.
- Results are compared with `Object.is`. If the selected value or reference is equal by `Object.is`, the render caused by a store update is skipped. Renders caused by parent or local state changes still happen.
- The hook keeps the same snapshot-bound `t`, `setLocale`, and optional `loadNamespace`, and uses `getServerSnapshot` during SSR.
- `useI18n` remains unchanged. Use `useI18n` when you need the whole snapshot.

The constraints are as follows.

- The selector may run again for each snapshot and may capture the render's props and state. It must compute values without side effects and must not depend on mutable globals that are not subscribed.
- Returning an unchanged object reference skips the re-render. If the selector creates a new object or array every time, it re-renders whenever the snapshot changes. When you need a derived list, return the original references and do the needed calculation in the render.
- Included in the `0.1.0-alpha.4` release. Publication history is in the [release records](https://github.com/0disoft/saylo/tree/main/releases).

## Rich text rendering (renderRichText)

`renderRichText` renders the read-only parts returned by `snapshot.tParts(key, args)` as React nodes. It is a pure function, and the `renderers` passed by the app decide which element each tag becomes. Saylo does not create HTML or attributes.

```ts
type RichTextRenderers = Readonly<Record<string, (children: ReactNode) => ReactNode>>;
function renderRichText(parts: readonly RichTextPart[], renderers?: RichTextRenderers): ReactNode;
```

The contract is as follows.

- Text parts become React text as-is. React escapes it, so it is not interpreted as HTML.
- A tag part becomes the result of a function only when its name is an own property of `renderers` and the value is a function. If it is missing or not a function, no tag is created and only the children are rendered in sequence.
- Saylo does not create arbitrary DOM tags, HTML, attributes, or URLs from names that come from the catalog. Links and attributes are added only to names the app has put on its own list.
- Nested tags are supported.
- Fragment keys combine the tag name with that name's occurrence number (`link:0`, `link:1`). Editing or inserting literals keeps the identity of mapped components. Renderer callbacks must return the same element or component type for the same tag. If the type changes, React remounts and input, focus, and state are lost.
- Parsing errors are thrown by the core `tParts`. The helper accepts only valid parts.

This example uses its own store, separate from the earlier example.

```tsx
import { createRoot } from 'react-dom/client';
import { parseCatalog, createStore } from '@0disoft/saylo-core';
import { createSayloReact, renderRichText } from '@0disoft/saylo-react';
import type { RichTextRenderers } from '@0disoft/saylo-react';

const ko = parseCatalog('{"rich":"<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요."}', { locale: 'ko', namespace: 'demo' });
type OrderSchema = { 'demo:rich': { name: number | string } };

const orderStore = createStore<OrderSchema>({ baseLocale: 'ko', locale: 'ko', catalogs: [ko] });
const { SayloProvider: OrderProvider, useI18n: useOrder } = createSayloReact<OrderSchema>();

const renderers: RichTextRenderers = {
  strong: children => <strong>{children}</strong>,
  link: children => <a href="#order-form">{children}</a>,
};

function OrderLine({ name }: { name: string }) {
  const snapshot = useOrder();
  return <p id="rich-preview">{renderRichText(snapshot.tParts('demo:rich', { name }), renderers)}</p>;
}

createRoot(document.getElementById('root')!).render(
  <OrderProvider instance={orderStore}><OrderLine name="Saylo" /></OrderProvider>,
);
```

This helper is included in alpha.5. Follow the [React rich text notes](../../docs/79-react-rich-text.md) for usage and verification scope.

## Related packages

- [@0disoft/saylo-core](https://github.com/0disoft/saylo/tree/main/packages/core#readme) — parsing, validation, and store
- [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme) — `virtual:saylo`, dev connection, SSR
- [@0disoft/saylo-typegen](https://github.com/0disoft/saylo/tree/main/packages/typegen#readme) — generates `AppSchema`

## Versions

Supports Node.js 24.x. `engines.node` is `24.x`, and the local verification environment is Node 24.18.0. It is verified against TypeScript 7, and `typescript` is not enforced as a peer.

The runtime target is ES2022, and because it targets browsers it does not depend on Node APIs. The peer requirement is React 19; Vite 8 is a requirement of [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme).

## Questions and security reports

Send general questions, feature proposals, and bugs to [rodisoft1@gmail.com](mailto:rodisoft1@gmail.com). Include the package and version, the environment, expected and actual behavior, and a minimal reproduction built from synthetic data. Report security issues privately to the same email with a `Saylo security` subject. Do not send tokens, keys, cookies, or real user data.

If you installed the Vite package, you can read the fuller guidance in `node_modules/@0disoft/saylo-vite/docs/support.md` and `security.md`. These guides and the package contact metadata are included in alpha.5. Earlier alpha.4 tarballs do not contain them.

## License

Apache-2.0. The distribution tarball includes the repository root `LICENSE` and `NOTICE`.
