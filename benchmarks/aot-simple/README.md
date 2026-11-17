# Simple-message AOT experiment

This benchmark explores compiling literal and plain-argument messages to JavaScript
functions before shipping a production bundle. It changes only temporary copies of
compiled core. There is no new public API or production behavior change.

The candidate retains `createTranslator`, argument validation, fallback selection,
and immutable catalogs. A generated table keyed by exact message source bypasses
FormatJS text formatting for literal/argument ASTs. ICU number, date, select, plural
and ordinal messages, rich messages, `tParts`, and pseudo locales retain FormatJS.
Functions are emitted as ESM at benchmark preparation time; the browser bundle does
not evaluate source strings.

The current v2 prototype replaces each compiled message's wire AST with an index
into a shared template table. Each source string is shipped once. Templates contain
argument names and AST locations, and emitted render functions read literal spans
from the source instead of repeating their text. Messages with identical node and
location shapes share one render function. Quoted literals that differ from their
raw source span conservatively retain FormatJS.

The loader restores the complete ordinary immutable catalog, including source,
argument schemas and every AST location, using the existing catalog codec. Rich
parts and pseudo locales can therefore keep using their existing formatter paths.
This removes transport duplication; it does not eliminate the AST retained after
initialization or the FormatJS fallback runtime.

## Reproduce

From the repository root, with the locked dependencies installed:

```sh
npm run build --workspace=@0disoft/saylo-core
npm run build --workspace=@0disoft/saylo-typegen
npm exec -- tsc -p packages/vite/tsconfig.json
node benchmarks/aot-simple/run.mjs --verify-only
node benchmarks/aot-simple/run.mjs --out-file benchmarks/results/simple-aot-local.json
```

Temporary copies live beneath ignored `.release/` and are removed on success or
failure. Builds return chunks in memory, without a server, browser or network.

## Measurement contract

- Four deterministic catalogs: 64 and 512 messages, either all simple or with every
  tenth message using ICU number/plural/select/date formatting. Simple messages mix
  literals, one argument, and repeated arguments. Message text is unique per key.
- Both variants call the public translator with the same three rotating argument
  records. The loop sums returned string lengths to consume results. Timings cover
  warmed synchronous Node calls only; setup and bundle building are outside them.
- Each scenario has 100 warmup rounds, then five trials of 200 complete catalog
  cycles. Baseline, identical baseline control, and candidate run in rotated and
  reversed order. Every trial retains its raw microseconds-per-call sample.
- Before any speed verdict, the median difference between baseline and its identical
  control must be at most the greater of 15% or 0.5 microseconds per call. An invalid
  control suppresses the timing verdict. There is no retry-until-pass policy.
- A local saving requires at least the greater of 10% or 0.2 microseconds per call,
  and improvement in at least four of five corresponding trial samples. This is a
  small local comparison, not a statistical confidence interval or browser result.
- Vite builds the same public translator entry and serialized catalog for each
  variant, with library ESM output, minification, no sourcemaps, and the existing
  production AST formatter adapter. Both bundles must exclude the ICU source parser.
  Size is the sum of emitted JavaScript bytes and each chunk's gzip level-9 bytes.
- The v2 baseline uses `renderCatalogChunk` with its existing production compaction
  decision. The candidate uses the compact codec with shared simple-message
  templates. Both use identical outcome metadata wrappers and entry code. Existing
  compaction savings are not credited to the new backend.
- The 512-message scenarios exceed the existing 256-entry message formatter cache.
  Compiling simple messages can also reduce fallback cache pressure. That effect is
  included in the public-call measurement.
- These synthetic catalogs reuse three simple-message layouts. The result records
  the number of render templates; more diverse argument/location shapes in real
  translations can reduce sharing and change the size tradeoff.

