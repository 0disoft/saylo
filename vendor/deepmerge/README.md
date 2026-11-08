# Development-only deepmerge patch

This private fork contains the CommonJS bundle and declarations from MIT-licensed
`deepmerge@4.3.1`. The original license is retained in `LICENSE`.

[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
affects 4.3.1 and has no upstream patch as of 2026-11-09. Assignment of an own
`__proto__` key while copying either input can change the result's prototype.
The only code change defines own data properties for all three destination
writes. This preserves enumerable keys, symbols, merge options and normal
object prototypes without invoking the inherited prototype setter.

The root development dependency and override make the Svelte Vite plugin use
this fork. It is not a dependency of any published Saylo package. The distinct
private package identity records that the code differs from the registry build;
it does not assert an upstream security fix. The strict audit still checks all
registry dependencies, and `scripts/test/deepmerge-security.test.mjs` checks the
patched code and the plugin's actual dependency resolution in `npm run check`.

Remove the root dependency, override and this directory when an upstream fixed
release or a plugin release without this dependency is available. Restore a
major-range dependency rather than permanently pinning the upstream version.
