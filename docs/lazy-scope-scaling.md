# Lazy development subscription scaling

Source checkout fix, measured on 2026-11-09. Not in published alpha.9.

Previously, every accepted catalog lookup sent all cached pair metadata through
`saylo:catalog-scope`. Starting with N base catalogs and adding N target-language
catalogs sequentially sent N+1, N+2, ..., 2N entries, totaling N(3N+1)/2 entries.
The server validated and copied each complete list.

The source now sends one `kind: 'patch'` upsert per accepted lookup and only the
removed keys on eviction. The server validates each patch fully before mutating
its per-owner map and does not copy unchanged subscriptions. Full registration
is retained for connection, reconnection and session changes; an empty full scope
releases that owner. Old full-scope clients remain supported by the new server;
new incremental clients require the matching server. See the
[update protocol](08-update-protocol.md) for the wire contract.

## Measured growth

The fixture uses the real development catalog source, catalog codec, registry
and server subscription handler. Only the ordered socket is simulated. Each
catalog contains one `hello` message; namespace names have fixed width. N base
catalogs are cached initially, then N English catalogs are loaded **one at a
time**, so event batching cannot hide repeated whole-scope transmissions.

| Catalogs added | Subscription messages | Metadata entries sent | Subscription JSON bytes |
| ---: | ---: | ---: | ---: |
| 100 | 100 | 100 | 28,300 |
| 500 | 500 | 500 | 141,500 |
| 1,000 | 1,000 | 1,000 | 283,000 |

For this fixture each added catalog costs exactly 283 JSON bytes: five times as
many catalogs sends five times as many bytes. Every growth message contains one
metadata entry and no full scope replacement. Initial registration sends N
entries once (20,365 / 101,565 / 203,065 bytes respectively). Thus initial
registration plus growth sends 2N metadata entries.

These byte counts exclude catalog contents, manifest responses and WebSocket
framing. They measure subscription traffic, not total traffic, elapsed time or
CPU savings. Different key/session/owner lengths change the byte totals.
This is not a real network/browser throughput measurement.

## Reproducing and regression checks

Build the repository packages, then run:

```sh
node benchmarks/lazy-scope.mjs
node --test packages/vite/test/scope-scaling.test.mjs
```

The regression compares exact per-catalog JSON costs at all three sizes. It also
checks reversed concurrent replies and an empty initial scope, full registration
after reconnect, pushes to every accumulated cached pair, session restart,
and cleanup without closing the shared socket. Protocol tests separately cover
incremental removals, malformed patch atomicity, session mismatch and legacy
full replacements.

The recorded environment and raw counts are in
[the measurement record](../benchmarks/results/lazy-scope-linear-2026-11-09.json).
