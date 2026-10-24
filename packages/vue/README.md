# @0disoft/saylo-vue

The Vue 3 binding for Saylo. `createSayloVue<Schema>()` creates `createPlugin`, `provideI18n`, and `useI18n`, and `useVueStore(instance)` subscribes to the store snapshot as a read-only `shallowRef`. Call `useI18n`, `useVueStore`, and `provideI18n` synchronously in a component's `setup`; create `createPlugin(instance)` outside setup and install it with `app.use`.

## Status and installation

This package is for the local private workspace only and has not been published to npm. `private` is `true` and `version` is `0.1.0-alpha.4` in `package.json`, but this version is not in the registry, and it is in neither the five published packages (`alpha`) nor the `0.1.0-alpha.5` candidate. Link it through the workspace or a file path instead of installing from the registry. The root `workspaces: ["packages/*"]` already includes it, so a root `npm install` links it; other apps install it from a local path such as `npm install <saylo-checkout>/packages/vue`.

`vue` is a peer and the requirement is major version 3 (`"vue": "3"`). The repository root also uses the same major range as a devDependency for verification. `@0disoft/saylo-core` is a runtime dependency, and `dist/` contains ESM JavaScript and `.d.ts` files (`tsc -p tsconfig.json`).

Install and build from the repository root before use. Independent tarball consumption is verified from the same root.

```sh
npm ci --ignore-scripts
npm run build
npm run verify:pack:vue
```

`verify:pack:vue` installs the core and Vue tarballs into a temporary app, checks JS and TS types and concurrent ko/en SSR, and then removes the temporary folder.

To start a Vue SFC app outside the repository, follow the [Vue getting-started guide](../../docs/getting-started-vue.md). `prepare:starter:vue` bundles four tarballs, and `verify:starter:vue` checks independent installation, type generation, the development server, and the production screen.

## Usage

Create the factory once at module scope, and install an instance in the app with `createApp(...).use(createPlugin(store))`. No wrapper component is needed. Below is a Vue `h` render function example where one browser app owns the store. In SSR, create a store per request.

```js
import { createApp, defineComponent, h } from 'vue';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloVue } from '@0disoft/saylo-vue';

const ko = parseCatalog('{"greeting":"안녕 {name}"}', { locale: 'ko', namespace: 'demo' });
const en = parseCatalog('{"greeting":"Hello {name}"}', { locale: 'en', namespace: 'demo' });

// 모듈 범위에서 한 번 만든다. 주입 키는 이 factory 안에서만 유효하다.
const { createPlugin, provideI18n, useI18n } = createSayloVue();
const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [ko, en] });

const Child = defineComponent({
  setup() {
    const i18n = useI18n(); // 같은 factory의 provider가 instance를 넘긴다.
    return () => h('button', {
      onClick: () => i18n.value.setLocale(i18n.value.locale === 'ko' ? 'en' : 'ko'),
    }, i18n.value.t('demo:greeting', { name: 'Saylo' }));
  },
});

// setup 밖에서 plugin을 만들고 앱에 설치한다. install이 app.provide를 대신한다.
const app = createApp(Child).use(createPlugin(store));
app.mount('#app');

// 앱 종료 때 호출한다. plugin은 instance를 폐기하지 않는다.
function stop() {
  app.unmount();
  store.dispose();
}
```

To override only a subtree with a different instance, call `provideI18n(instance)` in that parent component's `setup`. `useI18n` looks for the nearest component provider first and uses the app provider if there is none. If the whole app uses one instance, `provideI18n` is not needed.

```js
const Subtree = defineComponent({
  props: ['instance'],
  setup(props) {
    provideI18n(props.instance); // 호출자가 넘긴 instance를 이 subtree에 제공한다.
    return () => h(Child);
  },
});
```

Instead of `useI18n`, you can use `useVueStore(instance)` directly with the same instance.

When you provide a schema, the key and argument types and the `setLocale` return type are preserved through the adapter.

```ts
import { createSayloVue } from '@0disoft/saylo-vue';

type AppSchema = { 'demo:greeting': { name: string } };
export const { createPlugin, provideI18n, useI18n } = createSayloVue<AppSchema>();
```

## Contract

- The return value is a read-only `shallowRef`. Read it with `.value` in script, and it unwraps automatically in templates. The value is a frozen snapshot object.
- `useVueStore`, `provideI18n`, and `useI18n` can only be called during `setup`; calling them outside throws a synchronous error. `createPlugin(instance)` can be called outside setup. `useI18n` throws if a provider from the same factory is missing, and the message points to `provideI18n` or `app.use(createPlugin(instance))`. Contexts from different factories cannot read each other.
- `install` on `createPlugin(instance)` only calls `app.provide` with the injection key and the instance. It does not create a subscription or discard the instance, and it is installed before mount. Installing a newly created plugin with the same instance on the same app does nothing, and installing a different instance from the same factory throws an error. There is no hot swap of an installed instance while running.
- Keep the instance passed to `provideI18n` or `createPlugin` stable within that scope. The adapter does not discard the instance, so the caller is responsible for `dispose()`.
- The live subscription starts in `onMounted`. After installing the listener, it reads `getSnapshot()` once more to include changes between setup and mount, and releases the `onDispose` listener and the subscription in `onScopeDispose`.
- A snapshot's `t` is bound to that snapshot's translations, and `setLocale` comes from the instance. `setLocale` is synchronous `void` or `Promise<void>` for a lazy instance. A lazy instance also provides `loadNamespace`.

## Selector subscriptions

`useI18nSelector` from `createSayloVue<S>()` and `useVueSelector`, which takes an instance directly, read only the values needed from the snapshot. Both are called synchronously in `setup`.

