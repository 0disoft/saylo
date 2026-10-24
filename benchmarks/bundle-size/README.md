# Demo production bundle measurement

The repository's actual vanilla and React examples are each built with Vite production builds using `astRuntime:false` and `true`. It reuses `createDemoConfig` from both example configs, and uses `write:false` so the existing `dist` is left untouched. The React config's typegen runs as usual, and the measurement checks that the hash of the measurement input, including the generated files, has not changed.

```sh
npm run build
node benchmarks/bundle-size/run.mjs
```

Optionally, pass a path for the result JSON as the first argument. The default is [../results/demo-bundle-size.json](../results/demo-bundle-size.json). For the conditions and how to read the results, see [../../docs/10-performance-measurements.md](../../docs/10-performance-measurements.md).

- Records the UTF-8 bytes of the client JS after Vite's default minification, plus the sum of per-chunk gzip (level 9) bytes. HTML, CSS, source maps, HTTP headers, Brotli, SSR, and load time are not measured.
- `initial` is the recursive sum of the JS loaded by the HTML entry and the JS statically imported by its chunks. `deferred` is the sum of all other emitted JS chunks. Shared chunks are counted once. It does not mean the user actually downloads every deferred chunk.
- vanilla uses `virtual:saylo` eagerly; React uses `virtual:saylo/lazy` with `initialNamespaces:['demo']`. Both apps start with `ko` and use the same `examples/vanilla/locales` (ko and en, namespace demo). In React, the en translations are a dynamic import.
- Compare the `astRuntime:false→true` difference within each app. React's total size includes React, ReactDOM, and the demo UI code. Do not treat the vanilla and React totals as Saylo runtime sizes to compare against each other.
- All four builds split initial and deferred JS from the actual chunk graph, and check that the parser error marker `EXPECT_ARGUMENT_CLOSING_BRACE` is present with false and gone with true. They also check that vanilla has no deferred chunks and React does.
- The results record the environment, base revision, working tree state, measurement input hash, chunk hashes, imports/dynamicImports, and individual chunk sizes. If a measurement was taken in a working tree with config or harness changes, do not identify the measurement code by `gitRevision` alone.
- Because each build's session UUID is random, output hashes and gzip sizes can differ slightly on re-runs. This record is one measurement of a repository example and is not a guarantee for general apps, other bundlers, or other data sizes. Parser removal is a local implementation and is not in the published `0.1.0-alpha.1`.
