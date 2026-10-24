# 28. Full-response preparation and post-receipt measurement with the default prebundle

Following the [normal-configuration remeasurement in 27](27-shared-freeze-locale-add.md), I divided and measured full-response preparation and the interval after the receipt event. In all 50 large runs, post-receipt → DOM time was larger than pre-receipt time. Post-receipt p50/p95 was 143.10/557.80 ms, making it the next measurement target. Product source and dist were unchanged.

## Implementation and boundaries

- `--reply-stages` is accepted only for locale-add. `--browser-stages` is rejected so normal prebundling remains enabled.
- A Node registerHooks wrapper instruments `requestCatalog` in `packages/vite/dist/index.js` in memory before import. It separates `registry.loadDelta` and `encodeCatalogResult`, preserves request validation and return behavior, and keeps callback references for cleanup.
- The channel metric times the original `client.send` call. It includes Vite's JSON.stringify and enqueue cost for WebSocket `socket.send`, and does not measure transport completion. Instrumentation is not stored in product files.
- The browser virtual helper does not alter product code or configure the optimizer. A hot listener is registered before createI18n/connectDev/source connection. Timestamps are taken **after** Vite WS JSON.parse and **before** synchronous Saylo processing; the listener is removed during cleanup.
- Samples target only en-GB/bench after selection. Boot, list, reset, and removal are excluded, and missing, duplicate, or retried full requests are treated as failures.
- Without `--reply-stages`, replyStages is not emitted and neither the listener nor the server transform is installed.

Node metrics:

- selectionToRequestMs: From “selection request received” in control to the start of the target request handler (includes HTTP control return, browser scheduling, and request delivery).
- lookupMs: The call in which `registry.loadDelta` looks up an already accepted in-memory catalog and creates the outcome. File reads and parsing are excluded.
- encodeMs: Construction of compact schema signatures and AST tuples.
- requestToSendMs: From handler start to send-wrapper start (lookup/encoding/checks/assembly). This is a nested metric.
- sendMs: JSON serialization and the socket enqueue call.
- handlerMs: The entire full-request callback. handlerOtherMs: Per-sample handler time minus lookup, encode, and send.
- All synchronous wall-time values include pause and probe overhead and are not pure CPU time.

Browser metrics:

- selectToReceiveMs: From before setLocale to the hot listener. Since the listener runs after Vite JSON.parse, this interval covers the server, transport, and pre-receipt processing rather than pure network time.
- receiveToCommitMs: From the listener to the useLayoutEffect that verifies the probe DOM and selection. It includes Saylo decoding/checks/freezing, core acceptance, snapshot creation, translator construction, and React commit.
- These values divide total selection; I do not subtract process clocks, control, or GC, or add nested p95 values.

## Run

```sh
node benchmarks/live-update/run.mjs --mode locale-add --reply-stages --scenario 10k-20-locales --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/locale-add-reply-stages.json
```

- 2026-10-07 KST, revision 9ce720d (full JSON value `9ce720d0e7b4cc553464c3712d140de2cf9dc1ed`); worktree harness hashes are recorded in the JSON.
- Default prebundle and typegen ON; CPU, browser, and server-file profiling OFF.
- Node 24.18.0, Windows, Ryzen 5 7430U, Vite 8.3.2, React 19.3.0, HeadlessChrome 154. There were 55 raw runs → 50 measured plus 5 warmups, 25 controls, and nearest-rank p95 equal to the 48th sorted value.
- Scenario: 10k messages × 20 locales/files, 7,755,280 B of initial catalog JSON, 1 bench namespace, and a new 387,783 B en-GB JSON file per round.
- The existing app and formatters were warm; new catalogs and probe formatters were used for the first time. Input DOM node/value, React state, and `.d.ts` mtime/size were preserved, there was no reload, and reset/en/removal completed.

## Results

Times are in ms. requestToSend is nested inside handler, and handlerOther is summarized after calculating its per-sample remainder.

| Interval | p50 | p95 |
| --- | --- | --- |
| Node selectionToRequest | 1.71 | 3.33 |
| Node lookup | 0.04 | 0.08 |
| Node encode | 28.16 | 54.82 |
| Node requestToSend (nested) | 28.27 | 55.08 |
| Node send | 15.28 | 26.71 |
| Node handler | 44.07 | 85.92 |
| Node handlerOther | 0.08 | 0.14 |
| Browser selectToReceive | 58.50 | 104.20 |
| Browser receiveToCommit | 143.10 | 557.80 |
| Browser selection total | 209.90 | 641.00 |
| list(saveToListAck) | 159.05 | 474.73 |
| control round trip | 2.87 | 4.87 |

- Raw counts: one each for handler/lookup/encode/send, one receipt, zero replies before selection, and one full response after the compact response.
- Serialized JSON frame p95 was 1,241,401 B. This is not actual network bytes.
- post-receipt > pre-receipt 50/50, Node encode > send 50/50.
- List rendering finished within 250 ms in 44/50 runs, but p95 was 474.73 ms and missed the target. The list target does not apply to first locale-selection time.
- Worst selection (10k-20-locales #50): total 1,079.30 ms, 50.10 ms before receipt, 1,029.20 ms after receipt, and Node handler 38.81 ms on a separate clock.
- Long samples are retained and GC was not observed. I do not claim a causal improvement over the run without instrumentation.
- Among Node lookup, encode, and send, encode was larger than send in every run. Within total selection, the post-receipt interval was larger, so the next step is to divide the client internals. These values alone do not identify freezing, React, or GC as the cause.

## Validation

- Ten tests passed: five reply tests and five existing browser tests.
- I verified handler behavior for valid and invalid requests, excluded/duplicate/missing requests, requestId/generation matching, finite times, call counts, and nested boundaries. Instrumentation fails if the dist shape changes, and I confirmed that the browser product transform and optimizer settings were unchanged.
- Actual small reply smoke: 2 measured plus 1 warmup; existing full browser stages: 1; edit/patch stages: 1; disabled locale: 1.
- I rechecked counts, raw summaries, remainders, wire data, and hashes for all 50 main runs and the smoke runs.
- Product tests, typecheck, build, release checks, and pack were reused for unchanged product inputs and were not rerun.
- I confirmed that no temporary fixture/profile or benchmark browser remained. I also verified local document links, code blocks, the under-40 KB size limit, and `git diff --check`.
- No version bump, push, publish, or deploy was performed.
- Artifacts: [locale-add-reply-stages.json](../benchmarks/results/locale-add-reply-stages.json), [samples](../benchmarks/results/locale-add-reply-stages.10k-20-locales.samples.json), [smoke](../benchmarks/results/locale-add-reply-stages-smoke.json), [full browser regression](../benchmarks/results/reply-stages-full-browser-regression-smoke.json), [edit regression](../benchmarks/results/reply-stages-edit-regression-smoke.json), and [disabled](../benchmarks/results/reply-stages-disabled-smoke.json).
- Product hashes match the earlier locale-add-shared-freeze.json.

## Next work

Next is client-side post-receipt measurement under the default prebundle. First verify whether deep-freeze trust for the same core module is shared within the prebundled graph. Then divide decoding, validation, freezing, core acceptance, snapshot, and React. Disabling prebundling for instrumentation would change run conditions, so keep the same configuration. No follow-up product optimization was applied in this work.
