# Translation context and reviewer attribution

Source checkout feature. Existing v1/v2 workfiles and approval ledgers remain readable.

Create an advisory sidecar and export it with `saylo export --metadata notes.json --out-file work.json`:

```json
{
  "format": "saylo-translation-metadata/v1",
  "messages": {
    "common:total": {
      "description": "Checkout summary; includes tax",
      "maxLength": 40,
      "screenshots": ["https://example.com/screens/checkout.png"],
      "glossary": { "total": "Amount due including tax" }
    }
  }
}
```

Keys must exist in the current base catalogs. Screenshots accept HTTP(S) links only. Metadata is copied into v3 workfiles alongside argument and rich-tag context. Descriptions, glossary and rendered-length guidance are advisory; import always revalidates current ICU, argument and allowed-tag contracts. Length cannot be guaranteed from source length when arguments expand.

`saylo refresh --file work.json` preserves existing advisory notes. Adding `--metadata notes.json` replaces them from the current sidecar, including clearing removed notes. Metadata never changes source/translation approval hashes or grants approval.

Use `saylo approve --file work.json --reviews reviews.json --reviewer "Reviewer name" --apply` to record audit context. `--reviewed-at 2026-10-25T00:00:00.000Z` supplies a deterministic canonical ISO timestamp; otherwise the CLI uses the current time. These are operator-provided values, not authenticated identities. Existing matching approvals are left unchanged; stale source or translation checkpoints still block approval.
