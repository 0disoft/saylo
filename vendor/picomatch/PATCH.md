# Temporary development-only picomatch fork

Source: `picomatch@4.0.7` from the npm registry, MIT license retained.
Upstream tarball SHA-512:
`sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==`.

Addresses [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
As of 2026-11-18, npm's latest upstream version is 4.0.7 and no fixed version
is listed. `lib/parse.js` now applies the existing risky-extglob literalization
to repeated bodies with an unescaped, unquoted wildcard outside a character
class, including a single branch such as `+(*)`, `+(*a)` and `+(a*)`.
The existing safe character-class flattening remains in place.
`maxExtglobRecursion: false` remains the upstream explicit opt-out from guards.

Only the manifest, the guard import/call and `lib/repeated-wildcard.js` differ
from the upstream implementation. Upstream README and license are unchanged.
The private name makes this a separately maintained local implementation, not
a claim that registry picomatch 4.0.7 has been fixed. No advisory is suppressed.
The root and SvelteKit example overrides apply to build tooling only; Saylo
tarballs do not ship or depend on this fork. Regression tests exercise actual
Vite/tinyglobby resolution as well as dangerous and normal glob behavior.

Remove the fork and overrides once a fixed upstream release is available and
the same security tests pass against it.
