# React demo

An example that uses the Saylo Vite plugin with React 19 and TypeScript. It shares the same catalogs and existing styles as `examples/vanilla/locales`, and manages input values, count, and the modal with React state. Run commands from the repository root.

## Development server

```sh
npm run dev:react
```

It uses the full schema and full catalog, and saving files in `examples/vanilla/locales/` applies them to the screen immediately. The development server is run without `--mode`, so it serves the full catalog without `includeKeys`.

## Production build

The default build includes all messages and writes to `examples/react/dist/`.

```sh
npm run build:react
```

The selective build includes only the keys in `demoKeys` from `selected-keys.mts` and writes to `examples/react/dist-selected/`.

```sh
npm run build:react:selected
npm run preview:react:selected
```

`preview:react:selected` serves `examples/react/dist-selected/` on 127.0.0.1. Both builds generate the full base schema with `npm run typegen:react`, check the demo TypeScript with `tsc -p examples/react/tsconfig.json`, and then bundle with Vite.

This screen uses all 14 keys in `demoKeys`. Both the default and selective builds include those 14; the fixture adds one key the screen does not use to confirm that the selective build drops it.

## Selective key management

`demoKeys` is a hand-written list of the keys this screen actually uses. It is a `readonly` tuple in `examples/react/selected-keys.mts` and is matched to the generated types with `satisfies readonly (keyof AppSchema)[]`. Here `AppSchema` is the full base schema from `generated.d.ts`. Keeping the file as `.mts` avoids Node 24 native TypeScript stripping and the Vite native config module warning.

```ts
// examples/react/selected-keys.mts
import type { AppSchema } from './generated';

export const demoKeys = Object.freeze([
  'demo:heading', 'demo:description', 'demo:formTitle',
  'demo:name', 'demo:namePlaceholder', 'demo:note', 'demo:notePlaceholder',
  'demo:count', 'demo:summary', 'demo:openDialog',
  'demo:dialogTitle', 'demo:dialogNote', 'demo:closeDialog', 'demo:rich',
] as const satisfies readonly (keyof AppSchema)[]);

export type DemoSchema = Pick<AppSchema, typeof demoKeys[number]>;
```

`vite.config.mjs` imports the same `demoKeys` from `./selected-keys.mts` and passes them as `includeKeys` only when `--mode selected`. The default build and development server do not pass `includeKeys`, so they use the full catalog unchanged.

```mjs
// examples/react/vite.config.mjs
import { demoKeys } from './selected-keys.mts';

export default defineConfig(({ mode }) => createDemoConfig({
  includeKeys: mode === 'selected' ? demoKeys : undefined,
  outDir: mode === 'selected' ? 'dist-selected' : 'dist',
}));
```

The screen types are narrowed with the same list. `i18n.ts` creates the store and hooks with `createI18n<DemoSchema>` and `createSayloReact<DemoSchema>`. Type import and export paths use `./selected-keys.mjs` (tsc resolves it to the `.mts` source).

```ts
// examples/react/i18n.ts
import type { DemoSchema } from './selected-keys.mjs';
export type { DemoSchema as AppSchema } from './selected-keys.mjs';

export const store = createI18n<DemoSchema>({ catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone });
export const { SayloProvider, useI18n } = createSayloReact<DemoSchema>();
```

`tsc` runs independently of Vite `--mode`. This screen contract therefore applies to development, default, and selective builds; calling a key not in `demoKeys` from code is rejected even outside a selective build. `generated.d.ts` remains the full base schema in selective builds, and `typegen:react` does not receive `includeKeys`.

Handle dynamic keys only as `keyof DemoSchema`. Passing a key widened to `string` is rejected at compile time. A cast such as `as keyof DemoSchema` skips that check, so a cast key missing from a selective build is exposed only as a runtime `UnknownMessageError`. When adding or removing screen keys, update `demoKeys` and rebuild. `includeKeys` is not in the published `0.1.0-alpha.4`, and it is also absent from the `0.1.0-alpha.5` candidate tarball frozen at commit `2037f9a`, before this feature was added. It is not published yet.

## Rich text preview

Add rich keys to the shared catalogs `examples/vanilla/locales/ko/demo.json` and `en/demo.json`. Korean is `<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요.`, and English is `<strong>{name}</strong>, review <link>your order</link>.`.

The screen renders these parts with `renderRichText`. It maps `strong` to `<strong>` and `link` to `<a href="#order-form">`, and the preview node id is `rich-preview`. The link goes to the order form on the same screen. If the name input is empty, `Saylo` is used.

`projectDemoMessages` includes rich parts in both the full translation projection and the last-good fallback. After a malformed tag, changes to name, count, or input also reformat the last good snapshot.

Add `demo:rich` to `demoKeys`; the generated type is `"demo:rich": { "name": number | string; }`. Use the same procedure above for the development server, production build, selective build, and verification commands.

This helper is not in an npm release yet. It is a local change, with no version promotion or publication. Three local rich renderer tests, the full `npm run check` (293), HeadlessChrome recovery checks (warm 11, cold 3, no browser errors, log `.release/react-rich-recovery.log`), React selective build validation (log `.release/react-rich-selected.log`), and 11 vanilla full and selected Chromium checks each (log `.release/react-rich-vanilla-selected.log`) passed; only independent tarball validation remains.

## Selective build validation

```sh
npm run verify:demo:react:selected
```

The check makes temporary copies of the React, vanilla, and shared examples under `.release/`, adds one unused key per locale to the catalog, and regenerates types from the full base schema. It checks negative and positive TypeScript contracts in this fixture. The full `AppSchema` translator accepts the unused key, while the translator, store, and hook narrowed to `DemoSchema` must reject that key, a key widened to `string`, a mismatched argument, and a missing required argument. Next it checks that the unused message appears in no chunk of the actual selective build output, that the English-only dynamic chunk remains lazy, and that `generated.d.ts` retains all types after the build. Finally, it runs the existing React lifecycle checks against the selective build output from the temporary fixture to verify lazy locale switching and form and dialog state preservation. These checks run bundles in jsdom and do not use Chromium.
