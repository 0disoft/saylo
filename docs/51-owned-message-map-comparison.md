# 51. End-to-end before/after comparison of the parser-owned message-map optimization

I ran the map-freezing optimization from [49](49-owned-message-map-freeze.md) through the actual edit and locale-addition paths, comparing before (`49fe1eb`) and after (`8046a31`) in interleaved order. Pooled p95 increased for both edit and locale addition, and neither met its performance target. This data alone does not support an end-to-end benefit from the optimization.

## Conditions and method

This ran on 2026-10-10 KST under Node v24.18.0, Windows x64 (10.0.26300), Ryzen 5 7430U, Vite 8.3.2, React 19.3.0 in development mode, and HeadlessChrome 154.0.0.0. The scenario had 10k messages × 20 locales in one namespace and a 7,755,280 B initial catalog; locale addition adds one file with 10k messages per round. The selected source differs between variants only in `packages/core/src/catalog.ts` and `diagnostics.ts`; the rest of the product source, entry points, wire format, and version are the same.

The common comparison harness is `9289db4`. For each variant, `locale-compare.mjs` runs in a fresh Vite/optimizer/browser environment with external dependencies shared through junctions and workspace aliases pointed at the snapshot. The order is before/after/after/before (ABBA), with 25 measured runs, 5 warmups, and 10 controls per run, and only `--server-file-stages` enabled. Pooled quantiles use the raw measured samples from both runs with nearest rank; they are not averages of run p95 values. There was no per-sample pairing, randomization, forced GC, load control, or control deduction, so this is not causal proof.

```sh
node benchmarks/live-update/locale-compare.mjs --experiment owned-map --mode edit --baseline 49fe1eb --current 8046a31 --server-file-stages --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/owned-map-edit-comparison-2026-10-10.json
node benchmarks/live-update/locale-compare.mjs --experiment owned-map --mode locale-add --baseline 49fe1eb --current 8046a31 --server-file-stages --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/owned-map-locale-comparison-2026-10-10.json
```

## End-to-end results

Units are ms; values are p50/p95 over 50 pooled raw measured samples for each mode and variant. Selection → commit uses the Browser clock, while the other intervals use the Node clock; I do not subtract the two clocks or add stage quantiles.

| Interval | Before p50 / p95 | After p50 / p95 | Samples within target |
| --- | ---: | ---: | --- |
| Edit save → DOM ack | 180.34 / 212.52 | 179.73 / 300.98 | ≤100 ms: 0/50 → 0/50 |
| Locale save → list ack | 186.19 / 309.09 | 189.46 / 704.48 | ≤250 ms: 46/50 → 34/50 |
| Locale save → first translation ack | 370.18 / 558.64 | 386.26 / 988.78 | — |
| Selection preparation → first translation ack | 175.62 / 256.47 | 196.40 / 397.83 | — |
| Selection → commit (Browser) | 172.90 / 253.30 | 187.80 / 308.50 | — |

For edit save → DOM ack and locale save → list ack, p50 was almost unchanged while p95 increased (edit 212.52 → 300.98, locale 309.09 → 704.48). Locale-list samples exceeding the target increased from 4/50 to 16/50, while edit failed in 50/50 both before and after. Control RTT changed in opposite directions (edit 3.12/3.83 → 3.74/6.66, locale 3.15/6.91 → 3.00/4.44), so control alone does not explain the tail increase.

The edit target (≤100 ms) was met in 0/50 before and after, and the locale target (≤250 ms) was met in 46/50 before and 34/50 after. Neither target was met, and no end-to-end improvement was confirmed. Without per-sample pairing, randomization, or GC/load control, I do not establish the tail worsening as a regression or causal effect of this optimization.

## Primary p95 by run

These are primary-interval p95 values over 25 measured runs per run.

| run | variant | edit save → DOM ack | locale save → list ack |
| --- | --- | ---: | ---: |
| 1 | before | 212.52 | 303.42 |
| 2 | after | 225.19 | 704.48 |
| 3 | after | 389.69 | 575.85 |
| 4 | before | 187.95 | 309.09 |

The two edit before runs were 187.95 and 212.52, while the two after runs were 225.19 and 389.69, with no overlap. For locale, both after runs were also larger (before 303.42 and 309.09; after 704.48 and 575.85). Sample counts are small and order and machine were fixed, so these data do not identify the cause of the distribution difference.

