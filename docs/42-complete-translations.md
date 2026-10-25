# 42. Build-time complete-translation check option

I implemented the `requireCompleteTranslations` option in the Vite plugin to require complete translations for every locale during production builds. It was included in and published as `0.1.0-alpha.3`. The default is `undefined` (with false behavior), and even when `true` the check runs only when `config.command === 'build'`. Development startup/live updates, core `validateTranslation`, and the typegen CLI do not have this option.

## Option contract

```js
import saylo from '@0disoft/saylo-vite';

export default {
  plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', requireCompleteTranslations: true })],
};
```

- The option type is `readonly requireCompleteTranslations?: boolean`. It is exposed to JS, TS, and checkJs consumers, and a string such as `'true'` is rejected with `TypeError` during plugin creation.
- An empty-string `initialLocale` also raises `RangeError`.
- Default behavior (`undefined` or `false`) and development mode continue to allow missing translations and use baseline fallback.

## Check order

For a build with the complete-translation check enabled, `configResolved` scans catalogs and then proceeds in this order. It first runs ordinary `createStore` schema validation against `baseLocale`, so ID, argument, and type errors are caught even when the `initialLocale` directory does not exist. It then performs the complete-translation check; if that passes, it proceeds to registry chunk generation and typegen. If anything is missing, the check ends with `CatalogError` and later stages do not run, so existing `generated.d.ts` is not overwritten.

If an existing schema, argument, or type error is present, that error fails before the complete-translation check. Existing diagnostics such as `UNKNOWN_ARGUMENT` also take precedence in strict mode.

## Check target

The check uses `checkLocales` when provided, matching the catalog CLI's target selection. Otherwise it collects non-hidden locale directories under `localesDir`, including empty directories. It always adds `initialLocale`, so an initial locale is included even when its folder does not exist. Declare release languages in `checkLocales` to detect a missing language directory. An explicit empty list checks only the initial locale. Locales outside the selected targets still undergo ordinary schema validation.

`checkLocales` is supported both in `saylo.config.json` loaded with `loadProjectConfig()` and in direct Vite options. Locale tags are canonicalized, duplicates are rejected, and caller-owned arrays are copied. This addition is in the source checkout and requires the next npm release.

The check is independent of `initialNamespaces`. It verifies every message ID in every namespace under the base locale, not only the `initialNamespaces` subset. The base locale itself is excluded.

## Diagnostics

- A missing namespace file produces `MISSING_NAMESPACE`. The expected relative path uses the directory's actual spelling (`en-us/help.json`).
- A namespace that exists but lacks a key produces `MISSING_MESSAGE`, populated with the `sourceName` and `id` of the value that should exist.
- The diagnostic `locale` is canonical (`en-US`), while the file hint retains the directory's actual spelling (`en-us`).
- Diagnostics are collected and sorted by canonical locale, namespace, and id. They do not include `position` data such as the location of the missing target file, so an unrelated file position is not invented.
- Only key existence is checked (`Object.hasOwn`). An empty string `""` counts as an existing value. Translations may still omit base arguments, and translated copy is not inspected for content or language.

## Validation commands

```sh
npm run check
npm run release:check -- --version 0.1.0-alpha.3 --tag alpha
npm exec -- node scripts/pack-smoke.mjs
```

The full `check` and release-metadata checks for all five packages passed on Windows with Node 24.18.0 on 2026-10-09. The actual Vite build verified missing diagnostics, success after repair, retention of the existing type file, namespaces outside the initial-loading scope, empty folders, an initial locale without a folder, and precedence of ordinary schema errors. Empty strings and omitted translation arguments were accepted, and development plugin tests verified partial-translation fallback and recovery after repair. JS/checkJs and TS consumer typechecks also passed.

Reusing the build output, pack-consumption verification passed external JS and TS installation of all five tarballs, README examples, the CLI, React and Svelte SSR, the Vite lazy build, and parser removal. The external consumer app was cleaned up afterward. New performance measurements, browser validation, and registry publication were not performed in this candidate-preparation work; publication and registry-consumption checks happened in a later release stage.

## Status

Implementation commit `d29eac7` kept the version at `0.1.0-alpha.2` and did not push, publish, or bump it. The already published alpha.2 does not contain this option. It was later included in and published with [0.1.0-alpha.3](../releases/0.1.0-alpha.3.md), and the option is present in the alpha.3 release. Publication and consumption verification results follow the release record.