Correctness is checked before measuring: 702 differential output/error comparisons
cover empty/literal/quoted/Unicode/repeated-argument messages, special property names,
code-like input, invalid arguments, unknown keys, rich text, ICU, and both pseudo
locales. Each measured catalog is also compared for all keys and argument records.
Catalog round trips also compare all transported fields with the original parsed
catalog. These checks execute temporary Node modules. Both emitted ESM bundles are
then executed in Node and compared with the original translator for text and rich
parts; the verification fixture supplies 144 additional emitted-bundle comparisons.
There is no browser execution.

The result JSON records the baseline commit, code hashes, tool versions, fixed
policy, verification count, raw timing samples, control verdicts and bundle hashes.
It does not establish browser rendering performance, startup cost, heap use, full
application bundle savings, or compatibility of a future production compiler.

## Deduplicated v2 run

See [the v2 result](../results/simple-aot-deduplicated-2026-11-18.json), measured on
the same Windows x64 / Node 24.18.0 / Vite 8.3.4 / FormatJS 12.1.3 environment.

| Scenario | Compiled messages / templates | Baseline / candidate us per call | Baseline / candidate gzip bytes | Gzip reduction |
| --- | ---: | ---: | ---: | ---: |
| 64 simple | 64 / 6 | 10.83 / 2.32 | 13,922 / 13,826 | 0.7% |
| 64 mixed | 57 / 6 | 13.63 / 5.42 | 14,647 / 14,392 | 1.7% |
| 512 simple | 512 / 9 | 34.85 / 2.37 | 23,216 / 20,938 | 9.8% |
| 512 mixed | 460 / 9 | 36.16 / 5.20 | 29,506 / 22,339 | 24.3% |

All four identical-implementation control gates passed. Warm Node call costs fell
by about 60% to 93% in these synthetic fixtures. Smaller catalogs saved only 96 and
255 gzip bytes, so the practical size benefit is concentrated in the larger cases.
Generated ESM execution supplied 13,968 text/parts comparisons across the verification
fixture and the four scenarios, in addition to 702 output/error comparisons and
complete catalog-field round-trip checks.

A preliminary v2 run used different metadata wrappers and was invalidated for that
comparison mismatch. The recorded run uses matching wrappers; the fixed timing and
control policy was not changed. Its preliminary receipt remains in the ignored
`.release/simple-aot-deduplicated-initial.json` local scratch file.

This is a working transport/compiler prototype, not an enabled product backend.
Its source, schemas and AST locations round-trip, and ICU/rich/pseudo behavior is
preserved in the checked cases. Production integration still needs representative
real-catalog shape diversity, browser execution and startup/memory evidence.

## Initial v1 run

See [the 2026-11-18 result](../results/simple-aot-2026-11-18.json). Interpret size and
timing independently; preserve invalid-control results when assessing the approach.

Windows x64, Node 24.18.0, Vite 8.3.4, FormatJS `intl-messageformat` 12.1.3:

| Scenario | Baseline / candidate us per call | Timing verdict | Baseline / candidate gzip bytes |
| --- | ---: | --- | ---: |
| 64 simple | 8.93 / 4.70 | 47.4% lower | 13,488 / 14,099 |
| 64 mixed | Withheld | Invalid identical-implementation control | 13,851 / 14,407 |
| 512 simple | 39.54 / 6.74 | 82.9% lower | 23,646 / 28,128 |
| 512 mixed | 42.71 / 9.71 | 77.3% lower | 24,402 / 28,438 |

The valid scenarios show a local warm-call benefit, including reduced cache pressure
at 512 messages. All four bundles grew, by about 4.0% to 19.0% gzip. The 64-message
mixed run failed its control gate and supplies no speed conclusion; its raw samples
are retained in the result.

The v1 result belongs to commit `e8f8b2a` and the code hashes in that JSON. Its
baseline serialized an expanded parsed catalog. Its numbers cannot be subtracted
from v2 numbers: the v2 baseline applies the existing production compaction policy.
The v1 prototype's bundle increase motivated the deduplicated representation above.
Browser execution, startup and memory measurements remain separate evidence before
considering production integration.
