# Gettext PO exchange

Source checkout feature. Export with `saylo export --with-context --format po --out-file work.po`. Combine `--metadata notes.json` for descriptions, glossary, screenshots and advisory length guidance. Output is created exclusively outside the catalog directory; existing files are never replaced.

Each PO entry contains one complete ICU message. Keep ICU placeholders, plural syntax and rich tags intact; this format does not convert ICU branches into native gettext `msgid_plural` forms. UTF-8, multiline quoted strings, standard C escapes, translator comments and fuzzy drafts are supported. Obsolete entries, native gettext plural entries, missing checkpoints and duplicate tasks are rejected.

`msgctxt` stores the stable identity, source hash, original translation, argument/tag context and metadata. Translation tools must preserve it and the `X-Saylo-*` headers. Do not edit these checkpoint fields to resolve conflicts: use `saylo refresh` against current catalogs instead. Human descriptions are also emitted as extracted comments.

Import directly with `saylo import --file work.po --dry-run --diff`, then `--apply`. The same source/translation conflict checks and ICU/argument/tag validation used for JSON workfiles still apply. Import does not approve. Use `saylo approve --file work.po --reviews reviews.json --reviewer "Name" --apply` as a separate action after reviewing the applied translations.

An empty translation for a previously pending task remains pending, matching gettext conventions. An explicitly empty translation already represented by a completed JSON workfile roundtrips as empty. To intentionally complete a pending task with an empty string, use a JSON workfile. `fuzzy` entries return as pending and cannot accidentally become approvals. Approval hashes remain in the separate ledger; PO files never grant approval.
