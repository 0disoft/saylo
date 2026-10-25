# @0disoft/saylo-typegen

Generate `AppSchema` type declarations (`.d.ts`) from the Saylo base catalog. Run the `saylo-typegen` CLI, or let `@0disoft/saylo-vite` run it in the background during development.

## Status

On Windows, if a rename fails with `EPERM`, `EACCES`, or `EBUSY`, the writer retries up to five times. The total retry wait is at most 620ms, and if a newer job arrives or the generator is stopped while waiting, replacement of the earlier job is canceled. It does not delete the existing file first. This change is included in the `0.1.0-alpha.2` release.

Success is determined from the output actually persisted to disk. If a newer request arrives in the middle, a result already written to the file is still recorded as a success, and saving the same catalog again after a generation failure retries instead of skipping the earlier result. This behavior is included in the `0.1.0-alpha.4` release.

`writeGenerated(outFile, source, isCurrent?, { signal, operations }?)` in the alpha.6 source lets you inject file I/O, temporary naming, and replacement operations. Cancellation returns `cancelled` and is checked between I/O steps and during replacement retries. A cancellation that arrives after a successful rename does not change `written`. Only temporary files that were created exclusively are cleaned up, and if a write failure and a cleanup failure overlap, the original failure takes precedence. `new TypeGenerator(outFile, { createWorker, write }?)` lets you inject the worker and writer, and a late completion or failure from the previous worker is not applied to the new job.

