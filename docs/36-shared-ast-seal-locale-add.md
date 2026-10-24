# 36. Large locale-add remeasurement after sharing the AST-freeze seal

## Purpose

After [35](35-shared-ast-seal.md) moved the `seal` helper inside `freezeMessageAst` to module scope, I remeasured large locale-add with detailed instrumentation disabled to determine whether real locale-list rendering met the 250 ms target. Product and harness code were unchanged in this work.

## Run

```sh
node benchmarks/live-update/run.mjs --mode locale-add --scenario 10k-20-locales --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/locale-add-shared-ast-seal.json
```

- revision `28d7fe5a22e1d578a392cec21bc7e3ab6cf14f1d`, measuredAt `2026-10-08T08:33:04.988Z`
- Detailed CPU profile, browser, server-file, reply, and client measurement: all OFF
- Default prebundle and typegen: ON; `declarationRewritten` false
- Scale: one large run (10k × 20), 55 raw runs (5 warmups + 50 measured), 25 controls
- Node 24.18.0, Vite 8.3.2, React 19.3.0, Windows x64, Ryzen 5 7430U, HeadlessChrome 154
- Server startup 3,450.56 ms; browser boot 4,986.78 ms

## Input scale

There were 10,000 messages × 20 locales in one namespace. The initial catalog had 20 files totalling 7,755,280 B. Each iteration added one en-GB file with 10,000 messages, and the added catalog was 387,783 B.

## Results

Units are ms. Save → list/translation ack spans from completion of the Node file write through receipt of the DOM-verification ack and includes ack delivery. Selection preparation → translation ack and save → broadcast also use the Node clock. Browser selection → commit spans from immediately before `setLocale` through the `useLayoutEffect` that verifies the translated DOM.

| Metric | p50 | p95 |
| --- | --- | --- |
| List saveToListAck | 291.47 | 767.54 |
| Node selection preparation → translation ack | 246.76 | 602.00 |
| Node save → translation ack | 554.72 | 1,156.26 |
| Browser selection → commit | 243.50 | 598.10 |
| Node save → broadcast | 270.31 | 739.49 |
| fileWrite | 20.80 | 78.85 |
| control | 3.88 | 5.17 |

List p95 was 767.54 ms and failed to meet the 250 ms target; only 11 of 50 runs finished within 250 ms. For each sample, `saveToListAckMs - saveToBroadcastMs` is the broadcast → list-ack remainder on the same Node clock; its p50 was 21.47 ms and p95 was 42.50 ms, and save → broadcast was larger than the following interval in 50/50 runs. The 50-run p95 is the 48th sorted value. I do not add nested p95 values, deduct control/GC, or mix Node and browser clocks.

## Interpretation and limitations

List p95 was observed much higher than the large value of 268.54 ms in the preceding remeasurement with detailed instrumentation OFF ([31](31-prebundle-freeze-locale-add.md)), and p50 increased from 189.62 to 291.47 ms. The runs occurred at different times, ran sequentially on one machine, and did not control load or GC. List samples ranged widely from 154.94 to 2,389.88 ms. Because detailed instrumentation was off, I do not establish this difference as parsing, GC, or the effect or regression of moving `seal` to module scope. One run did not confirm a reduction, and I do not revert the product change in [35](35-shared-ast-seal.md) or apply additional optimization based on this single result.

## Validation

For 55 raw runs (5 warmups + 50 measured) and 25 controls, I reconciled raw counts, token uniqueness, options, finite times, Node boundaries, bytes, summaries, and every hash, and confirmed cleanup of temporary fixtures and the benchmark Chrome process. In all 55 raw runs there were zero responses before selection and one `saylo-catalog-v1` compact full response after selection; `.d.ts` files were not rewritten. The harness also confirmed return to en, file deletion, preservation of input node values and React state, and no reload. Of 36 hashes shared with the earlier run 31, only one differs: `packages/core/dist/diagnostics.js`; all five core hashes match the parse comparison in [35](35-shared-ast-seal.md). The independent raw reconciliation is in [locale-add-shared-ast-seal-analysis.json](../benchmarks/results/locale-add-shared-ast-seal-analysis.json). Because product and harness code were unchanged, I did not rerun build, tests, typechecks, pack, or release checks. Nothing was pushed, published, or deployed.

I reconciled the documentation tables with the result JSON. All 162 local links in the five changed Markdown files, code fences, the 40 KB limit, and `git diff --check` passed.

## Next work

The next step is a comparison measurement that directly compares before and after under identical conditions at close times to determine whether the `seal` module change causes an end-to-end regression. I do not identify the source of the current noise and leave the effectiveness unconfirmed.

## Links

- [locale-add-shared-ast-seal.json](../benchmarks/results/locale-add-shared-ast-seal.json)
- [locale-add-shared-ast-seal.10k-20-locales.samples.json](../benchmarks/results/locale-add-shared-ast-seal.10k-20-locales.samples.json)
- [locale-add-shared-ast-seal-analysis.json](../benchmarks/results/locale-add-shared-ast-seal-analysis.json)

Related documents: [31](31-prebundle-freeze-locale-add.md), [35](35-shared-ast-seal.md).
