# Production catalog compaction

The published `0.1.0-alpha.7` release compacts production catalogs without removing source text, argument contracts, rich tags, or diagnostic locations. See the [alpha.7 release record](../releases/0.1.0-alpha.7.md).

The representation interns identical argument schemas and encodes literal/argument AST nodes as tuples. Complex ICU AST nodes remain unchanged. Decoding restores ordinary immutable catalogs without parsing ICU source. Source text remains the formatter cache key, so two edits of the same message cannot accidentally reuse an older formatter.

## Vite policy

`compactCatalogs` defaults to `true`. Eager catalogs, lazy boot catalogs, dynamic locale chunks and the server virtual module share the same representation. A catalog is compacted only when it saves at least 16 KiB of raw emitted data and more than 2 KiB after gzip. The gzip allowance covers the shared decoder; small catalogs retain the original representation and do not import it.

Set `compactCatalogs: false` in the Vite plugin options to compare against expanded output. It is a Vite-only option, not a field in `saylo.config.json`. Automatic key selection, sorting, fallbacks, schema fingerprints, pair versions and parser removal keep their existing behavior.

Compaction and gzip estimation run during builds. Immutable catalog results are memoized; development sources are not changed by this build policy. The development socket keeps its existing encoding and envelope but uses the shared core codec, avoiding two implementations of the tuple format.

## SSR boot

Existing `serializeBootSnapshot(boot)` calls still emit v1. To opt in, use `serializeBootSnapshot(boot, { compact: true })` on the server and pass the resulting string to `decodeBootSnapshot()` on the client. The v2 payload includes compact catalogs and omits the redundant base schemas. The decoder rebuilds schemas, validates manifest membership, pair stamps and translation contracts, and returns the existing canonical v1 object shape used by hydration.

Both server and client must use a release containing the new decoder before enabling v2. A framework that serializes a `BootSnapshot` object itself continues to send the expanded object; explicitly serialize/decode the compact string at that boundary to reduce its payload. Vite build compaction alone does not change framework-owned SSR data serialization.

## Measurements

Measured on 2026-10-25 with Node 24 and synthetic messages. These are payload/build sizes, not browser paint or interaction timings.

| Fixture | Expanded | Compact | Reduction |
| --- | ---: | ---: | ---: |
| 3,000-message catalog JSON | 1,279,735 B | 325,838 B | 74.5% |
| Same catalog, gzip | 50,304 B | 44,440 B | 11.7% |
| SSR boot for one 3,000-message namespace | 1,501,493 B | 326,538 B | 78.3% |
| Same SSR boot, gzip | 60,535 B | 44,796 B | 26.0% |
| Browser build, all JS chunks | 6,205,947 B | 3,119,539 B | 49.7% |
| Same browser build, sum of gzip chunks | 240,929 B | 225,316 B | 6.5% |

The browser fixture has two locales with 3,000 messages each and exports both eager and lazy paths. Its totals include the bundled decoder and all emitted JavaScript chunks, including dynamic chunks; they are not the initial request size alone. SSR build output is also checked with compaction on and off; external package files are not part of its emitted-chunk totals. Session IDs and generated chunk names can change gzip counts slightly between runs.

Reproduce the catalog/boot measurements with `node --test packages/core/test/catalog-codec.test.mjs` and the build comparison with `node --test packages/vite/test/compact-production.test.mjs`, after building the packages. The tests execute eager translation, lazy locale loading and server rendering, compare decoded catalogs and schema fingerprints, and cover mutable inputs, malformed tuples, rich content, ICU/date/number formatting, prototype-like IDs and HTML-safe boot JSON.
