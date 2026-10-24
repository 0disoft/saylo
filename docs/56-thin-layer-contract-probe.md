# 56. i18next and Wuchale contract probe

This document records the Node contract probe in `benchmarks/thin-layer`. An isolated prototype using the public i18next, i18next-icu, and Wuchale extension points together with Saylo's parser and schema observed some of Saylo's required contracts. The native findings below record behavioral differences in APIs that the probe actually called. A complete thin-layer assessment and a determination of whether an independent runtime is necessary remain future work.

The observations were made on 2026-10-11 (KST).

## Experiment scope

- Executed code: [package.json](../benchmarks/thin-layer/package.json) · [catalog-layer.mjs](../benchmarks/thin-layer/catalog-layer.mjs) · [i18next-layer.mjs](../benchmarks/thin-layer/i18next-layer.mjs) · [probe.mjs](../benchmarks/thin-layer/probe.mjs)
- The dependency major ranges are i18next 26, i18next-icu 2, intl-messageformat 12, and wuchale 0. The lockfile pins 26.4.3, 2.5.0, 12.1.3, and 0.26.7, respectively.
- [catalog-layer.mjs](../benchmarks/thin-layer/catalog-layer.mjs) implements the AST thin layer. It attaches the ICU subclass `ValuesICU` to the public i18next API to bridge `parse(values)` and reuses `freezeCatalogs`, `createBaseSchema`, `validateTranslation`, and the error classes from the public `@0disoft/saylo-core/runtime`. It supplies catalog ASTs as i18next resources and creates a new engine for each commit. `t` routes to the actual fallback source locale and validates required arguments directly.
- The Node source adapter [i18next-layer.mjs](../benchmarks/thin-layer/i18next-layer.mjs) handles `parseCatalog` and incremental caching. It reuses an earlier parse when the source is unchanged, reparses only changed catalogs, and commits the source cache only after the AST layer accepts it.
- This work verified only Node contracts. Edit, recovery, and locale-switching behavior in Vite and a browser is observed separately in [57](57-thin-layer-browser-probe.md). Lazy loading, reconnection, sessions, time zones, cache invalidation, performance and memory, typegen, bundles, and SSR and hydration still have no execution evidence.

## Observed results

Running `npm --prefix benchmarks/thin-layer run probe` from the repository root exits 0 and records 36 observations (with 0 duplicate `id` values). All seven `codeHashes` values matched the files at execution time; the current values are shown below.

```json
{
  "schema": "saylo-thin-layer-contract-probe-v1",
  "observedAt": "2026-10-10T16:08:09.275Z",
  "environment": {
    "node": "v24.18.0"
  },
  "packages": {
    "i18next": "26.4.3",
    "i18next-icu": "2.5.0",
    "intl-messageformat": "12.1.3",
    "wuchale": "0.26.7"
  },
  "codeHashes": {
    "benchmarks/thin-layer/probe.mjs": "58b7985d7a3fc842e155159ac0d0c94c9d94d0dd4c01416393a2bade3725a758",
    "benchmarks/thin-layer/i18next-layer.mjs": "43996f2b303f5b5224af055245432cb80590214fb78977677191cfdc69907ed5",
    "benchmarks/thin-layer/catalog-layer.mjs": "bfa59948ce78f00e802c8c89e8ef38e2e0f8c6a04dae481eec5a1ccfb98c9cc9",
    "benchmarks/thin-layer/package-lock.json": "d6bddc277a902507cccadc2dd1ead1d6cac81b923f2d6b6e3bdd4fd69859d7ee",
    "packages/core/dist/schema.js": "9a006afc8b2a999842bef34d61f4a91bc8610df66458ac3bc6e472bf65dd739f",
    "packages/core/dist/catalog.js": "eac4c686d9c15a49b5301ee466568acf19b0fbee0c1e5987aae6dfc0d572b7d9",
    "packages/core/dist/translator.js": "d7c0102bd58b89c38613023e24ff8d42b55e53d50397d2c4cb64c1c849f8ee5f"
  },
  "scope": "Node contract probe only: public i18next/ICU/Wuchale extension APIs and an isolated i18next AST-resource prototype reusing Saylo parser/schema. Native observations describe tested API behavior, not library defects. No Vite/browser, typegen, lazy session protocol, performance, memory, production bundle or timezone proof.",
  "prototypeCosts": [
    "Saylo parser/schema retained",
    "new i18next and ICU instances per committed snapshot",
    "incremental parsed catalog and AST resource reuse; revision instances still rebuilt",
    "separate argument validation and source-locale fallback routing",
    "public error classes reused; no UI subscription/loader/disposal API implemented"
  ]
}
```

