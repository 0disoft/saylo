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

The prototype deliberately retains catalog ASTs and source strings as well as the
full formatter fallback. It measures the cost and benefit of adding a dispatch fast
path, rather than a complete AOT backend that replaces the catalog representation.
In particular, faster calls do not imply a smaller bundle.

## Reproduce

From the repository root, with the locked dependencies installed:

```sh
npm run build --workspace=@0disoft/saylo-core
npm exec -- tsc -p packages/vite/tsconfig.json
node benchmarks/aot-simple/run.mjs --verify-only
node benchmarks/aot-simple/run.mjs --out-file benchmarks/results/simple-aot-local.json
```

The Vite typecheck requires the typegen declarations to have been built too. Use
`npm run build --workspace=@0disoft/saylo-typegen` before it on a fresh checkout.
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
- The 512-message scenarios exceed the existing 256-entry message formatter cache.
  Compiling simple messages can also reduce fallback cache pressure. That effect is
  included in the public-call measurement.

Correctness is checked before measuring: 702 differential output/error comparisons
cover empty/literal/quoted/Unicode/repeated-argument messages, special property names,
code-like input, invalid arguments, unknown keys, rich text, ICU, and both pseudo
locales. Each measured catalog is also compared for all keys and argument records.
These comparisons execute the temporary Node modules. Emitted browser bundles are
checked for size and parser exclusion, without browser execution.

The result JSON records the baseline commit, code hashes, tool versions, fixed
policy, verification count, raw timing samples, control verdicts and bundle hashes.
It does not establish browser rendering performance, startup cost, heap use, full
application bundle savings, or compatibility of a future production compiler.

## Recorded run

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

Do not enable this prototype in the product on these results. A size-focused AOT
backend would need to remove redundant catalog/AST data and account for fallback
runtime retention, while preserving the existing public translation contracts.
Browser execution, startup and memory measurements would then be separate evidence.
