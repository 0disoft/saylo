# Bounded formatter admission

Included in the stable `0.1.0` release.

The previous message and key caches used LRU replacement with a 256-entry
limit. Sequentially revisiting 257 distinct messages evicted each next-needed
entry, rebuilding a formatter and serializing its key on every call.

## Policy and memory limit

Text formatters, rich formatters and message-key hints now use second-chance
admission. A hit marks its resident as recently used and moves it to the end.
On a full-cache miss, a recent oldest resident loses that flag and the new value
is returned without being cached. If the oldest resident is still cold on a
later miss, the new entry replaces it. This avoids immediately displacing the
next cyclic lookup while still admitting a different hot working set.

The limits stay at 256 text formatters, 256 rich formatters and 256 message-key
hints per formatter owner. Native number, date and plural formatter caches keep
their existing 128-entry LRU limits. There is one bounded flag per message-cache
resident; no unbounded identity map, ghost history, or new cache capacity is
introduced. Misses still create temporary values, so these are retained-entry
limits, not a process RSS or byte-size guarantee.

No rendered strings or caller argument values are cached. ICU output, current
arguments, rich parts, pseudo-localization and snapshot semantics are unchanged.
A failed construction leaves resident entries intact. Tests cover capacity
during a 10,000-key scan, admission of a disjoint hot set, and real text/rich
formatter construction counts at 256, 257 and 512 messages.

## Measuring cyclic calls

After building core, run:

```sh
node benchmarks/formatter-cycle.mjs
node benchmarks/formatter-cycle.mjs --compare-lru
```

The fixture uses distinct messages containing both a number and a string
argument. Each fresh translator warms up for ten complete cycles, then executes
400 cycles per timed trial, with five trials. It reports the median time per
translation call. Constructor counts run separately, outside timing, using the
installed FormatJS constructor's `resolveLocale` hook.

`--compare-lru` makes a temporary copy of compiled core and substitutes the
existing LRU class for just its three message-cache classes. It alternates the
LRU reference and current implementation in one process, avoiding a source
checkout switch and reducing drift between separate before/after runs. Temporary
files are removed afterward. The reference uses the same formatter capacities.

## Local results (2026-11-09)

Node 24.18.0 on Windows, same-process alternating trials:

| Messages per cycle | LRU median µs/call | Current median µs/call | LRU constructions | Current constructions | Current hit rate |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 256 | 8.59 | 8.86 | 0 | 0 | 100% |
| 257 | 28.08 | 8.94 | 102,800 | 400 | 99.61% |
| 512 | 24.87 | 18.06 | 204,800 | 102,400 | 50% |

Construction counts cover one separate 400-cycle run after warmup. At 257
messages, the new policy reconstructs only one formatter per cycle rather than
all 257. At 512 it retains reuse for half the calls while keeping the 256-entry
limit. Text and rich formatting are both covered by construction-count tests.

Measured call time fell about 68% at 257 messages and 27% at 512. The 256-message
median was about 3% slower; this change does not claim a speedup below capacity.
The raw trial durations vary substantially, so time ratios should not be treated
as stable application-wide improvements.

Initial separate-process measurements showed a larger 256-message slowdown
(5.49 to 6.75 µs/call), which prompted the alternating comparison. Both initial
records are retained alongside the primary comparison rather than discarded:

- [Initial LRU measurement](../benchmarks/results/formatter-cycle-before-2026-11-09.json)
- [Initial current measurement](../benchmarks/results/formatter-cycle-after-2026-11-09.json)
- [Same-process alternating comparison](../benchmarks/results/formatter-cycle-paired-2026-11-09.json)

Timing is a local microbenchmark rather than a browser or application-wide
speedup claim. With only 256 resident slots, a 512-message working set still has
cache misses; the goal is to avoid the previous all-miss cycle while retaining
the memory limit. Other access patterns may have different hit rates.
