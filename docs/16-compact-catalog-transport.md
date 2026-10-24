# 16. Compact Development Catalog Transport

Full present catalog responses on the lazy development path now use compact encoding with `status: "compact"` and `encoding: "saylo-catalog-v1"`. This applies only to transport on the development socket; catalog formats in public APIs are unchanged. [08-update-protocol.md](08-update-protocol.md) is the single source for the wire contract, and this document records implementation shape and verification.

## Scope

- Only the full present response of lazy `saylo:catalog` changed. Missing, failed, and request-scoped patches retain existing formats, as do eager snapshots, initial boot, the production chunk loader, and the SSR boot wire.
- The server encodes only when the result from `registry.loadDelta` is present. Session, pair-version, and schema-stamp checks and the client's `immutable` and `matches` application path are unchanged.
- Actual types are in `packages/vite/src/catalog-wire.ts`. Encoding is connected to the catalog-request response in `index.ts`, and decoding to response handling in `catalog-source.ts`.
- This change exists only in the local checkout and is not included in npm `0.1.0-alpha.1`.

## Encoding

The envelope sends the current `sessionId`, `key`, `catalogVersion`, and `namespaceSchemaFingerprint` with every response. The catalog payload is `{ sourceName, schemas, messages }`.

- A messages entry is `[id, source, offset, line, column, ast, schemaIndex]`.
- A literal or argument node without a position is `[type, value]`; with one, it is `[type, value, startOffset, startLine, startColumn, endOffset, endLine, endColumn]`.
- Complex ICU nodes such as number, date, time, skeleton, plural, select, selectordinal, and nested nodes retain their existing AST shape. The client does not reparse ICU.
- Messages with identical arguments JSON share one entry in catalog.schemas through schemaIndex.
- Because catalogs are immutable, their payload is cached in a WeakMap while unchanged. Session, pair version, and schema stamps are not cached and use current values for each response.

## Decoding and application

After decoding, the client passes the result through existing immutable processing and manifest `matches` checks. Core receives the same present outcome it saw before encoding.

- Validate the encoding name, envelope stamps, message-tuple length, node tuples, integer position ranges, schemaIndex range, and duplicate IDs. Reject mismatches with `Invalid compact catalog reply.`.
- A rejected full response fails that request and retains the previous valid UI. A later new request may recover. Full re-requests within the existing timeout apply only to broken patches.
- Patch re-request conditions apply only to existing request-scoped patches. A broken compact full response does not flow into a patch re-request.

## Verification

Locale-addition measurement was run with the following command on Node 24.18.0, Windows x64, Vite 8.3.2, React 19.3.0, and HeadlessChrome 154. From the [12 raw samples](../benchmarks/results/locale-add-compact-server-files.10k-20-locales.samples.json), the two warmups are excluded from the summary.

```sh
node benchmarks/live-update/run.mjs --mode locale-add --server-file-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-compact-server-files.json
```

- Vite's 77 tests passed (previous 72 plus 4 codec and 1 integration). Codec tests verify round trip, schema sharing and current stamps, malformed rejection, and less than half the size for a simple fixture. The integration test verifies that a broken compact full response does not change the UI and that a later request recovers.
- `npm run build --workspace=@0disoft/saylo-vite` and `npm run typecheck:consumers --workspace=@0disoft/saylo-vite` passed. The 77 tests include actual Vite production build and SSR verification. The Vite package's npm pack dry run included the new internal `dist/catalog-wire.js` and `.d.ts`. Actual tarball installation in external consumers and npm publication were not run.
- In 10 actual browser locale additions (warmup 2, control 10, [locale-add-compact-server-files.json](../benchmarks/results/locale-add-compact-server-files.json) and its samples), there were zero target responses before selection and one fresh full response after selection in each of the 10 runs. Full-response JSON p95 was 1,241,402 B, about 71.92% smaller than 4,421,174 B in the preceding [15](15-simple-message-parser.md) run under the same conditions; input JSON p95 was 387,783 B. Selection-ready→first-translation ack was p50 280.21 ms and p95 400.42 ms (previous p95 471.79 ms), browser selection→commit was p50 276.80 ms and p95 384.90 ms, save→list was p50 513.70 ms and p95 1,128.04 ms (previous p95 514.47 ms), catalog parsing p95 was 788.80 ms (previous 331.29 ms), control round-trip p95 3.70 ms, and file-write p95 60.48 ms. Input values, input nodes, and component state remained, there was no reload, generated `.d.ts` mtime and size were unchanged, and fixtures, browser profiles, and processes were cleaned up.
- A small edit browser smoke test ([live-update-compact-edit-smoke.json](../benchmarks/results/live-update-compact-edit-smoke.json), warmup 1, 2 measurements, 2 controls) checks that compact transport still returns patches and preserves state. Its sample is too small for p95 performance claims.

## Limitations

- The size reduction comes from field cleanup and schema sharing. The cause of latency improvement or regression is not established because load differences between runs and GC were not separated.
- The list p95 increase cannot be attributed directly to the full encoder because it runs after the list ack.
- The 250 ms list-display target is still not met, and parsing remains a bottleneck.
- The WeakMap retains encoded arrays for as long as the original catalog lives, so memory overhead has not been measured.
- A 10-run p95 is the maximum. Do not add stage p95 values or subtract Node and browser clocks from each other.
- Response size is the JSON UTF-8 size of the server-sent response object. It is not total physical network volume including WS headers, compression, and manifest. Result codeHashes, raw samples, p50, and p95 were compared and matched.
