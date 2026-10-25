# Add Saylo to an existing SvelteKit app

`saylo init --framework sveltekit [--base-locale en] [--apply] [--json]` adds an isolated `/saylo` route to an existing SvelteKit app. It is available from the source checkout and is not published in `0.1.0-alpha.7`. Until a future release includes it, build the checkout and run its CLI.

The command previews the integration by default. `--apply` writes the previewed files, `--base-locale` selects the base locale, and `--json` returns the report as JSON. Review the preview before applying it.

Build the checkout with `npm run build`, then run the following commands from the app directory:

```sh
node "<saylo-checkout>/packages/typegen/dist/catalog-cli.js" init --framework sveltekit --base-locale en --json
node "<saylo-checkout>/packages/typegen/dist/catalog-cli.js" init --framework sveltekit --base-locale en --apply --json
```

## Requirements

The app must already use Vite 8, Svelte 5, and SvelteKit with server rendering. `adapter-static` is rejected because the generated route needs a request-local server runtime.

The initializer adds the isolated `/saylo` route. It does not change existing hooks, layouts, routes, or `package.json`. Its `nextSteps` retains the generated `@alpha` install commands for `@0disoft/saylo-core`, `@0disoft/saylo-svelte`, `@0disoft/saylo-typegen`, and `@0disoft/saylo-vite`. For the verified setup, use matching builds of all four packages from the same checkout, or a later release that contains the complete preset. Runtime compatibility here was verified against matching checkout builds only; compatibility with the current published alpha packages has not been tarball-verified.

## Generated behavior

The route creates request-local state during SSR and hydrates from a compact boot payload. Locale selection uses this order:

1. The `?locale=` query parameter.
2. The HTTP-only locale cookie.
3. The `Accept-Language` header.
4. The base locale.

The generated page preserves state when the locale query changes and during live catalog edits. Its layout owns the catalog source for that layout and releases it during cleanup.

## Publication status

The SvelteKit initializer is source-only in the `0.1.0-alpha.7` release. Use the built checkout CLI and the matching package builds above until the initializer is published in a later release. The [alpha.7 release record](../releases/0.1.0-alpha.7.md) is the authoritative record of published release behavior.
