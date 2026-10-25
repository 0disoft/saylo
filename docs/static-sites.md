# Static Astro and SvelteKit sites

Saylo can prepare translations during a static build and hand the resulting files to a plain static host. The [`examples/astro-static`](../examples/astro-static/) and [`examples/sveltekit-static`](../examples/sveltekit-static/) directories are standalone npm consumers that use this pattern.

The Astro example uses Astro 7, TypeScript 6, and `@astrojs/check` 0.9. The SvelteKit example uses SvelteKit 3, `@sveltejs/adapter-static` 4, Svelte 5, `@sveltejs/vite-plugin-svelte` 7, Vite 8, and TypeScript 6. Both examples declare `^0.1.0-alpha.8` for `@0disoft/saylo-core`, `@0disoft/saylo-typegen`, and `@0disoft/saylo-vite`; the SvelteKit example also declares `@0disoft/saylo-svelte`.

To try either example as a standalone consumer, copy its folder to an empty directory or enter the folder in this checkout, then run these commands from inside that example folder:

```sh
bun install
bun run build
```

The Astro example uses the public imports `@0disoft/saylo-core`, `@0disoft/saylo-core/runtime`, `@0disoft/saylo-typegen/config`, `@0disoft/saylo-vite`, and the `saylo-vite` virtual modules `virtual:saylo/server` and `virtual:saylo/lazy`. The SvelteKit example uses those imports and adds `@0disoft/saylo-svelte`. The typegen CLI binaries are `saylo-typegen` and `saylo` from `@0disoft/saylo-typegen`. No example imports a package's source file or a workspace-relative package path.

The production output has no Saylo server. Astro writes static files to `dist/`; SvelteKit with `adapter-static` writes them to `build/`. Build-time server hooks and `*.server.ts` modules are allowed. Deployed hosting must not require request headers, cookies, form actions, or another application server to render a page.

## Shared project configuration

Both examples keep the same Saylo configuration and the same catalog contents. The important parts are the base locale, the complete-translation policy, the small typegen output, and an empty default lazy namespace scope.

```json
{
  "format": "saylo-project/v1",
  "localesDir": "locales",
  "baseLocale": "en",
  "initialNamespaces": [],
  "timeZone": "UTC",
  "checkLocales": ["en", "ko", "ja"],
  "requireCompleteTranslations": true,
  "typegen": { "outFile": "src/lib/generated.d.ts" }
}
```

`initialNamespaces: []` stops the Vite plugin from putting every base namespace into the browser's initial lazy scope. It does not remove catalogs from the build. The prerender code below explicitly requests `common`, and the complete-translation check still covers every namespace in all three `checkLocales`.

Each locale has the same two files and message keys:

```text
locales/
  en/
    common.json
    cart.json
  ko/
    common.json
    cart.json
  ja/
    common.json
    cart.json
```

The message contract is `{ "hello": "Hello, {name}!", "total": "{count, number} total" }` for English `common.json` and `{ "items": "{count, plural, one {# item} other {# items}}" }` for English `cart.json`. Korean uses `안녕하세요, {name}!`, `{count, number} 합계`, and `상품 {count, plural, other {#개}}`. Japanese uses `こんにちは、{name}！`, `合計 {count, number}`, and `商品 {count, plural, other {#個}}`.

All locale directories must contain the same `common` and `cart` keys. `requireCompleteTranslations: true` turns a missing key or namespace into a build failure. A catalog argument schema that disagrees with the base locale also fails validation.

## Vite plugin setup

Read the shared JSON through the public typegen entry point and keep the project file paths anchored to the configuration file:

```js
import { loadProjectConfig } from '@0disoft/saylo-typegen/config';
import saylo from '@0disoft/saylo-vite';

const project = loadProjectConfig('./saylo.config.json');
const plugin = saylo({ ...project, maxCachedCatalogs: 6 });
```