This README describes `0.1.0-alpha.6` (dist-tag `alpha`). See the [release record](https://github.com/0disoft/saylo/blob/main/releases/0.1.0-alpha.6.md) for publication and registry verification. The first published version was `0.1.0-alpha.1` from 2026-10-06. You can also run it directly from the repository workspace with `node packages/typegen/dist/cli.js`.

## Installation

```sh
npm install --save-dev @0disoft/saylo-typegen@alpha
npm install @0disoft/saylo-core@alpha
```

The `latest` tag of Saylo packages still points to a registration placeholder, so specify `@alpha`. `@0disoft/saylo-core` is needed when you consume the generated types with core generics. It is not needed when you only generate type declarations. If the CLI is already installed, use `npx saylo-typegen` as shown in the examples below.

## Catalog

Use the `locales/<locale>/<namespace>.json` structure. For example, `locales/ko/demo.json` and `locales/en/demo.json`.

```json
{ "greeting": "안녕 {name}" }
```

```json
{ "greeting": "Hello {name}" }
```

## Running

### Initialize an existing Vite app (source checkout)

The new `saylo init` command previews integration by default; `--apply` creates a starter catalog, shared config, virtual-module types, a typed store factory, and connects a static ESM Vite config. It preserves conflicting files and prints package-manager install commands instead of running them. UI providers and SSR request/hydration wiring remain explicit. See the [init guide](../../docs/init.md) for requirements, preview output, cleanup, and failure recovery. This command is not in published alpha.6 and requires a future release.

From the app directory, after building this checkout:

```sh
node "<saylo-checkout>/packages/typegen/dist/catalog-cli.js" init --base-locale en --json
node "<saylo-checkout>/packages/typegen/dist/catalog-cli.js" init --base-locale en --apply --json
```

### Shared configuration and catalog checks (alpha.5)

`loadProjectConfig()` and the `saylo` command in the current checkout are not in the npm `alpha.4` release. The existing `saylo-typegen` arguments are preserved, and the new `--config` option reads the same JSON configuration as Vite. Configuration code other than JSON is not executed.

```json
{
  "format": "saylo-project/v1",
  "localesDir": "locales",
  "baseLocale": "ko",
  "checkLocales": ["en", "fr"],
  "typegen": { "outFile": "generated.d.ts" }
}
```

Save the content above as `saylo.config.json`. Paths are resolved relative to the directory containing the configuration file. `richText` uses the same namespace → message ID → allowed tag list as Vite, and declared keys must exist in the base catalog. `checkLocales` is the set of locales the CLI checks for completeness; it is not a setting that adds locales to Vite. When omitted, it checks the locales it finds, including empty directories. `initialLocale` is also included in the check.

In a project that installed alpha.5 or later, use the following commands. `--no-install` uses the installed executable without downloading other packages.

```sh
npx --no-install saylo-typegen --config saylo.config.json
npx --no-install saylo check --config saylo.config.json --json
npx --no-install saylo sync --config saylo.config.json --dry-run --json
```

In the repository, after building, you can check the example with `node packages/typegen/dist/catalog-cli.js check --config examples/vanilla/saylo.config.json --json`. The Vite plugin for the vanilla example reads the same configuration.

`check` reports JSON, ICU, argument, and rich contract errors, translation keys that are not in the base, and missing namespaces and messages together. Missing entries in the explicitly specified completeness targets are errors in the check even though the runtime can fall back to the base locale. An empty translation string is treated as a valid translation. It does not guess and delete keys that are unused in source.

`sync --dry-run` prints an `add`, `review`, and `retain` plan. `translation: null` on an addition means it has not been translated yet and is not an actual catalog value. Existing translations and keys or namespaces that are not in the base are preserved, and broken files are not proposed for replacement. `export`, `snapshot`, and `refresh` without `--out-file`, and `check` and `sync`, are read-only and do not write catalogs, generated types, or review records. There is no delete or automatic translation feature. The only command that writes translations to catalogs is `import --apply`.

The following `snapshot` and `baseline` examples use the earlier baseline-only review method that does not use `reviews`. If you use an approval ledger, follow [Optional translation approval records](#optional-translation-approval-records-alpha5) later in this document.

To compare source changes, first save the stdout of `snapshot` to a file. The review record stores only the SHA-256 of each message's source text and rich contract, not the source text or translation content.

```sh
npx --no-install saylo snapshot --config saylo.config.json > saylo-baseline.json
npx --no-install saylo check --config saylo.config.json --baseline saylo-baseline.json --json
npx --no-install saylo sync --config saylo.config.json --baseline saylo-baseline.json --dry-run --json
```

You can also put the `baseline` path in the shared JSON. If a path is specified but the file is missing or invalid, the command fails. `snapshot` does not read an existing baseline. Without `--out-file` it prints the new comparison baseline to stdout; with it, it writes a new file. Even if `baseline` in the configuration points to the same path, `snapshot` does not read it, so you can create the first baseline when the file does not exist yet. Creating a baseline record is not translation approval; it is possible with incomplete translations but is rejected if any catalog is invalid. `check` and `sync` do not update the record. If the source text or allowed tags change, the existing translation is marked `SOURCE_CHANGED`; if the new source text already has a translation, it is marked `SOURCE_ADDED`. `reviewTracking` is `"not-configured"` only when neither `baseline` nor `reviews` is specified; with only `baseline` it is `baseline`, with only `reviews` it is `approvals`, and with both it is `baseline-and-approvals`. After reviewing manually, update the comparison baseline.

When updating an existing comparison record without `--out-file`, save stdout to a new file, confirm exit code 0 and the content, and then replace the original. Redirecting directly over an existing baseline can let the shell truncate the existing file before the command fails. A new file can be created with `--out-file`, and existing files are not overwritten.

### Safe file output (alpha.5)

`--out-file <new.json>` is supported only for `export`, `snapshot`, and `refresh`. Without it, the existing stdout output and read-only behavior stay the same. A relative path is resolved from the cwd and must have a `.json` extension. The parent directory must actually exist and must not be a symlink, and the path cannot be inside `locales` or point to an input work file, configuration, a baseline that is actually read, or a reviews path. Existing files, directories, and symlinks are rejected, and there is no `--force` or overwrite option.

After building and validating the entire output JSON, it writes to an exclusive temp file in the same directory, closes it, and then publishes the new file with a hardlink. Existing files are not overwritten. Filesystems that do not support hardlinks fail safely and clean up the temp file. On success, stdout contains only one receipt, `{"format":"saylo-file-output/v1","command":"export"|"snapshot"|"refresh","writtenFiles":[absolute paths],"blocked":boolean}`, and `--json` is not needed. The actual work file, snapshot, or refresh JSON goes to the specified file, and `blocked` is the blocking state of the saved content.

```sh
npx --no-install saylo export --with-context --out-file translation-work.json --config saylo.config.json
npx --no-install saylo snapshot --out-file saylo-baseline.json --config saylo.config.json
npx --no-install saylo refresh --file translation-work.json --out-file refresh-report.json --config saylo.config.json
```

If JSON validation for `export` or `snapshot` fails, it does not create the outfile; it prints the existing diagnostics to stdout and exits 1. `refresh` does not create a file when `workfile` is `null`, and when there is a conflict but a `workfile` exists, it saves the full report and still exits 1. Usage and output errors exit 2; cancellation is SIGINT 130 and SIGTERM 143. When you need to preserve an existing file, use `--out-file` instead of shell redirection.

### Exporting and importing translation work files (alpha.5)

`export` and `import` exist only in the current checkout and are not in npm `alpha.4`. `export` prints only missing `add` jobs and `review` jobs whose source text or rich contract changed or was added relative to the baseline to stdout as JSON. It does not include `retain` entries that keep existing translations. The output format is `saylo-translation-work/v1`.

```sh
npx --no-install saylo export --config saylo.config.json > translation-work.json
```

To include source-change reviews in the earlier baseline-only method that does not use `reviews`, add `--baseline saylo-baseline.json` or set `baseline` in the configuration. Without a baseline, only `add` jobs are emitted. If the catalog is invalid when `--out-file` is not specified, it prints a `saylo-check/v1` report to stdout instead of a work file and exits 1. Even with `--out-file`, a validation failure creates no outfile and prints the same diagnostics to stdout. An export without `--out-file` does not write to disk, so save stdout to a new file, confirm the exit code and content, and then replace the existing work file.

The `source`, `sourceHash`, and `originalTranslation` of each entry are checkpoints from the time of export. Change only `translation` and leave the other fields as they are. `originalTranslation` is `null` for an `add` entry, and a `review` entry starts from the existing translation. If you leave a `review` entry untouched, its `translation` equals `originalTranslation`, so it is skipped on import. `translation: null` is work not done yet, and `""` is a valid translation.

```json
{
  "format": "saylo-translation-work/v1",
  "baseLocale": "ko",
  "entries": [
    {
      "locale": "en",
      "namespace": "demo",
      "id": "greeting",
      "reason": "add",
      "source": "안녕 {name}",
      "sourceHash": "763db49e97b5a0937ce680dc9d9b5ac57b79408890eddf3ed4829d85cf13a617",
      "originalTranslation": null,
      "translation": "Hello {name}"
    }
  ]
}
```

The `sourceHash` in the example only shows the shape. It is not a file to run as-is; it shows the form where you change only `translation` in the export result, and in a real file you keep the value written by export.

Specifying `export --with-context` emits `saylo-translation-work/v2` and adds `context` to each entry. Without the option, it stays v1, and entries keep the existing 8 fields without `context`.

```json
{
  "context": {
    "arguments": {
      "count": ["number"],
      "at": ["date", "number"],
      "name": ["number", "string"]
    },
    "richTextTags": ["link"]
  }
}
```

`arguments` tells you which arguments and types the base schema allows, and it does not mean every argument must be used in the translation. You can omit arguments as before. `richTextTags: null` means the rich policy does not apply, so the tag shape may be text; `[]` means rich mode with no allowed tags; an array such as `["link"]` is the allowlist.

```sh
npx --no-install saylo export --with-context --config saylo.config.json > translation-work-v2.json
```

`import`, `approve`, and `refresh` read both v1 and v2 automatically. The `context` structure of v2 is validated, but its content is informational; actual `sourceHash`, ICU, argument, tag, and approval validation uses the current catalog and configuration. Editing `context` cannot change the allowed rules. `--with-context` is accepted only by `export` and `refresh`; other commands exit 2. This option and the v2 format are included in alpha.5.

`import` requires `--file` and exactly one of `--dry-run` or `--apply`. `--dry-run --json` prints only the validation result and the list of changes, and `--apply --json` writes translations that pass validation to the catalogs.

```sh
npx --no-install saylo import --file translation-work.json --dry-run --json
npx --no-install saylo import --file translation-work.json --apply --json
```

`import --dry-run --diff` prints a unified diff with 3 lines of context using paths relative to `localesDir`, without changing files. New files start with `--- /dev/null`, and the no-newline-at-end-of-file marker and CRLF line endings are preserved in the diff. `--diff` is valid only with `import --dry-run`, and using it with `--apply` or another command is a usage error (exit 2).

```sh
npx --no-install saylo import --file translation-work.json --dry-run --diff
```

`--diff --json` adds a `diff` string to the existing `saylo-translation-import/v1` report. When blocked, it returns `diff: null` and exit 1; when there are no changes, it returns `diff: ""` and exit 0. Normal blocked output prints only the existing diagnostics and summary and does not print a diff.

You can complete only some entries. It skips entries whose `translation` is `null` or equal to `originalTranslation`, and re-importing values that were already applied performs no write. If any single entry fails validation, the whole apply is blocked.

It validates the work file format, base locale, locale/namespace/id, and duplicates. Target paths are built from the canonical locale directories under the root and the namespace rather than trusting paths written in the work file. If the source text or rich contract changed after export, it blocks with `SOURCE_CONFLICT`; if the existing translation differs from `originalTranslation`, it blocks with `TRANSLATION_CONFLICT`, so export again and redo the work. It also validates the JSON, ICU arguments, and rich tags of the merged result for every file first.

`--apply` writes a temp file per file and renames it, retrying when `EPERM`, `EACCES`, or `EBUSY` occurs on Windows. It rechecks paths before writing and fails if a symlink or junction exists. It stages and validates all output before starting the first replacement, but it does not group multiple files into one transaction. If a late I/O or contention failure occurs, files written earlier may remain, and the `writtenFiles` field of the `--json` error lists them. It does not overwrite already written files to roll them back.

`.saylo-import.lock` in the root blocks concurrent Saylo imports. The lock may remain if a process is killed, so after checking that the pid written inside has actually ended, delete the leftover lock manually.

A byte comparison before replacement and rename retries detect edits in between, but this is not a filesystem CAS that prevents another editor from writing between the last check and the rename.

`import --apply`, `approve --apply`, and `export`, `snapshot`, and `refresh` with `--out-file` receive SIGINT and SIGTERM as an AbortSignal. On a signal, they stop further writes and publications, wait for in-flight I/O and cleanup of handles, temp files, and locks, and then exit. They do not roll back an atomic rename or an outfile hardlink publish that already succeeded, and files completed concurrently with the signal are still reported accurately in `writtenFiles`. The first signal takes precedence, and repeated signals during cleanup do not force an immediate exit. Both normal exit and failure remove the CLI signal listeners. Cancellation exit codes are SIGINT 130 and SIGTERM 143; other general errors are 2.

For a `--json` cancellation of `import --apply` or `approve --apply`, the existing `saylo-command-error/v1` `error` gets `cancelled: true`, `signal: "SIGINT"|"SIGTERM"`, and `writtenFiles: [...]`, while the `message` explaining the cause is kept. `--out-file` follows the same cancellation, `writtenFiles`, and cleanup guarantees. Dry runs and read-only paths without `--out-file` are not affected. SIGKILL, a forced Windows termination, or power loss do not guarantee cleanup, so the existing manual stale-lock check policy remains.

`--apply` replaces only the changed string tokens in an existing file, preserving key order, indentation, line endings, final newline, and escape spellings that were not modified, and appends new keys using the existing spacing around colons, indentation, and line-break style. Multi-line empty objects use 2-space indentation, and new files use 2 spaces, LF, and a final newline. Unrelated keys and orphan keys are left as they are.

`import` does not rebuild type declarations or the baseline. After applying, run `saylo check` and type generation (`saylo-typegen`) separately. Updating the baseline is separate from translation approval.

### Refreshing a translation work file (alpha.5)

`refresh` merges the work file in progress with the latest `export` candidates and prints a `saylo-translation-refresh/v1` report to stdout. With `--out-file`, the actual report is written to that file and stdout gets a receipt. Even without `--json`, the whole stdout is a single JSON document, and the report contains `blocked`, `workfile`, `conflicts`, `alreadyApplied`, and `report`. `workfile` is `saylo-translation-work/v1` or `saylo-translation-work/v2`, and is `null` if the catalog is invalid, such as from a JSON, ICU, argument, or rich policy error. Residual translations for removed source keys or namespaces are still compared and shown as `SOURCE_REMOVED`; `UNKNOWN_MESSAGE` and `NAMESPACE_MISMATCH` are kept in `report` but these two diagnostics alone do not block candidate generation, and catalogs are not deleted. `report` is the catalog check result. If `workfile` is `null`, no `--out-file` is created.

```sh
npx --no-install saylo refresh --file translation-work.json --config saylo.config.json > refresh-report.json
# exit 0과 내용을 확인한 뒤
jq '.workfile' refresh-report.json > refreshed-work.json
```

`--config` or `--locales` determines the catalogs, and `--baseline` and `--reviews` apply as they do for `export`. Without an approval ledger, it can start from an empty ledger like `export`, but a specified `baseline` that is missing fails. `refresh` writes no input work file, catalog, baseline, approval ledger, or generated types other than the report specified by `--out-file`. It does not accept `--apply` or `--dry-run`; those are usage errors.

If the source and rich hashes and the current catalog translation have not changed from `originalTranslation` in the work file, it keeps the content written in `translation`. `null` and the empty string are kept as in-progress states, and new `add` and `review` jobs from the latest export are included and sorted by locale, namespace, and id.

`refresh` keeps v1 for v1 input and v2 for v2 input, and recalculates v2 `context` from the latest values. Giving `--with-context` with v1 input promotes it to v2; new jobs and `conflicts.current` get the latest `context`, while `conflicts.previous` and `alreadyApplied` keep the snapshot from the input.

`SOURCE_REMOVED`, `SOURCE_CONFLICT`, `TRANSLATION_CONFLICT`, and `UNKNOWN_TARGET` are placed in `conflicts` as `{ code, previous, current }`. `previous` is the original entry, and `current` is the latest entry or `null`, preserving the source text and the written translation. `translation` in `conflicts.current` is `null`, and conflicting keys are removed from `workfile.entries`. For conflicts with `current`, review the latest source text, fill `current.translation`, and then add it to the candidates. For deleted or excluded-target entries with `current: null`, keep the earlier entry as a record or restore the source and target, then run `refresh` again.

If the current catalog translation equals the written translation and that written translation differs from `originalTranslation`, the earlier entry is added to `alreadyApplied`. `workfile` keeps a reviewable entry whose `originalTranslation` and `translation` are both the current translation. `import` on this entry is a no-op, and approval is handled separately with `approve`. Whether the source changed is checked before the `alreadyApplied` decision.

The whole report is not input to import or approve. Use `refreshed-work.json`, extracted from the top-level `workfile` with `jq`, in the next step. The report remains even on `exit 1`, so check `conflicts[].previous` and `current`, edit the work file by hand, and extract it.

### Optional translation approval records (alpha.5)

`reviews` is an optional feature that binds approved locales and keys to the source and translation hashes at that time. Put `{"reviews": "saylo-reviews.json"}` in the shared JSON, or add `--reviews` to `check`, `sync`, `export`, `refresh`, or `approve`. When not specified, the existing baseline-only behavior is kept. The ledger stores only the source and rich contract hash and the translation hash per locale/namespace/id.

If `requireReviewedTranslations: true` and `reviews` are both set in the shared JSON `SayloProjectConfig`, Vite production builds that read the same configuration also enforce approval checks. This option defaults to `false`, and `true` without `reviews` is rejected in Vite dev as well.

When you first enable it, existing translations in target locales also require explicit approval. `check` and `sync` fail (exit 2) when the ledger is missing, while `export`, `refresh`, and `approve` start from an empty record. `export` does not write the ledger and emits all translated existing keys as `review` jobs.

```sh
npx --no-install saylo export --reviews saylo-reviews.json --locales en > review-work.json
npx --no-install saylo approve --reviews saylo-reviews.json --file review-work.json --dry-run --json
npx --no-install saylo approve --reviews saylo-reviews.json --file review-work.json --apply --json
```

Leave translation strings you have verified after reviewing the work file as they are. For entries you have not verified yet, set `translation` to `null` or remove them from the file. Entries with `translation: null` are not approved; keeping an existing translation whose value is unchanged also lets you approve it explicitly. If the current source or rich hash or the translation changed after export, it blocks as a conflict and does not apply partially. `import --apply` also does not approve translations automatically.

`approve --apply` adds only approval records for verified entries and writes no catalog, baseline, or type declaration. Existing approvals for other locales or keys are preserved, and creating a new baseline does not change the approval ledger or unapproved states. After approval, a changed source is `SOURCE_CHANGED`, a changed translation is `TRANSLATION_CHANGED`, and a key with no record is `REVIEW_REQUIRED`. `check`, `sync`, `export`, and `refresh` all apply the ledger and report these states.

The ledger must be a `.json` file outside `locales`. When writing, the parent directory must actually exist and must not be a symlink, and a symlink ledger path is rejected. The same ledger is serialized by a per-ledger lock and replaced with an atomic rename. A lock left by a forced termination is deleted after checking that the owning pid has ended.

Exit codes are: `check` 0 when normal and 1 when there are diagnostics; `sync` 0 when the plan is generated and 1 when blocked, for example by an invalid catalog; `snapshot` 0 when normal and 1 for an invalid catalog. `export` exits 0 when the work file is created and 1 for an invalid catalog; `import` and `approve` exit 0 when a preview is available or the apply completes and 1 when blocked by a conflict or validation failure. Cancellation of `--apply` or `--out-file` is SIGINT 130 and SIGTERM 143, and other general errors are 2. `refresh` exits 0 for a candidate with no conflicts, 1 for conflicts or an invalid catalog, and 2 for usage, filesystem, or work file format errors. Without `--json`, the whole stdout of `refresh` is a single JSON report. `--json` errors from other commands are also returned as a single JSON document on stdout, and help does not read the disk. The existing `saylo-typegen` exit codes of 0 and 1 are preserved.

### Generating types with the existing arguments

```sh
npx saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts
```

After validating every catalog under `--locales-dir`, it writes the declarations for the base locale. If an invalid translation file exists, it exits with an error. `AppSchema` generated from the catalog above has the shape `{ "demo:greeting": { "name": number | string } }`; numbers are `number`, ordinary interpolation is `number | string`, and dates are `Date | number`. Arguments used in any ICU branch are also generated as required.

Connect the generated `AppSchema` to the core generics.

```ts
import { readFile } from 'node:fs/promises';
import { parseCatalog, createStore } from '@0disoft/saylo-core';
import type { AppSchema } from './generated.js';

const read = async (locale: string) => parseCatalog(
  await readFile(`locales/${locale}/demo.json`, 'utf8'),
  { locale, namespace: 'demo', sourceName: `locales/${locale}/demo.json` },
);

const store = createStore<AppSchema>({
  baseLocale: 'ko', locale: 'en', timeZone: 'UTC',
  catalogs: [await read('ko'), await read('en')],
});
console.log(store.t('demo:greeting', { name: 'Saylo' })); // "Hello Saylo"
store.dispose();
```

In a JavaScript project, connect the same key and argument checks with the JSDoc `/** @type {import('@0disoft/saylo-core').Store<import('./generated.js').AppSchema>} */`.

`--help` and `-h` print the options and an example to stdout and exit 0. Help does not read catalogs or write an output file.

```text
Usage: saylo-typegen --locales-dir <directory> --base-locale <locale> --out-file <file.d.ts>

Required options:
  --locales-dir <directory>  Directory containing locale/namespace.json catalogs.
  --base-locale <locale>     Base BCP 47 locale, for example ko or en-US.
  --out-file <file.d.ts>     Generated declaration file; must end in .d.ts.

  --config <file.json>      Shared project settings; explicit flags override their paths relative to cwd.

  --help, -h                Show this help without reading or writing files.

Example:
  saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts

All catalogs are validated before writing. Invalid catalogs leave existing output unchanged.
```

A missing required option, an unknown option, a `--base-locale` that is not in BCP 47 form, or an `--out-file` that does not end in `.d.ts` is a usage error. It writes the message and the hint `Run saylo-typegen --help for options and an example.` to stderr, exits 1, and leaves stdout empty. The `--out-file` extension and `--base-locale` checks run before reading catalogs from disk, so invalid options fail before file I/O. Fix the options and run the same command again. The restriction that the output file must be `.d.ts` and the contract of keeping the last valid output and replacing it atomically are unchanged. This help and early validation are included in alpha.5 and are absent from alpha.4.

## Build order

The order is typegen → tsc → vite. Because the Vite build does not check consumer TS types, run tsc first. Adding `typegen: { outFile: 'generated.d.ts' }` to the Vite plugin generates initially in dev and then updates in the background, and it does not rewrite declarations when only the copy changes.

## Related packages

- [@0disoft/saylo-core](https://github.com/0disoft/saylo/tree/main/packages/core#readme) — consumes `AppSchema`
- [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme) — automatic generation in dev
- [@0disoft/saylo-react](https://github.com/0disoft/saylo/tree/main/packages/react#readme) — typed hook

## Documentation

- [Live updates and types](https://github.com/0disoft/saylo/blob/main/docs/04-live-update-and-types.md)
- Repository [README](https://github.com/0disoft/saylo#readme)

## Versions

Supports Node.js 24.x. `engines.node` is `24.x`, and the local verification environment is Node 24.18.0. It is verified against TypeScript 7, and `typescript` is not enforced as a peer.

It is a CLI and worker that run on Node, and the runtime target is ES2022.

## Questions and security reports

Send general questions, feature proposals, and bugs to [rodisoft1@gmail.com](mailto:rodisoft1@gmail.com). Include the package and version, the environment, expected and actual behavior, and a minimal reproduction built from synthetic data. Report security issues privately to the same email with a `Saylo security` subject. Do not send tokens, keys, cookies, or real user data.

If you installed the Vite package, you can read the fuller guidance in `node_modules/@0disoft/saylo-vite/docs/support.md` and `security.md`. These guides and the package contact metadata are included in alpha.5. Earlier alpha.4 tarballs do not contain them.

## License

Apache-2.0. The distribution tarball includes the repository root `LICENSE` and `NOTICE`.