```ts
function useVueSelector<S extends Schema, T>(instance: SayloInstance<S>, selector: (snapshot: SayloVueSnapshot<S>) => T): ComputedRef<T>;
function useI18nSelector<T>(selector: (snapshot: SayloVueSnapshot<S>) => T): ComputedRef<T>;
```

First create a source once with `useVueStore(instance)`, then select values with `computed(() => selector(source.value))`. The result is a read-only `ComputedRef<T>`; read it with `.value` in script, and it unwraps automatically in templates.

- If the selector result is the same by `Object.is`, downstream updates are skipped. Creating a new object every time updates every time.
- It tracks the reactive refs and props read by the selector. The selector must be pure.
- It is a lazy `computed`, so it calculates on first read.
- Selector exceptions follow Vue's normal `computed` handling. It does not automatically keep the last valid value.

Create one subscription per composable and start it in `onMounted`. After installing the listener, it reads the snapshot once more to include changes between `setup` and mount and releases the subscription on scope dispose. No subscription is created during SSR.

```js
import { defineComponent, h, ref } from 'vue';
// i18n 모듈은 앱에 설치한 factory의 useI18nSelector도 함께 내보낸다.
import { useI18nSelector } from './i18n';

const Demo = defineComponent({
  setup() {
    const name = ref('Saylo');
    const title = useI18nSelector(s => s.t('demo:greeting', { name: name.value }));
    return () => h('p', title.value);
  },
});
```

Instead of `useI18nSelector`, you can use `useVueSelector(instance, selector)` directly with the same instance. The Vue binding is still private, and publication and version promotion are on hold.

## SSR and ownership

- Mount-related hooks do not run during server rendering, so no subscription is created during SSR ([component lifecycle hooks](https://vuejs.org/guide/scaling-up/ssr.html#component-lifecycle-hooks)). The first rendered value is `getSnapshot()` at `setup` time.
- On the server, create a separate instance per request and install it in that request's app with `createSSRApp(Root).use(createPlugin(instance))`. Factories and injection keys can be shared, but do not keep an instance at server scope across the server, and the caller cleans it up with `dispose()` when the request ends.
- For an example that connects server HTML and the boot snapshot in the browser, follow the [Vue SSR demo](../../examples/vue-ssr/README.md). The client matches the first render with `initialSnapshot` and connects development synchronization after `app.mount()` finishes.
- When a component scope ends, the adapter releases only the subscriptions and disposal listeners it created. The app owns the store's lifetime.

## Rich text rendering (renderRichText)

`renderRichText` renders the read-only parts returned by `snapshot.tParts(key, args)` as Vue nodes. It is a pure TS function and uses only `h` and `Fragment`, so no SFC compilation or separate subpath is needed. The root entry (`@0disoft/saylo-vue`) exports the function and the `RichTextRenderers` type, and the renderers passed by the app decide which element each tag becomes.

```ts
type RichTextRenderers = Readonly<Record<string, (children: VNodeChild[]) => VNodeChild>>;

function renderRichText(parts: readonly RichTextPart[], renderers?: RichTextRenderers): VNodeChild[];
```

If `renderers` is not given, it is treated as an empty object.

The contract is as follows.

- Text parts become Vue text as-is, and Vue escapes them. The helper does not use `v-html` or create raw HTML strings.
- A tag part becomes the result of a function only when its name is an own property of `renderers` and the value is a function. If it is missing or not a function, no tag is created and only the children are rendered in sequence.
- Lookup checks own properties only (`Object.hasOwn`). Names inherited from the prototype, such as `constructor` and `toString`, are not used for mapping and render only their children.
- Saylo does not create arbitrary DOM tags, HTML, attributes, or URLs from names that come from the catalog. Links and attributes are added only to names the app puts in its own renderers.
- Nested tags are supported. Inner tags are mapped by the same rules.
- Sibling tags render as a `Fragment` with a key that combines the name and occurrence number (`link:0`, `link:1`). Editing copy or inserting literals preserves the identity and state of mapped components. Semantic identity when reordering tags of the same kind is not guaranteed.
- Renderers must return the same element or component type for the same tag. If the type changes, Vue remounts and input, focus, and state are lost.
- Parsing errors are thrown by the core `tParts`. The helper accepts only valid parts.

```ts
import { defineComponent, h } from 'vue';
import { renderRichText } from '@0disoft/saylo-vue';
import type { RichTextRenderers } from '@0disoft/saylo-vue';
import { useI18n } from './i18n';

const richRenderers: RichTextRenderers = {
  strong: children => h('strong', children),
  link: children => h('a', { href: '#order-form' }, children),
};

const RichPreview = defineComponent({
  setup() {
    const i18n = useI18n(); // useI18n은 setup에서만 부를 수 있다.
    return () => renderRichText(i18n.value.tParts('demo:rich', { name: 'Saylo' }), richRenderers);
  },
});
```

This helper is in local commit `4df90a2` and is not in an npm release. Version promotion and publication are on hold. Local verification covered 13 package tests, JS and TS consumer type checks and package boundary checks, independent tarball JS and TS installation with concurrent SSR and rich SSR consumption, demo template checks and a production build, HeadlessChrome 155 recovery with 16 warm and 3 cold cases (no errors), and workspace-wide `npm run check` exiting 0 (297 tests). For demo connection, follow the [Vue demo](../../examples/vue/README.md).

## Implementation scope

For a browser example, follow the [Vue demo](../../examples/vue/README.md). A Nuxt module and published integrity acceptance checks are not implemented. This package is not part of the published `alpha.4` or `alpha.5` targets and has no corresponding release verification record.

Licensed under Apache-2.0, and `files` in the distribution tarball includes `LICENSE` and `NOTICE`.