Astro connects that plugin through `vite.plugins`:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { loadProjectConfig } from '@0disoft/saylo-typegen/config';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  vite: {
    plugins: [saylo({ ...loadProjectConfig('./saylo.config.json'), maxCachedCatalogs: 6 })],
  },
});
```

SvelteKit uses the static adapter alongside the Saylo plugin:

```js
// vite.config.mjs
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { loadProjectConfig } from '@0disoft/saylo-typegen/config';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [
    sveltekit({ adapter: adapter() }),
    saylo({ ...loadProjectConfig('./saylo.config.json'), maxCachedCatalogs: 6 }),
  ],
});
```

Enable prerendering and the trailing-slash shape in the SvelteKit root layout:

```ts
// src/routes/+layout.ts
export const prerender = true;
export const trailingSlash = 'always';
```

`maxCachedCatalogs: 6` gives the browser source a soft cache for six decoded locale/namespace outcomes. Initial boot outcomes stay pinned while they are part of the active scope.

## Astro prerendering

Astro needs `getStaticPaths()` to enumerate the locale routes. The page then prepares only the namespaces needed for its first render, serializes a compact boot snapshot, and disposes the build instance in `finally`.

```astro
---
// src/pages/[locale].astro
import { serializeBootSnapshot } from '@0disoft/saylo-core/runtime';
import { createRequestI18n } from 'virtual:saylo/server';
import type { AppSchema } from '../lib/generated';
import { locales } from '../lib/locales';

export function getStaticPaths() {
  return locales.map(locale => ({ params: { locale } }));
}

const instance = await createRequestI18n<AppSchema>({
  locale: Astro.params.locale!,
  initialNamespaces: ['common'],
});

let boot: string;
let heading: string;
try {
  boot = serializeBootSnapshot(instance.getBootSnapshot(), { compact: true });
  heading = instance.t('common:hello', { name: 'Saylo' });
} finally {
  instance.dispose();
}
---
<html lang={Astro.params.locale}>
  <body>
    <h1>{heading}</h1>
    <script id="saylo-boot" type="application/json" set:html={boot!}></script>
    <script>import '../lib/client';</script>
  </body>
</html>
```

`virtual:saylo/server` is available to the Astro build, so the request instance and boot serialization happen during prerendering. The generated page contains data and assets for the static host; it does not contain a running Saylo server. `getStaticPaths()` is the route contract for these dynamic path parameters; see the [Astro 7 routing reference](https://docs.astro.build/en/reference/routing-reference/#getstaticpaths).

## SvelteKit prerendering

With `prerender = true`, `entries()` tells SvelteKit which locale values to prerender. The `+page.server.ts` load function runs during the build and uses the same virtual server module as Astro. The resulting `build/` directory is deployed on its own.

```ts
// src/routes/[locale]/+page.server.ts
import { error } from '@sveltejs/kit';
import { serializeBootSnapshot } from '@0disoft/saylo-core/runtime';
import { createRequestI18n } from 'virtual:saylo/server';
import type { PageServerLoad } from './$types';
import type { AppSchema } from '../../lib/generated';
import { locales } from '../../lib/locales';

export function entries() {
  return locales.map(locale => ({ locale }));
}

export const load: PageServerLoad = async ({ params }) => {
  if (!locales.some(locale => locale === params.locale)) error(404, 'Unknown locale');
  const instance = await createRequestI18n<AppSchema>({
    locale: params.locale,
    initialNamespaces: ['common'],
  });
  try {
    return { boot: serializeBootSnapshot(instance.getBootSnapshot(), { compact: true }) };
  } finally {
    instance.dispose();
  }
};
```

A prerender hook may still stamp the document language. It runs only while SvelteKit writes the files:

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit/hooks';
import { locales } from './lib/locales';

export const handle: Handle = ({ event, resolve }) => {
  const locale = locales.find(value => value === event.params.locale) ?? 'en';
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('<html lang="en">', `<html lang="${locale}">`),
  });
};
```