The full `scope`, `prototypeCosts`, and all 36 `observations` are in the [source data](../benchmarks/results/thin-layer-contracts-2026-10-11.json).

### Prototype contracts

| Contract | Observation |
| --- | --- |
| Previous snapshot remains fixed | The previous `t` returns `Hi Ada`; the new snapshot returns `Updated Ada` |
| Key deletion | The new snapshot returns `UnknownMessageError`; the previous snapshot keeps the old value |
| Partial fallback | Base English plural produces `21 rows` |
| Empty string | Returns the translation's `""` unchanged |
| Literal dot, `__proto__`, and `constructor` | Returns `literal`, `prototype literal`, and `constructor literal` |
| Reserved arguments | Customer values passed as `{lng}` and `{ns}` produce `customer / order` |
| Unregistered key | Returns `UnknownMessageError` |
| Required argument | A missing value, `"2"`, and `NaN` all return `InvalidArgumentError` |
| Invalid schema or ICU | Returns `CatalogError` before commit and preserves the previous snapshot's identity |
| Request isolation | An edit in another instance does not leak into the first instance |
| Locale addition and removal | `ja` can be selected, and removal returns to the base locale |
| Incremental preparation | Base is not reparsed; parsed count 1 and resource count 1 |

### Native API behavior

- i18next: When cache-store events (`added removed`) are provided, an added resource immediately appears through both an existing `t` and `getFixedT` (`Updated Ada`).
- i18next: It does not require a base argument that was omitted and accepts the numeric string `"2"`. Fallback ICU also selects a different locale. Saylo produces `21 rows` from the base locale, while native produces `one row` from the selected locale.
- Wuchale: Compiled positional arguments work with the number `0`. Passing a named ICU string unchanged leaves it as a literal, so `{name}` is not substituted and conversion is required. The native runtime follows a module replacement, so an old `t` changes as well; a deep-frozen copy keeps its original value and rejects mutation.

## Interpretation and limitations

- Within the Node scope, the existing formatter satisfied some contracts. This probe does not show that an independent formatter is the only solution.
- Costs remain. Saylo parsing and schema are still required, and i18next and ICU instances are recreated for every commit. There is no lifecycle loader, UI, or disposal API.
- Wuchale uses a different source data format and requires conversion. This finding applies to the tested input; it is not a claim that Wuchale lacks ICU support generally.
- Accordingly, this does not establish that an independent runtime is necessary or complete the full thin-layer assessment. The goal remains an independent library, and there is not yet evidence that justifies replacing the structure.
- Official documentation: [i18next API](https://www.i18next.com/overview/api) (`getFixedT` and `forkResourceStore`), [i18next-icu README](https://github.com/i18next/i18next-icu/blob/master/README.md) (cache-store events and FormatJS integration), and [Wuchale](https://wuchale.dev/) (compiled positional data). AST resource delivery was verified through actual execution with the installed version.

## Source data and reproduction

The source data is [thin-layer-contracts-2026-10-11.json](../benchmarks/results/thin-layer-contracts-2026-10-11.json).

```sh
npm --prefix benchmarks/thin-layer install --ignore-scripts
npm --prefix benchmarks/thin-layer run probe
```

## Status

The prototype and observations are in local commits `2d5b5a2`, `23f298b`, and `f3dd7a1`. The browser feature smoke test is recorded separately in [57](57-thin-layer-browser-probe.md). No product package API, dependency, or version changed, and nothing was pushed or published.
