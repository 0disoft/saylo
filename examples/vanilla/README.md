# Vanilla demo

An example that uses the Saylo Vite plugin with a minimal setup. Run commands from the repository root.

## Development server

```sh
npm run dev
```

It uses the full schema and full catalog, and saving files in `locales/` applies them to the screen immediately.

## Production build

The default build includes all messages and writes to `examples/vanilla/dist/`.

```sh
npm run build:demo
```

The selective build includes only the keys in `demoKeys` from `selected-keys.mjs` and writes to `examples/vanilla/dist-selected/`.

```sh
npm run build:demo:selected
npm run preview:demo:selected
```

`preview:demo:selected` serves `examples/vanilla/dist-selected/` on 127.0.0.1.

This screen uses every key in `demoKeys`, so building the original example gives the same size for the default and selective builds. The difference appears only when unused keys are present.

## Selective key management

`demoKeys` is a hand-written list of the keys this screen actually uses. Include every `data-message` and `data-placeholder` value and every key called directly from code with `t()` (such as `demo:summary`). Calling a missing key in production raises `UnknownMessageError`. When adding or removing keys on the screen, update this list and rebuild. `includeKeys` is not in the published `0.1.0-alpha.4`, and it is also absent from the `0.1.0-alpha.5` candidate tarball frozen at commit `2037f9a`, before this feature was added. It is not published yet.

## Selective build validation

```sh
npm run verify:demo:selected
```

Chrome or Chromium is required; if it is not in the default path, set the executable path with the `SAYLO_CHROME` environment variable. The check makes a temporary copy of the vanilla fixture and adds 100 unused keys per language. It compares the minified output of the default and selective builds from the same fixture, then checks ko/en switching, plurals, form, and dialog state preservation in actual Chromium, and records the result in `.release/selective-build-report.json`. The size difference here comes from a synthetic fixture and should not be read as a general improvement rate.
