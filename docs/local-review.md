# Local translation review

Source checkout feature. Run `saylo review --config saylo.config.json [--metadata notes.json] [--port 0]` and open the printed local URL. The server binds only to `127.0.0.1`; Ctrl+C closes connections and cancels owned operations. It does not start a hosted service or open the browser automatically.

Search current source, translation or keys, then select a message. The screen shows its source, current translation, argument/tag context, optional metadata and approval status. Search displays at most 200 matching entries at a time. Edit the draft and validate it without writing, save it through the existing guarded importer, and approve the saved translation separately. Unsaved drafts require confirmation before switching or refreshing.

Approvals use `config.reviews`, or `.saylo-reviews.json` beside the locales directory when no ledger is configured. Reviewer names are operator-provided audit context, not authentication. No ledger is created until an explicit approval succeeds. Add the ledger to project configuration if builds should enforce it.

Every mutation reloads catalogs and compares the source/translation/metadata/ledger revision with the screen's checkpoint. Changes from another editor or request return a conflict; refresh before retrying. Requests are serialized, bodies are limited to 256 KiB, and at most 32 requests may be admitted concurrently. Existing import and approval locks, contract validation and per-file atomic writes remain authoritative.

The API uses a per-process token, exact host validation and same-origin checks. The page has a restrictive CSP and cannot be embedded. Catalog and metadata strings are rendered as text; screenshots are not fetched automatically. Do not proxy this tool publicly: it is intended for a trusted developer machine.
