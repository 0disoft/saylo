# Migrate an i18next directory

The directory workflow converts an i18next JSON-v4 tree to Saylo catalogs and can optionally update safe literal `t()` keys. It is included in the alpha.8 CLI build. The published single-file command remains available in the [alpha.7 release record](../releases/0.1.0-alpha.7.md).

```text
i18next/<locale>/<namespace>.json
        -> locales/<locale>/<namespace>.json
```

Locale directory names must be BCP 47 tags. Canonical duplicates such as `en-us` and `en-US`, namespace collisions, invalid JSON, unsupported i18next values, symlinks, existing output, and paths outside the output root block the whole plan.

From the repository root, build the CLI once:

```sh
npm run build --workspace=@0disoft/saylo-typegen
```

Preview every catalog without writing:

```sh
node packages/typegen/dist/catalog-cli.js migrate \
  --from i18next --from-dir i18next --out-dir locales \
  --escape-value false --json
```

`--escape-value false` confirms that the source app disables i18next interpolation escaping. The preview reports each source-to-Saylo key mapping, conversion issues, and a checkpoint. Both input and output roots must already exist; output locale directories are created as needed.

Apply the same plan:

```sh
node packages/typegen/dist/catalog-cli.js migrate \
  --from i18next --from-dir i18next --out-dir locales \
  --escape-value false --apply --json
```

Apply acquires `.saylo-migrate.lock` in the output root, rechecks every input hash and target, and writes each complete catalog only if its target still does not exist. A late filesystem failure or concurrent target can leave earlier catalogs committed. The error report keeps the completed `writtenFiles` and checkpoint entries so those files can be inspected or used.

SIGINT and SIGTERM stop further work, clean staged files and the lock, and report catalogs already written. A lock left by forced termination requires checking the recorded process before manual removal. There is no overwrite or rollback option.

## Optional literal call rewrite

Call rewriting is a separate opt-in step:

```sh
node packages/typegen/dist/catalog-cli.js migrate \
  --from i18next --from-dir i18next --out-dir locales \
  --escape-value false --apply --json \
  --rewrite-calls --source-dir src --namespace shop
```

Omit `--apply` to preview both catalogs and source changes. The namespace must exist in every locale represented in the directory plan, and its catalog files must have identical message-ID sets. Source edits are planned together with catalogs, and any call issue blocks catalog output as well.

Only direct literal keys on these bindings are rewritten:

```ts
import { t } from 'i18next';

t('title');
```

```tsx
import { useTranslation } from 'react-i18next';

export function Title() {
  const { t } = useTranslation('shop');
  return t('title', { name: 'Ada' });
}
```

`useTranslation` may omit its namespace or use exactly `useTranslation('shop')`. A key without a prefix must match a converted ID and becomes `shop:title`. An existing `shop:` prefix is kept only when its suffix matches a converted ID. Hook imports, providers, and application wiring are not changed.

The rewrite blocks instead of guessing when it finds dynamic or missing keys, aliased imports, namespace mismatch, `.t()` member calls, optional calls, multiple or reassigned bindings, shadowed `useTranslation`, parse errors, or source symlinks. Extra `t()` arguments are accepted only as an inline object containing interpolation values. Options such as `ns`, `keyPrefix`, `defaultValue`, context, language, or return-shape settings block the rewrite, as does a third argument.

## Manual work

Migrate `i18n.t()`, `getFixedT`, aliases passed as values, `<Trans>`, `withTranslation`, provider objects, optional calls, computed keys, and hook/provider rewiring by hand. Context selection, plural behavior outside the supported cardinal groups, fallback policy, custom separators, and application initialization also remain manual. Run catalog checks and regenerate declarations after applying the migration.
