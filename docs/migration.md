# Migrate one i18next namespace

The source checkout provides `saylo migrate` and `@0disoft/saylo-typegen/migrate`. They require a future npm release; alpha.6 does not include them. Migration reads one namespace resource at a time, so you can move one screen without replacing the rest of an app.

Supported input follows the default [i18next JSON v4 format](https://www.i18next.com/misc/json-format): nested string keys, simple `{{name}}` interpolation, and cardinal plural suffixes. Namespace and flattened dotted IDs are preserved. The report maps source keys to Saylo keys, such as `shop:title` and `shop:items`.

After building this checkout, run from your application directory:

```sh
node "<saylo-checkout>/packages/typegen/dist/catalog-cli.js" migrate --from i18next --file i18next/en/shop.json --locale en --namespace shop --escape-value false --json
node "<saylo-checkout>/packages/typegen/dist/catalog-cli.js" migrate --from i18next --file i18next/en/shop.json --locale en --namespace shop --escape-value false --out-file locales/en/shop.json --json
```

The first command only prints a preview. The second exclusively creates a new catalog; its parent directory must already exist. Existing files and linked output parents are rejected. Source files are never modified, and any conversion issue blocks the entire catalog. The preview includes `catalog`, `mappings`, and `issues`. Exit codes are 0 for ready/written, 1 for blocked conversion, and 2 for usage, invalid JSON, or filesystem errors.

`--escape-value false` must reflect your source application's actual setting. i18next [escapes interpolated values by default](https://www.i18next.com/translation-function/interpolation); Saylo returns text and relies on the UI renderer for HTML escaping. Without confirmation, ordinary interpolation blocks migration. Explicit `{{- name}}` is already unescaped. Render migrated text through framework text nodes or `textContent`, and review any code that renders HTML.

For example:

```json
{
  "header": { "title": "Hello {{name}}" },
  "items_zero": "Empty",
  "items_one": "{{count}} item",
  "items_other": "{{count}} items"
}
```

becomes:

```json
{
  "header.title": "Hello {name}",
  "items": "{count, plural, =0 {Empty} zero {Empty} one {{count} item} other {{count} items}}"
}
```

The `_zero` override preserves exact zero, including locales where `zero` is also a plural category. Every locale category and `other` must be present. Count interpolation remains `{count}` instead of `#`, preserving unformatted numbers. Literal braces, apostrophes and pound signs are escaped for their ICU context.

To validate a translated namespace against an existing Saylo base catalog, add `--base-file locales/en/shop.json --base-locale en`. Argument and rich-text contract failures block output.

## Manual work

The tool does not rewrite call sites, UI rendering, fallback settings, custom separators, or application configuration. Change call sites to the mapped `namespace:key` and pass the generated argument names. Context suffix keys remain literal keys; context-based selection must be adapted explicitly. Custom context and plural separators cannot be inferred from a JSON resource.

Arrays, empty objects, non-string values, `$t()` nesting, model-path interpolation, custom interpolation formatters, ordinal/legacy plurals, incomplete plural groups, flattened key collisions, and duplicate JSON properties are rejected. A plain key coexisting with a plural group also requires a manual decision because ICU plural messages require a count argument. Literal IDs ending in plural suffixes may need to be prepared manually before conversion.

FormatJS, Lingui, PO and XLIFF import are outside this first adapter's scope. Keep those catalogs unchanged until their format-specific semantics are supported.
