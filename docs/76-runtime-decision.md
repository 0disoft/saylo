# 76. Runtime architecture decision

Observed on 2026-10-11 (KST). This document briefly records the product architecture decision. It is a practical architecture decision, not a proof that only an independent runtime is possible or that the APIs are fully equivalent.

## Decision

- Retain Saylo's current independent runtime.
- Continue reusing the FormatJS parser and `intl-messageformat` (IMF).
- Do not adopt the prototype built on i18next extension points as the product. It is a private comparison experiment and is not part of product packages, public APIs, or published builds.
- This is not a determination that any specific tool is universally impossible. It reflects contract and cost differences observed within the scope exercised by the probes.

## Rationale: contract differences

- With native i18next, a fixed `t` observes new resources, fallback ICU uses the selected locale (Saylo uses the base locale), and omitting a base argument is not rejected ([56](56-thin-layer-contract-probe.md), 36 observations).
- Wuchale 0.26.7 handles compiled positional data, but named ICU input called by the probe remains literal. It does not reject a missing positional argument, and its handling of newly applied modules, isolated module snapshot retention, and deep immutability differs from the observed behavior. This is not a claim that Wuchale as a whole is unusable.
- The thin layer had to pin its time zone by implementing the public `i18nFormat` directly ([64](64-thin-layer-timezone-adapter.md)). A parser-free path required private AST-rewrite glue ([65](65-thin-layer-ast-production.md)).

## Rationale: internal complexity

- The prototype still requires its own lazy source cache, coordinator, hydration barrier, error handling, schema, parser, typegen, and transport ([67](67-thin-layer-lazy-contracts.md) through [72](72-thin-layer-sync-construction.md)). Adding a vendor engine does not remove most of this code.
- Validation is limited to the scope of each document: 12 SSR hydration host cases ([66](66-thin-layer-ssr-production.md)); 64 lazy/scope cases (14 scenarios across core, async, and sync = 42, plus 8 sync-constructor, plus 14 scope, hydration, and timezone) ([72](72-thin-layer-sync-construction.md)); and production, development, lazy, typegen, and session checks ([65], [66], [68], [70], [71], and [73]). Error codes and full API identity were not checked.

## Rationale: latest cost and production results

- Isolated Node runtime cost ([73](73-thin-layer-runtime-cost.md), raw `thin-layer-runtime-cost-validation-cache-2026-10-11.json`): at 10k, commit p50/p95 is 14.55/23.49 ms for core and 23.23/34.24 ms for the layer. Retaining eight old snapshots adds 4.35–4.57 MB for core and 7.70–7.72 MB for the layer. Live steady-state heap delta at 10k is 2.19 MB for core and 1.49–1.52 MB for the layer. The layer is not claimed to have higher values in every memory metric.
- Conditions used two prepared immutable catalogs (two locales, one namespace), two ABBA runs per variant, and validation of eight old snapshots. Each commit measures refresh plus three translation assertions; hot reads are a separate set of 1,500. These are not 100 ms or 250 ms end-to-end targets.
- The real production vector probe (`thin-layer-production-decision-2026-10-11.json`) used four builds: core was 17,054 gzip bytes and layer-ast 37,873 gzip bytes (both with false parser markers), and 70,930 and 154,930 bytes unminified. All 48 format comparisons (12 cases × 4 builds) passed. This is a small-fixture bundle comparison.
- The 36 basic contract probes match the current native package versions (`thin-layer-contracts-decision-2026-10-11.json`).
- The latest root `npm run check` exited 0, and package JS/TS and React example typechecks passed. The full test count was not aggregated separately.
- The real end-to-end results ([75](75-early-disk-rechecks.md)) had edit p95 of 49.57 ms for small and 80.25 ms for large, both meeting the p95 target; locale-list p95 was 77.46 and 177.83 ms.

## Owned message-map freezing ([49](49-owned-message-map-freeze.md))

- Trust deeply frozen children owned by the parser only; apply ordinary freezing to external shallow maps.
- Retain the parser incremental cross-comparison benefit from 49. No cold-path consistency benefit is claimed.
- Retain the existing optimization based on passing deep-immutability tests in the current full check and the latest E2E results. The latest E2E results are not attributed solely to 49.
- No additional trial needs to be repeated.

## Current status

- The package version at decision time was alpha.3. The local selector implementation came after alpha.3 and had not been published. It is distinct from the earlier remote observation from 10/09.
- This decision did not change remote state or complete publication.

2026-10-11 follow-up: all five packages were published as alpha.4, including selectors and follow-up fixes. Exact CI artifacts, registry SHA-512 comparisons, and JS/TS and SvelteKit consumer validation passed. See the [release record](../releases/0.1.0-alpha.4.md) for current publication state. The alpha.3 status above records the state at decision time.

## Reconsideration criteria

- Revisit the decision when a candidate provides the same base-argument, old immutable snapshot, source fallback, timezone, atomic lazy loading, SSR, and typegen contracts without a duplicate coordinator, backed by comparable-scale cost and lightweight production evidence.

## Supporting documents

- [49](49-owned-message-map-freeze.md), [56](56-thin-layer-contract-probe.md), [64](64-thin-layer-timezone-adapter.md), [65](65-thin-layer-ast-production.md), [66](66-thin-layer-ssr-production.md), [67](67-thin-layer-lazy-contracts.md), [68](68-thin-layer-lazy-browser.md), [69](69-thin-layer-typegen.md), [70](70-thin-layer-lazy-production-browser.md), [71](71-thin-layer-lazy-session-browser.md), [72](72-thin-layer-sync-construction.md), [73](73-thin-layer-runtime-cost.md), [74](74-immutable-validation-reuse.md), and [75](75-early-disk-rechecks.md)
- Raw data: `benchmarks/results/thin-layer-runtime-cost-validation-cache-2026-10-11.json`, `benchmarks/results/thin-layer-production-decision-2026-10-11.json`, and `benchmarks/results/thin-layer-contracts-decision-2026-10-11.json`.