The hook and `+page.server.ts` do not make the output server-rendered. They execute during the static build. See the [SvelteKit 3 adapter-static documentation](https://svelte.dev/docs/kit/adapter-static) for the adapter contract and prerendered output.

## Browser boot and language changes

The HTML carries the compact boot JSON. The browser decodes it and creates an instance with `initialSnapshot`; it does not call the server renderer or fetch every locale catalog.

```ts
import { createI18n, decodeBootSnapshot } from '@0disoft/saylo-core/runtime';
import { catalogSource } from 'virtual:saylo/lazy';
import type { AppSchema } from './generated';

const boot = decodeBootSnapshot(document.querySelector('#saylo-boot')!.textContent!);
const instance = createI18n<AppSchema>({
  initialSnapshot: boot,
  catalogSource,
  maxCachedCatalogs: 6,
});
```

The Svelte example wraps that instance with `createSvelteStore(instance)` from `@0disoft/saylo-svelte` and subscribes through `$i18n`. The Astro example uses the core snapshot directly. Both create one instance for the mounted page and dispose it when that page is torn down.

The root entry page chooses a language from `navigator.languages` with the public `resolveLocale` function from `@0disoft/saylo-core/runtime`, then goes to `/en/`, `/ko/`, or `/ja/`. The links to those paths remain available when JavaScript is disabled.

Inside a locale page, the language picker calls `setLocale(nextLocale)`. After that promise succeeds, the page updates the URL with `history.replaceState` (Astro) or SvelteKit's shallow `replaceState` instead of performing a document navigation. Inputs, cursor position, and an open dialog keep their state while the visible translation changes. A failed load leaves the previous snapshot in place; the example catches the error and shows it in its alert element.

## Lazy namespaces

A boot snapshot contains only the scope used to render that page. In these examples that scope is `common`, plus any base-locale outcome needed by the fallback chain. The `cart` catalog is absent from the initial DOM and is loaded when the user presses the cart button.

```ts
await instance.loadNamespace('cart');
const message = instance.getSnapshot().t('cart:items', { count: 2 });
```

The static loader imports the selected locale's `cart` catalog and its base-locale catalog. The build emits lazy chunks for the supported locale/namespace pairs so a later language or namespace selection can fetch them, but the initial page does not download the whole set. Keep calls to `loadNamespace` behind the UI path that actually needs the namespace.

## Fallback and runtime errors

Message lookup tries the selected locale, then any explicit `fallbackLocales` in their declared order, and finally the base locale. It does not infer a parent-language catalog: `en-GB` does not automatically become `en` for catalog lookup. Locale negotiation is a separate step, and `resolveLocale` may match a browser preference such as `en-GB` to the supported `en` route.

Runtime fallback and the examples' build gates are separate layers. The runtime can use an individual base-locale message when a target catalog has a partial gap, even if the strict examples would reject that gap before producing output. These examples do not set `fallbackLocales` and keep `requireCompleteTranslations: true`; `saylo check --config` and the Vite build therefore enforce the complete locale and schema contract used by the verifier.

Do not turn partial target catalogs into a deployment promise by disabling only the plugin's completeness option. The CLI check still runs from the same configuration unless that configuration is changed too, and schema validation remains in force. A deployment intentionally shipping partial targets needs a separately designed and tested fallback and error policy.

By default, an unknown key throws `UnknownMessageError`, and a key from a namespace that has not been loaded throws `NamespaceNotLoadedError`. Call `loadNamespace('cart')` before reading a `cart:*` key. With `AppSchema` generated by typegen, the typed translator accepts the schema's literal key and argument pairs; a plain variable of type `string` is a compile-time error. When a key comes from runtime data, narrow it to `keyof AppSchema` and preserve an explicit key-to-argument mapping instead of passing the raw string.

Using the untyped `Schema`, `any`, or an unsafe cast can broaden the translator signature and bypass those static guarantees. Those paths still need a runtime policy and tests for unknown keys, unloaded namespaces, and argument errors; a cast alone does not validate the key or its arguments.

## Build checks

Both examples run the same catalog checks before their framework compiler. Typegen writes `src/lib/generated.d.ts`, and the page code imports `AppSchema` from that file for typed calls.

Astro's `bun run build` runs:

```text
saylo-typegen --config saylo.config.json
saylo check --config saylo.config.json
astro check
astro build
```

SvelteKit's `bun run build` runs:

```text
saylo-typegen --config saylo.config.json
saylo check --config saylo.config.json
svelte-kit sync
svelte-check --tsconfig ./tsconfig.json
vite build
```

The catalog check verifies the configured locales for missing messages and namespaces, argument-schema agreement, and syntax. The framework typechecker then checks the generated key and argument types in application code. TypeScript 6 is deliberate: `@astrojs/check` 0.9 supports TypeScript 5 and 6 in this setup.

## Static example verifier

`scripts/verify-static-sites.mjs` exercises either example as an isolated consumer. From the repository root, run one of:

```sh
node scripts/verify-static-sites.mjs --framework astro --playwright-module /absolute/path/to/playwright-core/index.mjs
node scripts/verify-static-sites.mjs --framework sveltekit --playwright-module /absolute/path/to/playwright-core/index.mjs
```

The verifier copies the selected example to an operating-system temporary directory outside the workspace, excludes `node_modules` and framework build caches, and runs `bun install --no-cache --ignore-scripts` followed by `bun run build`. It then checks that the build rejects a literal unknown key, a string passed to the numeric `common:total` argument, a translated argument-schema mismatch, and a missing translation.

For the browser portion, the verifier serves only the generated `dist/` or `build/` files over a plain Node HTTP file server. No framework or Saylo runtime server is available. It launches headless Microsoft Edge through Playwright, starts with a `ko-KR` browser locale to check automatic `/ko/` routing, switches to Japanese and English, and checks that form input, a modal, the query string, and the URL hash survive the locale changes. It also opens each locale without JavaScript and checks the prerendered HTML.

The verifier also checks the static HTML `lang` attribute, exercises fallback order and expected errors through the public ESM entry points, and counts JavaScript requests. Loading `cart` on the Korean page must fetch exactly two new JavaScript chunks. Switching from Korean to Japanese must fetch exactly two new JavaScript chunks while the cached base catalog is reused.

The measured package and tooling versions for these examples are Astro 7.4.2, SvelteKit 3.1.0, `@sveltejs/adapter-static` 4.0.0, Bun 1.4.4, and Node 24.18.0.

Both examples passed isolated registry install/build and 14 assertions on 2026-10-26 (Asia/Seoul).

## Do not use the SSR init preset for a static target

`saylo init --framework sveltekit` creates the SvelteKit SSR preset. That preset intentionally rejects `@sveltejs/adapter-static`, because its generated integration assumes request-time server behavior and is a different deployment shape. Removing that guard would leave the preset's server assumptions in place while changing only the adapter.

For a static site, use the `examples/sveltekit-static` pattern and this manual setup. The automatic SvelteKit preset remains the supported starting point for an SSR application.

## Static hosting details

Both examples generate root-hosted URLs: `/en/`, `/ko/`, `/ja/`, and a root `/` language chooser. Configure the host to serve each locale's `index.html` for its trailing-slash path. Do not add an SPA fallback server that pretends to render missing locale data; all public locale pages are built in advance.

For subdirectory deployment, configure the framework base path and update the hard-coded root URLs in the examples to include that base. Astro uses its `base` setting; SvelteKit uses its configured base path and route helpers. Verify the boot script URL, lazy catalog URLs, navigation links, and `history.replaceState` path all carry the same prefix. The examples intentionally remain root-hosted so their static output is easy to compare.

This guide covers the static build shape and hosted artifacts. Development-time live catalog behavior is covered by the Vite development documentation and is outside this static-site path.