## Server-file stages

These are pooled p50/p95 values for server stages read from the same samples with `--server-file-stages`. I do not add stage p95 values or interpret them as CPU time.

| Stage | edit before | edit after | locale before | locale after |
| --- | ---: | ---: | ---: | ---: |
| readAndCandidate | 55.69 / 68.59 | 46.93 / 148.41 | 104.39 / 208.48 | 106.47 / 446.26 |
| catalogParse | 50.10 / 62.00 | 40.99 / 82.51 | 98.07 / 192.24 | 100.36 / 280.27 |
| fileRead | 1.18 / 3.89 | 1.44 / 13.40 | 1.02 / 2.85 | 0.99 / 127.13 |
| candidateOther | 0.75 / 9.72 | 1.21 / 68.08 | 0.50 / 12.18 | 0.59 / 36.04 |
| pathCheck | — | — | 0.61 / 1.05 | 0.63 / 34.99 |

Edit catalogParse p50 decreased from 50.10 to 40.99, but p95 increased, so a consistent server-parsing improvement was not confirmed. In the same mode, readAndCandidate and fileRead p95 also increased (edit 68.59 → 148.41 and 3.89 → 13.40). For locale, fileRead and pathCheck p95 also increased substantially. Long end-to-end samples include file-reading and candidateOther latency as well as parsing. This instrumentation did not separate GC, OS load, or scheduling effects.

## Validation and sources

- Separate validation confirmed 240 raw runs across both modes = 200 measured + 40 warmup, plus 80 controls. I recalculated count, p50, p95, min, and max for 158 timing summaries from raw data and all matched.
- The before/after dist differed exactly in `catalog.js` and `diagnostics.js`, and hashes common to both modes were equal. All 36 unique harness and current dist hashes matched.
- Each sample had one path, read, and parse call and one drain; fileEvents were 1 for edit and 2–3 for locale. No temporary benchmark directories or dedicated browser processes remained.
- Harness checks passed in every run. Measured edit samples had a patch response, one changed message, and zero position updates; locale samples had zero responses before selection and one full response after selection (`saylo-catalog-v1`). Every run had `typegenEnabled=true` and `declarationRewritten=false`, and `.d.ts` mtime/size remained unchanged. The browser harness verified input node, entered value, React state, and actual translated DOM, and locale runs completed the return to en, file deletion, and list removal.
- The comparison tool's syntax check, change-scope policy test, and smoke tests for both modes passed. Smoke timings were not used for performance judgments. Product source was not changed further, so I did not repeat full product tests, pack, or release checks.

Raw aggregates: edit [owned-map-edit-comparison-2026-10-10.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.json), locale [owned-map-locale-comparison-2026-10-10.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.json). Per-run results and raw samples follow the naming convention below.

| mode | run | variant | result | raw samples |
| --- | --- | --- | --- | --- |
| edit | 1 | before | [.1-before.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.1-before.json) | [.samples.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.1-before.10k-20-locales.samples.json) |
| edit | 2 | after | [.2-after.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.2-after.json) | [.samples.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.2-after.10k-20-locales.samples.json) |
| edit | 3 | after | [.3-after.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.3-after.json) | [.samples.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.3-after.10k-20-locales.samples.json) |
| edit | 4 | before | [.4-before.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.4-before.json) | [.samples.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.4-before.10k-20-locales.samples.json) |
| locale | 1 | before | [.1-before.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.1-before.json) | [.samples.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.1-before.10k-20-locales.samples.json) |
| locale | 2 | after | [.2-after.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.2-after.json) | [.samples.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.2-after.10k-20-locales.samples.json) |
| locale | 3 | after | [.3-after.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.3-after.json) | [.samples.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.3-after.10k-20-locales.samples.json) |
| locale | 4 | before | [.4-before.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.4-before.json) | [.samples.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.4-before.10k-20-locales.samples.json) |

## Next

The adoption decision for the optimization in [49](49-owned-message-map-freeze.md) remains provisional in light of these results, and I do not automatically revert it based only on this data. The next step is to measure only long read/candidate samples and GC/scheduling effects to distinguish the causes of the tail and remaining candidate cost, without repeating the same broad benchmark.

This is a local record; no version change, push, publish, or deploy was performed.

The follow-up diagnosis that narrows read/candidate remainder and GC/timer delays is in [52-server-runtime-tail.md](52-server-runtime-tail.md).
